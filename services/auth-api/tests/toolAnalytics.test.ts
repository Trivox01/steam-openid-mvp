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
import { ToolReviewService, ToolReviewModerationService, ToolReviewInteractionService } from "../src/tools/toolReviewService.ts";
import { InMemoryToolAnalyticsRepository } from "../src/tools/toolAnalyticsRepository.ts";
import { InMemoryToolFavoriteRepository } from "../src/tools/toolFavoriteRepository.ts";
import { ToolAnalyticsService } from "../src/tools/toolAnalyticsService.ts";

const draft = {
  name: "Nexus Helper", slug: "nexus-helper", shortDescription: "A helpful companion", fullDescription: "Plain text description", version: "1.0.0", developerName: "Nexus", externalDownloadUrl: "https://downloads.example.com/tool", downloadTrust: "external" as const, badgeIds: [], isFeatured: false, isActive: true, publishedAt: "2026-08-01T00:00:00Z"
};

test("Records view events with per-identity dedupe windows", async () => {
  const x = buildServices();
  const tool = await x.tools.create(draft, "actor");
  assert.equal((await x.analytics.recordView({ toolId: tool.id, dedupeKey: "k1" })).recorded, true);
  assert.equal((await x.analytics.recordView({ toolId: tool.id, dedupeKey: "k1" })).recorded, false);
  assert.equal((await x.analytics.recordView({ toolId: tool.id, userId: "u1", dedupeKey: "d1" })).recorded, true);
  assert.equal((await x.analytics.recordView({ toolId: tool.id, userId: "u1", dedupeKey: "d2" })).recorded, false);
  assert.equal((await x.analytics.recordDownloadClick({ toolId: tool.id, dedupeKey: "k1" })).recorded, true);
  const stats = await x.analytics.stats(tool.id);
  assert.equal(stats.views, 2);
  assert.equal(stats.downloadClicks, 1);
  assert.equal(await x.events.lifetimeTotals("view"), 2);
  const series = await x.events.dailySeries(tool.id, "view", 0);
  assert.equal(series.length, 1);
  assert.equal(series[0].count, 2);
});

test("Ranking sorts by score then deterministic id tie-breaks", async () => {
  const x = buildServices();
  const toolA = await x.tools.create({ ...draft, slug: "rank-a" }, "actor");
  const toolB = await x.tools.create({ ...draft, slug: "rank-b" }, "actor");
  await x.analytics.recordView({ toolId: toolB.id, userId: "u1", dedupeKey: "d1" });
  await x.analytics.recordView({ toolId: toolA.id, userId: "u2", dedupeKey: "d2" });
  await x.analytics.recordDownloadClick({ toolId: toolA.id, userId: "u2", dedupeKey: "d3" });
  const trending = await x.analytics.rank([toolA.id, toolB.id], "trending");
  assert.equal(trending[0].id, toolA.id);
  const mostDownloaded = await x.analytics.rank([toolA.id, toolB.id], "most_downloaded");
  assert.equal(mostDownloaded[0].id, toolA.id);
  const bySlug = await x.analytics.rank([toolB.id, toolA.id], "popular");
  const expectedTieBreak = [toolA.id, toolB.id].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(bySlug.map((entry) => entry.id), expectedTieBreak);
  const recommended = await x.analytics.rank([toolA.id, toolB.id], "recommended");
  assert.equal(recommended.length, 2);
  await x.ratings.upsert(toolA.id, "u1", 5);
  await x.ratings.upsert(toolB.id, "u1", 2);
  const topRated = await x.analytics.rank([toolA.id, toolB.id], "top_rated");
  assert.equal(topRated[0].id, toolA.id);
  const topRatedList = await x.tools.list({ page: 1, pageSize: 20, activeOnly: true, includeArchived: false, sort: "top_rated" });
  assert.equal(topRatedList.items[0].id, toolA.id);
});

test("Tool list supports analytics sort modes", async () => {
  const x = buildServices();
  const toolA = await x.tools.create({ ...draft, slug: "list-a" }, "actor");
  const toolB = await x.tools.create({ ...draft, slug: "list-b" }, "actor");
  await x.analytics.recordView({ toolId: toolA.id, userId: "u1", dedupeKey: "d1" });
  await x.analytics.recordView({ toolId: toolA.id, userId: "u2", dedupeKey: "d2" });
  const popular = await x.tools.list({ page: 1, pageSize: 20, activeOnly: true, includeArchived: false, sort: "popular" });
  assert.equal(popular.total, 2);
  assert.equal(popular.items[0].id, toolA.id);
  assert.equal(popular.items[0].slug, "list-a");
  const recommended = await x.tools.list({ page: 1, pageSize: 20, activeOnly: true, includeArchived: false, sort: "recommended" });
  assert.equal(recommended.total, 2);
  const trending = await x.tools.list({ page: 1, pageSize: 20, activeOnly: true, includeArchived: false, sort: "trending" });
  assert.equal(trending.items.length, 2);
});

