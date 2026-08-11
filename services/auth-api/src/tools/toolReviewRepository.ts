import { randomUUID } from "node:crypto";
import { ToolError } from "./contracts.ts";
import type { ToolRepository } from "./toolRepository.ts";
import type { ToolRatingRepository } from "./toolRatingRepository.ts";
import type { ToolReviewDeveloperReplyListEntry } from "./toolReviewDeveloperReplyRepository.ts";

export const REVIEW_LIMITS = {
  title: 100,
  body: 2500,
  reportDetails: 500,
  moderationReason: 500
} as const;

export type ToolReviewStatus = "active" | "hidden" | "removed";
export type ToolReviewSort = "newest" | "highest_rating" | "lowest_rating";
export type ToolReviewReason = "spam" | "harassment" | "unsafe_link" | "misleading" | "inappropriate" | "other";
export const TOOL_REVIEW_REASONS: readonly ToolReviewReason[] = [
  "spam", "harassment", "unsafe_link", "misleading", "inappropriate", "other"
];
export type ToolReviewReportStatus = "open" | "resolved" | "dismissed";

export interface ToolReviewRecord {
  id: string;
  toolId: string;
  userId: string;
  title?: string;
  body: string;
  status: ToolReviewStatus;
  createdAt: string;
  updatedAt: string;
  moderatedAt?: string;
  moderatedBy?: string;
  moderationReason?: string;
}

export interface ToolReviewView extends ToolReviewRecord {
  edited: boolean;
  displayName: string;
  avatarUrl?: string;
  rating: number | null;
  helpfulCount: number;
  currentUserHelpful?: boolean;
  developerReply?: {
    id: string;
    body: string;
    createdAt: string;
    updatedAt: string;
    edited: boolean;
  };
}

export interface ToolReviewDraft {
  title?: string;
  body: string;
}

export interface ToolReviewListQuery {
  page: number;
  pageSize: number;
  sort: ToolReviewSort;
}

export interface ToolReviewPage {
  items: ToolReviewView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ToolReviewAdminQuery {
  page: number;
  pageSize: number;
  status?: ToolReviewStatus;
  reportedOnly?: boolean;
}

export interface ToolReviewAdminView {
  id: string;
  toolId: string;
  userId: string;
  displayName: string;
  title?: string;
  body: string;
  status: ToolReviewStatus;
  rating: number | null;
  reportsCount: number;
  tool: { id: string; name: string; slug: string };
  createdAt: string;
  updatedAt: string;
  developerReply?: ToolReviewDeveloperReplyListEntry;
}

export interface ToolReviewAdminPage {
  items: ToolReviewAdminView[];
  total: number;
  page: number;
  pageSize: number;
}

export type ToolReviewAuditAction =
  | "tool.review_created"
  | "tool.review_updated"
  | "tool.review_removed"
  | "tool.review_denied"
  | "tool.review_hidden"
  | "tool.review_restored"
  | "tool.review_moderated_removed";

export interface ReviewUserLookup {
  displayName(userId: string): Promise<string | undefined>;
  avatarUrl(userId: string): Promise<string | undefined>;
}

export interface ToolReviewRepository {
  validateSchema(): Promise<void>;
  save(toolId: string, userId: string, draft: ToolReviewDraft): Promise<{ review: ToolReviewRecord; created: boolean }>;
  remove(toolId: string, userId: string): Promise<ToolReviewRecord>;
  getMine(toolId: string, userId: string): Promise<ToolReviewRecord | undefined>;
  getById(reviewId: string): Promise<ToolReviewRecord | undefined>;
  listActive(toolId: string, query: ToolReviewListQuery, viewerId?: string): Promise<ToolReviewPage>;
  countActive(toolId: string): Promise<number>;
  listAdmin(query: ToolReviewAdminQuery): Promise<{ items: Omit<ToolReviewAdminView, "reportsCount">[]; total: number; page: number; pageSize: number }>;
  setStatus(reviewId: string, status: ToolReviewStatus, moderatorId: string, reason?: string): Promise<ToolReviewRecord>;
  audit(action: ToolReviewAuditAction, actor: string, toolId: string, metadata?: Record<string, string>): Promise<void>;
}

export interface ReviewReportSource {
  hasReports(reviewId: string): boolean;
}

export interface ReviewHelpfulSource {
  counts(reviewIds: string[]): Promise<Map<string, number>>;
  flags(reviewIds: string[], userId: string): Promise<Set<string>>;
}

export interface ReviewReplySource {
  listForReviews(reviewIds: string[]): Promise<Map<string, ToolReviewDeveloperReplyListEntry>>;
}

const noopUser: ReviewUserLookup = {
  async displayName() { return undefined; },
  async avatarUrl() { return undefined; }
};

export class InMemoryToolReviewRepository implements ToolReviewRepository {
  readonly reviews = new Map<string, ToolReviewRecord>();
  readonly auditEvents: Array<{ action: string; actor: string; toolId: string; metadata: Record<string, string> }> = [];
  readonly tools: ToolRepository;
  private readonly users: ReviewUserLookup;
  private readonly ratings?: ToolRatingRepository;
  private reportsSource?: ReviewReportSource;
  private helpfulSource?: ReviewHelpfulSource;
  private replySource?: ReviewReplySource;

