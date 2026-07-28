import type {
  SteamOpenIdStartResult,
  SteamOpenIdStatus
} from "../../types/steamOpenId";

export interface SteamOpenIdApi {
  start(deviceId: string, signal?: AbortSignal): Promise<SteamOpenIdStartResult>;
  status(input: {
    authRequestId: string;
    pollSecret: string;
    deviceId: string;
  }, signal?: AbortSignal): Promise<SteamOpenIdStatus>;
}

export class SteamOpenIdClient implements SteamOpenIdApi {
  constructor(private readonly baseUrl: string) {}

  start(deviceId: string, signal?: AbortSignal) {
    return this.post<SteamOpenIdStartResult>("/v1/auth/steam/start", {
      deviceId
    }, signal);
  }

  status(input: {
    authRequestId: string;
    pollSecret: string;
    deviceId: string;
  }, signal?: AbortSignal) {
    return this.post<SteamOpenIdStatus>("/v1/auth/steam/status", input, signal);
  }

  private async post<T extends object>(
    path: string,
    body: object,
    signal?: AbortSignal
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal
    });
    const result = await response.json() as T | { error?: string };
    if (!response.ok) {
      throw new SteamOpenIdClientError(
        "error" in result && result.error ? result.error : "steam_auth_unavailable"
      );
    }
    return result as T;
  }
}

export class SteamOpenIdClientError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SteamOpenIdClientError";
  }
}
