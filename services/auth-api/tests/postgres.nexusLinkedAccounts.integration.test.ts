import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  loadPostgresMigrations,
  runPostgresMigrations
} from "../src/storage/postgres/migrationRunner.ts";
import { PostgresAuthorizationRepository } from "../src/storage/postgres/postgresAuthorizationRepository.ts";
import {
  PostgresLinkedAccountRepository,
  LinkedAccountUniqueViolation
} from "../src/nexus/linkedAccountRepository.ts";
import {
  LinkedAccountConflictError,
  NexusLinkedAccountService
} from "../src/nexus/linkedAccountService.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "[::1]", "postgres"];
// Only run against a local or ephemeral CI PostgreSQL. A shared/remote host is
// treated as "not configured" so the suite skips cleanly and never connects to
// a database it should not touch.
function isLocalDatabase(): boolean {
  if (!databaseUrl) return false;
  try {
    return LOCAL_HOSTNAMES.includes(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
}
const localDatabase = isLocalDatabase();
const skipReason = localDatabase
  ? false
  : "TEST_DATABASE_URL is not configured or does not point at a local/ephemeral PostgreSQL host";
const STEAM_ENRICHED = "76561198000007001";
const STEAM_BARE = "76561198000007002";
const STEAM_SECOND = "76561198000007003";
const STEAM_UNUSED = "76561198000007004";

test("Migration 020 linked platform accounts on PostgreSQL", {
  skip: skipReason
}, async () => {
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  // Fail closed: this suite creates and drops schemas, so it may only ever run
  // against a local or ephemeral CI database, never a shared or production one.
  assert.ok(
    LOCAL_HOSTNAMES.includes(target.hostname),
    "TEST_DATABASE_URL must point at a local or ephemeral CI PostgreSQL host"
  );
  const schema = `nla_gate_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`
  });
  try {
    // Connection facts only: never the password or the full connection string.
    console.log(
      `[pg] host=${target.hostname} port=${target.port || "5432"} ` +
      `database=${target.pathname.replace("/", "")} schema=${schema}`
    );

    const migrations = await loadPostgresMigrations();
    const migration020 = migrations.find((migration) => migration.version === 20);
    assert.ok(migration020, "migration 020 must exist");
    assert.equal(migration020.name, "020_nexus_linked_platform_accounts.sql");

    // ---- users that predate the linked-account table ----------------------
    await runPostgresMigrations(pool, migrations.filter((item) => item.version <= 19));
    const authorizationRepository = new PostgresAuthorizationRepository(pool);
    const enriched = await authorizationRepository.ensureAuthenticatedUser(
      STEAM_ENRICHED,
      "2026-08-01T00:00:00.000Z"
    );
    const bare = await authorizationRepository.ensureAuthenticatedUser(
      STEAM_BARE,
      "2026-08-02T00:00:00.000Z"
    );
    // Only the enriched user ever went through the Steam profile path.
    await pool.query(
      "UPDATE users SET steam_nickname = $2, avatar_url = $3 WHERE id = $1",
      [enriched.id, "Player One", "https://avatars.example.test/one.jpg"]
    );
    const usersBefore = await pool.query<{ id: string; steam_id64: string }>(
      "SELECT id, trim(steam_id64) AS steam_id64 FROM users ORDER BY steam_id64"
    );
    assert.equal(usersBefore.rows.length, 2);

    // ---- apply migration 020 ---------------------------------------------
    await runPostgresMigrations(pool, migrations);
    const applied = await pool.query<{ version: number; checksum: string }>(
      "SELECT version, checksum FROM auth_schema_migrations WHERE version = 20"
    );
    assert.equal(applied.rows.length, 1);
    assert.equal(applied.rows[0].checksum, migration020.checksum);

    // ---- table shape ------------------------------------------------------
    const columns = await pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'linked_platform_accounts'
       ORDER BY column_name`
    );
    assert.deepEqual(columns.rows.map((row) => row.column_name), [
      "avatar_url", "connection_status", "display_name", "id", "last_sync_at",
      "last_sync_status", "linked_at", "provider", "provider_user_id",
      "revoked_at", "scopes", "user_id"
    ]);
    // The credential store is deferred: no column may carry provider secrets.
    for (const forbidden of ["credential_ref", "access_token", "refresh_token", "encryption_key_id"]) {
      assert.equal(
        columns.rows.some((row) => row.column_name === forbidden),
        false,
        `${forbidden} must not exist in Phase 2A`
      );
    }
    const indexes = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = current_schema() AND tablename = 'linked_platform_accounts'`
    );
    const indexOf = (name: string) =>
      indexes.rows.find((row) => row.indexname === name)?.indexdef ?? "";
    assert.match(indexOf("linked_accounts_provider_identity_uniq"), /UNIQUE/);
    assert.match(indexOf("linked_accounts_provider_identity_uniq"), /WHERE \(revoked_at IS NULL\)/);
    assert.match(indexOf("linked_accounts_one_per_provider_uniq"), /UNIQUE/);
    assert.match(indexOf("linked_accounts_one_per_provider_uniq"), /WHERE \(revoked_at IS NULL\)/);

    // ---- backfill ---------------------------------------------------------
    const backfilled = await pool.query<{
      id: string; user_id: string; provider: string; provider_user_id: string;
      display_name: string | null; avatar_url: string | null;
      connection_status: string; scopes: string[]; revoked_at: Date | null;
      last_sync_at: Date | null; last_sync_status: string | null;
      linked_matches_created: boolean;
    }>(
      `SELECT l.*, (l.linked_at = u.created_at) AS linked_matches_created
       FROM linked_platform_accounts l JOIN users u ON u.id = l.user_id
       ORDER BY l.provider_user_id`
    );
    assert.equal(backfilled.rows.length, 2, "exactly one Steam link per existing user");
    for (const row of backfilled.rows) {
      assert.equal(row.provider, "steam");
      assert.equal(row.connection_status, "connected");
      assert.deepEqual(row.scopes, []);
      assert.equal(row.revoked_at, null);
      assert.equal(row.last_sync_at, null);
      assert.equal(row.last_sync_status, null);
      assert.equal(row.linked_matches_created, true);
      // char(17) is blank padded; the link stores the trimmed identity.
      assert.match(row.provider_user_id, /^[0-9]{17}$/);
    }
    const [first, second] = backfilled.rows;
    assert.equal(first.provider_user_id, STEAM_ENRICHED);
    assert.equal(first.user_id, enriched.id);
    assert.equal(first.display_name, "Player One");
    assert.equal(first.avatar_url, "https://avatars.example.test/one.jpg");
    // Nothing is invented for a user who never went through Steam enrichment.
    assert.equal(second.provider_user_id, STEAM_BARE);
    assert.equal(second.user_id, bare.id);
    assert.equal(second.display_name, null);
    assert.equal(second.avatar_url, null);

    // Deterministic primary key derived from the owning Nexus user.
    const expectedId = await pool.query<{ id: string }>(
      "SELECT (md5('nexus:linked-platform-account:steam:' || $1::text))::uuid AS id",
      [enriched.id]
    );
    assert.equal(first.id, expectedId.rows[0].id);

    // The authoritative identity is untouched.
    const usersAfter = await pool.query<{ id: string; steam_id64: string }>(
      "SELECT id, trim(steam_id64) AS steam_id64 FROM users ORDER BY steam_id64"
    );
    assert.deepEqual(usersAfter.rows, usersBefore.rows);

    // ---- replay safety ----------------------------------------------------
    // The runner skips an applied migration by checksum, so the statement is
    // replayed directly to prove it is safe on a partially migrated database.
    await pool.query(migration020.sql);
    const afterReplay = await pool.query<{ count: string }>(
      "SELECT count(*) FROM linked_platform_accounts"
    );
    assert.equal(afterReplay.rows[0].count, "2", "replaying 020 must not duplicate links");

    // A partial state with a different active Steam identity for the same
    // Nexus user must fail closed instead of being silently skipped.
    await pool.query("BEGIN");
    try {
      await pool.query("DELETE FROM linked_platform_accounts WHERE id = $1", [first.id]);
      await pool.query(
        `INSERT INTO linked_platform_accounts
           (id, user_id, provider, provider_user_id, connection_status)
         VALUES ($1, $2, 'steam', $3, 'connected')`,
        [randomUUID(), enriched.id, STEAM_SECOND]
      );
      await assert.rejects(
        pool.query(migration020.sql),
        (error: unknown) => (error as { code?: string }).code === "23505",
        "backfill must fail when a Nexus user already owns a different active Steam identity"
      );
    } finally {
      await pool.query("ROLLBACK");
    }

    // Likewise, an active Steam identity already owned by a different Nexus
    // user must stop the backfill rather than being reassigned or ignored.
    await pool.query("BEGIN");
    try {
      await pool.query(
        "DELETE FROM linked_platform_accounts WHERE id = ANY($1::uuid[])",
        [[first.id, second.id]]
      );
      await pool.query(
        `INSERT INTO linked_platform_accounts
           (id, user_id, provider, provider_user_id, connection_status)
         VALUES ($1, $2, 'steam', $3, 'connected')`,
        [randomUUID(), bare.id, STEAM_ENRICHED]
      );
      await assert.rejects(
        pool.query(migration020.sql),
        (error: unknown) => (error as { code?: string }).code === "23505",
        "backfill must fail when the Steam identity is actively owned by another Nexus user"
      );
    } finally {
      await pool.query("ROLLBACK");
    }

    // ---- database-level invariants ----------------------------------------
    const insertRow = (values: {
      id?: string; userId: string; providerUserId: string;
      connectionStatus?: string; revokedAt?: string | null;
    }) =>
      pool.query(
        `INSERT INTO linked_platform_accounts
           (id, user_id, provider, provider_user_id, connection_status, revoked_at)
         VALUES ($1, $2, 'steam', $3, $4, $5)`,
        [
          values.id ?? randomUUID(),
          values.userId,
          values.providerUserId,
          values.connectionStatus ?? "connected",
          values.revokedAt ?? null
        ]
      );

    // One provider identity, one Nexus account.
    await assert.rejects(
      insertRow({ userId: bare.id, providerUserId: STEAM_ENRICHED }),
      (error: unknown) => (error as { code?: string }).code === "23505",
      "an active Steam identity must not attach to a second Nexus user"
    );
    // One active account per provider, per Nexus account.
    await assert.rejects(
      insertRow({ userId: enriched.id, providerUserId: STEAM_SECOND }),
      (error: unknown) => (error as { code?: string }).code === "23505",
      "a Nexus user must not hold two active Steam links"
    );
    // connection_status and revoked_at can never disagree.
    for (const inconsistent of [
      { connectionStatus: "connected", revokedAt: "2026-08-10T00:00:00.000Z" },
      { connectionStatus: "disconnected", revokedAt: null },
      { connectionStatus: "revoked", revokedAt: null }
    ]) {
      await assert.rejects(
        insertRow({
          userId: bare.id,
          providerUserId: STEAM_UNUSED,
          connectionStatus: inconsistent.connectionStatus,
          revokedAt: inconsistent.revokedAt
        }),
        (error: unknown) => (error as { code?: string }).code === "23514",
        `${inconsistent.connectionStatus}/${inconsistent.revokedAt} must be rejected`
      );
    }
    // An unknown provider is refused by the database, not only the application.
    await assert.rejects(
      pool.query(
        `INSERT INTO linked_platform_accounts (id, user_id, provider, provider_user_id)
         VALUES ($1, $2, 'epic', $3)`,
        [randomUUID(), bare.id, "epic-1"]
      ),
      (error: unknown) => (error as { code?: string }).code === "23514"
    );

    // ---- ending a link frees both active slots ----------------------------
    await pool.query(
      `UPDATE linked_platform_accounts
       SET connection_status = 'disconnected', revoked_at = $2 WHERE id = $1`,
      [first.id, "2026-08-11T00:00:00.000Z"]
    );
    // Re-linking the same provider identity to the same Nexus user with a new
    // row proves that both the provider-identity slot and this user's Steam
    // provider slot were freed. The revoked row remains for audit.
    const replacementId = randomUUID();
    await insertRow({
      id: replacementId,
      userId: enriched.id,
      providerUserId: STEAM_ENRICHED
    });
    const afterRelink = await pool.query<{ revoked: string; active: string }>(
      `SELECT
         count(*) FILTER (WHERE revoked_at IS NOT NULL)::text AS revoked,
         count(*) FILTER (
           WHERE user_id = $1 AND provider = 'steam' AND revoked_at IS NULL
         )::text AS active
       FROM linked_platform_accounts`,
      [enriched.id]
    );
    assert.equal(afterRelink.rows[0].revoked, "1");
    assert.equal(afterRelink.rows[0].active, "1");
    // Undo so the service assertions below start from the original backfilled
    // state while preserving the test's proof that relinking was possible.
    await pool.query("DELETE FROM linked_platform_accounts WHERE id = $1", [replacementId]);
    await pool.query(
      `UPDATE linked_platform_accounts
       SET connection_status = 'connected', revoked_at = NULL WHERE id = $1`,
      [first.id]
    );

    // ---- repository and service against real PostgreSQL -------------------
    const repository = new PostgresLinkedAccountRepository(pool);
    await repository.validateSchema();
    const service = new NexusLinkedAccountService(repository);

    const active = await repository.findActiveByProviderIdentity("steam", STEAM_ENRICHED);
    assert.equal(active?.userId, enriched.id);
    assert.equal(active?.revokedAt, undefined);
    assert.equal((await repository.listByUser(enriched.id)).length, 1);

    // Idempotent: a repeated login writes no second row.
    const unchanged = await service.ensureSteamLinkedAccount({
      userId: enriched.id,
      steamId64: STEAM_ENRICHED
    });
    assert.equal(unchanged.status, "unchanged");
    assert.equal(unchanged.account.id, first.id);

    // A provider identity is never silently moved between Nexus users.
    await assert.rejects(
      () => service.ensureSteamLinkedAccount({ userId: bare.id, steamId64: STEAM_ENRICHED }),
      (error: unknown) =>
        error instanceof LinkedAccountConflictError &&
        error.code === "PROVIDER_IDENTITY_OWNED_BY_ANOTHER_USER"
    );
    // A Nexus user never silently swaps its Steam identity.
    await assert.rejects(
      () => service.ensureSteamLinkedAccount({ userId: enriched.id, steamId64: STEAM_SECOND }),
      (error: unknown) =>
        error instanceof LinkedAccountConflictError &&
        error.code === "USER_ALREADY_LINKED_TO_ANOTHER_PROVIDER_IDENTITY"
    );

    // The repository surfaces the constraint, so a lost race cannot duplicate.
    await assert.rejects(
      () =>
        repository.insert({
          id: randomUUID(),
          userId: bare.id,
          provider: "steam",
          providerUserId: STEAM_ENRICHED,
          connectionStatus: "connected",
          scopes: [],
          linkedAt: "2026-08-12T00:00:00.000Z"
        }),
      (error: unknown) =>
        error instanceof LinkedAccountUniqueViolation &&
        error.slot === "provider_identity"
    );

    const finalCount = await pool.query<{ count: string }>(
      "SELECT count(*) FROM linked_platform_accounts"
    );
    assert.equal(finalCount.rows[0].count, "2", "no conflict path may create a row");
    // users and their authoritative Steam ids are still exactly as before.
    const usersFinal = await pool.query<{ id: string; steam_id64: string }>(
      "SELECT id, trim(steam_id64) AS steam_id64 FROM users ORDER BY steam_id64"
    );
    assert.deepEqual(usersFinal.rows, usersBefore.rows);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
