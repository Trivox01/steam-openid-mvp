import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { LiveAchievementDetectionService, LIVE_ACHIEVEMENT_POLICY } from "../src/services/LiveAchievementDetectionService.ts";
import { LiveAchievementTransitionGate } from "../src/features/achievement-toasts/LiveAchievementTransitionGate.ts";

const game = { id: "steam:10", appId: "10", platform: "steam", name: "Test Game", coverUrl: "", backgroundUrl: "", playtimeHours: 0, totalAchievements: 4, unlockedAchievements: 0, completionPercentage: 0, lastPlayedAt: "" };
const playing = { sessionId: "session-1", appId: "10", state: "playing", startedAtMs: 100, lastSeenAtMs: 100, launchSource: "steam_local", recovered: false };

function detectionHarness({ supported = true } = {}) {
  let sessionsValue = [];
  let authValue = { token: "fixture", expiresAt: "2099-01-01T00:00:00Z" };
  let online = true;
  let nextTimer = 1;
  const timers = new Map();
  const sessionListeners = new Set();
  const authListeners = new Set();
  const onlineListeners = new Set();
  const offlineListeners = new Set();
  const syncResults = [];
  const syncCalls = [];
  const gateCalls = [];
  const diagnostics = [];
  const environment = {
    isOnline: () => online,
    setTimer(callback, delayMs) { const id = nextTimer++; timers.set(id, { callback, delayMs }); return id; },
    clearTimer(id) { timers.delete(id); },
    onOnline(listener) { onlineListeners.add(listener); return () => onlineListeners.delete(listener); },
    onOffline(listener) { offlineListeners.add(listener); return () => offlineListeners.delete(listener); }
  };
  const service = new LiveAchievementDetectionService(
    { list: () => sessionsValue, subscribe(listener) { sessionListeners.add(listener); return () => sessionListeners.delete(listener); } },
    { getAllGames: async () => supported ? [game] : [] },
    { syncLiveGame: async (gameId) => { syncCalls.push(gameId); return syncResults.shift() ?? success(); } },
    {
      beginLiveSession(appId) { gateCalls.push(["begin", appId]); },
      resetLiveSessionBaseline(appId) { gateCalls.push(["reset", appId]); },
      endLiveSession(appId) { gateCalls.push(["end", appId]); }
    },
    {
      getActiveSession: () => authValue,
      subscribeSession(listener) { authListeners.add(listener); return () => authListeners.delete(listener); }
    },
    environment,
    (entry) => diagnostics.push(entry)
  );
  return {
    service, timers, syncResults, syncCalls, gateCalls, diagnostics,
    setSessions(value) { sessionsValue = value; sessionListeners.forEach((listener) => listener()); },
    setAuth(value) { authValue = value; authListeners.forEach((listener) => listener(value)); },
    goOffline() { online = false; offlineListeners.forEach((listener) => listener()); },
    goOnline() { online = true; onlineListeners.forEach((listener) => listener()); },
    async runTimer() {
      const first = [...timers.entries()].sort(([left], [right]) => left - right)[0];
      assert.ok(first, "a timer is scheduled");
      timers.delete(first[0]); first[1].callback(); await settle();
    },
    delay() { return [...timers.values()][0]?.delayMs; }
  };
}

const success = (transitions = 0) => ({ games: [{ gameId: game.id, appId: game.appId, status: "success", unlockTransitions: transitions }] });
const failure = (reason = "network") => ({ games: [{ gameId: game.id, appId: game.appId, status: "failed", errorCode: reason }] });
const settle = async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); };

test("active playing session owns one conservative polling timer", async () => {
  const h = detectionHarness(); h.service.configure(true); h.service.start();
  await settle();
  assert.equal(h.timers.size, 0, "idle performs no polling");
  h.setSessions([playing]); await settle();
  assert.equal(h.delay(), 0, "the first request establishes a baseline immediately");
  await h.runTimer();
  assert.deepEqual(h.syncCalls, [game.id]);
  assert.equal(h.delay(), LIVE_ACHIEVEMENT_POLICY.pollIntervalMs);
  assert.equal(h.timers.size, 1, "there is one timer for the active game");
  h.service.stop();
});

