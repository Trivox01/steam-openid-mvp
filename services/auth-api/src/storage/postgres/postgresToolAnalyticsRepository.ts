import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ToolError } from "../../tools/contracts.ts";
import type {
  ToolAnalyticsRepository,
  ToolEventKind
} from "../../tools/toolAnalyticsRepository.ts";
import { trendWeightForDay } from "../../tools/toolTrendingScore.ts";

export class PostgresToolAnalyticsRepository implements ToolAnalyticsRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='tool_events'"
    );
    if (Number(result.rows[0]?.count) !== 1) throw new Error("tool_analytics_schema_invalid");
  }

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
    return this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${input.toolId}:${input.kind}:${input.userId ?? input.dedupeKey}`]
      );
      const recent = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM tool_events
           WHERE tool_id=$1 AND event_type=$2
             AND created_at >= to_timestamp($3::double precision / 1000.0)
             AND (user_id=$4 OR (user_id IS NULL AND dedupe_key=$5))
           LIMIT 1
         ) AS exists`,
        [input.toolId, input.kind, input.now - input.windowMs, input.userId ?? null, input.dedupeKey]
      );
      if (recent.rows[0]?.exists) return { recorded: false };
      await client.query(
        `INSERT INTO tool_events(id, tool_id, user_id, event_type, dedupe_key, created_at)
         VALUES($1,$2,$3,$4,$5,to_timestamp($6::double precision / 1000.0))`,
        [randomUUID(), input.toolId, input.userId ?? null, input.kind, input.dedupeKey, input.now]
      );
      return { recorded: true };
    });
  }

  async totals(kind: ToolEventKind, toolIds: string[]) {
    const result = new Map<string, number>();
    if (!toolIds.length) return result;
    const rows = await this.pool.query<{ toolId: string; count: string }>(
      `SELECT tool_id AS "toolId", count(*) AS count FROM tool_events
       WHERE event_type=$1 AND tool_id=ANY($2::uuid[]) GROUP BY tool_id`,
      [kind, toolIds]
    );
    for (const id of toolIds) result.set(id, 0);
    for (const row of rows.rows) result.set(String(row.toolId), Number(row.count));
    return result;
  }

  async lifetimeTotals(kind: ToolEventKind) {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM tool_events WHERE event_type=$1",
      [kind]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async windowTotals(kind: ToolEventKind, sinceMs: number) {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM tool_events WHERE event_type=$1 AND created_at >= to_timestamp($2::double precision / 1000.0)`,
      [kind, sinceMs]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async dailySeries(toolId: string, kind: ToolEventKind, sinceMs: number) {
    const rows = await this.pool.query<{ date: string; count: string }>(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date, count(*) AS count
       FROM tool_events WHERE tool_id=$1 AND event_type=$2
         AND created_at >= to_timestamp($3::double precision / 1000.0)
       GROUP BY 1 ORDER BY 1`,
      [toolId, kind, sinceMs]
    );
    return rows.rows.map((row) => ({ date: row.date, count: Number(row.count) }));
  }

  async windowScores(
    toolIds: string[],
    sinceMs: number,
    now: number
  ): Promise<Map<string, { views: number; downloadClicks: number }>> {
    const result = new Map<string, { views: number; downloadClicks: number }>();
    if (!toolIds.length) return result;
    for (const id of toolIds) result.set(id, { views: 0, downloadClicks: 0 });
    const rows = await this.pool.query<{ toolId: string; kind: string; daysAgo: string; count: string }>(
      `SELECT tool_id AS "toolId", event_type AS kind,
         floor(EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int AS "daysAgo",
         count(*) AS count
       FROM tool_events
       WHERE tool_id=ANY($1::uuid[]) AND created_at >= to_timestamp($2::double precision / 1000.0)
       GROUP BY tool_id, event_type, floor(EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int`,
      [toolIds, sinceMs]
    );
    for (const row of rows.rows) {
      const entry = result.get(String(row.toolId));
      if (!entry) continue;
      const weighted = Number(row.count) * trendWeightForDay(Number(row.daysAgo), 0.9);
      if (row.kind === "view") entry.views += weighted;
      else entry.downloadClicks += weighted;
    }
    return result;
  }

  async purgeOlderThan(cutoffMs: number) {
    const result = await this.pool.query(
      `DELETE FROM tool_events WHERE created_at < to_timestamp($1::double precision / 1000.0)`,
      [cutoffMs]
    );
    return result.rowCount ?? 0;
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