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
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 15_000) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async start(deviceId: string, signal?: AbortSignal) {
    const result = await this.post("/v1/auth/steam/start", {
      deviceId
    }, signal);
    if (
      !isRecord(result) ||
      typeof result.authRequestId !== "string" ||
      typeof result.pollSecret !== "string" ||
      typeof result.steamLoginUrl !== "string" ||
      typeof result.expiresAt !== "string" ||
      typeof result.pollingInterval !== "number"
    ) {
      throw new SteamOpenIdClientError("malformed_response", "malformed");
    }
    return result as unknown as SteamOpenIdStartResult;
  }

  async status(input: {
    authRequestId: string;
    pollSecret: string;
    deviceId: string;
  }, signal?: AbortSignal) {
    const result = await this.post("/v1/auth/steam/status", input, signal);
    if (!isSteamOpenIdStatus(result)) {
      throw new SteamOpenIdClientError("malformed_response", "malformed");
    }
    return result;
  }

  private async post(
    path: string,
    body: object,
    signal?: AbortSignal
  ): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: requestSignal
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timeoutSignal.aborted) {
        throw new SteamOpenIdClientError("request_timeout", "timeout");
      }
      throw new SteamOpenIdClientError("network_or_cors_failure", "network");
    }
    let result: unknown;
    try {
      result = JSON.parse(await response.text());
    } catch {
      if (response.ok) {
        throw new SteamOpenIdClientError("malformed_response", "malformed");
      }
    }
    if (!response.ok) {
      throw new SteamOpenIdClientError(
        isRecord(result) && typeof result.error === "string"
          ? result.error
          : `http_${response.status}`,
        "http",
        response.status
      );
    }
    return result;
  }
}

export type SteamOpenIdClientErrorKind =
  | "network"
  | "http"
  | "malformed"
  | "timeout";

export class SteamOpenIdClientError extends Error {
  readonly code: string;
  readonly kind: SteamOpenIdClientErrorKind;
  readonly httpStatus?: number;

  constructor(
    code: string,
    kind: SteamOpenIdClientErrorKind,
    httpStatus?: number
  ) {
    super(code);
    this.code = code;
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.name = "SteamOpenIdClientError";
  }
}

function isSteamOpenIdStatus(value: unknown): value is SteamOpenIdStatus {
  if (!isRecord(value) || typeof value.status !== "string") return false;
  if (value.status === "pending" || value.status === "expired" || value.status === "cancelled") {
    return true;
  }
  if (value.status === "failed") {
    return value.errorCode === undefined || typeof value.errorCode === "string";
  }
  return value.status === "verified" &&
    /^\d{17}$/.test(String(value.steamId)) &&
    typeof value.authenticatedAt === "string" &&
    Number.isFinite(Date.parse(value.authenticatedAt)) &&
    typeof value.sessionToken === "string" &&
    value.sessionToken.length > 0 &&
    typeof value.sessionExpiresAt === "string" &&
    Number.isFinite(Date.parse(value.sessionExpiresAt)) &&
    typeof value.refreshCredential === "string" &&
    value.refreshCredential.length > 0 &&
    typeof value.refreshExpiresAt === "string" &&
    Number.isFinite(Date.parse(value.refreshExpiresAt));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
