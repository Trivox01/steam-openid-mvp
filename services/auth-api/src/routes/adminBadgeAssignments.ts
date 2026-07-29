import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthorizationService } from "../authorization/authorizationService.ts";
import { AuthorizationError } from "../authorization/contracts.ts";
import type { SessionTokenService } from "../authorization/sessionTokenService.ts";
import {
  BadgeAssignmentError,
  type BadgeAssignmentQuery
} from "../badgeAssignments/contracts.ts";
import {
  BadgeAssignmentService,
  parseAssignmentQuery
} from "../badgeAssignments/badgeAssignmentService.ts";

export interface AdminBadgeAssignmentDependencies {
  assignments: BadgeAssignmentService;
  authorization: AuthorizationService;
  sessions: SessionTokenService;
}

export function isAdminBadgeAssignmentPath(pathname: string) {
  return pathname === "/api/admin/badge-assignments" ||
    /^\/api\/admin\/badge-assignments\/[0-9a-f-]+(?:\/revoke)?$/i.test(pathname) ||
    /^\/api\/admin\/users\/[0-9a-f-]+\/badge-assignments$/i.test(pathname) ||
    /^\/api\/admin\/badges\/[0-9a-f-]+\/assignments$/i.test(pathname);
}

export async function handleAdminBadgeAssignments(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: AdminBadgeAssignmentDependencies
) {
  if (!isAdminBadgeAssignmentPath(url.pathname)) return false;
  let actorId: string | undefined;
  let targetUserId: string | undefined;
  let targetBadgeId: string | undefined;
  try {
    const actor = await deps.sessions.authenticateBearer(
      typeof request.headers.authorization === "string"
        ? request.headers.authorization
        : undefined
    );
    actorId = actor.id;
    const userList = url.pathname.match(
      /^\/api\/admin\/users\/([0-9a-f-]+)\/badge-assignments$/i
    );
    const badgeList = url.pathname.match(
      /^\/api\/admin\/badges\/([0-9a-f-]+)\/assignments$/i
    );
    if (
      request.method === "GET" &&
      (
        url.pathname === "/api/admin/badge-assignments" ||
        userList ||
        badgeList
      )
    ) {
      await deps.authorization.requirePermission(actor.id, "badges.view_assignments");
      const queryParams = new URLSearchParams(url.searchParams);
      if (userList) queryParams.set("userId", userList[1]);
      if (badgeList) queryParams.set("badgeId", badgeList[1]);
      const query = parseAssignmentQuery(queryParams);
      writeJson(response, 200, {
        ...(await deps.assignments.list(query)),
        page: query.page,
        pageSize: query.pageSize
      });
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/admin/badge-assignments"
    ) {
      await deps.authorization.requirePermission(actor.id, "badges.assign");
      const body = await readJson(request);
      if (body && typeof body === "object" && !Array.isArray(body)) {
        targetUserId = typeof body.userId === "string" ? body.userId : undefined;
        targetBadgeId = typeof body.badgeDefinitionId === "string"
          ? body.badgeDefinitionId
          : undefined;
      }
      writeJson(response, 201, await deps.assignments.assign(body, actor.id));
      return true;
    }
    const assignmentMatch = url.pathname.match(
      /^\/api\/admin\/badge-assignments\/([0-9a-f-]+)(\/revoke)?$/i
    );
    if (assignmentMatch && request.method === "GET" && !assignmentMatch[2]) {
      await deps.authorization.requirePermission(actor.id, "badges.view_assignments");
      const assignment = await deps.assignments.get(assignmentMatch[1].toLowerCase());
      if (!assignment) {
        throw new BadgeAssignmentError("BADGE_ASSIGNMENT_NOT_FOUND");
      }
      writeJson(response, 200, assignment);
      return true;
    }
    if (assignmentMatch && request.method === "POST" && assignmentMatch[2]) {
      await deps.authorization.requirePermission(actor.id, "badges.revoke");
      writeJson(response, 200, await deps.assignments.revoke(
        assignmentMatch[1],
        await readJson(request),
        actor.id
      ));
      return true;
    }
    writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    const code = error instanceof BadgeAssignmentError ||
      error instanceof AuthorizationError
      ? error.code
      : "BADGE_ASSIGNMENT_OPERATION_FAILED";
    if (actorId) {
      await deps.authorization.repository.writeAuditEvent({
        actorUserId: actorId,
        action: "badge.assignment_denied",
        targetType: "badge_assignment",
        metadata: {
          denialCode: code,
          ...(targetUserId ? { userId: targetUserId } : {}),
          ...(targetBadgeId ? { badgeId: targetBadgeId } : {})
        }
      }).catch(() => undefined);
    }
    writeError(response, code);
  }
  return true;
}

async function readJson(request: IncomingMessage) {
  const bytes = await readBytes(request, 16 * 1024);
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new BadgeAssignmentError("INVALID_JSON"); }
}

function readBytes(request: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new BadgeAssignmentError("PAYLOAD_TOO_LARGE"));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function writeError(response: ServerResponse, code: string) {
  const notFound = new Set([
    "BADGE_NOT_FOUND",
    "USER_NOT_FOUND",
    "BADGE_ASSIGNMENT_NOT_FOUND"
  ]);
  const conflict = new Set([
    "BADGE_ALREADY_ASSIGNED",
    "BADGE_ASSIGNMENT_ALREADY_REVOKED"
  ]);
  const status = code === "AUTHENTICATION_REQUIRED" ? 401
    : code === "PERMISSION_DENIED" ? 403
    : notFound.has(code) ? 404
    : conflict.has(code) ? 409
    : code === "PAYLOAD_TOO_LARGE" ? 413
    : code === "BADGE_ASSIGNMENT_OPERATION_FAILED" ? 500
    : 400;
  writeJson(response, status, { error: code });
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
}
