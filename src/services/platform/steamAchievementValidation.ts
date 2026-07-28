import type { Achievement, SteamAchievementGameSyncResult, SteamGameAchievementsDto } from "../../types";
import { mergeSteamAchievements } from "./SteamAchievementMerge.ts";
import {
  achievementFailureCounts,
  isRetryableAchievementError,
  mapWithConcurrency,
  retryableAchievementGameIds,
  summarizeAchievementSync
} from "./SteamAchievementSyncCore.ts";
import { toAchievementJourneyInput } from "../intelligence/achievementJourneyAdapter.ts";

export async function validateSteamAchievementSync() {
  const existing = {
    id: "local-id", gameId: "game-1", externalId: "ACH_ONE", source: "steam",
    title: "Old", description: "Old description", iconUrl: "old.png",
    unlockedAt: "2024-01-01T00:00:00Z", rarityPercentage: 5, globalUnlockPercent: 5,
    points: 0, isHidden: false, unlockStateKnown: true, personalNote: "keep me"
  } satisfies Achievement & { personalNote: string };
  const dto = fixture([
    achievement("ACH_TWO", "Second", false, 50),
    achievement("ACH_ONE", "First", true, 2),
    achievement("ACH_ONE", "Duplicate", false, 1)
  ]);
  const merged = mergeSteamAchievements("game-1", [existing], dto);
  assert(merged.inserted === 1 && merged.updated === 1 && merged.skipped === 1, "upsert counters");
  const updated = merged.complete.find((item) => item.externalId === "ACH_ONE") as Achievement & { personalNote?: string };
  assert(updated.id === "local-id", "existing id is reused");
  assert(updated.personalNote === "keep me", "user-owned fields are preserved");

  const second = mergeSteamAchievements("game-1", merged.complete, dto);
  assert(second.unchanged === 2 && second.changed.length === 0, "unchanged sync does not rewrite");
  assert(second.complete.length === 2, "duplicate apiName is not duplicated");

  const partial = mergeSteamAchievements("game-1", [existing], {
    ...fixture([achievement("ACH_ONE", "First", false, undefined)]),
    warnings: ["player_stats_unavailable", "global_percentages_unavailable"]
  });
  assert(partial.complete[0].unlockedAt === existing.unlockedAt, "partial player data preserves unlock");
  assert(partial.complete[0].globalUnlockPercent === 5, "partial global data preserves rarity");
  assert(partial.complete[0].unlockStateKnown === true, "known state remains known");

  const newPartial = mergeSteamAchievements("game-2", [], {
    ...fixture([achievement("ACH_NEW", "New", false, undefined)]),
    warnings: ["player_stats_unavailable"]
  });
  assert(newPartial.complete[0].unlockStateKnown === false, "missing player state is explicit");

  const summaries: SteamAchievementGameSyncResult[] = [
    gameResult("success", 2, 1, 1),
    gameResult("partial", 1, 1, 0),
    gameResult("unsupported", 0, 0, 0),
    gameResult("failed", 0, 0, 0)
  ];
  const summary = summarizeAchievementSync(summaries, "2026-01-01T00:00:00Z");
  assert(summary.gamesRequested === 4 && summary.gamesSucceeded === 2, "game counters");
  assert(summary.gamesUnsupported === 1 && summary.gamesFailed === 1 && summary.partial, "partial counters");
  const retryCandidates = [
    { ...gameResult("failed", 0, 0, 0), gameId: "temporary", errorCode: "timeout" },
    { ...gameResult("failed", 0, 0, 0), gameId: "private", errorCode: "private_library" },
    { ...gameResult("unsupported", 0, 0, 0), gameId: "unsupported", errorCode: "no_achievements" },
    { ...gameResult("success", 1, 0, 0), gameId: "success" }
  ];
  assert(retryableAchievementGameIds(retryCandidates).join() === "temporary", "retry targets only temporary failures");
  assert(isRetryableAchievementError("rate_limited") && !isRetryableAchievementError("no_achievements"), "temporary and permanent errors differ");
  const failures = achievementFailureCounts(retryCandidates);
  assert(failures.timeout === 1 && failures.private_library === 1 && failures.no_achievements === 1, "failure categories are counted");

  let active = 0, peak = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
    active += 1; peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    return item;
  });
  assert(peak <= 2, "concurrency limit");
  const intelligence = toAchievementJourneyInput({
    profile: { id: "p", displayName: "Player", avatarUrl: "", level: 0 },
    games: [{
      id: "game-1", appId: "10", platform: "steam", name: "Fixture", coverUrl: "", backgroundUrl: "",
      playtimeHours: 1, totalAchievements: 2, unlockedAchievements: 1, completionPercentage: 50, lastPlayedAt: ""
    }],
    achievements: [
      { ...existing, unlocked: true, globalUnlockPercent: 2 },
      { ...newPartial.complete[0], gameId: "game-1" }
    ],
    activity: [],
    analyzedAt: "2026-01-01T00:00:00Z",
    capabilities: { weeklyPlaytime: false, achievementProgress: false }
  });
  assert(intelligence.achievements?.length === 1, "unknown player state is excluded from intelligence");
  assert(intelligence.achievements?.[0].globalUnlockPercent === 2, "real global rarity reaches intelligence");
  assert(intelligence.games?.[0].rareAchievementsUnlocked === 1, "rare unlock count reaches intelligence");
  return 21;
}

function fixture(achievements: SteamGameAchievementsDto["achievements"]): SteamGameAchievementsDto {
  return { appId: 10, gameName: "Fixture", achievements, warnings: [], fetchedAt: "2026-01-01T00:00:00Z" };
}

function achievement(apiName: string, displayName: string, unlocked: boolean, percent?: number) {
  return { apiName, displayName, description: "", hidden: false, iconUrl: "", lockedIconUrl: "", unlocked, unlockedAt: unlocked ? "2025-01-01T00:00:00Z" : undefined, globalUnlockPercent: percent };
}

function gameResult(status: SteamAchievementGameSyncResult["status"], fetched: number, inserted: number, updated: number): SteamAchievementGameSyncResult {
  return { gameId: status, appId: status, gameName: status, status, achievementsFetched: fetched, inserted, updated, unchanged: 0, skipped: 0, warnings: status === "partial" ? ["partial"] : [] };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Steam achievement validation failed: ${message}`);
}
