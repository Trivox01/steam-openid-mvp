import type { BackendSessionSource } from "../developer-center/AuthorizationStore";
import type { NexusTool, ToolBadge, ToolBadgeDraft, ToolCategory, ToolCategoryDraft, ToolDraft, ToolRatingSummary, ToolReviewAdminPage, ToolReviewPage, ToolReviewReason, ToolReviewReportPage, ToolReviewView } from "./types";
export class ToolClient {
  constructor(private readonly baseUrl: string, private readonly sessions?: BackendSessionSource) {}
  list(params = new URLSearchParams(), signal?: AbortSignal) { return this.request<{ items: NexusTool[]; total: number; page: number; pageSize: number }>(`/api/tools?${params}`, { signal }, false).then(x => ({ ...x, items: x.items.map(tool => this.resolveAssets(tool)) })); }
  get(slug: string, signal?: AbortSignal) { return this.request<NexusTool>(`/api/tools/${encodeURIComponent(slug)}`, { signal }, false).then(tool => this.resolveAssets(tool)); }
  ratingSummary(toolId: string, signal?: AbortSignal) { return this.request<ToolRatingSummary>(`/api/tools/${encodeURIComponent(toolId)}/rating-summary`, { signal }, false); }
  myRating(toolId: string) { return this.request<{ rating: number | null }>(`/api/tools/${encodeURIComponent(toolId)}/my-rating`).then(value => value.rating); }
  saveRating(toolId: string, rating: number) { return this.request<{ rating: number }>(`/api/tools/${encodeURIComponent(toolId)}/my-rating`, { method: "PUT", body: JSON.stringify({ rating }) }); }
  removeRating(toolId: string) { return this.request<void>(`/api/tools/${encodeURIComponent(toolId)}/my-rating`, { method: "DELETE" }); }
  adminList(params = new URLSearchParams()) { return this.request<{ items: NexusTool[]; total: number; page: number; pageSize: number }>(`/api/admin/tools?${params}`).then(x => ({ ...x, items: x.items.map(tool => this.resolveAssets(tool)) })); }
  create(value: ToolDraft) { return this.request<NexusTool>("/api/admin/tools", { method: "POST", body: JSON.stringify(value) }).then(tool => this.resolveAssets(tool)); }
  update(id: string, value: ToolDraft) { return this.request<NexusTool>(`/api/admin/tools/${id}`, { method: "PATCH", body: JSON.stringify(value) }).then(tool => this.resolveAssets(tool)); }
  archive(id: string, value: boolean) { return this.request<NexusTool>(`/api/admin/tools/${id}/${value ? "archive" : "reactivate"}`, { method: "POST" }).then(tool => this.resolveAssets(tool)); }
  uploadAsset(kind: "icon" | "cover", file: File) { return this.request<{ id: string }>(`/api/admin/tool-assets/${kind}`, { method: "POST", body: file, headers: { "content-type": file.type } }); }
  badges() { return this.request<{ items: ToolBadge[] }>("/api/admin/tool-badges?archived=true"); }
  saveBadge(value: ToolBadgeDraft, id?: string) { return this.request<ToolBadge>(id ? `/api/admin/tool-badges/${id}` : "/api/admin/tool-badges", { method: id ? "PATCH" : "POST", body: JSON.stringify(value) }); }
  archiveBadge(id: string, value: boolean) { return this.request<ToolBadge>(`/api/admin/tool-badges/${id}/${value ? "archive" : "reactivate"}`, { method: "POST" }); }
  categories() { return this.request<{ items: ToolCategory[] }>("/api/admin/tool-categories?archived=true"); }
  saveCategory(value: ToolCategoryDraft, id?: string) { return this.request<ToolCategory>(id ? `/api/admin/tool-categories/${id}` : "/api/admin/tool-categories", { method: id ? "PATCH" : "POST", body: JSON.stringify(value) }); }
  archiveCategory(id: string, value: boolean) { return this.request<ToolCategory>(`/api/admin/tool-categories/${id}/${value ? "archive" : "reactivate"}`, { method: "POST" }); }
  reviews(toolId: string, params: URLSearchParams, signal?: AbortSignal) { return this.request<ToolReviewPage>(`/api/tools/${encodeURIComponent(toolId)}/reviews?${params}`, { signal }, false); }
  myReview(toolId: string) { return this.request<{ review: ToolReviewView | null }>(`/api/tools/${encodeURIComponent(toolId)}/my-review`).then(value => value.review); }
  saveReview(toolId: string, draft: { title?: string; body: string }) { return this.request<ToolReviewView>(`/api/tools/${encodeURIComponent(toolId)}/my-review`, { method: "PUT", body: JSON.stringify(draft) }); }
  removeReview(toolId: string) { return this.request<void>(`/api/tools/${encodeURIComponent(toolId)}/my-review`, { method: "DELETE" }); }
  reportReview(toolId: string, reviewId: string, reason: ToolReviewReason, details?: string) { return this.request<{ report: unknown }>(`/api/tools/${encodeURIComponent(toolId)}/reviews/${encodeURIComponent(reviewId)}/report`, { method: "POST", body: JSON.stringify({ ...(details ? { details } : {}), reason }) }); }
  adminReviews(params = new URLSearchParams()) { return this.request<ToolReviewAdminPage>(`/api/admin/tool-reviews?${params}`); }
  moderateReview(id: string, action: "hide" | "restore" | "remove", reason?: string) { return this.request<ToolReviewAdminPage["items"][number]>(`/api/admin/tool-reviews/${id}/${action}`, { method: "POST", ...(action === "restore" ? {} : { body: JSON.stringify(reason ? { reason } : {}) }) }); }
  adminReports(params = new URLSearchParams()) { return this.request<ToolReviewReportPage>(`/api/admin/tool-review-reports?${params}`); }
  resolveReport(id: string) { return this.request<{ report: unknown }>(`/api/admin/tool-review-reports/${id}/resolve`, { method: "POST" }); }
  dismissReport(id: string) { return this.request<{ report: unknown }>(`/api/admin/tool-review-reports/${id}/dismiss`, { method: "POST" }); }
  private resolveAssets(tool: NexusTool) { return { ...tool, ...(tool.iconUrl ? { iconUrl: new URL(tool.iconUrl, this.baseUrl).toString() } : {}), ...(tool.coverUrl ? { coverUrl: new URL(tool.coverUrl, this.baseUrl).toString() } : {}) }; }
  private async request<T>(path: string, init: RequestInit = {}, auth = true) {
    const session = auth ? this.sessions?.getActiveSession() : undefined;
    if (auth && !session) throw new Error("AUTHENTICATION_REQUIRED");
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers, ...(session ? { authorization: `Bearer ${session.token}` } : {}) } });
    } catch { throw new Error("NETWORK_ERROR"); }
    if (response.status === 401) this.sessions?.expireSession();
    if (response.status === 204) { if (!response.ok) throw new Error("REQUEST_FAILED"); return undefined as T; }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new Error("MALFORMED_RESPONSE"); }
    if (!response.ok) throw new Error(typeof payload === "object" && payload && "error" in payload ? String(payload.error) : "REQUEST_FAILED");
    return payload as T;
  }
}