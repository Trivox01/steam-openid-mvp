import { randomUUID } from "node:crypto";
import { ToolError } from "./contracts.ts";
import type { ToolRepository } from "./toolRepository.ts";
import type { ToolAnalyticsRepository, ToolEventKind, ToolRankedEntry } from "./toolAnalyticsRepository.ts";
import type { ToolFavoriteRepository } from "./toolFavoriteRepository.ts";
import type { ToolRatingRepository } from "./toolRatingRepository.ts";
import type { ToolReviewRepository } from "./toolReviewRepository.ts";
import {
  combineTrendingScores,
  sortRanked
} from "./toolAnalyticsRepository.ts";
import {
  DOWNLOAD_CLICK_DEDUPE_WINDOW_MS,
  EVENT_RETENTION_DAYS,
  TRENDING_WINDOW_DAYS,
  VIEW_DEDUPE_WINDOW_MS
} from "./toolTrendingScore.ts";

export type ToolRankSort = "trending" | "popular" | "most_downloaded" | "recommended";

export interface ToolPublicStats {
  views: number;
  downloadClicks: number;
  favorites: number;
}

export interface ToolAnalyticsOverview {
  totals: { views: number; downloadClicks: number; favorites: number };
  windows: Record<"7d" | "30d", { views: number; downloadClicks: number; favorites: number }>;
  trending: ToolRankedEntry[];
}

export interface ToolTimelinePoint {
  date: string;
  count: number;
}

export interface ToolAnalyticsReport {
  stats: ToolPublicStats;
  series: { views: ToolTimelinePoint[]; downloadClicks: ToolTimelinePoint[] };
  favorites: number;
  ratingSummary?: { average: number | null; total: number; distribution: Record<"1" | "2" | "3" | "4" | "5", number> };
  reviewCount?: number;
}

export class ToolAnalyticsService {
  readonly events: ToolAnalyticsRepository;
  readonly favorites: ToolFavoriteRepository;
  private readonly ratings?: ToolRatingRepository;
  private readonly reviews?: ToolReviewRepository;
  private readonly tools?: ToolRepository;
  private readonly now: () => number;

  constructor(
    events: ToolAnalyticsRepository,
    favorites: ToolFavoriteRepository,
    options: {
      ratings?: ToolRatingRepository;
      reviews?: ToolReviewRepository;
      tools?: ToolRepository;
      now?: () => number;
    } = {}
  ) {
    this.events = events;
    this.favorites = favorites;
    this.ratings = options.ratings;
    this.reviews = options.reviews;
    this.tools = options.tools;
    this.now = options.now ?? Date.now;
  }

  async recordView(input: { toolId: string; userId?: string; dedupeKey?: string }) {
    return this.record("view", input);
  }

  async recordDownloadClick(input: { toolId: string; userId?: string; dedupeKey?: string }) {
    return this.record("download_click", input);
  }

  async record(kind: ToolEventKind, input: { toolId: string; userId?: string; dedupeKey?: string }) {
    const windowMs = kind === "view" ? VIEW_DEDUPE_WINDOW_MS : DOWNLOAD_CLICK_DEDUPE_WINDOW_MS;
    return this.events.record({
      toolId: input.toolId,
      kind,
      ...(input.userId ? { userId: input.userId } : {}),
      dedupeKey: input.dedupeKey ?? randomUUID(),
      windowMs,
      now: this.now()
    });
  }

  async stats(toolId: string): Promise<ToolPublicStats> {
    const [viewTotals, clickTotals, favoriteCounts] = await Promise.all([
      this.events.totals("view", [toolId]),
      this.events.totals("download_click", [toolId]),
      this.favorites.counts([toolId])
    ]);
    return {
      views: viewTotals.get(toolId) ?? 0,
      downloadClicks: clickTotals.get(toolId) ?? 0,
      favorites: favoriteCounts.get(toolId) ?? 0
    };
  }

  async addFavorite(toolId: string, userId: string) {
    const added = await this.favorites.add(toolId, userId, this.now());
    const [counts] = await Promise.all([this.favorites.counts([toolId])]);
    return { isFavorite: true, favoritesCount: counts.get(toolId) ?? 0, added };
  }

  async removeFavorite(toolId: string, userId: string) {
    const removed = await this.favorites.remove(toolId, userId);
    const [counts] = await Promise.all([this.favorites.counts([toolId])]);
    return { isFavorite: false, favoritesCount: counts.get(toolId) ?? 0, removed };
  }

  async favoriteStatus(toolId: string, userId: string) {
    return this.favorites.has(toolId, userId);
  }

