import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthorizationService } from "../authorization/authorizationService.ts";
import { AuthorizationError } from "../authorization/contracts.ts";
import type { SessionTokenService } from "../authorization/sessionTokenService.ts";
import { UserManagementError } from "../users/contracts.ts";
import { parseUserQuery, type UserService } from "../users/userService.ts";

export const ADMIN_USERS_PATH = "/api/admin/users";
export function isAdminUserPath(pathname: string) {
  return pathname === ADMIN_USERS_PATH ||
    /^\/api\/admin\/users\/[0-9a-f-]{36}(?:\/status)?$/i.test(pathname);
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
  try {
    const actor = await deps.sessions.authenticateBearer(
      typeof request.headers.authorization === "string"
        ? request.headers.authorization
        : undefined
    );
    await deps.authorization.requirePermission(actor.id, "users.view");
    const statusMatch = url.pathname.match(
      /^\/api\/admin\/users\/([0-9a-f-]{36})\/status$/i
    );
    if (statusMatch) {
      if (request.method !== "PATCH") {
        return writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
      }
      await deps.authorization.requirePermission(actor.id, "users.change_status");
      // "users.change_status" says the actor may change statuses at all; it says
      // nothing about whose. The hierarchy check blocks self-service, owners, and
      // peers or superiors, by numeric role priority rather than by role name.
      // Deliberately the hierarchy half only, so this route does not silently
      // start requiring "users.manage" as a second permission.
      if (!await deps.authorization.canManageUserHierarchy(actor.id, statusMatch[1])) {
        throw new AuthorizationError("PERMISSION_DENIED");
      }
      const updated = await deps.users.changeStatus(
        actor.id,
        statusMatch[1],
        await readJson(request)
      );
      return writeJson(response, 200, updated ?? {});
    }
    if (request.method !== "GET") {
      return writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    }
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
    // Only codes from the two closed domain unions are echoed. Anything else
    // (storage failures, driver errors carrying a Postgres SQLSTATE in `code`)
    // collapses into one generic code so internals never reach the client.
    const code = error instanceof UserManagementError ||
      error instanceof AuthorizationError
      ? error.code
      : "USER_QUERY_FAILED";
    const status = code === "AUTHENTICATION_REQUIRED" ? 401
      : code === "PERMISSION_DENIED" || code === "ACCOUNT_NOT_ACTIVE" ? 403
        : code === "USER_NOT_FOUND" ? 404
          : code === "USER_STATUS_UNCHANGED" ? 409
            : code.startsWith("INVALID_") ? 400 : 500;
    return writeJson(response, status, { error: code });
  }
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 8_192) throw new UserManagementError("INVALID_USER_STATUS");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new UserManagementError("INVALID_USER_STATUS");
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
