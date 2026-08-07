import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ToolError } from "../../tools/contracts.ts";
import type {
  ToolReviewAdminQuery,
  ToolReviewAdminView,
  ToolReviewListQuery,
  ToolReviewPage,
  ToolReviewRecord,
  ToolReviewStatus,
  ToolReviewView
} from "../../tools/toolReviewRepository.ts";
import { requireTool } from "./postgresToolRatingRepository.ts";

const REVIEW_COLUMNS = `id, tool_id AS "toolId", user_id AS "userId", title, body, status,
  created_at AS "createdAt", updated_at AS "updatedAt",
  moderated_at AS "moderatedAt", moderated_by AS "moderatedBy", moderation_reason AS "moderationReason"`;

export class PostgresToolReviewRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='tool_reviews'"
    );
    if (Number(result.rows[0]?.count) !== 1) throw new Error("tool_review_schema_invalid");
  }

  async save(toolId: string, userId: string, draft: { title?: string; body: string }) {
    return this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${toolId}:${userId}`]
      );
      await requireTool(client, toolId, true);
      const previous = (await client.query<ToolReviewRecord>(
        `SELECT ${REVIEW_COLUMNS} FROM tool_reviews WHERE tool_id=$1 AND user_id=$2`,
        [toolId, userId]
      )).rows[0];
      if (previous && (previous.status === "hidden" || previous.moderatedBy)) {
        throw new ToolError("REVIEW_NOT_EDITABLE");
      }
      const result = await client.query<ToolReviewRecord>(
        `INSERT INTO tool_reviews(id, tool_id, user_id, title, body, status)
         VALUES($1, $2, $3, $4, $5, 'active')
         ON CONFLICT(tool_id, user_id) DO UPDATE SET
           title=EXCLUDED.title, body=EXCLUDED.body, status='active', updated_at=now(),
           moderated_at=NULL, moderated_by=NULL, moderation_reason=NULL
         RETURNING ${REVIEW_COLUMNS}`,
        [randomUUID(), toolId, userId, draft.title ?? null, draft.body]
      );
      return { review: toRecord(result.rows[0]), created: !previous };
    });
  }

  async remove(toolId: string, userId: string) {
    return this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${toolId}:${userId}`]
      );
      const result = await client.query<ToolReviewRecord>(
        `UPDATE tool_reviews SET status='removed', moderated_at=NULL, moderated_by=NULL, moderation_reason=NULL
         WHERE tool_id=$1 AND user_id=$2 AND status<>'removed'
         RETURNING ${REVIEW_COLUMNS}`,
        [toolId, userId]
      );
      if (!result.rowCount) {
        const existing = (await client.query<ToolReviewRecord>(
          `SELECT ${REVIEW_COLUMNS} FROM tool_reviews WHERE tool_id=$1 AND user_id=$2`,
          [toolId, userId]
        )).rows[0];
        if (!existing) throw new ToolError("REVIEW_NOT_FOUND");
        return existing;
      }
      return toRecord(result.rows[0]);
    });
  }

  async getMine(toolId: string, userId: string) {
    await requireTool(this.pool, toolId, false);
    const result = await this.pool.query<ToolReviewRecord>(
      `SELECT ${REVIEW_COLUMNS} FROM tool_reviews WHERE tool_id=$1 AND user_id=$2`,
      [toolId, userId]
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async getById(reviewId: string) {
    const result = await this.pool.query<ToolReviewRecord>(
      `SELECT ${REVIEW_COLUMNS} FROM tool_reviews WHERE id=$1`,
      [reviewId]
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async listActive(toolId: string, query: ToolReviewListQuery, viewerId?: string): Promise<ToolReviewPage> {
    await requireTool(this.pool, toolId, false);
    const order = query.sort === "newest"
      ? "r.created_at DESC, r.id ASC"
      : query.sort === "highest_rating"
        ? "t.rating DESC NULLS LAST, r.created_at DESC, r.id ASC"
        : "t.rating ASC NULLS LAST, r.created_at DESC, r.id ASC";
    const count = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM tool_reviews r WHERE r.tool_id=$1 AND r.status='active'",
      [toolId]
    );
    const rows = await this.pool.query(
      `SELECT r.id, r.tool_id AS "toolId", r.user_id AS "userId", r.title, r.body, r.status,
              r.created_at AS "createdAt", r.updated_at AS "updatedAt",
              r.moderated_at AS "moderatedAt", r.moderated_by AS "moderatedBy", r.moderation_reason AS "moderationReason",
              (r.updated_at > r.created_at) AS edited,
              coalesce(nullif(u.display_name,''), nullif(u.steam_nickname,''), 'Nexus User') AS "displayName",
              u.avatar_url AS "avatarUrl",
              t.rating AS rating,
              coalesce(hc.cnt, 0) AS "helpfulCount",
              (me.review_id IS NOT NULL) AS "currentUserHelpful",
              dr.id AS "drId", dr.body AS "drBody", dr.created_at AS "drCreatedAt", dr.updated_at AS "drUpdatedAt"
       FROM tool_reviews r
       JOIN users u ON u.id=r.user_id
       LEFT JOIN tool_ratings t ON t.tool_id=r.tool_id AND t.user_id=r.user_id
       LEFT JOIN (SELECT review_id, count(*) AS cnt FROM tool_review_helpful_votes GROUP BY review_id) hc ON hc.review_id=r.id
       LEFT JOIN tool_review_developer_replies dr ON dr.review_id=r.id AND dr.status='active'
       LEFT JOIN tool_review_helpful_votes me ON me.review_id=r.id AND me.user_id=$2
       WHERE r.tool_id=$1 AND r.status='active'
       ORDER BY ${order}
       LIMIT $3 OFFSET $4`,
      [toolId, viewerId ?? null, query.pageSize, (query.page - 1) * query.pageSize]
    );
    return {
      items: rows.rows.map((row) => toView(row, viewerId)),
      total: Number(count.rows[0]?.count ?? 0),
      page: query.page,
      pageSize: query.pageSize
    };
  }

  async listAdmin(query: ToolReviewAdminQuery): Promise<{ items: Omit<ToolReviewAdminView, "reportsCount">[]; total: number; page: number; pageSize: number }> {
    const values: unknown[] = [];
    const clauses = ["r.id IS NOT NULL"];
    if (query.status) {
      values.push(query.status);
      clauses.push(`r.status=$${values.length}`);
    }
    if (query.reportedOnly) {
      clauses.push("EXISTS (SELECT 1 FROM tool_review_reports rep WHERE rep.review_id=r.id)");
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const count = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM tool_reviews r ${where}`, values
    );
    const row = await this.pool.query(
      `SELECT r.id, r.tool_id AS "toolId", r.user_id AS "userId", r.title, r.body, r.status,
              r.created_at AS "createdAt", r.updated_at AS "updatedAt",
              coalesce(nullif(u.display_name,''), nullif(u.steam_nickname,''), 'Nexus User') AS "displayName",
              t.name AS "toolName", t.slug AS "toolSlug",
              tr.rating AS rating,
              dr.id AS "drId", dr.body AS "drBody", dr.created_at AS "drCreatedAt", dr.updated_at AS "drUpdatedAt"
       FROM tool_reviews r
       JOIN users u ON u.id=r.user_id
       JOIN tool_definitions t ON t.id=r.tool_id
       LEFT JOIN tool_ratings tr ON tr.tool_id=r.tool_id AND tr.user_id=r.user_id
       LEFT JOIN tool_review_developer_replies dr ON dr.review_id=r.id AND dr.status='active'
       ${where}
       ORDER BY r.created_at DESC, r.id
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, query.pageSize, (query.page - 1) * query.pageSize]
    );
    return {
      items: row.rows.map((value) => toAdminRecord(value)),
      total: Number(count.rows[0]?.count ?? 0),
      page: query.page,
      pageSize: query.pageSize
    };
  }

  async setStatus(reviewId: string, status: ToolReviewStatus, moderatorId: string, reason?: string) {
    const result = await this.pool.query<ToolReviewRecord>(
      `UPDATE tool_reviews SET
         status=$2,
         moderated_at=CASE WHEN $2='active' THEN NULL ELSE now() END,
         moderated_by=CASE WHEN $2='active' THEN NULL ELSE $3::uuid END,
         moderation_reason=CASE WHEN $2='active' THEN NULL ELSE $4 END
       WHERE id=$1
       RETURNING ${REVIEW_COLUMNS}`,
      [reviewId, status, moderatorId, reason ?? null]
    );
    if (!result.rowCount) throw new ToolError("REVIEW_NOT_FOUND");
    return toRecord(result.rows[0]);
  }

  async audit(
    action: "tool.review_created" | "tool.review_updated" | "tool.review_removed" | "tool.review_denied" |
      "tool.review_hidden" | "tool.review_restored" | "tool.review_moderated_removed",
    actor: string,
    toolId: string,
    metadata: Record<string, string> = {}
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

function toRecord(value: any): ToolReviewRecord {
  return {
    id: String(value.id),
    toolId: String(value.toolId),
    userId: String(value.userId),
    ...(value.title ? { title: String(value.title) } : {}),
    body: String(value.body),
    status: value.status as ToolReviewStatus,
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
    ...(value.moderatedAt ? { moderatedAt: iso(value.moderatedAt) } : {}),
    ...(value.moderatedBy ? { moderatedBy: String(value.moderatedBy) } : {}),
    ...(value.moderationReason ? { moderationReason: String(value.moderationReason) } : {})
  };
}

function toAdminRecord(value: any): Omit<ToolReviewAdminView, "reportsCount"> {
  return {
    id: String(value.id),
    toolId: String(value.toolId),
    userId: String(value.userId),
    displayName: String(value.displayName),
    ...(value.title ? { title: String(value.title) } : {}),
    body: String(value.body),
    status: value.status as ToolReviewStatus,
    rating: value.rating === null || value.rating === undefined ? null : Number(value.rating),
    tool: { id: String(value.toolId), name: String(value.toolName), slug: String(value.toolSlug) },
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
    ...(value.drId ? { developerReply: { id: String(value.drId), reviewId: String(value.id), body: String(value.drBody), createdAt: iso(value.drCreatedAt), updatedAt: iso(value.drUpdatedAt), edited: Date.parse(String(value.drUpdatedAt)) > Date.parse(String(value.drCreatedAt)) } } : {})
  };
}

function toView(value: any, viewerId?: string): ToolReviewView {
  return {
    ...toRecord(value),
    edited: Boolean(value.edited),
    displayName: String(value.displayName),
    ...(value.avatarUrl ? { avatarUrl: String(value.avatarUrl) } : {}),
    rating: value.rating === null || value.rating === undefined ? null : Number(value.rating),
    helpfulCount: Number(value.helpfulCount ?? 0),
    ...(viewerId ? { currentUserHelpful: Boolean(value.currentUserHelpful) } : {}),
    ...(value.drId ? { developerReply: { id: String(value.drId), body: String(value.drBody), createdAt: iso(value.drCreatedAt), updatedAt: iso(value.drUpdatedAt), edited: Date.parse(String(value.drUpdatedAt)) > Date.parse(String(value.drCreatedAt)) } } : {})
  };
}

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}