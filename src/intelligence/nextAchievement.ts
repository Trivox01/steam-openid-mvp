import { JOURNEY_THRESHOLDS } from "./constants.ts";
import { clamp } from "./scoring.ts";
import type {
  AchievementIntelligenceInput,
  NextAchievementRecommendation,
  RankedGame
} from "./types.ts";

export function selectNextAchievement(
  achievements: AchievementIntelligenceInput[],
  rankedGames: RankedGame[]
): NextAchievementRecommendation | null {
  const gameScores = new Map(rankedGames.map((game) => [game.gameId, game.score]));
  const candidates = achievements
    .filter((achievement) => achievement.unlocked !== true && achievement.hidden !== true)
    .map((achievement) => scoreAchievement(achievement, gameScores.get(achievement.gameId) ?? 0))
    .sort((left, right) => right.score - left.score || left.achievementId.localeCompare(right.achievementId));
  return candidates[0] ?? null;
}

function scoreAchievement(
  achievement: AchievementIntelligenceInput,
  journeyScore: number
): NextAchievementRecommendation {
  const target = positive(achievement.progressTarget);
  const current = clamp(achievement.progressCurrent, 0, target ?? Number.MAX_SAFE_INTEGER);
  const progressPercent = target ? clamp((current / target) * 100, 0, 100) : null;
  const rarity = validPercent(achievement.globalUnlockPercent);
  const progressPoints = progressPercent === null ? 0 : progressPercent * 0.45;
  const rarityPoints = rarity === null
    ? 0
    : rarity < JOURNEY_THRESHOLDS.minimumUsefulRarityPercent
      ? -8
      : rarity <= JOURNEY_THRESHOLDS.rareAchievementPercent
        ? 25
        : rarity <= 30
          ? 14
          : 4;
  const informationPoints = progressPercent !== null || rarity !== null ? 5 : 0;
  const score = clamp(progressPoints + rarityPoints + journeyScore * 0.25 + informationPoints, 0, 100);
  const reasonCode = progressPercent !== null && progressPercent >= 70
    ? "progress_near_target"
    : rarity !== null && rarity <= JOURNEY_THRESHOLDS.rareAchievementPercent && rarity >= JOURNEY_THRESHOLDS.minimumUsefulRarityPercent
      ? "attainable_rare_achievement"
      : journeyScore >= 60
        ? "high_priority_game"
        : "best_available_information";
  return {
    achievementId: achievement.achievementId,
    gameId: achievement.gameId,
    score: Math.round(score * 100) / 100,
    reasonCode,
    translationKey: `intelligence.nextAchievement.${reasonCode}`,
    metadata: {
      progressPercent: progressPercent === null ? null : Math.round(progressPercent * 100) / 100,
      globalUnlockPercent: rarity,
      estimatedTimeMinutes: null
    }
  };
}

function positive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function validPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}
