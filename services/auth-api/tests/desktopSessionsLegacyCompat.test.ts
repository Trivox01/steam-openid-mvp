import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { InMemoryAuthorizationRepository } from "../src/authorization/authorizationRepository.ts";
import { SessionTokenService } from "../src/authorization/sessionTokenService.ts";
import {
  DesktopSessionError,
  DesktopSessionService,
  desktopSessionPolicy
} from "../src/desktopSessions/desktopSessionService.ts";
import {
  InMemoryDesktopSessionRepository,
  type DesktopSessionRecord
} from "../src/desktopSessions/desktopSessionRepository.ts";
import {
  LEGACY_REFRESH_PROTOCOL_VERSION,
  MODERN_REFRESH_PROTOCOL_VERSION,
  normalizeRefreshProtocolVersion
} from "../src/desktopSessions/refreshProtocol.ts";
import { handleDesktopSessions } from "../src/routes/desktopSessions.ts";
import { PollingRateLimiter } from "../src/security/pollingRateLimiter.ts";
import type { AuthApiConfig } from "../src/config.ts";

const STEAM_ID = "76561198000000000";
const START = Date.parse("2026-08-12T12:00:00.000Z");
const REFRESH_SECRET = "test-refresh-secret-with-more-than-32-bytes";
const ACCESS_SECRET = "test-access-secret-with-more-than-32-bytes";
const OPERATION_X = "00000000-0000-4000-8000-000000000001";
const OPERATION_Y = "00000000-0000-4000-8000-000000000002";
const MIGRATION_019 = new URL(
  "../src/storage/postgres/migrations/019_desktop_session_refresh_protocol.sql",
  import.meta.url
);
const MIGRATION_018 = new URL(
  "../src/storage/postgres/migrations/018_desktop_refresh_operation_identity.sql",
  import.meta.url
);

async function harness() {
  let now = START;
  const authorization = new InMemoryAuthorizationRepository();
  const sessions = new InMemoryDesktopSessionRepository();
  const access = new SessionTokenService(ACCESS_SECRET, authorization, () => now);
  const service = new DesktopSessionService(REFRESH_SECRET, sessions, authorization, access, () => now);
  const login = await service.issueForSteamIdentity(STEAM_ID, new Date(now).toISOString());
  const user = await authorization.findUserBySteamId(STEAM_ID);
  assert.ok(user);
  sessions.users.set(user.id, { accountStatus: user.accountStatus, sessionEpoch: user.sessionEpoch });
  const rows = () => [...sessions.sessions.values()];
  return {
    authorization, sessions, service, login, user, rows,
    advance(ms: number) { now += ms; },
    clock() { return now; },
    stored(credential: string) {
      const id = credential.split(".")[0];
      const row = sessions.sessions.get(id);
      assert.ok(row, "session row must exist");
      return row;
    },
    // Simulates a row written by a backend that predates the protocol column:
    // the INSERT never mentioned it, so the database default (1 = legacy)
    // applies. This is the zero-downtime case: the old backend keeps serving
    // traffic and issuing legacy sessions after migration 019 is applied.
    asOldBackendRow(credential: string) {
      const id = credential.split(".")[0];
      const row = sessions.sessions.get(id);
      assert.ok(row);
      delete row.refreshProtocolVersion;
      return row;
    },
    protocolOf(credential: string) {
      const id = credential.split(".")[0];
      return normalizeRefreshProtocolVersion(sessions.sessions.get(id)?.refreshProtocolVersion);
    }
  };
}

