export interface ToolReviewHelpfulRecord {
  reviewId: string;
  userId: string;
  createdAt: string;
}

export type ToolReviewHelpfulAuditAction =
  | "tool.review_helpful_added"
  | "tool.review_helpful_removed"
  | "tool.review_helpful_denied";

export interface ToolReviewHelpfulRepository {
  validateSchema(): Promise<void>;
  add(reviewId: string, userId: string): Promise<void>;
  remove(reviewId: string, userId: string): Promise<void>;
  has(reviewId: string, userId: string): Promise<boolean>;
  counts(reviewIds: string[]): Promise<Map<string, number>>;
  flags(reviewIds: string[], userId: string): Promise<Set<string>>;
  audit(action: ToolReviewHelpfulAuditAction, actor: string, metadata?: Record<string, string>): Promise<void>;
}

export class InMemoryToolReviewHelpfulRepository implements ToolReviewHelpfulRepository {
  readonly votes = new Map<string, ToolReviewHelpfulRecord>();
  readonly auditEvents: Array<{ action: string; actor: string; metadata: Record<string, string> }> = [];

  async validateSchema() {}

  voteKey(reviewId: string, userId: string) {
    return `${reviewId}:${userId}`;
  }

  async add(reviewId: string, userId: string) {
    const key = this.voteKey(reviewId, userId);
    if (this.votes.has(key)) return;
    this.votes.set(key, { reviewId, userId, createdAt: new Date().toISOString() });
  }

  async remove(reviewId: string, userId: string) {
    this.votes.delete(this.voteKey(reviewId, userId));
  }

  async has(reviewId: string, userId: string) {
    return this.votes.has(this.voteKey(reviewId, userId));
  }

  async counts(reviewIds: string[]): Promise<Map<string, number>> {
    return countVotes(this.votes, reviewIds);
  }

  async flags(reviewIds: string[], userId: string): Promise<Set<string>> {
    const flagged = new Set<string>();
    for (const reviewId of reviewIds) {
      if (this.votes.has(this.voteKey(reviewId, userId))) flagged.add(reviewId);
    }
    return flagged;
  }

  async audit(action: ToolReviewHelpfulAuditAction, actor: string, metadata: Record<string, string> = {}) {
    this.auditEvents.push({ action, actor, metadata });
  }
}

export function countVotes(entries: ReadonlyMap<string, ToolReviewHelpfulRecord>, reviewIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const reviewId of reviewIds) counts.set(reviewId, 0);
  for (const vote of entries.values()) {
    const count = counts.get(vote.reviewId);
    if (count !== undefined) counts.set(vote.reviewId, count + 1);
  }
  return counts;
}