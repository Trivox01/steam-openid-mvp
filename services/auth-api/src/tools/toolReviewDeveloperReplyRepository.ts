import { randomUUID } from "node:crypto";
import { ToolError } from "./contracts.ts";

export const REPLY_LIMITS = {
  body: 2000
} as const;

export const REVIEW_DEVELOPER_LABEL = "Developer";

export type ToolReviewDeveloperReplyStatus = "active" | "removed";

export interface ToolReviewDeveloperReplyRecord {
  id: string;
  reviewId: string;
  authorId: string;
  body: string;
  status: ToolReviewDeveloperReplyStatus;
  createdAt: string;
  updatedAt: string;
  removedAt?: string;
  removedBy?: string;
}

export interface ToolReviewDeveloperReplyView {
  id: string;
  reviewId: string;
  body: string;
  authorLabel: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
}

export interface ToolReviewDeveloperReplyListEntry {
  id: string;
  reviewId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
}

export type ToolReviewDeveloperReplyAuditAction =
  | "tool.review_developer_reply_created"
  | "tool.review_developer_reply_updated"
  | "tool.review_developer_reply_removed"
  | "tool.review_developer_reply_denied";

export interface ToolReviewDeveloperReplyRepository {
  validateSchema(): Promise<void>;
  getByReview(reviewId: string): Promise<ToolReviewDeveloperReplyRecord | undefined>;
  upsert(reviewId: string, authorId: string, body: string): Promise<ToolReviewDeveloperReplyRecord>;
  remove(reviewId: string, actorId: string): Promise<ToolReviewDeveloperReplyRecord>;
  listForReviews(reviewIds: string[]): Promise<Map<string, ToolReviewDeveloperReplyListEntry>>;
  audit(action: ToolReviewDeveloperReplyAuditAction, actor: string, metadata?: Record<string, string>): Promise<void>;
}

export class InMemoryToolReviewDeveloperReplyRepository implements ToolReviewDeveloperReplyRepository {
  readonly replies = new Map<string, ToolReviewDeveloperReplyRecord>();
  readonly auditEvents: Array<{ action: string; actor: string; metadata: Record<string, string> }> = [];

  async validateSchema() {}

  async getByReview(reviewId: string) {
    return this.replies.get(reviewId);
  }

  async upsert(reviewId: string, authorId: string, body: string) {
    const previous = this.replies.get(reviewId);
    const now = new Date().toISOString();
    const reply: ToolReviewDeveloperReplyRecord = previous
      ? {
          ...previous,
          body,
          status: "active",
          updatedAt: now,
          removedAt: undefined,
          removedBy: undefined
        }
      : {
          id: randomUUID(),
          reviewId,
          authorId,
          body,
          status: "active",
          createdAt: now,
          updatedAt: now
        };
    this.replies.set(reviewId, reply);
    return reply;
  }

  async remove(reviewId: string, actorId: string) {
    const previous = this.replies.get(reviewId);
    if (!previous) throw new ToolError("REPLY_NOT_FOUND");
    const now = new Date().toISOString();
    const reply: ToolReviewDeveloperReplyRecord = {
      ...previous,
      status: "removed",
      updatedAt: now,
      removedAt: now,
      removedBy: actorId
    };
    this.replies.set(reviewId, reply);
    return reply;
  }

  async listForReviews(reviewIds: string[]): Promise<Map<string, ToolReviewDeveloperReplyListEntry>> {
    const found = new Map<string, ToolReviewDeveloperReplyListEntry>();
    for (const reviewId of reviewIds) {
      const reply = this.replies.get(reviewId);
      if (!reply || reply.status !== "active") continue;
      found.set(reviewId, toEntry(reply));
    }
    return found;
  }

  async audit(action: ToolReviewDeveloperReplyAuditAction, actor: string, metadata: Record<string, string> = {}) {
    this.auditEvents.push({ action, actor, metadata });
  }
}

export function toReplyView(record: ToolReviewDeveloperReplyRecord): ToolReviewDeveloperReplyView {
  return {
    id: record.id,
    reviewId: record.reviewId,
    body: record.body,
    authorLabel: REVIEW_DEVELOPER_LABEL,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    edited: Date.parse(record.updatedAt) > Date.parse(record.createdAt)
  };
}

export function toEntry(record: ToolReviewDeveloperReplyRecord): ToolReviewDeveloperReplyListEntry {
  return {
    id: record.id,
    reviewId: record.reviewId,
    body: record.body,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    edited: Date.parse(record.updatedAt) > Date.parse(record.createdAt)
  };
}

export function parseReplyDraft(value: unknown): { body: string } {
  if (value === null || typeof value !== "object") throw new ToolError("REPLY_BODY_REQUIRED");
  const draft = value as Record<string, unknown>;
  const body = typeof draft.body === "string" ? draft.body.trim() : "";
  if (!body) throw new ToolError("REPLY_BODY_REQUIRED");
  if (body.length > REPLY_LIMITS.body) throw new ToolError("REPLY_BODY_TOO_LONG");
  return { body };
}