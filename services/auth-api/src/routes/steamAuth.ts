import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthTransactionError,
  AuthTransactionService
} from "../auth/authTransactionService.ts";
import type { AuthApiConfig } from "../config.ts";
import {
  PollingRateLimitError,
  PollingRateLimiter
} from "../security/pollingRateLimiter.ts";
import { sanitizeLogCode } from "../security/redaction.ts";
import type { SafeLogger } from "../security/safeLogger.ts";
import { SteamOpenIdVerifier } from "../steam/openIdVerifier.ts";
import { buildSteamLoginUrl } from "../steam/steamLoginUrl.ts";
import type { OpenIdFields } from "../steam/openIdTypes.ts";
import { StorageError } from "../storage/authRepository.ts";

const MAX_JSON_BODY_BYTES = 4_096;
const POLLING_INTERVAL_MS = 3_000;
const CALLBACK_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export interface SteamAuthRouteDependencies {
  config: AuthApiConfig;
  transactions: AuthTransactionService;
  verifier: SteamOpenIdVerifier;
  rateLimiter: PollingRateLimiter;
  logger: SafeLogger;
  now?: () => number;
}

export function createSteamAuthRouteHandler(
  dependencies: SteamAuthRouteDependencies
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    url: URL
  ) => {
    if (
      request.method === "POST" &&
      url.pathname === "/v1/auth/steam/start"
    ) {
      await handleStart(request, response, dependencies);
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/auth/steam/callback"
    ) {
      await handleCallback(response, url, dependencies);
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/auth/steam/status"
    ) {
      await handleStatus(request, response, dependencies);
      return true;
    }
    return false;
  };
}

async function handleStart(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: SteamAuthRouteDependencies
) {
  const context = requestContext("steam_auth_start", dependencies);
  try {
    const body = await readJsonBody(request);
    const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
    const started = await dependencies.transactions.start({
      returnToBase: dependencies.config.openIdReturnUrl,
      deviceId
    });
    const steamLoginUrl = buildSteamLoginUrl(
      dependencies.config.openIdRealm,
      started.returnTo
    );
    writeJson(response, 201, {
      authRequestId: started.authRequestId,
      pollSecret: started.pollSecret,
      steamLoginUrl,
      expiresAt: started.expiresAt,
      pollingInterval: POLLING_INTERVAL_MS
    });
    context.finish("success");
  } catch (error) {
    const code = safeErrorCode(error);
    writeJson(response, responseStatus(code, 400), {
      error: code
    });
    context.finish("failure", code);
  }
}

async function handleCallback(
  response: ServerResponse,
  url: URL,
  dependencies: SteamAuthRouteDependencies
) {
  const context = requestContext("steam_auth_callback", dependencies);
  const parsed = parseUniqueQuery(url);
  const authRequestId = parsed.ok ? parsed.fields.transaction : undefined;
  try {
    if (!parsed.ok || !authRequestId) {
      throw new CallbackError("malformed_response");
    }
    const transaction =
      await dependencies.transactions.getForCallback(authRequestId);
    if (parsed.fields["openid.mode"] === "cancel") {
      await dependencies.transactions.markCancelled(authRequestId);
      writeCallbackHtml(response, 200, "Steam connection was cancelled.");
      context.finish("success");
      return;
    }
    const openIdFields = onlyOpenIdFields(parsed.fields);
    const result = await dependencies.verifier.verify(
      openIdFields,
      transaction.returnTo
    );
    if (!result.ok) {
      if (!result.temporary) {
        await dependencies.transactions.markFailed(
          authRequestId,
          result.reason
        );
      }
      writeCallbackHtml(
        response,
        result.temporary ? 503 : 400,
        result.temporary
          ? "Steam verification is temporarily unavailable. Please try again."
          : "Steam connection could not be verified."
      );
      context.finish(
        result.temporary ? "temporary_failure" : "failure",
        result.reason
      );
      return;
    }
    await dependencies.transactions.markVerified(
      authRequestId,
      result.steamId,
      result.responseNonce
    );
    writeCallbackHtml(
      response,
      200,
      "Steam connected successfully. You can return to Achievement Nexus."
    );
    context.finish("success");
  } catch (error) {
    const code = safeErrorCode(error);
    writeCallbackHtml(
      response,
      code === "auth_request_expired" ? 410 : responseStatus(code, 400),
      "Steam connection could not be completed."
    );
    context.finish("failure", code);
  }
}

