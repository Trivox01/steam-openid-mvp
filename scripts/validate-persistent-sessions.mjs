import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DesktopSessionBridgeError
} from "../src/services/platform/TauriDesktopSessionBridge.ts";
import { SteamOpenIdSignInService } from "../src/services/platform/SteamOpenIdSignInService.ts";

const future = () => new Date(Date.now() + 15 * 60_000).toISOString();

function harness(options = {}) {
  let credentialPresent = options.credentialPresent ?? true;
  let refreshes = 0;
  let logouts = 0;
  const bridge = {
    async store() { credentialPresent = true; },
    async refresh() {
      refreshes += 1;
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
    { async open() {} }, bridge, "https://api.example.com", undefined,
    options.request ?? (async () => new Response(null, { status: 200 }))
  );
  return { service, state, get refreshes() { return refreshes; }, get credentialPresent() { return credentialPresent; }, get logouts() { return logouts; } };
}

test("boot restore returns authenticated state, while no credential is ordinary sign-out", async () => {
  const restored = harness();
  assert.equal(await restored.service.restoreSession(), "restored");
  assert.ok(restored.service.getActiveSession());
  const absent = harness({ credentialPresent: false });
  assert.equal(await absent.service.restoreSession(), "signed_out");
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
