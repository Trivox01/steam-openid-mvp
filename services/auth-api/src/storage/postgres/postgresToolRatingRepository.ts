import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ToolError } from "../../tools/contracts.ts";
import type { ToolRating, ToolRatingRepository } from "../../tools/toolRatingRepository.ts";
import { aggregateRating } from "../../tools/toolRatingRepository.ts";

export class PostgresToolRatingRepository implements ToolRatingRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='tool_ratings'"
    );
    if (Number(result.rows[0]?.count) !== 1) throw new Error("tool_rating_schema_invalid");
  }

  async upsert(toolId: string, userId: string, rating: number) {
    return this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${toolId}:${userId}`]
      );
      await requireTool(client, toolId, true);
      const previous = (await client.query<{ rating: number }>(
        "SELECT rating FROM tool_ratings WHERE tool_id=$1 AND user_id=$2",
        [toolId, userId]
      )).rows[0]?.rating;
      const result = await client.query(
        `INSERT INTO tool_ratings(id, tool_id, user_id, rating)
         VALUES($1, $2, $3, $4)
         ON CONFLICT(tool_id, user_id) DO UPDATE SET rating=EXCLUDED.rating, updated_at=now()
         RETURNING id, tool_id AS "toolId", user_id AS "userId", rating, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [randomUUID(), toolId, userId, rating]
      );
      return { rating: row(result.rows[0]), ...(previous === undefined ? {} : { previous: Number(previous) }) };
    });
  }

  async remove(toolId: string, userId: string) {
    return this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${toolId}:${userId}`]
      );
      const result = await client.query(
        `DELETE FROM tool_ratings WHERE tool_id=$1 AND user_id=$2
         RETURNING id, tool_id AS "toolId", user_id AS "userId", rating, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [toolId, userId]
      );
      if (!result.rowCount) throw new ToolError("RATING_NOT_FOUND");
      return row(result.rows[0]);
    });
  }

  async getMine(toolId: string, userId: string) {
    await requireTool(this.pool, toolId, false);
    const result = await this.pool.query(
      `SELECT id, tool_id AS "toolId", user_id AS "userId", rating, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM tool_ratings WHERE tool_id=$1 AND user_id=$2`,
      [toolId, userId]
    );
    return result.rows[0] ? row(result.rows[0]) : undefined;
  }

  async summary(toolId: string) {
    await requireTool(this.pool, toolId, false);
    const result = await this.pool.query<{ rating: number }>(
      "SELECT rating FROM tool_ratings WHERE tool_id=$1",
      [toolId]
    );
    return aggregateRating(result.rows.map((item) => Number(item.rating)));
  }

  async summaries(toolIds: string[]) {
    if (!toolIds.length) return {};
    const result = await this.pool.query<{ toolId: string; rating: number }>(
      "SELECT rating, tool_id AS \"toolId\" FROM tool_ratings WHERE tool_id=ANY($1::uuid[])",
      [toolIds]
    );
    const buckets = new Map<string, number[]>();
    for (const item of result.rows) {
      const list = buckets.get(item.toolId) ?? [];
      list.push(Number(item.rating));
      buckets.set(item.toolId, list);
    }
    const output: Record<string, ReturnType<typeof aggregateRating>> = {};
    for (const id of toolIds) output[id] = aggregateRating(buckets.get(id) ?? []);
    return output;
  }

  async audit(
    action: "tool.rating_created" | "tool.rating_updated" | "tool.rating_removed" | "tool.rating_denied",
    actor: string,
    toolId: string,
    metadata: Record<string, number> = {}
  ) {
    await this.pool.query(
      "INSERT INTO audit_events(actor_user_id, action, target_type, target_id, metadata_json) VALUES($1,$2,'tool',$3,$4)",
      [actor, action, toolId, JSON.stringify(metadata)]
    );
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await run(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function requireTool(client: Pick<Pool, "query"> | PoolClient, id: string, active: boolean) {
  const result = await client.query<{ archived_at: string | null; is_active: boolean }>(
    "SELECT archived_at, is_active FROM tool_definitions WHERE id=$1",
    [id]
  );
  if (!result.rowCount) throw new ToolError("TOOL_NOT_FOUND");
  if (active && (result.rows[0].archived_at || !result.rows[0].is_active)) throw new ToolError("TOOL_ARCHIVED");
}

function row(value: any): ToolRating {
  return {
    id: String(value.id),
    toolId: String(value.toolId),
    userId: String(value.userId),
    rating: Number(value.rating),
    createdAt: new Date(value.createdAt).toISOString(),
    updatedAt: new Date(value.updatedAt).toISOString()
  };
}