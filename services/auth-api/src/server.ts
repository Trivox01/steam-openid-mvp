import { createServer } from "node:http";
import { AuthTransactionService } from "./auth/authTransactionService.ts";
import { loadAuthApiConfig } from "./config.ts";
import { createRouter } from "./router.ts";
import { PollingRateLimiter } from "./security/pollingRateLimiter.ts";
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
  const tools = new ToolService(storage.toolRepository, storage.toolBadgeRepository, storage.toolCategoryRepository);
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
      tools
    })
  );

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
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await storage.close();
  }

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