  async listFavorites(userId: string, page: number, pageSize: number) {
    const { items, total } = await this.favorites.list(userId, page, pageSize);
    const ids = items.map((item) => item.toolId);
    const [views, clicks, favs] = await Promise.all([
      this.events.totals("view", ids),
      this.events.totals("download_click", ids),
      this.favorites.counts(ids)
    ]);
    return {
      items: items.map((item) => ({
        toolId: item.toolId,
        createdAtMs: item.createdAtMs,
        stats: {
          views: views.get(item.toolId) ?? 0,
          downloadClicks: clicks.get(item.toolId) ?? 0,
          favorites: favs.get(item.toolId) ?? 0
        }
      })),
      total
    };
  }

  async rank(ids: string[], sort: ToolRankSort): Promise<ToolRankedEntry[]> {
    const now = this.now();
    if (sort === "popular") {
      const totals = await this.events.totals("view", ids);
      return sortRanked(ids, totals);
    }
    if (sort === "most_downloaded") {
      const totals = await this.events.totals("download_click", ids);
      return sortRanked(ids, totals);
    }
    if (sort === "recommended") {
      if (!this.ratings) return ids.map((id) => ({ id, score: 0 }));
      const [summaries] = await Promise.all([this.ratings.summaries(ids)]);
      const scores = new Map<string, number>();
      for (const id of ids) {
        const summary = summaries[id];
        scores.set(id, summary && summary.total >= 3 ? summary.average ?? 0 : 0);
      }
      return sortRanked(ids, scores);
    }
    const sinceMs = now - TRENDING_WINDOW_DAYS * 86_400_000;
    const [eventScores, favoriteCounts] = await Promise.all([
      this.events.windowScores(ids, sinceMs, now),
      this.favorites.createdCounts(ids, sinceMs)
    ]);
    return sortRanked(ids, combineTrendingScores(eventScores, favoriteCounts, ids));
  }

async overview(): Promise<ToolAnalyticsOverview> {
    const now = this.now();
    const day = 86_400_000;
    const [viewsLifetime, clicksLifetime, favoritesLifetime, views7, clicks7, favs7, views30, clicks30, favs30] = await Promise.all([
      this.events.lifetimeTotals("view"),
      this.events.lifetimeTotals("download_click"),
      this.favorites.lifetimeTotal(),
      this.events.windowTotals("view", now - 7 * day),
      this.events.windowTotals("download_click", now - 7 * day),
      this.favorites.windowTotal(now - 7 * day),
      this.events.windowTotals("view", now - 30 * day),
      this.events.windowTotals("download_click", now - 30 * day),
      this.favorites.windowTotal(now - 30 * day)
    ]);
    return {
      totals: { views: viewsLifetime, downloadClicks: clicksLifetime, favorites: favoritesLifetime },
      windows: {
        "7d": { views: views7, downloadClicks: clicks7, favorites: favs7 },
        "30d": { views: views30, downloadClicks: clicks30, favorites: favs30 }
      },
      trending: await this.trendingTools(12)
    };
  }

  async toolAnalytics(toolId: string, days = 30) {
    const now = this.now();
    const since = now - days * 86_400_000;
    const [stats, viewSeries, clickSeries, favoriteCounts, ratingSummary, reviewCount] = await Promise.all([
      this.stats(toolId),
      this.events.dailySeries(toolId, "view", since),
      this.events.dailySeries(toolId, "download_click", since),
      this.favorites.counts([toolId]),
      this.ratings ? this.ratings.summary(toolId) : undefined,
      this.reviews ? this.reviews.countActive(toolId) : undefined
    ]);
    return {
      stats,
      series: { views: viewSeries, downloadClicks: clickSeries },
      favorites: favoriteCounts.get(toolId) ?? 0,
      ...(ratingSummary ? { ratingSummary } : {}),
      ...(reviewCount !== undefined ? { reviewCount } : {})
    };
  }

  async trendingTools(limit = 20): Promise<Array<{ id: string; score: number }>> {
    if (!this.tools) return [];
    const now = this.now();
    const since = now - TRENDING_WINDOW_DAYS * 86_400_000;
    const page = await this.tools.list({ page: 1, pageSize: 1000, activeOnly: true, includeArchived: false, sort: "newest" });
    const ids = page.items.map((tool) => tool.id);
    const [eventScores, favoriteCounts] = await Promise.all([
      this.events.windowScores(ids, since, now),
      this.favorites.createdCounts(ids, since)
    ]);
    return sortRanked(ids, combineTrendingScores(eventScores, favoriteCounts, ids)).slice(0, limit);
  }

  async purgeExpiredEvents() {
    return this.events.purgeOlderThan(this.now() - EVENT_RETENTION_DAYS * 86_400_000);
  }
}