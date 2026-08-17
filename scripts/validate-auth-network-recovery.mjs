import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { installAuthNetworkRecovery } from "../src/services/AuthNetworkRecoveryCoordinator.ts";
import {
  DesktopSessionBridgeError
} from "../src/services/platform/TauriDesktopSessionBridge.ts";
import { SteamOpenIdSignInService } from "../src/services/platform/SteamOpenIdSignInService.ts";

const future = () => new Date(Date.now() + 15 * 60_000).toISOString();

class FakeNetworkEvents {
  listeners = new Map([
    ["online", new Set()],
    ["offline", new Set()]
  ]);

  addEventListener(type, listener) { this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type).delete(listener); }
  dispatch(type) {
    for (const listener of [...this.listeners.get(type)]) listener();
  }
  count(type) { return this.listeners.get(type).size; }
}

function createHarness(options = {}) {
  let credentialPresent = options.credentialPresent ?? true;
  let logicalNow = 0;
  let refreshes = 0;
  let healthChecks = 0;
  let logouts = 0;
  let browserOpens = 0;
  const timeline = [];
  const healthResults = [...(options.healthResults ?? [true])];
  const state = {
    deviceId: "0b55ec79-6c08-4f74-bd90-17e13a562aa9",
    identity: { steamId: "saved-identity", authenticatedAt: future(), authMethod: "steam_openid" }
  };
  const bridge = {
    async store() { credentialPresent = true; },
    async hasCredential() { return credentialPresent; },
    async health() {
      healthChecks += 1;
      timeline.push("health");
      await options.healthBarrier?.();
      const result = healthResults.length > 1 ? healthResults.shift() : healthResults[0];
      if (result instanceof Error) throw result;
      return result ?? false;
    },
    async refresh() {
      refreshes += 1;
      timeline.push("refresh");
      await options.refreshBarrier?.();
      if (!credentialPresent) throw new DesktopSessionBridgeError("none");
      if (options.refreshError) throw new DesktopSessionBridgeError(options.refreshError);
      return { token: `access-${refreshes}`, expiresAt: future() };
    },
    async logout() {
      logouts += 1;
      credentialPresent = false;
    }
  };
  const service = new SteamOpenIdSignInService(
    { async start() { throw new Error("not used"); }, async status() { throw new Error("not used"); } },
    {
      async getState() { return state; },
      async saveIdentity(identity) { state.identity = identity; },
      async clearAuthenticatedSteamIdentity() { delete state.identity; }
    },
    { async open() { browserOpens += 1; } },
    bridge,
    "https://api.example.com",
    async (milliseconds) => { logicalNow += milliseconds; },
    async () => new Response(null, { status: 200 }),
    {
      budgetMs: options.healthBudgetMs ?? 3_000,
      backoffMs: options.healthBackoffMs ?? [500, 1_000],
      now: () => logicalNow
    }
  );
  return {
    service,
    state,
    timeline,
    healthResults,
    get credentialPresent() { return credentialPresent; },
    get refreshes() { return refreshes; },
    get healthChecks() { return healthChecks; },
    get logouts() { return logouts; },
    get browserOpens() { return browserOpens; }
  };
}