async function handleStatus(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: SteamAuthRouteDependencies
) {
  const context = requestContext("steam_auth_status", dependencies);
  try {
    const body = await readJsonBody(request);
    const authRequestId =
      typeof body.authRequestId === "string" ? body.authRequestId : "";
    const pollSecret =
      typeof body.pollSecret === "string" ? body.pollSecret : "";
    if (!authRequestId || !pollSecret) throw new CallbackError("invalid_request");
    const status = await dependencies.transactions.status(
      authRequestId,
      pollSecret
    );
    dependencies.rateLimiter.assertAllowed(authRequestId);
    writeJson(response, 200, status);
    context.finish("success");
  } catch (error) {
    const code = safeErrorCode(error);
    if (error instanceof PollingRateLimitError) {
      response.setHeader("retry-after", String(Math.ceil(error.retryAfterMs / 1000)));
      writeJson(response, 429, { error: code });
    } else {
      writeJson(response, responseStatus(code, 401), {
        error: code
      });
    }
    context.finish("failure", code);
  }
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_JSON_BODY_BYTES) {
      throw new CallbackError("request_body_too_large");
    }
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error();
    }
    return value as Record<string, unknown>;
  } catch {
    throw new CallbackError("invalid_json");
  }
}

function parseUniqueQuery(url: URL):
  | { ok: true; fields: Record<string, string> }
  | { ok: false } {
  const fields: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (Object.hasOwn(fields, key)) return { ok: false };
    fields[key] = value;
  }
  return { ok: true, fields };
}

function onlyOpenIdFields(fields: Record<string, string>): OpenIdFields {
  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => key.startsWith("openid."))
  );
}

function writeJson(
  response: ServerResponse,
  status: number,
  payload: object
) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function writeCallbackHtml(
  response: ServerResponse,
  status: number,
  message: string
) {
  const body =
    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Achievement Nexus</title><style>" +
    "body{font:16px system-ui;color:#eee;background:#11131a;display:grid;place-items:center;min-height:100vh;margin:0}" +
    "main{max-width:34rem;padding:2rem;text-align:center}</style>" +
    `<main><h1>Achievement Nexus</h1><p>${message}</p></main></html>`;
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": CALLBACK_CSP,
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function requestContext(
  endpoint: "steam_auth_start" | "steam_auth_callback" | "steam_auth_status",
  dependencies: SteamAuthRouteDependencies
) {
  const startedAt = (dependencies.now ?? Date.now)();
  const requestId = randomUUID();
  return {
    finish(
      status: "success" | "failure" | "temporary_failure",
      errorCode?: string
    ) {
      dependencies.logger.write({
        event: "steam_auth_request",
        requestId,
        endpoint,
        status,
        durationMs: Math.max(0, (dependencies.now ?? Date.now)() - startedAt),
        ...(errorCode ? { errorCode: sanitizeLogCode(errorCode) } : {})
      });
    }
  };
}

function safeErrorCode(error: unknown) {
  if (
    error instanceof AuthTransactionError ||
    error instanceof PollingRateLimitError ||
    error instanceof CallbackError ||
    error instanceof StorageError
  ) {
    return error instanceof PollingRateLimitError
      ? "polling_rate_limited"
      : error instanceof CallbackError
        ? error.code
        : error instanceof StorageError
          ? error.code
          : error.code;
  }
  return "internal_error";
}

function responseStatus(code: string, fallback: number) {
  if (code === "request_body_too_large") return 413;
  if (code === "database_unavailable" || code === "internal_error") return 503;
  return fallback;
}

class CallbackError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "CallbackError";
  }
}
