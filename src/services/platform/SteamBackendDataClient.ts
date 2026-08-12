import type { SteamGameAchievementsDto, SteamOwnedGamesResult } from "../../types/index.ts";
import { SteamIntegrationError } from "../../integrations/steam/SteamIntegrationError.ts";
import type { SteamBackendSession } from "../../types/steamOpenId.ts";
import { DesktopSessionBridgeError } from "./TauriDesktopSessionBridge.ts";

export interface SteamDataGateway {
  readonly available: boolean;
  getOwnedGames(signal?: AbortSignal): Promise<SteamOwnedGamesResult>;
  getGameAchievements(appId: number, signal?: AbortSignal): Promise<SteamGameAchievementsDto>;
}

export interface SteamSessionProvider {
  getActiveSession(): SteamBackendSession | undefined;
  expireSession(): void;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
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

  getOwnedGames(signal?: AbortSignal) {
    return this.request<SteamOwnedGamesResult>("/api/steam/library", "GET", isOwnedGamesResult, signal);
  }

  getGameAchievements(appId: number, signal?: AbortSignal) {
    if (!Number.isSafeInteger(appId) || appId <= 0) {
      throw new SteamIntegrationError("The stored Steam AppID is invalid.", "invalid_app_id");
    }
    return this.request<SteamGameAchievementsDto>(
      `/api/steam/games/${appId}/achievements/sync`,
      "POST",
      isAchievementResult,
      signal
    );
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST",
    validate: (value: unknown) => value is T,
    signal?: AbortSignal
  ): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response: Response;
    try {
      response = await this.sessions.authenticatedFetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(method === "POST" ? { "content-type": "application/json" } : {})
        },
        signal: requestSignal
      });
    } catch (error) {
      if (error instanceof DesktopSessionBridgeError &&
          ["none", "invalid", "account_not_active"].includes(error.kind)) {
        throw new SteamIntegrationError("The Nexus session has expired.",
          error.kind === "account_not_active" ? "ACCOUNT_NOT_ACTIVE" : "session_expired");
      }
      throw new SteamIntegrationError(
        "The Steam data service could not be reached.",
        signal?.aborted ? "cancelled" : timeoutSignal.aborted ? "timeout" : "network"
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
