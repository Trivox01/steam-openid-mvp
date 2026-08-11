import { createServer } from "node:http";
import { AuthTransactionService } from "./auth/authTransactionService.ts";
import { loadAuthApiConfig } from "./config.ts";
import { createRouter } from "./router.ts";
import { PollingRateLimiter } from "./security/pollingRateLimiter.ts";
import { sanitizeLogCode } from "./security/redaction.ts";
import { jsonSafeLogger } from "./security/safeLogger.ts";
import { SteamOpenIdVerifier } from "./steam/openIdVerifier.ts";
import { SteamOpenIdHttpClient } from "./steam/steamOpenIdHttpClient.ts";
import { startStorageCleanup } from "./storage/cleanupJob.ts";
import { MigrationError } from "./storage/postgres/migrationRunner.ts";
import { initializeStorage } from "./storage/storageFactory.ts";
import { AuthorizationService } from "./authorization/authorizationService.ts";
import { SessionTokenService } from "./authorization/sessionTokenService.ts";
import { BadgeService } from "./badges/badgeService.ts";
import { createBadgeAssetStorage } from "./badges/badgeAssetStorageFactory.ts";
import { BadgeAssignmentService } from "./badgeAssignments/badgeAssignmentService.ts";
import { UserService } from "./users/userService.ts";
import { SteamUserProfileClient } from "./steam/steamUserProfileClient.ts";
import { SteamDataClient } from "./steam/steamDataClient.ts";
import { ToolService } from "./tools/toolService.ts";
import { createToolAssetStorages } from "./tools/toolAssetStorage.ts";
import { ToolRatingService } from "./tools/toolRatingService.ts";
import { ToolReviewService, ToolReviewModerationService, ToolReviewInteractionService } from "./tools/toolReviewService.ts";
import { ToolAnalyticsService } from "./tools/toolAnalyticsService.ts";

void main().catch((error: unknown) => {
  const migration = error instanceof MigrationError ? error : undefined;
  process.stderr.write(JSON.stringify({
    event: "auth_api_startup_failed",
    errorCode: migration?.code ??
      (error instanceof Error ? error.message : "startup_failed"),
    ...(migration
      ? {
          migrationVersion: migration.migrationVersion,
          migrationName: migration.migrationName
        }
      : {})
  }) + "\n");
  process.exitCode = 1;
});

