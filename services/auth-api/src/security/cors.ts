import type { IncomingMessage, ServerResponse } from "node:http";

const CORS_METHODS = "POST, GET, PATCH, DELETE, PUT, OPTIONS";
const corsMethods = new Set(["POST", "GET", "PATCH", "DELETE", "PUT"]);
const CORS_HEADERS = "Content-Type, Authorization";
const CORS_MAX_AGE_SECONDS = 600;

export interface CorsDecision {
  origin: string | null;
  originAllowed: boolean;
}

export function applyCorsHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: readonly string[]
): CorsDecision {
  const origin = singleOrigin(request.headers.origin);
  const originAllowed = origin !== null && allowedOrigins.includes(origin);
  response.setHeader("vary", appendVary(response.getHeader("vary"), "Origin"));
  if (originAllowed) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-methods", CORS_METHODS);
    response.setHeader("access-control-allow-headers", CORS_HEADERS);
    response.setHeader("access-control-max-age", String(CORS_MAX_AGE_SECONDS));
  }
  return { origin, originAllowed };
}

export function handleCorsPreflight(
  request: IncomingMessage,
  response: ServerResponse,
  decision: CorsDecision
) {
  if (request.method !== "OPTIONS") return false;
  const requestedMethod = singleHeader(
    request.headers["access-control-request-method"]
  )?.toUpperCase();
  const requestedHeaders = singleHeader(
    request.headers["access-control-request-headers"]
  );
  const headersAllowed =
    requestedHeaders === undefined ||
    requestedHeaders
      .split(",")
      .every((header) =>
        ["content-type", "authorization"].includes(header.trim().toLowerCase())
      );
  if (
    !decision.originAllowed ||
    !requestedMethod ||
    !corsMethods.has(requestedMethod) ||
    !headersAllowed
  ) {
    response.writeHead(403, {
      "cache-control": "no-store",
      "content-length": "0"
    });
    response.end();
    return true;
  }
  response.writeHead(204, {
    "cache-control": "no-store",
    "content-length": "0"
  });
  response.end();
  return true;
}

export function safeCorsDiagnostic(
  request: IncomingMessage,
  endpoint: string,
  decision: CorsDecision,
  responseStatus: number
) {
  return {
    requestMethod: safeMethod(request.method),
    endpoint: endpoint.split(/[?#]/, 1)[0],
    incomingOrigin: decision.origin,
    originAllowed: decision.originAllowed,
    responseStatus
  };
}

function singleOrigin(value: string | string[] | undefined) {
  const origin = singleHeader(value);
  if (!origin || origin.length > 256) return null;
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin ? origin : null;
  } catch {
    return null;
  }
}

function singleHeader(value: string | string[] | undefined) {
  return typeof value === "string" && !value.includes("\r") && !value.includes("\n")
    ? value.trim()
    : undefined;
}

function safeMethod(value: string | undefined) {
  return value && /^[A-Z]{3,12}$/.test(value) ? value : "INVALID";
}

function appendVary(current: string | number | string[] | undefined, value: string) {
  const entries = Array.isArray(current)
    ? current
    : current === undefined
      ? []
      : String(current).split(",");
  if (!entries.some((entry) => entry.trim().toLowerCase() === value.toLowerCase())) {
    entries.push(value);
  }
  return entries.map((entry) => entry.trim()).filter(Boolean).join(", ");
}
