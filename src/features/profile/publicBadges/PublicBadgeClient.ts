import type { BackendSessionSource } from "../../developer-center/AuthorizationStore";
import type { PublicBadge } from "./types";

export class PublicBadgeClientError extends Error {
  constructor(readonly kind: "unauthorized" | "network" | "malformed" | "server") {
    super(kind);
    this.name = "PublicBadgeClientError";
  }
}

export class PublicBadgeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly sessions: BackendSessionSource
  ) {}

  async list(signal?: AbortSignal): Promise<PublicBadge[]> {
    const session = this.sessions.getActiveSession();
    if (!session) throw new PublicBadgeClientError("unauthorized");
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/me/public-badges`, {
        headers: { authorization: `Bearer ${session.token}` },
        signal
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new PublicBadgeClientError("network");
    }
    if (response.status === 401) {
      this.sessions.expireSession();
      throw new PublicBadgeClientError("unauthorized");
    }
    if (!response.ok) throw new PublicBadgeClientError("server");
    const payload: unknown = await response.json().catch(() => undefined);
    if (!isPayload(payload)) throw new PublicBadgeClientError("malformed");
    return payload.items.map((badge) => ({
      ...badge,
      iconUrl: new URL(badge.iconUrl, this.baseUrl).toString()
    }));
  }
}

function isPayload(value: unknown): value is { items: PublicBadge[] } {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 24) return false;
  return value.items.every((badge) =>
    isRecord(badge) &&
    typeof badge.slug === "string" &&
    typeof badge.displayName === "string" &&
    typeof badge.description === "string" &&
    ["staff", "community", "achievement", "event", "legacy", "special"].includes(String(badge.category)) &&
    ["common", "uncommon", "rare", "epic", "legendary", "exclusive"].includes(String(badge.rarity)) &&
    typeof badge.iconUrl === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