async function main() {
  const config = loadAuthApiConfig();
  const storage = await initializeStorage(config);
  const transactions = new AuthTransactionService(storage.repository);
  const authorization = new AuthorizationService(storage.authorizationRepository);
  const steamProfiles = config.steamWebApiKey
    ? new SteamUserProfileClient(config.steamWebApiKey, fetch, {
        write(entry) {
          process.stdout.write(JSON.stringify(entry) + "\n");
        }
      })
    : undefined;
  const steamData = new SteamDataClient(
    config.steamWebApiKey,
    fetch,
    { write(entry) { process.stdout.write(JSON.stringify(entry) + "\n"); } }
  );
  const sessions = new SessionTokenService(
    config.sessionSecret,
    storage.authorizationRepository,
    Date.now,
    steamProfiles
      ? async (steamId64) => {
          const profile = await steamProfiles.get(steamId64);
          if (profile) {
            await storage.userRepository.updateSteamProfile(steamId64, profile);
            process.stdout.write(JSON.stringify({
              event: "steam_profile_persisted",
              nicknameStored: true,
              avatarStored: Boolean(profile.avatarUrl)
            }) + "\n");
          }
        }
      : undefined
  );
  const badges = new BadgeService(storage.badgeRepository);
  const badgeAssignments = new BadgeAssignmentService(
    storage.badgeAssignmentRepository
  );
  const users = new UserService(
    storage.userRepository,
    storage.authorizationRepository
  );
  const badgeAssets = createBadgeAssetStorage(config);
  const toolAssets = createToolAssetStorages(config);
  const toolAnalytics = new ToolAnalyticsService(storage.toolAnalyticsRepository, storage.toolFavoriteRepository, { ratings: storage.toolRatingRepository, reviews: storage.toolReviewRepository, tools: storage.toolRepository });
  const tools = new ToolService(storage.toolRepository, storage.toolBadgeRepository, storage.toolCategoryRepository, storage.badgeRepository, toolAssets.routed, toolAnalytics);
  const toolRatings = new ToolRatingService(storage.toolRatingRepository);
  const toolReviews = new ToolReviewService(storage.toolReviewRepository, storage.toolReviewReportRepository);
  const toolReviewModeration = new ToolReviewModerationService(storage.toolReviewRepository, storage.toolReviewReportRepository);
  const toolReviewInteractions = new ToolReviewInteractionService(storage.toolReviewRepository, storage.toolReviewHelpfulRepository, storage.toolReviewReplyRepository);
  const analyticsCleanup = setInterval(() => void toolAnalytics.purgeExpiredEvents(), 12 * 60 * 60 * 1000);
  analyticsCleanup.unref();
  const bootstrapResult = await authorization.bootstrapOwner(
    config.bootstrapOwnerSteamId64
  );
  const verifier = new SteamOpenIdVerifier(new SteamOpenIdHttpClient(), {
    realm: config.openIdRealm
  });
  const cleanup = startStorageCleanup(storage.repository, {
    onError() {
      jsonSafeLogger.write({
        event: "steam_auth_storage_cleanup",
        requestId: "scheduled",
        endpoint: "storage_cleanup",
        status: "failure",
        durationMs: 0,
        errorCode: "database_unavailable"
      });
    }
  });
  await cleanup.run();

  const server = createServer(
    createRouter({
      config,
      transactions,
      verifier,
      rateLimiter: new PollingRateLimiter({ minimumIntervalMs: 3_000, windowMs: 60_000, maxRequests: 24 }),
      startRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 8 }),
      callbackRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 20 }),
      logger: jsonSafeLogger,
      authorization,
      sessions,
      badges,
      badgeAssignments,
      badgeAssets,
      users,
      steamData,
      steamDataRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 1_000 }),
      tools,
      toolRatings,
      toolRatingRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 750, windowMs: 60_000, maxRequests: 12 }),
      toolReviews,
      toolReviewModeration,
      toolReviewInteractions,
      toolReviewRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 750, windowMs: 60_000, maxRequests: 12 }),
      toolReportRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 750, windowMs: 60_000, maxRequests: 8 }),
      toolHelpfulRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 400, windowMs: 60_000, maxRequests: 20 }),
      toolReplyRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 1_500, windowMs: 60_000, maxRequests: 6 }),
      toolAnalytics,
      toolEventRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 800, windowMs: 60_000, maxRequests: 30 }),
      toolFavoriteRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 500, windowMs: 60_000, maxRequests: 30 }),
      toolAssets
    })
  );

  // Bounded so a slow or stalled peer cannot hold a connection open forever.
  // Sized above the largest legitimate request: a 2 MB asset upload and a full
  // Steam OpenID round trip both finish well inside the request timeout.
  // Node requires headersTimeout > keepAliveTimeout.
  server.keepAliveTimeout = 61_000;
  server.headersTimeout = 65_000;
  server.requestTimeout = 120_000;

  server.listen(config.port, "0.0.0.0", () => {
    process.stdout.write(
      JSON.stringify({
        event: "auth_api_started",
        port: config.port,
        storageDriver: config.storageDriver,
        badgeStorageDriver: config.badgeStorageDriver,
        trustProxy: config.trustProxy,
        steamWebApiKeyConfigured: Boolean(config.steamWebApiKey),
        bootstrapOwner: bootstrapResult
      }) + "\n"
    );
  });

  async function shutdown() {
    cleanup.stop();
    clearInterval(analyticsCleanup);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await storage.close();
  }

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  // Safety net only. The router's try/catch is the primary protection for request
  // handling; anything reaching this level means the process state is no longer
  // trustworthy, so it is logged sanitized and the process stops rather than
  // continuing to serve traffic in an unknown state.
  process.once("uncaughtException", (error: unknown) => {
    void fatal("uncaught_exception", error);
  });
  process.once("unhandledRejection", (reason: unknown) => {
    void fatal("unhandled_rejection", reason);
  });

  async function fatal(event: string, error: unknown) {
    jsonSafeLogger.write({
      event,
      requestId: "process",
      endpoint: "process_safety_net",
      status: "failure",
      durationMs: 0,
      errorCode: sanitizeLogCode(
        error instanceof Error ? error.name.toLowerCase() : typeof error
      )
    });
    try {
      await shutdown();
    } finally {
      process.exit(1);
    }
  }
}
