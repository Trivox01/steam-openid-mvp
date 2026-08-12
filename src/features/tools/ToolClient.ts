import type { BackendSessionSource } from "../developer-center/AuthorizationStore";
import type { NexusTool, ToolBadge, ToolBadgeDraft, ToolCategory, ToolCategoryDraft, ToolDraft, ToolReviewAdminPage, ToolReviewDeveloperReply, ToolReviewReason, ToolReviewReportPage } from "./types";
import { MalformedPayloadError, type Parser } from "../../services/validation/parse.ts";
import { reportDiagnostic, type DiagnosticCategory } from "../../runtime/diagnostics.ts";
import { parseBadgeCollection, parseCategoryCollection, parseFavoritePage, parseFavoriteState, parseFavoriteStatus, parseHelpfulState, parseMyRating, parseMyReview, parseRatingSummary, parseReportAcknowledgement, parseReview, parseReviewPage, parseSavedRating, parseTool, parseToolPage } from "./toolParsers.ts";

/**
 * How a tool request failed.
 *
 * The distinctions are the point: only a real 401 may end the session, a
 * suspended account answers 403 with `ACCOUNT_NOT_ACTIVE`, and a response whose
 * shape is wrong is neither of those. Collapsing them is what would turn a
 * suspended account into a sign-in loop and a backend contract change into an
 * "you are offline" message.
 */
export type ToolClientErrorKind =
  | "network"
  | "unauthorized"
  | "account_not_active"
  | "forbidden"
  | "malformed_json"
  | "malformed_payload"
  | "server_error"
  | "domain_error"
  | "unknown";

export class ToolClientError extends Error {
  readonly kind: ToolClientErrorKind;
  /** Backend error code for domain failures, e.g. "RATE_LIMITED". */
  readonly code?: string;
  readonly status?: number;

  constructor(kind: ToolClientErrorKind, options: { code?: string; status?: number } = {}) {
    // The message stays the backend code where there is one: callers already
    // branch on codes such as AUTHENTICATION_REQUIRED and RATE_LIMITED. It is an
    // internal identifier and never user-facing text.
    super(options.code ?? DEFAULT_MESSAGES[kind]);
    this.name = "ToolClientError";
    this.kind = kind;
    if (options.code) this.code = options.code;
    if (options.status !== undefined) this.status = options.status;
  }
}

const DEFAULT_MESSAGES: Record<ToolClientErrorKind, string> = {
  network: "NETWORK_ERROR",
  unauthorized: "AUTHENTICATION_REQUIRED",
  account_not_active: "ACCOUNT_NOT_ACTIVE",
  forbidden: "PERMISSION_DENIED",
  malformed_json: "MALFORMED_RESPONSE",
  malformed_payload: "MALFORMED_RESPONSE",
  server_error: "SERVER_ERROR",
  domain_error: "REQUEST_FAILED",
  unknown: "REQUEST_FAILED"
};

const DIAGNOSTIC_CATEGORIES: Record<ToolClientErrorKind, DiagnosticCategory> = {
  network: "network",
  unauthorized: "unauthorized",
  account_not_active: "account_not_active",
  forbidden: "forbidden",
  malformed_json: "malformed_payload",
  malformed_payload: "malformed_payload",
  server_error: "server_error",
  domain_error: "domain_error",
  unknown: "unknown"
};

/** True when a page should offer a plain retry rather than a sign-in prompt. */
export function isRetryableToolError(error: unknown) {
  return error instanceof ToolClientError &&
    (error.kind === "network" || error.kind === "server_error" ||
     error.kind === "malformed_json" || error.kind === "malformed_payload");
}