const settle = async () => {
  for (let count = 0; count < 5; count += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

test("offline to online wakes the backend before exactly one refresh", async () => {
  const h = createHarness({ healthResults: [false, false, true] });
  h.service.expireSession();
  assert.equal(h.service.getAuthenticationState(), "recoverable");
  assert.equal(h.refreshes, 0);

  const events = new FakeNetworkEvents();
  const dispose = installAuthNetworkRecovery(h.service, events, () => false);
  events.dispatch("online");
  await settle();

  assert.deepEqual(h.timeline.slice(-4), ["health", "health", "health", "refresh"]);
  assert.equal(h.refreshes, 1);
  assert.equal(h.service.getAuthenticationState(), "authenticated");
  assert.equal(h.browserOpens, 0);
  assert.equal(h.logouts, 0);
  dispose();
  assert.equal(events.count("online"), 0);
  assert.equal(events.count("offline"), 0);
});

test("a recoverable auth transition arms recovery when WebView initially reports online", async () => {
  const h = createHarness();
  const events = new FakeNetworkEvents();
  const dispose = installAuthNetworkRecovery(h.service, events, () => true);

  h.service.expireSession();
  events.dispatch("online");
  await settle();

  assert.equal(h.healthChecks, 1);
  assert.equal(h.refreshes, 1);
  assert.equal(h.service.getAuthenticationState(), "authenticated");

  dispose();
  h.service.expireSession();
  events.dispatch("offline");
  events.dispatch("online");
  await settle();
  assert.equal(h.refreshes, 1);
});

test("duplicate online events and concurrent recovery callers share one flight", async () => {
  let releaseHealth;
  const healthBarrier = new Promise((resolve) => { releaseHealth = resolve; });
  const h = createHarness({ healthBarrier: () => healthBarrier });
  h.service.expireSession();
  const events = new FakeNetworkEvents();
  installAuthNetworkRecovery(h.service, events, () => false);

  events.dispatch("online");
  events.dispatch("online");
  const callerA = h.service.recoverSessionAfterNetwork();
  const callerB = h.service.recoverSessionAfterNetwork();
  releaseHealth();
  assert.equal(await callerA, "restored");
  assert.equal(await callerB, "restored");
  await settle();

  assert.equal(h.healthChecks, 1);
  assert.equal(h.refreshes, 1);
});

test("already authenticated sessions ignore network recovery", async () => {
  const h = createHarness();
  assert.equal(await h.service.restoreSession(), "restored");
  const events = new FakeNetworkEvents();
  installAuthNetworkRecovery(h.service, events, () => true);
  events.dispatch("offline");
  events.dispatch("online");
  await settle();
  assert.equal(h.healthChecks, 1);
  assert.equal(h.refreshes, 1);
});

test("explicit logout and absent credentials block recovery", async () => {
  const h = createHarness();
  assert.equal(await h.service.restoreSession(), "restored");
  await h.service.signOut("user_logout");
  const events = new FakeNetworkEvents();
  installAuthNetworkRecovery(h.service, events, () => false);
  events.dispatch("online");
  await settle();
  assert.equal(h.credentialPresent, false);
  assert.equal(h.refreshes, 1);
  assert.equal(h.logouts, 1);
  assert.equal(h.service.getAuthenticationState(), "authentication_required");

  const absent = createHarness({ credentialPresent: false });
  absent.service.expireSession();
  assert.equal(await absent.service.recoverSessionAfterNetwork(), "signed_out");
  assert.equal(absent.healthChecks, 0);
  assert.equal(absent.refreshes, 0);
});

test("backend outage remains recoverable without credential deletion or browser fallback", async () => {
  const h = createHarness({ healthResults: [false], healthBudgetMs: 1, healthBackoffMs: [1] });
  h.service.expireSession();
  assert.equal(await h.service.recoverSessionAfterNetwork(), "offline");
  assert.equal(h.service.getAuthenticationState(), "recoverable");
  assert.equal(h.credentialPresent, true);
  assert.equal(h.refreshes, 0);
  assert.equal(h.browserOpens, 0);
  assert.equal(h.logouts, 0);
});

test("network recovery is isolated from app initialization and translations are complete", async () => {
  const [coordinator, app, english, arabic, service] = await Promise.all([
    readFile(new URL("../src/services/AuthNetworkRecoveryCoordinator.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/locales/en/steam.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/locales/ar/steam.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/services/platform/SteamOpenIdSignInService.ts", import.meta.url), "utf8")
  ]);
  assert.match(app, /installAuthNetworkRecovery\(service\)/);
  assert.doesNotMatch(coordinator, /initializeApplication|autoStart|language|locale/);
  assert.match(english, /"steam\.openId\.offline"/);
  assert.match(english, /"steam\.openId\.offlineDescription"/);
  assert.match(arabic, /"steam\.openId\.offline"/);
  assert.match(arabic, /"steam\.openId\.offlineDescription"/);
  assert.match(service, /trigger === "boot_restore"[\s\S]*trigger === "access_token_expired"[\s\S]*trigger === "network_recovered"/);
});
