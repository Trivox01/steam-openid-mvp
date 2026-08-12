import type { BackendSessionSource } from "../AuthorizationStore";
import type { ManagedBadge } from "../badges/types";
import type {
  AssignmentPage,
  AssignmentUserPage,
  BadgeAssignment
} from "./types";

export class BadgeAssignmentClientError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, status?: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export class BadgeAssignmentClient {
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
    return this.request<AssignmentPage>(
      `/api/admin/badge-assignments?${params}`, { signal }
    );
  }
  listUsers(search = "", signal?: AbortSignal) {
    const params = new URLSearchParams({ page: "1", pageSize: "50" });
    if (search.trim()) params.set("search", search.trim());
    return this.request<AssignmentUserPage>(
      `/api/admin/badge-assignment-users?${params}`, { signal }
    );
  }
  listBadges(signal?: AbortSignal) {
    const params = new URLSearchParams({
      page: "1", pageSize: "100", sort: "name_asc"
    });
    return this.request<{ items: ManagedBadge[] }>(
      `/api/admin/badges?${params}`, { signal }
    );
  }
  assign(input: {
    userId: string; badgeDefinitionId: string; reason?: string;
  }) {
    return this.request<BadgeAssignment>("/api/admin/badge-assignments", {
      method: "POST", body: JSON.stringify(input)
    });
  }
  revoke(id: string, reason?: string) {
    return this.request<BadgeAssignment>(
      `/api/admin/badge-assignments/${id}/revoke`,
      { method: "POST", body: JSON.stringify({ ...(reason ? { reason } : {}) }) }
    );
  }
  async loadAsset(id: string, signal?: AbortSignal) {
    const response = await this.sessions.authenticatedFetch(
      `${this.baseUrl}/api/admin/badge-assets/${id}/content`,
      { signal }
    );
    if (!response.ok) throw new BadgeAssignmentClientError("ASSET_LOAD_FAILED", response.status);
    return response.blob();
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await this.sessions.authenticatedFetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers
        }
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new BadgeAssignmentClientError("REQUEST_ABORTED");
      }
      throw new BadgeAssignmentClientError("NETWORK_ERROR");
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new BadgeAssignmentClientError("MALFORMED_RESPONSE", response.status); }
    if (!response.ok) {
      const code = payload && typeof payload === "object" && "error" in payload
        ? String(payload.error) : "REQUEST_FAILED";
      throw new BadgeAssignmentClientError(code, response.status);
    }
    return payload as T;
  }
}
