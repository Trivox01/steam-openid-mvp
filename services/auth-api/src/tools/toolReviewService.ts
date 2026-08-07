import { ToolError } from "./contracts.ts";
import { REVIEW_LIMITS, TOOL_REVIEW_REASONS } from "./toolReviewRepository.ts";
import type { ToolReviewReason } from "./toolReviewRepository.ts";
import type {
  ToolReviewAdminPage,
  ToolReviewAdminQuery,
  ToolReviewListQuery,
  ToolReviewSort,
  ToolReviewDraft,
  ToolReviewRepository
} from "./toolReviewRepository.ts";
import type { ToolReviewReportRepository } from "./toolReviewReportRepository.ts";

const MAX_PAGE_SIZE = 50;

export class ToolReviewService {
  readonly repository: ToolReviewRepository;
  readonly reports: ToolReviewReportRepository;

  constructor(repository: ToolReviewRepository, reports: ToolReviewReportRepository) {
    this.repository = repository;
    this.reports = reports;
  }

  list(toolId: string, query: ToolReviewListQuery) {
    return this.repository.listActive(toolId, query);
  }

  async mine(toolId: string, userId: string) {
    return (await this.repository.getMine(toolId, userId)) ?? undefined;
  }

  async save(toolId: string, userId: string, value: unknown) {
    const draft = parseReviewDraft(value);
    try {
      const result = await this.repository.save(toolId, userId, draft);
      await this.repository.audit(
        result.created ? "tool.review_created" : "tool.review_updated",
        userId,
        toolId,
        result.created ? {} : { edited: "true" }
      ).catch(() => {});
      return { review: result.review, created: result.created };
    } catch (error) {
      await this.repository.audit("tool.review_denied", userId, toolId).catch(() => {});
      throw error;
    }
  }

  async remove(toolId: string, userId: string) {
    try {
      const previous = await this.repository.remove(toolId, userId);
      await this.repository.audit("tool.review_removed", userId, toolId, {
        status: previous.status
      }).catch(() => {});
    } catch (error) {
      await this.repository.audit("tool.review_denied", userId, toolId).catch(() => {});
      throw error;
    }
  }

  async report(reviewId: string, userId: string, value: unknown) {
    const { reason, details } = parseReportDraft(value);
    try {
      const { report, review } = await this.reports.create({
        reviewId,
        reporterUserId: userId,
        reason,
        ...(details ? { details } : {})
      });
      await this.reports.audit("tool.review_reported", userId, {
        reportId: report.id,
        reason
      }).catch(() => {});
      return { report, toolId: review.toolId };
    } catch (error) {
      if (error instanceof ToolError) throw error;
      await this.reports.audit("tool.review_denied", userId).catch(() => {});
      throw error;
    }
  }
}

export class ToolReviewModerationService {
  readonly reviews: ToolReviewRepository;
  readonly reports: ToolReviewReportRepository;

  constructor(reviews: ToolReviewRepository, reports: ToolReviewReportRepository) {
    this.reviews = reviews;
    this.reports = reports;
  }

  listReports(query: { status?: "open" | "resolved" | "dismissed"; page: number; pageSize: number }) {
    return this.reports.list(query);
  }

  async listReviews(query: ToolReviewAdminQuery): Promise<ToolReviewAdminPage> {
    const page = await this.reviews.listAdmin(query);
    const counts = page.items.length
      ? await this.reports.countByReview(page.items.map((item) => item.id))
      : new Map<string, number>();
    return {
      ...page,
      items: page.items.map((item) => ({ ...item, reportsCount: counts.get(item.id) ?? 0 }))
    };
  }

  async hideReview(reviewId: string, actor: string, value: unknown) {
    const reason = parseModerationReason(value);
    const review = await this.reviews.setStatus(reviewId, "hidden", actor, reason);
    await this.reviews.audit("tool.review_hidden", actor, review.toolId).catch(() => {});
    return review;
  }

  async restoreReview(reviewId: string, actor: string) {
    const review = await this.reviews.setStatus(reviewId, "active", actor);
    await this.reviews.audit("tool.review_restored", actor, review.toolId).catch(() => {});
    return review;
  }

  async removeReview(reviewId: string, actor: string, value: unknown) {
    const reason = parseModerationReason(value);
    const review = await this.reviews.setStatus(reviewId, "removed", actor, reason);
    await this.reviews.audit("tool.review_moderated_removed", actor, review.toolId).catch(() => {});
    return review;
  }

  async resolveReport(reportId: string, actor: string) {
    const { report, changed } = await this.reports.setStatus(reportId, "resolved", actor);
    if (changed) {
      await this.reports.audit("tool.review_report_resolved", actor, { reportId: report.id }).catch(() => {});
    }
    return report;
  }

