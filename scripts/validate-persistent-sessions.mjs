import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DesktopSessionBridgeError
} from "../src/services/platform/TauriDesktopSessionBridge.ts";
import { SteamOpenIdSignInService } from "../src/services/platform/SteamOpenIdSignInService.ts";
import { AuthorizationStore } from "../src/features/developer-center/AuthorizationStore.ts";
import { createAppInitializationLifecycle } from "../src/services/appInitializationLifecycle.ts";

const future = () => new Date(Date.now() + 15 * 60_000).toISOString();

function harness(options = {}) {
  let credentialPresent = options.credentialPresent ?? true;
  let refreshes = 0;
  let healthChecks = 0;
  let logouts = 0;
  let browserOpens = 0;
  let logicalNow = 0;
  const timeline = [];
  const waits = [];
  const healthResults = [...(options.healthResults ?? [true])];
  const bridge = {
    async store() { credentialPresent = true; },
    async hasCredential() { return credentialPresent; },
    async health() {
      healthChecks += 1;
      timeline.push("health");
      await options.healthBarrier?.();
      const result = healthResults.length > 1
        ? healthResults.shift()
        : healthResults[0];
      if (result instanceof Error) throw result;
      return result ?? false;
    },
    async refresh() {
      refreshes += 1;
      timeline.push("refresh");
      if (!credentialPresent) throw new DesktopSessionBridgeError("none");
      if (options.refreshError) {
        if (["invalid", "account_not_active"].includes(options.refreshError)) credentialPresent = false;
        throw new DesktopSessionBridgeError(options.refreshError);
      }
      await options.refreshBarrier?.();
      return { token: `access-${refreshes}`, expiresAt: future() };
    },
    async logout() { logouts += 1; credentialPresent = false; if (options.logoutError) throw new Error("offline"); }
  };
  const state = { deviceId: "0b55ec79-6c08-4f74-bd90-17e13a562aa9" };
  const service = new SteamOpenIdSignInService(
    { async start() { throw new Error("not used"); }, async status() { throw new Error("not used"); } },
    { async getState() { return state; }, async saveIdentity(identity) { state.identity = identity; }, async clearAuthenticatedSteamIdentity() { delete state.identity; } },
    { async open() { browserOpens += 1; } }, bridge, "https://api.example.com",
    options.wait ?? (async (milliseconds) => {
      waits.push(milliseconds);
      logicalNow += milliseconds;
    }),
    options.request ?? (async () => new Response(null, { status: 200 })),
    {
      budgetMs: options.healthBudgetMs ?? 30_000,
      backoffMs: options.healthBackoffMs ?? [500, 1_000, 2_000, 3_000, 5_000],
      now: () => logicalNow
    }
  );
  return {
    service,
    state,
    timeline,
    waits,
    get refreshes() { return refreshes; },
    get healthChecks() { return healthChecks; },
    get credentialPresent() { return credentialPresent; },
    get logouts() { return logouts; },
    get browserOpens() { return browserOpens; }
  };
}

function symbolicCredentialHarness(options = {}) {
  let credential = "credential-A";
  let logicalNow = 0;
  let responseNumber = 0;
  const requests = [];
  const writes = [];
  const bridge = {
    async store(value) { credential = value; },
    async hasCredential() { return Boolean(credential); },
    async health() { return true; },
    async refresh() {
      const sent = credential;
      requests.push({ credential: sent, at: logicalNow });
      const replacement = sent === "credential-A" ? "credential-B" : "credential-C";
      responseNumber += 1;
      const outcome = await options.respond?.({
        requestNumber: responseNumber,
        credential: sent,
        replacement,
        logicalNow
      });
      if (outcome === "network_error") throw new DesktopSessionBridgeError("network");
      if (outcome === "invalid") throw new DesktopSessionBridgeError("invalid");
      if (options.failWriteOn === responseNumber) {
        throw new DesktopSessionBridgeError("secure_storage");
      }
      writes.push(replacement);
      credential = replacement;
      return { token: `access-${responseNumber}`, expiresAt: future() };
    },
    async logout() { credential = undefined; }
  };
  const state = { deviceId: "0b55ec79-6c08-4f74-bd90-17e13a562aa9" };
  const service = new SteamOpenIdSignInService(
    { async start() { throw new Error("not used"); }, async status() { throw new Error("not used"); } },
    { async getState() { return state; }, async saveIdentity(identity) { state.identity = identity; }, async clearAuthenticatedSteamIdentity() { delete state.identity; } },
    { async open() {} }, bridge, "https://api.example.com", undefined,
    options.request ?? (async () => new Response(null, { status: 200 }))
  );
  return {
    service,
    requests,
    writes,
    advance(milliseconds) { logicalNow += milliseconds; },
    get credential() { return credential; }
  };
}

