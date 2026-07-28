import type { AuthorizationSnapshot } from "./authorizationTypes";

export type AuthorizationClientErrorKind =
  | "unauthorized"
  | "forbidden"
  | "network"
  | "malformed"
  | "unknown";

export class AuthorizationClientError extends Error {
  readonly kind: AuthorizationClientErrorKind;

  constructor(kind: AuthorizationClientErrorKind) {
    super(kind);
    this.kind = kind;
    this.name = "AuthorizationClientError";
  }
}

export interface AuthorizationApi {
  loadSnapshot(token: string, signal?: AbortSignal): Promise<AuthorizationSnapshot>;
}

export class AuthorizationClient implements AuthorizationApi {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string,
    timeoutMs = 15_000
  ) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async loadSnapshot(token: string, signal?: AbortSignal) {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/me/authorization`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal: requestSignal
      });
    } catch {
      throw new AuthorizationClientError("network");
    }
    if (response.status === 401) {
      throw new AuthorizationClientError("unauthorized");
    }
    if (response.status === 403) {
      throw new AuthorizationClientError("forbidden");
    }
    if (!response.ok) {
      throw new AuthorizationClientError("unknown");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AuthorizationClientError("malformed");
    }
    if (!isAuthorizationSnapshot(payload)) {
      throw new AuthorizationClientError("malformed");
    }
    return payload;
  }
}

function isAuthorizationSnapshot(value: unknown): value is AuthorizationSnapshot {
  if (!isRecord(value) ||
      !Array.isArray(value.roles) ||
      !Array.isArray(value.permissions) ||
      typeof value.canAccessDeveloperCenter !== "boolean") return false;
  return value.roles.every((role) =>
    isRecord(role) &&
    typeof role.slug === "string" &&
    typeof role.displayName === "string" &&
    typeof role.priority === "number" &&
    Number.isFinite(role.priority)
  ) && value.permissions.every((permission) => typeof permission === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
