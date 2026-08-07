import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { ToolError } from "../../tools/contracts.ts";
import type {
  ToolReviewRecord,
  ToolReviewReason,
  ToolReviewReportStatus,
  ToolReviewStatus
} from "../../tools/toolReviewRepository.ts";
import type {
  ToolReviewReportPage,
  ToolReviewReportQuery,
  ToolReviewReportRecord,
  ToolReviewReportView
} from "../../tools/toolReviewReportRepository.ts";

const REPORT_COLUMNS = `id, review_id AS "reviewId", reporter_user_id AS "reporterUserId", reason, details,
  status, created_at AS "createdAt", resolved_at AS "resolvedAt", resolved_by AS "resolvedBy"`;

export class PostgresToolReviewReportRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='tool_review_reports'"
    );
    if (Number(result.rows[0]?.count) !== 1) throw new Error("tool_review_report_schema_invalid");
  }

  async create(input: {
    reviewId: string;
    reporterUserId: string;
    reason: ToolReviewReason;
    details?: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const review = (await client.query<ToolReviewRecord>(
        `SELECT id, tool_id AS "toolId", user_id AS "userId", title, body, status,
                created_at AS "createdAt", updated_at AS "updatedAt",
                moderated_at AS "moderatedAt", moderated_by AS "moderatedBy", moderation_reason AS "moderationReason"
         FROM tool_reviews WHERE id=$1`,
        [input.reviewId]
      )).rows[0];
      if (!review || review.status !== "active") throw new ToolError("REVIEW_NOT_FOUND");
      if (review.userId === input.reporterUserId) throw new ToolError("REVIEW_SELF_REPORT_DENIED");
      const result = await client.query<ToolReviewReportRecord>(
        `INSERT INTO tool_review_reports(id, review_id, reporter_user_id, reason, details)
         VALUES($1, $2, $3, $4, $5)
         ON CONFLICT(review_id, reporter_user_id) DO NOTHING
         RETURNING ${REPORT_COLUMNS}`,
        [randomUUID(), input.reviewId, input.reporterUserId, input.reason, input.details ?? null]
      );
      if (!result.rowCount) throw new ToolError("REVIEW_ALREADY_REPORTED");
      await client.query("COMMIT");
      return { report: toReport(result.rows[0]), review: toStoredReview(review) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async list(query: ToolReviewReportQuery): Promise<ToolReviewReportPage> {
    const values: unknown[] = [];
    const clauses = ["rep.id IS NOT NULL"];
    if (query.status) {
      values.push(query.status);
      clauses.push(`rep.status=$${values.length}`);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const count = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM tool_review_reports rep ${where}`, values
    );
    const limit = values.length + 1;
    const offset = values.length + 2;
    const result = await this.pool.query(
      `SELECT rep.id, rep.review_id AS "reviewId", rep.reporter_user_id AS "reporterUserId", rep.reason, rep.details,
              rep.status, rep.created_at AS "createdAt", rep.resolved_at AS "resolvedAt", rep.resolved_by AS "resolvedBy",
              coalesce(nullif(u.display_name,''), nullif(u.steam_nickname,''), 'Nexus User') AS "reporterName",
              u.avatar_url AS "reporterAvatarUrl",
              t.id AS "toolId", t.name AS "toolName", t.slug AS "toolSlug",
              rev.id AS "rId", rev.user_id AS "rUserId", rev.title AS "rTitle", rev.body AS "rBody", rev.status AS "rStatus",
              rev.created_at AS "rCreatedAt", rev.updated_at AS "rUpdatedAt",
              rev.moderated_at AS "rModeratedAt", rev.moderated_by AS "rModeratedBy", rev.moderation_reason AS "rModerationReason",
              coalesce(nullif(a.display_name,''), nullif(a.steam_nickname,''), 'Nexus User') AS "rAuthorName"
       FROM tool_review_reports rep
       JOIN tool_reviews rev ON rev.id=rep.review_id
       JOIN tool_definitions t ON t.id=rev.tool_id
       JOIN users u ON u.id=rep.reporter_user_id
       LEFT JOIN users a ON a.id=rev.user_id
       ${where}
       ORDER BY rep.created_at DESC, rep.id
       LIMIT $${limit} OFFSET $${offset}`,
      [...values, query.pageSize, (query.page - 1) * query.pageSize]
    );
    return {
      items: result.rows.map((row) => toView(row)),
      total: Number(count.rows[0]?.count ?? 0),
      page: query.page,
      pageSize: query.pageSize
    };
  }

  async setStatus(id: string, status: "resolved" | "dismissed", actor: string) {
    const result = await this.pool.query<ToolReviewReportRecord>(
      `UPDATE tool_review_reports SET status=$2, resolved_at=now(), resolved_by=$3::uuid
       WHERE id=$1 AND status='open'
       RETURNING ${REPORT_COLUMNS}`,
      [id, status, actor]
    );
    if (result.rowCount) return { report: toReport(result.rows[0]), changed: true };
    const existing = await this.pool.query<ToolReviewReportRecord>(
      `SELECT ${REPORT_COLUMNS} FROM tool_review_reports WHERE id=$1`,
      [id]
    );
    if (!existing.rowCount) throw new ToolError("REPORT_NOT_FOUND");
    return { report: toReport(existing.rows[0]), changed: false };
  }

  async countByReview(reviewIds: string[]): Promise<Map<string, number>> {
    if (!reviewIds.length) return new Map();
    const result = await this.pool.query<{ reviewId: string; count: string }>(
      "SELECT review_id AS \"reviewId\", count(*) AS count FROM tool_review_reports WHERE review_id = ANY($1::uuid[]) GROUP BY review_id",
      [reviewIds]
    );
    return new Map(result.rows.map((row) => [String(row.reviewId), Number(row.count)]));
  }

  async audit(
    action: "tool.review_reported" | "tool.review_report_resolved" | "tool.review_report_dismissed" | "tool.review_denied",
    actor: string,
    metadata: Record<string, string> = {}
  ) {
    await this.pool.query(
      "INSERT INTO audit_events(actor_user_id, action, target_type, target_id, metadata_json) VALUES($1,$2,'tool_review_report',$3,$4)",
      [actor, action, metadata.reportId ?? null, JSON.stringify(metadata)]
    );
  }
}

function toReport(value: any): ToolReviewReportRecord {
  return {
    id: String(value.id),
    reviewId: String(value.reviewId),
    reporterUserId: String(value.reporterUserId),
    reason: value.reason as ToolReviewReason,
    ...(value.details ? { details: String(value.details) } : {}),
    status: value.status,
    createdAt: iso(value.createdAt),
    ...(value.resolvedAt ? { resolvedAt: iso(value.resolvedAt) } : {}),
    ...(value.resolvedBy ? { resolvedBy: String(value.resolvedBy) } : {})
  };
}

function toStoredReview(value: any): ToolReviewRecord {
  return {
    id: String(value.id),
    toolId: String(value.toolId),
    userId: String(value.userId),
    ...(value.title ? { title: String(value.title) } : {}),
    body: String(value.body),
    status: value.status,
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
    ...(value.moderatedAt ? { moderatedAt: iso(value.moderatedAt) } : {}),
    ...(value.moderatedBy ? { moderatedBy: String(value.moderatedBy) } : {}),
    ...(value.moderationReason ? { moderationReason: String(value.moderationReason) } : {})
  };
}

function toView(value: any): ToolReviewReportView {
  return {
    id: String(value.id),
    reviewId: String(value.reviewId),
    reporterUserId: String(value.reporterUserId),
    reason: value.reason as ToolReviewReason,
    ...(value.details ? { details: String(value.details) } : {}),
    status: value.status,
    createdAt: iso(value.createdAt),
    ...(value.resolvedAt ? { resolvedAt: iso(value.resolvedAt) } : {}),
    ...(value.resolvedBy ? { resolvedBy: String(value.resolvedBy) } : {}),
    reporterName: String(value.reporterName),
    ...(value.reporterAvatarUrl ? { reporterAvatarUrl: String(value.reporterAvatarUrl) } : {}),
    tool: {
      id: String(value.toolId),
      name: String(value.toolName),
      slug: String(value.toolSlug)
    },
    review: {
      id: String(value.rId),
      userId: String(value.rUserId),
      authorName: String(value.rAuthorName),
      ...(value.rTitle ? { title: String(value.rTitle) } : {}),
      body: String(value.rBody),
      status: value.rStatus,
      createdAt: iso(value.rCreatedAt),
      updatedAt: iso(value.rUpdatedAt),
      ...(value.rModeratedAt ? { moderatedAt: iso(value.rModeratedAt) } : {}),
      ...(value.rModeratedBy ? { moderatedBy: String(value.rModeratedBy) } : {}),
      ...(value.rModerationReason ? { moderationReason: String(value.rModerationReason) } : {})
    }
  };
}

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}