async function refreshError(service: DesktopSessionService, credential: string, operationId?: string) {
  return await service.refresh(credential, operationId).then(
    () => "NO_ERROR",
    (thrown: unknown) => (thrown as DesktopSessionError).code ?? "UNKNOWN"
  );
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

// ---------------------------------------------------------------------------
// 1. Existing rows are migrated to protocol 1.
// ---------------------------------------------------------------------------
test("P1 migration 019 classifies every pre-existing row as legacy protocol 1", async () => {
  const sql = readFileSync(MIGRATION_019, "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS refresh_protocol_version smallint NOT NULL DEFAULT 1/);
  assert.match(sql, /CHECK \(refresh_protocol_version IN \(1, 2\)\)/);
  // Additive only: no destructive statement anywhere in the migration.
  assert.equal(/\b(DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN)\b/i.test(sql), false);
  const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
  console.log(`[P1] 019 additive=true default=1 check=IN (1,2) checksum=${checksum}`);
  // Migration 018 is untouched and still permits the NULL/NULL operation state
  // that a legacy rotation leaves behind.
  const sql018 = readFileSync(MIGRATION_018, "utf8");
  assert.match(sql018, /refresh_operation_hash IS NULL AND refresh_operation_expires_at IS NULL/);
  console.log(`[P1] 018 unchanged checksum=${createHash("sha256").update(sql018, "utf8").digest("hex")}`);
});

// ---------------------------------------------------------------------------
// 2. THE ZERO-DOWNTIME REGRESSION TEST.
// An old backend inserts a session after 019 is applied, without the column.
// It must be classified legacy and must still be able to rotate without an
// operation identity, no matter when it was created.
// ---------------------------------------------------------------------------
test("P2 old-backend INSERT after migration 019 (no protocol column) is legacy and rotates", async () => {
  const h = await harness();
  // Created well after any migration timestamp would have been recorded.
  h.advance(72 * 60 * 60_000);
  const created = new Date(h.clock()).toISOString();
  const row = h.asOldBackendRow(h.login.refreshCredential);
  row.createdAt = created;
  assert.equal(row.refreshProtocolVersion, undefined);
  const loaded = await h.sessions.findById(row.id);
  assert.equal(loaded?.refreshProtocolVersion, LEGACY_REFRESH_PROTOCOL_VERSION);
  const rotated = await h.service.refresh(h.login.refreshCredential);
  console.log(`[P2] created=${created} storedColumn=absent classified=${loaded?.refreshProtocolVersion} rotation=OK`);
  assert.equal(typeof rotated.refreshCredential, "string");
  assert.equal(h.protocolOf(rotated.refreshCredential), LEGACY_REFRESH_PROTOCOL_VERSION);
});

// ---------------------------------------------------------------------------
// 3. New backend issuance writes protocol 2 explicitly (never via DB default).
// ---------------------------------------------------------------------------
test("P3 new backend login issues protocol 2 explicitly", async () => {
  const h = await harness();
  const row = h.stored(h.login.refreshCredential);
  console.log(`[P3] login protocolColumn=${String(row.refreshProtocolVersion)}`);
  assert.equal(row.refreshProtocolVersion, MODERN_REFRESH_PROTOCOL_VERSION);
  // The Postgres writer must send the column on every INSERT, so a forgotten
  // value fails loudly instead of defaulting to legacy.
  const repositorySource = readFileSync(
    new URL("../src/desktopSessions/desktopSessionRepository.ts", import.meta.url), "utf8"
  );
  assert.match(repositorySource, /INSERT INTO desktop_sessions[\s\S]*refresh_protocol_version/);
  assert.match(repositorySource, /input\.refreshProtocolVersion \?\? null/);
  // And no activation-timestamp machinery may survive anywhere.
  const serviceSource = readFileSync(
    new URL("../src/desktopSessions/desktopSessionService.ts", import.meta.url), "utf8"
  );
  for (const source of [repositorySource, serviceSource]) {
    assert.equal(/auth_schema_migrations|LegacyRefreshActivation|applied_at/.test(source), false);
  }
  console.log("[P3] activation timestamp machinery removed = true");
});

// ---------------------------------------------------------------------------
// 4. Legacy protocol 1 fresh + missing operation -> rotation, child protocol 1.
// ---------------------------------------------------------------------------
test("P4 legacy fresh + missing operation rotates and keeps the child legacy", async () => {
  const h = await harness();
  h.asOldBackendRow(h.login.refreshCredential);
  h.advance(60_000);
  const rotated = await h.service.refresh(h.login.refreshCredential);
  const predecessor = h.stored(h.login.refreshCredential);
  const child = h.stored(rotated.refreshCredential);
  console.log(`[P4] child protocol=${String(child.refreshProtocolVersion)} predecessorHash=${String(predecessor.refreshOperationHash)} expires=${String(predecessor.refreshOperationExpiresAt)}`);
  assert.equal(child.refreshProtocolVersion, LEGACY_REFRESH_PROTOCOL_VERSION);
  assert.equal(predecessor.refreshOperationHash, undefined);
  assert.equal(predecessor.refreshOperationExpiresAt, undefined);
});

// ---------------------------------------------------------------------------
// 5. The legacy child stays usable by the same old client.
// ---------------------------------------------------------------------------
test("P5 legacy child remains legacy-compatible for the next refresh", async () => {
  const h = await harness();
  h.asOldBackendRow(h.login.refreshCredential);
  const first = await h.service.refresh(h.login.refreshCredential);
  h.advance(60_000);
  const second = await h.service.refresh(first.refreshCredential);
  console.log(`[P5] generation2 protocol=${h.protocolOf(second.refreshCredential)}`);
  assert.equal(h.protocolOf(second.refreshCredential), LEGACY_REFRESH_PROTOCOL_VERSION);
});

// ---------------------------------------------------------------------------
// 6/7. Legacy duplicate inside and after the historical 8s grace.
// ---------------------------------------------------------------------------
test("P6 legacy duplicate within 8s returns the same child", async () => {
  const h = await harness();
  h.asOldBackendRow(h.login.refreshCredential);
  const first = await h.service.refresh(h.login.refreshCredential);
  h.advance(5_000);
  const duplicate = await h.service.refresh(h.login.refreshCredential);
  console.log(`[P6] grace=${desktopSessionPolicy.legacyRotationGraceMs}ms same=${duplicate.refreshCredential === first.refreshCredential}`);
  assert.equal(desktopSessionPolicy.legacyRotationGraceMs, 8_000);
  assert.equal(duplicate.refreshCredential, first.refreshCredential);
});

test("P7 legacy duplicate after 8s is reuse and revokes the family", async () => {
  const h = await harness();
  h.asOldBackendRow(h.login.refreshCredential);
  await h.service.refresh(h.login.refreshCredential);
  h.advance(8_001);
  const code = await refreshError(h.service, h.login.refreshCredential);
  const revoked = h.rows().every((row) => Boolean(row.revokedAt));
  console.log(`[P7] after grace -> ${code} familyRevoked=${revoked}`);
  assert.equal(code, "DESKTOP_SESSION_REUSED");
  assert.equal(revoked, true);
});

// ---------------------------------------------------------------------------
// 8. A modern client on a legacy session upgrades the family.
// ---------------------------------------------------------------------------
test("P8 legacy fresh + valid operation upgrades the child to protocol 2", async () => {
  const h = await harness();
  h.asOldBackendRow(h.login.refreshCredential);
  const rotated = await h.service.refresh(h.login.refreshCredential, OPERATION_X);
  const predecessor = h.stored(h.login.refreshCredential);
  console.log(`[P8] child protocol=${h.protocolOf(rotated.refreshCredential)} predecessorHashLength=${String(predecessor.refreshOperationHash?.length)}`);
  assert.equal(h.protocolOf(rotated.refreshCredential), MODERN_REFRESH_PROTOCOL_VERSION);
  assert.equal(predecessor.refreshOperationHash?.length, 64);
});

// ---------------------------------------------------------------------------
// 9. No downgrade: a modern session without an operation is never legacy.
// ---------------------------------------------------------------------------
test("P9 protocol 2 fresh + missing operation is rejected, no legacy fallback", async () => {
  const h = await harness();
  h.advance(60_000);
  const code = await refreshError(h.service, h.login.refreshCredential);
  const row = h.stored(h.login.refreshCredential);
  console.log(`[P9] modern + missing operation -> ${code} rotated=${String(row.rotatedAt)}`);
  assert.equal(code, "DESKTOP_SESSION_INVALID");
  assert.equal(row.rotatedAt, undefined);
  assert.equal(h.rows().some((r) => Boolean(r.revokedAt)), false);
});

// ---------------------------------------------------------------------------
// 10-12. Modern protocol behaviour is unchanged.
// ---------------------------------------------------------------------------
test("P10 modern lost response: same operation within 10 minutes returns same child", async () => {
  const h = await harness();
  const first = await h.service.refresh(h.login.refreshCredential, OPERATION_X);
  h.advance(9_000);
  const retry = await h.service.refresh(h.login.refreshCredential, OPERATION_X);
  console.log(`[P10] retry after 9s same=${retry.refreshCredential === first.refreshCredential} recoveryMs=${desktopSessionPolicy.refreshOperationRecoveryMs}`);
  assert.equal(retry.refreshCredential, first.refreshCredential);
  h.advance(desktopSessionPolicy.refreshOperationRecoveryMs + 1_000);
  assert.equal(await refreshError(h.service, h.login.refreshCredential, OPERATION_X), "DESKTOP_SESSION_REUSED");
});

test("P11 modern X then Y is reuse and revokes the family", async () => {
  const h = await harness();
  await h.service.refresh(h.login.refreshCredential, OPERATION_X);
  h.advance(1_000);
  const code = await refreshError(h.service, h.login.refreshCredential, OPERATION_Y);
  console.log(`[P11] Y after X -> ${code} familyRevoked=${h.rows().every((r) => Boolean(r.revokedAt))}`);
  assert.equal(code, "DESKTOP_SESSION_REUSED");
  assert.equal(h.rows().every((row) => Boolean(row.revokedAt)), true);
});

test("P12 modern X then missing operation is reuse, never legacy recovery", async () => {
  const h = await harness();
  await h.service.refresh(h.login.refreshCredential, OPERATION_X);
  // Inside the historical legacy grace window, which must not apply here.
  h.advance(1_000);
  const code = await refreshError(h.service, h.login.refreshCredential);
  console.log(`[P12] missing after X (+1s) -> ${code} familyRevoked=${h.rows().every((r) => Boolean(r.revokedAt))}`);
  assert.equal(code, "DESKTOP_SESSION_REUSED");
  assert.equal(h.rows().every((row) => Boolean(row.revokedAt)), true);
});

test("P12b legacy-rotated predecessor + a new operation is reuse, no bypass", async () => {
  const h = await harness();
  h.asOldBackendRow(h.login.refreshCredential);
  await h.service.refresh(h.login.refreshCredential);
  h.advance(1_000);
  const code = await refreshError(h.service, h.login.refreshCredential, OPERATION_X);
  console.log(`[P12b] legacy predecessor + operation -> ${code} familyRevoked=${h.rows().every((r) => Boolean(r.revokedAt))}`);
  assert.equal(code, "DESKTOP_SESSION_REUSED");
  assert.equal(h.rows().every((row) => Boolean(row.revokedAt)), true);
});

// ---------------------------------------------------------------------------
// 13. Malformed operation identity is invalid, never "missing".
// ---------------------------------------------------------------------------
test("P13 malformed operationId is INVALID and never enters the legacy path", async () => {
  const h = await harness();
  h.asOldBackendRow(h.login.refreshCredential);
  const codes: string[] = [];
  for (const malformed of ["not-a-uuid", "00000000-0000-1000-8000-000000000001", ""]) {
    codes.push(await refreshError(h.service, h.login.refreshCredential, malformed));
  }
  const row = h.stored(h.login.refreshCredential);
  console.log(`[P13] malformed -> ${codes.join(", ")} rotated=${String(row.rotatedAt)}`);
  assert.deepEqual(codes, [
    "DESKTOP_SESSION_INVALID", "DESKTOP_SESSION_INVALID", "DESKTOP_SESSION_INVALID"
  ]);
  assert.equal(row.rotatedAt, undefined);
});

test("P13b route contract: absent operationId is legacy, non-string is malformed", async () => {
  const h = await harness();
  h.asOldBackendRow(h.login.refreshCredential);
  await withServer(h.service, async (url) => {
    const ok = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: h.login.refreshCredential })
    });
    console.log(`[P13b] old contract over HTTP -> ${ok.status}`);
    assert.equal(ok.status, 200);
    const statuses: number[] = [];
    for (const value of [null, 42, {}, ["x"]]) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential: h.login.refreshCredential, operationId: value })
      });
      statuses.push(response.status);
      assert.equal(await response.text(), '{"error":"DESKTOP_SESSION_INVALID"}');
    }
    console.log(`[P13b] non-string operationId -> ${statuses.join(", ")}`);
    assert.deepEqual(statuses, [401, 401, 401, 401]);
  });
});

