export const STEAM_OPENID_ENDPOINT =
  "https://steamcommunity.com/openid/login";
export const OPENID_2_NAMESPACE = "http://specs.openid.net/auth/2.0";
export const OPENID_IDENTIFIER_SELECT =
  "http://specs.openid.net/auth/2.0/identifier_select";

export type OpenIdFields = Readonly<Record<string, string>>;

export type SteamOpenIdFailureReason =
  | "malformed_response"
  | "wrong_namespace"
  | "wrong_provider"
  | "wrong_return_to"
  | "wrong_realm"
  | "invalid_claimed_id"
  | "identity_mismatch"
  | "malformed_nonce"
  | "nonce_too_old"
  | "nonce_from_future"
  | "nonce_replayed"
  | "assertion_invalid"
  | "verification_timeout"
  | "verification_rate_limited"
  | "verification_unavailable"
  | "verification_response_invalid";

export type SteamOpenIdVerificationResult =
  | { ok: true; steamId: string; responseNonce: string }
  | { ok: false; reason: SteamOpenIdFailureReason; temporary?: boolean };

export type SteamAssertionCheckResult =
  | { ok: true; isValid: boolean }
  | { ok: false; reason: SteamOpenIdFailureReason; temporary: boolean };

export interface SteamAssertionChecker {
  checkAssertion(fields: OpenIdFields): Promise<SteamAssertionCheckResult>;
}
