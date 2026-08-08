import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { AuthApiConfig } from "../src/config.ts";
import { createRouter } from "../src/router.ts";
import { AuthTransactionService } from "../src/auth/authTransactionService.ts";
import { InMemoryAuthTransactionRepository } from "../src/storage/authRepository.ts";
import { SteamOpenIdVerifier } from "../src/steam/openIdVerifier.ts";
import { PollingRateLimiter } from "../src/security/pollingRateLimiter.ts";
import { noOpLogger } from "../src/security/safeLogger.ts";
import { InMemoryAuthorizationRepository } from "../src/authorization/authorizationRepository.ts";
import { AuthorizationService } from "../src/authorization/authorizationService.ts";
import { SessionTokenService } from "../src/authorization/sessionTokenService.ts";
import { InMemoryBadgeRepository } from "../src/badges/badgeRepository.ts";
import { BadgeService } from "../src/badges/badgeService.ts";
import { MemoryBadgeAssetStorage } from "../src/badges/badgeAssetStorage.ts";
import { InMemoryToolBadgeRepository } from "../src/tools/toolBadgeRepository.ts";
import { InMemoryToolCategoryRepository } from "../src/tools/toolCategoryRepository.ts";
import { InMemoryToolRepository } from "../src/tools/toolRepository.ts";
import { ToolService } from "../src/tools/toolService.ts";
import { InMemoryToolRatingRepository } from "../src/tools/toolRatingRepository.ts";
import { ToolRatingService } from "../src/tools/toolRatingService.ts";
import { InMemoryToolReviewRepository } from "../src/tools/toolReviewRepository.ts";
import { InMemoryToolReviewReportRepository } from "../src/tools/toolReviewReportRepository.ts";
import { InMemoryToolReviewHelpfulRepository } from "../src/tools/toolReviewHelpfulRepository.ts";
import { InMemoryToolReviewDeveloperReplyRepository } from "../src/tools/toolReviewDeveloperReplyRepository.ts";
import { InMemoryToolAnalyticsRepository } from "../src/tools/toolAnalyticsRepository.ts";
import { InMemoryToolFavoriteRepository } from "../src/tools/toolFavoriteRepository.ts";
import { ToolAnalyticsService } from "../src/tools/toolAnalyticsService.ts";
import { ToolReviewService, ToolReviewModerationService, ToolReviewInteractionService } from "../src/tools/toolReviewService.ts";
import { ToolError } from "../src/tools/contracts.ts";

function setup(authorization?: InMemoryAuthorizationRepository) {
  const badges = new InMemoryToolBadgeRepository();
  const categories = new InMemoryToolCategoryRepository();
  const repository = new InMemoryToolRepository(badges, categories);
  const service = new ToolService(repository, badges, categories);
  const ratingRepository = new InMemoryToolRatingRepository(repository);
  const ratings = new ToolRatingService(ratingRepository);
  const authorizationRepository = authorization ?? new InMemoryAuthorizationRepository();
  const reviewUsers = {
    displayName: async (userId: string) =>
      (await authorizationRepository.findUserById(userId)) ? `User ${userId.slice(0, 8)}` : undefined,
    avatarUrl: async () => undefined
  };
  const reviewRepository = new InMemoryToolReviewRepository(repository, reviewUsers, ratingRepository);
  const reportRepository = new InMemoryToolReviewReportRepository(repository, reviewRepository, reviewUsers);
  const helpfulRepository = new InMemoryToolReviewHelpfulRepository();
  const replyRepository = new InMemoryToolReviewDeveloperReplyRepository();
  reviewRepository.attachReportSource(reportRepository);
  reviewRepository.attachHelpfulSource(helpfulRepository);
  reviewRepository.attachReplySource(replyRepository);
  const reviews = new ToolReviewService(reviewRepository, reportRepository);
  const moderation = new ToolReviewModerationService(reviewRepository, reportRepository);
  const interactions = new ToolReviewInteractionService(reviewRepository, helpfulRepository, replyRepository);
  return {
    badges, categories, repository, service, ratings, ratingRepository,
    reviewRepository, reportRepository, helpfulRepository, replyRepository,
    reviews, moderation, interactions, authorizationRepository
  };
}

const draft = { name: "Nexus Helper", slug: "nexus-helper", shortDescription: "A helpful companion", fullDescription: "Plain text description", version: "1.0.0", developerName: "Nexus", externalDownloadUrl: "https://downloads.example.com/tool", downloadTrust: "external" as const, badgeIds: [], isFeatured: false, isActive: true, publishedAt: "2026-08-01T00:00:00Z" };

test("create, update and remove own review keeps the review unique per user", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  const first = await x.reviews.save(tool.id, "user-1", { title: "Love it", body: "It just works" });
  assert.equal(first.created, true);
  assert.equal(first.review.status, "active");
  assert.equal((await x.reviewRepository.getMine(tool.id, "user-1"))?.body, "It just works");
  const second = await x.reviews.save(tool.id, "user-1", { title: "Love it", body: "Still works" });
  assert.equal(second.created, false);
  assert.equal(second.review.id, first.review.id);
  assert.equal((await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "newest" })).total, 1);
  await x.reviews.remove(tool.id, "user-1");
  assert.equal((await x.reviewRepository.getMine(tool.id, "user-1"))?.status, "removed");
  const repeated = await x.reviews.remove(tool.id, "user-1").then(() => "ok", () => "threw");
  assert.equal(repeated, "ok");
  await assert.rejects(() => x.reviews.remove(tool.id, "never-wrote"), (error: unknown) => error instanceof ToolError && error.code === "REVIEW_NOT_FOUND");
});