  constructor(tools: ToolRepository, users?: ReviewUserLookup, ratings?: ToolRatingRepository) {
    this.tools = tools;
    this.users = users ?? noopUser;
    this.ratings = ratings;
  }

  attachReportSource(source: ReviewReportSource) {
    this.reportsSource = source;
  }

  attachHelpfulSource(source: ReviewHelpfulSource) {
    this.helpfulSource = source;
  }

  attachReplySource(source: ReviewReplySource) {
    this.replySource = source;
  }

  async validateSchema() {}

  async save(toolId: string, userId: string, draft: ToolReviewDraft) {
    await this.requireActive(toolId);
    const key = `${toolId}:${userId}`;
    const current = this.reviews.get(key);
    const now = new Date().toISOString();
    if (current && (current.status === "hidden" || current.moderatedBy)) {
      throw new ToolError("REVIEW_NOT_EDITABLE");
    }
    const review: ToolReviewRecord = {
      id: current?.id ?? randomUUID(),
      toolId,
      userId,
      ...(draft.title ? { title: draft.title } : {}),
      body: draft.body,
      status: "active",
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      moderatedAt: undefined,
      moderatedBy: undefined,
      moderationReason: undefined
    };
    this.reviews.set(key, review);
    return { review, created: !current };
  }

  async remove(toolId: string, userId: string) {
    const key = `${toolId}:${userId}`;
    const current = this.reviews.get(key);
    if (!current) throw new ToolError("REVIEW_NOT_FOUND");
    // Moderation columns are audit evidence and survive a user deletion. Clearing
    // them here used to let an author erase a moderator's decision by deleting the
    // hidden review, after which save() no longer saw any moderation and allowed a
    // rewrite.
    const review: ToolReviewRecord = { ...current, status: "removed" };
    this.reviews.set(key, review);
    return review;
  }

  async getMine(toolId: string, userId: string) {
    if (!await this.tools.get(toolId)) throw new ToolError("TOOL_NOT_FOUND");
    return this.reviews.get(`${toolId}:${userId}`);
  }

  async getById(reviewId: string) {
    return [...this.reviews.values()].find((review) => review.id === reviewId);
  }

