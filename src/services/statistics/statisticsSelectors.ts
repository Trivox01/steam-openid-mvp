import type { Achievement, Game } from "../../types/index.ts";
import { isAchievementUnlocked, knownAchievementRarity } from "../achievementData.ts";

export const RARE_ACHIEVEMENT_THRESHOLD = 10;

export type CompletionBucket = {
  key: "zero" | "low" | "medium" | "high" | "almost" | "complete";
  minimum: number;
  maximum: number;
  count: number;
};

export type UnlockActivityRange = "30d" | "6m" | "12m" | "all";

export type StatisticsInsights = ReturnType<typeof calculateStatisticsInsights>;

export function calculateStatisticsInsights(games: Game[], achievements: Achievement[]) {
  const safeGames = games.filter(validGame);
  const gameById = new Map(safeGames.map((game) => [game.id, game]));
  const uniqueAchievements = dedupeAchievements(achievements)
    .filter((item) => gameById.has(item.gameId));
  const supportedGames = safeGames.filter((game) =>
    game.achievementsSyncStatus !== "unsupported" &&
    (game.totalAchievements > 0 || uniqueAchievements.some((item) => item.gameId === game.id))
  );
  const knownAchievements = uniqueAchievements.filter((item) =>
    item.unlockStateKnown !== false &&
    gameById.get(item.gameId)?.achievementsSyncStatus !== "unsupported"
  );
  const unlocked = knownAchievements.filter(isAchievementUnlocked);
  const rareUnlocked = unlocked.filter((item) => {
    const rarity = knownAchievementRarity(item);
    return validPercentage(rarity) && rarity < RARE_ACHIEVEMENT_THRESHOLD;
  });
  const completionGames = supportedGames.filter((game) =>
    game.totalAchievements > 0 && validPercentage(game.completionPercentage)
  );
  const completedGames = completionGames.filter((game) => game.completionPercentage === 100);
  const almostCompleted = completionGames
    .filter((game) => game.completionPercentage >= 75 && game.completionPercentage < 100)
    .sort((a, b) => b.completionPercentage - a.completionPercentage ||
      remainingAchievements(a) - remainingAchievements(b) ||
      a.name.localeCompare(b.name))
    .slice(0, 6);
  const playedGames = safeGames.filter((game) => validPlaytime(game.playtimeHours) && game.playtimeHours > 0);
  const totalPlaytimeHours = safeGames.reduce(
    (sum, game) => sum + (validPlaytime(game.playtimeHours) ? game.playtimeHours : 0), 0
  );
  const datedUnlocks = unlocked
    .map((achievement) => ({ achievement, timestamp: validDate(achievement.unlockedAt) }))
    .filter((item): item is { achievement: Achievement; timestamp: number } => item.timestamp !== undefined)
    .sort((a, b) => b.timestamp - a.timestamp);
  const rareRanked = rareUnlocked
    .filter((item) => validPercentage(knownAchievementRarity(item)))
    .sort((a, b) => (knownAchievementRarity(a) ?? 101) - (knownAchievementRarity(b) ?? 101));
  const rarityValues = unlocked
    .map(knownAchievementRarity)
    .filter((value): value is number => validPercentage(value));
  const quality = {
    fullySynced: safeGames.filter((game) => game.achievementsSyncStatus === "success").length,
    partial: safeGames.filter((game) => game.achievementsSyncStatus === "partial").length,
    unsupported: safeGames.filter((game) => game.achievementsSyncStatus === "unsupported").length,
    errors: safeGames.filter((game) => game.achievementsSyncStatus === "error").length,
    notSynced: safeGames.filter((game) => !game.achievementsSyncStatus || game.achievementsSyncStatus === "idle").length,
    lastSuccessfulSync: latestDate(safeGames.flatMap((game) =>
      game.achievementsSyncStatus === "success" || game.achievementsSyncStatus === "partial"
        ? [game.achievementsSyncedAt, game.syncedAt]
        : [game.syncedAt]
    ))
  };
  const overallCompletion = knownAchievements.length
    ? unlocked.length / knownAchievements.length * 100
    : undefined;
  const averageRarity = rarityValues.length
    ? rarityValues.reduce((sum, value) => sum + value, 0) / rarityValues.length
    : undefined;
  const efficiencyReliable = totalPlaytimeHours >= 1 && unlocked.length > 0 &&
    quality.partial === 0 && quality.errors === 0 && quality.notSynced === 0;

  return {
    totalGames: safeGames.length,
    gamesWithAchievements: supportedGames.length,
    totalAchievements: knownAchievements.length || undefined,
    unlockedAchievements: knownAchievements.length ? unlocked.length : undefined,
    overallCompletion,
    rareAchievementsUnlocked: rarityValues.length ? rareUnlocked.length : undefined,
    completedGames,
    almostCompleted,
    completionBuckets: completionBuckets(completionGames),
    totalPlaytimeHours,
    playedGamesCount: playedGames.length,
    averagePlaytimeHours: playedGames.length ? totalPlaytimeHours / playedGames.length : undefined,
    mostPlayedGame: [...playedGames].sort((a, b) => b.playtimeHours - a.playtimeHours)[0],
    topPlayedGames: [...playedGames].sort((a, b) => b.playtimeHours - a.playtimeHours).slice(0, 5),
    rarestUnlocked: rareRanked[0],
    topRareUnlocked: rareRanked.slice(0, 5),
    averageUnlockedRarity: averageRarity,
    datedUnlocks,
    completedWithDates: completedGames.map((game) => ({
      game,
      completedAt: latestDate(datedUnlocks
        .filter((item) => item.achievement.gameId === game.id)
        .map((item) => new Date(item.timestamp).toISOString()))
    })).filter((item): item is { game: Game; completedAt: string } => Boolean(item.completedAt))
      .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()),
    achievementsPerHour: efficiencyReliable ? unlocked.length / totalPlaytimeHours : undefined,
    quality,
    gameById
  };
}