test("removed reviews can be rewritten and reactivated only when never moderated", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  await x.reviews.save(tool.id, "user-1", { body: "original" });
  await x.reviews.remove(tool.id, "user-1");
  const restored = await x.reviews.save(tool.id, "user-1", { body: "rewritten" });
  assert.equal(restored.created, false);
  assert.equal(restored.review.status, "active");
  await x.moderation.hideReview(restored.review.id, "moderator", { reason: "spam" });
  await assert.rejects(() => x.reviews.save(tool.id, "user-1", { body: "nope" }), (error: unknown) => error instanceof ToolError && error.code === "REVIEW_NOT_EDITABLE");
});

test("draft validation enforces lengths", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  const rejects = (value: unknown, code: string) =>
    () => assert.rejects(() => x.reviews.save(tool.id, "user-1", value), (error: unknown) => error instanceof ToolError && error.code === code);
  await rejects({ body: "  " }, "REVIEW_BODY_REQUIRED");
  await rejects({}, "REVIEW_BODY_REQUIRED");
  await rejects("text", "REVIEW_BODY_REQUIRED");
  await rejects({ body: "x".repeat(2501) }, "REVIEW_BODY_TOO_LONG");
  await rejects({ body: "ok", title: "t".repeat(101) }, "REVIEW_TITLE_TOO_LONG");
});

test("public list exposes edited flag, display name and live rating from tool_ratings", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  const author = await x.authorizationRepository.ensureAuthenticatedUser("76561198000000011", "2026-08-02T00:00:00.000Z");
  await x.reviews.save(tool.id, author.id, { title: "Great", body: "Fresh review" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await x.reviews.save(tool.id, author.id, { title: "Great", body: "Updated review" });
  await x.ratings.save(tool.id, author.id, { rating: 5 });
  const page = await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "newest" });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].body, "Updated review");
  assert.equal(page.items[0].edited, true);
  assert.equal(page.items[0].displayName, `User ${author.id.slice(0, 8)}`);
  assert.equal(page.items[0].rating, 5);
});

test("sorting and pagination work for newest and rating orders", async () => {
  const x = setup(); const tool = await x.service.create(draft, "tool");
  const users = await Promise.all(["76561198000000021", "76561198000000022", "76561198000000023"].map((steamId64) => x.authorizationRepository.ensureAuthenticatedUser(steamId64, "2026-08-02T00:00:00.000Z")));
  await x.reviews.save(tool.id, users[0].id, { body: "Older" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await x.reviews.save(tool.id, users[1].id, { body: "Middle" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await x.reviews.save(tool.id, users[2].id, { body: "Newest" });
  const expects = ["Newest", "Middle", "Older"];
  const newest = await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "newest" });
  assert.deepEqual(newest.items.map((item) => item.body), expects);
  const paged = await x.reviews.list(tool.id, { page: 2, pageSize: 2, sort: "newest" });
  assert.equal(paged.items.length, 1);
  assert.equal(paged.total, 3);
  assert.equal(paged.page, 2);
  await x.ratings.save(tool.id, users[1].id, { rating: 5 });
  await x.ratings.save(tool.id, users[0].id, { rating: 1 });
  const highest = await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "highest_rating" });
  assert.equal(highest.items[0].body, "Middle");
  const lowest = await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "lowest_rating" });
  assert.equal(lowest.items[0].body, "Older");
});

test("archived tools reject new reviews but preserve published listings", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  await x.reviews.save(tool.id, "user-1", { body: "kept" });
  await x.service.archive(tool.id, "actor");
  await assert.rejects(() => x.reviews.save(tool.id, "user-2", { body: "blocked" }), (error: unknown) => error instanceof ToolError && error.code === "TOOL_ARCHIVED");
  const page = await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "newest" });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].body, "kept");
});