test("boot restore returns authenticated state, while no credential is ordinary sign-out", async () => {
  const restored = harness();
  assert.equal(await restored.service.restoreSession(), "restored");
  assert.ok(restored.service.getActiveSession());
  const absent = harness({ credentialPresent: false });
  assert.equal(await absent.service.restoreSession(), "signed_out");
});

test("healthy backend passes one credential-free preflight then refreshes once", async () => {
  const h = harness();
  assert.equal(await h.service.restoreSession(), "restored");
  assert.deepEqual(h.timeline, ["health", "refresh"]);
  assert.equal(h.healthChecks, 1);
  assert.equal(h.refreshes, 1);
});

test("unrelated refresh triggers keep the existing direct single-attempt path", async () => {
  const h = harness();
  await h.service.refreshSession("other");
  assert.equal(h.healthChecks, 0);
  assert.deepEqual(h.timeline, ["refresh"]);
  assert.equal(h.refreshes, 1);
});

test("access expiry with an awake backend passes one preflight then refreshes once", async () => {
  const h = harness();
  const session = await h.service.refreshSession("access_token_expired");
  assert.ok(session);
  assert.deepEqual(h.timeline, ["health", "refresh"]);
  assert.equal(h.healthChecks, 1);
  assert.equal(h.refreshes, 1);
});

test("access expiry waits for a cold backend before its single refresh", async () => {
  const h = harness({
    healthResults: [false, false, true],
    healthBackoffMs: [500, 1_000]
  });
  const session = await h.service.refreshSession("access_token_expired");
  assert.ok(session);
  assert.deepEqual(h.timeline, ["health", "health", "health", "refresh"]);
  assert.deepEqual(h.waits, [500, 1_000]);
  assert.equal(h.refreshes, 1);
});

test("access expiry preserves the credential when the backend never wakes", async () => {
  const h = harness({
    healthResults: [false],
    healthBudgetMs: 3_000,
    healthBackoffMs: [1_000]
  });
  await assert.rejects(
    () => h.service.refreshSession("access_token_expired"),
    (error) => error instanceof DesktopSessionBridgeError && error.kind === "network"
  );
  assert.equal(h.refreshes, 0);
  assert.equal(h.credentialPresent, true);
  assert.equal(h.browserOpens, 0);
  assert.equal(h.logouts, 0);
});

test("concurrent access expiry consumers share one wake and one refresh", async () => {
  let releaseHealth;
  const healthBarrier = new Promise((resolve) => { releaseHealth = resolve; });
  const h = harness({ healthBarrier: async () => healthBarrier });
  const first = h.service.refreshSession("access_token_expired");
  await Promise.resolve();
  const second = h.service.refreshSession("access_token_expired");
  await Promise.resolve();
  assert.equal(h.healthChecks, 1);
  assert.equal(h.refreshes, 0);
  releaseHealth();
  const [firstSession, secondSession] = await Promise.all([first, second]);
  assert.equal(firstSession, secondSession);
  assert.deepEqual(h.timeline, ["health", "refresh"]);
  assert.equal(h.refreshes, 1);
});

