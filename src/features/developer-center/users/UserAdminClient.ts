import type { BackendSessionSource } from "../AuthorizationStore";
import type { ManagedUserDetails, UserAccountStatus, UserPage } from "./types";

export class UserAdminClientError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, status?: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "UserAdminClientError";
  }
}

export class UserAdminClient {
  private readonly detailsCache = new Map<
    string,
    { value: ManagedUserDetails; expiresAt: number }
  >();
  private readonly baseUrl: string;
  private readonly sessions: BackendSessionSource;
  constructor(
    baseUrl: string,
    sessions: BackendSessionSource
  ) {
    this.baseUrl = baseUrl;
    this.sessions = sessions;
  }
  list(params: URLSearchParams, signal?: AbortSignal) {
    return this.request<UserPage>(`/api/admin/users?${params}`, signal);
  }
  subscribeSession(listener: () => void) {
    return this.sessions.subscribeSession((session) => {
      if (session) listener();
    });
  }
  async get(id: string, signal?: AbortSignal) {
    const user = await this.request<ManagedUserDetails>(
      `/api/admin/users/${encodeURIComponent(id)}`,
      signal
    );
    const normalized = this.normalizeDetails(user);
    this.detailsCache.set(id, {
      value: normalized,
      expiresAt: Date.now() + 30_000
    });
    return normalized;
  }
  getCached(id: string) {
    const cached = this.detailsCache.get(id);
    if (!cached) return undefined;
    if (cached.expiresAt <= Date.now()) {
      this.detailsCache.delete(id);
      return undefined;
    }
    return cached.value;
  }
  invalidate(id?: string) {
    if (id) this.detailsCache.delete(id);
    else this.detailsCache.clear();
  }
  changeStatus(
    id: string,
    status: UserAccountStatus,
    reason?: string,
    signal?: AbortSignal
  ) {
    return this.request<ManagedUserDetails>(
      `/api/admin/users/${encodeURIComponent(id)}/status`,
      signal,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, ...(reason?.trim() ? { reason: reason.trim() } : {}) })
      }
    ).then((response) => {
      const updated = this.normalizeDetails(response);
      this.detailsCache.set(id, {
        value: updated,
        expiresAt: Date.now() + 30_000
      });
      return updated;
    });
  }
  private normalizeDetails(user: ManagedUserDetails) {
    return {
      ...user,
      badges: user.badges.map((badge) => ({
        ...badge,
        ...(badge.iconUrl
          ? { iconUrl: new URL(badge.iconUrl, this.baseUrl).toString() }
          : {})
      }))
    };
  }
  private async request<T>(
    path: string,
    signal?: AbortSignal,
    init: RequestInit = {}
  ) {
    const session = this.sessions.getActiveSession();
    if (!session) throw new UserAdminClientError("AUTHENTICATION_REQUIRED", 401);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          authorization: `Bearer ${session.token}`
        },
        signal
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new UserAdminClientError("REQUEST_ABORTED");
      }
      throw new UserAdminClientError("NETWORK_ERROR");
    }
    if (response.status === 401) this.sessions.expireSession();
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const code = payload && typeof payload === "object" && "error" in payload
        ? String(payload.error) : "REQUEST_FAILED";
      throw new UserAdminClientError(code, response.status);
    }
    if (!payload || typeof payload !== "object") {
      throw new UserAdminClientError("MALFORMED_RESPONSE");
    }
    return payload as T;
  }
}
