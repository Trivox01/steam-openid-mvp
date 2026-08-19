import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { InMemoryAuthorizationRepository } from "../src/authorization/authorizationRepository.ts";
import { SessionTokenService } from "../src/authorization/sessionTokenService.ts";
import {
  DesktopSessionError,
  DesktopSessionService
} from "../src/desktopSessions/desktopSessionService.ts";
import { InMemoryDesktopSessionRepository } from "../src/desktopSessions/desktopSessionRepository.ts";
import {
  LEGACY_REFRESH_ROTATION_GRACE_MS,
  LegacyRefreshActivationStateError,
  MigrationLegacyRefreshActivation
} from "../src/desktopSessions/legacyRefreshActivation.ts";
import { handleDesktopSessions } from "../src/routes/desktopSessions.ts";
import { PollingRateLimiter } from "../src/security/pollingRateLimiter.ts";
import type { AuthApiConfig } from "../src/config.ts";

const STEAM_ID = "76561198000000000";
const START = Date.parse("2026-08-12T12:00:00.000Z");
// Migration 018 activation marker, i.e. auth_schema_migrations.applied_at.
const ACTIVATION_MS = START + 60 * 60_000;
const ACTIVATION = new Date(ACTIVATION_MS).toISOString();
const REFRESH_SECRET = "test-refresh-secret-with-more-than-32-bytes";
const ACCESS_SECRET = "test-access-secret-with-more-than-32-bytes";
const OPERATION_X = "00000000-0000-4000-8000-000000000001";
const OPERATION_Y = "00000000-0000-4000-8000-000000000002";

async function harness(options?: { issueAt?: number; activation?: string }) {
  let now = options?.issueAt ?? START;
  const authorization = new InMemoryAuthorizationRepository();
  const sessions = new InMemoryDesktopSessionRepository(
    "activation" in (options ?? {}) ? options?.activation : ACTIVATION
  );
  const access = new SessionTokenService(ACCESS_SECRET, authorization, () => now);
  const service = new DesktopSessionService(REFRESH_SECRET, sessions, authorization, access, () => now);
  const login = await service.issueForSteamIdentity(STEAM_ID, new Date(now).toISOString());
  const user = await authorization.findUserBySteamId(STEAM_ID);
  assert.ok(user);
  sessions.users.set(user.id, { accountStatus: user.accountStatus, sessionEpoch: user.sessionEpoch });
  const familyId = [...sessions.sessions.values()][0].tokenFamilyId;
  return {
    authorization, sessions, service, login, user, familyId,
    at(ms: number) { now = ms; },
    advance(ms: number) { now += ms; },
    activeChildren() {
      return [...sessions.sessions.values()].filter(
        (session) => session.generation > 0 && !session.revokedAt && !session.rotatedAt
      );
    },
    familyRevoked() {
      return [...sessions.sessions.values()]
        .filter((session) => session.tokenFamilyId === familyId)
        .every((session) => Boolean(session.revokedAt));
    },
    predecessor() { return [...sessions.sessions.values()].find((session) => session.generation === 0)!; }
  };
}

async function refreshError(run: Promise<unknown>) {
  return await run.then(() => "NO_ERROR", (error: unknown) => (error as DesktopSessionError).code);
}