test("reporting enforces reasons, duplicates, self-report and moderation lifecycle", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  const author = await x.authorizationRepository.ensureAuthenticatedUser("76561198000000031", "2026-08-02T00:00:00.000Z");
  const reporter = await x.authorizationRepository.ensureAuthenticatedUser("76561198000000032", "2026-08-02T00:00:00.000Z");
  const review = await x.reviews.save(tool.id, author.id, { title: "Bad", body: "Offensive content here" });
  await assert.rejects(() => x.reviews.report(review.review.id, author.id, { reason: "spam" }), (error: unknown) => error instanceof ToolError && error.code === "REVIEW_SELF_REPORT_DENIED");
  await assert.rejects(() => x.reviews.report(review.review.id, reporter.id, {}), (error: unknown) => error instanceof ToolError && error.code === "REPORT_REASON_REQUIRED");
  await assert.rejects(() => x.reviews.report(review.review.id, reporter.id, { reason: "made-up" }), (error: unknown) => error instanceof ToolError && error.code === "REPORT_REASON_INVALID");
  await assert.rejects(() => x.reviews.report(review.review.id, reporter.id, { reason: "spam", details: "d".repeat(501) }), (error: unknown) => error instanceof ToolError && error.code === "REPORT_DETAILS_TOO_LONG");
  const reported = await x.reviews.report(review.review.id, reporter.id, { reason: "harassment", details: "keeps insulting" });
  assert.equal(reported.report.status, "open");
  assert.equal(reported.toolId, tool.id);
  await assert.rejects(() => x.reviews.report(review.review.id, reporter.id, { reason: "spam" }), (error: unknown) => error instanceof ToolError && error.code === "REVIEW_ALREADY_REPORTED");
  assert.equal((await x.moderation.listReports({ page: 1, pageSize: 20 })).total, 1);
  const listed = await x.moderation.listReports({ status: "open", page: 1, pageSize: 20 });
  assert.equal(listed.items[0].review.body, "Offensive content here");
  assert.equal(listed.items[0].tool.slug, "nexus-helper");
  assert.equal(listed.items[0].reporterName, `User ${reporter.id.slice(0, 8)}`);
  await x.moderation.resolveReport(reported.report.id, "moderator");
  assert.equal((await x.moderation.listReports({ status: "resolved", page: 1, pageSize: 20 })).total, 1);
  const secondAuthor = await x.authorizationRepository.ensureAuthenticatedUser("76561198000000033", "2026-08-02T00:00:00.000Z");
  const secondReview = await x.reviews.save(tool.id, secondAuthor.id, { body: "Another review" });
  await x.reviews.report(secondReview.review.id, reporter.id, { reason: "other" });
  const dismissedReportId = (await x.moderation.listReports({ status: "open", page: 1, pageSize: 20 })).items[0].id;
  await x.moderation.dismissReport(dismissedReportId, "moderator");
  assert.equal((await x.moderation.listReports({ status: "dismissed", page: 1, pageSize: 20 })).total, 1);
  assert.equal((await x.moderation.listReports({ status: "resolved", page: 1, pageSize: 20 })).total, 1);
  await assert.rejects(() => x.moderation.resolveReport("00000000-0000-4000-8000-000000000000", "moderator"), (error: unknown) => error instanceof ToolError && error.code === "REPORT_NOT_FOUND");
});

test("reporting a missing or hidden review fails with REVIEW_NOT_FOUND", async () => {
  const x = setup();
  await assert.rejects(() => x.reviews.report("00000000-0000-4000-8000-000000000000", "reporter", { reason: "spam" }), (error: unknown) => error instanceof ToolError && error.code === "REVIEW_NOT_FOUND");
});

test("helpful votes are idempotent toggles and surface counts on the list", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  const author = await x.authorizationRepository.ensureAuthenticatedUser("76561198000000041", "2026-08-02T00:00:00.000Z");
  const voter = await x.authorizationRepository.ensureAuthenticatedUser("76561198000000042", "2026-08-02T00:00:00.000Z");
  const other = await x.authorizationRepository.ensureAuthenticatedUser("76561198000000043", "2026-08-02T00:00:00.000Z");
  const review = await x.reviews.save(tool.id, author.id, { body: "Nice tool" });
  assert.deepEqual(await x.interactions.addHelpful(review.review.id, voter.id), { helpfulCount: 1, currentUserHelpful: true });
  assert.equal((await x.interactions.addHelpful(review.review.id, voter.id)).helpfulCount, 1);
  await x.interactions.addHelpful(review.review.id, other.id);
  assert.equal((await x.interactions.addHelpful(review.review.id, voter.id)).helpfulCount, 2);
  assert.deepEqual(await x.interactions.removeHelpful(review.review.id, voter.id), { helpfulCount: 1, currentUserHelpful: false });
  const page = await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "newest" }, voter.id);
  assert.equal(page.items[0].helpfulCount, 1);
  assert.equal(page.items[0].currentUserHelpful, false);
  const pageOther = await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "newest" }, other.id);
  assert.equal(pageOther.items[0].currentUserHelpful, true);
  const pageAnonymous = await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "newest" });
  assert.equal(pageAnonymous.items[0].currentUserHelpful, undefined);
  assert.equal(pageAnonymous.items[0].helpfulCount, 1);
});

test("helpful votes reject self-votes, missing and unavailable reviews", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  const author = await x.authorizationRepository.ensureAuthenticatedUser("76561198000000051", "2026-08-02T00:00:00.000Z");
  const voter = await x.authorizationRepository.ensureAuthenticatedUser("76561198000000052", "2026-08-02T00:00:00.000Z");
  const review = await x.reviews.save(tool.id, author.id, { body: "Hey" });
  await assert.rejects(() => x.interactions.addHelpful(review.review.id, author.id), (error: unknown) => error instanceof ToolError && error.code === "CANNOT_VOTE_OWN_REVIEW");
  await x.interactions.addHelpful(review.review.id, voter.id);
  await x.moderation.hideReview(review.review.id, "moderator", {});
  await assert.rejects(() => x.interactions.addHelpful(review.review.id, voter.id), (error: unknown) => error instanceof ToolError && error.code === "REVIEW_NOT_AVAILABLE");
  assert.equal((await x.interactions.removeHelpful(review.review.id, voter.id)).helpfulCount, 0);
  await assert.rejects(() => x.interactions.addHelpful("00000000-0000-4000-8000-000000000000", voter.id), (error: unknown) => error instanceof ToolError && error.code === "REVIEW_NOT_FOUND");
});

