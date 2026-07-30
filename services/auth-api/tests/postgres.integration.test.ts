import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { AuthTransactionService } from "../src/auth/authTransactionService.ts";
import {
  loadPostgresMigrations,
  runPostgresMigrations
} from "../src/storage/postgres/migrationRunner.ts";
import { PostgresAuthTransactionRepository } from "../src/storage/postgres/postgresAuthRepository.ts";
import { PostgresAuthorizationRepository } from "../src/storage/postgres/postgresAuthorizationRepository.ts";
import { AuthorizationService } from "../src/authorization/authorizationService.ts";
import { PostgresBadgeRepository } from "../src/storage/postgres/postgresBadgeRepository.ts";
import { BadgeService } from "../src/badges/badgeService.ts";
import { PostgresBadgeAssignmentRepository } from "../src/storage/postgres/postgresBadgeAssignmentRepository.ts";
import { BadgeAssignmentService } from "../src/badgeAssignments/badgeAssignmentService.ts";
import { PostgresUserRepository } from "../src/storage/postgres/postgresUserRepository.ts";
import { UserService } from "../src/users/userService.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL repository integration and concurrency", {
  skip: databaseUrl ? false : "TEST_DATABASE_URL is not configured"
}, async () => {
  assert.ok(databaseUrl);
  const schema = `openid_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`
  });
  try {
    await runPostgresMigrations(pool);
    await runPostgresMigrations(pool);
    const repository = new PostgresAuthTransactionRepository(pool);
    await repository.validateSchema();
    const authorizationRepository = new PostgresAuthorizationRepository(pool);
    const authorization = new AuthorizationService(authorizationRepository);
    const user = await authorizationRepository.ensureAuthenticatedUser(
      "76561198000000000",
      "2026-07-28T12:00:00.000Z"
    );
    assert.equal(await authorization.bootstrapOwner("76561198000000000"), "assigned");
    assert.equal(await authorization.bootstrapOwner("76561198000000000"), "owner_exists");
    assert.equal(await authorization.hasPermission(user.id, "admin.access"), true);
    const roleCount = await pool.query<{ count: string }>(
      "SELECT count(*) FROM roles WHERE is_system = true"
    );
    const permissionCount = await pool.query<{ count: string }>(
      "SELECT count(*) FROM permissions"
    );
    assert.equal(Number(roleCount.rows[0].count), 5);
    assert.equal(Number(permissionCount.rows[0].count), 20);
    const badgeRepository = new PostgresBadgeRepository(pool);
    await badgeRepository.validateSchema();
    const cleanupStorageKey =
      "tenant-a/badges/staging/00000000-0000-4000-8000-000000000004.png";
    await badgeRepository.enqueueAssetCleanup({
      storageKey: cleanupStorageKey,
      reason: "metadata_rollback"
    });
    await badgeRepository.enqueueAssetCleanup({
      storageKey: cleanupStorageKey,
      reason: "metadata_rollback"
    });
    const cleanupCount = await pool.query<{ count: string }>(
      "SELECT count(*) FROM badge_asset_cleanup_jobs WHERE storage_key=$1",
      [cleanupStorageKey]
    );
    assert.equal(Number(cleanupCount.rows[0].count), 1);
    const badges = new BadgeService(badgeRepository);
    const badgeDraft = {
      slug: "staging-founder", displayName: "Staging Founder",
      description: "Migration validation", category: "special" as const,
      rarity: "exclusive" as const, priority: 100, isActive: true,
      isVisible: true, grantMode: "manual" as const
    };
    const asset = await badgeRepository.saveAsset({
      storageKey: "tenant-a/badges/staging/00000000-0000-4000-8000-000000000005.png",
      contentType: "image/png",
      byteSize: 128,
      width: 64,
      height: 64,
      isSquare: true
    }, user.id);
    const createdBadge = await badges.create({
      ...badgeDraft,
      iconAssetId: asset.id
    }, user.id);
    assert.equal((await badges.get(createdBadge.id))?.slug, "staging-founder");
    const assignmentRepository = new PostgresBadgeAssignmentRepository(pool);
    await assignmentRepository.validateSchema();
    const assignments = new BadgeAssignmentService(assignmentRepository);
    const users = new UserService(
      new PostgresUserRepository(pool),
      authorizationRepository
    );
    await users.repository.validateSchema();
    const concurrentAssignments = await Promise.allSettled([
      assignments.assign({
        userId: user.id,
        badgeDefinitionId: createdBadge.id,
        reason: "concurrency check"
      }, user.id),
      assignments.assign({
        userId: user.id,
        badgeDefinitionId: createdBadge.id,
        reason: "concurrency check"
      }, user.id)
    ]);
    assert.equal(
      concurrentAssignments.filter((item) => item.status === "fulfilled").length,
      1
    );
    const activeAssignment = concurrentAssignments.find(
      (item) => item.status === "fulfilled"
    );
    assert.ok(activeAssignment && activeAssignment.status === "fulfilled");
    const concurrentRevokes = await Promise.allSettled([
      assignments.revoke(activeAssignment.value.id, {}, user.id),
      assignments.revoke(activeAssignment.value.id, {}, user.id)
    ]);
    assert.equal(
      concurrentRevokes.filter((item) => item.status === "fulfilled").length,
      1
    );
    const reassigned = await assignments.assign({
      userId: user.id,
      badgeDefinitionId: createdBadge.id
    }, user.id);
    assert.notEqual(reassigned.id, activeAssignment.value.id);
    assert.equal((await assignments.list({
      page: 1,
      pageSize: 20,
      status: "all",
      userId: user.id,
      badgeDefinitionId: createdBadge.id,
      sort: "assigned_asc"
    })).total, 2);
    const publicBadges = await assignments.listPublicBadges(user.id);
    assert.equal(publicBadges.length, 1);
    assert.equal(publicBadges[0].badge.slug, "staging-founder");
    assert.deepEqual(Object.keys(publicBadges[0].badge).sort(), [
      "category", "description", "displayName", "iconUrl", "rarity", "slug"
    ]);
    const userPage = await users.list({
      page: 1, pageSize: 20, search: user.steamId64,
      status: "active", sort: "created_desc"
    });
    assert.equal(userPage.total, 1);
    assert.equal(userPage.items[0].id, user.id);
    const userDetails = await users.get(user.id);
    assert.equal(userDetails?.steamId64, user.steamId64);
    assert.equal(userDetails?.badgeCount, 1);
    assert.equal(userDetails?.roleCount, 1);
    assert.equal((await users.changeStatus(user.id, user.id, {
      status: "suspended",
      reason: "Integration test"
    }))?.status, "suspended");
    assert.equal((await users.get(user.id))?.status, "suspended");
    const statusAudit = await pool.query<{
      action: string;
      target_id: string;
      metadata_json: Record<string, string>;
    }>(
      `SELECT action, target_id, metadata_json FROM audit_events
       WHERE action='user.status_changed' AND target_id=$1`,
      [user.id]
    );
    assert.equal(statusAudit.rowCount, 1);
    assert.deepEqual(statusAudit.rows[0].metadata_json, {
      previousStatus: "active",
      newStatus: "suspended",
      reason: "Integration test"
    });
    const slugRace = await Promise.allSettled([
      badges.create({ ...badgeDraft, slug: "concurrent-badge" }, user.id),
      badges.create({ ...badgeDraft, slug: "concurrent-badge" }, user.id)
    ]);
    assert.equal(slugRace.filter((item) => item.status === "fulfilled").length, 1);
    assert.ok((await badges.archive(createdBadge.id, user.id)).archivedAt);
    const serviceA = new AuthTransactionService(repository);
    const serviceB = new AuthTransactionService(
      new PostgresAuthTransactionRepository(pool)
    );
    const first = await serviceA.start({
      returnToBase: "https://auth.example.test/callback",
      deviceId: "postgres-device-01"
    });
    assert.equal(
      (await serviceB.status(first.authRequestId, first.pollSecret)).status,
      "pending"
    );
    const race = await Promise.allSettled([
      serviceA.markVerified(
        first.authRequestId,
        "76561198000000000",
        "2026-07-28T12:00:00Zrace"
      ),
      serviceB.markVerified(
        first.authRequestId,
        "76561198000000000",
        "2026-07-28T12:00:00Zrace"
      )
    ]);
    assert.equal(race.filter((item) => item.status === "fulfilled").length, 1);

    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1`,
      [schema]
    );
    const names = columns.rows.map((row) => row.column_name);
    assert.equal(names.includes("poll_secret"), false);
    assert.equal(names.some((name) => /assertion|api_key|token/.test(name)), false);

    const migrations = await loadPostgresMigrations();
    await assert.rejects(runPostgresMigrations(pool, [
      ...migrations,
      {
        version: 99,
        name: "099_rollback_test.sql",
        checksum: "d".repeat(64),
        sql: "CREATE TABLE rollback_probe(id integer); SELECT invalid syntax;"
      }
    ]));
    const rollbackProbe = await pool.query<{ exists: boolean }>(
      "SELECT to_regclass('rollback_probe') IS NOT NULL AS exists"
    );
    assert.equal(rollbackProbe.rows[0].exists, false);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
