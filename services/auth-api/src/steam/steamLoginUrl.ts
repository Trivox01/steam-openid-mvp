import {
  OPENID_2_NAMESPACE,
  OPENID_IDENTIFIER_SELECT,
  STEAM_OPENID_ENDPOINT
} from "./openIdTypes.ts";

export function buildSteamLoginUrl(realm: string, returnTo: string) {
  const url = new URL(STEAM_OPENID_ENDPOINT);
  url.searchParams.set("openid.ns", OPENID_2_NAMESPACE);
  url.searchParams.set("openid.mode", "checkid_setup");
  url.searchParams.set("openid.identity", OPENID_IDENTIFIER_SELECT);
  url.searchParams.set("openid.claimed_id", OPENID_IDENTIFIER_SELECT);
  url.searchParams.set("openid.realm", realm);
  url.searchParams.set("openid.return_to", returnTo);
  return url.toString();
}
