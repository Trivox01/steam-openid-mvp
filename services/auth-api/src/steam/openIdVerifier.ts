import { returnToBelongsToRealm } from "../config.ts";
import {
  OPENID_2_NAMESPACE,
  STEAM_OPENID_ENDPOINT,
  type OpenIdFields,
  type SteamAssertionChecker,
  type SteamOpenIdVerificationResult
} from "./openIdTypes.ts";

const DEFAULT_NONCE_MAX_AGE_MS = 10 * 60_000;
const DEFAULT_CLOCK_SKEW_MS = 2 * 60_000;
const NONCE_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)[A-Za-z0-9._~-]{0,255}$/;

export class SteamOpenIdVerifier {
  readonly #checker: SteamAssertionChecker;
  readonly #realm: string;
  readonly #now: () => number;
  readonly #nonceMaxAgeMs: number;
  readonly #clockSkewMs: number;

  constructor(
    checker: SteamAssertionChecker,
    options: {
      realm: string;
      now?: () => number;
      nonceMaxAgeMs?: number;
      clockSkewMs?: number;
    }
  ) {
    this.#checker = checker;
    this.#realm = options.realm;
    this.#now = options.now ?? Date.now;
    this.#nonceMaxAgeMs = options.nonceMaxAgeMs ?? DEFAULT_NONCE_MAX_AGE_MS;
    this.#clockSkewMs = options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  }

  async verify(
    fields: OpenIdFields,
    expectedReturnTo: string
  ): Promise<SteamOpenIdVerificationResult> {
    if (fields["openid.mode"] !== "id_res") return failure("malformed_response");
    if (!hasRequiredSignedFields(fields)) return failure("malformed_response");
    if (fields["openid.ns"] !== OPENID_2_NAMESPACE) {
      return failure("wrong_namespace");
    }
    if (fields["openid.op_endpoint"] !== STEAM_OPENID_ENDPOINT) {
      return failure("wrong_provider");
    }
    if (fields["openid.return_to"] !== expectedReturnTo) {
      return failure("wrong_return_to");
    }
    if (!returnToBelongsToRealm(expectedReturnTo, this.#realm)) {
      return failure("wrong_realm");
    }

    const claimedId = fields["openid.claimed_id"];
    if (!claimedId || claimedId !== fields["openid.identity"]) {
      return failure("identity_mismatch");
    }
    const steamId = parseSteamClaimedId(claimedId);
    if (!steamId) return failure("invalid_claimed_id");

    const responseNonce = fields["openid.response_nonce"];
    const nonceFailure = validateNonce(
      responseNonce,
      this.#now(),
      this.#nonceMaxAgeMs,
      this.#clockSkewMs
    );
    if (nonceFailure) return failure(nonceFailure);

    const remote = await this.#checker.checkAssertion(fields);
    if (!remote.ok) return remote;
    if (!remote.isValid) return failure("assertion_invalid");
    return { ok: true, steamId, responseNonce };
  }
}

function hasRequiredSignedFields(fields: OpenIdFields) {
  if (!fields["openid.sig"]) return false;
  const signed = new Set(
    (fields["openid.signed"] ?? "").split(",").map((value) => value.trim())
  );
  return [
    "op_endpoint",
    "claimed_id",
    "identity",
    "return_to",
    "response_nonce"
  ].every((field) => signed.has(field));
}

function parseSteamClaimedId(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.hostname !== "steamcommunity.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return undefined;
  }
  const match = /^\/openid\/id\/(\d{17})$/.exec(url.pathname);
  return match?.[1];
}

function validateNonce(
  nonce: string | undefined,
  now: number,
  maxAgeMs: number,
  clockSkewMs: number
): "invalid_nonce" | "nonce_expired" | undefined {
  if (!nonce) return "invalid_nonce";
  const match = NONCE_TIMESTAMP.exec(nonce);
  if (!match) return "invalid_nonce";
  const timestamp = Date.parse(match[1]);
  if (!Number.isFinite(timestamp)) return "invalid_nonce";
  if (timestamp < now - maxAgeMs || timestamp > now + clockSkewMs) {
    return "nonce_expired";
  }
  return undefined;
}

function failure(
  reason: Exclude<
    SteamOpenIdVerificationResult,
    { ok: true }
  >["reason"]
): SteamOpenIdVerificationResult {
  return { ok: false, reason };
}
