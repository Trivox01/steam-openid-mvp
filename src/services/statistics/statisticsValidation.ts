import type { Achievement, Game } from "../../types";
import {
  calculateStatisticsInsights,
  groupUnlockActivity,
  RARE_ACHIEVEMENT_THRESHOLD
} from "./statisticsSelectors.ts";

export function validateStatisticsSelectors() {
  const empty = calculateStatisticsInsights([], []);
  assert(empty.totalGames === 0 && empty.overallCompletion === undefined, "empty library stays unknown");
  assert(empty.mostPlayedGame === undefined && empty.achievementsPerHour === undefined, "empty derived values stay hidden");

  const supported = game("g1", { totalAchievements: 4, unlockedAchievements: 3, completionPercentage: 75, achievementsSyncStatus: "success", playtimeHours: 4 });
  const almostHigher = game("g2", { totalAchievements: 10, unlockedAchievements: 9, completionPercentage: 90, achievementsSyncStatus: "success" });
  const almostTie = game("g3", { totalAchievements: 20, unlockedAchievements: 18, completionPercentage: 90, achievementsSyncStatus: "success" });
  const completed = game("g4", { totalAchievements: 1, unlockedAchievements: 1, completionPercentage: 100, achievementsSyncStatus: "success" });
  const unsupported = game("g5", { totalAchievements: 9, unlockedAchievements: 9, completionPercentage: 100, achievementsSyncStatus: "unsupported" });
  const partial = game("g6", { totalAchievements: 2, unlockedAchievements: 1, completionPercentage: 50, achievementsSyncStatus: "partial" });
  const error = game("g7", { achievementsSyncStatus: "error" });
  const unknown = game("g8", { completionPercentage: null as unknown as number, achievementsSyncStatus: "idle" });
  const negativePlaytime = game("g9", { playtimeHours: -20 });
  const achievements = [
    achievement("a1", "g1", true, 2, "2026-01-05T00:00:00Z"),
    achievement("a2", "g1", true, null, "invalid"),
    achievement("a3", "g1", false, 50),
    achievement("a4", "g1", true, 200),
    achievement("a1-duplicate", "g1", true, 2, "2026-01-05T00:00:00Z", "same"),
    achievement("a5", "g4", true, 8, "2026-02-01T00:00:00Z"),
    achievement("a6", "g5", true, 1),
    { ...achievement("a7", "g6", false, 20), unlockStateKnown: false },
    achievement("orphan", "missing", true, 1)
  ];
  achievements[0].externalId = "same";
  const insights = calculateStatisticsInsights(
    [supported, almostHigher, almostTie, completed, unsupported, partial, error, unknown, negativePlaytime],
    achievements
  );

  assert(insights.totalGames === 9, "all valid library games count");
  assert(insights.gamesWithAchievements === 5, "unsupported and unknown schema games are excluded");
  assert(insights.totalAchievements === 5 && insights.unlockedAchievements === 4, "known achievements are deduplicated");
  assert(insights.overallCompletion === 80, "overall completion uses known achievement states");
  assert(insights.completedGames.length === 1 && insights.completedGames[0].id === "g4", "unsupported 100 percent is not completed");
  assert(insights.almostCompleted.map((item) => item.id).join() === "g2,g3,g1", "almost completed sorting is stable");
  assert(insights.completionBuckets.find((item) => item.key === "complete")?.count === 1, "completion buckets exclude unsupported");
  assert(insights.completionBuckets.find((item) => item.key === "almost")?.count === 3, "75 to 99 bucket");
  assert(insights.rarestUnlocked?.id === "a1", "rarest known unlocked achievement");
  assert(insights.rareAchievementsUnlocked === 2 && RARE_ACHIEVEMENT_THRESHOLD === 10, "null and invalid rarity do not become zero");
  assert(insights.datedUnlocks.length === 2, "missing and invalid dates are excluded");
  assert(insights.totalPlaytimeHours === 4, "negative playtime is excluded");
  assert(insights.mostPlayedGame?.id === "g1" && insights.averagePlaytimeHours === 4, "playtime insights use played games");
  assert(insights.achievementsPerHour === undefined, "partial data suppresses efficiency");
  assert(insights.quality.fullySynced === 4 && insights.quality.partial === 1, "quality counts synced and partial");
  assert(insights.quality.unsupported === 1 && insights.quality.errors === 1 && insights.quality.notSynced === 2, "quality counts unsupported errors and idle");
  const activity = groupUnlockActivity(insights.datedUnlocks, "12m", new Date("2026-03-01T00:00:00Z"));
  assert(activity.length === 2 && activity.reduce((sum, item) => sum + item.count, 0) === 2, "unlock activity groups real dates");
  assert(!("trend" in insights), "no fabricated trend exists");

  const reliable = calculateStatisticsInsights(
    [game("reliable", { totalAchievements: 2, unlockedAchievements: 2, completionPercentage: 100, achievementsSyncStatus: "success", playtimeHours: 2 })],
    [achievement("r1", "reliable", true, 20), achievement("r2", "reliable", true, 30)]
  );
  assert(reliable.achievementsPerHour === 1, "efficiency is available only with reliable inputs");

  const largeGames = Array.from({ length: 500 }, (_, index) => game(`large-${index}`, {
    totalAchievements: 20, unlockedAchievements: 10, completionPercentage: 50, achievementsSyncStatus: "success"
  }));
  const largeAchievements = Array.from({ length: 10_000 }, (_, index) =>
    achievement(`large-a-${index}`, `large-${index % 500}`, index % 2 === 0, 25)
  );
  const large = calculateStatisticsInsights(largeGames, largeAchievements);
  assert(large.totalGames === 500 && large.totalAchievements === 10_000, "large library calculation remains complete");
  return 20;
}

function game(id: string, overrides: Partial<Game> = {}): Game {
  return {
    id, appId: id, platform: "steam", name: `Game ${id}`, coverUrl: "", backgroundUrl: "",
    playtimeHours: 0, totalAchievements: 0, unlockedAchievements: 0,
    completionPercentage: 0, lastPlayedAt: "", achievementsSyncStatus: "idle", ...overrides
  };
}

function achievement(
  id: string,
  gameId: string,
  unlocked: boolean,
  rarity: number | null,
  unlockedAt?: string,
  externalId?: string
): Achievement {
  return {
    id, gameId, title: id, description: "", iconUrl: "", unlocked,
    unlockedAt, rarityPercentage: rarity ?? 0, globalUnlockPercent: rarity ?? undefined,
    points: 0, source: "steam", unlockStateKnown: true, externalId
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Statistics validation failed: ${message}`);
}
