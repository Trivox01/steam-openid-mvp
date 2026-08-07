import { randomUUID } from "node:crypto";
import { ToolError } from "./contracts.ts";
import type { ToolRepository } from "./toolRepository.ts";
import type {
  ToolReviewReason,
  ToolReviewRecord,
  ToolReviewReportStatus,
  ReviewUserLookup,
  ToolReviewRepository
} from "./toolReviewRepository.ts";

export interface ToolReviewReportRecord {
  id: string;
  reviewId: string;
  reporterUserId: string;
  reason: ToolReviewReason;
  details?: string;
  status: ToolReviewReportStatus;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface ToolReviewReportView extends ToolReviewReportRecord {
  reporterName: string;
  reporterAvatarUrl?: string;
  tool: { id: string; name: string; slug: string };
  review: {
    id: string;
    userId: string;
    authorName: string;
    title?: string;
    body: string;
    status: ToolReviewRecord["status"];
    createdAt: string;
    updatedAt: string;
    moderatedAt?: string;
    moderatedBy?: string;
    moderationReason?: string;
  };
}

export interface ToolReviewReportQuery {
  status?: ToolReviewReportStatus;
  page: number;
  pageSize: number;
}

export interface ToolReviewReportPage {
  items: ToolReviewReportView[];
  total: number;
  page: number;
  pageSize: number;
}

export type ToolReviewReportAuditAction =
  | "tool.review_reported"
  | "tool.review_report_resolved"
  | "tool.review_report_dismissed"
  | "tool.review_denied";

export interface ToolReviewReportRepository {
  validateSchema(): Promise<void>;
  create(input: {
    reviewId: string;
    reporterUserId: string;
    reason: ToolReviewReason;
    details?: string;
  }): Promise<{ report: ToolReviewReportRecord; review: ToolReviewRecord }>;
list(query: ToolReviewReportQuery): Promise<ToolReviewReportPage>;
  countByReview(reviewIds: string[]): Promise<Map<string, number>>;
  setStatus(
    id: string,
    status: "resolved" | "dismissed",
    actor: string
  ): Promise<{ report: ToolReviewReportRecord; changed: boolean }>;
  audit(action: ToolReviewReportAuditAction, actor: string, metadata?: Record<string, string>): Promise<void>;
}

export class InMemoryToolReviewReportRepository implements ToolReviewReportRepository {
  readonly reports = new Map<string, ToolReviewReportRecord>();
  readonly auditEvents: Array<{ action: string; actor: string; metadata: Record<string, string> }> = [];
  readonly tools: ToolRepository;
  readonly reviews: ToolReviewRepository;
  private readonly users: ReviewUserLookup;

  constructor(tools: ToolRepository, reviews: ToolReviewRepository, users?: ReviewUserLookup) {
    this.tools = tools;
    this.reviews = reviews;
    this.users = users ?? {
      async displayName() { return undefined; },
      async avatarUrl() { return undefined; }
    };
  }

  async validateSchema() {}

  async create(input: {
    reviewId: string;
    reporterUserId: string;
    reason: ToolReviewReason;
    details?: string;
  }) {
    const review = await this.reviews.getById(input.reviewId);
    if (!review || review.status !== "active") throw new ToolError("REVIEW_NOT_FOUND");
    if (review.userId === input.reporterUserId) throw new ToolError("REVIEW_SELF_REPORT_DENIED");
    const key = `${input.reviewId}:${input.reporterUserId}`;
    if (this.reports.has(key)) throw new ToolError("REVIEW_ALREADY_REPORTED");
    const report: ToolReviewReportRecord = {
      id: randomUUID(),
      reviewId: input.reviewId,
      reporterUserId: input.reporterUserId,
      reason: input.reason,
      ...(input.details ? { details: input.details } : {}),
      status: "open",
      createdAt: new Date().toISOString()
    };
    this.reports.set(key, report);
    return { report, review };
  }

  async list(query: ToolReviewReportQuery): Promise<ToolReviewReportPage> {
    let entries = [...this.reports.values()]
      .filter((report) => !query.status || report.status === query.status)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id));
    const total = entries.length;
    const start = (query.page - 1) * query.pageSize;
    entries = entries.slice(start, start + query.pageSize);
    const items = await Promise.all(entries.map((report) => this.toView(report)));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async setStatus(id: string, status: "resolved" | "dismissed", actor: string) {
    const existing = [...this.reports.values()].find((report) => report.id === id);
    if (!existing) throw new ToolError("REPORT_NOT_FOUND");
    if (existing.status !== "open") return { report: existing, changed: false };
    const updated: ToolReviewReportRecord = {
      ...existing,
      status,
      resolvedAt: new Date().toISOString(),
      resolvedBy: actor
    };
    const key = `${existing.reviewId}:${existing.reporterUserId}`;
    this.reports.set(key, updated);
    return { report: updated, changed: true };
  }

  async countByReview(reviewIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const report of this.reports.values()) {
      if (!reviewIds.includes(report.reviewId)) continue;
      counts.set(report.reviewId, (counts.get(report.reviewId) ?? 0) + 1);
    }
    return counts;
  }

  hasReports(reviewId: string): boolean {
    return [...this.reports.values()].some((report) => report.reviewId === reviewId);
  }

  async audit(action: ToolReviewReportAuditAction, actor: string, metadata: Record<string, string> = {}) {
    this.auditEvents.push({ action, actor, metadata });
  }

  private async toView(report: ToolReviewReportRecord): Promise<ToolReviewReportView> {
    const review = await this.reviews.getById(report.reviewId);
    const reporterName = await this.users.displayName(report.reporterUserId);
    const reporterAvatarUrl = await this.users.avatarUrl(report.reporterUserId);
    const authorName = review ? await this.users.displayName(review.userId) : undefined;
    const tool = review ? await this.tools.get(review.toolId) : undefined;
    return {
      ...report,
      reporterName: reporterName ?? "Nexus User",
      ...(reporterAvatarUrl ? { reporterAvatarUrl } : {}),
      tool: tool
        ? { id: tool.id, name: tool.name, slug: tool.slug }
        : { id: review?.toolId ?? "", name: review?.toolId ?? "", slug: review?.toolId ?? "" },
      review: {
        id: report.reviewId,
        userId: review?.userId ?? "",
        authorName: authorName ?? "Nexus User",
        ...(review?.title ? { title: review.title } : {}),
        body: review?.body ?? "",
        status: review?.status ?? "removed",
        createdAt: review?.createdAt ?? "",
        updatedAt: review?.updatedAt ?? "",
        ...(review?.moderatedAt ? { moderatedAt: review.moderatedAt } : {}),
        ...(review?.moderatedBy ? { moderatedBy: review.moderatedBy } : {}),
        ...(review?.moderationReason ? { moderationReason: review.moderationReason } : {})
      }
    };
  }
}