// ---------------------------------------------------------------------------
// 14/15. Concurrency.
// ---------------------------------------------------------------------------
test("P14 concurrent legacy + legacy produces exactly one child", async () => {
  const h = await harness();
  h.asOldBackendRow(h.login.refreshCredential);
  const results = await Promise.all([
    refreshError(h.service, h.login.refreshCredential),
    refreshError(h.service, h.login.refreshCredential)
  ]);
  const children = h.rows().filter((row) => row.generation === 1);
  const active = children.filter((row) => !row.revokedAt && !row.rotatedAt);
  console.log(`[P14] ${results.join(", ")} children=${children.length} active=${active.length}`);
  assert.equal(children.length, 1);
  assert.equal(active.length, 1);
  assert.equal(h.protocolOf(h.login.refreshCredential), LEGACY_REFRESH_PROTOCOL_VERSION);
});

test("P15 concurrent legacy + modern leaves no duplicate active children", async () => {
  for (const modernFirst of [false, true]) {
    const h = await harness();
    h.asOldBackendRow(h.login.refreshCredential);
    const calls = modernFirst
      ? [refreshError(h.service, h.login.refreshCredential, OPERATION_X), refreshError(h.service, h.login.refreshCredential)]
      : [refreshError(h.service, h.login.refreshCredential), refreshError(h.service, h.login.refreshCredential, OPERATION_X)];
    const results = await Promise.all(calls);
    const children = h.rows().filter((row) => row.generation === 1);
    const active = children.filter((row) => !row.revokedAt && !row.rotatedAt);
    console.log(`[P15:${modernFirst ? "modern-first" : "legacy-first"}] ${results.join(", ")} children=${children.length} active=${active.length} familyRevoked=${h.rows().every((r) => Boolean(r.revokedAt))}`);
    assert.ok(results.includes("NO_ERROR"));
    assert.ok(results.includes("DESKTOP_SESSION_REUSED"));
    assert.equal(active.length, 0);
    assert.equal(h.rows().every((row) => Boolean(row.revokedAt)), true);
  }
});

