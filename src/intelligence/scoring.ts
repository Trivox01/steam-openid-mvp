import { JOURNEY_WEIGHTS } from "./constants.ts";
import type {
  GameIntelligenceInput,
  IntelligenceGameStatus,
  JourneyScoreBreakdown,
  RankedGame
} from "./types.ts";

export function calculateJourneyPriority(
  game: GameIntelligenceInput,
  now: Date = new Date()
): RankedGame {
  const title = game.title?.trim() || game.gameId;
  const hidden = game.hidden === true;
  const completion = clamp(game.completionPercent, 0, 100);
  const total = nonNegativeInteger(game.totalAchievements);
  const unlocked = Math.min(total, nonNegativeInteger(game.unlockedAchievements));
  const status = normalizeStatus(game.status, completion, game.playtimeMinutes);
  const eligible = !hidden && completion < 100 && status !== "completed";

  const breakdown: JourneyScoreBreakdown = {
    completion: total > 0 ? completionScore(completion) : 0,
    remainingAchievements: total > 0 ? remainingScore(total - unlocked) : 0,
    recency: recencyScore(daysSince(game.lastPlayedAt, now)),
    status: statusScore(status),
    favorite: game.favorite === true ? JOURNEY_WEIGHTS.favorite : 0
  };
  const score = eligible
    ? clamp(Object.values(breakdown).reduce((sum, value) => sum + value, 0), 0, 100)
    : 0;
  return { gameId: game.gameId, title, score: round(score), eligible, breakdown };
}

export function daysSince(value: string | null | undefined, now: Date) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - timestamp) / 86_400_000);
}

export function clamp(value: number | null | undefined, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function nonNegativeInteger(value: number | null | undefined) {
  return Math.round(clamp(value, 0, Number.MAX_SAFE_INTEGER));
}

function completionScore(percent: number) {
  if (percent <= 0 || percent >= 100) return 0;
  if (percent < 50) return (percent / 50) * 10;
  if (percent < 80) return 10 + ((percent - 50) / 30) * 15;
  return 25 + ((percent - 80) / 20) * 10;
}

function remainingScore(remaining: number) {
  if (remaining <= 0) return 0;
  if (remaining === 1) return 25;
  if (remaining === 2) return 22;
  if (remaining === 3) return 18;
  if (remaining <= 5) return 14;
  if (remaining <= 10) return 8;
  return 3;
}

function recencyScore(days: number) {
  if (days <= 2) return 20;
  if (days <= 7) return 16;
  if (days <= 14) return 11;
  if (days <= 30) return 6;
  if (days <= 90) return 2;
  return 0;
}

function statusScore(status: IntelligenceGameStatus) {
  if (status === "playing") return JOURNEY_WEIGHTS.playing;
  if (status === "backlog") return JOURNEY_WEIGHTS.backlog;
  if (status === "abandoned") return JOURNEY_WEIGHTS.abandoned;
  return 0;
}

function normalizeStatus(
  status: IntelligenceGameStatus | null | undefined,
  completion: number,
  playtime: number | null | undefined
): IntelligenceGameStatus {
  if (status) return status;
  if (completion >= 100) return "completed";
  return clamp(playtime, 0, Number.MAX_SAFE_INTEGER) > 0 ? "playing" : "notStarted";
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
