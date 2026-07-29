import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthorizationError } from "../authorization/contracts.ts";
import type { AuthorizationService } from "../authorization/authorizationService.ts";
import type { SessionTokenService } from "../authorization/sessionTokenService.ts";
import type { BadgeService } from "../badges/badgeService.ts";
import { parseBadgeListQuery } from "../badges/badgeService.ts";
import { BadgeError } from "../badges/contracts.ts";
import {
  MAX_BADGE_ASSET_BYTES,
  validateBadgeAsset,
  type BadgeAssetStorage
} from "../badges/badgeAssetStorage.ts";

export interface AdminBadgeDependencies {
  badges: BadgeService;
  assets: BadgeAssetStorage;
  authorization: AuthorizationService;
  sessions: SessionTokenService;
}

export function isAdminBadgePath(pathname: string) {
  return pathname === "/api/admin/badges" ||
    /^\/api\/admin\/badges\/[0-9a-f-]+(?:\/archive)?$/i.test(pathname) ||
    pathname === "/api/admin/badge-assets" ||
    /^\/api\/admin\/badge-assets\/[0-9a-f-]+(?:\/content)?$/i.test(pathname);
}

export async function handleAdminBadges(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: AdminBadgeDependencies
) {
  if (!isAdminBadgePath(url.pathname)) return false;
  let actorId: string | undefined;
  try {
    const actor = await deps.sessions.authenticateBearer(
      typeof request.headers.authorization === "string"
        ? request.headers.authorization
        : undefined
    );
    actorId = actor.id;
    if (url.pathname === "/api/admin/badges" && request.method === "GET") {
      await deps.authorization.requirePermission(actor.id, "badges.view");
      const query = parseBadgeListQuery(url.searchParams);
      writeJson(response, 200, {
        ...(await deps.badges.list(query)),
        page: query.page,
        pageSize: query.pageSize
      });
      return true;
    }
    if (url.pathname === "/api/admin/badges" && request.method === "POST") {
      await deps.authorization.requirePermission(actor.id, "badges.create");
      writeJson(response, 201, await deps.badges.create(await readJson(request), actor.id));
      return true;
    }
    if (url.pathname === "/api/admin/badge-assets" && request.method === "POST") {
      await deps.authorization.requirePermission(actor.id, "assets.upload");
      const bytes = await readBytes(request, MAX_BADGE_ASSET_BYTES);
      const asset = validateBadgeAsset(bytes, request.headers["content-type"]);
      const storageKey = await deps.assets.upload(asset);
      try {
        writeJson(response, 201, await deps.badges.repository.saveAsset({
          storageKey,
          contentType: asset.contentType,
          byteSize: asset.bytes.length,
          width: asset.width,
          height: asset.height,
          isSquare: asset.isSquare
        }, actor.id));
      } catch (error) {
        await deps.assets.delete(storageKey).catch(() => undefined);
        throw error;
      }
      return true;
    }
    const assetMatch = url.pathname.match(/^\/api\/admin\/badge-assets\/([0-9a-f-]+)\/content$/i);
    if (assetMatch && request.method === "GET") {
      await deps.authorization.requirePermission(actor.id, "badges.view");
      const asset = await deps.badges.repository.getAsset(assetMatch[1]);
      if (!asset || asset.deletedAt) throw new BadgeError("ASSET_NOT_FOUND");
      const content = await deps.assets.read(asset.storageKey);
      response.writeHead(200, {
        "content-type": asset.contentType,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-length": content.length
      });
      response.end(content);
      return true;
    }
    const deleteAssetMatch = url.pathname.match(/^\/api\/admin\/badge-assets\/([0-9a-f-]+)$/i);
    if (deleteAssetMatch && request.method === "DELETE") {
      await deps.authorization.requirePermission(actor.id, "assets.delete");
      const storageKey = await deps.badges.repository.deleteUnusedAsset(
        deleteAssetMatch[1],
        actor.id
      );
      if (!storageKey) throw new BadgeError("ASSET_NOT_FOUND");
      await deps.assets.delete(storageKey).catch(() => undefined);
      response.writeHead(204, { "cache-control": "no-store" });
      response.end();
      return true;
    }
    const match = url.pathname.match(/^\/api\/admin\/badges\/([0-9a-f-]+)(\/archive)?$/i);
    if (match && request.method === "GET" && !match[2]) {
      await deps.authorization.requirePermission(actor.id, "badges.view");
      const badge = await deps.badges.get(match[1]);
      if (!badge) throw new BadgeError("BADGE_NOT_FOUND");
      writeJson(response, 200, badge);
      return true;
    }
    if (match && request.method === "PATCH" && !match[2]) {
      await deps.authorization.requirePermission(actor.id, "badges.edit");
      writeJson(response, 200, await deps.badges.update(match[1], await readJson(request), actor.id));
      return true;
    }
    if (match && request.method === "POST" && match[2]) {
      await deps.authorization.requirePermission(actor.id, "badges.delete");
      writeJson(response, 200, await deps.badges.archive(match[1], actor.id));
      return true;
    }
    writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    if (error instanceof AuthorizationError && actorId) {
      await deps.authorization.repository.writeAuditEvent({
        actorUserId: actorId,
        action: "badge.action_denied",
        targetType: "badge",
        metadata: { endpoint: url.pathname, method: request.method ?? "UNKNOWN" }
      }).catch(() => undefined);
    }
    writeApiError(response, error);
  }
  return true;
}

async function readJson(request: IncomingMessage) {
  const bytes = await readBytes(request, 32 * 1024);
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new BadgeError("INVALID_JSON"); }
}
function readBytes(request: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new BadgeError("PAYLOAD_TOO_LARGE"));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}
function writeApiError(response: ServerResponse, error: unknown) {
  if (response.headersSent) return;
  const code = error instanceof BadgeError || error instanceof AuthorizationError
    ? error.code
    : error instanceof Error && error.message === "badge_asset_in_use"
      ? "BADGE_ASSET_IN_USE"
    : isUniqueViolation(error) ? "BADGE_SLUG_CONFLICT" : "BADGE_OPERATION_FAILED";
  const status = code === "AUTHENTICATION_REQUIRED" ? 401
    : code === "PERMISSION_DENIED" ? 403
    : code.endsWith("_NOT_FOUND") ? 404
    : code === "BADGE_SLUG_CONFLICT" ? 409
    : code === "PAYLOAD_TOO_LARGE" ? 413
    : code === "BADGE_OPERATION_FAILED" ? 500 : 400;
  writeJson(response, status, { error: code });
}
function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "23505";
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
