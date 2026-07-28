import type { Game, SteamAchievementGameSyncResult, SteamAchievementSyncResult } from "../../types";

const RETRYABLE_ACHIEVEMENT_ERRORS = new Set([
  "steam_api_unavailable",
  "rate_limited",
  "no_internet",
  "timeout",
  "invalid_response"
]);

export function summarizeAchievementSync(games: SteamAchievementGameSyncResult[], syncedAt: string): SteamAchievementSyncResult {
  const warnings = [...new Set(games.flatMap((game) => game.warnings))];
  return {
    gamesRequested: games.length,
    gamesSucceeded: games.filter((game) => game.status === "success" || game.status === "partial").length,
    gamesUnsupported: games.filter((game) => game.status === "unsupported").length,
    gamesFailed: games.filter((game) => game.status === "failed").length,
    achievementsFetched: games.reduce((sum, game) => sum + game.achievementsFetched, 0),
    inserted: games.reduce((sum, game) => sum + game.inserted, 0),
    updated: games.reduce((sum, game) => sum + game.updated, 0),
    unchanged: games.reduce((sum, game) => sum + game.unchanged, 0),
    skipped: games.reduce((sum, game) => sum + game.skipped, 0),
    partial: games.some((game) => game.status !== "success"),
    syncedAt, warnings, games
  };
}

export function dedupeSteamGames(games: Game[]) {
  const seen = new Set<string>();
  return games.filter((game) => {
    const key = `${game.platform}:${game.appId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isRetryableAchievementError(code?: string) {
  return Boolean(code && RETRYABLE_ACHIEVEMENT_ERRORS.has(code));
}

export function retryableAchievementGameIds(games: SteamAchievementGameSyncResult[]) {
  return games
    .filter((game) => game.status === "failed" && isRetryableAchievementError(game.errorCode))
    .map((game) => game.gameId);
}

export function achievementFailureCounts(games: SteamAchievementGameSyncResult[]) {
  return games.reduce<Record<string, number>>((counts, game) => {
    if (game.errorCode) counts[game.errorCode] = (counts[game.errorCode] ?? 0) + 1;
    return counts;
  }, {});
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}