  async dismissReport(reportId: string, actor: string) {
    const { report, changed } = await this.reports.setStatus(reportId, "dismissed", actor);
    if (changed) {
      await this.reports.audit("tool.review_report_dismissed", actor, { reportId: report.id }).catch(() => {});
    }
    return report;
  }
}

export function parseReviewQuery(params: URLSearchParams): ToolReviewListQuery {
  const page = readInteger(params.get("page"), 1, 1, 10_000);
  const pageSize = readInteger(params.get("pageSize"), 20, 1, MAX_PAGE_SIZE);
  const sort = parseSort(params.get("sort") ?? "newest");
  return { page, pageSize, sort };
}

export function parseReportQuery(params: URLSearchParams, maxPageSize = 100): { status?: "open" | "resolved" | "dismissed"; page: number; pageSize: number } {
  const page = readInteger(params.get("page"), 1, 1, 10_000);
  const pageSize = readInteger(params.get("pageSize"), 20, 1, maxPageSize);
  const rawStatus = params.get("status");
  const status = rawStatus === null || rawStatus === "open" || rawStatus === "resolved" || rawStatus === "dismissed"
    ? (rawStatus ?? undefined)
    : (() => { throw new ToolError("INVALID_TOOL_QUERY"); })();
  return { ...(status ? { status } : {}), page, pageSize };
}

export function parseAdminReviewQuery(params: URLSearchParams, maxPageSize = 100): ToolReviewAdminQuery {
  const page = readInteger(params.get("page"), 1, 1, 10_000);
  const pageSize = readInteger(params.get("pageSize"), 20, 1, maxPageSize);
  const rawStatus = params.get("status");
  const status = rawStatus === null || rawStatus === "active" || rawStatus === "hidden" || rawStatus === "removed"
    ? (rawStatus ?? undefined)
    : (() => { throw new ToolError("INVALID_TOOL_QUERY"); })();
  return { page, pageSize, ...(status ? { status } : {}), reportedOnly: params.get("reported") === "true" };
}

function parseSort(value: string): ToolReviewSort {
  if (value === "newest" || value === "highest_rating" || value === "lowest_rating") return value;
  throw new ToolError("INVALID_TOOL_QUERY");
}

function parseReviewDraft(value: unknown): ToolReviewDraft {
  if (value === null || typeof value !== "object") throw new ToolError("REVIEW_BODY_REQUIRED");
  const draft = value as Record<string, unknown>;
  const body = typeof draft.body === "string" ? draft.body.trim() : "";
  if (!body) throw new ToolError("REVIEW_BODY_REQUIRED");
  if (body.length > REVIEW_LIMITS.body) throw new ToolError("REVIEW_BODY_TOO_LONG");
  let title: string | undefined;
  if (draft.title !== undefined && draft.title !== null) {
    const rawTitle = typeof draft.title === "string" ? draft.title.trim() : String(draft.title).trim();
    if (rawTitle.length > REVIEW_LIMITS.title) throw new ToolError("REVIEW_TITLE_TOO_LONG");
    if (rawTitle) title = rawTitle;
  }
  return { body, ...(title ? { title } : {}) };
}

function parseReportDraft(value: unknown) {
  if (value === null || typeof value !== "object") throw new ToolError("REPORT_REASON_REQUIRED");
  const draft = value as Record<string, unknown>;
  const reason = typeof draft.reason === "string" ? draft.reason : "";
  if (!reason) throw new ToolError("REPORT_REASON_REQUIRED");
  if (!(TOOL_REVIEW_REASONS as readonly string[]).includes(reason)) throw new ToolError("REPORT_REASON_INVALID");
  let details: string | undefined;
  if (draft.details !== undefined && draft.details !== null) {
    details = typeof draft.details === "string" ? draft.details.trim() : String(draft.details).trim();
    if (details.length > REVIEW_LIMITS.reportDetails) throw new ToolError("REPORT_DETAILS_TOO_LONG");
    if (!details) details = undefined;
  }
  return {
    reason: reason as ToolReviewReason,
    ...(details ? { details } : {})
  };
}

function parseModerationReason(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw new ToolError("INVALID_TOOL");
  const reason = (value as Record<string, unknown>).reason;
  if (reason === undefined || reason === null || reason === "") return undefined;
  const text = typeof reason === "string" ? reason.trim() : String(reason).trim();
  if (!text) return undefined;
  if (text.length > REVIEW_LIMITS.moderationReason) throw new ToolError("REVIEW_MODERATION_REASON_TOO_LONG");
  return text;
}

function readInteger(value: string | null, fallback: number, min: number, max: number) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new ToolError("INVALID_TOOL_QUERY");
  return parsed;
}