export class ToolClient {
  // Written as explicit fields rather than constructor parameter properties so
  // the runtime tests can import this module under Node's type stripping.
  private readonly baseUrl: string;
  private readonly sessions?: BackendSessionSource;
  constructor(baseUrl: string, sessions?: BackendSessionSource) {
    this.baseUrl = baseUrl;
    this.sessions = sessions;
  }
  list(params = new URLSearchParams(), signal?: AbortSignal) { return this.request(`/api/tools?${params}`, parseToolPage, { signal }, false).then(x => ({ ...x, items: x.items.map(tool => this.resolveAssets(tool)) })); }
  get(slug: string, signal?: AbortSignal) { return this.request(`/api/tools/${encodeURIComponent(slug)}`, parseTool, { signal }, false).then(tool => this.resolveAssets(tool)); }
  catalogCategories(signal?: AbortSignal) { return this.request("/api/tools/categories", parseCategoryCollection, { signal }, false); }
  catalogBadges(signal?: AbortSignal) { return this.request("/api/tools/badges", parseBadgeCollection, { signal }, false); }
  listFavorites(page = 1, pageSize = 50, signal?: AbortSignal) { return this.request(`/api/tools/favorites?page=${page}&pageSize=${pageSize}`, parseFavoritePage, { signal }); }
  favorite(toolId: string, active: boolean) { return this.request(`/api/tools/${encodeURIComponent(toolId)}/favorite`, parseFavoriteState, { method: active ? "PUT" : "DELETE" }); }
  favoriteStatus(toolId: string, signal?: AbortSignal) { return this.request(`/api/tools/${encodeURIComponent(toolId)}/favorite-status`, parseFavoriteStatus, { signal }); }
  ratingSummary(toolId: string, signal?: AbortSignal) { return this.request(`/api/tools/${encodeURIComponent(toolId)}/rating-summary`, parseRatingSummary, { signal }, false); }
  myRating(toolId: string) { return this.request(`/api/tools/${encodeURIComponent(toolId)}/my-rating`, parseMyRating).then(value => value.rating); }
  saveRating(toolId: string, rating: number) { return this.request(`/api/tools/${encodeURIComponent(toolId)}/my-rating`, parseSavedRating, { method: "PUT", body: JSON.stringify({ rating }) }); }
  removeRating(toolId: string) { return this.requestEmpty(`/api/tools/${encodeURIComponent(toolId)}/my-rating`, { method: "DELETE" }); }
  reviews(toolId: string, params: URLSearchParams, signal?: AbortSignal) { return this.request(`/api/tools/${encodeURIComponent(toolId)}/reviews?${params}`, parseReviewPage, { signal }, false); }
  myReview(toolId: string) { return this.request(`/api/tools/${encodeURIComponent(toolId)}/my-review`, parseMyReview).then(value => value.review); }
  saveReview(toolId: string, draft: { title?: string; body: string }) { return this.request(`/api/tools/${encodeURIComponent(toolId)}/my-review`, parseReview, { method: "PUT", body: JSON.stringify(draft) }); }
  removeReview(toolId: string) { return this.requestEmpty(`/api/tools/${encodeURIComponent(toolId)}/my-review`, { method: "DELETE" }); }
  reportReview(toolId: string, reviewId: string, reason: ToolReviewReason, details?: string) { return this.request(`/api/tools/${encodeURIComponent(toolId)}/reviews/${encodeURIComponent(reviewId)}/report`, parseReportAcknowledgement, { method: "POST", body: JSON.stringify({ ...(details ? { details } : {}), reason }) }); }
  setReviewHelpful(toolId: string, reviewId: string, helpful: boolean) { return this.request(`/api/tools/${encodeURIComponent(toolId)}/reviews/${encodeURIComponent(reviewId)}/helpful`, parseHelpfulState, { method: helpful ? "PUT" : "DELETE" }); }
  // Developer Center administration. Staff-only screens outside the player-facing
  // tool flows this batch validates, so they keep the unchecked cast until their
  // own hardening pass. They still get the full error taxonomy below.
  adminList(params = new URLSearchParams()) { return this.requestUnchecked<{ items: NexusTool[]; total: number; page: number; pageSize: number }>(`/api/admin/tools?${params}`).then(x => ({ ...x, items: x.items.map(tool => this.resolveAssets(tool)) })); }
  create(value: ToolDraft) { return this.requestUnchecked<NexusTool>("/api/admin/tools", { method: "POST", body: JSON.stringify(value) }).then(tool => this.resolveAssets(tool)); }
  update(id: string, value: ToolDraft) { return this.requestUnchecked<NexusTool>(`/api/admin/tools/${id}`, { method: "PATCH", body: JSON.stringify(value) }).then(tool => this.resolveAssets(tool)); }
  archive(id: string, value: boolean) { return this.requestUnchecked<NexusTool>(`/api/admin/tools/${id}/${value ? "archive" : "reactivate"}`, { method: "POST" }).then(tool => this.resolveAssets(tool)); }
  uploadAsset(kind: "icon" | "cover", file: File) { return this.requestUnchecked<{ id: string }>(`/api/admin/tool-assets/${kind}`, { method: "POST", body: file, headers: { "content-type": file.type } }); }
  badges() { return this.requestUnchecked<{ items: ToolBadge[] }>("/api/admin/tool-badges?archived=true"); }
  saveBadge(value: ToolBadgeDraft, id?: string) { return this.requestUnchecked<ToolBadge>(id ? `/api/admin/tool-badges/${id}` : "/api/admin/tool-badges", { method: id ? "PATCH" : "POST", body: JSON.stringify(value) }); }
  archiveBadge(id: string, value: boolean) { return this.requestUnchecked<ToolBadge>(`/api/admin/tool-badges/${id}/${value ? "archive" : "reactivate"}`, { method: "POST" }); }
  categories() { return this.requestUnchecked<{ items: ToolCategory[] }>("/api/admin/tool-categories?archived=true"); }
  saveCategory(value: ToolCategoryDraft, id?: string) { return this.requestUnchecked<ToolCategory>(id ? `/api/admin/tool-categories/${id}` : "/api/admin/tool-categories", { method: id ? "PATCH" : "POST", body: JSON.stringify(value) }); }
  archiveCategory(id: string, value: boolean) { return this.requestUnchecked<ToolCategory>(`/api/admin/tool-categories/${id}/${value ? "archive" : "reactivate"}`, { method: "POST" }); }
  saveDeveloperReply(reviewId: string, body: string) { return this.requestUnchecked<{ reply: ToolReviewDeveloperReply }>(`/api/admin/tool-reviews/${encodeURIComponent(reviewId)}/reply`, { method: "PUT", body: JSON.stringify({ body }) }); }
  removeDeveloperReply(reviewId: string) { return this.requestUnchecked<{ reply: ToolReviewDeveloperReply }>(`/api/admin/tool-reviews/${encodeURIComponent(reviewId)}/reply`, { method: "DELETE" }); }
  adminReviews(params = new URLSearchParams()) { return this.requestUnchecked<ToolReviewAdminPage>(`/api/admin/tool-reviews?${params}`); }
  moderateReview(id: string, action: "hide" | "restore" | "remove", reason?: string) { return this.requestUnchecked<ToolReviewAdminPage["items"][number]>(`/api/admin/tool-reviews/${id}/${action}`, { method: "POST", ...(action === "restore" ? {} : { body: JSON.stringify(reason ? { reason } : {}) }) }); }
  adminReports(params = new URLSearchParams()) { return this.requestUnchecked<ToolReviewReportPage>(`/api/admin/tool-review-reports?${params}`); }
  resolveReport(id: string) { return this.requestUnchecked<{ report: unknown }>(`/api/admin/tool-review-reports/${id}/resolve`, { method: "POST" }); }
  dismissReport(id: string) { return this.requestUnchecked<{ report: unknown }>(`/api/admin/tool-review-reports/${id}/dismiss`, { method: "POST" }); }
  private resolveAssets(tool: NexusTool) { return { ...tool, ...(tool.iconUrl ? { iconUrl: new URL(tool.iconUrl, this.baseUrl).toString() } : {}), ...(tool.coverUrl ? { coverUrl: new URL(tool.coverUrl, this.baseUrl).toString() } : {}) }; }

