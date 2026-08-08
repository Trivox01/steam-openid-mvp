export interface ToolFavoriteEntry {
  toolId: string;
  userId: string;
  createdAtMs: number;
}

export interface ToolFavoriteView {
  toolId: string;
  createdAtMs: number;
}

export interface ToolFavoriteRepository {
  validateSchema(): Promise<void>;
  add(toolId: string, userId: string, nowMs: number): Promise<boolean>;
  remove(toolId: string, userId: string): Promise<boolean>;
  has(toolId: string, userId: string): Promise<boolean>;
  counts(toolIds: string[]): Promise<Map<string, number>>;
  createdCounts(toolIds: string[], sinceMs: number): Promise<Map<string, number>>;
  list(userId: string, page: number, pageSize: number): Promise<{ items: ToolFavoriteView[]; total: number }>;
  lifetimeTotal(): Promise<number>;
  windowTotal(sinceMs: number): Promise<number>;
}

export class InMemoryToolFavoriteRepository implements ToolFavoriteRepository {
  readonly items: Map<string, ToolFavoriteEntry> = new Map();

  key(toolId: string, userId: string) {
    return `${toolId}:${userId}`;
  }

  async validateSchema() {}

  async add(toolId: string, userId: string, nowMs: number) {
    const key = this.key(toolId, userId);
    if (this.items.has(key)) return false;
    this.items.set(key, { toolId, userId, createdAtMs: nowMs });
    return true;
  }

  async remove(toolId: string, userId: string) {
    return this.items.delete(this.key(toolId, userId));
  }

  async has(toolId: string, userId: string) {
    return this.items.has(this.key(toolId, userId));
  }

  async counts(toolIds: string[]) {
    const result = new Map<string, number>();
    for (const id of toolIds) result.set(id, 0);
    for (const entry of this.items.values()) {
      if (result.has(entry.toolId)) result.set(entry.toolId, (result.get(entry.toolId) ?? 0) + 1);
    }
    return result;
  }

  async createdCounts(toolIds: string[], sinceMs: number) {
    const result = new Map<string, number>();
    for (const id of toolIds) result.set(id, 0);
    for (const entry of this.items.values()) {
      if (entry.createdAtMs >= sinceMs && result.has(entry.toolId)) {
        result.set(entry.toolId, (result.get(entry.toolId) ?? 0) + 1);
      }
    }
    return result;
  }

  async list(userId: string, page: number, pageSize: number): Promise<{ items: ToolFavoriteView[]; total: number }> {
    const entries = [...this.items.values()]
      .filter((entry) => entry.userId === userId)
      .sort((left, right) => right.createdAtMs - left.createdAtMs || left.toolId.localeCompare(right.toolId));
    const start = (page - 1) * pageSize;
    return {
      items: entries.slice(start, start + pageSize).map((entry) => ({ toolId: entry.toolId, createdAtMs: entry.createdAtMs })),
      total: entries.length
    };
  }

  async lifetimeTotal() {
    return this.items.size;
  }

  async windowTotal(sinceMs: number) {
    let total = 0;
    for (const entry of this.items.values()) if (entry.createdAtMs >= sinceMs) total += 1;
    return total;
  }
}