import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SteamOpenIdSignInService } from "../src/services/platform/SteamOpenIdSignInService.ts";
import {
  SteamOpenIdClient,
  SteamOpenIdClientError
} from "../src/services/platform/SteamOpenIdClient.ts";

const DEVICE_ID = "f7930e64-64c0-4e25-8681-39362ac65478";
const VERIFIED_IDENTITY = {
  steamId: "76561198000000000",
  authenticatedAt: "2026-07-28T12:00:00.000Z",
  authMethod: "steam_openid"
};

function createHarness(statuses, options = {}) {
  const calls = [];
  const saved = [];
  const state = {
    deviceId: DEVICE_ID,
    ...(options.identity ? { identity: options.identity } : {})
  };
  let startCount = 0;
  const api = {
    async start(deviceId) {
      startCount += 1;
      const transaction = {
        authRequestId: `request-${startCount}`,
        pollSecret: `ephemeral-poll-secret-${startCount}`
      };
      calls.push(["start", deviceId, transaction]);
      return {
        ...transaction,
        steamLoginUrl: `https://steamcommunity.com/openid/login?test=${startCount}`,
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
      return structuredClone(state);
    },
    async saveIdentity(identity) {
      saved.push(identity);
      state.identity = identity;
    },
    async clearAuthenticatedSteamIdentity() {
      if (options.clearError) throw new Error("sqlite_write_failed");
      delete state.identity;
    }
  };
  const opened = [];
  const opener = {
    async open(url) {
      opened.push(url);
    }
  };
  const wait = options.wait ??
    (async (_milliseconds, signal) => signal.throwIfAborted());
  return {
    service: new SteamOpenIdSignInService(api, store, opener, wait),
    calls,
    saved,
    opened,
    state,
    store
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
  assert.equal(JSON.stringify(harness.saved).includes("request-"), false);
});

test("Sign Out removes only the identity and preserves the stable device id", async () => {
  const harness = createHarness([], { identity: VERIFIED_IDENTITY });
  await harness.service.signOut();
  assert.equal(harness.state.deviceId, DEVICE_ID);
  assert.equal(harness.state.identity, undefined);
  assert.equal(await harness.service.getSavedIdentity(), undefined);
});

test("Sign Out aborts active polling before clearing identity", async () => {
  let pollingStarted;
  const enteredPolling = new Promise((resolve) => {
    pollingStarted = resolve;
  });
  const harness = createHarness([], {
    identity: VERIFIED_IDENTITY,
    wait: async (_milliseconds, signal) => {
      pollingStarted();
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true
        });
      });
    }
  });
  const signingIn = harness.service.signIn(new AbortController().signal);
  await enteredPolling;
  await harness.service.signOut();
  await assert.rejects(signingIn, (error) => error?.name === "AbortError");
  assert.equal(harness.state.identity, undefined);
  assert.equal(harness.calls.filter(([name]) => name === "status").length, 0);
});

test("a SQLite clear failure preserves the connected identity", async () => {
  const harness = createHarness([], {
    identity: VERIFIED_IDENTITY,
    clearError: true
  });
  await assert.rejects(harness.service.signOut(), /sqlite_write_failed/);
  assert.deepEqual(harness.state.identity, VERIFIED_IDENTITY);
});

test("Change Account clears the old identity and starts a fresh transaction", async () => {
  const secondIdentity = {
    ...VERIFIED_IDENTITY,
    steamId: "76561198000000001",
    authenticatedAt: "2026-07-28T13:00:00.000Z"
  };
  const harness = createHarness([
    { status: "verified", ...VERIFIED_IDENTITY },
    { status: "verified", ...secondIdentity }
  ]);
  await harness.service.signIn(new AbortController().signal);
  const firstTransaction = harness.calls.find(([name]) => name === "start")[2];
  await harness.service.signOut();
  await harness.service.signIn(new AbortController().signal);
  const starts = harness.calls.filter(([name]) => name === "start");
  const secondTransaction = starts[1][2];
  assert.equal(starts.length, 2);
  assert.notEqual(firstTransaction.authRequestId, secondTransaction.authRequestId);
  assert.notEqual(firstTransaction.pollSecret, secondTransaction.pollSecret);
  assert.equal(harness.state.deviceId, DEVICE_ID);
  assert.deepEqual(harness.state.identity, secondIdentity);
});

test("a restarted service remains signed out and sees the same device id", async () => {
  const harness = createHarness([], { identity: VERIFIED_IDENTITY });
  await harness.service.signOut();
  const restarted = new SteamOpenIdSignInService(
    {
      async start() {
        throw new Error("not_expected");
      },
      async status() {
        throw new Error("not_expected");
      }
    },
    harness.store,
    { async open() {} }
  );
  assert.equal(await restarted.getSavedIdentity(), undefined);
  assert.equal((await harness.store.getState()).deviceId, DEVICE_ID);
});

test("Phase 3.1.5 account actions contain no automatic sync calls", async () => {
  const sources = await Promise.all([
    readFile(new URL("../src/components/settings/SteamOpenIdAccountSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/platform/SteamOpenIdSignInService.ts", import.meta.url), "utf8")
  ]);
  for (const source of sources) {
    assert.equal(/steamLibrarySync|steamAchievementSync|statistics\\.refresh/.test(source), false);
  }
});

test("English and Arabic account-action translations are present", async () => {
  const [english, arabic] = await Promise.all([
    readFile(new URL("../src/locales/en/steam.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/locales/ar/steam.ts", import.meta.url), "utf8")
  ]);
  for (const key of [
    "steam.openId.signOutDialog.title",
    "steam.openId.changeAccountDialog.title",
    "steam.openId.processing"
  ]) {
    assert.equal(english.includes(`\"${key}\"`), true);
    assert.equal(arabic.includes(`\"${key}\"`), true);
  }
  assert.equal(arabic.includes("تسجيل الخروج من Steam؟"), true);
  assert.equal(english.includes("Change Steam account?"), true);
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

test("Desktop client distinguishes backend HTTP errors", async (context) => {
  context.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ error: "invalid_device_id" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    })
  );
  const client = new SteamOpenIdClient("https://auth.example.test");
  await assert.rejects(
    client.start(DEVICE_ID),
    (error) =>
      error instanceof SteamOpenIdClientError &&
      error.kind === "http" &&
      error.code === "invalid_device_id" &&
      error.httpStatus === 401
  );
});

test("Desktop client distinguishes malformed successful responses", async (context) => {
  context.mock.method(globalThis, "fetch", async () =>
    new Response("<html>not json</html>", { status: 200 })
  );
  const client = new SteamOpenIdClient("https://auth.example.test");
  await assert.rejects(
    client.start(DEVICE_ID),
    (error) =>
      error instanceof SteamOpenIdClientError &&
      error.kind === "malformed" &&
      error.code === "malformed_response"
  );
});

test("Desktop client distinguishes network and timeout failures", async (context) => {
  context.mock.method(globalThis, "fetch", async (_input, init) => {
    await new Promise((resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    throw new Error("unreachable");
  });
  const client = new SteamOpenIdClient("https://auth.example.test", 5);
  await assert.rejects(
    client.start(DEVICE_ID),
    (error) =>
      error instanceof SteamOpenIdClientError &&
      error.kind === "timeout"
  );
});

test("Desktop client reports a fetch rejection as a network or CORS failure", async (context) => {
  context.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  const client = new SteamOpenIdClient("https://auth.example.test");
  await assert.rejects(
    client.start(DEVICE_ID),
    (error) =>
      error instanceof SteamOpenIdClientError &&
      error.kind === "network" &&
      error.code === "network_or_cors_failure"
  );
});
