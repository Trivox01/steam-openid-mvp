import assert from "node:assert/strict";
import test from "node:test";
import { SteamBackendDataClient } from "../src/services/platform/SteamBackendDataClient.ts";
import { SteamIntegrationError } from "../src/integrations/steam/SteamIntegrationError.ts";

const originalFetch = globalThis.fetch;

test("Desktop uses the authenticated backend and validates achievement responses", async () => {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({
      appId: 2807960,
      gameName: "Battlefield™ 6",
      achievements: [],
      warnings: [],
      fetchedAt: "2026-07-30T00:00:00Z"
    });
  };
  try {
    const client = new SteamBackendDataClient("https://backend.example", activeSession());
    const result = await client.getGameAchievements(2807960);
    assert.equal(result.appId, 2807960);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://backend.example/api/steam/games/2807960/achievements/sync");
    assert.equal(requests[0].init.method, "POST");
    assert.equal(requests[0].init.headers.authorization, "Bearer session-token");
    assert.doesNotMatch(JSON.stringify(requests[0]), /api.?key|steamid/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Desktop stops before the network when the Nexus session expired", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({});
  };
  try {
    const client = new SteamBackendDataClient("https://backend.example", {
      getActiveSession() { return undefined; },
      expireSession() {}
    });
    await assert.rejects(
      client.getGameAchievements(2807960),
      (error) => error instanceof SteamIntegrationError && error.code === "session_expired"
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Desktop preserves precise backend errors and expires a rejected session", async () => {
  let expired = false;
  globalThis.fetch = async () =>
    Response.json({ error: "session_expired" }, { status: 401 });
  try {
    const client = new SteamBackendDataClient("https://backend.example", {
      getActiveSession() {
        return { token: "session-token", expiresAt: "2099-01-01T00:00:00Z" };
      },
      expireSession() { expired = true; }
    });
    await assert.rejects(
      client.getOwnedGames(),
      (error) => error instanceof SteamIntegrationError && error.code === "session_expired"
    );
    assert.equal(expired, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Desktop rejects malformed success responses", async () => {
  globalThis.fetch = async () => Response.json({ achievements: "invalid" });
  try {
    const client = new SteamBackendDataClient("https://backend.example", activeSession());
    await assert.rejects(
      client.getGameAchievements(2807960),
      (error) => error instanceof SteamIntegrationError && error.code === "invalid_response"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function activeSession() {
  return {
    getActiveSession() {
      return { token: "session-token", expiresAt: "2099-01-01T00:00:00Z" };
    },
    expireSession() {}
  };
}
