import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  loadPostgresMigrations,
  runPostgresMigrations
} from "../src/storage/postgres/migrationRunner.ts";
import { PostgresAuthorizationRepository } from "../src/storage/postgres/postgresAuthorizationRepository.ts";
import { PostgresDesktopSessionRepository } from "../src/desktopSessions/desktopSessionRepository.ts";
import {
  DesktopSessionError,
  DesktopSessionService
} from "../src/desktopSessions/desktopSessionService.ts";
import { SessionTokenService } from "../src/authorization/sessionTokenService.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const MIGRATION_018_CHECKSUM = "69f0fecf9c3635d7f33b8203b4dfde551a79bad095dcefe3dc306d4eb59ca180";
const MIGRATION_019_CHECKSUM = "2b19b0f1d53884df8232af6a74e0058c361b8af6fb16af37b2e157f8d7c9b85c";
const OPERATION_X = "00000000-0000-4000-8000-000000000021";
const OPERATION_Y = "00000000-0000-4000-8000-000000000022";
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60_000;
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "[::1]", "postgres"];

// The exact statement shape of the backend that predates migration 019. It must
// keep working while a zero-downtime deploy is in flight, because the old
// backend keeps serving traffic after the new schema is already applied.
const OLD_BACKEND_INSERT = `INSERT INTO desktop_sessions
  (id,user_id,token_hash,token_family_id,generation,session_epoch_at_issue,
   created_at,last_used_at,expires_at,revoked_at,rotated_at,replacement_session_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,NULL)`;

