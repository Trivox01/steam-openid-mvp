import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AuthorizationClient,
  AuthorizationClientError
} from "../src/features/developer-center/AuthorizationClient.ts";
import { AuthorizationStore } from "../src/features/developer-center/AuthorizationStore.ts";
import { BadgeAdminClient, BadgeAdminError } from "../src/features/developer-center/badges/BadgeAdminClient.ts";

const SESSION = {
  token: "memory-only-session",
  expiresAt: new Date(Date.now() + 60_000).toISOString()
};
const OWNER_SNAPSHOT = {
  roles: [{ slug: "custom-operator", displayName: "Operator", priority: 100 }],
  permissions: ["admin.access"],
  canAccessDeveloperCenter: true
};

test("Authorization client validates successful snapshots and sends Bearer session", async () => {
  const originalFetch = globalThis.fetch;
  let authorizationHeader;
  globalThis.fetch = async (_url, init) => {
    authorizationHeader = new Headers(init?.headers).get("authorization");
    return Response.json(OWNER_SNAPSHOT);
  };
  try {
    const snapshot = await new AuthorizationClient("https://auth.example.test")
      .loadSnapshot(SESSION.token);
    assert.deepEqual(snapshot, OWNER_SNAPSHOT);
    assert.equal(authorizationHeader, `Bearer ${SESSION.token}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Authorization client distinguishes 401, 403, malformed, and network failures", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [status, kind] of [[401, "unauthorized"], [403, "forbidden"]]) {
      globalThis.fetch = async () => Response.json({ error: kind }, { status });
      await assert.rejects(
        new AuthorizationClient("https://auth.example.test").loadSnapshot(SESSION.token),
        (error) => error instanceof AuthorizationClientError && error.kind === kind
      );
    }
    globalThis.fetch = async () => Response.json({ roles: "invalid" });
    await assert.rejects(
      new AuthorizationClient("https://auth.example.test").loadSnapshot(SESSION.token),
      (error) => error instanceof AuthorizationClientError && error.kind === "malformed"
    );
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    await assert.rejects(
      new AuthorizationClient("https://auth.example.test").loadSnapshot(SESSION.token),
      (error) => error instanceof AuthorizationClientError && error.kind === "network"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Badge admin client expires the session on 401 and preserves HTTP errors", async () => {
  const originalFetch = globalThis.fetch;
  const sessions = new FakeSessionSource(SESSION);
  globalThis.fetch = async () => Response.json(
    { error: "AUTHENTICATION_REQUIRED" },
    { status: 401 }
  );
  try {
    await assert.rejects(
      new BadgeAdminClient("https://auth.example.test", sessions)
        .list(new URLSearchParams()),
      (error) => error instanceof BadgeAdminError &&
        error.status === 401 &&
        error.message === "AUTHENTICATION_REQUIRED"
    );
    assert.equal(sessions.expired, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Authorization store is fail-closed and does not rely on role slug", async () => {
  const sessions = new FakeSessionSource();
  const api = {
    async loadSnapshot() {
      return {
        roles: [{ slug: "developer", displayName: "Developer", priority: 60 }],
        permissions: [],
        canAccessDeveloperCenter: false
      };
    }
  };
  const store = new AuthorizationStore(api, sessions);
  store.start();
  await settle();
  assert.equal(store.getState().status, "unauthorized");
  sessions.emit(SESSION);
  await settle();
  assert.equal(store.getState().status, "forbidden");
  store.stop();
});

test("explicit admin access opens the store even without a privileged role name", async () => {
  const sessions = new FakeSessionSource(SESSION);
  const store = new AuthorizationStore({
    async loadSnapshot() {
      return OWNER_SNAPSHOT;
    }
  }, sessions);
  store.start();
  await settle();
  assert.equal(store.getState().status, "authenticated");
  assert.equal(store.getState().snapshot.canAccessDeveloperCenter, true);
  sessions.emit(undefined);
  await settle();
  assert.equal(store.getState().status, "unauthorized");
  store.stop();
});

test("401 expires the memory session and network failure remains closed", async () => {
  const sessions = new FakeSessionSource(SESSION);
  const unauthorizedStore = new AuthorizationStore({
    async loadSnapshot() {
      throw new AuthorizationClientError("unauthorized");
    }
  }, sessions);
  unauthorizedStore.start();
  await settle();
  assert.equal(sessions.expired, true);
  assert.equal(unauthorizedStore.getState().status, "unauthorized");
  unauthorizedStore.stop();

  const networkStore = new AuthorizationStore({
    async loadSnapshot() {
      throw new AuthorizationClientError("network");
    }
  }, new FakeSessionSource(SESSION));
  networkStore.start();
  await settle();
  assert.deepEqual(networkStore.getState(), { status: "error", error: "network" });
  networkStore.stop();
});

test("session expiration clears the authorization snapshot", async () => {
  const sessions = new FakeSessionSource(SESSION);
  let expire;
  const store = new AuthorizationStore({
    async loadSnapshot() {
      return OWNER_SNAPSHOT;
    }
  }, sessions, (callback) => {
    expire = callback;
    return () => {};
  });
  store.start();
  await settle();
  assert.equal(store.getState().status, "authenticated");
  expire();
  await settle();
  assert.equal(sessions.expired, true);
  assert.equal(store.getState().status, "unauthorized");
  store.stop();
});

test("account switching ignores the previous account request", async () => {
  const sessions = new FakeSessionSource(SESSION);
  const resolvers = [];
  const store = new AuthorizationStore({
    loadSnapshot() {
      return new Promise((resolve) => resolvers.push(resolve));
    }
  }, sessions);
  store.start();
  await settle();
  sessions.emit({ token: "second-session", expiresAt: SESSION.expiresAt });
  await settle();
  resolvers[0]({
    roles: [],
    permissions: ["admin.access"],
    canAccessDeveloperCenter: true
  });
  await settle();
  assert.equal(store.getState().status, "loading");
  resolvers[1]({
    roles: [],
    permissions: [],
    canAccessDeveloperCenter: false
  });
  await settle();
  assert.equal(store.getState().status, "forbidden");
  store.stop();
});

test("Sidebar, route guard, and Overview enforce the Developer Center contract", async () => {
  const [sidebar, route, page, app] = await Promise.all([
    readFile(new URL("../src/components/layout/Sidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/developer-center/DeveloperCenterRoute.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/DeveloperCenterPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8")
  ]);
  assert.match(sidebar, /canAccessDeveloperCenter\s*\?\s*item\("developer"/);
  assert.match(route, /state\.status === "forbidden"/);
  assert.match(route, /state\.status === "unauthorized"/);
  assert.match(route, /state\.status === "error"/);
  assert.match(page, /disabled=\{disabled\}/);
  assert.match(page, /snapshot\.permissions\.length/);
  assert.doesNotMatch(page, /sessionToken|steamId|databaseId|pollSecret/);
  assert.match(app, /#\/developer/);
});

class FakeSessionSource {
  listeners = new Set();
  expired = false;

  constructor(session) {
    this.session = session;
  }

  getActiveSession() {
    return this.session;
  }

  subscribeSession(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  expireSession() {
    this.expired = true;
    this.emit(undefined);
  }

  emit(session) {
    this.session = session;
    for (const listener of this.listeners) listener(session);
  }
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
