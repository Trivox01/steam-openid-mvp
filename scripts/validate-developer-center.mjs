import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AuthorizationClient,
  AuthorizationClientError
} from "../src/features/developer-center/AuthorizationClient.ts";
import { AuthorizationStore } from "../src/features/developer-center/AuthorizationStore.ts";
import { BadgeAdminClient, BadgeAdminError } from "../src/features/developer-center/badges/BadgeAdminClient.ts";
import {
  BadgeAssignmentClient,
  BadgeAssignmentClientError
} from "../src/features/developer-center/assignments/BadgeAssignmentClient.ts";
import {
  validateBadgeDraft,
  validateBadgeIconFile
} from "../src/features/developer-center/badges/badgeEditorValidation.ts";
import {
  UserAdminClient,
  UserAdminClientError
} from "../src/features/developer-center/users/UserAdminClient.ts";

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

test("User client keeps SteamID64 out of list assumptions and expires rejected sessions", async () => {
  const originalFetch = globalThis.fetch;
  const sessions = new FakeSessionSource(SESSION);
  try {
    let requested = "";
    globalThis.fetch = async (url, init) => {
      requested = String(url);
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SESSION.token}`);
      return Response.json({ items: [], total: 0, page: 1, pageSize: 20 });
    };
    const client = new UserAdminClient("https://auth.example.test", sessions);
    const result = await client.list(new URLSearchParams({ page: "1" }));
    assert.equal(result.total, 0);
    assert.match(requested, /\/api\/admin\/users\?/);
    globalThis.fetch = async () => Response.json(
      { error: "AUTHENTICATION_REQUIRED" }, { status: 401 }
    );
    await assert.rejects(
      client.get("00000000-0000-4000-8000-000000000001"),
      (error) => error instanceof UserAdminClientError && error.status === 401
    );
    assert.equal(sessions.expired, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("User status client sends a bounded PATCH and preserves failures", async () => {
  const originalFetch = globalThis.fetch;
  const sessions = new FakeSessionSource(SESSION);
  let body;
  try {
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /\/api\/admin\/users\/.+\/status$/);
      assert.equal(init?.method, "PATCH");
      body = JSON.parse(String(init?.body));
      return Response.json({
        id: "00000000-0000-4000-8000-000000000001",
        status: "suspended",
        badges: [],
        roles: []
      });
    };
    const client = new UserAdminClient("https://auth.example.test", sessions);
    const changed = await client.changeStatus(
      "00000000-0000-4000-8000-000000000001",
      "suspended",
      "Review"
    );
    assert.equal(changed.status, "suspended");
    assert.deepEqual(body, { status: "suspended", reason: "Review" });
    globalThis.fetch = async () => Response.json(
      { error: "USER_STATUS_UNCHANGED" }, { status: 409 }
    );
    await assert.rejects(
      client.changeStatus(
        "00000000-0000-4000-8000-000000000001",
        "suspended"
      ),
      (error) => error instanceof UserAdminClientError &&
        error.code === "USER_STATUS_UNCHANGED" &&
        error.status === 409
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("User details cache is short-lived and explicitly invalidated", async () => {
  const originalFetch = globalThis.fetch;
  const sessions = new FakeSessionSource(SESSION);
  const id = "00000000-0000-4000-8000-000000000001";
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({
        id,
        steamId64: "76561198000000001",
        createdAt: "2026-07-30T00:00:00.000Z",
        lastLoginAt: "2026-07-30T00:00:00.000Z",
        status: "active",
        badgeCount: 1,
        roleCount: 1,
        roles: [],
        badges: []
      });
    };
    const client = new UserAdminClient("https://auth.example.test", sessions);
    assert.equal(client.getCached(id), undefined);
    const loaded = await client.get(id);
    assert.equal(calls, 1);
    assert.equal(client.getCached(id), loaded);
    client.invalidate(id);
    assert.equal(client.getCached(id), undefined);
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

test("Badge assignment client preserves domain errors and prevents stale sessions", async () => {
  const originalFetch = globalThis.fetch;
  const sessions = new FakeSessionSource(SESSION);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ error: "BADGE_ALREADY_ASSIGNED" }, { status: 409 });
  };
  try {
    await assert.rejects(
      new BadgeAssignmentClient("https://auth.example.test", sessions).assign({
        userId: "00000000-0000-4000-8000-000000000001",
        badgeDefinitionId: "00000000-0000-4000-8000-000000000002"
      }),
      (error) => error instanceof BadgeAssignmentClientError &&
        error.status === 409 && error.code === "BADGE_ALREADY_ASSIGNED"
    );
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json(
      { error: "AUTHENTICATION_REQUIRED" }, { status: 401 }
    );
    await assert.rejects(
      new BadgeAssignmentClient("https://auth.example.test", sessions)
        .list(new URLSearchParams()),
      (error) => error instanceof BadgeAssignmentClientError && error.status === 401
    );
    assert.equal(sessions.expired, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Badge editor validation mirrors required Backend constraints", () => {
  const base = {
    displayName: "Founder", slug: "founder", description: "",
    category: "special", rarity: "exclusive", priority: 0,
    isActive: true, isVisible: true, grantMode: "manual"
  };
  assert.deepEqual(validateBadgeDraft(base), {});
  assert.equal(validateBadgeDraft({ ...base, displayName: "" }).displayName, "REQUIRED_NAME");
  assert.equal(validateBadgeDraft({ ...base, slug: "Invalid Slug" }).slug, "INVALID_BADGE_SLUG");
  assert.equal(validateBadgeDraft({ ...base, priority: -1 }).priority, "INVALID_PRIORITY");
  assert.equal(validateBadgeDraft({
    ...base,
    startsAt: "2026-08-02T12:00",
    endsAt: "2026-08-01T12:00"
  }).endsAt, "INVALID_BADGE_DATES");
});

test("Badge icon selection rejects unsupported and oversized files", () => {
  assert.equal(validateBadgeIconFile(
    new File([new Uint8Array(128)], "badge.png", { type: "image/png" })
  ), "");
  assert.equal(validateBadgeIconFile(
    new File([new Uint8Array(128)], "badge.svg", { type: "image/svg+xml" })
  ), "INVALID_ASSET_FORMAT");
  assert.equal(validateBadgeIconFile(
    new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.webp", {
      type: "image/webp"
    })
  ), "INVALID_ASSET_SIZE");
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
  const [sidebar, route, page, app, assignments, badges, users, css, en, ar] = await Promise.all([
    readFile(new URL("../src/components/layout/Sidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/developer-center/DeveloperCenterRoute.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/DeveloperCenterPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/developer-center/assignments/BadgeAssignmentsPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/developer-center/badges/BadgeManagementPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/developer-center/users/UserManagementPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/index.css", import.meta.url), "utf8"),
    readFile(new URL("../src/locales/en/developerCenter.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/locales/ar/developerCenter.ts", import.meta.url), "utf8")
  ]);
  assert.match(sidebar, /canAccessDeveloperCenter\s*\?\s*item\("developer"/);
  assert.match(route, /state\.status === "forbidden"/);
  assert.match(route, /state\.status === "unauthorized"/);
  assert.match(route, /state\.status === "error"/);
  assert.match(page, /disabled=\{disabled\}/);
  assert.match(page, /snapshot\.permissions\.length/);
  assert.doesNotMatch(page, /sessionToken|steamId|databaseId|pollSecret/);
  assert.match(app, /#\/developer/);
  assert.match(page, /badges\.view_assignments/);
  assert.match(page, /users\.view/);
  assert.match(page, /UserManagementPanel/);
  assert.match(assignments, /badges\.assign/);
  assert.match(assignments, /badges\.revoke/);
  assert.match(assignments, /BADGE_ALREADY_ASSIGNED/);
  assert.match(assignments, /AbortController/);
  assert.match(assignments, /aria-modal="true"/);
  assert.match(assignments, /event\.key === "Escape"/);
  assert.doesNotMatch(assignments, /steamId64|optimistic/i);
  assert.match(badges, /aria-describedby/);
  assert.match(badges, /aria-invalid/);
  assert.match(badges, /aria-modal="true"/);
  assert.match(badges, /event\.key === "Escape"/);
  assert.match(badges, /event\.key !== "Tab"/);
  assert.match(badges, /dataTransfer\.files/);
  assert.match(badges, /disabled=\{saveDisabled\}/);
  assert.match(badges, /if \(!client \|\| saving\) return/);
  assert.match(users, /AbortController/);
  assert.match(users, /aria-modal="true"/);
  assert.match(users, /event\.key === "Escape"/);
  assert.match(users, /steamId64/);
  assert.doesNotMatch(users.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "", /steamId64/i);
  assert.match(page, /users\.change_status/);
  assert.match(users, /client\.changeStatus/);
  assert.match(users, /status === user\.status/);
  assert.match(users, /state === "saving"/);
  assert.match(users, /role="alert"/);
  assert.match(users, /trapFocus/);
  assert.match(users, /getCached\(id\)/);
  assert.match(users, /Promise\.allSettled/);
  assert.match(users, /aria-busy=\{refreshing\}/);
  assert.match(users, /loading="lazy"/);
  assert.match(users, /UserDetailsSkeleton/);
  assert.match(users, /client\.invalidate\(selectedId\)/);
  assert.match(assignments, /publishAdminUserChange/);
  assert.match(css, /\.badge-editor \.badge-control input:focus-visible/);
  assert.match(css, /@media \(max-width:580px\)/);
  assert.match(css, /html\[dir="rtl"\] \.badge-toggle/);
  for (const translations of [en, ar]) {
    assert.match(translations, /developer\.badges\.helpName/);
    assert.match(translations, /developer\.badges\.uploadRequirements/);
    assert.match(translations, /developer\.badges\.error\.INVALID_BADGE_DATES/);
    assert.match(translations, /developer\.users\.details/);
    assert.match(translations, /developer\.users\.changeStatus/);
    assert.match(translations, /developer\.users\.refreshAll/);
  }
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
