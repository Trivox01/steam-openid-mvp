import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  loadPostgresMigrations,
  runPostgresMigrations
} from "../src/storage/postgres/migrationRunner.ts";
import { PostgresAuthorizationRepository } from "../src/storage/postgres/postgresAuthorizationRepository.ts";
import { PostgresLinkedAccountRepository } from "../src/nexus/linkedAccountRepository.ts";
import { NexusLinkedAccountService } from "../src/nexus/linkedAccountService.ts";
import { PostgresNexusCatalogRepository } from "../src/nexus/catalogRepository.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "[::1]", "postgres"];
const STEAM_ID = "76561198000008101";

function now(offset = 0) {
  return new Date(Date.parse("2026-08-23T00:00:00.000Z") + offset).toISOString();
}

test("Migration 021 Nexus catalog and ownership foundation on PostgreSQL", {
  skip: databaseUrl ? false : "TEST_DATABASE_URL is not configured"
}, async () => {
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.ok(
    LOCAL_HOSTNAMES.includes(target.hostname),
    "TEST_DATABASE_URL must point at a local or ephemeral CI PostgreSQL host"
  );

  const schema = `ncf_gate_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`
  });

  try {
    const migrations = await loadPostgresMigrations();
    const migration021 = migrations.find((migration) => migration.version === 21);
    assert.ok(migration021, "migration 021 must exist");
    assert.equal(
      migration021.name,
      "021_nexus_catalog_ownership_foundation.sql"
    );
    await runPostgresMigrations(pool, migrations);

    const applied = await pool.query<{ checksum: string }>(
      "SELECT checksum FROM auth_schema_migrations WHERE version = 21"
    );
    assert.equal(applied.rows.length, 1);
    assert.equal(applied.rows[0].checksum, migration021.checksum);

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [[
        "canonical_games",
        "platform_games",
        "user_canonical_mapping_suggestions",
        "user_game_ownership"
      ]]
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      [
        "canonical_games",
        "platform_games",
        "user_canonical_mapping_suggestions",
        "user_game_ownership"
      ]
    );

    const authorization = new PostgresAuthorizationRepository(pool);
    const user = await authorization.ensureAuthenticatedUser(STEAM_ID, now());
    const linkedRepository = new PostgresLinkedAccountRepository(pool);
    const linkedService = new NexusLinkedAccountService(linkedRepository);
    const linked = await linkedService.ensureSteamLinkedAccount({
      userId: user.id,
      steamId64: STEAM_ID
    });
    const linkedId = linked.account.id;

    const catalog = new PostgresNexusCatalogRepository(pool);
    await catalog.validateSchema();

    const canonicalId = randomUUID();
    await pool.query(
      `INSERT INTO canonical_games (id, slug, title, release_year)
       VALUES ($1, 'portal-2', 'Portal 2', 2011)`,
      [canonicalId]
    );

    const platformId = randomUUID();
    const initial = await catalog.upsertPlatformGame({
      id: platformId,
      provider: "steam",
      providerGameId: "620",
      title: "Portal 2",
      canonicalGameId: canonicalId,
      canonicalMapping: {
        method: "provider_verified",
        confidence: "verified",
        verifiedBy: "steam",
        verifiedAt: now(1_000)
      },
      firstSeenAt: now(2_000),
      updatedAt: now(2_000)
    });
    assert.equal(initial.id, platformId);
    assert.equal(initial.canonicalGameId, canonicalId);

    // A provider metadata refresh may update the title but cannot rewrite or
    // clear verified shared-catalog evidence, nor replace the internal id.
    const refreshed = await catalog.upsertPlatformGame({
      id: randomUUID(),
      provider: "steam",
      providerGameId: "620",
      title: "Portal 2 - Updated Provider Title",
      firstSeenAt: now(3_000),
      updatedAt: now(4_000)
    });
    assert.equal(refreshed.id, platformId);
    assert.equal(refreshed.title, "Portal 2 - Updated Provider Title");
    assert.equal(refreshed.canonicalGameId, canonicalId);
    assert.equal(refreshed.canonicalMapping?.method, "provider_verified");

    const ownershipId = randomUUID();
    const owned = await catalog.upsertOwnership({
      id: ownershipId,
      linkedAccountId: linkedId,
      platformGameId: platformId,
      playtimeKnown: true,
      playtimeMinutes: 125,
      lastPlayedAt: now(5_000),
      firstSeenAt: now(5_000),
      lastSyncAt: now(5_000)
    });
    assert.equal(owned.id, ownershipId);
    assert.equal(owned.playtimeMinutes, 125);

    const ownedAgain = await catalog.upsertOwnership({
      id: randomUUID(),
      linkedAccountId: linkedId,
      platformGameId: platformId,
      playtimeKnown: false,
      firstSeenAt: now(6_000),
      lastSyncAt: now(6_000)
    });
    assert.equal(ownedAgain.id, ownershipId, "ownership natural key stays idempotent");
    assert.equal(ownedAgain.playtimeKnown, false);
    assert.equal(ownedAgain.playtimeMinutes, undefined);
    assert.equal(ownedAgain.lastPlayedAt, now(5_000), "omitted provider facts are preserved");

    // The normalized ownership row has no provider column, so migration 021
    // enforces provider consistency with a DB trigger instead of trusting the app.
    const xboxPlatformId = randomUUID();
    await pool.query(
      `INSERT INTO platform_games (id, provider, provider_game_id, title)
       VALUES ($1, 'xbox', 'xbox-product-1', 'Example Xbox Game')`,
      [xboxPlatformId]
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO user_game_ownership
           (id, linked_account_id, platform_game_id, playtime_known)
         VALUES ($1,$2,$3,false)`,
        [randomUUID(), linkedId, xboxPlatformId]
      ),
      (error: unknown) => (error as { code?: string }).code === "23514",
      "a Steam link must never own an Xbox platform game"
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO user_game_ownership
           (id, linked_account_id, platform_game_id, playtime_known, playtime_minutes)
         VALUES ($1,$2,$3,false,10)`,
        [randomUUID(), linkedId, platformId]
      ),
      (error: unknown) => (error as { code?: string }).code === "23514",
      "unknown playtime must be stored as NULL, never as a misleading number"
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO platform_games
           (id, provider, provider_game_id, title, canonical_game_id,
            canonical_mapping_method)
         VALUES ($1,'steam','999','Broken Mapping',$2,'provider_verified')`,
        [randomUUID(), canonicalId]
      ),
      (error: unknown) => (error as { code?: string }).code === "23514",
      "canonical mapping evidence must be complete"
    );

    // Canonical deletion is RESTRICTED while verified platform rows point at it.
    // Detach must be explicit so evidence cannot become stale automatically.
    await assert.rejects(
      pool.query("DELETE FROM canonical_games WHERE id = $1", [canonicalId]),
      (error: unknown) => (error as { code?: string }).code === "23503"
    );

    const ownershipColumns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'user_game_ownership'`
    );
    const ownershipColumnNames = ownershipColumns.rows.map((row) => row.column_name);
    assert.equal(ownershipColumnNames.includes("provider"), false);
    assert.equal(ownershipColumnNames.includes("user_id"), false);

    const achievementTables = await pool.query<{ count: string }>(
      `SELECT count(*) FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name IN ('platform_achievements','user_achievement_states')`
    );
    assert.equal(achievementTables.rows[0].count, "0", "achievement persistence is not Phase 3A");

    // User-scoped ownership is deleted with its link. Shared catalog rows stay.
    await pool.query("DELETE FROM linked_platform_accounts WHERE id = $1", [linkedId]);
    assert.equal((await catalog.listOwnershipByLinkedAccount(linkedId)).length, 0);
    assert.ok(await catalog.findPlatformGameByProviderIdentity("steam", "620"));
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
