import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthorizationError } from "../authorization/contracts.ts";
import type { AuthorizationService } from "../authorization/authorizationService.ts";
import type { SessionTokenService } from "../authorization/sessionTokenService.ts";

export const ME_AUTHORIZATION_PATH = "/api/me/authorization";

export async function handleMeAuthorization(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: {
    authorization: AuthorizationService;
    sessions: SessionTokenService;
  }
) {
  if (request.method !== "GET") return false;
  try {
    const user = await dependencies.sessions.authenticateBearer(
      typeof request.headers.authorization === "string"
        ? request.headers.authorization
        : undefined
    );
    writeJson(response, 200, await dependencies.authorization.getSnapshot(user.id));
  } catch (error) {
    const code = error instanceof AuthorizationError
      ? error.code
      : "AUTHENTICATION_REQUIRED";
    writeJson(response, authorizationErrorStatus(code), {
      error: code
    });
  }
  return true;
}

export function authorizationErrorStatus(code: string): 401 | 403 {
  return code === "AUTHENTICATION_REQUIRED" ? 401 : 403;
}

function writeJson(response: ServerResponse, status: number, payload: object) {
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
