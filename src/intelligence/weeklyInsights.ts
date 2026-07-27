import { nonNegativeInteger } from "./scoring.ts";
import type { UserActivityInput, WeeklyInsights } from "./types.ts";

const DAY_MS = 86_400_000;

export function summarizeWeeklyActivity(
  activity: UserActivityInput[],
  now: Date
): WeeklyInsights {
  const today = startUtcDay(now);
  const currentStart = today - 6 * DAY_MS;
  const previousStart = today - 13 * DAY_MS;
  const days = new Map<number, { playtime: number; achievements: number; games: Set<string>; gameCount: number }>();
  for (const item of activity) {
    const day = parseUtcDay(item.date);
    if (day === null || day < previousStart || day > today) continue;
    const bucket = days.get(day) ?? { playtime: 0, achievements: 0, games: new Set<string>(), gameCount: 0 };
    bucket.playtime += nonNegativeInteger(item.playtimeMinutes);
    bucket.achievements += nonNegativeInteger(item.achievementsUnlocked);
    if (Array.isArray(item.gamesPlayed)) item.gamesPlayed.forEach((game) => bucket.games.add(game));
    else bucket.gameCount += nonNegativeInteger(item.gamesPlayed);
    days.set(day, bucket);
  }
  const current = [...days.entries()].filter(([day]) => day >= currentStart);
  const previous = [...days.entries()].filter(([day]) => day >= previousStart && day < currentStart);
  const totalPlaytimeMinutes = sum(current, "playtime");
  const previousPlaytime = sum(previous, "playtime");
  const achievementsUnlocked = sum(current, "achievements");
  const playedGames = new Set(current.flatMap(([, bucket]) => [...bucket.games]));
  const numericGameCount = current.reduce((sum, [, bucket]) => sum + bucket.gameCount, 0);
  const active = current.filter(([, bucket]) => bucket.playtime > 0 || bucket.achievements > 0 || bucket.games.size > 0 || bucket.gameCount > 0);
  const mostActive = [...active].sort((left, right) =>
    (right[1].playtime + right[1].achievements * 15) - (left[1].playtime + left[1].achievements * 15) ||
    left[0] - right[0]
  )[0];
  return {
    totalPlaytimeMinutes,
    achievementsUnlocked,
    gamesPlayed: playedGames.size + numericGameCount,
    activeDays: active.length,
    mostActiveDay: mostActive ? new Date(mostActive[0]).toISOString().slice(0, 10) : null,
    changeComparedToPreviousWeek: previous.length
      ? previousPlaytime === 0
        ? totalPlaytimeMinutes > 0 ? 100 : 0
        : round(((totalPlaytimeMinutes - previousPlaytime) / previousPlaytime) * 100)
      : null,
    streakDays: calculateStreak(days, today),
    translationKeys: [
      totalPlaytimeMinutes > 0 ? "intelligence.weekly.playtime" : "intelligence.weekly.noActivity",
      achievementsUnlocked > 0 ? "intelligence.weekly.achievements" : "intelligence.weekly.noAchievements"
    ]
  };
}

function sum(entries: Array<[number, { playtime: number; achievements: number }]>, key: "playtime" | "achievements") {
  return entries.reduce((total, [, bucket]) => total + bucket[key], 0);
}

function calculateStreak(
  days: Map<number, { playtime: number; achievements: number; games: Set<string>; gameCount: number }>,
  today: number
) {
  let streak = 0;
  for (let day = today; ; day -= DAY_MS) {
    const bucket = days.get(day);
    if (!bucket || (bucket.playtime === 0 && bucket.achievements === 0 && bucket.games.size === 0 && bucket.gameCount === 0)) break;
    streak += 1;
  }
  return streak;
}

function parseUtcDay(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? startUtcDay(new Date(timestamp)) : null;
}

function startUtcDay(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
