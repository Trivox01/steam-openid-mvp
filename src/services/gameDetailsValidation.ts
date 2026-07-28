import type { Achievement, Game } from "../types";
import {
  calculateAchievementSummary,
  filterAndSortAchievements,
  getGameAchievementInsight,
  isRareAchievement,
  selectRecentUnlocks
} from "./gameDetailsExperience.ts";

export function validateGameDetailsExperience() {
  const game = createGame();
  const achievements = [
    createAchievement("unlocked", { unlocked: true, unlockedAt: "2026-01-03T00:00:00Z", globalUnlockPercent: 2 }),
    createAchievement("undated", { unlocked: true, globalUnlockPercent: 20 }),
    createAchievement("locked", { unlocked: false, globalUnlockPercent: 50 }),
    createAchievement("unknown", { unlockStateKnown: false, globalUnlockPercent: 1 }),
    createAchievement("hidden", { isHidden: true, globalUnlockPercent: undefined }),
    createAchievement("invalid", { unlocked: true, unlockedAt: "not-a-date", globalUnlockPercent: 0 })
  ];
  assert(isRareAchievement(achievements[0]), "known 2% is rare");
  assert(!isRareAchievement(achievements[4]), "unknown rarity is not rare");
  assert(!isRareAchievement(achievements[5]), "zero rarity is not classified as rare");
  assert(selectRecentUnlocks(achievements).length === 1, "only valid dated unlock is recent");

  const summary = calculateAchievementSummary(game, achievements);
  assert(summary.total === 6 && summary.unlocked === 3, "summary counts known unlocks");
  assert(summary.unknownUnlockStates === 1, "unknown state count");
  assert(summary.completion === null, "completion is unknown when player state is partial");

  assert(filterAndSortAchievements(achievements, { query: "locked", filter: "all", sort: "default" }).length === 2, "searches title and description");
  assert(filterAndSortAchievements(achievements, { query: "", filter: "unknown" as never, sort: "default" }).length === 6, "unrecognized filter is safe");
  assert(filterAndSortAchievements(achievements, { query: "", filter: "rare", sort: "rarity" }).map((item) => item.id).join(",") === "unknown,unlocked", "rare sorting uses known percentages");
  assert(filterAndSortAchievements(achievements, { query: "", filter: "recent", sort: "date" })[0]?.id === "unlocked", "recent sort");
  assert(filterAndSortAchievements(achievements, { query: "", filter: "hidden", sort: "default" }).length === 1, "hidden filtering");
  assert(filterAndSortAchievements(achievements, { query: "missing", filter: "all", sort: "default" }).length === 0, "search without results");

  const large = Array.from({ length: 520 }, (_, index) => createAchievement(`item-${index}`));
  assert(filterAndSortAchievements(large, { query: "item-51", filter: "all", sort: "name" }).length > 1, "large collection filtering");
  assert(calculateAchievementSummary({ ...game, achievementsSyncedAt: undefined }, []).total === null, "never synced is unknown");
  const completed = [createAchievement("a", { unlocked: true }), createAchievement("b", { unlocked: true })];
  assert(calculateAchievementSummary({ ...game, achievementsSyncedAt: "2026-01-01" }, completed).completion === 100, "100% completion");
  const oneLeft = [
    createAchievement("a", { unlocked: true }),
    createAchievement("b", { unlocked: false, globalUnlockPercent: 5 })
  ];
  const insight = getGameAchievementInsight({
    ...game, totalAchievements: 2, unlockedAchievements: 1, completionPercentage: 50
  }, oneLeft, "2026-01-05T00:00:00Z");
  assert(insight.card?.type === "oneAchievementLeft", "one achievement left comes from intelligence");
  assert(insight.nextAchievement?.achievementId === "b", "next achievement comes from intelligence");
  return 18;
}

function createGame(): Game {
  return {
    id: "game", appId: "10", platform: "steam", name: "Game", coverUrl: "", backgroundUrl: "",
    playtimeHours: 10, totalAchievements: 6, unlockedAchievements: 3, completionPercentage: 50,
    lastPlayedAt: "", achievementsSyncedAt: "2026-01-04T00:00:00Z", achievementsSyncStatus: "partial"
  };
}

function createAchievement(id: string, overrides: Partial<Achievement> = {}): Achievement {
  return {
    id, gameId: "game", title: id, description: `${id} description`, iconUrl: "",
    rarityPercentage: 0, points: 0, source: "steam", externalId: id,
    unlocked: false, unlockStateKnown: true, ...overrides
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Game Details validation failed: ${message}`);
}