test("developer replies are created, updated, listed and removed as a single row", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  const author = await x.authorizationRepository.ensureAuthenticatedUser("76561198000000061", "2026-08-02T00:00:00.000Z");
  const review = await x.reviews.save(tool.id, author.id, { body: "Hmm" });
  const reply = await x.interactions.saveReply(review.review.id, "developer", { body: "Thanks for the feedback!" });
  assert.equal(reply.body, "Thanks for the feedback!");
  assert.equal(reply.authorLabel, "Developer");
  assert.equal(reply.edited, false);
  const listed = await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "newest" });
  assert.equal(listed.items[0].developerReply?.body, "Thanks for the feedback!");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const updated = await x.interactions.saveReply(review.review.id, "developer", { body: "Updated reply" });
  assert.equal(updated.edited, true);
  assert.equal((await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "newest" })).items[0].developerReply?.body, "Updated reply");
  const removed = await x.interactions.removeReply(review.review.id, "developer");
  assert.equal(removed.body, "Updated reply");
  assert.equal((await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "newest" })).items[0].developerReply, undefined);
  await assert.rejects(() => x.interactions.removeReply(review.review.id, "developer"), (error: unknown) => error instanceof ToolError && error.code === "REPLY_NOT_FOUND");
});

test("developer replies validate drafts and only target available reviews", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  const author = await x.authorizationRepository.ensureAuthenticatedUser("76561198000000071", "2026-08-02T00:00:00.000Z");
  const review = await x.reviews.save(tool.id, author.id, { body: "Could be better" });
  await assert.rejects(() => x.interactions.saveReply(review.review.id, "developer", {}), (error: unknown) => error instanceof ToolError && error.code === "REPLY_BODY_REQUIRED");
  await assert.rejects(() => x.interactions.saveReply(review.review.id, "developer", { body: "  " }), (error: unknown) => error instanceof ToolError && error.code === "REPLY_BODY_REQUIRED");
  await assert.rejects(() => x.interactions.saveReply(review.review.id, "developer", { body: "x".repeat(2001) }), (error: unknown) => error instanceof ToolError && error.code === "REPLY_BODY_TOO_LONG");
  await x.moderation.hideReview(review.review.id, "moderator", {});
  await assert.rejects(() => x.interactions.saveReply(review.review.id, "developer", { body: "nope" }), (error: unknown) => error instanceof ToolError && error.code === "REVIEW_NOT_AVAILABLE");
  await assert.rejects(() => x.interactions.saveReply("00000000-0000-4000-8000-000000000000", "developer", { body: "nope" }), (error: unknown) => error instanceof ToolError && error.code === "REVIEW_NOT_FOUND");
});

test("interaction audit events are sanitised and reject noisy identifiers", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  const author = await x.authorizationRepository.ensureAuthenticatedUser("76561198000000081", "2026-08-02T00:00:00.000Z");
  const voter = await x.authorizationRepository.ensureAuthenticatedUser("76561198000000082", "2026-08-02T00:00:00.000Z");
  const review = await x.reviews.save(tool.id, author.id, { body: "Secret body text" });
  await x.interactions.addHelpful(review.review.id, author.id).catch(() => {});
  await x.interactions.addHelpful(review.review.id, voter.id);
  await x.interactions.removeHelpful(review.review.id, voter.id);
  const setBirthday = "76561198000000083";
  const replier = await x.authorizationRepository.ensureAuthenticatedUser(setBirthday, "2026-08-02T00:00:00.000Z");
  await x.interactions.saveReply(review.review.id, replier.id, { body: "Thanks for the note" });
  await x.interactions.saveReply(review.review.id, replier.id, { body: "Thank you again" });
  await x.interactions.removeReply(review.review.id, replier.id);
  const helpfulEvents = x.helpfulRepository.auditEvents;
  assert.deepEqual(helpfulEvents.map((event) => event.action).sort(), ["tool.review_helpful_added", "tool.review_helpful_denied", "tool.review_helpful_removed"]);
  const replyEvents = x.replyRepository.auditEvents;
  assert.deepEqual(replyEvents.map((event) => event.action).sort(), ["tool.review_developer_reply_created", "tool.review_developer_reply_removed", "tool.review_developer_reply_updated"]);
  for (const event of [...helpfulEvents, ...replyEvents]) {
    assert.doesNotMatch(JSON.stringify(event), /steam|account|token|secret|session|Secret body|Thanks for|setBirthday|76561/i);
  }
});

test("moderation hide, restore and remove records update status and keep review data", async () => {
  const x = setup(); const tool = await x.service.create(draft, "tool");
  const review = await x.reviews.save(tool.id, "user-1", { title: "T", body: "body" });
  const hidden = await x.moderation.hideReview(review.review.id, "moderator", { reason: "not constructive" });
  assert.equal(hidden.status, "hidden");
  assert.equal(hidden.moderatedBy, "moderator");
  assert.equal(hidden.moderationReason, "not constructive");
  assert.equal((await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "newest" })).total, 0);
  const restored = await x.moderation.restoreReview(review.review.id, "moderator");
  assert.equal(restored.status, "active");
  assert.equal(restored.moderatedBy, undefined);
  assert.equal((await x.reviews.list(tool.id, { page: 1, pageSize: 20, sort: "newest" })).total, 1);
  const removed = await x.moderation.removeReview(review.review.id, "moderator", {});
  assert.equal(removed.status, "removed");
  await assert.rejects(() => x.moderation.hideReview("00000000-0000-4000-8000-000000000000", "moderator", {}), (error: unknown) => error instanceof ToolError && error.code === "REVIEW_NOT_FOUND");
});

