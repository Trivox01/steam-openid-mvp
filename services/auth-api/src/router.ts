import type { RequestListener } from "node:http";
import { HEALTH_PATH, writeHealthResponse } from "./routes/health.ts";
import { READINESS_PATH, writeReadinessResponse } from "./routes/readiness.ts";
import {
  getSecureTransportDiagnostic,
  validatePublicAuthRequest
} from "./security/requestSecurity.ts";
import {
  createSteamAuthRouteHandler,
  type SteamAuthRouteDependencies
} from "./routes/steamAuth.ts";
import {
  applyCorsHeaders,
  handleCorsPreflight,
  safeCorsDiagnostic
} from "./security/cors.ts";
import {
  handleMeAuthorization,
  ME_AUTHORIZATION_PATH
} from "./routes/meAuthorization.ts";
import { handleAdminBadges, isAdminBadgePath } from "./routes/adminBadges.ts";
import type { BadgeService } from "./badges/badgeService.ts";
import type { BadgeAssetStorage } from "./badges/badgeAssetStorage.ts";
import {
  handleAdminBadgeAssignments,
  isAdminBadgeAssignmentPath
} from "./routes/adminBadgeAssignments.ts";
import type { BadgeAssignmentService } from "./badgeAssignments/badgeAssignmentService.ts";
import {
  ASSIGNMENT_USERS_PATH,
  handleAdminAssignmentUsers
} from "./routes/adminAssignmentUsers.ts";
import {
  handlePublicBadges,
  isPublicBadgePath
} from "./routes/publicBadges.ts";
import { handleAdminUsers, isAdminUserPath } from "./routes/adminUsers.ts";
import type { UserService } from "./users/userService.ts";
import {
  handleSteamData,
  isSteamDataPath
} from "./routes/steamData.ts";
import type { SteamDataClient } from "./steam/steamDataClient.ts";
import { PollingRateLimiter } from "./security/pollingRateLimiter.ts";
import { handleTools, isToolPath } from "./routes/tools.ts";
import type { ToolService } from "./tools/toolService.ts";
import type { ToolAssetStorages } from "./tools/toolAssetStorage.ts";
import type { ToolRatingService } from "./tools/toolRatingService.ts";
import type { ToolReviewModerationService, ToolReviewInteractionService, ToolReviewService } from "./tools/toolReviewService.ts";
import type { ToolAnalyticsService } from "./tools/toolAnalyticsService.ts";

type RouterDependencies = SteamAuthRouteDependencies & {
  badges?: BadgeService;
  badgeAssets?: BadgeAssetStorage;
  badgeAssignments?: BadgeAssignmentService;
  users?: UserService;
  steamData?: SteamDataClient;
  steamDataRateLimiter?: PollingRateLimiter;
  tools?: ToolService;
  toolAssets?: ToolAssetStorages;
  toolRatings?: ToolRatingService;
  toolRatingRateLimiter?: PollingRateLimiter;
  toolReviews?: ToolReviewService;
  toolReviewModeration?: ToolReviewModerationService;
  toolReviewInteractions?: ToolReviewInteractionService;
  toolReviewRateLimiter?: PollingRateLimiter;
  toolReportRateLimiter?: PollingRateLimiter;
  toolHelpfulRateLimiter?: PollingRateLimiter;
  toolReplyRateLimiter?: PollingRateLimiter;
  toolAnalytics?: ToolAnalyticsService;
  toolEventRateLimiter?: PollingRateLimiter;
  toolFavoriteRateLimiter?: PollingRateLimiter;
};