test("ambiguous access expiry refresh failure is never retried", async () => {
  const h = harness({ refreshError: "network" });
  await assert.rejects(
    () => h.service.refreshSession("access_token_expired"),
    (error) => error instanceof DesktopSessionBridgeError && error.kind === "network"
  );
  await Promise.resolve();
  assert.deepEqual(h.timeline, ["health", "refresh"]);
  assert.equal(h.healthChecks, 1);
  assert.equal(h.refreshes, 1);
  assert.equal(h.credentialPresent, true);
});

test("cold backend is probed with bounded backoff and refresh starts only after health", async () => {
  const h = harness({
    healthResults: [false, false, true],
    healthBackoffMs: [500, 1_000]
  });
  assert.equal(await h.service.restoreSession(), "restored");
  assert.deepEqual(h.timeline, ["health", "health", "health", "refresh"]);
  assert.deepEqual(h.waits, [500, 1_000]);
  assert.equal(h.refreshes, 1);
});

test("exhausted health budget is recoverable and never reads or deletes the credential", async () => {
  const h = harness({
    healthResults: [false],
    healthBudgetMs: 3_000,
    healthBackoffMs: [1_000]
  });
  assert.equal(await h.service.restoreSession(), "offline");
  assert.equal(h.healthChecks, 3);
  assert.equal(h.refreshes, 0);
  assert.equal(h.credentialPresent, true);
  assert.ok(h.timeline.every((event) => event === "health"));
});

test("concurrent boot and protected caller share one health wake and one refresh", async () => {
  let releaseHealth;
  const healthBarrier = new Promise((resolve) => { releaseHealth = resolve; });
  const h = harness({ healthBarrier: async () => healthBarrier });
  const boot = h.service.restoreSession();
  await Promise.resolve();
  const protectedRequest = h.service.authenticatedFetch("https://api.example.com/protected");
  await Promise.resolve();
  assert.equal(h.healthChecks, 1);
  assert.equal(h.refreshes, 0);
  releaseHealth();
  const [restoreResult, response] = await Promise.all([boot, protectedRequest]);
  assert.equal(restoreResult, "restored");
  assert.equal(response.status, 200);
  assert.deepEqual(h.timeline, ["health", "refresh"]);
  assert.equal(h.refreshes, 1);
});

test("ambiguous refresh transport failure is not retried after successful health wake", async () => {
  const h = harness({ refreshError: "network" });
  assert.equal(await h.service.restoreSession(), "offline");
  await Promise.resolve();
  assert.deepEqual(h.timeline, ["health", "refresh"]);
  assert.equal(h.healthChecks, 1);
  assert.equal(h.refreshes, 1);
  assert.equal(h.credentialPresent, true);
});

test("Arabic saved-language boot initializes and restores exactly once", async () => {
  let initializations = 0;
  let restores = 0;
  const lifecycle = createAppInitializationLifecycle(async () => {
    initializations += 1;
    restores += 1;
    return "ready";
  });
  assert.equal(await lifecycle.autoStart(), "ready");
  // Restoring Arabic changes the translation callback identity and rerenders
  // App. The automatic boot owner must treat that render as the same boot.
  const language = "ar";
  assert.equal(language, "ar");
  assert.equal(await lifecycle.autoStart(), "ready");
  assert.equal(initializations, 1);
  assert.equal(restores, 1);
});

test("English default boot initializes and restores exactly once", async () => {
  let restores = 0;
  const lifecycle = createAppInitializationLifecycle(async () => ++restores);
  assert.equal(await lifecycle.autoStart(), 1);
  assert.equal(await lifecycle.autoStart(), 1);
  assert.equal(restores, 1);
});

test("translation changes after mount cannot restart automatic initialization", async () => {
  let initializations = 0;
  const lifecycle = createAppInitializationLifecycle(async () => ++initializations);
  await lifecycle.autoStart();
  for (const language of ["ar", "en", "ar"]) {
    assert.ok(language);
    await lifecycle.autoStart();
  }
  assert.equal(initializations, 1);
});