test("admin review list filters by status and reported only with reports counts", async () => {
  const x = setup(); const tool = await x.service.create(draft, "tool");
  const users = await Promise.all(["76561198000000031", "76561198000000032", "76561198000000033"].map((steamId64) => x.authorizationRepository.ensureAuthenticatedUser(steamId64, "2026-08-02T00:00:00.000Z")));
  await x.reviews.save(tool.id, users[0].id, { title: "First", body: "Opening shot" });
  const second = await x.reviews.save(tool.id, users[1].id, { body: "Middle comment" });
  await x.ratings.save(tool.id, users[1].id, { rating: 4 });
  const third = await x.reviews.save(tool.id, users[2].id, { body: "Closing note" });
  await x.reviews.report(second.review.id, users[2].id, { reason: "spam" });
  await x.reviews.report(second.review.id, users[0].id, { reason: "harassment" });
  const all = await x.moderation.listReviews({ page: 1, pageSize: 20 });
  assert.equal(all.total, 3);
  assert.deepEqual(all.items.map((item) => item.body).sort(), ["Closing note", "Middle comment", "Opening shot"]);
  const reportedOnly = await x.moderation.listReviews({ page: 1, pageSize: 20, reportedOnly: true });
  assert.equal(reportedOnly.total, 1);
  assert.equal(reportedOnly.items[0].reportsCount, 2);
  assert.equal(reportedOnly.items[0].rating, 4);
  assert.equal(reportedOnly.items[0].tool.slug, "nexus-helper");
  assert.equal(reportedOnly.items[0].displayName, `User ${users[1].id.slice(0, 8)}`);
  await x.moderation.hideReview(third.review.id, "moderator", {});
  const hidden = await x.moderation.listReviews({ page: 1, pageSize: 20, status: "hidden" });
  assert.equal(hidden.total, 1);
  assert.equal(hidden.items[0].body, "Closing note");
  const active = await x.moderation.listReviews({ page: 1, pageSize: 20, status: "active" });
  assert.equal(active.total, 2);
  assert.deepEqual(active.items.map((item) => item.reportsCount).sort((a, b) => a - b), [0, 2]);
});

test("audit events record lifecycle without free text or account identifiers", async () => {
  const x = setup(); const tool = await x.service.create(draft, "tool");
  await x.reviews.save(tool.id, "user-1", { title: "Great", body: "Superb" });
  await x.reviews.save(tool.id, "user-1", { body: "Superb edit" });
  await x.moderation.hideReview((await x.reviewRepository.getMine(tool.id, "user-1"))!.id, "moderator", { reason: "off topic" });
  await x.moderation.restoreReview((await x.reviewRepository.getMine(tool.id, "user-1"))!.id, "moderator");
  await x.reviews.remove(tool.id, "user-1");
  await x.reviews.remove(tool.id, "missing-user").catch(() => {});
  const reviewEvents = x.reviewRepository.auditEvents;
  assert.deepEqual(reviewEvents.map((event) => event.action).sort(), ["tool.review_created", "tool.review_denied", "tool.review_hidden", "tool.review_removed", "tool.review_restored", "tool.review_updated"]);
  for (const event of reviewEvents) assert.doesNotMatch(JSON.stringify(event), /steam|account|token|secret|session|Superb|Great|off topic/i);
});

test("routes expose public listing and guard mutations with authentication and permissions", async () => {
  const harness = await startReviewHarness();
  try {
    const anonymous = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews`);
    assert.equal(anonymous.status, 200);
    const page = await anonymous.json() as { total: number; items: Array<{ displayName: string }> };
    assert.equal(page.total, 1);
    assert.equal(page.items[0].displayName, "Nexus User");
    const anonymousMine = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-review`);
    assert.equal(anonymousMine.status, 401);
    assert.equal((await anonymousMine.json() as { error: string }).error, "UNAUTHENTICATED");
    const forbidden = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-review`, {
      method: "PUT", headers: { authorization: `Bearer ${harness.blockedSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ body: "blocked" })
    });
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json() as { error: string }).error, "FORBIDDEN");
  } finally { await harness.close(); }
});

