import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthApiConfig } from "../config.ts";
import {
  DesktopSessionError,
  type DesktopSessionService
} from "../desktopSessions/desktopSessionService.ts";
import {
  PollingRateLimitError,
  PollingRateLimiter
} from "../security/pollingRateLimiter.ts";
import { createHash } from "node:crypto";
import { getClientAddress } from "../security/requestSecurity.ts";

export const DESKTOP_SESSION_REFRESH_PATH = "/v1/auth/desktop/refresh";
export const DESKTOP_SESSION_LOGOUT_PATH = "/v1/auth/desktop/logout";

export async function handleDesktopSessions(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: {
    sessions: DesktopSessionService;
    rateLimiter: PollingRateLimiter;
    config: AuthApiConfig;
  }
) {
  if (url.pathname !== DESKTOP_SESSION_REFRESH_PATH && url.pathname !== DESKTOP_SESSION_LOGOUT_PATH) {
    return false;
  }
  if (request.method !== "POST") return writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
  try {
    const body = await readBody(request);
    const credential = typeof body.credential === "string" ? body.credential : "";
    if (!credential || credential.length > 128) throw new DesktopSessionError("DESKTOP_SESSION_INVALID");
    const clientAddress = getClientAddress(request, deps.config);
    // A client-wide bucket cannot be bypassed by normal credential rotation;
    // the second opaque bucket still isolates abuse of one stolen credential.
    deps.rateLimiter.assertAllowed(`desktop-client:${clientAddress}`);
    deps.rateLimiter.assertAllowed(`desktop-credential:${shortHash(credential)}`);
    if (url.pathname === DESKTOP_SESSION_LOGOUT_PATH) {
      await deps.sessions.logout(credential);
      return writeJson(response, 204);
    }
    return writeJson(response, 200, await deps.sessions.refresh(credential));
  } catch (error) {
    if (error instanceof PollingRateLimitError) {
      response.setHeader("retry-after", String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
      return writeJson(response, 429, { error: "SESSION_REFRESH_RATE_LIMITED" });
    }
    const code = error instanceof DesktopSessionError ? error.code : "SESSION_REFRESH_FAILED";
    const status = code === "ACCOUNT_NOT_ACTIVE" ? 403
      : code === "SESSION_REFRESH_FAILED" ? 503 : 401;
    return writeJson(response, status, { error: code });
  }
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 1_024) throw new DesktopSessionError("DESKTOP_SESSION_INVALID");
    chunks.push(bytes);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new DesktopSessionError("DESKTOP_SESSION_INVALID"); }
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function writeJson(response: ServerResponse, status: number, payload?: object) {
  const body = payload ? JSON.stringify(payload) : "";
  response.writeHead(status, {
    ...(body ? { "content-type": "application/json; charset=utf-8" } : {}),
    "cache-control": "private, no-store",
    "pragma": "no-cache",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
  return true;
}
