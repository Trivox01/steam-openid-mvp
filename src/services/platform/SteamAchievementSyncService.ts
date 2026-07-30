import type {
  Game,
  SteamAchievementGameSyncResult,
  SteamAchievementSyncResult
} from "../../types";
import type { AchievementRepository, GameRepository, SyncMetadataRepository } from "../../repositories/contracts";
import { SteamIntegrationError } from "../../integrations/steam/TauriSteamGateway";
import type { SteamProvider } from "./SteamProvider";
import { mergeSteamAchievements } from "./SteamAchievementMerge";
import { dedupeSteamGames, isRetryableAchievementError, mapWithConcurrency, summarizeAchievementSync } from "./SteamAchievementSyncCore";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_BATCH_LIMIT = 20;
const unsupportedCodes = new Set(["game_unsupported", "no_achievements"]);
const batchBlockingCodes = new Set([
  "api_key_unavailable", "invalid_api_key", "steam_not_connected",
  "private_library", "rate_limited", "no_internet", "timeout"
]);
const safeSteamErrorCodes = new Set([
  ...unsupportedCodes,
  ...batchBlockingCodes,
  "steam_api_unavailable", "invalid_response", "game_not_owned",
  "steam_not_connected", "session_expired"
]);

export class SteamAchievementSyncError extends Error {
  constructor(readonly code: string) {
    super("Achievement synchronization failed");
    this.name = "SteamAchievementSyncError";
  }
}

export class SteamAchievementSyncService {
  private active?: Promise<SteamAchievementSyncResult>;

  constructor(
    private provider: SteamProvider,
    private games: GameRepository,
    private achievements: AchievementRepository,
    private metadata: SyncMetadataRepository
  ) {}

  sync(options: { gameIds?: string[]; maxGames?: number; onProgress?: (processed: number, total: number) => void } = {}) {
    if (this.active) return this.active;
    const operation = this.performSync(options).finally(() => {
      if (this.active === operation) this.active = undefined;
    });
    this.active = operation;
    return operation;
  }

  syncGame(gameId: string) {
    return this.sync({ gameIds: [gameId], maxGames: 1 }).catch(() => {
      throw new SteamAchievementSyncError("local_storage_failed");
    });
  }

  getLastSync() {
    return this.metadata.getSyncMetadata("steam-achievements");
  }

  private async performSync(options: { gameIds?: string[]; maxGames?: number; onProgress?: (processed: number, total: number) => void }) {
    const [allGames, allAchievements] = await Promise.all([
      this.games.getAllGames(),
      this.achievements.getAchievements()
    ]);
    const requested = new Set(options.gameIds ?? []);
    const limit = Math.max(1, Math.min(options.maxGames ?? DEFAULT_BATCH_LIMIT, DEFAULT_BATCH_LIMIT));
    const eligible = dedupeSteamGames(allGames)
      .filter((game) => game.platform === "steam" && (!requested.size || requested.has(game.id)))
      .sort((a, b) => syncTime(a.achievementsSyncedAt) - syncTime(b.achievementsSyncedAt))
      .slice(0, limit);
    let processed = 0;
    let blockedBy: string | undefined;
    options.onProgress?.(0, eligible.length);
    const results = await mapWithConcurrency(eligible, DEFAULT_CONCURRENCY, async (game) => {
      const result = blockedBy
        ? failedGameResult(game, blockedBy)
        : await this.syncOne(game, allAchievements.filter((item) => item.gameId === game.id));
      if (result.errorCode && batchBlockingCodes.has(result.errorCode)) blockedBy = result.errorCode;
      processed += 1;
      options.onProgress?.(processed, eligible.length);
      return result;
    });
    const syncedAt = new Date().toISOString();
    const summary = summarizeAchievementSync(results, syncedAt);
    const previous = await this.metadata.getSyncMetadata("steam-achievements").catch(() => undefined);
    await this.metadata.saveSyncMetadata({
      source: "steam-achievements",
      status: summary.gamesFailed === summary.gamesRequested && summary.gamesRequested > 0 ? "error" : "success",
      lastSyncedAt: summary.gamesSucceeded > 0 ? syncedAt : previous?.lastSyncedAt
    });
    return summary;
  }

