import { JOURNEY_THRESHOLDS, analyzeAchievementJourney } from "../intelligence/index.ts";
import type { Achievement, Game } from "../types";
import { isAchievementUnlocked, knownAchievementRarity } from "./achievementData.ts";

export type AchievementFilter = "all" | "unlocked" | "locked" | "rare" | "hidden" | "recent";
export type AchievementSort = "default" | "name" | "status" | "rarity" | "date";
export type AchievementView = "grid" | "list";
export type AchievementDensity = "compact" | "comfortable" | "large";

export type AchievementSummary = {
  total: number | null;
  unlocked: number | null;
  locked: number | null;
  completion: number | null;
  rareUnlocked: number;
  rareAvailable: number;
  lastUnlocked?: Achievement;
  lastSyncedAt?: string;
  unknownUnlockStates: number;
};

export function isRareAchievement(achievement: Achievement) {
  const rarity = knownAchievementRarity(achievement);
  return typeof rarity === "number" && rarity > 0 &&
    rarity <= JOURNEY_THRESHOLDS.rareAchievementPercent;
}

export function isValidUnlockDate(achievement: Achievement) {
  if (!isAchievementUnlocked(achievement) || !achievement.unlockedAt) return false;
  return Number.isFinite(new Date(achievement.unlockedAt).getTime());
}

export function selectRecentUnlocks(achievements: Achievement[], limit = 5) {
  return achievements.filter(isValidUnlockDate)
    .sort((a, b) => new Date(b.unlockedAt!).getTime() - new Date(a.unlockedAt!).getTime())
    .slice(0, Math.max(0, limit));
}

export function calculateAchievementSummary(game: Game, achievements: Achievement[]): AchievementSummary {
  const synchronized = Boolean(game.achievementsSyncedAt) &&
    ["success", "partial", "unsupported"].includes(game.achievementsSyncStatus ?? "");
  const known = achievements.filter((item) => item.unlockStateKnown !== false);
  const unlocked = known.filter(isAchievementUnlocked);
  const total = synchronized ? achievements.length : null;
  const unlockedCount = synchronized ? unlocked.length : null;
  return {
    total,
    unlocked: unlockedCount,
    locked: synchronized ? known.length - unlocked.length : null,
    completion: synchronized && known.length === achievements.length && achievements.length
      ? Math.round((unlocked.length / achievements.length) * 10_000) / 100
      : null,
    rareUnlocked: unlocked.filter(isRareAchievement).length,
    rareAvailable: achievements.filter((item) =>
      item.unlockStateKnown !== false && !isAchievementUnlocked(item) && isRareAchievement(item)
    ).length,
    lastUnlocked: selectRecentUnlocks(achievements, 1)[0],
    lastSyncedAt: game.achievementsSyncedAt,
    unknownUnlockStates: achievements.length - known.length
  };
}

export function filterAndSortAchievements(
  achievements: Achievement[],
  options: { query: string; filter: AchievementFilter; sort: AchievementSort }
) {
  const normalizedQuery = options.query.trim().toLocaleLowerCase();
  const sourceOrder = new Map(achievements.map((item, index) => [item.id, index]));
  return achievements.filter((item) => {
    if (normalizedQuery && !`${item.title} ${item.description}`.toLocaleLowerCase().includes(normalizedQuery)) {
      return false;
    }
    if (options.filter === "unlocked") return item.unlockStateKnown !== false && isAchievementUnlocked(item);
    if (options.filter === "locked") return item.unlockStateKnown !== false && !isAchievementUnlocked(item);
    if (options.filter === "rare") return isRareAchievement(item);
    if (options.filter === "hidden") return Boolean(item.isHidden);
    if (options.filter === "recent") return isValidUnlockDate(item);
    return true;
  }).sort((a, b) => {
    if (options.sort === "name") return a.title.localeCompare(b.title);
    if (options.sort === "status") {
      return achievementStateRank(a) - achievementStateRank(b) ||
        (sourceOrder.get(a.id) ?? 0) - (sourceOrder.get(b.id) ?? 0);
    }
    if (options.sort === "rarity") {
      return (knownAchievementRarity(a) ?? Number.POSITIVE_INFINITY) -
        (knownAchievementRarity(b) ?? Number.POSITIVE_INFINITY);
    }
    if (options.sort === "date") {
      return unlockTime(b) - unlockTime(a);
    }
    return (sourceOrder.get(a.id) ?? 0) - (sourceOrder.get(b.id) ?? 0);
  });
}

export function getGameAchievementInsight(game: Game, achievements: Achievement[], now: string) {
  const known = achievements.filter((item) => item.unlockStateKnown !== false);
  const analysis = analyzeAchievementJourney({
    now,
    games: [{
      gameId: game.id,
      title: game.name,
      platform: game.platform,
      playtimeMinutes: Math.max(0, Math.round(game.playtimeHours * 60)),
      unlockedAchievements: game.unlockedAchievements,
      totalAchievements: game.totalAchievements,
      completionPercent: game.completionPercentage,
      lastPlayedAt: game.lastPlayedAt,
      favorite: game.favorite,
      hidden: game.hidden,
      status: game.status,
      rareAchievementsUnlocked: known.filter((item) => isAchievementUnlocked(item) && isRareAchievement(item)).length,
      rareAchievementsAvailable: known.filter(isRareAchievement).length,
      recentlyUnlockedAchievements: selectRecentUnlocks(known, known.length).filter((item) =>
        new Date(now).getTime() - new Date(item.unlockedAt!).getTime() <= 14 * 86_400_000
      ).length
    }],
    achievements: known.map((item) => ({
      achievementId: item.id,
      gameId: game.id,
      title: item.title,
      unlocked: isAchievementUnlocked(item),
      unlockDate: item.unlockedAt,
      globalUnlockPercent: knownAchievementRarity(item),
      progressCurrent: null,
      progressTarget: null,
      hidden: item.isHidden
    }))
  });
  return {
    card: analysis.journeyCards.find((item) =>
      ["oneAchievementLeft", "almostFinished", "rareOpportunity", "recentlyCompleted"].includes(item.type)
    ),
    nextAchievement: analysis.nextAchievement
  };
}

function achievementStateRank(item: Achievement) {
  if (item.unlockStateKnown === false) return 2;
  return isAchievementUnlocked(item) ? 0 : 1;
}

function unlockTime(item: Achievement) {
  if (!isValidUnlockDate(item)) return 0;
  return new Date(item.unlockedAt!).getTime();
}
