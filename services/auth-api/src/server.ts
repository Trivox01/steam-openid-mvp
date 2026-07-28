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
  const sessions = new SessionTokenService(
    config.sessionSecret,
    storage.authorizationRepository
  );
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
      rateLimiter: new PollingRateLimiter(),
      logger: jsonSafeLogger,
      authorization,
      sessions
    })
  );

  server.listen(config.port, "0.0.0.0", () => {
    process.stdout.write(
      JSON.stringify({
        event: "auth_api_started",
        port: config.port,
        storageDriver: config.storageDriver,
        trustProxy: config.trustProxy,
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
