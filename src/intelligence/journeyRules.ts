import { JOURNEY_THRESHOLDS } from "./constants.ts";
import { clamp, daysSince, nonNegativeInteger } from "./scoring.ts";
import type { GameIntelligenceInput, JourneyCard, RankedGame } from "./types.ts";

export function createJourneyCards(
  games: GameIntelligenceInput[],
  rankedGames: RankedGame[],
  now: Date
): JourneyCard[] {
  const scores = new Map(rankedGames.map((game) => [game.gameId, game]));
  return games
    .flatMap((game) => createCard(game, scores.get(game.gameId), now))
    .sort((left, right) => right.priority - left.priority || left.gameId.localeCompare(right.gameId));
}

function createCard(game: GameIntelligenceInput, ranked: RankedGame | undefined, now: Date): JourneyCard[] {
  if (game.hidden === true) return [];
  const title = game.title?.trim() || game.gameId;
  const completion = clamp(game.completionPercent, 0, 100);
  const total = nonNegativeInteger(game.totalAchievements);
  const unlocked = Math.min(total, nonNegativeInteger(game.unlockedAchievements));
  const remaining = Math.max(0, total - unlocked);
  const age = daysSince(game.lastPlayedAt, now);
  const base = ranked?.score ?? 0;
  const card = (
    type: JourneyCard["type"],
    bonus: number,
    reasonCode: string,
    metadata: JourneyCard["metadata"] = {}
  ): JourneyCard => ({
    type,
    priority: clamp(base + bonus, 0, 100),
    gameId: game.gameId,
    title,
    reasonCode,
    metadata,
    translationKey: `intelligence.journey.${type}`,
    translationParams: { title }
  });

  if (completion >= 100 && age <= JOURNEY_THRESHOLDS.recentlyCompletedDays) {
    return [card("recentlyCompleted", 25, "completed_recently", { daysSincePlayed: Math.floor(age) })];
  }
  if (total === 0) {
    return [card("noAchievementsYet", 2, "no_achievement_catalog", {})];
  }
  if (remaining === 1 && completion < 100) {
    return [card("oneAchievementLeft", 30, "one_achievement_remaining", { remaining, completion })];
  }
  const rareAvailable = nonNegativeInteger(game.rareAchievementsAvailable);
  const rareUnlocked = nonNegativeInteger(game.rareAchievementsUnlocked);
  if (rareAvailable > rareUnlocked) {
    return [card("rareOpportunity", 24, "rare_achievement_available", { rareRemaining: rareAvailable - rareUnlocked })];
  }
  if (completion >= JOURNEY_THRESHOLDS.almostFinishedPercent && completion < 100) {
    return [card("almostFinished", 20, "high_completion", { completion, remaining })];
  }
  if (completion > JOURNEY_THRESHOLDS.worthReturningPercent && age >= JOURNEY_THRESHOLDS.returningDays) {
    return [card("worthReturning", 15, "progress_paused", { completion, daysSincePlayed: Math.floor(age) })];
  }
  if (age >= JOURNEY_THRESHOLDS.forgottenDays && Number.isFinite(age)) {
    return [card("forgottenAdventure", 8, "long_inactive", { daysSincePlayed: Math.floor(age) })];
  }
  if (game.status === "playing" && age <= JOURNEY_THRESHOLDS.recentDays) {
    return [card("continueJourney", 12, "recently_playing", { completion })];
  }
  if (ranked?.eligible && ranked.score >= JOURNEY_THRESHOLDS.minimumJourneyScore) {
    return [card("continueJourney", 5, "journey_score", { completion, score: ranked.score })];
  }
  return [];
}
