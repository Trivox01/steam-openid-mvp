import assert from "node:assert/strict";
import test from "node:test";
import { SteamOpenIdHttpClient } from "../src/steam/steamOpenIdHttpClient.ts";
import { STEAM_OPENID_ENDPOINT } from "../src/steam/openIdTypes.ts";

const fields = {
  "openid.mode": "id_res",
  "openid.sig": "signed-value"
};

test("posts the signed fields to the fixed Steam endpoint as check_authentication", async () => {
  let target = "";
  let init: RequestInit | undefined;
  const client = new SteamOpenIdHttpClient({
    fetch: async (input, requestInit) => {
      target = String(input);
      init = requestInit;
      return textResponse("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n");
    }
  });
  assert.deepEqual(await client.checkAssertion(fields), {
    ok: true,
    isValid: true
  });
  assert.equal(target, STEAM_OPENID_ENDPOINT);
  assert.equal(init?.redirect, "manual");
  const body = new URLSearchParams(String(init?.body));
  assert.equal(body.get("openid.mode"), "check_authentication");
  assert.equal(body.get("openid.sig"), "signed-value");
});

test("accepts only the exact is_valid:true response value", async () => {
  const client = clientFor(new Response("is_valid:false\n", {
    headers: { "content-type": "text/plain" }
  }));
  assert.deepEqual(await client.checkAssertion(fields), {
    ok: true,
    isValid: false
  });
});

test("treats 429, 5xx, and redirects as temporary verification failures", async () => {
  const rateLimited = await clientFor(new Response("", { status: 429 }))
    .checkAssertion(fields);
  assert.deepEqual(rateLimited, {
    ok: false,
    reason: "verification_rate_limited",
    temporary: true
  });
  for (const status of [302, 503]) {
    const result = await clientFor(new Response("", { status }))
      .checkAssertion(fields);
    assert.equal(result.ok, false);
    assert.equal(result.ok ? "" : result.reason, "verification_unavailable");
  }
});

test("rejects an unexpected response content type", async () => {
  const result = await clientFor(new Response("is_valid:true\n", {
    headers: { "content-type": "application/json" }
  })).checkAssertion(fields);
  assert.deepEqual(result, {
    ok: false,
    reason: "verification_response_invalid",
    temporary: false
  });
});

test("enforces the maximum response size while streaming", async () => {
  const client = new SteamOpenIdHttpClient({
    maxResponseBytes: 16,
    fetch: async () => textResponse("is_valid:true\nextra:value\n")
  });
  assert.deepEqual(await client.checkAssertion(fields), {
    ok: false,
    reason: "verification_response_invalid",
    temporary: false
  });
});

test("enforces the Steam verification timeout", async () => {
  const client = new SteamOpenIdHttpClient({
    timeoutMs: 5,
    fetch: async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      })
  });
  assert.deepEqual(await client.checkAssertion(fields), {
    ok: false,
    reason: "verification_timeout",
    temporary: true
  });
});

function clientFor(response: Response) {
  return new SteamOpenIdHttpClient({ fetch: async () => response });
}

function textResponse(body: string) {
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}
