import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthorizationService } from "../authorization/authorizationService.ts";
import type { SessionTokenService } from "../authorization/sessionTokenService.ts";

export const ASSIGNMENT_USERS_PATH = "/api/admin/badge-assignment-users";

export async function handleAdminAssignmentUsers(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: { authorization: AuthorizationService; sessions: SessionTokenService }
) {
  if (url.pathname !== ASSIGNMENT_USERS_PATH) return false;
  if (request.method !== "GET") {
    return writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
  }
  try {
    const actor = await deps.sessions.authenticateBearer(
      typeof request.headers.authorization === "string"
        ? request.headers.authorization
        : undefined
    );
    await deps.authorization.requirePermission(actor.id, "badges.view_assignments");
    const page = boundedInteger(url.searchParams.get("page"), 1, 10_000, 1);
    const pageSize = boundedInteger(url.searchParams.get("pageSize"), 1, 50, 20);
    const search = url.searchParams.get("search")?.trim();
    if (search && (search.length > 80 || !/^[0-9a-f-]+$/i.test(search))) {
      return writeJson(response, 400, { error: "INVALID_USER_SEARCH" });
    }
    const result = await deps.authorization.repository.listUserSummaries({
      page, pageSize, ...(search ? { search } : {})
    });
    return writeJson(response, 200, { ...result, page, pageSize });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? String(error.code) : "USER_SEARCH_FAILED";
    return writeJson(response, code === "AUTHENTICATION_REQUIRED" ? 401
      : code === "PERMISSION_DENIED" ? 403 : 500, { error: code });
  }
}

function boundedInteger(
  value: string | null, min: number, max: number, fallback: number
) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed : fallback;
}

function writeJson(response: ServerResponse, status: number, payload: object) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
  return true;
}