test("Favorites are idempotent and listed newest first", async () => {
  const x = buildServices();
  const toolA = await x.tools.create({ ...draft, slug: "fav-a" }, "actor");
  const toolB = await x.tools.create({ ...draft, slug: "fav-b" }, "actor");
  assert.deepEqual(await x.analytics.addFavorite(toolA.id, "u1"), { isFavorite: true, favoritesCount: 1, added: true });
  assert.equal((await x.analytics.addFavorite(toolA.id, "u1")).added, false);
  assert.equal(await x.analytics.favoriteStatus(toolA.id, "u1"), true);
  assert.equal(await x.analytics.favoriteStatus(toolA.id, "u2"), false);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await x.analytics.addFavorite(toolB.id, "u1");
  const list = await x.analytics.listFavorites("u1", 1, 20);
  assert.equal(list.total, 2);
  assert.equal(list.items[0].toolId, toolB.id);
  assert.equal(list.items[0].stats.favorites, 1);
  assert.deepEqual(await x.analytics.removeFavorite(toolA.id, "u1"), { isFavorite: false, favoritesCount: 0, removed: true });
  assert.equal((await x.analytics.listFavorites("u1", 1, 20)).total, 1);
});

test("Admin overview reports totals, windows and trending", async () => {
  const x = buildServices();
  const tool = await x.tools.create(draft, "actor");
  await x.analytics.recordView({ toolId: tool.id, userId: "u1", dedupeKey: "d1" });
  await x.analytics.recordDownloadClick({ toolId: tool.id, userId: "u1", dedupeKey: "d2" });
  await x.analytics.addFavorite(tool.id, "u2");
  const report = await x.analytics.toolAnalytics(tool.id, 30);
  assert.equal(report.stats.views, 1);
  assert.equal(report.stats.downloadClicks, 1);
  assert.equal(report.stats.favorites, 1);
  assert.equal(report.series.views.length, 1);
  assert.equal(report.ratingSummary?.total, 0);
  assert.equal(report.reviewCount, 0);
  const overview = await x.analytics.overview();
  assert.ok(overview.totals.views >= 1);
  assert.ok(overview.totals.downloadClicks >= 1);
  assert.ok(overview.totals.favorites >= 1);
  assert.equal(overview.windows["7d"].views, 1);
  assert.equal(overview.trending.length, 1);
  assert.equal(overview.trending[0].id, tool.id);
});