  async listActive(toolId: string, query: ToolReviewListQuery, viewerId?: string) {
    if (!await this.tools.get(toolId)) throw new ToolError("TOOL_NOT_FOUND");
    let items = [...this.reviews.values()].filter((review) => review.toolId === toolId && review.status === "active");
    if (query.sort === "highest_rating" || query.sort === "lowest_rating") {
      const withRatings = await Promise.all(items.map(async (review) => ({
        review,
        rating: (await this.ratings?.getMine(toolId, review.userId).catch(() => undefined))?.rating ?? null
      })));
      withRatings.sort((left, right) => {
        if (query.sort === "highest_rating") {
          if (left.rating === null && right.rating === null) return Date.parse(right.review.createdAt) - Date.parse(left.review.createdAt);
          if (left.rating === null) return 1;
          if (right.rating === null) return -1;
          return right.rating - left.rating || Date.parse(right.review.createdAt) - Date.parse(left.review.createdAt);
        }
        if (left.rating === null && right.rating === null) return Date.parse(right.review.createdAt) - Date.parse(left.review.createdAt);
        if (left.rating === null) return 1;
        if (right.rating === null) return -1;
        return left.rating - right.rating || Date.parse(right.review.createdAt) - Date.parse(left.review.createdAt);
      });
      items = withRatings.map((entry) => entry.review);
    } else {
      items.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id));
    }
    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    const page = items.slice(start, start + query.pageSize);
    const views = await Promise.all(page.map((review) => this.toView(review)));
    const reviewIds = page.map((review) => review.id);
    if (this.helpfulSource && reviewIds.length) {
      const counts = await this.helpfulSource.counts(reviewIds);
      const flagged = viewerId ? await this.helpfulSource.flags(reviewIds, viewerId) : undefined;
      for (const view of views) {
        view.helpfulCount = counts.get(view.id) ?? 0;
        if (flagged) view.currentUserHelpful = flagged.has(view.id);
      }
    }
    if (this.replySource && reviewIds.length) {
      const replies = await this.replySource.listForReviews(reviewIds);
      for (const view of views) {
        const reply = replies.get(view.id);
        if (reply) view.developerReply = reply;
      }
    }
    return { items: views, total, page: query.page, pageSize: query.pageSize };
  }

  async countActive(toolId: string) {
    return [...this.reviews.values()].filter((review) => review.toolId === toolId && review.status === "active").length;
  }

  async setStatus(reviewId: string, status: ToolReviewStatus, moderatorId: string, reason?: string) {
    const key = [...this.reviews.keys()].find((reviewKey) => this.reviews.get(reviewKey)?.id === reviewId);
    const current = key ? this.reviews.get(key) : undefined;
    if (!current) throw new ToolError("REVIEW_NOT_FOUND");
    const review: ToolReviewRecord = {
      ...current,
      status,
      ...(status === "active"
        ? { moderatedAt: undefined, moderatedBy: undefined, moderationReason: undefined }
        : { moderatedAt: new Date().toISOString(), moderatedBy: moderatorId, ...(reason ? { moderationReason: reason } : {}) })
    };
    this.reviews.set(key!, review);
    return review;
  }

  async listAdmin(query: ToolReviewAdminQuery): Promise<{ items: Omit<ToolReviewAdminView, "reportsCount">[]; total: number; page: number; pageSize: number }> {
    let entries = [...this.reviews.values()].filter((review) => !query.status || review.status === query.status);
    if (query.reportedOnly) {
      entries = entries.filter((review) => this.reportsSource?.hasReports(review.id) ?? false);
    }
    entries.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id));
    const total = entries.length;
    const start = (query.page - 1) * query.pageSize;
    entries = entries.slice(start, start + query.pageSize);
    const items: Array<Omit<ToolReviewAdminView, "reportsCount">> = [];
    for (const review of entries) {
      const tool = await this.tools.get(review.toolId);
      const displayName = await this.users.displayName(review.userId);
      const rating = (await this.ratings?.getMine(review.toolId, review.userId).catch(() => undefined))?.rating ?? null;
      items.push({
        id: review.id,
        toolId: review.toolId,
        userId: review.userId,
        displayName: displayName ?? "Nexus User",
        ...(review.title ? { title: review.title } : {}),
        body: review.body,
        status: review.status,
        rating,
        tool: tool ? { id: tool.id, name: tool.name, slug: tool.slug } : { id: review.toolId, name: review.toolId, slug: review.toolId },
        createdAt: review.createdAt,
        updatedAt: review.updatedAt
      });
    }
    if (this.replySource && items.length) {
      const replies = await this.replySource.listForReviews(items.map((item) => item.id));
      for (const item of items) {
        const reply = replies.get(item.id);
        if (reply) item.developerReply = reply;
      }
    }
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async audit(action: ToolReviewAuditAction, actor: string, toolId: string, metadata: Record<string, string> = {}) {
    this.auditEvents.push({ action, actor, toolId, metadata });
  }

  private async toView(review: ToolReviewRecord): Promise<ToolReviewView> {
    const displayName = await this.users.displayName(review.userId);
    const avatarUrl = await this.users.avatarUrl(review.userId);
    return {
      ...review,
      edited: Date.parse(review.updatedAt) > Date.parse(review.createdAt),
      displayName: displayName ?? "Nexus User",
      ...(avatarUrl ? { avatarUrl } : {}),
      rating: (await this.ratings?.getMine(review.toolId, review.userId).catch(() => undefined))?.rating ?? null,
      helpfulCount: 0
    };
  }

  private async requireActive(id: string) {
    const tool = await this.tools.get(id);
    if (!tool) throw new ToolError("TOOL_NOT_FOUND");
    if (tool.archivedAt || !tool.isActive) throw new ToolError("TOOL_ARCHIVED");
  }
}