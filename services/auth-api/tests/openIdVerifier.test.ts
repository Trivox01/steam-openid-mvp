import assert from "node:assert/strict";
import test from "node:test";
import { SteamOpenIdVerifier } from "../src/steam/openIdVerifier.ts";
import {
  OPENID_2_NAMESPACE,
  STEAM_OPENID_ENDPOINT,
  type OpenIdFields,
  type SteamAssertionChecker
} from "../src/steam/openIdTypes.ts";

const NOW = Date.parse("2026-07-28T12:00:00Z");
const RETURN_TO =
  "https://auth.example.test/v1/auth/steam/callback?transaction=tx-1";
const REALM = "https://auth.example.test/";
const STEAM_ID = "76561198000000000";

const validFields: OpenIdFields = {
  "openid.ns": OPENID_2_NAMESPACE,
  "openid.mode": "id_res",
  "openid.op_endpoint": STEAM_OPENID_ENDPOINT,
  "openid.return_to": RETURN_TO,
  "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
  "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
  "openid.response_nonce": "2026-07-28T12:00:00Zunique",
  "openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce",
  "openid.sig": "opaque-signature"
};

class FakeChecker implements SteamAssertionChecker {
  result: Awaited<ReturnType<SteamAssertionChecker["checkAssertion"]>> = {
    ok: true,
    isValid: true
  };
  fields?: OpenIdFields;

  async checkAssertion(fields: OpenIdFields) {
    this.fields = fields;
    return this.result;
  }
}

function makeVerifier(checker = new FakeChecker(), realm = REALM) {
  return {
    checker,
    verifier: new SteamOpenIdVerifier(checker, { realm, now: () => NOW })
  };
}

test("accepts a locally valid assertion after Steam confirms it", async () => {
  const { checker, verifier } = makeVerifier();
  assert.deepEqual(await verifier.verify(validFields, RETURN_TO), {
    ok: true,
    steamId: STEAM_ID,
    responseNonce: validFields["openid.response_nonce"]
  });
  assert.equal(checker.fields?.["openid.sig"], "opaque-signature");
});

for (const [name, patch, reason] of [
  ["wrong namespace", { "openid.ns": "wrong" }, "wrong_namespace"],
  ["wrong provider", { "openid.op_endpoint": "https://example.test/" }, "wrong_provider"],
  ["wrong return_to", { "openid.return_to": "https://auth.example.test/wrong" }, "wrong_return_to"],
  ["malformed claimed id", { "openid.claimed_id": "not-a-url", "openid.identity": "not-a-url" }, "invalid_claimed_id"],
  ["wrong claimed id host", {
    "openid.claimed_id": `https://evil.test/openid/id/${STEAM_ID}`,
    "openid.identity": `https://evil.test/openid/id/${STEAM_ID}`
  }, "invalid_claimed_id"],
  ["userinfo in claimed id", {
    "openid.claimed_id": `https://user@steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.identity": `https://user@steamcommunity.com/openid/id/${STEAM_ID}`
  }, "invalid_claimed_id"],
  ["query in claimed id", {
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}?x=1`,
    "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID}?x=1`
  }, "invalid_claimed_id"],
  ["fragment in claimed id", {
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}#x`,
    "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID}#x`
  }, "invalid_claimed_id"],
  ["invalid SteamID length", {
    "openid.claimed_id": "https://steamcommunity.com/openid/id/123",
    "openid.identity": "https://steamcommunity.com/openid/id/123"
  }, "invalid_claimed_id"],
  ["identity mismatch", {
    "openid.identity": "https://steamcommunity.com/openid/id/76561198000000001"
  }, "identity_mismatch"]
] as const) {
  test(`rejects ${name}`, async () => {
    const { verifier } = makeVerifier();
    const result = await verifier.verify({ ...validFields, ...patch }, RETURN_TO);
    assert.deepEqual(result, { ok: false, reason });
  });
}

test("rejects a return URL outside the expected realm", async () => {
  const { verifier } = makeVerifier(new FakeChecker(), "https://auth.example.test/auth/");
  assert.deepEqual(await verifier.verify(validFields, RETURN_TO), {
    ok: false,
    reason: "wrong_realm"
  });
});

test("accepts a Steam-style nonce with printable suffix after the UTC timestamp", async () => {
  const { verifier } = makeVerifier();
  const responseNonce = "2026-07-28T12:00:00ZwHqUwFMm+Q/9=:!$";
  assert.deepEqual(await verifier.verify({
    ...validFields,
    "openid.response_nonce": responseNonce
  }, RETURN_TO), {
    ok: true,
    steamId: STEAM_ID,
    responseNonce
  });
});

test("distinguishes malformed, old, and future response nonces", async () => {
  const { verifier } = makeVerifier();
  assert.deepEqual(await verifier.verify({
    ...validFields,
    "openid.response_nonce": "not-a-nonce"
  }, RETURN_TO), { ok: false, reason: "malformed_nonce" });
  assert.deepEqual(await verifier.verify({
    ...validFields,
    "openid.response_nonce": "2026-02-30T12:00:00Zinvalid-date"
  }, RETURN_TO), { ok: false, reason: "malformed_nonce" });
  assert.deepEqual(await verifier.verify({
    ...validFields,
    "openid.response_nonce": "2026-07-28T12:00:00Zcontains space"
  }, RETURN_TO), { ok: false, reason: "malformed_nonce" });
  assert.deepEqual(await verifier.verify({
    ...validFields,
    "openid.response_nonce": "2026-07-28T11:40:00Zold"
  }, RETURN_TO), { ok: false, reason: "nonce_too_old" });
  assert.deepEqual(await verifier.verify({
    ...validFields,
    "openid.response_nonce": "2026-07-28T12:02:01Zfuture"
  }, RETURN_TO), { ok: false, reason: "nonce_from_future" });
});

test("rejects missing signature and unsigned security-critical fields", async () => {
  const { verifier } = makeVerifier();
  assert.deepEqual(await verifier.verify({
    ...validFields,
    "openid.sig": ""
  }, RETURN_TO), { ok: false, reason: "malformed_response" });
  assert.deepEqual(await verifier.verify({
    ...validFields,
    "openid.signed": "claimed_id,identity"
  }, RETURN_TO), { ok: false, reason: "malformed_response" });
});

test("rejects an assertion Steam marks invalid", async () => {
  const checker = new FakeChecker();
  checker.result = { ok: true, isValid: false };
  const { verifier } = makeVerifier(checker);
  assert.deepEqual(await verifier.verify(validFields, RETURN_TO), {
    ok: false,
    reason: "assertion_invalid"
  });
});

for (const reason of [
  "verification_timeout",
  "verification_rate_limited",
  "verification_unavailable"
] as const) {
  test(`propagates temporary ${reason}`, async () => {
    const checker = new FakeChecker();
    checker.result = { ok: false, reason, temporary: true };
    const { verifier } = makeVerifier(checker);
    assert.deepEqual(await verifier.verify(validFields, RETURN_TO), checker.result);
  });
}