test("HTTP routes track events, stats and favorites with permission gates", async () => {
  const harness = await startAnalyticsHarness();
  try {
    const guestAuth = { authorization: `Bearer ${harness.guestSession.token}` };
    const firstView = await (await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/view`, {
      method: "POST", headers: guestAuth, body: JSON.stringify({ dedupeKey: "page-load-1" })
    })).json() as { recorded: boolean };
    assert.equal(firstView.recorded, true);
    const repeatView = await (await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/view`, {
      method: "POST", headers: guestAuth, body: JSON.stringify({ dedupeKey: "page-load-1" })
    })).json() as { recorded: boolean };
    assert.equal(repeatView.recorded, false);
    await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/download-click`, {
      method: "POST", headers: guestAuth, body: JSON.stringify({ dedupeKey: "download-1" })
    });
    const anonView = await (await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/view`, {
      method: "POST", body: JSON.stringify({ dedupeKey: "anon-load-1" })
    })).json() as { recorded: boolean };
    assert.equal(anonView.recorded, true);
    await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/favorite`, { method: "PUT", headers: guestAuth });
    const status = await (await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/favorite-status`, { headers: guestAuth })).json() as { isFavorite: boolean };
    assert.equal(status.isFavorite, true);
    const favorites = await (await fetch(`${harness.baseUrl}/api/tools/favorites`, { headers: guestAuth })).json() as { total: number };
    assert.equal(favorites.total, 1);
    const catalogCategories = await (await fetch(`${harness.baseUrl}/api/tools/categories`)).json() as { items: Array<{ slug: string }> };
    assert.ok(Array.isArray(catalogCategories.items));
    const catalogBadges = await (await fetch(`${harness.baseUrl}/api/tools/badges`)).json() as { items: Array<{ slug: string }> };
    assert.ok(Array.isArray(catalogBadges.items));
    const stats = await (await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/stats`, { headers: guestAuth })).json() as { views: number; downloadClicks: number; favorites: number };
    assert.ok(stats.views >= 2);
    assert.ok(stats.downloadClicks >= 1);
    assert.ok(stats.favorites >= 1);
    const forbidden = await fetch(`${harness.baseUrl}/api/admin/tools/analytics/overview`, {
      headers: { authorization: `Bearer ${harness.guestSession.token}` }
    });
    assert.equal(forbidden.status, 403);
    const ownerAuth = { authorization: `Bearer ${harness.ownerSession.token}` };
    const overview = await (await fetch(`${harness.baseUrl}/api/admin/tools/analytics/overview`, { headers: ownerAuth })).json() as { totals: { views: number; favorites: number } };
    assert.ok(overview.totals.views >= 2);
    assert.ok(overview.totals.favorites >= 1);
    const report = await (await fetch(`${harness.baseUrl}/api/admin/tools/${harness.toolId}/analytics`, { headers: ownerAuth })).json() as { series: { views: Array<unknown> }; reviewCount: number };
    assert.ok(report.series.views.length >= 1);
    assert.equal(report.reviewCount, 0);
  } finally {
    await harness.close();
  }
});

test("Expired events are purged for retention", async () => {
  const x = buildServices();
  const tool = await x.tools.create(draft, "actor");
  await x.events.record({ toolId: tool.id, kind: "view", dedupeKey: "old", windowMs: 1, now: Date.now() - 200 * 86_400_000 });
  const purged = await x.purge();
  assert.ok(purged >= 1);
  assert.equal((await x.events.lifetimeTotals("view")), 0);
});

function buildServices() {
  const badges = new InMemoryToolBadgeRepository();
  const categories = new InMemoryToolCategoryRepository();
  const repository = new InMemoryToolRepository(badges, categories);
  const events = new InMemoryToolAnalyticsRepository();
  const favorites = new InMemoryToolFavoriteRepository();
  const ratingStore = new InMemoryToolRatingRepository(repository);
  const analytics = new ToolAnalyticsService(events, favorites, { ratings: ratingStore, reviews: new InMemoryToolReviewRepository(repository), tools: repository });
  const tools = new ToolService(repository, badges, categories, undefined, undefined, analytics);
  return {
    repository, badges, categories, events, favorites, analytics, tools, ratings: ratingStore,
    async purge() { return analytics.purgeExpiredEvents(); }
  };
}

async function startAnalyticsHarness(limiter?: PollingRateLimiter) {
  const authorizationRepository = new InMemoryAuthorizationRepository();
  const authorization = new AuthorizationService(authorizationRepository);
  const owner = await authorizationRepository.ensureAuthenticatedUser("76561198000000011", "2026-07-30T12:00:00.000Z");
  const guest = await authorizationRepository.ensureAuthenticatedUser("76561198000000012", "2026-07-30T13:00:00.000Z");
  await authorization.bootstrapOwner(owner.steamId64);
  const sessions = new SessionTokenService("tool-analytics-test-secret-012345678901", authorizationRepository);
  const ownerSession = await sessions.issueForSteamIdentity(owner.steamId64, "2026-07-30T12:00:00.000Z");
  const guestSession = await sessions.issueForSteamIdentity(guest.steamId64, "2026-07-30T13:00:00.000Z");
  const badgesRepo = new InMemoryToolBadgeRepository();
  const categories = new InMemoryToolCategoryRepository();
  const repository = new InMemoryToolRepository(badgesRepo, categories);
  const ratingRepository = new InMemoryToolRatingRepository(repository);
  const ratings = new ToolRatingService(ratingRepository);
  const reviewUsers = { displayName: async () => undefined, avatarUrl: async () => undefined };
  const reviewRepository = new InMemoryToolReviewRepository(repository, reviewUsers, ratingRepository);
  const reportRepository = new InMemoryToolReviewReportRepository(repository, reviewRepository, reviewUsers);
  const helpfulRepository = new InMemoryToolReviewHelpfulRepository();
  const replyRepository = new InMemoryToolReviewDeveloperReplyRepository();
  reviewRepository.attachHelpfulSource(helpfulRepository);
  reviewRepository.attachReplySource(replyRepository);
  const toolReviews = new ToolReviewService(reviewRepository, reportRepository);
  const toolReviewModeration = new ToolReviewModerationService(reviewRepository, reportRepository);
  const toolReviewInteractions = new ToolReviewInteractionService(reviewRepository, helpfulRepository, replyRepository);
  const analytics = new ToolAnalyticsService(new InMemoryToolAnalyticsRepository(), new InMemoryToolFavoriteRepository(), { ratings: ratingRepository, reviews: reviewRepository, tools: repository });
  const tools = new ToolService(repository, badgesRepo, categories, undefined, undefined, analytics);
  const tool = await tools.create({ ...draft, slug: "analytics-route-tool", name: "Analytics Route Tool" }, owner.id);
  const config: AuthApiConfig = {
    nodeEnv: "test", port: 8789,
    publicBaseUrl: "https://auth.example.test",
    openIdRealm: "https://auth.example.test/",
    openIdReturnUrl: "https://auth.example.test/v1/auth/steam/callback",
    storageDriver: "memory",
    sessionSecret: "tool-analytics-test-secret-012345678901",
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
    toolReviews,
    toolReviewModeration,
    toolReviewInteractions,
    toolReviewRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
    toolReportRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
    toolHelpfulRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
    toolReplyRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
    toolAnalytics: analytics,
    toolEventRateLimiter: limiter ?? new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
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
    async close() { await new Promise<void>((resolve) => server.close(() => resolve())); }
  };
}