  private async syncOne(game: Game, existing: import("../../types").Achievement[]): Promise<SteamAchievementGameSyncResult> {
    const startedAt = performance.now();
    let stage: "steam" | "sqlite" = "steam";
    try {
      const dto = await this.fetchWithRetry(game.appId);
      logDevelopmentSync(game.appId, "steam", "success", dto.achievements.length, startedAt);
      const merged = mergeSteamAchievements(game.id, existing, dto);
      stage = "sqlite";
      if (merged.changed.length) await this.achievements.saveAchievements(merged.changed);
      const unlocked = merged.complete.filter((item) => item.unlocked ?? Boolean(item.unlockedAt)).length;
      const total = merged.complete.length;
      const completion = total ? Math.round((unlocked / total) * 10_000) / 100 : 0;
      const playerStatsAvailable = !dto.warnings.includes("player_stats_unavailable");
      await this.games.updateGame({
        ...game,
        unlockedAchievements: playerStatsAvailable ? unlocked : game.unlockedAchievements,
        totalAchievements: playerStatsAvailable ? total : game.totalAchievements,
        completionPercentage: playerStatsAvailable ? completion : game.completionPercentage,
        achievementsSyncedAt: dto.fetchedAt,
        achievementsSyncStatus: dto.warnings.length ? "partial" : "success",
        achievementsSyncError: undefined
      });
      logDevelopmentSync(game.appId, "sqlite", "success", dto.achievements.length, startedAt);
      return {
        gameId: game.id, appId: game.appId, gameName: game.name,
        status: dto.warnings.length ? "partial" : "success",
        achievementsFetched: dto.achievements.length,
        inserted: merged.inserted, updated: merged.updated, unchanged: merged.unchanged,
        skipped: merged.skipped, warnings: dto.warnings
      };
    } catch (error) {
      const code = stage === "sqlite" ? "local_storage_failed" : safeErrorCode(error);
      const unsupported = unsupportedCodes.has(code);
      await this.games.updateGame({
        ...game,
        achievementsSyncedAt: new Date().toISOString(),
        achievementsSyncStatus: unsupported ? "unsupported" : "error",
        achievementsSyncError: code
      }).catch(() => undefined);
      logDevelopmentSync(game.appId, stage, "failed", 0, startedAt, code);
      return {
        gameId: game.id, appId: game.appId, gameName: game.name,
        status: unsupported ? "unsupported" : "failed",
        achievementsFetched: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0,
        warnings: [], errorCode: code
      };
    }
  }

  private async fetchWithRetry(appId: string) {
    try {
      return await this.provider.getGameAchievementsWithMetadata(appId);
    } catch (error) {
      const code = error instanceof SteamIntegrationError ? error.code :
        error instanceof Error ? error.message : "unknown";
      if (!isRetryableAchievementError(code)) throw error;
      await delay(750);
      return this.provider.getGameAchievementsWithMetadata(appId);
    }
  }
}

function safeErrorCode(error: unknown) {
  const candidate = error instanceof SteamIntegrationError ? error.code :
    error instanceof SteamAchievementSyncError ? error.code : "unknown";
  return safeSteamErrorCodes.has(candidate) ? candidate : "unknown";
}

function logDevelopmentSync(
  appId: string,
  stage: "steam" | "sqlite",
  outcome: "success" | "failed",
  achievementsReceived: number,
  startedAt: number,
  reason?: string
) {
  if (!import.meta.env.DEV) return;
  const details = {
    appId,
    stage,
    achievementsReceived,
    httpStatus: undefined,
    outcome,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    reason
  };
  if (outcome === "failed") console.warn("[achievement-sync]", details);
  else console.info("[achievement-sync]", details);
}

function syncTime(value?: string) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function failedGameResult(game: Game, errorCode: string): SteamAchievementGameSyncResult {
  return {
    gameId: game.id, appId: game.appId, gameName: game.name, status: "failed",
    achievementsFetched: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0,
    warnings: [], errorCode
  };
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