test("authenticated users create, update, remove and report reviews through the routes", async () => {
  const harness = await startReviewHarness();
  try {
    const existing = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-review`, { headers: { authorization: `Bearer ${harness.ownerSession.token}` } });
    assert.equal(existing.status, 200);
    assert.equal((await existing.json() as { review: { body: string } }).review.body, "First review");
    const put = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-review`, {
      method: "PUT", headers: { authorization: `Bearer ${harness.ownerSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Review title", body: "Detailed review body" })
    });
    assert.equal(put.status, 200);
    const created = await put.json() as { review: { id: string; status: string } };
    assert.equal(created.review.status, "active");
    const report = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews/${created.review.id}/report`, {
      method: "POST", headers: { authorization: `Bearer ${harness.guestSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ reason: "misleading" })
    });
    assert.equal(report.status, 201);
    assert.equal((await report.json() as { report: { status: string } }).report.status, "open");
    const removed = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-review`, {
      method: "DELETE", headers: { authorization: `Bearer ${harness.ownerSession.token}` }
    });
    assert.equal(removed.status, 204);
    assert.equal((await (await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews`)).json()).total, 0);
  } finally { await harness.close(); }
});

test("admin review list route enforces moderation permission and exposes counts", async () => {
  const harness = await startReviewHarness();
  try {
    const forbidden = await fetch(`${harness.baseUrl}/api/admin/tool-reviews?page=1&pageSize=20`, { headers: { authorization: `Bearer ${harness.guestSession.token}` } });
    assert.equal(forbidden.status, 403);
    const all = await fetch(`${harness.baseUrl}/api/admin/tool-reviews?page=1&pageSize=20`, { headers: { authorization: `Bearer ${harness.ownerSession.token}` } });
    assert.equal(all.status, 200);
    const allPage = await all.json() as { total: number; items: Array<{ body: string; status: string; reportsCount: number }> };
    assert.equal(allPage.total, 1);
    assert.equal(allPage.items[0].body, "First review");
    assert.equal(allPage.items[0].reportsCount, 0);
    assert.equal((await (await fetch(`${harness.baseUrl}/api/admin/tool-reviews?status=removed`, { headers: { authorization: `Bearer ${harness.ownerSession.token}` } })).json()).total, 0);
    const reviewId = allPage.items[0].body === "First review" ? (await (await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-review`, { headers: { authorization: `Bearer ${harness.ownerSession.token}` } })).json()).review.id : "";
    const report = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews/${reviewId}/report`, {
      method: "POST", headers: { authorization: `Bearer ${harness.guestSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ reason: "spam" })
    });
    assert.equal(report.status, 201);
    const reportedPage = await (await fetch(`${harness.baseUrl}/api/admin/tool-reviews?page=1&pageSize=20&reported=true`, { headers: { authorization: `Bearer ${harness.ownerSession.token}` } })).json() as { total: number; items: Array<{ reportsCount: number }> };
    assert.equal(reportedPage.total, 1);
    assert.equal(reportedPage.items[0].reportsCount, 1);
  } finally { await harness.close(); }
});

test("review mutations are rate limited with a retry-after header", async () => {
  const harness = await startReviewHarness(new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 5 }), undefined);
  try {
    const attempt = () => fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-review`, {
      method: "PUT", headers: { authorization: `Bearer ${harness.ownerSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ body: "rate limited body" })
    });
    let limited = 0;
    for (let index = 0; index < 30; index += 1) {
      const response = await attempt();
      if (response.status === 429) {
        limited += 1;
        assert.ok(Number(response.headers.get("retry-after")) > 0);
        assert.equal((await response.json() as { error: string }).error, "RATING_RATE_LIMITED");
        break;
      }
    }
    assert.ok(limited > 0);
  } finally { await harness.close(); }
});