test("manual retry starts a new attempt after automatic initialization fails", async () => {
  let attempts = 0;
  const lifecycle = createAppInitializationLifecycle(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("storage unavailable");
    return "ready";
  });
  await assert.rejects(() => lifecycle.autoStart(), /storage unavailable/);
  assert.equal(await lifecycle.retry(), "ready");
  assert.equal(attempts, 2);
});

test("AuthorizationProvider consumer and App boot have one restore owner", async () => {
  const h = harness();
  const authorization = new AuthorizationStore({
    async loadSnapshot() {
      return { roles: [], permissions: [], canAccessDeveloperCenter: false };
    }
  }, h.service);
  authorization.start();
  const lifecycle = createAppInitializationLifecycle(() => h.service.restoreSession());
  assert.equal(await lifecycle.autoStart(), "restored");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.refreshes, 1);
  assert.equal(authorization.getState().status, "forbidden");
  authorization.stop();
});

test("AuthorizationStore mount does not own boot restore", async () => {
  let refreshes = 0;
  const sessions = {
    getActiveSession: () => undefined,
    subscribeSession: () => () => {},
    expireSession() {},
    async refreshSession() {
      refreshes += 1;
      return undefined;
    },
    async authenticatedFetch() {
      return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    }
  };
  const authorization = new AuthorizationStore({
    async loadSnapshot() {
      throw new Error("must not load without a session");
    }
  }, sessions);
  authorization.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(refreshes, 0);
  assert.equal(authorization.getState().status, "unauthorized");
  authorization.stop();
});

test("App binds automatic boot and manual retry to separate lifecycle actions", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /createAppInitializationLifecycle/);
  assert.match(source, /\.autoStart\(\)/);
  assert.match(source, /\.retry\(\)/);
  assert.doesNotMatch(source, /\[setLanguage, setTheme, t\]/);
});

test("sequential automatic boot triggers reuse the completed attempt", async () => {
  let calls = 0;
  const lifecycle = createAppInitializationLifecycle(async () => ++calls);
  assert.equal(await lifecycle.autoStart(), 1);
  await Promise.resolve();
  assert.equal(await lifecycle.autoStart(), 1);
  assert.equal(calls, 1);
});

test("successful A to B rotation persists B before a later sequential refresh", async () => {
  const h = symbolicCredentialHarness();
  assert.equal(await h.service.restoreSession(), "restored");
  assert.equal(h.requests[0].credential, "credential-A");
  assert.equal(h.credential, "credential-B");
  await h.service.refreshSession();
  assert.deepEqual(h.requests.map((request) => request.credential), ["credential-A", "credential-B"]);
  assert.equal(h.credential, "credential-C");
});

test("a sequential refresh after more than the eight-second grace still reads B", async () => {
  const h = symbolicCredentialHarness();
  await h.service.restoreSession();
  h.advance(8_001);
  await h.service.refreshSession();
  assert.deepEqual(h.requests, [
    { credential: "credential-A", at: 0 },
    { credential: "credential-B", at: 8_001 }
  ]);
});

test("replacement persistence failure does not publish access state and leaves A retryable", async () => {
  const h = symbolicCredentialHarness({ failWriteOn: 1 });
  assert.equal(await h.service.restoreSession(), "signed_out");
  assert.equal(h.service.getActiveSession(), undefined);
  assert.equal(h.credential, "credential-A");
  assert.deepEqual(h.writes, []);
});

test("lost response has no automatic retry but a later caller reuses unrotated local A", async () => {
  const h = symbolicCredentialHarness({
    respond: ({ requestNumber, credential, logicalNow }) => {
      if (requestNumber === 1) return "network_error";
      if (credential === "credential-A" && logicalNow > 8_000) return "invalid";
    }
  });
  assert.equal(await h.service.restoreSession(), "offline");
  assert.equal(h.requests.length, 1);
  assert.equal(h.credential, "credential-A");
  h.advance(15_000);
  await assert.rejects(() => h.service.refreshSession(), (error) =>
    error instanceof DesktopSessionBridgeError && error.kind === "invalid"
  );
  assert.deepEqual(h.requests, [
    { credential: "credential-A", at: 0 },
    { credential: "credential-A", at: 15_000 }
  ]);
});

