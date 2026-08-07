import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { ToolError } from "../../tools/contracts.ts";
import type {
  ToolReviewDeveloperReplyAuditAction,
  ToolReviewDeveloperReplyListEntry,
  ToolReviewDeveloperReplyRecord,
  ToolReviewDeveloperReplyRepository
} from "../../tools/toolReviewDeveloperReplyRepository.ts";

const REPLY_COLUMNS = `id, review_id AS "reviewId", author_id AS "authorId", body, status,
  created_at AS "createdAt", updated_at AS "updatedAt", removed_at AS "removedAt", removed_by AS "removedBy"`;

export class PostgresToolReviewDeveloperReplyRepository implements ToolReviewDeveloperReplyRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='tool_review_developer_replies'"
    );
    if (Number(result.rows[0]?.count) !== 1) throw new Error("tool_review_developer_reply_schema_invalid");
  }

  async getByReview(reviewId: string) {
    const result = await this.pool.query<ToolReviewDeveloperReplyRecord>(
      `SELECT ${REPLY_COLUMNS} FROM tool_review_developer_replies WHERE review_id=$1`,
      [reviewId]
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async upsert(reviewId: string, authorId: string, body: string) {
    const result = await this.pool.query<ToolReviewDeveloperReplyRecord>(
      `INSERT INTO tool_review_developer_replies(id, review_id, author_id, body, status)
       VALUES($1, $2, $3, $4, 'active')
       ON CONFLICT(review_id) DO UPDATE SET
         body=EXCLUDED.body, status='active', updated_at=now(), removed_at=NULL, removed_by=NULL
       RETURNING ${REPLY_COLUMNS}`,
      [randomUUID(), reviewId, authorId, body]
    );
    return toRecord(result.rows[0]);
  }

  async remove(reviewId: string, actorId: string) {
    const result = await this.pool.query<ToolReviewDeveloperReplyRecord>(
      `UPDATE tool_review_developer_replies SET status='removed', updated_at=now(), removed_at=now(), removed_by=$2::uuid
       WHERE review_id=$1 AND status='active'
       RETURNING ${REPLY_COLUMNS}`,
      [reviewId, actorId]
    );
    if (result.rowCount) return toRecord(result.rows[0]);
    const existing = await this.pool.query<ToolReviewDeveloperReplyRecord>(
      `SELECT ${REPLY_COLUMNS} FROM tool_review_developer_replies WHERE review_id=$1`,
      [reviewId]
    );
    if (!existing.rowCount) throw new ToolError("REPLY_NOT_FOUND");
    return toRecord(existing.rows[0]);
  }

  async listForReviews(reviewIds: string[]): Promise<Map<string, ToolReviewDeveloperReplyListEntry>> {
    if (!reviewIds.length) return new Map();
    const result = await this.pool.query<ToolReviewDeveloperReplyRecord>(
      `SELECT ${REPLY_COLUMNS} FROM tool_review_developer_replies WHERE review_id = ANY($1::uuid[]) AND status='active'`,
      [reviewIds]
    );
    return new Map(result.rows.map((row) => {
      const record = toRecord(row);
      return [record.reviewId, {
        id: record.id,
        reviewId: record.reviewId,
        body: record.body,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        edited: Date.parse(record.updatedAt) > Date.parse(record.createdAt)
      }];
    }));
  }

  async audit(action: ToolReviewDeveloperReplyAuditAction, actor: string, metadata: Record<string, string> = {}) {
    await this.pool.query(
      "INSERT INTO audit_events(actor_user_id, action, target_type, target_id, metadata_json) VALUES($1,$2,'tool_review',$3,$4)",
      [actor, action, metadata.reviewId ?? null, JSON.stringify(metadata)]
    );
  }
}

function toRecord(value: any): ToolReviewDeveloperReplyRecord {
  return {
    id: String(value.id),
    reviewId: String(value.reviewId),
    authorId: String(value.authorId),
    body: String(value.body),
    status: value.status,
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
    ...(value.removedAt ? { removedAt: iso(value.removedAt) } : {}),
    ...(value.removedBy ? { removedBy: String(value.removedBy) } : {})
  };
}

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}