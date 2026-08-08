import { randomUUID } from "node:crypto";
import { ToolError } from "./contracts.ts";
import {
  computeTrendingScore,
  dayBucket,
  trendWeightForDay
} from "./toolTrendingScore.ts";

export type ToolEventKind = "view" | "download_click";

export interface ToolEventRecord {
  id: string;
  toolId: string;
  userId?: string;
  kind: ToolEventKind;
  dedupeKey: string;
  createdAtMs: number;
}

export interface ToolRankedEntry {
  id: string;
  score: number;
}

export interface ToolAnalyticsRepository {
  validateSchema(): Promise<void>;
  record(input: {
    toolId: string;
    kind: ToolEventKind;
    userId?: string;
    dedupeKey: string;
    windowMs: number;
    now: number;
  }): Promise<{ recorded: boolean }>;
  totals(kind: ToolEventKind, toolIds: string[]): Promise<Map<string, number>>;
  lifetimeTotals(kind: ToolEventKind): Promise<number>;
  windowTotals(kind: ToolEventKind, sinceMs: number): Promise<number>;
  windowScores(
    toolIds: string[],
    sinceMs: number,
    now: number
  ): Promise<Map<string, { views: number; downloadClicks: number }>>;
  dailySeries(
    toolId: string,
    kind: ToolEventKind,
    sinceMs: number
  ): Promise<Array<{ date: string; count: number }>>;
  purgeOlderThan(cutoffMs: number): Promise<number>;
  windowScores(
    toolIds: string[],
    sinceMs: number,
    now: number
  ): Promise<Map<string, { views: number; downloadClicks: number }>>;
  windowTotals(kind: ToolEventKind, sinceMs: number): Promise<number>;
}

export class InMemoryToolAnalyticsRepository implements ToolAnalyticsRepository {
  readonly events: ToolEventRecord[] = [];

  async validateSchema() {}

  async record(input: {
    toolId: string;
    kind: ToolEventKind;
    userId?: string;
    dedupeKey: string;
    windowMs: number;
    now: number;
  }) {
    if (input.kind !== "view" && input.kind !== "download_click") {
      throw new ToolError("INVALID_TOOL_QUERY");
    }
    const dedupeMatch = this.events.some(
      (event) =>
        event.toolId === input.toolId &&
        event.kind === input.kind &&
        input.now - event.createdAtMs < input.windowMs &&
        (event.userId
          ? event.userId === input.userId
          : event.dedupeKey === input.dedupeKey)
    );
    if (dedupeMatch) return { recorded: false };
    this.events.push({
      id: randomUUID(),
      toolId: input.toolId,
      ...(input.userId ? { userId: input.userId } : {}),
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      createdAtMs: input.now
    });
    return { recorded: true };
  }

  async totals(kind: ToolEventKind, toolIds: string[]) {
    const result = new Map<string, number>();
    for (const id of toolIds) result.set(id, 0);
    for (const event of this.events) {
      if (event.kind === kind && result.has(event.toolId)) {
        result.set(event.toolId, (result.get(event.toolId) ?? 0) + 1);
      }
    }
    return result;
  }

  async lifetimeTotals(kind: ToolEventKind) {
    return this.events.filter((event) => event.kind === kind).length;
  }

  async windowTotals(kind: ToolEventKind, sinceMs: number) {
    return this.events.filter((event) => event.kind === kind && event.createdAtMs >= sinceMs).length;
  }

  async dailySeries(toolId: string, kind: ToolEventKind, sinceMs: number) {
    const counts = new Map<string, number>();
    for (const event of this.events) {
      if (event.toolId !== toolId || event.kind !== kind || event.createdAtMs < sinceMs) continue;
      const date = new Date(event.createdAtMs).toISOString().slice(0, 10);
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((left, right) => left.date.localeCompare(right.date));
  }

  async windowScores(
    toolIds: string[],
    sinceMs: number,
    now: number
  ): Promise<Map<string, { views: number; downloadClicks: number }>> {
    const result = new Map<string, { views: number; downloadClicks: number }>();
    for (const id of toolIds) result.set(id, { views: 0, downloadClicks: 0 });
    for (const event of this.events) {
      if (!result.has(event.toolId) || event.createdAtMs < sinceMs) continue;
      const weight = trendWeightForDay(dayBucket(now, event.createdAtMs));
      const entry = result.get(event.toolId)!;
      if (event.kind === "view") entry.views += weight;
      else entry.downloadClicks += weight;
    }
    return result;
  }

  async purgeOlderThan(cutoffMs: number) {
    const before = this.events.length;
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      if (this.events[index].createdAtMs < cutoffMs) this.events.splice(index, 1);
    }
    return before - this.events.length;
  }
}

export function combineTrendingScores(
  events: Map<string, { views: number; downloadClicks: number }>,
  favorites: Map<string, number>,
  ids: string[]
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const id of ids) {
    const entry = events.get(id);
    scores.set(
      id,
      computeTrendingScore({
        views: entry?.views ?? 0,
        downloadClicks: entry?.downloadClicks ?? 0,
        favorites: favorites.get(id) ?? 0
      })
    );
  }
  return scores;
}

export function sortRanked(ids: string[], scores: Map<string, number>) {
  const entries: ToolRankedEntry[] = ids.map((id) => ({ id, score: scores.get(id) ?? 0 }));
  entries.sort(
    (left, right) =>
      right.score - left.score || left.id.localeCompare(right.id)
  );
  return entries;
}