export function groupUnlockActivity(
  datedUnlocks: StatisticsInsights["datedUnlocks"],
  range: UnlockActivityRange,
  now = new Date()
) {
  const end = now.getTime();
  const start = rangeStart(range, now);
  const monthly = range !== "30d";
  const groups = new Map<string, number>();
  for (const item of datedUnlocks) {
    if (item.timestamp > end || item.timestamp < start) continue;
    const date = new Date(item.timestamp);
    const key = monthly
      ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
      : date.toISOString().slice(0, 10);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => ({ key, count }));
}

function completionBuckets(games: Game[]): CompletionBucket[] {
  const definitions: Array<Omit<CompletionBucket, "count">> = [
    { key: "zero", minimum: 0, maximum: 0 },
    { key: "low", minimum: 1, maximum: 24 },
    { key: "medium", minimum: 25, maximum: 49 },
    { key: "high", minimum: 50, maximum: 74 },
    { key: "almost", minimum: 75, maximum: 99 },
    { key: "complete", minimum: 100, maximum: 100 }
  ];
  return definitions.map((bucket) => ({
    ...bucket,
    count: games.filter((game) =>
      game.completionPercentage >= bucket.minimum && game.completionPercentage <= bucket.maximum
    ).length
  }));
}

function dedupeAchievements(achievements: Achievement[]) {
  const seen = new Set<string>();
  return achievements.filter((item) => {
    const key = `${item.gameId}:${item.externalId ?? item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function remainingAchievements(game: Game) {
  return Math.max(0, game.totalAchievements - game.unlockedAchievements);
}

function validGame(game: Game) {
  return Boolean(game.id && game.name.trim());
}

function validPlaytime(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function validPercentage(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function validDate(value?: string) {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function latestDate(values: Array<string | undefined>) {
  const timestamps = values.map(validDate).filter((value): value is number => value !== undefined);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : undefined;
}

function rangeStart(range: UnlockActivityRange, now: Date) {
  if (range === "all") return Number.NEGATIVE_INFINITY;
  const start = new Date(now);
  if (range === "30d") start.setUTCDate(start.getUTCDate() - 30);
  if (range === "6m") start.setUTCMonth(start.getUTCMonth() - 6);
  if (range === "12m") start.setUTCMonth(start.getUTCMonth() - 12);
  return start.getTime();
}