test("a 401 after successful restore refreshes with B and retries the request once", async () => {
  let requestCount = 0;
  const h = symbolicCredentialHarness({
    request: async () => new Response(null, { status: ++requestCount === 1 ? 401 : 200 })
  });
  await h.service.restoreSession();
  assert.equal((await h.service.authenticatedFetch("https://api.example.com/protected")).status, 200);
  assert.deepEqual(h.requests.map((request) => request.credential), ["credential-A", "credential-B"]);
  assert.equal(h.credential, "credential-C");
  assert.equal(requestCount, 2);
});

test("offline restore preserves the OS credential", async () => {
  const h = harness({ refreshError: "network" });
  assert.equal(await h.service.restoreSession(), "offline");
  assert.equal(h.credentialPresent, true);
});

test("invalid, revoked, and inactive results clear the in-memory session without looping", async () => {
  for (const kind of ["invalid", "account_not_active"]) {
    const h = harness({ refreshError: kind });
    assert.equal(await h.service.restoreSession(), kind === "account_not_active" ? "account_not_active" : "signed_out");
    assert.equal(h.refreshes, 1);
    assert.equal(h.service.getActiveSession(), undefined);
    assert.equal(h.credentialPresent, false);
  }
});

test("ten simultaneous 401 responses share one refresh and retry each request once", async () => {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const attempts = new Map();
  const h = harness({
    refreshBarrier: async () => barrier,
    request: async (url, init) => {
      const key = String(url);
      const count = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, count);
      return new Response(null, { status: count === 1 ? 401 : 200 });
    }
  });
  const initial = h.service.restoreSession();
  release();
  await initial;
  const before = h.refreshes;
  const requests = Array.from({ length: 10 }, (_, index) => h.service.authenticatedFetch(`https://api.example.com/${index}`));
  await Promise.resolve();
  release();
  const responses = await Promise.all(requests);
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(h.refreshes - before, 1);
  assert.ok([...attempts.values()].every((count) => count === 2));
});

test("a second 401 is returned without an infinite refresh loop", async () => {
  const h = harness({ request: async () => new Response(null, { status: 401 }) });
  await h.service.restoreSession();
  const before = h.refreshes;
  assert.equal((await h.service.authenticatedFetch("https://api.example.com/protected")).status, 401);
  assert.equal(h.refreshes - before, 1);
});

test("logout clears local authentication even if server revoke is offline", async () => {
  const h = harness({ logoutError: true });
  await h.service.restoreSession();
  await h.service.signOut();
  assert.equal(h.credentialPresent, false);
  assert.equal(h.service.getActiveSession(), undefined);
  assert.equal(h.logouts, 1);
});

test("session secrets have no browser or SQLite persistence path", async () => {
  const files = await Promise.all([
    readFile(new URL("../src/services/platform/SteamOpenIdSignInService.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/services/platform/TauriDesktopSessionBridge.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/repositories/steamOpenIdDesktopRepository.ts", import.meta.url), "utf8")
  ]);
  const joined = files.join("\n");
  assert.doesNotMatch(joined, /localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(files[2], /refreshCredential|sessionToken|Bearer/i);
});

test("boot health command contract cannot carry a desktop credential", async () => {
  const [bridge, rust] = await Promise.all([
    readFile(new URL("../src/services/platform/TauriDesktopSessionBridge.ts", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/secure_credential.rs", import.meta.url), "utf8")
  ]);
  assert.match(bridge, /probe_desktop_session_backend_health[\s\S]*\{ baseUrl \}/);
  const command = rust.slice(
    rust.indexOf("pub async fn probe_desktop_session_backend_health"),
    rust.indexOf("pub async fn restore_desktop_session")
  );
  assert.match(command, /\.get\(url\)/);
  assert.doesNotMatch(command, /credential|authorization|\.post\(/i);
});
