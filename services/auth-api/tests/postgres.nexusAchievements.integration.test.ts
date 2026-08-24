/**
 * PostgreSQL integration tests for Nexus Achievements (Phase 3B/3D).
 *
 * Requires a temporary local or CI PostgreSQL 16 instance pointed at by
 * TEST_DATABASE_URL. Skips automatically when no TEST_DATABASE_URL is set or
 * the host is not a local/ephemeral host, so it is safe to run anywhere.
 *
 * Runs with: npm --prefix services/auth-api run test:postgres-nexus-achievements
 */

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
import { PostgresNexusAchievementRepository } from "../src/nexus/achievementRepository.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "[::1]", "postgres"];
const STEAM_ID = "76561190000008101";

// Only ever run against a local or ephemeral CI PostgreSQL. A shared/remote host
// is treated as "not configured" so the suite skips cleanly and never connects
// to a database it should not touch.
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

function now(offset = 0) {
  return new Date(Date.parse("2026-08-23T00:00:00.000Z") + offset).toISOString();
}

test("Migration 022 Nexus achievements foundation on PostgreSQL", {
  skip: skipReason
}, async () => {
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.ok(
    LOCAL_HOSTNAMES.includes(target.hostname),
    "TEST_DATABASE_URL must point at a local or ephemeral CI PostgreSQL host"
  );

  const schema = `ncf_ach_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`
  });

  try {
    const migrations = await loadPostgresMigrations();
    const migration022 = migrations.find((migration) => migration.version === 22);
    assert.ok(migration022, "migration 022 must exist");
    assert.equal(
      migration022.name,
      "022_nexus_achievements_foundation.sql"
    );
    await runPostgresMigrations(pool, migrations);

    const applied = await pool.query<{ checksum: string }>(
      "SELECT checksum FROM auth_schema_migrations WHERE version = 22"
    );
    assert.equal(applied.rows.length, 1);
    assert.equal(applied.rows[0].checksum, migration022.checksum);

    // Tables exist with the expected normalized shapes.
    const platformColumns = await pool.query<{ count: string }>(
      `SELECT count(*) FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'platform_achievements'`
    );
    assert.equal(Number(platformColumns.rows[0].count), 13, "platform_achievements has 13 columns");

    const stateColumns = await pool.query<{ count: string }>(
      `SELECT count(*) FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'user_achievement_states'`
    );
    assert.equal(Number(stateColumns.rows[0].count), 7, "user_achievement_states has 7 columns");

    // Unique indexes enforce the natural keys.
    const platformIndex = await pool.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'platform_achievements'
         AND constraint_type = 'UNIQUE'`
    );
    assert.ok(
      platformIndex.rows.some((r) => r.constraint_name === "platform_achievements_identity_uniq"),
      "platform_achievements unique index must exist"
    );

    const stateIndex = await pool.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'user_achievement_states'
         AND constraint_type = 'UNIQUE'`
    );
    assert.ok(
      stateIndex.rows.some((r) => r.constraint_name === "user_achievement_states_uniq"),
      "user_achievement_states unique index must exist"
    );

    // Provider-consistency trigger guards the state <-> achievement link.
    const trigger = await pool.query<{ trigger_name: string }>(
      `SELECT trigger_name FROM information_schema.triggers
       WHERE event_object_table = 'user_achievement_states'
         AND trigger_name = 'user_achievement_states_provider_match'`
    );
    assert.equal(trigger.rows.length, 1);

    // The schema must not leak a duplicated provider column or a user id.
    const platformColumns2 = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'platform_achievements'`
    );
    const platformNames = platformColumns2.rows.map((r) => r.column_name);
    assert.equal(platformNames.includes("provider"), false, "platform_achievements has no provider column");
    assert.equal(platformNames.includes("user_id"), false);

    const stateColumns2 = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'user_achievement_states'`
    );
    const stateNames = stateColumns2.rows.map((r) => r.column_name);
    assert.equal(stateNames.includes("user_id"), false, "user_achievement_states has no user_id column");

    // -------------------------------------------------------------------
    // End-to-end persistence through the repositories (provider identity ->
    // linked account -> platform game -> achievement definition -> state).
    // -------------------------------------------------------------------
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
    const canonicalId = randomUUID();
    await pool.query(
      `INSERT INTO canonical_games (id, slug, title, release_year) VALUES ($1, 'portal-2', 'Portal 2', 2011)`,
      [canonicalId]
    );
    const platformId = randomUUID();
    await catalog.upsertPlatformGame({
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

    const achievements = new PostgresNexusAchievementRepository(pool);
    const achievementId = randomUUID();
    const achievement = await achievements.upsertPlatformAchievement({
      id: achievementId,
      platformGameId: platformId,
      providerAchievementId: "ACH_WIN_ONE_GAME",
      title: "Winner",
      description: "Win one game",
      hidden: false,
      syncedAt: now(3_000)
    });
    assert.equal(achievement.id, achievementId);
    assert.equal(achievement.providerAchievementId, "ACH_WIN_ONE_GAME");

    const stateId = randomUUID();
    const state = await achievements.upsertUserAchievementState({
      id: stateId,
      linkedAccountId: linkedId,
      platformAchievementId: achievementId,
      unlocked: true,
      unlockStateKnown: true,
      unlockedAt: now(4_000),
      syncedAt: now(4_000)
    });
    assert.equal(state.id, stateId);
    assert.equal(state.unlocked, true);

    const states = await achievements.listStatesByLinkedAccount(linkedId);
    assert.equal(states.length, 1);
    assert.equal(states[0].platformAchievementId, achievementId);
    assert.equal(states[0].unlockStateKnown, true);

    // The normalized state row has no provider column, so the database enforces
    // provider consistency between the state and its achievement's game instead
    // of trusting the application.
    const xboxGameId = randomUUID();
    await pool.query(
      `INSERT INTO platform_games (id, provider, provider_game_id, title)
       VALUES ($1, 'xbox', 'xbox-product-1', 'Example Xbox Game')`,
      [xboxGameId]
    );
    const xboxAchievementId = randomUUID();
    await pool.query(
      `INSERT INTO platform_achievements
         (id, platform_game_id, provider_achievement_id, title, description, hidden)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [xboxAchievementId, xboxGameId, "XBOX_ACH", "Xbox Achievement", "", false]
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO user_achievement_states
           (id, linked_account_id, platform_achievement_id, unlocked, unlock_state_known)
         VALUES ($1, $2, $3, false, false)`,
        [randomUUID(), linkedId, xboxAchievementId]
      ),
      (error: unknown) => (error as { code?: string }).code === "23514",
      "a Steam link must never own a state for an Xbox achievement"
    );
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
