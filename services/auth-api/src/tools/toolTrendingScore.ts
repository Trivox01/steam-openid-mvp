export const TRENDING_WINDOW_DAYS = 7;
export const TRENDING_DECAY_BASE = 0.9;
export const VIEW_DEDUPE_WINDOW_MS = 30 * 60 * 1000;
export const DOWNLOAD_CLICK_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
export const EVENT_RETENTION_DAYS = 90;

export interface ToolTrendingMetrics {
  views: number;
  downloadClicks: number;
  favorites: number;
}

export function trendWeightForDay(daysAgo: number, base = TRENDING_DECAY_BASE) {
  return Math.pow(base, Math.max(0, daysAgo));
}

export function dayBucket(nowMs: number, timeMs: number) {
  return Math.max(0, Math.floor((nowMs - timeMs) / 86_400_000));
}

export function computeTrendingScore(metrics: ToolTrendingMetrics) {
  const weighted =
    metrics.views +
    metrics.downloadClicks * 3 +
    metrics.favorites * 5;
  if (weighted <= 0) return 0;
  return Math.round(Math.log1p(weighted) * 100) / 100;
}