test("Migration 019 refresh protocol classification on PostgreSQL", {
  skip: databaseUrl ? false : "TEST_DATABASE_URL is not configured"
}, async () => {
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  // Fail closed: this suite creates and drops schemas, so it may only ever run
  // against a local or ephemeral CI database, never a shared or production one.
  assert.ok(
    LOCAL_HOSTNAMES.includes(target.hostname),
    "TEST_DATABASE_URL must point at a local or ephemeral CI PostgreSQL host"
  );
  const schema = `pr1_gate_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`
  });
  try {
    const serverVersion = await pool.query<{ server_version: string }>("SHOW server_version");
    // Connection facts only: never the password or the full connection string.
    console.log(
      `[pg] host=${target.hostname} port=${target.port || "5432"} ` +
      `database=${target.pathname.replace("/", "")} schema=${schema} ` +
      `version=${serverVersion.rows[0].server_version}`
    );

    // ---- migration chain 017 -> 018 -> 019 -------------------------------
    const migrations = await loadPostgresMigrations();
    const migration018 = migrations.find((migration) => migration.version === 18);
    const migration019 = migrations.find((migration) => migration.version === 19);
    assert.ok(migration018, "migration 018 must exist");
    assert.ok(migration019, "migration 019 must exist");
    assert.equal(migration018.checksum, MIGRATION_018_CHECKSUM);
    assert.equal(migration019.checksum, MIGRATION_019_CHECKSUM);
    assert.equal(
      createHash("sha256").update(migration019.sql, "utf8").digest("hex"),
      MIGRATION_019_CHECKSUM
    );
    // Migration 019 is additive only: an applied migration is never edited and
    // the new column must not be destructive to a running old backend.
    assert.doesNotMatch(migration019.sql, /DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
    await runPostgresMigrations(pool, migrations.filter((migration) => migration.version <= 17));
    await runPostgresMigrations(pool, migrations.filter((migration) => migration.version <= 18));

    const authorizationRepository = new PostgresAuthorizationRepository(pool);
    const owner = await authorizationRepository.ensureAuthenticatedUser(
      "76561198000009001",
      "2026-08-01T00:00:00.000Z"
    );

    // ---- a row written before migration 019 ------------------------------
    let clock = Date.parse("2026-09-01T00:00:00.000Z");
    const iso = (value: number) => new Date(value).toISOString();
    const insertOldBackendRow = async (label: string) => {
      const id = randomUUID();
      await pool.query(OLD_BACKEND_INSERT, [
        id, owner.id, createHash("sha256").update(`${label}:${id}`, "utf8").digest("hex"),
        id, 0, 0, iso(clock), iso(clock), iso(clock + SESSION_LIFETIME_MS)
      ]);
      return id;
    };
    const preMigrationRowId = await insertOldBackendRow("pre-019-row");

    await runPostgresMigrations(pool, migrations);

    const applied = await pool.query<{ version: number; checksum: string }>(
      "SELECT version, checksum FROM auth_schema_migrations WHERE version IN (17, 18, 19) ORDER BY version"
    );
    assert.deepEqual(applied.rows.map((row) => Number(row.version)), [17, 18, 19]);
    assert.equal(applied.rows[1].checksum, MIGRATION_018_CHECKSUM);
    assert.equal(applied.rows[2].checksum, MIGRATION_019_CHECKSUM);

    // ---- schema shape of the new column ----------------------------------
    const column = await pool.query<{
      data_type: string; is_nullable: string; column_default: string | null;
    }>(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'desktop_sessions'
         AND column_name = 'refresh_protocol_version'`
    );
    assert.equal(column.rows.length, 1);
    assert.equal(column.rows[0].data_type, "smallint");
    assert.equal(column.rows[0].is_nullable, "NO");
    assert.match(column.rows[0].column_default ?? "", /1/);
    const constraint = await pool.query<{ count: string }>(
      `SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'desktop_sessions'::regclass
         AND conname = 'desktop_sessions_refresh_protocol_version_check'`
    );
    assert.equal(constraint.rows[0].count, "1");

    const protocolOf = async (id: string) => Number((await pool.query<{ protocol: number }>(
      "SELECT refresh_protocol_version AS protocol FROM desktop_sessions WHERE id = $1", [id]
    )).rows[0].protocol);

    // A) an existing row becomes legacy, never modern.
    assert.equal(await protocolOf(preMigrationRowId), 1);
    // B) the old backend writer still succeeds against schema 019.
    assert.equal(await protocolOf(await insertOldBackendRow("old-writer")), 1);
    // C) the same shape is also the rollback writer: a redeploy of the old
    // backend on schema 019 keeps writing usable rows.
    assert.equal(await protocolOf(await insertOldBackendRow("rollback-writer")), 1);

    // The database, not only the application, rejects any other classification.
    for (const rejected of [0, 3, -1]) {
      const id = randomUUID();
      await assert.rejects(
        pool.query(
          `INSERT INTO desktop_sessions
            (id,user_id,token_hash,token_family_id,generation,session_epoch_at_issue,
             created_at,last_used_at,expires_at,refresh_protocol_version)
           VALUES($1,$2,$3,$1,0,0,$4,$4,$5,$6)`,
          [id, owner.id, createHash("sha256").update(id, "utf8").digest("hex"),
            iso(clock), iso(clock + SESSION_LIFETIME_MS), rejected]
        ),
        (error: unknown) => (error as { code?: string }).code === "23514",
        `refresh_protocol_version ${rejected} must be rejected by PostgreSQL`
      );
    }

    // ---- services under test ---------------------------------------------
    const desktopSessionRepository = new PostgresDesktopSessionRepository(pool);
    await desktopSessionRepository.validateSchema();
    const accessTokens = new SessionTokenService(
      "pr1-gate-access-secret-with-more-than-32-bytes",
      authorizationRepository,
      () => clock
    );
    const desktopSessions = new DesktopSessionService(
      "pr1-gate-refresh-secret-with-more-than-32-bytes",
      desktopSessionRepository,
      authorizationRepository,
      accessTokens,
      () => clock
    );

    const issuedCredentials: string[] = [];
    let steamSequence = 0;
    // Each scenario uses its own account so that the active-family cap of one
    // account never revokes another scenario's family.
    const login = async (protocol: 1 | 2) => {
      steamSequence += 1;
      const steamId = `7656119800000${1000 + steamSequence}`;
      await authorizationRepository.ensureAuthenticatedUser(steamId, iso(clock));
      const issued = await desktopSessions.issueForSteamIdentity(steamId, iso(clock));
      issuedCredentials.push(issued.refreshCredential);
      const id = issued.refreshCredential.slice(0, 36);
      if (protocol === 1) {
        // Simulates a family issued by the pre-019 backend. The column default
        // produces exactly this value for those rows.
        await pool.query(
          "UPDATE desktop_sessions SET refresh_protocol_version = 1 WHERE id = $1", [id]
        );
      }
      return { credential: issued.refreshCredential, id };
    };
    const rotate = async (credential: string, operationId?: string) => {
      const rotated = await desktopSessions.refresh(credential, operationId);
      issuedCredentials.push(rotated.refreshCredential);
      return rotated;
    };
    const codeOf = async (action: Promise<unknown>) => {
      try {
        await action;
        return "no_error";
      } catch (error) {
        return error instanceof DesktopSessionError ? error.code : `unexpected:${String(error)}`;
      }
    };
    const familyRows = async (familyId: string) => (await pool.query<{
      id: string; generation: number; revoked_at: string | null;
      rotated_at: string | null; refresh_protocol_version: number;
    }>(
      `SELECT id, generation, revoked_at, rotated_at, refresh_protocol_version
       FROM desktop_sessions WHERE token_family_id = $1 ORDER BY generation`, [familyId]
    )).rows;
    const activeChildren = (rows: Array<{ revoked_at: string | null; rotated_at: string | null }>) =>
      rows.filter((row) => row.revoked_at === null && row.rotated_at === null).length;

    // ---- new writer -------------------------------------------------------
    const modernLogin = await login(2);
    // The column default is 1, so a stored 2 can only come from an explicit
    // write by the current backend.
    assert.equal(await protocolOf(modernLogin.id), 2);

    // ---- legacy behaviour on real PostgreSQL ------------------------------
    const legacy = await login(1);
    const legacyChild = await rotate(legacy.credential);
    assert.equal(await protocolOf(legacyChild.refreshCredential.slice(0, 36)), 1);
    clock += 5_000;
    const legacyDuplicate = await rotate(legacy.credential);
    assert.equal(legacyDuplicate.refreshCredential, legacyChild.refreshCredential);
    clock += 9_000;
    assert.equal(await codeOf(desktopSessions.refresh(legacy.credential)), "DESKTOP_SESSION_REUSED");
    const legacyFamily = await familyRows(legacy.id);
    assert.equal(legacyFamily.filter((row) => Number(row.generation) === 1).length, 1);
    assert.equal(legacyFamily.every((row) => row.revoked_at !== null), true);
    assert.equal(activeChildren(legacyFamily), 0);

    // An unusable replacement must not be handed back as a valid duplicate.
    const unusable = await login(1);
    const unusableChild = await rotate(unusable.credential);
    await pool.query(
      "UPDATE desktop_sessions SET revoked_at = $2 WHERE id = $1",
      [unusableChild.refreshCredential.slice(0, 36), iso(clock)]
    );
    clock += 2_000;
    assert.equal(await codeOf(desktopSessions.refresh(unusable.credential)), "DESKTOP_SESSION_REUSED");
    const unusableFamily = await familyRows(unusable.id);
    assert.equal(unusableFamily.every((row) => row.revoked_at !== null), true);
    assert.equal(activeChildren(unusableFamily), 0);

    // ---- modern behaviour -------------------------------------------------
    // A legacy family upgrades one way as soon as the client sends an operation.
    const upgrade = await login(1);
    const upgraded = await rotate(upgrade.credential, OPERATION_X);
    assert.equal(await protocolOf(upgraded.refreshCredential.slice(0, 36)), 2);
    clock += 1_000;
    // No downgrade: the upgraded predecessor no longer accepts a missing
    // operation even though it is still classified as legacy.
    assert.equal(await codeOf(desktopSessions.refresh(upgrade.credential)), "DESKTOP_SESSION_REUSED");
    assert.equal((await familyRows(upgrade.id)).every((row) => row.revoked_at !== null), true);

    const modern = await login(2);
    const modernChild = await rotate(modern.credential, OPERATION_X);
    assert.equal(await protocolOf(modernChild.refreshCredential.slice(0, 36)), 2);
    // Beyond the legacy 8s grace but inside the 10 minute operation recovery:
    // the legacy window must not govern modern recovery.
    clock += 9_000;
    const modernRetry = await desktopSessions.refresh(modern.credential, OPERATION_X);
    assert.equal(modernRetry.refreshCredential, modernChild.refreshCredential);
    assert.equal(await codeOf(desktopSessions.refresh(modern.credential)), "DESKTOP_SESSION_REUSED");
    assert.equal((await familyRows(modern.id)).every((row) => row.revoked_at !== null), true);

    const replay = await login(2);
    await rotate(replay.credential, OPERATION_X);
    assert.equal(
      await codeOf(desktopSessions.refresh(replay.credential, OPERATION_Y)),
      "DESKTOP_SESSION_REUSED"
    );
    assert.equal((await familyRows(replay.id)).every((row) => row.revoked_at !== null), true);

    // A modern session that never rotated must refuse a missing operation
    // outright, and must not be revoked for it.
    const strict = await login(2);
    assert.equal(await codeOf(desktopSessions.refresh(strict.credential)), "DESKTOP_SESSION_INVALID");
    const strictFamily = await familyRows(strict.id);
    assert.equal(strictFamily.length, 1);
    assert.equal(strictFamily[0].rotated_at, null);
    assert.equal(strictFamily[0].revoked_at, null);

    // ---- concurrency through SELECT ... FOR UPDATE ------------------------
    const raceLegacy = await login(1);
    const legacyRace = await Promise.allSettled([
      desktopSessions.refresh(raceLegacy.credential),
      desktopSessions.refresh(raceLegacy.credential)
    ]);
    assert.equal(legacyRace.filter((item) => item.status === "fulfilled").length, 2);
    const legacyRaceCredentials = new Set(legacyRace.map((item) =>
      item.status === "fulfilled" ? item.value.refreshCredential : "rejected"));
    assert.equal(legacyRaceCredentials.size, 1);
    for (const credential of legacyRaceCredentials) issuedCredentials.push(credential);
    const legacyRaceFamily = await familyRows(raceLegacy.id);
    assert.equal(legacyRaceFamily.filter((row) => Number(row.generation) === 1).length, 1);
    assert.equal(activeChildren(legacyRaceFamily), 1);

    const raceMixed = await login(1);
    const mixedRace = await Promise.allSettled([
      desktopSessions.refresh(raceMixed.credential),
      desktopSessions.refresh(raceMixed.credential, OPERATION_X)
    ]);
    for (const item of mixedRace) {
      if (item.status === "fulfilled") issuedCredentials.push(item.value.refreshCredential);
    }
    assert.equal(mixedRace.filter((item) => item.status === "fulfilled").length, 1);
    const loser = mixedRace.find((item) => item.status === "rejected");
    assert.ok(loser && loser.status === "rejected");
    assert.ok(loser.reason instanceof DesktopSessionError);
    assert.equal(loser.reason.code, "DESKTOP_SESSION_REUSED");
    const mixedFamily = await familyRows(raceMixed.id);
    assert.equal(mixedFamily.filter((row) => Number(row.generation) === 1).length, 1);
    assert.equal(mixedFamily.every((row) => row.revoked_at !== null), true);
    assert.equal(activeChildren(mixedFamily), 0);

    // ---- nothing raw is ever persisted ------------------------------------
    const stored = await pool.query<{
      token_hash: string; refresh_operation_hash: string | null; refresh_protocol_version: number;
    }>("SELECT token_hash, refresh_operation_hash, refresh_protocol_version FROM desktop_sessions");
    const serialized = JSON.stringify(stored.rows);
    for (const credential of issuedCredentials) {
      assert.equal(serialized.includes(credential), false);
      assert.equal(serialized.includes(credential.split(".")[1]), false);
    }
    assert.equal(serialized.includes(OPERATION_X), false);
    assert.equal(serialized.includes(OPERATION_Y), false);
    for (const row of stored.rows) {
      assert.match(row.token_hash, /^[a-f0-9]{64}$/);
      if (row.refresh_operation_hash) assert.match(row.refresh_operation_hash, /^[a-f0-9]{64}$/);
      assert.ok([1, 2].includes(Number(row.refresh_protocol_version)));
    }
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
