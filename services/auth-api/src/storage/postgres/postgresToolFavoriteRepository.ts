import type { Pool } from "pg";
import type {
  ToolFavoriteRepository,
  ToolFavoriteView
} from "../../tools/toolFavoriteRepository.ts";

export class PostgresToolFavoriteRepository implements ToolFavoriteRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='tool_favorites'"
    );
    if (Number(result.rows[0]?.count) !== 1) throw new Error("tool_favorite_schema_invalid");
  }

  async add(toolId: string, userId: string, nowMs: number) {
    const result = await this.pool.query(
      `INSERT INTO tool_favorites(tool_id, user_id, created_at)
       VALUES($1,$2,to_timestamp($3::double precision / 1000.0))
       ON CONFLICT(tool_id, user_id) DO NOTHING`,
      [toolId, userId, nowMs]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async remove(toolId: string, userId: string) {
    const result = await this.pool.query(
      "DELETE FROM tool_favorites WHERE tool_id=$1 AND user_id=$2",
      [toolId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async has(toolId: string, userId: string) {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM tool_favorites WHERE tool_id=$1 AND user_id=$2",
      [toolId, userId]
    );
    return Number(result.rows[0]?.count ?? 0) > 0;
  }

  async counts(toolIds: string[]) {
    const result = new Map<string, number>();
    if (!toolIds.length) return result;
    const rows = await this.pool.query<{ toolId: string; count: string }>(
      `SELECT tool_id AS "toolId", count(*) AS count FROM tool_favorites
       WHERE tool_id=ANY($1::uuid[]) GROUP BY tool_id`,
      [toolIds]
    );
    for (const id of toolIds) result.set(id, 0);
    for (const row of rows.rows) result.set(String(row.toolId), Number(row.count));
    return result;
  }

  async createdCounts(toolIds: string[], sinceMs: number) {
    const result = new Map<string, number>();
    if (!toolIds.length) return result;
    const rows = await this.pool.query<{ toolId: string; count: string }>(
      `SELECT tool_id AS "toolId", count(*) AS count FROM tool_favorites
       WHERE tool_id=ANY($1::uuid[]) AND created_at >= to_timestamp($2::double precision / 1000.0)
       GROUP BY tool_id`,
      [toolIds, sinceMs]
    );
    for (const id of toolIds) result.set(id, 0);
    for (const row of rows.rows) result.set(String(row.toolId), Number(row.count));
    return result;
  }

  async list(userId: string, page: number, pageSize: number): Promise<{ items: ToolFavoriteView[]; total: number }> {
    const total = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM tool_favorites WHERE user_id=$1",
      [userId]
    );
    const rows = await this.pool.query<{ toolId: string; createdAt: Date }>(
      `SELECT tool_id AS "toolId", created_at AS "createdAt" FROM tool_favorites
       WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, pageSize, (page - 1) * pageSize]
    );
    return {
      items: rows.rows.map((row) => ({ toolId: String(row.toolId), createdAtMs: Date.parse(row.createdAt.toISOString()) })),
      total: Number(total.rows[0]?.count ?? 0)
    };
  }

  async lifetimeTotal() {
    const result = await this.pool.query<{ count: string }>("SELECT count(*) FROM tool_favorites");
    return Number(result.rows[0]?.count ?? 0);
  }

  async windowTotal(sinceMs: number) {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM tool_favorites WHERE created_at >= to_timestamp($1::double precision / 1000.0)`,
      [sinceMs]
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}