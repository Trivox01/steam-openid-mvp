import { randomUUID } from "node:crypto";
import { ToolError } from "./contracts.ts";
import type { ToolRepository } from "./toolRepository.ts";

export interface ToolRatingSummary {
  average: number | null;
  total: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}
export interface ToolRating {
  id: string;
  toolId: string;
  userId: string;
  rating: number;
  createdAt: string;
  updatedAt: string;
}
export type ToolRatingAuditAction =
  | "tool.rating_created"
  | "tool.rating_updated"
  | "tool.rating_removed"
  | "tool.rating_denied";

export interface ToolRatingRepository {
  validateSchema(): Promise<void>;
  upsert(toolId: string, userId: string, rating: number): Promise<{ rating: ToolRating; previous?: number }>;
  remove(toolId: string, userId: string): Promise<ToolRating>;
  getMine(toolId: string, userId: string): Promise<ToolRating | undefined>;
  summary(toolId: string): Promise<ToolRatingSummary>;
  summaries(toolIds: string[]): Promise<Record<string, ToolRatingSummary>>;
  audit(action: ToolRatingAuditAction, actor: string, toolId: string, metadata?: Record<string, number>): Promise<void>;
}

export class InMemoryToolRatingRepository implements ToolRatingRepository {
  readonly ratings = new Map<string, ToolRating>();
  readonly auditEvents: Array<{ action: string; actor: string; toolId: string; metadata: Record<string, number> }> = [];
  readonly tools: ToolRepository;

  constructor(tools: ToolRepository) {
    this.tools = tools;
  }

  async validateSchema() {}

  async upsert(toolId: string, userId: string, rating: number) {
    await this.requireActive(toolId);
    const key = `${toolId}:${userId}`;
    const current = this.ratings.get(key);
    const now = new Date().toISOString();
    const value: ToolRating = {
      id: current?.id ?? randomUUID(),
      toolId,
      userId,
      rating,
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    };
    this.ratings.set(key, value);
    return { rating: value, ...(current ? { previous: current.rating } : {}) };
  }

  async remove(toolId: string, userId: string) {
    const key = `${toolId}:${userId}`;
    const current = this.ratings.get(key);
    if (!current) throw new ToolError("RATING_NOT_FOUND");
    this.ratings.delete(key);
    return current;
  }

  async getMine(toolId: string, userId: string) {
    if (!await this.tools.get(toolId)) throw new ToolError("TOOL_NOT_FOUND");
    return this.ratings.get(`${toolId}:${userId}`);
  }

  async summary(toolId: string) {
    if (!await this.tools.get(toolId)) throw new ToolError("TOOL_NOT_FOUND");
    return aggregateRating([...this.ratings.values()].filter((item) => item.toolId === toolId).map((item) => item.rating));
  }

  async summaries(toolIds: string[]) {
    const entries = await Promise.all(toolIds.map(async (id) => [id, await this.summary(id)] as const));
    return Object.fromEntries(entries);
  }

  async audit(action: ToolRatingAuditAction, actor: string, toolId: string, metadata: Record<string, number> = {}) {
    this.auditEvents.push({ action, actor, toolId, metadata });
  }

  private async requireActive(id: string) {
    const tool = await this.tools.get(id);
    if (!tool) throw new ToolError("TOOL_NOT_FOUND");
    if (tool.archivedAt || !tool.isActive) throw new ToolError("TOOL_ARCHIVED");
  }
}

export function aggregateRating(values: readonly number[]): ToolRatingSummary {
  const distribution: ToolRatingSummary["distribution"] = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const rating of values) {
    if (rating < 1 || rating > 5 || !Number.isInteger(rating)) continue;
    distribution[String(rating) as keyof typeof distribution] += 1;
  }
  const total = values.length;
  const average = total ? Math.round((values.reduce((sum, value) => sum + value, 0) / total) * 10) / 10 : null;
  return { average, total, distribution };
}