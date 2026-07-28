import assert from "node:assert/strict";
import test from "node:test";
import { SteamOpenIdSignInService } from "../src/services/platform/SteamOpenIdSignInService.ts";

const DEVICE_ID = "f7930e64-64c0-4e25-8681-39362ac65478";
const VERIFIED_IDENTITY = {
  steamId: "76561198000000000",
  authenticatedAt: "2026-07-28T12:00:00.000Z",
  authMethod: "steam_openid"
};

function createHarness(statuses) {
  const calls = [];
  const saved = [];
  const api = {
    async start(deviceId) {
      calls.push(["start", deviceId]);
      return {
        authRequestId: "request-id",
        pollSecret: "ephemeral-poll-secret",
        steamLoginUrl: "https://steamcommunity.com/openid/login?test=1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        pollingInterval: 3_000
      };
    },
    async status(input) {
      calls.push(["status", input]);
      return statuses.shift() ?? { status: "pending" };
    }
  };
  const store = {
    async getState() {
      return { deviceId: DEVICE_ID };
    },
    async saveIdentity(identity) {
      saved.push(identity);
    },
    async clearIdentity() {}
  };
  const opened = [];
  const opener = {
    async open(url) {
      opened.push(url);
    }
  };
  const wait = async (_milliseconds, signal) => signal.throwIfAborted();
  return {
    service: new SteamOpenIdSignInService(api, store, opener, wait),
    calls,
    saved,
    opened
  };
}

test("polls with the stable device id, stops on verified, and persists identity only", async () => {
  const harness = createHarness([
    { status: "pending" },
    { status: "verified", ...VERIFIED_IDENTITY }
  ]);
  const result = await harness.service.signIn(new AbortController().signal);
  assert.deepEqual(result, { status: "verified", identity: VERIFIED_IDENTITY });
  assert.equal(harness.opened.length, 1);
  assert.equal(harness.calls.filter(([name]) => name === "status").length, 2);
  assert.equal(harness.calls[1][1].deviceId, DEVICE_ID);
  assert.deepEqual(harness.saved, [VERIFIED_IDENTITY]);
  assert.equal(JSON.stringify(harness.saved).includes("pollSecret"), false);
  assert.equal(JSON.stringify(harness.saved).includes("request-id"), false);
});

test("stops immediately on every terminal failure state without persisting", async () => {
  for (const status of ["expired", "failed", "cancelled"]) {
    const harness = createHarness([{ status, ...(status === "failed" ? { errorCode: "safe_failure" } : {}) }]);
    const result = await harness.service.signIn(new AbortController().signal);
    assert.equal(result.status, status);
    assert.equal(harness.calls.filter(([name]) => name === "status").length, 1);
    assert.deepEqual(harness.saved, []);
  }
});

test("an aborted sign-in does not start a transaction or open the browser", async () => {
  const harness = createHarness([]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    harness.service.signIn(controller.signal),
    (error) => error instanceof DOMException && error.name === "AbortError"
  );
  assert.deepEqual(harness.calls, []);
  assert.deepEqual(harness.opened, []);
});
