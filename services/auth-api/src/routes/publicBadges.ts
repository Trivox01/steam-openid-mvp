import type { IncomingMessage, ServerResponse } from "node:http";
import type { BadgeAssignmentService } from "../badgeAssignments/badgeAssignmentService.ts";
import type { BadgeRepository } from "../badges/badgeRepository.ts";
import {
  BadgeAssetNotFoundError,
  type BadgeAssetStorage
} from "../badges/badgeAssetStorage.ts";
import type { SessionTokenService } from "../authorization/sessionTokenService.ts";

export const ME_PUBLIC_BADGES_PATH = "/api/me/public-badges";
const ICON_PREFIX = "/api/public/badge-icons/";

export function isPublicBadgePath(pathname: string) {
  return pathname === ME_PUBLIC_BADGES_PATH || pathname.startsWith(ICON_PREFIX);
}

export async function handlePublicBadges(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: {
    assignments: BadgeAssignmentService;
    badges: BadgeRepository;
    assets: BadgeAssetStorage;
    sessions: SessionTokenService;
  }
) {
  if (request.method !== "GET") return false;
  if (url.pathname === ME_PUBLIC_BADGES_PATH) {
    try {
      const user = await dependencies.sessions.authenticateBearer(
        typeof request.headers.authorization === "string"
          ? request.headers.authorization
          : undefined
      );
      const candidates = await dependencies.assignments.listPublicBadges(user.id);
      const readable = await Promise.all(candidates.map(async (candidate) => ({
        badge: candidate.badge,
        exists: await dependencies.assets.exists(candidate.storageKey)
      })));
      writeJson(response, 200, {
        items: readable.filter((item) => item.exists).map((item) => item.badge)
      });
    } catch {
      writeJson(response, 401, { error: "AUTHENTICATION_REQUIRED" });
    }
    return true;
  }
  if (!url.pathname.startsWith(ICON_PREFIX)) return false;
  let slug: string;
  try {
    slug = decodeURIComponent(url.pathname.slice(ICON_PREFIX.length));
  } catch {
    writeJson(response, 404, { error: "not_found" });
    return true;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    writeJson(response, 404, { error: "not_found" });
    return true;
  }
  const asset = await dependencies.badges.getPublicAssetByBadgeSlug(
    slug,
    new Date().toISOString()
  );
  if (!asset) {
    writeJson(response, 404, { error: "not_found" });
    return true;
  }
  try {
    const bytes = await dependencies.assets.read(asset.storageKey);
    response.writeHead(200, {
      "content-type": asset.contentType,
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "x-content-type-options": "nosniff",
      "content-length": bytes.byteLength
    });
    response.end(bytes);
  } catch (error) {
    if (!(error instanceof BadgeAssetNotFoundError)) throw error;
    writeJson(response, 404, { error: "not_found" });
  }
  return true;
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