// ---------------------------------------------------------------------------
// 16. Rollback compatibility: the old INSERT shape stays writable on 019.
// ---------------------------------------------------------------------------
test("P16 schema 019 remains writable by the old INSERT shape", async () => {
  const sql = readFileSync(MIGRATION_019, "utf8");
  // NOT NULL plus DEFAULT is what keeps an INSERT that omits the column valid.
  assert.match(sql, /NOT NULL DEFAULT 1/);
  const h = await harness();
  const legacyRow: DesktopSessionRecord = {
    ...h.stored(h.login.refreshCredential),
    id: "11111111-1111-4111-8111-111111111111",
    tokenFamilyId: "11111111-1111-4111-8111-111111111111"
  };
  delete legacyRow.refreshProtocolVersion;
  await h.sessions.create(legacyRow, desktopSessionPolicy.maximumActiveFamilies);
  const loaded = await h.sessions.findById(legacyRow.id);
  console.log(`[P16] old INSERT shape accepted, classified=${loaded?.refreshProtocolVersion}`);
  assert.equal(loaded?.refreshProtocolVersion, LEGACY_REFRESH_PROTOCOL_VERSION);
});

// ---------------------------------------------------------------------------
// Natural sunset: legacy support ends when no protocol 1 session is still
// valid. The readiness check is a pure database question, not a timestamp.
// ---------------------------------------------------------------------------
test("P17 sunset readiness is decided by remaining valid protocol 1 sessions", async () => {
  const h = await harness();
  h.asOldBackendRow(h.login.refreshCredential);
  const legacyStillValid = () => h.rows().some((row) =>
    normalizeRefreshProtocolVersion(row.refreshProtocolVersion) === LEGACY_REFRESH_PROTOCOL_VERSION &&
    !row.revokedAt && Date.parse(row.expiresAt) > h.clock());
  assert.equal(legacyStillValid(), true);
  h.advance(desktopSessionPolicy.lifetimeMs + 1_000);
  const code = await refreshError(h.service, h.login.refreshCredential);
  console.log(`[P17] expired legacy session -> ${code} legacyStillValid=${legacyStillValid()}`);
  assert.equal(code, "DESKTOP_SESSION_EXPIRED");
  assert.equal(legacyStillValid(), false);
});
