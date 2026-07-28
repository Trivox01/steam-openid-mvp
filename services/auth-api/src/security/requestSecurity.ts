import type { IncomingMessage } from "node:http";
import type { AuthApiConfig } from "../config.ts";

export function validatePublicAuthRequest(
  request: IncomingMessage,
  config: AuthApiConfig
) {
  if (config.nodeEnv !== "staging" && config.nodeEnv !== "production") {
    return;
  }
  const expected = new URL(config.publicBaseUrl);
  const directConnectionIsSecure = Boolean(
    (request.socket as typeof request.socket & { encrypted?: boolean }).encrypted
  );
  const trustedForwardedConnectionIsSecure =
    config.trustProxy &&
    firstForwardedValue(request.headers["x-forwarded-proto"]) === "https";

  if (!directConnectionIsSecure && !trustedForwardedConnectionIsSecure) {
    throw new Error("https_required");
  }

  const forwardedHost = request.headers["x-forwarded-host"];
  const requestHost = directConnectionIsSecure
    ? singleHostHeader(request.headers.host)
    : forwardedHost === undefined
      ? singleHostHeader(request.headers.host)
      : singleHostHeader(forwardedHost);
  if (requestHost !== expected.host) {
    throw new Error("https_required");
  }
  const origin = request.headers.origin;
  if (
    origin &&
    origin !== expected.origin &&
    !config.allowedOrigins.includes(origin)
  ) {
    throw new Error("origin_not_allowed");
  }
}

export function getSecureTransportDiagnostic(
  request: IncomingMessage,
  config: AuthApiConfig,
  endpoint: string
) {
  const socketEncrypted = Boolean(
    (request.socket as typeof request.socket & { encrypted?: boolean }).encrypted
  );
  return {
    trustProxy: config.trustProxy,
    forwardedProto: sanitizeDiagnosticValue(
      firstForwardedValue(request.headers["x-forwarded-proto"])
    ),
    socketEncrypted,
    endpoint: endpoint.split(/[?#]/, 1)[0]
  };
}

function firstForwardedValue(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value[0] : value;
  return header?.split(",", 1)[0]?.trim();
}

function singleHostHeader(value: string | string[] | undefined) {
  if (typeof value !== "string" || value.includes(",")) return undefined;
  return value.trim().toLowerCase();
}

function sanitizeDiagnosticValue(value: string | undefined) {
  if (!value) return null;
  return /^[a-z]{1,16}$/.test(value) ? value : "invalid";
}