  /** Validated read or mutation: the payload must match `parse` or it is rejected. */
  private async request<T>(path: string, parse: Parser<T>, init: RequestInit = {}, auth = true): Promise<T> {
    const payload = await this.send(path, init, auth, false);
    try {
      return parse(payload);
    } catch (error) {
      if (!(error instanceof MalformedPayloadError)) throw error;
      // The field path comes from the parser, not from the response body, so it
      // can never carry a value and is safe to keep on the error.
      throw this.fail("malformed_payload", path, { code: `MALFORMED_RESPONSE:${error.path}` });
    }
  }

  /** A mutation with nothing to inspect, such as a delete answering 204. */
  private async requestEmpty(path: string, init: RequestInit = {}): Promise<void> {
    await this.send(path, init, true, true);
  }

  /**
   * Unvalidated fallback for endpoints outside this batch. Shape checking is the
   * only thing missing: the taxonomy, the session rules and the diagnostics all
   * still apply.
   */
  private async requestUnchecked<T>(path: string, init: RequestInit = {}): Promise<T> {
    return await this.send(path, init, true, false) as T;
  }

  private async send(path: string, init: RequestInit, auth: boolean, allowEmpty: boolean): Promise<unknown> {
    const session = auth ? this.sessions?.getActiveSession() : undefined;
    if (auth && !session) throw this.fail("unauthorized", path);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers, ...(session ? { authorization: `Bearer ${session.token}` } : {}) } });
    } catch (error) {
      // An abort is the caller changing its mind, not a failure worth reporting.
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw this.fail("network", path);
    }
    // Only a genuine 401 ends the session. A suspended account answers 403 and a
    // malformed body answers neither, so neither can start a sign-out loop.
    if (response.status === 401) {
      this.sessions?.expireSession();
      throw this.fail("unauthorized", path, { status: 401 });
    }
    const text = await this.readBody(path, response);
    if (text === "") {
      if (!response.ok) throw this.fail(this.classify(response.status), path, { status: response.status });
      if (allowEmpty) return undefined;
      // A 200 with no body where the caller needs data is a broken contract, not
      // an empty result.
      throw this.fail("malformed_json", path, { status: response.status });
    }
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { throw this.fail("malformed_json", path, { status: response.status }); }
    if (!response.ok) {
      const code = typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error) : undefined;
      throw this.fail(this.classify(response.status, code), path, { status: response.status, ...(code ? { code } : {}) });
    }
    return payload;
  }

  private async readBody(path: string, response: Response) {
    // A connection that dies mid-body is a network failure, not a bad payload.
    try { return (await response.text()).trim(); } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw this.fail("network", path);
    }
  }

  private classify(status: number, code?: string): ToolClientErrorKind {
    if (status === 403) return code === "ACCOUNT_NOT_ACTIVE" ? "account_not_active" : "forbidden";
    if (status >= 500) return "server_error";
    if (code) return "domain_error";
    return "unknown";
  }

  private fail(kind: ToolClientErrorKind, path: string, options: { code?: string; status?: number } = {}) {
    const error = new ToolClientError(kind, options);
    reportDiagnostic({
      scope: "tool_client",
      category: DIAGNOSTIC_CATEGORIES[kind],
      route: toolRouteIdentifier(path),
      ...(options.status !== undefined ? { detail: `status ${options.status}` } : {})
    });
    return error;
  }
}

/**
 * Collapses a request path into a stable identifier for diagnostics.
 *
 * Only known route words survive; everything else becomes "id". An allow-list is
 * used rather than a shape test because a tool slug is lowercase-with-dashes and
 * would otherwise pass a shape test and land in a log.
 */
const ROUTE_WORDS = new Set([
  "api", "tools", "admin", "categories", "badges", "favorites", "favorite",
  "favorite-status", "rating-summary", "my-rating", "my-review", "reviews",
  "report", "helpful", "reply", "stats", "view", "download-click", "archive",
  "reactivate", "hide", "restore", "remove", "resolve", "dismiss",
  "tool-assets", "tool-badges", "tool-categories", "tool-reviews",
  "tool-review-reports", "icon", "cover", "content"
]);

export function toolRouteIdentifier(path: string): string {
  const [pathname = ""] = path.split("?");
  const segments = pathname.split("/").filter(Boolean)
    .map((segment) => ROUTE_WORDS.has(segment) ? segment : "id");
  return segments.join("_") || "tools";
}