export function createRouter(
  steamAuthDependencies?: RouterDependencies
): RequestListener {
  const handleSteamAuth = steamAuthDependencies
    ? createSteamAuthRouteHandler(steamAuthDependencies)
    : undefined;
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === HEALTH_PATH) {
      writeHealthResponse(response);
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === READINESS_PATH &&
      steamAuthDependencies
    ) {
      await writeReadinessResponse(
        response,
        steamAuthDependencies.transactions.repository
      );
      return;
    }
    const isSteamAuthRoute =
      Boolean(handleSteamAuth) && url.pathname.startsWith("/v1/auth/steam/");
    const isAuthorizationRoute =
      url.pathname === ME_AUTHORIZATION_PATH &&
      Boolean(steamAuthDependencies?.authorization) &&
      Boolean(steamAuthDependencies?.sessions);
    const isBadgeRoute = isAdminBadgePath(url.pathname) &&
      Boolean(steamAuthDependencies?.badges) &&
      Boolean(steamAuthDependencies?.badgeAssets) &&
      Boolean(steamAuthDependencies?.authorization) &&
      Boolean(steamAuthDependencies?.sessions);
    const isBadgeAssignmentRoute =
      isAdminBadgeAssignmentPath(url.pathname) &&
      Boolean(steamAuthDependencies?.badgeAssignments) &&
      Boolean(steamAuthDependencies?.authorization) &&
      Boolean(steamAuthDependencies?.sessions);
    const isAssignmentUserRoute =
      url.pathname === ASSIGNMENT_USERS_PATH &&
      Boolean(steamAuthDependencies?.authorization) &&
      Boolean(steamAuthDependencies?.sessions);
    const isPublicBadgeRoute =
      isPublicBadgePath(url.pathname) &&
      Boolean(steamAuthDependencies?.badges) &&
      Boolean(steamAuthDependencies?.badgeAssets) &&
      Boolean(steamAuthDependencies?.badgeAssignments) &&
      Boolean(steamAuthDependencies?.sessions);
    const isUserRoute =
      isAdminUserPath(url.pathname) &&
      Boolean(steamAuthDependencies?.users) &&
      Boolean(steamAuthDependencies?.authorization) &&
      Boolean(steamAuthDependencies?.sessions);
    const isSteamDataRoute =
      isSteamDataPath(url.pathname) &&
      Boolean(steamAuthDependencies?.steamData) &&
      Boolean(steamAuthDependencies?.steamDataRateLimiter) &&
      Boolean(steamAuthDependencies?.sessions);
    const isToolsRoute = isToolPath(url.pathname) && Boolean(steamAuthDependencies?.tools) && Boolean(steamAuthDependencies?.toolAssets) && Boolean(steamAuthDependencies?.toolRatings) && Boolean(steamAuthDependencies?.toolRatingRateLimiter) && Boolean(steamAuthDependencies?.toolReviews) && Boolean(steamAuthDependencies?.toolReviewModeration) && Boolean(steamAuthDependencies?.toolReviewInteractions) && Boolean(steamAuthDependencies?.toolReviewRateLimiter) && Boolean(steamAuthDependencies?.toolReportRateLimiter) && Boolean(steamAuthDependencies?.toolHelpfulRateLimiter) && Boolean(steamAuthDependencies?.toolReplyRateLimiter) && Boolean(steamAuthDependencies?.toolAnalytics) && Boolean(steamAuthDependencies?.toolEventRateLimiter) && Boolean(steamAuthDependencies?.toolFavoriteRateLimiter) && Boolean(steamAuthDependencies?.badges) &&
      Boolean(steamAuthDependencies?.authorization) && Boolean(steamAuthDependencies?.sessions);
    if (
      isSteamAuthRoute ||
      isAuthorizationRoute ||
      isBadgeRoute ||
      isBadgeAssignmentRoute ||
      isAssignmentUserRoute ||
      isPublicBadgeRoute ||
      isUserRoute ||
      isSteamDataRoute ||
      isToolsRoute
    ) {
      const cors = applyCorsHeaders(
        request,
        response,
        steamAuthDependencies!.config.allowedOrigins
      );
      response.once("finish", () => {
        process.stdout.write(
          `${JSON.stringify(safeCorsDiagnostic(
            request,
            url.pathname,
            cors,
            response.statusCode
          ))}\n`
        );
      });
      if (handleCorsPreflight(request, response, cors)) return;
      try {
        validatePublicAuthRequest(request, steamAuthDependencies!.config);
      } catch {
        process.stdout.write(
          `${JSON.stringify(getSecureTransportDiagnostic(
            request,
            steamAuthDependencies!.config,
            url.pathname
          ))}\n`
        );
        const body = JSON.stringify({ error: "secure_transport_required" });
        response.writeHead(400, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "content-length": Buffer.byteLength(body)
        });
        response.end(body);
        return;
      }
    }
    if (
      isToolsRoute &&
      await handleTools(request, response, url, {
        tools: steamAuthDependencies!.tools!,
        authorization: steamAuthDependencies!.authorization!,
        sessions: steamAuthDependencies!.sessions!,
        assets: steamAuthDependencies!.badges!.repository,
        toolAssets: steamAuthDependencies!.toolAssets!
        ,ratings:steamAuthDependencies!.toolRatings!,ratingRateLimiter:steamAuthDependencies!.toolRatingRateLimiter!
        ,reviews:steamAuthDependencies!.toolReviews!,moderation:steamAuthDependencies!.toolReviewModeration!,interactions:steamAuthDependencies!.toolReviewInteractions!,reviewRateLimiter:steamAuthDependencies!.toolReviewRateLimiter!,reportRateLimiter:steamAuthDependencies!.toolReportRateLimiter!,helpfulRateLimiter:steamAuthDependencies!.toolHelpfulRateLimiter!,replyRateLimiter:steamAuthDependencies!.toolReplyRateLimiter!
        ,analytics:steamAuthDependencies!.toolAnalytics!,eventRateLimiter:steamAuthDependencies!.toolEventRateLimiter!,favoriteRateLimiter:steamAuthDependencies!.toolFavoriteRateLimiter!
      })
    ) return;
    if (
      isSteamDataRoute &&
      await handleSteamData(request, response, url, {
        sessions: steamAuthDependencies!.sessions!,
        steam: steamAuthDependencies!.steamData!,
        rateLimiter: steamAuthDependencies!.steamDataRateLimiter!
      })
    ) return;
    if (
      isUserRoute &&
      await handleAdminUsers(request, response, url, {
        users: steamAuthDependencies!.users!,
        authorization: steamAuthDependencies!.authorization!,
        sessions: steamAuthDependencies!.sessions!
      })
    ) return;
    if (
      isPublicBadgeRoute &&
      await handlePublicBadges(request, response, url, {
        assignments: steamAuthDependencies!.badgeAssignments!,
        badges: steamAuthDependencies!.badges!.repository,
        assets: steamAuthDependencies!.badgeAssets!,
        sessions: steamAuthDependencies!.sessions!
      })
    ) return;
    if (
      isAuthorizationRoute &&
      await handleMeAuthorization(request, response, {
        authorization: steamAuthDependencies!.authorization!,
        sessions: steamAuthDependencies!.sessions!
      })
    ) return;
    if (isBadgeRoute && await handleAdminBadges(request, response, url, {
      badges: steamAuthDependencies!.badges!,
      assets: steamAuthDependencies!.badgeAssets!,
      authorization: steamAuthDependencies!.authorization!,
      sessions: steamAuthDependencies!.sessions!
    })) return;
    if (
      isAssignmentUserRoute &&
      await handleAdminAssignmentUsers(request, response, url, {
        authorization: steamAuthDependencies!.authorization!,
        sessions: steamAuthDependencies!.sessions!
      })
    ) return;
    if (
      isBadgeAssignmentRoute &&
      await handleAdminBadgeAssignments(request, response, url, {
        assignments: steamAuthDependencies!.badgeAssignments!,
        authorization: steamAuthDependencies!.authorization!,
        sessions: steamAuthDependencies!.sessions!
      })
    ) return;
    if (handleSteamAuth && await handleSteamAuth(request, response, url)) return;
    const body = JSON.stringify({ error: "not_found" });
    response.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body)
    });
    response.end(body);
  };
}