test("helpful vote routes toggle counts and enforce authentication and permissions", async () => {
  const harness = await startReviewHarness();
  try {
    const mine = await (await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-review`, { headers: { authorization: `Bearer ${harness.ownerSession.token}` } })).json() as { review: { id: string; userId: string } };
    const reviewId = mine.review.id;
    const anonymous = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews/${reviewId}/helpful`, { method: "PUT" });
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json() as { error: string }).error, "UNAUTHENTICATED");
    const selfVote = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews/${reviewId}/helpful`, { method: "PUT", headers: { authorization: `Bearer ${harness.ownerSession.token}` } });
    assert.equal(selfVote.status, 403);
    assert.equal((await selfVote.json() as { error: string }).error, "CANNOT_VOTE_OWN_REVIEW");
    const blockedVote = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews/${reviewId}/helpful`, { method: "PUT", headers: { authorization: `Bearer ${harness.blockedSession.token}` } });
    assert.equal(blockedVote.status, 403);
    assert.equal((await blockedVote.json() as { error: string }).error, "FORBIDDEN");
    const vote = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews/${reviewId}/helpful`, { method: "PUT", headers: { authorization: `Bearer ${harness.guestSession.token}` } });
    assert.equal(vote.status, 200);
    assert.deepEqual(await vote.json(), { helpfulCount: 1, currentUserHelpful: true });
    const repeat = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews/${reviewId}/helpful`, { method: "PUT", headers: { authorization: `Bearer ${harness.guestSession.token}` } });
    assert.equal((await repeat.json() as { helpfulCount: number }).helpfulCount, 1);
    const listing = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews?page=1&pageSize=10`, { headers: { authorization: `Bearer ${harness.guestSession.token}` } });
    const page = await listing.json() as { items: Array<{ helpfulCount: number; currentUserHelpful: boolean }> };
    assert.equal(page.items[0].helpfulCount, 1);
    assert.equal(page.items[0].currentUserHelpful, true);
    const removed = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews/${reviewId}/helpful`, { method: "DELETE", headers: { authorization: `Bearer ${harness.guestSession.token}` } });
    assert.deepEqual(await removed.json(), { helpfulCount: 0, currentUserHelpful: false });
    const missing = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews/00000000-0000-4000-8000-000000000000/helpful`, { method: "PUT", headers: { authorization: `Bearer ${harness.guestSession.token}` } });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json() as { error: string }).error, "REVIEW_NOT_FOUND");
  } finally { await harness.close(); }
});

test("developer reply routes require reply permission and manage a single reply", async () => {
  const harness = await startReviewHarness();
  try {
    const mine = await (await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-review`, { headers: { authorization: `Bearer ${harness.ownerSession.token}` } })).json() as { review: { id: string } };
    const reviewId = mine.review.id;
    const forbiddenGuest = await fetch(`${harness.baseUrl}/api/admin/tool-reviews/${reviewId}/reply`, { method: "PUT", headers: { authorization: `Bearer ${harness.guestSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ body: "no thanks" }) });
    assert.equal(forbiddenGuest.status, 403);
    assert.equal((await forbiddenGuest.json() as { error: string }).error, "FORBIDDEN");
    const created = await fetch(`${harness.baseUrl}/api/admin/tool-reviews/${reviewId}/reply`, { method: "PUT", headers: { authorization: `Bearer ${harness.ownerSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ body: "Thanks for the review!" }) });
    assert.equal(created.status, 200);
    assert.equal((await created.json() as { reply: { body: string; authorLabel: string } }).reply.body, "Thanks for the review!");
    const updated = await fetch(`${harness.baseUrl}/api/admin/tool-reviews/${reviewId}/reply`, { method: "PUT", headers: { authorization: `Bearer ${harness.ownerSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ body: "Glad you like it" }) });
    assert.equal((await updated.json() as { reply: { body: string; edited: boolean } }).reply.edited, true);
    const listing = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews?page=1&pageSize=10`, { headers: { authorization: `Bearer ${harness.guestSession.token}` } });
    const page = await listing.json() as { items: Array<{ developerReply?: { body: string } }> };
    assert.equal(page.items[0].developerReply?.body, "Glad you like it");
    const removed = await fetch(`${harness.baseUrl}/api/admin/tool-reviews/${reviewId}/reply`, { method: "DELETE", headers: { authorization: `Bearer ${harness.ownerSession.token}` } });
    assert.equal(removed.status, 200);
    const afterList = await (await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews?page=1&pageSize=10`, { headers: { authorization: `Bearer ${harness.guestSession.token}` } })).json() as { items: Array<{ developerReply?: unknown }> };
    assert.equal(afterList.items[0].developerReply, undefined);
    const bodyInvalid = await fetch(`${harness.baseUrl}/api/admin/tool-reviews/${reviewId}/reply`, { method: "PUT", headers: { authorization: `Bearer ${harness.ownerSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ body: "x".repeat(2001) }) });
    assert.equal(bodyInvalid.status, 400);
    assert.equal((await bodyInvalid.json() as { error: string }).error, "REPLY_BODY_TOO_LONG");
  } finally { await harness.close(); }
});

