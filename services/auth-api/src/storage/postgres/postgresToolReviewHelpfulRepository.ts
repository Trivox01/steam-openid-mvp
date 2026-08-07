import type { Pool } from "pg";
import type { ToolReviewHelpfulAuditAction, ToolReviewHelpfulRepository } from "../../tools/toolReviewHelpfulRepository.ts";

export class PostgresToolReviewHelpfulRepository implements ToolReviewHelpfulRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='tool_review_helpful_votes'"
    );
    if (Number(result.rows[0]?.count) !== 1) throw new Error("tool_review_helpful_schema_invalid");
  }

  async add(reviewId: string, userId: string) {
    await this.pool.query(
      "INSERT INTO tool_review_helpful_votes(review_id, user_id) VALUES($1,$2) ON CONFLICT(review_id,user_id) DO NOTHING",
      [reviewId, userId]
    );
  }

  async remove(reviewId: string, userId: string) {
    await this.pool.query("DELETE FROM tool_review_helpful_votes WHERE review_id=$1 AND user_id=$2", [reviewId, userId]);
  }

  async has(reviewId: string, userId: string) {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM tool_review_helpful_votes WHERE review_id=$1 AND user_id=$2",
      [reviewId, userId]
    );
    return Number(result.rows[0]?.count ?? 0) > 0;
  }

  async counts(reviewIds: string[]): Promise<Map<string, number>> {
    if (!reviewIds.length) return new Map();
    const result = await this.pool.query<{ reviewId: string; count: string }>(
      "SELECT review_id AS \"reviewId\", count(*) AS count FROM tool_review_helpful_votes WHERE review_id = ANY($1::uuid[]) GROUP BY review_id",
      [reviewIds]
    );
    return new Map(result.rows.map((row) => [String(row.reviewId), Number(row.count)]));
  }

  async flags(reviewIds: string[], userId: string): Promise<Set<string>> {
    if (!reviewIds.length) return new Set();
    const result = await this.pool.query<{ reviewId: string }>(
      "SELECT review_id AS \"reviewId\" FROM tool_review_helpful_votes WHERE review_id = ANY($1::uuid[]) AND user_id=$2",
      [reviewIds, userId]
    );
    return new Set(result.rows.map((row) => String(row.reviewId)));
  }

  async audit(action: ToolReviewHelpfulAuditAction, actor: string, metadata: Record<string, string> = {}) {
    await this.pool.query(
      "INSERT INTO audit_events(actor_user_id, action, target_type, target_id, metadata_json) VALUES($1,$2,'tool_review',$3,$4)",
      [actor, action, metadata.reviewId ?? null, JSON.stringify(metadata)]
    );
  }
}