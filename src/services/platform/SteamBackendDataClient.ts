import type { SteamGameAchievementsDto, SteamOwnedGamesResult } from "../../types/index.ts";
import { SteamIntegrationError } from "../../integrations/steam/SteamIntegrationError.ts";
import type { SteamBackendSession } from "../../types/steamOpenId.ts";

export interface SteamDataGateway {
  readonly available: boolean;
  getOwnedGames(): Promise<SteamOwnedGamesResult>;
  getGameAchievements(appId: number): Promise<SteamGameAchievementsDto>;
}

export interface SteamSessionProvider {
  getActiveSession(): SteamBackendSession | undefined;
  expireSession(): void;
}

export class SteamBackendDataClient implements SteamDataGateway {
  readonly available = true;
  private readonly baseUrl: string;
  private readonly sessions: SteamSessionProvider;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string,
    sessions: SteamSessionProvider,
    timeoutMs = 15_000
  ) {
    this.baseUrl = baseUrl;
    this.sessions = sessions;
    this.timeoutMs = timeoutMs;
  }

  getOwnedGames() {
    return this.request<SteamOwnedGamesResult>("/api/steam/library", "GET", isOwnedGamesResult);
  }

  getGameAchievements(appId: number) {
    if (!Number.isSafeInteger(appId) || appId <= 0) {
      throw new SteamIntegrationError("The stored Steam AppID is invalid.", "invalid_app_id");
    }
    return this.request<SteamGameAchievementsDto>(
      `/api/steam/games/${appId}/achievements/sync`,
      "POST",
      isAchievementResult
    );
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST",
    validate: (value: unknown) => value is T
  ): Promise<T> {
    const session = this.sessions.getActiveSession();
    if (!session) throw new SteamIntegrationError("The Nexus session has expired.", "session_expired");
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${session.token}`,
          ...(method === "POST" ? { "content-type": "application/json" } : {})
        },
        signal: timeoutSignal
      });
    } catch {
      throw new SteamIntegrationError(
        "The Steam data service could not be reached.",
        timeoutSignal.aborted ? "timeout" : "network"
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SteamIntegrationError("The server returned an invalid response.", "invalid_response");
    }
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : response.status === 401 ? "session_expired" : "steam_api_unavailable";
      if (response.status === 401) this.sessions.expireSession();
      throw new SteamIntegrationError("Steam synchronization failed.", code);
    }
    if (!validate(payload)) {
      throw new SteamIntegrationError("The server returned an invalid response.", "invalid_response");
    }
    return payload;
  }
}

function isOwnedGamesResult(value: unknown): value is SteamOwnedGamesResult {
  return isRecord(value) && Array.isArray(value.games) &&
    typeof value.fetched === "number" && typeof value.skipped === "number" &&
    Array.isArray(value.warnings);
}

function isAchievementResult(value: unknown): value is SteamGameAchievementsDto {
  return isRecord(value) && typeof value.appId === "number" &&
    typeof value.gameName === "string" && Array.isArray(value.achievements) &&
    Array.isArray(value.warnings) && typeof value.fetchedAt === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
