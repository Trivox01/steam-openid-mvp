import type {
  Game,
  SteamAchievementGameSyncResult
} from "../../types";
import type { AchievementRepository, GameRepository, SyncMetadataRepository } from "../../repositories/contracts";
import { SteamIntegrationError } from "../../integrations/steam/SteamIntegrationError";
import type { SteamProvider } from "./SteamProvider";
import { mergeSteamAchievements } from "./SteamAchievementMerge";
import { dedupeSteamGames, isRetryableAchievementError, mapWithConcurrency, summarizeAchievementSync } from "./SteamAchievementSyncCore";
import type { AchievementToastEvent } from "../../features/achievement-toasts/AchievementToastCoordinator";
import { trustedUnlockTransitions } from "../../features/achievement-toasts/syncDelta";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_BATCH_LIMIT = 20;
const unsupportedCodes = new Set(["game_unsupported", "no_achievements", "schema_unavailable", "invalid_app_id"]);
const batchBlockingCodes = new Set([
  "api_key_unavailable", "invalid_api_key", "steam_not_connected",
  "private_library", "rate_limited", "no_internet", "timeout"
]);
const safeSteamErrorCodes = new Set([
  ...unsupportedCodes,
  ...batchBlockingCodes,
  "steam_api_unavailable", "invalid_response", "game_not_owned",
  "no_player_stats", "schema_unavailable", "invalid_app_id",
  "steam_not_connected", "session_expired", "backend_not_configured", "network"
]);

export class SteamAchievementSyncError extends Error {
  constructor(readonly code: string) {
    super("Achievement synchronization failed");
    this.name = "SteamAchievementSyncError";
  }
}

export class SteamAchievementSyncService {
  constructor(
    private provider: SteamProvider,
    private games: GameRepository,
    private achievements: AchievementRepository,
    private metadata: SyncMetadataRepository,
    private onUnlocked?: (event: AchievementToastEvent) => void
  ) {}

  sync(options: { gameIds?: string[]; maxGames?: number; onProgress?: (processed: number, total: number) => void; signal?: AbortSignal } = {}) {
    return this.performSync(options);
  }

  syncGame(gameId: string, signal?: AbortSignal) {
    return this.sync({ gameIds: [gameId], maxGames: 1, signal }).catch(() => {
      throw new SteamAchievementSyncError("local_storage_failed");
    });
  }

  getLastSync() {
    return this.metadata.getSyncMetadata("steam-achievements");
  }

  private async performSync(options: { gameIds?: string[]; maxGames?: number; onProgress?: (processed: number, total: number) => void; signal?: AbortSignal }) {
    options.signal?.throwIfAborted();
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
        : await this.syncOne(game, allAchievements.filter((item) => item.gameId === game.id), options.signal);
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

  private async syncOne(game: Game, existing: import("../../types").Achievement[], signal?: AbortSignal): Promise<SteamAchievementGameSyncResult> {
    const startedAt = performance.now();
    let stage: "steam" | "sqlite" = "steam";
    try {
      const dto = await this.fetchWithRetry(game.appId, signal);
      signal?.throwIfAborted();
      logDevelopmentSync(game.appId, game.name, "request", "success", dto.achievements.length, startedAt);
      const merged = mergeSteamAchievements(game.id, existing, dto);
      const unlocks = trustedUnlockTransitions(game.appId, existing, merged.complete);
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
      unlocks.forEach((event) => this.onUnlocked?.(event));
      logDevelopmentSync(game.appId, game.name, "database", "success", dto.achievements.length, startedAt);
      return {
        gameId: game.id, appId: game.appId, gameName: game.name,
        status: dto.warnings.length ? "partial" : "success",
        achievementsFetched: dto.achievements.length,
        inserted: merged.inserted, updated: merged.updated, unchanged: merged.unchanged,
        skipped: merged.skipped, warnings: dto.warnings
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      const code = stage === "sqlite" ? "local_storage_failed" : safeErrorCode(error);
      const unsupported = unsupportedCodes.has(code);
      await this.games.updateGame({
        ...game,
        achievementsSyncedAt: new Date().toISOString(),
        achievementsSyncStatus: unsupported ? "unsupported" : "error",
        achievementsSyncError: code
      }).catch(() => undefined);
      logDevelopmentSync(game.appId, game.name, stage === "sqlite" ? "database" : "request", "failed", 0, startedAt, code);
      return {
        gameId: game.id, appId: game.appId, gameName: game.name,
        status: unsupported ? "unsupported" : "failed",
        achievementsFetched: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0,
        warnings: [], errorCode: code
      };
    }
  }

  private async fetchWithRetry(appId: string, signal?: AbortSignal) {
    try {
      return await this.provider.getGameAchievementsWithMetadata(appId, signal);
    } catch (error) {
      const code = error instanceof SteamIntegrationError ? error.code :
        error instanceof Error ? error.message : "unknown";
      if (!isRetryableAchievementError(code)) throw error;
      await delay(750, signal);
      return this.provider.getGameAchievementsWithMetadata(appId, signal);
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
  gameName: string,
  stage: "request" | "parse" | "database",
  outcome: "success" | "failed",
  achievementsReceived: number,
  startedAt: number,
  reason?: string
) {
  if (!import.meta.env.DEV) return;
  const details = {
    appId,
    gameName,
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

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}
