import type { BackendSessionSource } from "../AuthorizationStore";
import type { BadgeDraft, ManagedBadge } from "./types";

export class BadgeAdminError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export class BadgeAdminClient {
  private readonly baseUrl: string;
  private readonly sessions: BackendSessionSource;
  constructor(baseUrl: string, sessions: BackendSessionSource) {
    this.baseUrl = baseUrl;
    this.sessions = sessions;
  }

  list(params: URLSearchParams, signal?: AbortSignal) {
    return this.request<{ items: ManagedBadge[]; total: number; page: number; pageSize: number }>(
      `/api/admin/badges?${params}`, { signal }
    );
  }
  create(draft: BadgeDraft) {
    return this.request<ManagedBadge>("/api/admin/badges", {
      method: "POST", body: JSON.stringify(draft)
    });
  }
  update(id: string, draft: BadgeDraft) {
    return this.request<ManagedBadge>(`/api/admin/badges/${id}`, {
      method: "PATCH", body: JSON.stringify(draft)
    });
  }
  archive(id: string) {
    return this.request<ManagedBadge>(`/api/admin/badges/${id}/archive`, { method: "POST" });
  }
  async upload(file: File) {
    return this.request<{ id: string; isSquare: boolean }>("/api/admin/badge-assets", {
      method: "POST", headers: { "content-type": file.type }, body: file
    });
  }
  assetUrl(id: string) { return `${this.baseUrl}/api/admin/badge-assets/${id}/content`; }
  async loadAsset(id: string, signal?: AbortSignal) {
    const session = this.sessions.getActiveSession();
    if (!session) throw new BadgeAdminError("AUTHENTICATION_REQUIRED", 401);
    const response = await fetch(this.assetUrl(id), {
      headers: { authorization: `Bearer ${session.token}` },
      signal
    });
    if (!response.ok) throw new BadgeAdminError("ASSET_LOAD_FAILED", response.status);
    return response.blob();
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    const session = this.sessions.getActiveSession();
    if (!session) throw new BadgeAdminError("AUTHENTICATION_REQUIRED", 401);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}),
          ...init.headers,
          authorization: `Bearer ${session.token}`
        }
      });
    } catch {
      throw new BadgeAdminError("NETWORK_ERROR");
    }
    if (response.status === 401) this.sessions.expireSession();
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new BadgeAdminError("MALFORMED_RESPONSE"); }
    if (!response.ok) {
      const code = typeof payload === "object" && payload && "error" in payload
        ? String(payload.error) : "REQUEST_FAILED";
      throw new BadgeAdminError(code, response.status);
    }
    return payload as T;
  }
}
