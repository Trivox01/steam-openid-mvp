import { analyzeAchievementJourney } from "./engine.ts";
import type { GameIntelligenceInput, UserActivityInput } from "./types.ts";

const NOW = "2026-07-27T12:00:00.000Z";

export function runIntelligenceValidation() {
  const cases: Array<[string, () => void]> = [
    ["empty input", validateEmpty],
    ["game without achievements", validateNoAchievements],
    ["one achievement left", validateOneLeft],
    ["completed and hidden games", validateExcludedGames],
    ["invalid and missing data", validateInvalidData],
    ["completionist DNA", validateCompletionist],
    ["collector DNA", validateCollector],
    ["rare hunter DNA", validateRareHunter],
    ["insufficient DNA data", validateInsufficientData],
    ["empty weekly activity", validateEmptyWeekly],
    ["fourteen day comparison", validateFourteenDays]
  ];
  for (const [name, validation] of cases) {
    try {
      validation();
    } catch (error) {
      throw new Error(`Intelligence validation failed: ${name}`, { cause: error });
    }
  }
  return { passed: cases.length, cases: cases.map(([name]) => name) };
}

function validateEmpty() {
  const result = analyzeAchievementJourney({ now: NOW });
  assert(result.rankedGames.length === 0, "ranked games should be empty");
  assert(result.nextAchievement === null, "next achievement should be null");
}

function validateNoAchievements() {
  const result = analyzeAchievementJourney({
    now: NOW,
    games: [game("no-achievements", { totalAchievements: 0, playtimeMinutes: 120 })]
  });
  assert(result.journeyCards[0]?.type === "noAchievementsYet", "no achievements card expected");
  assert(Number.isFinite(result.rankedGames[0]?.score), "score must be finite");
}

function validateOneLeft() {
  const result = analyzeAchievementJourney({
    now: NOW,
    games: [game("one-left", { totalAchievements: 20, unlockedAchievements: 19, completionPercent: 95 })]
  });
  assert(result.journeyCards[0]?.type === "oneAchievementLeft", "one-left card expected");
  assert(result.rankedGames[0]?.breakdown.remainingAchievements === 25, "remaining weight expected");
}

function validateExcludedGames() {
  const result = analyzeAchievementJourney({
    now: NOW,
    games: [
      game("completed", { completionPercent: 100, status: "completed" }),
      game("hidden", { hidden: true })
    ]
  });
  assert(result.rankedGames.every((item) => item.eligible === false), "completed and hidden must be ineligible");
  assert(result.journeyCards.every((card) => card.gameId !== "hidden"), "hidden card must be excluded");
  assert(result.journeyCards.some((card) => card.type === "recentlyCompleted"), "recently completed card expected");
}

function validateInvalidData() {
  const result = analyzeAchievementJourney({
    now: NOW,
    games: [
      game("invalid-date", { lastPlayedAt: "not-a-date", completionPercent: Number.NaN }),
      { gameId: "", title: null }
    ],
    achievements: [{ achievementId: "orphan", gameId: "missing", unlocked: false }]
  });
  assert(Number.isFinite(result.rankedGames[0]?.score), "invalid numbers must normalize without NaN");
  assert(result.diagnostics.ignoredInvalidGames.length === 1, "invalid game diagnostic expected");
  assert(result.diagnostics.ignoredInvalidAchievements.length === 1, "invalid achievement diagnostic expected");
}

function validateCompletionist() {
  const result = analyzeAchievementJourney({
    now: NOW,
    games: Array.from({ length: 4 }, (_, index) =>
      game(`complete-${index}`, { completionPercent: index < 2 ? 100 : 85, status: index < 2 ? "completed" : "playing" })
    )
  });
  assert(result.achievementDna.primaryType === "completionist", "completionist expected");
}

function validateCollector() {
  const result = analyzeAchievementJourney({
    now: NOW,
    games: Array.from({ length: 14 }, (_, index) =>
      game(`collection-${index}`, { playtimeMinutes: index < 3 ? 60 : 0, completionPercent: 0, status: "backlog" })
    )
  });
  assert(result.achievementDna.primaryType === "collector", "collector expected");
}

function validateRareHunter() {
  const result = analyzeAchievementJourney({
    now: NOW,
    games: Array.from({ length: 3 }, (_, index) =>
      game(`rare-${index}`, { rareAchievementsUnlocked: 5, completionPercent: 45 })
    )
  });
  assert(result.achievementDna.primaryType === "rareHunter", "rare hunter expected");
}

function validateInsufficientData() {
  const result = analyzeAchievementJourney({ now: NOW, games: [game("single")] });
  assert(result.achievementDna.primaryType === "balanced", "balanced fallback expected");
  assert(result.achievementDna.confidence <= 0.2, "confidence must remain low");
}

function validateEmptyWeekly() {
  const result = analyzeAchievementJourney({ now: NOW, activity: [] });
  assert(result.weeklyInsights.totalPlaytimeMinutes === 0, "empty playtime expected");
  assert(result.weeklyInsights.mostActiveDay === null, "no active day expected");
}

function validateFourteenDays() {
  const activity: UserActivityInput[] = Array.from({ length: 14 }, (_, index) => ({
    date: new Date(Date.parse(NOW) - index * 86_400_000).toISOString(),
    playtimeMinutes: index < 7 ? 120 : 60,
    achievementsUnlocked: index < 7 ? 1 : 0,
    gamesPlayed: ["game"]
  }));
  const result = analyzeAchievementJourney({ now: NOW, activity });
  assert(result.weeklyInsights.changeComparedToPreviousWeek === 100, "weekly change should be 100%");
  assert(result.weeklyInsights.streakDays === 14, "continuous fourteen-day streak expected");
}

function game(id: string, patch: Partial<GameIntelligenceInput> = {}): GameIntelligenceInput {
  return {
    gameId: id,
    title: id,
    playtimeMinutes: 600,
    unlockedAchievements: 5,
    totalAchievements: 10,
    completionPercent: 50,
    lastPlayedAt: "2026-07-25T12:00:00.000Z",
    favorite: false,
    hidden: false,
    status: "playing",
    ...patch
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
