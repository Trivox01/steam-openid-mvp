import type { BackendSessionSource } from "../AuthorizationStore";
import type { ManagedUserDetails, UserPage } from "./types";

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
  async get(id: string, signal?: AbortSignal) {
    const user = await this.request<ManagedUserDetails>(
      `/api/admin/users/${encodeURIComponent(id)}`,
      signal
    );
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
  private async request<T>(path: string, signal?: AbortSignal) {
    const session = this.sessions.getActiveSession();
    if (!session) throw new UserAdminClientError("AUTHENTICATION_REQUIRED", 401);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${session.token}` },
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
