import test from "node:test";
import assert from "node:assert/strict";
import { SmartSyncCoordinator, SMART_SYNC_POLICY } from "../src/services/SmartSyncCoordinator.ts";

const game = (id) => ({ id, appId: id.split(":").at(-1), platform: "steam", name: id, coverUrl: "", backgroundUrl: "", playtimeHours: 0, totalAchievements: 0, unlockedAchievements: 0, completionPercentage: 0, lastPlayedAt: "" });

function harness() {
  let session;
  const listeners = new Set();
  const sessions = {
    getActiveSession: () => session,
    getSavedIdentity: async () => session ? { steamId: session.account ?? "76561198000000000" } : undefined,
    subscribeSession(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(value) { session = value; for (const listener of listeners) listener(value); }
  };
  let libraryCalls = 0;
  let achievementCalls = 0;
  let active = 0;
  let maximumActive = 0;
  let releaseLibrary;
  const library = {
    getLastSync: async () => undefined,
    sync: (signal) => {
      libraryCalls += 1; active += 1; maximumActive = Math.max(maximumActive, active);
      return new Promise((resolve, reject) => {
        releaseLibrary = () => { active -= 1; resolve({ syncedAt: new Date().toISOString() }); };
        signal?.addEventListener("abort", () => { active -= 1; reject(new DOMException("cancelled", "AbortError")); }, { once: true });
      });
    }
  };
  const achievements = {
    syncGame: async (id, signal) => {
      achievementCalls += 1; active += 1; maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5);
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("cancelled", "AbortError")); }, { once: true });
      });
      active -= 1;
      return { games: [{ gameId: id, status: "success" }] };
    }
  };
  const games = { getGameById: async (id) => game(id) };
  const coordinator = new SmartSyncCoordinator(sessions, library, achievements, games);
  return { coordinator, sessions, get libraryCalls() { return libraryCalls; }, get achievementCalls() { return achievementCalls; }, get maximumActive() { return maximumActive; }, releaseLibrary: () => releaseLibrary?.() };
}

test("no session performs no network work", async () => {
  const h = harness();
  assert.equal(await h.coordinator.syncLibrary("startup"), "skipped");
  assert.equal(h.libraryCalls, 0);
});

test("concurrent callers join one library task", async () => {
  const h = harness(); h.sessions.set({ token: "test-session", expiresAt: "2099-01-01T00:00:00Z" });
  const first = h.coordinator.syncLibrary("startup");
  const second = h.coordinator.syncLibrary("manual");
  assert.equal(first, second);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.libraryCalls, 1);
  h.releaseLibrary(); await first; await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.coordinator.taskCount, 0);
});

test("per-game tasks deduplicate and global concurrency never exceeds three", async () => {
  const h = harness(); h.sessions.set({ token: "test-session", expiresAt: "2099-01-01T00:00:00Z" });
  const a = h.coordinator.syncGame("steam:2807960", "page-open", true);
  const duplicate = h.coordinator.syncGame("steam:2807960", "manual", true);
  const rest = ["steam:2920270", "steam:10", "steam:20"].map((id) => h.coordinator.syncGame(id, "manual", true));
  assert.equal(a, duplicate);
  await Promise.all([a, ...rest]);
  assert.equal(h.achievementCalls, 4);
  assert.ok(h.maximumActive <= SMART_SYNC_POLICY.concurrency);
});

test("session change cancels work and clears the task registry", async () => {
  const h = harness(); h.coordinator.start(); h.sessions.set({ token: "old-session", expiresAt: "2099-01-01T00:00:00Z" });
  const pending = h.coordinator.syncLibrary("manual", true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.sessions.set(undefined);
  await assert.rejects(pending, /cancelled|session/i);
  assert.equal(h.coordinator.taskCount, 0);
});

test("documents bounded policy values", () => {
  assert.deepEqual(SMART_SYNC_POLICY, {
    libraryCooldownMs: 720000, gameCooldownMs: 240000, reconnectDebounceMs: 1500,
    concurrency: 3, initialBackoffMs: 15000, maximumBackoffMs: 300000
  });
});

test("fresh metadata enforces cooldown and failures enforce backoff", async () => {
  const sessions = { getActiveSession: () => ({ token: "session", expiresAt: "2099-01-01T00:00:00Z" }), subscribeSession: () => () => {} };
  let calls = 0;
  const freshLibrary = { getLastSync: async () => ({ lastSyncedAt: new Date().toISOString() }), sync: async () => { calls += 1; } };
  const empty = { syncGame: async () => ({ games: [] }) };
  const games = { getGameById: async () => undefined };
  const cool = new SmartSyncCoordinator(sessions, freshLibrary, empty, games);
  assert.equal(await cool.syncLibrary("startup"), "cooldown");
  assert.equal(calls, 0);

  const failing = { getLastSync: async () => undefined, sync: async () => { calls += 1; throw new Error("network"); } };
  const backedOff = new SmartSyncCoordinator(sessions, failing, empty, games, () => 1_000);
  await assert.rejects(backedOff.syncLibrary("startup"), /network/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await backedOff.syncLibrary("startup"), "backoff");
  assert.equal(calls, 1);
});

test("account switch cancels old scope and clears the single-account cache", async () => {
  let session;
  let identity = { steamId: "76561198000000001" };
  const listeners = new Set();
  const sessions = {
    getActiveSession: () => session,
    getSavedIdentity: async () => identity,
    subscribeSession(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(value) { session = value; for (const listener of listeners) listener(value); }
  };
  let clears = 0;
  const coordinator = new SmartSyncCoordinator(
    sessions,
    { getLastSync: async () => ({ lastSyncedAt: new Date().toISOString() }), sync: async () => ({}) },
    { syncGame: async () => ({ games: [] }) },
    { getGameById: async () => undefined },
    Date.now,
    async () => { clears += 1; }
  );
  coordinator.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  sessions.emit({ token: "old", expiresAt: "2099-01-01T00:00:00Z" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  identity = { steamId: "76561198000000002" };
  sessions.emit({ token: "new", expiresAt: "2099-01-01T00:00:00Z" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(clears, 1);
  coordinator.stop();
});

test("queued priority-one library work runs before queued priority-two work", async () => {
  const sessions = { getActiveSession: () => ({ token: "session", expiresAt: "2099-01-01T00:00:00Z" }), subscribeSession: () => () => {} };
  const releases = [];
  const started = [];
  const achievements = { syncGame: (id) => new Promise((resolve) => { started.push(id); releases.push(() => resolve({ games: [] })); }) };
  let libraryCalls = 0;
  const library = { getLastSync: async () => undefined, sync: async () => { libraryCalls += 1; started.push("library"); return {}; } };
  const coordinator = new SmartSyncCoordinator(sessions, library, achievements, { getGameById: async (id) => game(id) });
  const first = [1, 2, 3].map((id) => coordinator.syncGame(`steam:${id}`, "manual", true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const fourth = coordinator.syncGame("steam:4", "manual", true);
  const important = coordinator.syncLibrary("reconnect", true);
  releases.shift()();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(libraryCalls, 1);
  assert.ok(started.indexOf("library") < started.indexOf("steam:4"));
  while (releases.length) releases.shift()();
  await Promise.all([...first, fourth, important]);
});
