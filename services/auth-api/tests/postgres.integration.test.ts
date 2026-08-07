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
import { PostgresToolRepositories, PostgresToolBadgeRepository, PostgresToolCategoryRepository } from "../src/storage/postgres/postgresToolRepositories.ts";
import { PostgresToolRatingRepository } from "../src/storage/postgres/postgresToolRatingRepository.ts";
import { ToolService } from "../src/tools/toolService.ts";
import { ToolRatingService } from "../src/tools/toolRatingService.ts";

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
    assert.equal(Number(permissionCount.rows[0].count), 26);
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
    const toolRoot = new PostgresToolRepositories(pool);
    await toolRoot.validateSchema();
    const toolBadges = new PostgresToolBadgeRepository(toolRoot);
    const toolCategories = new PostgresToolCategoryRepository(toolRoot);
    const tools = new ToolService(toolRoot, toolBadges, toolCategories, badgeRepository);
    const toolCategory = await toolCategories.create({ name: "Utilities", slug: "utilities", description: "Useful tools", displayOrder: 1, isActive: true }, user.id);
    const toolBadge = await toolBadges.create({ name: "Verified", slug: "verified", color: "purple", iconKey: "badge-check", displayOrder: 1, isActive: true }, user.id);
    const toolAsset = await badgeRepository.saveAsset({ storageKey: "tenant-a/tools/staging/icons/00000000-0000-4000-8000-000000000006.png", contentType: "image/png", byteSize: 128, width: 48, height: 48, isSquare: true }, user.id);
    const toolDraft = { name: "Staging Tool", slug: "staging-tool", shortDescription: "Staging validation", fullDescription: "PostgreSQL relationship validation", version: "1.0.0", developerName: "Nexus", externalDownloadUrl: "https://example.com/download", downloadTrust: "official" as const, iconAssetId: toolAsset.id, categoryId: toolCategory.id, badgeIds: [toolBadge.id], isFeatured: true, isActive: true, publishedAt: "2026-08-01T00:00:00Z" };
    const createdTool = await tools.create(toolDraft, user.id);
    assert.equal(createdTool.iconAssetId, toolAsset.id);
    assert.equal(createdTool.category?.slug, "utilities");
    assert.equal(createdTool.badges[0]?.slug, "verified");
    const toolSlugRace = await Promise.allSettled([tools.create({ ...toolDraft, slug: "concurrent-tool", name: "Concurrent A" }, user.id), tools.create({ ...toolDraft, slug: "concurrent-tool", name: "Concurrent B" }, user.id)]);
    assert.equal(toolSlugRace.filter(item => item.status === "fulfilled").length, 1);
    assert.ok((await tools.archive(createdTool.id, user.id)).archivedAt);
    assert.equal((await tools.list({ page: 1, pageSize: 20, activeOnly: true, includeArchived: false, sort: "newest" })).items.some(item => item.id === createdTool.id), false);
    const toolIndexes = await pool.query<{ count: string }>("SELECT count(*) FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ('tool_definitions_public_idx','tool_definitions_category_idx','tool_badge_assignments_badge_idx','tool_definitions_icon_asset_idx','tool_definitions_cover_asset_idx')");
    assert.equal(Number(toolIndexes.rows[0].count), 5);
    const ratingRepository = new PostgresToolRatingRepository(pool);
    await ratingRepository.validateSchema();
    const ratings = new ToolRatingService(ratingRepository);
    const secondUser = await authorizationRepository.ensureAuthenticatedUser("76561198000000002", "2026-07-28T12:00:00.000Z");
    const ratingTool = await tools.create({ ...toolDraft, slug: "rating-tool", name: "Rating Tool" }, user.id);
    await ratings.save(ratingTool.id, user.id, { rating: 5 });
    assert.deepEqual(await ratings.summary(ratingTool.id), { average: 5.0, total: 1, distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 1 } });
    await ratings.save(ratingTool.id, user.id, { rating: 4 });
    assert.equal(await ratings.mine(ratingTool.id, user.id), 4);
    await ratings.save(ratingTool.id, secondUser.id, { rating: 2 });
    assert.deepEqual(await ratings.summary(ratingTool.id), { average: 3.0, total: 2, distribution: { "1": 0, "2": 1, "3": 0, "4": 1, "5": 0 } });
    assert.deepEqual((await ratings.summaries([ratingTool.id]))[ratingTool.id], { average: 3.0, total: 2, distribution: { "1": 0, "2": 1, "3": 0, "4": 1, "5": 0 } });
    const concurrentRatings = await Promise.allSettled([
      ratingRepository.upsert(ratingTool.id, user.id, 1),
      ratingRepository.upsert(ratingTool.id, user.id, 5),
      ratingRepository.upsert(ratingTool.id, user.id, 2)
    ]);
    assert.equal(concurrentRatings.every((item) => item.status === "fulfilled"), true);
    assert.equal((await ratings.summary(ratingTool.id)).total, 2);
    assert.ok([1, 2, 5].includes((await ratings.mine(ratingTool.id, user.id)) as number));
    await assert.rejects(() => ratings.save("00000000-0000-4000-8000-000000000000", user.id, { rating: 3 }), /TOOL_NOT_FOUND/);
    await tools.archive(ratingTool.id, user.id);
    await assert.rejects(() => ratings.save(ratingTool.id, secondUser.id, { rating: 4 }), /TOOL_ARCHIVED/);
    assert.equal((await ratings.summary(ratingTool.id)).total, 2);
    await ratings.remove(ratingTool.id, secondUser.id);
    const surviving = await ratings.mine(ratingTool.id, user.id) as number;
    assert.deepEqual(await ratings.summary(ratingTool.id), { average: surviving, total: 1, distribution: { "1": surviving === 1 ? 1 : 0, "2": surviving === 2 ? 1 : 0, "3": surviving === 3 ? 1 : 0, "4": surviving === 4 ? 1 : 0, "5": surviving === 5 ? 1 : 0 } });
    await assert.rejects(() => ratings.remove(ratingTool.id, secondUser.id), /RATING_NOT_FOUND/);
    const ratingAudit = await pool.query<{ action: string; metadata_json: Record<string, unknown> }>(
      "SELECT action, metadata_json FROM audit_events WHERE target_type='tool' AND target_id=$1 AND action LIKE 'tool.rating_%'",
      [ratingTool.id]
    );
    assert.deepEqual(ratingAudit.rows.map((row) => row.action).sort(), ["tool.rating_created", "tool.rating_created", "tool.rating_denied", "tool.rating_denied", "tool.rating_removed", "tool.rating_updated"].sort());
    for (const row of ratingAudit.rows) assert.doesNotMatch(JSON.stringify(row.metadata_json), /steam|account|token|secret|session/i);
    assert.equal((await pool.query<{ count: string }>("SELECT count(*) FROM tool_ratings WHERE user_id=$1", [secondUser.id])).rows[0].count, "0");
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