test("failures back off and one success returns to 30 seconds", async () => {
  const h = detectionHarness();
  h.syncResults.push(failure(), failure(), failure(), failure(), success());
  h.service.configure(true); h.setSessions([playing]); h.service.start(); await settle();
  for (const expected of LIVE_ACHIEVEMENT_POLICY.backoffMs) { await h.runTimer(); assert.equal(h.delay(), expected); }
  await h.runTimer();
  assert.equal(h.delay(), LIVE_ACHIEVEMENT_POLICY.pollIntervalMs);
  h.service.stop();
});

test("offline suspends, reconnect creates a silent baseline, and session end stops", async () => {
  const h = detectionHarness(); h.service.configure(true); h.setSessions([playing]); h.service.start(); await settle();
  h.goOffline();
  assert.equal(h.timers.size, 0);
  assert.equal(h.service.snapshot().suspended, true);
  assert.deepEqual(h.gateCalls.at(-1), ["end", "10"]);
  h.goOnline(); await settle();
  assert.deepEqual(h.gateCalls.at(-1), ["begin", "10"]);
  assert.equal(h.delay(), LIVE_ACHIEVEMENT_POLICY.reconnectDelayMs);
  h.setSessions([]); await settle();
  assert.equal(h.service.snapshot().activeAppId, undefined);
  assert.equal(h.timers.size, 0);
  h.service.stop();
});

test("logout, account switch, and unsupported games do not keep polling", async () => {
  const h = detectionHarness(); h.service.configure(true); h.setSessions([playing]); h.service.start(); await settle();
  h.setAuth(undefined); await settle();
  assert.equal(h.timers.size, 0, "logout stops polling");
  h.setAuth({ token: "new-fixture", expiresAt: "2099-01-01T00:00:00Z" }); await settle();
  assert.equal(h.delay(), 0, "new account establishes a new baseline");
  h.service.stop();
  const unsupported = detectionHarness({ supported: false });
  unsupported.service.configure(true); unsupported.setSessions([playing]); unsupported.service.start(); await settle();
  assert.equal(unsupported.timers.size, 0);
  assert.equal(unsupported.syncCalls.length, 0);
  assert.equal(unsupported.diagnostics.at(-1)?.reason, "unsupported-game");
  unsupported.service.stop();
});

test("expired backend session stops without retry spam", async () => {
  const h = detectionHarness(); h.syncResults.push(failure("session_expired"));
  h.service.configure(true); h.setSessions([playing]); h.service.start(); await settle();
  await h.runTimer();
  assert.equal(h.service.snapshot().activeAppId, undefined);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.gateCalls.at(-1), ["end", "10"]);
  h.service.stop();
});

test("transition gate enforces baseline, dedupe, reconnect, and late-result suppression", () => {
  const gate = new LiveAchievementTransitionGate();
  const events = ["A", "B", "C"].map((id) => ({ eventId: `10:${id}`, appId: "10", achievementId: id, name: id, source: "sync_delta" }));
  gate.begin("10");
  let scope = gate.acquire("10");
  assert.deepEqual(gate.transitions("10", [events[0]], true, scope), [], "first successful poll is baseline only");
  gate.release("10", scope);
  scope = gate.acquire("10");
  const unlocked = gate.transitions("10", events, true, scope);
  assert.equal(unlocked.length, 3);
  assert.ok(unlocked.every((event) => event.source === "live_detection"));
  assert.equal(gate.transitions("10", events, true, scope).length, 0, "repeated poll has no duplicates");
  gate.release("10", scope);
  gate.end("10"); gate.begin("10");
  scope = gate.acquire("10");
  assert.equal(gate.transitions("10", events, true, scope).length, 0, "reconnect baseline suppresses a false burst");
  gate.end("10");
  assert.equal(gate.transitions("10", events, true, scope).length, 0, "a request finishing after session end cannot emit");
  gate.release("10", scope);
  scope = gate.acquire("10", true);
  assert.equal(gate.transitions("10", events, true, scope).length, 0, "a queued live poll cannot emit after its session ended");
  gate.release("10", scope);
});

test("implementation has no process, memory, hook, injection, or desktop secret access", async () => {
  const source = await readFile(new URL("../src/services/LiveAchievementDetectionService.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /@tauri-apps|\binvoke\s*\(|process\.|memory|dll|inject|directx|vulkan|steamid|api[_ ]?key/i);
  assert.deepEqual(LIVE_ACHIEVEMENT_POLICY.backoffMs, [30_000, 60_000, 120_000, 240_000]);
});
