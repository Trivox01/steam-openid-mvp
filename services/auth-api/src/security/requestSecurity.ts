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
  if (config.trustProxy) {
    if (
      singleHeader(request.headers["x-forwarded-proto"]) !== "https" ||
      singleHeader(request.headers["x-forwarded-host"]) !== expected.host
    ) {
      throw new Error("https_required");
    }
  } else {
    const encrypted = (request.socket as typeof request.socket & {
      encrypted?: boolean;
    }).encrypted;
    if (!encrypted || request.headers.host !== expected.host) {
      throw new Error("https_required");
    }
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

function singleHeader(value: string | string[] | undefined) {
  if (typeof value !== "string" || value.includes(",")) return undefined;
  return value.trim().toLowerCase();
}
