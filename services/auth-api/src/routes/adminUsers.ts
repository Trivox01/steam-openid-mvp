import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthorizationService } from "../authorization/authorizationService.ts";
import type { SessionTokenService } from "../authorization/sessionTokenService.ts";
import { UserManagementError } from "../users/contracts.ts";
import { parseUserQuery, type UserService } from "../users/userService.ts";

export const ADMIN_USERS_PATH = "/api/admin/users";
export function isAdminUserPath(pathname: string) {
  return pathname === ADMIN_USERS_PATH ||
    /^\/api\/admin\/users\/[0-9a-f-]{36}$/i.test(pathname);
}

export async function handleAdminUsers(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: {
    users: UserService;
    authorization: AuthorizationService;
    sessions: SessionTokenService;
  }
) {
  if (!isAdminUserPath(url.pathname)) return false;
  if (request.method !== "GET") return writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
  try {
    const actor = await deps.sessions.authenticateBearer(
      typeof request.headers.authorization === "string"
        ? request.headers.authorization
        : undefined
    );
    await deps.authorization.requirePermission(actor.id, "users.view");
    if (url.pathname === ADMIN_USERS_PATH) {
      const query = parseUserQuery(url.searchParams);
      return writeJson(response, 200, {
        ...await deps.users.list(query),
        page: query.page,
        pageSize: query.pageSize
      });
    }
    const user = await deps.users.get(url.pathname.slice(ADMIN_USERS_PATH.length + 1));
    return user
      ? writeJson(response, 200, user)
      : writeJson(response, 404, { error: "USER_NOT_FOUND" });
  } catch (error) {
    const code = error instanceof UserManagementError
      ? error.code
      : typeof error === "object" && error && "code" in error
        ? String(error.code) : "USER_QUERY_FAILED";
    const status = code === "AUTHENTICATION_REQUIRED" ? 401
      : code === "PERMISSION_DENIED" ? 403
        : code.startsWith("INVALID_") ? 400 : 500;
    return writeJson(response, status, { error: code });
  }
}

function writeJson(response: ServerResponse, status: number, payload: object) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
  return true;
}
