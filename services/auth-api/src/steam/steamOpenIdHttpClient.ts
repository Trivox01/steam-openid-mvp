import {
  STEAM_OPENID_ENDPOINT,
  type OpenIdFields,
  type SteamAssertionChecker,
  type SteamAssertionCheckResult
} from "./openIdTypes.ts";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4_096;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export class SteamOpenIdHttpClient implements SteamAssertionChecker {
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;

  constructor(options: {
    fetch?: FetchLike;
    timeoutMs?: number;
    maxResponseBytes?: number;
  } = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxResponseBytes =
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  async checkAssertion(
    fields: OpenIdFields
  ): Promise<SteamAssertionCheckResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    timeout.unref?.();

    try {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(fields)) {
        if (key.startsWith("openid.")) body.set(key, value);
      }
      body.set("openid.mode", "check_authentication");

      const response = await this.#fetch(STEAM_OPENID_ENDPOINT, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "text/plain"
        },
        body
      });

      if (response.status === 429) {
        return temporaryFailure("verification_rate_limited");
      }
      if (response.status >= 500) {
        return temporaryFailure("verification_unavailable");
      }
      if (response.status >= 300 && response.status < 400) {
        return temporaryFailure("verification_unavailable");
      }
      if (!response.ok) {
        return { ok: false, reason: "assertion_invalid", temporary: false };
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("text/plain")) {
        return invalidResponse();
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > this.#maxResponseBytes
      ) {
        return invalidResponse();
      }
      const responseText = await readLimitedText(
        response,
        this.#maxResponseBytes
      );
      if (responseText === undefined) return invalidResponse();

      const parsed = parseKeyValueResponse(responseText);
      if (!parsed) return invalidResponse();
      return { ok: true, isValid: parsed.get("is_valid") === "true" };
    } catch (error) {
      if (
        error instanceof DOMException && error.name === "AbortError" ||
        error instanceof Error && error.name === "AbortError"
      ) {
        return temporaryFailure("verification_timeout");
      }
      return temporaryFailure("verification_unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function temporaryFailure(
  reason: "verification_rate_limited" | "verification_unavailable" | "verification_timeout"
): SteamAssertionCheckResult {
  return { ok: false, reason, temporary: true };
}

function invalidResponse(): SteamAssertionCheckResult {
  return {
    ok: false,
    reason: "verification_response_invalid",
    temporary: false
  };
}

async function readLimitedText(response: Response, limit: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return undefined;
    }
    output += decoder.decode(chunk.value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

function parseKeyValueResponse(value: string) {
  const result = new Map<string, string>();
  for (const line of value.split(/\r?\n/)) {
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) return undefined;
    const key = line.slice(0, separator);
    const item = line.slice(separator + 1);
    if (result.has(key)) return undefined;
    result.set(key, item);
  }
  return result;
}