async function withServer(service: DesktopSessionService, run: (url: string) => Promise<void>) {
  const config = { nodeEnv: "test", trustProxy: false } as AuthApiConfig;
  const limiter = new PollingRateLimiter({ minimumIntervalMs: 0 });
  const server = createServer((request, response) => {
    void handleDesktopSessions(
      request, response, new URL(request.url ?? "/", "http://localhost"),
      { sessions: service, rateLimiter: limiter, config }
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}/v1/auth/desktop/refresh`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function fakePool(handler: () => { rows: Array<{ appliedAt: string | Date | null }> }) {
  let queries = 0;
  const pool = {
    query: async () => { queries += 1; return handler(); }
  } as unknown as Pool;
  return { pool, count() { return queries; } };
}

// 1. Pre-cutover session, old client contract (no operation) rotates.
test("legacy: pre-cutover fresh credential rotates without operation", async () => {
  const h = await harness();
  h.at(ACTIVATION_MS + 60_000);
  const rotated = await h.service.refresh(h.login.refreshCredential);
  assert.equal(typeof rotated.refreshCredential, "string");
  const predecessor = h.predecessor();
  console.log(`[L1] legacy rotation ok, hash=${String(predecessor.refreshOperationHash)} expires=${String(predecessor.refreshOperationExpiresAt)}`);
  // The predecessor stays marked as legacy: both operation columns unset.
  assert.equal(predecessor.refreshOperationHash, undefined);
  assert.equal(predecessor.refreshOperationExpiresAt, undefined);
  assert.equal(h.activeChildren().length, 1);
});

// 2. Legacy duplicate inside the historical 8s grace returns the same child.
test("legacy: duplicate within 8s grace returns the same replacement", async () => {
  const h = await harness();
  h.at(ACTIVATION_MS + 60_000);
  const first = await h.service.refresh(h.login.refreshCredential);
  h.advance(LEGACY_REFRESH_ROTATION_GRACE_MS);
  const second = await h.service.refresh(h.login.refreshCredential);
  console.log(`[L2] grace=${LEGACY_REFRESH_ROTATION_GRACE_MS}ms same=${first.refreshCredential === second.refreshCredential}`);
  assert.equal(second.refreshCredential, first.refreshCredential);
  assert.equal(h.activeChildren().length, 1);
});

// 3. Legacy duplicate after the grace is reuse and revokes the family.
test("legacy: duplicate after 8s grace is reuse and revokes the family", async () => {
  const h = await harness();
  h.at(ACTIVATION_MS + 60_000);
  await h.service.refresh(h.login.refreshCredential);
  h.advance(LEGACY_REFRESH_ROTATION_GRACE_MS + 1);
  const code = await refreshError(h.service.refresh(h.login.refreshCredential));
  console.log(`[L3] after grace -> ${code} familyRevoked=${h.familyRevoked()}`);
  assert.equal(code, "DESKTOP_SESSION_REUSED");
  assert.equal(h.familyRevoked(), true);
});

// 4. A legacy-rotated predecessor cannot be re-rotated by supplying an operation.
test("legacy: new operation on a legacy-rotated predecessor is reuse, not a bypass", async () => {
  const h = await harness();
  h.at(ACTIVATION_MS + 60_000);
  await h.service.refresh(h.login.refreshCredential);
  const code = await refreshError(h.service.refresh(h.login.refreshCredential, OPERATION_X));
  console.log(`[L4] legacy predecessor + operation -> ${code} familyRevoked=${h.familyRevoked()}`);
  assert.equal(code, "DESKTOP_SESSION_REUSED");
  assert.equal(h.familyRevoked(), true);
});

// 5. created_at == activation is modern-only (strict <).
test("activation: session created exactly at activation is denied legacy", async () => {
  const h = await harness({ issueAt: ACTIVATION_MS });
  h.at(ACTIVATION_MS + 60_000);
  const code = await refreshError(h.service.refresh(h.login.refreshCredential));
  console.log(`[A2] created_at == applied_at -> ${code}`);
  assert.equal(code, "DESKTOP_SESSION_INVALID");
  assert.equal(h.predecessor().rotatedAt, undefined);
});

// 6. Post-cutover sessions are modern-only.
test("activation: session created after activation is denied legacy", async () => {
  const h = await harness({ issueAt: ACTIVATION_MS + 5 * 60_000 });
  h.advance(60_000);
  const code = await refreshError(h.service.refresh(h.login.refreshCredential));
  console.log(`[A3] created_at > applied_at -> ${code}`);
  assert.equal(code, "DESKTOP_SESSION_INVALID");
  assert.equal(h.predecessor().rotatedAt, undefined);
});

// 7. Expiry still wins over legacy eligibility.
test("legacy: expired pre-cutover session is expired, not legacy recovery", async () => {
  const h = await harness();
  h.at(START + 31 * 24 * 60 * 60_000);
  const code = await refreshError(h.service.refresh(h.login.refreshCredential));
  console.log(`[A7] expired pre-cutover -> ${code}`);
  assert.equal(code, "DESKTOP_SESSION_EXPIRED");
});

// 8. An unusable replacement is never handed back as a legacy duplicate.
test("legacy: revoked replacement inside grace is reuse, not duplicate", async () => {
  const h = await harness();
  h.at(ACTIVATION_MS + 60_000);
  const first = await h.service.refresh(h.login.refreshCredential);
  const child = h.activeChildren()[0];
  child.revokedAt = new Date(ACTIVATION_MS + 61_000).toISOString();
  h.advance(1_000);
  const code = await refreshError(h.service.refresh(h.login.refreshCredential));
  console.log(`[L8] revoked replacement inside grace -> ${code} (first=${first.refreshCredential.slice(0, 8)}…)`);
  assert.equal(code, "DESKTOP_SESSION_REUSED");
});

// 9. Modern rotation is unchanged.
test("modern: rotation with operation X succeeds and stores only the hash", async () => {
  const h = await harness();
  h.at(ACTIVATION_MS + 60_000);
  await h.service.refresh(h.login.refreshCredential, OPERATION_X);
  const predecessor = h.predecessor();
  console.log(`[M1] modern rotation hashLength=${predecessor.refreshOperationHash?.length} raw=${String(predecessor.refreshOperationHash === OPERATION_X)}`);
  assert.equal(predecessor.refreshOperationHash?.length, 64);
  assert.notEqual(predecessor.refreshOperationHash, OPERATION_X);
  assert.ok(predecessor.refreshOperationExpiresAt);
});

// 10. Lost response recovery still works beyond the legacy grace.
test("modern: same operation X after 9s within recovery returns the same replacement", async () => {
  const h = await harness();
  h.at(ACTIVATION_MS + 60_000);
  const first = await h.service.refresh(h.login.refreshCredential, OPERATION_X);
  h.advance(9_000);
  const second = await h.service.refresh(h.login.refreshCredential, OPERATION_X);
  console.log(`[M2] X retry after 9s same=${first.refreshCredential === second.refreshCredential}`);
  assert.equal(second.refreshCredential, first.refreshCredential);
  assert.equal(h.activeChildren().length, 1);
});

// 11. A different operation is reuse.
test("modern: operation Y after X is reuse and revokes the family", async () => {
  const h = await harness();
  h.at(ACTIVATION_MS + 60_000);
  await h.service.refresh(h.login.refreshCredential, OPERATION_X);
  h.advance(1_000);
  const code = await refreshError(h.service.refresh(h.login.refreshCredential, OPERATION_Y));
  console.log(`[M3] Y after X -> ${code} familyRevoked=${h.familyRevoked()}`);
  assert.equal(code, "DESKTOP_SESSION_REUSED");
  assert.equal(h.familyRevoked(), true);
});

// 12. The downgrade attack: a modern predecessor never falls back to legacy,
// even on a pre-cutover session and even inside the 8s window.
test("security: missing operation after X is reuse, never legacy fallback", async () => {
  const h = await harness();
  h.at(ACTIVATION_MS + 60_000);
  await h.service.refresh(h.login.refreshCredential, OPERATION_X);
  h.advance(1_000);
  const code = await refreshError(h.service.refresh(h.login.refreshCredential));
  console.log(`[M4] missing operation after X (pre-cutover session, +1s) -> ${code} familyRevoked=${h.familyRevoked()}`);
  assert.equal(code, "DESKTOP_SESSION_REUSED");
  assert.equal(h.familyRevoked(), true);
});

// 13. Malformed is not missing.
test("security: malformed operationId is rejected and cannot rotate as legacy", async () => {
  for (const malformed of ["not-a-uuid", "00000000-0000-1000-8000-000000000001", ""]) {
    const h = await harness();
    h.at(ACTIVATION_MS + 60_000);
    const code = await refreshError(h.service.refresh(h.login.refreshCredential, malformed));
    console.log(`[M5] malformed operationId ${JSON.stringify(malformed)} -> ${code} rotated=${String(h.predecessor().rotatedAt)}`);
    assert.equal(code, "DESKTOP_SESSION_INVALID");
    assert.equal(h.predecessor().rotatedAt, undefined);
  }
});

// 14. Route contract: absent field is legacy, present-but-not-a-string is malformed.
test("route: absent operationId is legacy, non-string operationId is malformed", async () => {
  const legacy = await harness();
  legacy.at(ACTIVATION_MS + 60_000);
  await withServer(legacy.service, async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: legacy.login.refreshCredential })
    });
    console.log(`[R1] old contract over HTTP -> ${response.status}`);
    assert.equal(response.status, 200);
  });
  for (const malformed of [null, 42, {}, ["x"]]) {
    const h = await harness();
    h.at(ACTIVATION_MS + 60_000);
    await withServer(h.service, async (url) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential: h.login.refreshCredential, operationId: malformed })
      });
      const text = await response.text();
      console.log(`[R2] operationId=${JSON.stringify(malformed)} -> ${response.status} ${text}`);
      assert.equal(response.status, 401);
      assert.equal(text, '{"error":"DESKTOP_SESSION_INVALID"}');
      assert.equal(h.predecessor().rotatedAt, undefined);
    });
  }
});

// 15. Concurrency: two legacy refreshes create exactly one child.
test("concurrency: legacy + legacy yields exactly one child", async () => {
  const h = await harness();
  h.at(ACTIVATION_MS + 60_000);
  const results = await Promise.all([
    refreshError(h.service.refresh(h.login.refreshCredential)),
    refreshError(h.service.refresh(h.login.refreshCredential))
  ]);
  const children = [...h.sessions.sessions.values()].filter((session) => session.generation > 0);
  console.log(`[C1] legacy+legacy -> ${results.join(", ")} children=${children.length} active=${h.activeChildren().length}`);
  assert.equal(children.length, 1);
  assert.ok(h.activeChildren().length <= 1);
});

// 16. Concurrency: legacy + modern on a fresh pre-cutover predecessor must never
// leave two usable children. The loser is treated as reuse.
test("concurrency: legacy + modern leaves no duplicate active children", async () => {
  for (const order of ["legacy-first", "modern-first"] as const) {
    const h = await harness();
    h.at(ACTIVATION_MS + 60_000);
    const calls = order === "legacy-first"
      ? [h.service.refresh(h.login.refreshCredential), h.service.refresh(h.login.refreshCredential, OPERATION_X)]
      : [h.service.refresh(h.login.refreshCredential, OPERATION_X), h.service.refresh(h.login.refreshCredential)];
    const results = await Promise.all(calls.map((call) => refreshError(call)));
    console.log(`[C2:${order}] -> ${results.join(", ")} active=${h.activeChildren().length} familyRevoked=${h.familyRevoked()}`);
    assert.ok(h.activeChildren().length <= 1);
    assert.equal(results.filter((code) => code === "NO_ERROR").length, 1);
    assert.equal(results.filter((code) => code === "DESKTOP_SESSION_REUSED").length, 1);
    // Reuse detection revokes the whole family, so nothing usable remains.
    assert.equal(h.familyRevoked(), true);
    assert.equal(h.activeChildren().length, 0);
  }
});

// 17. The activation marker is persisted, shared, and loaded once.
test("activation: restart and a second instance resolve the identical cutoff", async () => {
  const applied = new Date(ACTIVATION_MS);
  const first = fakePool(() => ({ rows: [{ appliedAt: applied }] }));
  const instanceOne = new MigrationLegacyRefreshActivation(first.pool);
  const resolvedOnce = await instanceOne.resolve();
  const resolvedTwice = await instanceOne.resolve();
  const afterRestart = await new MigrationLegacyRefreshActivation(first.pool).resolve();
  const second = fakePool(() => ({ rows: [{ appliedAt: applied.toISOString() }] }));
  const otherInstance = await new MigrationLegacyRefreshActivation(second.pool).resolve();
  console.log(`[A4/A5] cutoff=${String(resolvedOnce)} restart=${String(afterRestart)} instance2=${String(otherInstance)} queriesOnInstance1=${first.count()}`);
  assert.equal(resolvedOnce, ACTIVATION);
  assert.equal(resolvedTwice, ACTIVATION);
  assert.equal(afterRestart, ACTIVATION);
  assert.equal(otherInstance, ACTIVATION);
  // One query for the first instance, one for the simulated restart. No
  // per-request query.
  assert.equal(first.count(), 2);
});

// 18. Missing, invalid, or unreadable marker fails closed.
test("activation: missing or invalid marker fails closed", async () => {
  const missing = new MigrationLegacyRefreshActivation(fakePool(() => ({ rows: [] })).pool);
  const invalid = new MigrationLegacyRefreshActivation(fakePool(() => ({ rows: [{ appliedAt: "not-a-timestamp" }] })).pool);
  const nulled = new MigrationLegacyRefreshActivation(fakePool(() => ({ rows: [{ appliedAt: null }] })).pool);
  const broken = new MigrationLegacyRefreshActivation({
    query: async () => { throw new Error("connection_reset"); }
  } as unknown as Pool);
  for (const [label, activation] of [["missing", missing], ["invalid", invalid], ["null", nulled], ["error", broken]] as const) {
    const resolved = await activation.resolve();
    const asserted = await activation.assertConsistent().then(() => "NO_ERROR", (error: unknown) =>
      error instanceof LegacyRefreshActivationStateError ? error.code : "OTHER");
    console.log(`[A6] ${label} marker -> resolve=${String(resolved)} assertConsistent=${asserted}`);
    assert.equal(resolved, undefined);
    assert.equal(asserted, "desktop_session_activation_state_invalid");
  }
  // Fail closed end to end: without a marker, no session may use legacy.
  const h = await harness({ activation: undefined });
  h.at(ACTIVATION_MS + 60_000);
  const code = await refreshError(h.service.refresh(h.login.refreshCredential));
  console.log(`[A6] fail-closed refresh without activation -> ${code}`);
  assert.equal(code, "DESKTOP_SESSION_INVALID");
  assert.equal(h.predecessor().rotatedAt, undefined);
});

// 19. Migration 018 is untouched and already permits the legacy NULL/NULL state.
test("schema: migration 018 is unchanged and allows NULL/NULL", async () => {
  const sql = await readFile(
    new URL("../src/storage/postgres/migrations/018_desktop_refresh_operation_identity.sql", import.meta.url),
    "utf8"
  );
  const allowsNullPair = sql.includes(
    "(refresh_operation_hash IS NULL AND refresh_operation_expires_at IS NULL)"
  );
  console.log(`[S1] 018 constraint allows NULL/NULL = ${allowsNullPair}`);
  assert.equal(allowsNullPair, true);
  assert.equal(sql.includes("ADD COLUMN IF NOT EXISTS refresh_operation_hash char(64)"), true);
});