test("moderation administration routes expose reports and moderate reviews", async () => {
  const harness = await startReviewHarness();
  try {
    const review = await (await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-review`, {
      method: "PUT", headers: { authorization: `Bearer ${harness.ownerSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ body: "sus" })
    })).json() as { review: { id: string } };
    await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/reviews/${review.review.id}/report`, {
      method: "POST", headers: { authorization: `Bearer ${harness.guestSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ reason: "spam" })
    });
    const reports = await fetch(`${harness.baseUrl}/api/admin/tool-review-reports?status=open`, { headers: { authorization: `Bearer ${harness.ownerSession.token}` } });
    assert.equal(reports.status, 200);
    const body = await reports.json() as { total: number; items: Array<{ id: string }> };
    assert.equal(body.total, 1);
    const reportId = body.items[0].id;
    const hidden = await fetch(`${harness.baseUrl}/api/admin/tool-reviews/${review.review.id}/hide`, {
      method: "POST", headers: { authorization: `Bearer ${harness.ownerSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ reason: "guidelines" })
    });
    assert.equal(hidden.status, 200);
    assert.equal((await hidden.json() as { status: string }).status, "hidden");
    const restored = await fetch(`${harness.baseUrl}/api/admin/tool-reviews/${review.review.id}/restore`, {
      method: "POST", headers: { authorization: `Bearer ${harness.ownerSession.token}` }, body: JSON.stringify({})
    });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json() as { status: string }).status, "active");
    const resolved = await fetch(`${harness.baseUrl}/api/admin/tool-review-reports/${reportId}/resolve`, {
      method: "POST", headers: { authorization: `Bearer ${harness.ownerSession.token}` }, body: JSON.stringify({})
    });
    assert.equal(resolved.status, 200);
    assert.equal((await resolved.json() as { status: string }).status, "resolved");
    const forbiddenGuest = await fetch(`${harness.baseUrl}/api/admin/tool-review-reports`, { headers: { authorization: `Bearer ${harness.guestSession.token}` } });
    assert.equal(forbiddenGuest.status, 403);
  } finally { await harness.close(); }
});

test("invalid review drafts map to stable errors", async () => {
  const harness = await startReviewHarness();
  try {
    const long = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-review`, {
      method: "PUT", headers: { authorization: `Bearer ${harness.ownerSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ body: "x".repeat(2600) })
    });
    assert.equal(long.status, 400);
    assert.equal((await long.json() as { error: string }).error, "REVIEW_BODY_TOO_LONG");
    const unknownTool = await fetch(`${harness.baseUrl}/api/tools/00000000-0000-4000-8000-000000000000/reviews`);
    assert.equal(unknownTool.status, 404);
    assert.equal((await unknownTool.json() as { error: string }).error, "TOOL_NOT_FOUND");
  } finally { await harness.close(); }
});

async function startReviewHarness(limiter?: PollingRateLimiter, reportLimiter?: PollingRateLimiter) {
  const authorizationRepository = new InMemoryAuthorizationRepository();
  const authorization = new AuthorizationService(authorizationRepository);
  const owner = await authorizationRepository.ensureAuthenticatedUser("76561198000000011", "2026-07-30T12:00:00.000Z");
  const guest = await authorizationRepository.ensureAuthenticatedUser("76561198000000012", "2026-07-30T13:00:00.000Z");
  await authorization.bootstrapOwner(owner.steamId64);
  const sessions = new SessionTokenService("tool-review-test-secret-012345678901", authorizationRepository);
  const ownerSession = await sessions.issueForSteamIdentity(owner.steamId64, "2026-07-30T12:00:00.000Z");
  const guestSession = await sessions.issueForSteamIdentity(guest.steamId64, "2026-07-30T13:00:00.000Z");
  authorizationRepository.overrides.push({ userId: guest.id, permission: "tools.write_review", effect: "deny" });
  authorizationRepository.overrides.push({ userId: owner.id, permission: "tools.report_review", effect: "deny" });
  const blocked = await authorizationRepository.ensureAuthenticatedUser("76561198000000013", "2026-07-30T14:00:00.000Z");
  authorizationRepository.overrides.push({ userId: blocked.id, permission: "tools.write_review", effect: "deny" });
  authorizationRepository.overrides.push({ userId: blocked.id, permission: "tools.vote_review_helpful", effect: "deny" });
  const blockedSession = await sessions.issueForSteamIdentity(blocked.steamId64, "2026-07-30T14:00:00.000Z");
  const badgesRepo = new InMemoryToolBadgeRepository();
  const categories = new InMemoryToolCategoryRepository();
  const repository = new InMemoryToolRepository(badgesRepo, categories);
  const tools = new ToolService(repository, badgesRepo, categories);
  const ratingRepository = new InMemoryToolRatingRepository(repository);
  const ratings = new ToolRatingService(ratingRepository);
  const reviewUsers = {
    displayName: async () => undefined,
    avatarUrl: async () => undefined
  };
  const reviewRepository = new InMemoryToolReviewRepository(repository, reviewUsers, ratingRepository);
  const reportRepository = new InMemoryToolReviewReportRepository(repository, reviewRepository, reviewUsers);
  const helpfulRepository = new InMemoryToolReviewHelpfulRepository();
  const replyRepository = new InMemoryToolReviewDeveloperReplyRepository();
  reviewRepository.attachReportSource(reportRepository);
  reviewRepository.attachHelpfulSource(helpfulRepository);
  reviewRepository.attachReplySource(replyRepository);
  const reviews = new ToolReviewService(reviewRepository, reportRepository);
  const moderation = new ToolReviewModerationService(reviewRepository, reportRepository);
  const interactions = new ToolReviewInteractionService(reviewRepository, helpfulRepository, replyRepository);
  const tool = await tools.create({ ...draft, slug: "review-route-tool", name: "Review Route Tool" }, owner.id);
  await reviews.save(tool.id, owner.id, { title: "First", body: "First review" });
  const config: AuthApiConfig = {
    nodeEnv: "test", port: 8788,
    publicBaseUrl: "https://auth.example.test",
    openIdRealm: "https://auth.example.test/",
    openIdReturnUrl: "https://auth.example.test/v1/auth/steam/callback",
    storageDriver: "memory",
    sessionSecret: "tool-reviews-test-secret-012345678901",
    logLevel: "error", trustProxy: false, allowedOrigins: []
  };
  const server = createServer(createRouter({
    config,
    transactions: new AuthTransactionService(new InMemoryAuthTransactionRepository()),
    verifier: new SteamOpenIdVerifier({ async checkAssertion() { return { ok: true, isValid: true }; } }, { realm: config.openIdRealm }),
    rateLimiter: new PollingRateLimiter(),
    logger: noOpLogger,
    authorization, sessions,
    badges: new BadgeService(new InMemoryBadgeRepository()),
    badgeAssets: new MemoryBadgeAssetStorage(),
    tools,
    toolAssets: { icon: new MemoryBadgeAssetStorage(), cover: new MemoryBadgeAssetStorage(), routed: new MemoryBadgeAssetStorage() },
    toolRatings: ratings,
    toolRatingRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
    toolReviews: reviews,
    toolReviewModeration: moderation,
    toolReviewInteractions: interactions,
    toolReviewRateLimiter: limiter ?? new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
    toolReportRateLimiter: reportLimiter ?? new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
    toolHelpfulRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
    toolReplyRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
    toolAnalytics: new ToolAnalyticsService(new InMemoryToolAnalyticsRepository(), new InMemoryToolFavoriteRepository()),
    toolEventRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
    toolFavoriteRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 })
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    toolId: tool.id,
    ownerSession,
    guestSession,
    blockedSession: blockedSession,
    async close() { await new Promise<void>((resolve) => server.close(() => resolve())); }
  };
}