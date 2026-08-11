import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthorizationError } from "../authorization/contracts.ts";
import type { SessionTokenService } from "../authorization/sessionTokenService.ts";
import { PollingRateLimitError, PollingRateLimiter } from "../security/pollingRateLimiter.ts";
import { SteamDataClient, SteamDataError } from "../steam/steamDataClient.ts";

export const STEAM_LIBRARY_PATH = "/api/steam/library";
const ACHIEVEMENT_PATH = /^\/api\/steam\/games\/([^/]+)\/achievements\/sync$/;

export function isSteamDataPath(pathname: string) {
  return pathname === STEAM_LIBRARY_PATH || ACHIEVEMENT_PATH.test(pathname);
}

export async function handleSteamData(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: {
    sessions: SessionTokenService;
    steam: SteamDataClient;
    rateLimiter: PollingRateLimiter;
  }
) {
  const library = url.pathname === STEAM_LIBRARY_PATH;
  const achievementMatch = ACHIEVEMENT_PATH.exec(url.pathname);
  if ((library && request.method !== "GET") ||
      (achievementMatch && request.method !== "POST")) return false;
  if (!library && !achievementMatch) return false;
  try {
    const user = await dependencies.sessions.authenticateBearer(
      typeof request.headers.authorization === "string"
        ? request.headers.authorization
        : undefined
    );
    dependencies.rateLimiter.assertAllowed(
      `${user.id}:${library ? "library" : "achievements"}`
    );
    if (library) {
      writeJson(response, 200, await dependencies.steam.getOwnedGames(user.steamId64));
    } else {
      const appId = Number(achievementMatch![1]);
      if (!Number.isSafeInteger(appId) || appId <= 0) {
        writeJson(response, 400, { error: "invalid_app_id" });
      } else {
        writeJson(response, 200, await dependencies.steam.getGameAchievements(user.steamId64, appId));
      }
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      // A non-active account has a perfectly valid session, so it must not be
      // reported as expired: clients treat 401 as "re-login", which would loop
      // forever for a suspended account.
      if (error.code === "ACCOUNT_NOT_ACTIVE") {
        writeJson(response, 403, { error: "account_not_active" });
      } else {
        writeJson(response, 401, { error: "session_expired" });
      }
    } else if (error instanceof PollingRateLimitError) {
      response.setHeader("retry-after", Math.max(1, Math.ceil(error.retryAfterMs / 1000)));
      writeJson(response, 429, { error: "rate_limited" });
    } else if (error instanceof SteamDataError) {
      writeJson(response, error.httpStatus, { error: error.code });
    } else {
      writeJson(response, 500, { error: "steam_api_unavailable" });
    }
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
