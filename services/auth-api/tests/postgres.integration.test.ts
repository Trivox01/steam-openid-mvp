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
import { PostgresToolReviewRepository } from "../src/storage/postgres/postgresToolReviewRepository.ts";
import { PostgresToolReviewReportRepository } from "../src/storage/postgres/postgresToolReviewReportRepository.ts";
import { PostgresToolReviewHelpfulRepository } from "../src/storage/postgres/postgresToolReviewHelpfulRepository.ts";
import { PostgresToolReviewDeveloperReplyRepository } from "../src/storage/postgres/postgresToolReviewDeveloperReplyRepository.ts";
import { ToolService } from "../src/tools/toolService.ts";
import { ToolRatingService } from "../src/tools/toolRatingService.ts";
import { ToolReviewService, ToolReviewModerationService, ToolReviewInteractionService } from "../src/tools/toolReviewService.ts";

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
    assert.equal(Number(permissionCount.rows[0].count), 32);
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
    const reviewRepository = new PostgresToolReviewRepository(pool);
    await reviewRepository.validateSchema();
    const reportRepository = new PostgresToolReviewReportRepository(pool);
    await reportRepository.validateSchema();
    const reviews = new ToolReviewService(reviewRepository, reportRepository);
    const moderation = new ToolReviewModerationService(reviewRepository, reportRepository);
    const reviewTool = await tools.create({ ...toolDraft, slug: "review-tool", name: "Review Tool" }, user.id);
    const createdReview = await reviews.save(reviewTool.id, user.id, { title: "Great", body: "Works well" });
    assert.equal(createdReview.created, true);
    assert.equal((await reviews.save(reviewTool.id, user.id, { title: "Great", body: "Works well" })).created, false);
    await reviews.save(reviewTool.id, user.id, { body: "Updated body" });
    let reviewView = await reviews.list(reviewTool.id, { page: 1, pageSize: 20, sort: "newest" });
    assert.equal(reviewView.total, 1);
    assert.equal(reviewView.items[0].body, "Updated body");
    assert.equal(reviewView.items[0].edited, true);
    assert.equal(reviewView.items[0].rating, null);
    await ratings.save(reviewTool.id, user.id, { rating: 4 });
    reviewView = await reviews.list(reviewTool.id, { page: 1, pageSize: 20, sort: "newest" });
    assert.equal(reviewView.items[0].rating, 4);
    assert.equal(reviewView.items[0].title, undefined);
    const concurrentReviews = await Promise.allSettled([
      reviewRepository.save(reviewTool.id, secondUser.id, { body: "Concurrent A" }),
      reviewRepository.save(reviewTool.id, secondUser.id, { body: "Concurrent B" }),
      reviewRepository.save(reviewTool.id, secondUser.id, { body: "Concurrent C" })
    ]);
    assert.equal(concurrentReviews.every((item) => item.status === "fulfilled"), true);
    assert.equal((await reviews.list(reviewTool.id, { page: 1, pageSize: 20, sort: "newest" })).total, 2);
    assert.equal((await reviews.list(reviewTool.id, { page: 1, pageSize: 20, sort: "highest_rating" })).items[0].rating, 4);
    const report = await reviews.report(createdReview.review.id, secondUser.id, { reason: "spam" });
    assert.equal(report.report.status, "open");
    await assert.rejects(() => reviews.report(createdReview.review.id, secondUser.id, { reason: "spam" }), /REVIEW_ALREADY_REPORTED/);
    await assert.rejects(() => reviews.report(createdReview.review.id, user.id, { reason: "spam" }), /REVIEW_SELF_REPORT_DENIED/);
    assert.equal((await moderation.listReports({ status: "open", page: 1, pageSize: 20 })).total, 1);
    const openReports = await moderation.listReports({ page: 1, pageSize: 20 });
    assert.equal(openReports.items[0].review.body, "Updated body");
    assert.equal(openReports.items[0].tool.slug, "review-tool");
    assert.equal(openReports.items[0].review.authorName, "Nexus User");
    await moderation.hideReview(createdReview.review.id, user.id, { reason: "off topic" });
    assert.equal((await reviewRepository.getById(createdReview.review.id))?.status, "hidden");
    assert.equal((await reviewRepository.getById(createdReview.review.id))?.moderationReason, "off topic");
    await moderation.restoreReview(createdReview.review.id, user.id);
    assert.equal((await reviewRepository.getById(createdReview.review.id))?.status, "active");
    await moderation.resolveReport(report.report.id, user.id);
    assert.equal((await moderation.listReports({ status: "resolved", page: 1, pageSize: 20 })).total, 1);
    await moderation.dismissReport(report.report.id, user.id);
    assert.equal((await moderation.listReports({ status: "resolved", page: 1, pageSize: 20 })).total, 1);
    assert.equal((await moderation.listReports({ status: "dismissed", page: 1, pageSize: 20 })).total, 0);
    await moderation.removeReview(createdReview.review.id, user.id, {});
    assert.equal((await reviewRepository.getById(createdReview.review.id))?.status, "removed");
    await assert.rejects(() => reviews.save(reviewTool.id, user.id, { body: "nope" }), /REVIEW_NOT_EDITABLE/);
    assert.equal((await reviews.list(reviewTool.id, { page: 1, pageSize: 20, sort: "newest" })).total, 1);
    const reviewAudit = await pool.query<{ action: string; metadata_json: Record<string, unknown> }>(
      "SELECT action, metadata_json FROM audit_events WHERE target_type='tool' AND target_id=$1 AND actor_user_id=$2 AND action LIKE 'tool.review_%'",
      [reviewTool.id, user.id]
    );
    assert.deepEqual(reviewAudit.rows.map((row) => row.action).sort(), ["tool.review_created", "tool.review_denied", "tool.review_hidden", "tool.review_moderated_removed", "tool.review_restored", "tool.review_updated", "tool.review_updated"].sort());
    for (const row of reviewAudit.rows) assert.doesNotMatch(JSON.stringify(row.metadata_json), /steam|account|token|secret|session|off topic|body|title/i);
    const reportAudit = await pool.query<{ action: string; metadata_json: Record<string, unknown> }>(
      "SELECT action, metadata_json FROM audit_events WHERE target_type='tool_review_report' ORDER BY id"
    );
    assert.deepEqual(reportAudit.rows.map((row) => row.action).sort(), ["tool.review_reported", "tool.review_report_resolved"].sort());
    assert.deepEqual(reportAudit.rows[0].metadata_json, { reportId: report.report.id, reason: "spam" });
    for (const row of reportAudit.rows) assert.doesNotMatch(JSON.stringify(row.metadata_json), /steam|account|token|secret|session/i);
    await assert.rejects(() => reviews.save("00000000-0000-4000-8000-000000000000", user.id, { body: "x" }), /TOOL_NOT_FOUND/);
    const adminReported = await moderation.listReviews({ page: 1, pageSize: 20, reportedOnly: true });
    assert.equal(adminReported.total, 1);
    assert.equal(adminReported.items[0].reportsCount, 1);
    assert.equal(adminReported.items[0].status, "removed");
    assert.equal(adminReported.items[0].tool.slug, "review-tool");
    assert.equal(adminReported.items[0].rating, 4);
    assert.equal(adminReported.items[0].displayName, "Nexus User");
    const adminActive = await moderation.listReviews({ page: 1, pageSize: 20, status: "active" });
    assert.equal(adminActive.total, 1);
    assert.equal(adminActive.items[0].reportsCount, 0);
    const adminRemoved = await moderation.listReviews({ page: 1, pageSize: 20, status: "removed" });
    assert.equal(adminRemoved.total, 1);
    assert.equal(adminRemoved.items[0].reportsCount, 1);
    const helpfulRepository = new PostgresToolReviewHelpfulRepository(pool);
    await helpfulRepository.validateSchema();
    const replyRepository = new PostgresToolReviewDeveloperReplyRepository(pool);
    await replyRepository.validateSchema();
    const interactions = new ToolReviewInteractionService(reviewRepository, helpfulRepository, replyRepository);
    const thirdUser = await authorizationRepository.ensureAuthenticatedUser("76561198000000003", "2026-07-28T12:00:00.000Z");
    const interactionTool = await tools.create({ ...toolDraft, slug: "interaction-tool", name: "Interaction Tool" }, user.id);
    const discussion = await reviews.save(interactionTool.id, user.id, { body: "Discussion starter" });
    assert.deepEqual((await interactions.addHelpful(discussion.review.id, thirdUser.id)), { helpfulCount: 1, currentUserHelpful: true });
    await interactions.addHelpful(discussion.review.id, secondUser.id);
    assert.equal((await interactions.addHelpful(discussion.review.id, thirdUser.id)).helpfulCount, 2);
    const likedView = await reviews.list(interactionTool.id, { page: 1, pageSize: 20, sort: "newest" }, thirdUser.id);
    assert.equal(likedView.items[0].helpfulCount, 2);
    assert.equal(likedView.items[0].currentUserHelpful, true);
    assert.equal((await reviews.list(interactionTool.id, { page: 1, pageSize: 20, sort: "newest" })).items[0].currentUserHelpful, undefined);
    await assert.rejects(() => interactions.addHelpful(discussion.review.id, user.id), /CANNOT_VOTE_OWN_REVIEW/);
    assert.deepEqual(await interactions.removeHelpful(discussion.review.id, thirdUser.id), { helpfulCount: 1, currentUserHelpful: false });
    const reply = await interactions.saveReply(discussion.review.id, user.id, { body: "Thanks for the feedback" });
    assert.equal(reply.authorLabel, "Developer");
    assert.equal(reply.edited, false);
    assert.equal((await interactions.saveReply(discussion.review.id, user.id, { body: "Updated acknowledgment" })).edited, true);
    const repliedView = await reviews.list(interactionTool.id, { page: 1, pageSize: 20, sort: "newest" }, thirdUser.id);
    assert.equal(repliedView.items[0].developerReply?.body, "Updated acknowledgment");
    const removedReply = await interactions.removeReply(discussion.review.id, user.id);
    assert.equal(removedReply.body, "Updated acknowledgment");
    assert.equal((await reviews.list(interactionTool.id, { page: 1, pageSize: 20, sort: "newest" }, thirdUser.id)).items[0].developerReply, undefined);
    await assert.rejects(() => interactions.removeReply(discussion.review.id, user.id), /REPLY_NOT_FOUND/);
    const interactionAudit = await pool.query<{ action: string; metadata_json: Record<string, unknown> }>(
      "SELECT action, metadata_json FROM audit_events WHERE target_type='tool_review' AND metadata_json ->> 'reviewId'=$1 ORDER BY action",
      [discussion.review.id]
    );
    assert.deepEqual(interactionAudit.rows.map((row) => row.action).sort(), ["tool.review_developer_reply_created", "tool.review_developer_reply_denied", "tool.review_developer_reply_removed", "tool.review_developer_reply_updated", "tool.review_helpful_added", "tool.review_helpful_added", "tool.review_helpful_denied", "tool.review_helpful_removed"].sort());
    for (const row of interactionAudit.rows) assert.doesNotMatch(JSON.stringify(row.metadata_json), /steam|account|token|session|secret/i);
    await tools.archive(reviewTool.id, user.id);
    await assert.rejects(() => reviews.save(reviewTool.id, user.id, { body: "y" }), /TOOL_ARCHIVED/);
    assert.equal((await reviews.list(reviewTool.id, { page: 1, pageSize: 20, sort: "newest" })).total, 1);
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
