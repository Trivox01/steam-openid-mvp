import { analyzeAchievementDna } from "./achievementDna.ts";
import { createJourneyCards } from "./journeyRules.ts";
import { selectNextAchievement } from "./nextAchievement.ts";
import { calculateJourneyPriority } from "./scoring.ts";
import type {
  AchievementIntelligenceInput,
  AchievementJourneyAnalysis,
  AchievementJourneyInput,
  GameIntelligenceInput
} from "./types.ts";
import { summarizeWeeklyActivity } from "./weeklyInsights.ts";

export function analyzeAchievementJourney(
  input: AchievementJourneyInput
): AchievementJourneyAnalysis {
  const diagnostics: AchievementJourneyAnalysis["diagnostics"] = {
    ignoredInvalidGames: [],
    ignoredInvalidAchievements: [],
    insufficientDataFlags: []
  };
  const now = normalizeNow(input.now);
  const rawGames = Array.isArray(input.games) ? input.games : [];
  const rawAchievements = Array.isArray(input.achievements) ? input.achievements : [];
  const rawActivity = Array.isArray(input.activity) ? input.activity : [];
  const games = validateGames(rawGames, diagnostics.ignoredInvalidGames);
  const gameIds = new Set(games.map((game) => game.gameId));
  const achievements = validateAchievements(
    rawAchievements,
    gameIds,
    diagnostics.ignoredInvalidAchievements
  );
  const rankedGames = games
    .map((game) => calculateJourneyPriority(game, now))
    .sort((left, right) => right.score - left.score || left.gameId.localeCompare(right.gameId));
  const achievementDna = analyzeAchievementDna(games);
  const weeklyInsights = summarizeWeeklyActivity(rawActivity, now);
  if (games.length < 3) diagnostics.insufficientDataFlags.push("dna_game_sample");
  if (achievements.length === 0) diagnostics.insufficientDataFlags.push("next_achievement_data");
  if (rawActivity.length === 0) diagnostics.insufficientDataFlags.push("weekly_activity_data");
  return {
    rankedGames,
    journeyCards: createJourneyCards(games, rankedGames, now),
    nextAchievement: selectNextAchievement(achievements, rankedGames),
    achievementDna,
    weeklyInsights,
    diagnostics
  };
}

function validateGames(
  games: GameIntelligenceInput[],
  ignored: string[]
) {
  const seen = new Set<string>();
  return games.filter((game, index) => {
    const id = typeof game?.gameId === "string" ? game.gameId.trim() : "";
    if (!id || seen.has(id)) {
      ignored.push(id || `game_at_${index}`);
      return false;
    }
    seen.add(id);
    return true;
  });
}

function validateAchievements(
  achievements: AchievementIntelligenceInput[],
  gameIds: Set<string>,
  ignored: string[]
) {
  const seen = new Set<string>();
  return achievements.filter((achievement, index) => {
    const id = typeof achievement?.achievementId === "string"
      ? achievement.achievementId.trim()
      : "";
    const gameId = typeof achievement?.gameId === "string"
      ? achievement.gameId.trim()
      : "";
    if (!id || !gameId || !gameIds.has(gameId) || seen.has(id)) {
      ignored.push(id || `achievement_at_${index}`);
      return false;
    }
    seen.add(id);
    return true;
  });
}

function normalizeNow(value: AchievementJourneyInput["now"]) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(value.getTime());
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}
