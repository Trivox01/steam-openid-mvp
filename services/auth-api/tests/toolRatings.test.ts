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
import { ToolError } from "../src/tools/contracts.ts";

function setup() {
  const badges = new InMemoryToolBadgeRepository();
  const categories = new InMemoryToolCategoryRepository();
  const repository = new InMemoryToolRepository(badges, categories);
  const service = new ToolService(repository, badges, categories);
  const ratingRepository = new InMemoryToolRatingRepository(repository);
  const ratings = new ToolRatingService(ratingRepository);
  return { badges, categories, repository, service, ratings, ratingRepository };
}

const draft = { name: "Nexus Helper", slug: "nexus-helper", shortDescription: "A helpful companion", fullDescription: "Plain text description", version: "1.0.0", developerName: "Nexus", externalDownloadUrl: "https://downloads.example.com/tool", downloadTrust: "external" as const, badgeIds: [], isFeatured: false, isActive: true, publishedAt: "2026-08-01T00:00:00Z" };

test("create rating then a duplicate becomes an update", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  const first = await x.ratings.save(tool.id, "user-1", { rating: 5 });
  assert.equal(first.rating, 5);
  assert.deepEqual(await x.ratings.summary(tool.id), { average: 5.0, total: 1, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 } });
  const second = await x.ratings.save(tool.id, "user-1", { rating: 2 });
  assert.equal(second.rating, 2);
  assert.deepEqual(await x.ratings.summary(tool.id), { average: 2.0, total: 1, distribution: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 0 } });
  assert.equal(await x.ratings.mine(tool.id, "user-1"), 2);
});

test("remove own rating recalculates the summary and rejects a missing rating", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  await x.ratings.save(tool.id, "user-1", { rating: 5 });
  await x.ratings.save(tool.id, "user-2", { rating: 3 });
  await x.ratings.remove(tool.id, "user-1");
  assert.deepEqual(await x.ratings.summary(tool.id), { average: 3.0, total: 1, distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 0 } });
  await assert.rejects(() => x.ratings.remove(tool.id, "user-1"), (error: unknown) => error instanceof ToolError && error.code === "RATING_NOT_FOUND");
  assert.equal(await x.ratings.mine(tool.id, "user-1"), null);
});

test("invalid rating values are rejected with INVALID_TOOL_RATING", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  for (const value of [{ rating: 0 }, { rating: 6 }, { rating: 4.5 }, { rating: "4" }, { rating: null }, {}, { rating: true }]) {
    await assert.rejects(() => x.ratings.save(tool.id, "user-1", value), (error: unknown) => error instanceof ToolError && error.code === "INVALID_TOOL_RATING");
  }
});

test("archived tools reject new ratings but preserve historical summaries", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  await x.ratings.save(tool.id, "user-1", { rating: 5 });
  await x.service.archive(tool.id, "actor");
  await assert.rejects(() => x.ratings.save(tool.id, "user-2", { rating: 4 }), (error: unknown) => error instanceof ToolError && error.code === "TOOL_ARCHIVED");
  assert.deepEqual(await x.ratings.summary(tool.id), { average: 5.0, total: 1, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 } });
  assert.equal(await x.ratings.mine(tool.id, "user-1"), 5);
});

test("rating summary and upsert reject an unknown tool", async () => {
  const x = setup();
  await assert.rejects(() => x.ratings.save("00000000-0000-4000-8000-000000000000", "user-1", { rating: 3 }), (error: unknown) => error instanceof ToolError && error.code === "TOOL_NOT_FOUND");
  await assert.rejects(() => x.ratings.summary("00000000-0000-4000-8000-000000000000"), (error: unknown) => error instanceof ToolError && error.code === "TOOL_NOT_FOUND");
});

test("aggregate averages round to one decimal place", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  await x.ratings.save(tool.id, "user-1", { rating: 5 });
  await x.ratings.save(tool.id, "user-2", { rating: 5 });
  await x.ratings.save(tool.id, "user-3", { rating: 4 });
  const summary = await x.ratings.summary(tool.id);
  assert.equal(summary.average, 4.7);
  assert.equal(summary.total, 3);
});

test("distribution covers all five buckets across users", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  const values = [1, 2, 3, 4, 5];
  for (const [index, rating] of values.entries()) await x.ratings.save(tool.id, `user-${index}`, { rating });
  assert.deepEqual(await x.ratings.summary(tool.id), { average: 3.0, total: 5, distribution: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 } });
  const all = await x.ratings.summaries([tool.id]);
  assert.deepEqual(all[tool.id], { average: 3.0, total: 5, distribution: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 } });
});

test("empty summary reports null average and zero totals, never a misleading 0.0", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  assert.deepEqual(await x.ratings.summary(tool.id), { average: null, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
});

test("concurrent upserts from one user stay atomic and unique", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  await Promise.all([
    x.ratings.save(tool.id, "user-1", { rating: 1 }),
    x.ratings.save(tool.id, "user-1", { rating: 5 }),
    x.ratings.save(tool.id, "user-1", { rating: 3 })
  ]);
  assert.equal((await x.ratings.summary(tool.id)).total, 1);
  assert.ok([1, 3, 5].includes((await x.ratings.mine(tool.id, "user-1")) as number));
});

test("audit records created, updated, removed and denied without account identifiers", async () => {
  const x = setup(); const tool = await x.service.create(draft, "actor");
  await x.ratings.save(tool.id, "user-1", { rating: 5 });
  await x.ratings.save(tool.id, "user-1", { rating: 4 });
  await x.ratings.remove(tool.id, "user-1");
  await x.service.archive(tool.id, "actor");
  await x.ratings.save(tool.id, "user-2", { rating: 3 }).catch(() => {});
  const events = x.ratingRepository.auditEvents;
  assert.deepEqual(events.map((event) => event.action).sort(), ["tool.rating_created", "tool.rating_denied", "tool.rating_removed", "tool.rating_updated"]);
  assert.deepEqual(events[0].metadata, { new: 5 });
  assert.deepEqual(events[1].metadata, { previous: 5, new: 4 });
  assert.deepEqual(events[2].metadata, { previous: 4 });
  assert.deepEqual(events[3].metadata, {});
  for (const event of events) assert.doesNotMatch(JSON.stringify(event), /steam|account|token|secret|session/i);
});

test("routes require authentication and permission for rating mutations", async () => {
  const harness = await startRatingHarness();
  try {
    const anonymousSummary = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/rating-summary`);
    assert.equal(anonymousSummary.status, 200);
    assert.deepEqual(await anonymousSummary.json(), { average: null, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    const anonMine = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-rating`);
    assert.equal(anonMine.status, 401);
    assert.equal((await anonMine.json() as { error: string }).error, "UNAUTHENTICATED");
  } finally { await harness.close(); }
});

test("authenticated my-rating flow mutates, updates, removes and is protected by permissions", async () => {
  const harness = await startRatingHarness();
  try {
    const mine = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-rating`, { headers: { authorization: `Bearer ${harness.userSession.token}` } });
    assert.equal(mine.status, 200);
    assert.deepEqual(await mine.json(), { rating: null });
    const put = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-rating`, {
      method: "PUT", headers: { authorization: `Bearer ${harness.userSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ rating: 5 })
    });
    assert.equal(put.status, 200);
    assert.deepEqual(await put.json(), { rating: 5 });
    await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-rating`, {
      method: "PUT", headers: { authorization: `Bearer ${harness.userSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ rating: 4 })
    });
    assert.equal((await (await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/rating-summary`)).json()).average, 4);
    const denied = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-rating`, {
      method: "PUT", headers: { authorization: `Bearer ${harness.guestSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ rating: 2 })
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json() as { error: string }).error, "FORBIDDEN");
    const removed = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-rating`, { method: "DELETE", headers: { authorization: `Bearer ${harness.userSession.token}` } });
    assert.equal(removed.status, 204);
    assert.equal((await (await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/rating-summary`)).json()).total, 0);
  } finally { await harness.close(); }
});

test("rating mutations are rate limited with a retry-after header", async () => {
  const harness = await startRatingHarness(new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 5 }));
  try {
    const attempt = async () => fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-rating`, {
      method: "PUT", headers: { authorization: `Bearer ${harness.userSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ rating: 1 })
    });
    let limited = 0;
    for (let index = 0; index < 30; index += 1) { const response = await attempt(); if (response.status === 429) { limited += 1; assert.ok(Number(response.headers.get("retry-after")) > 0); assert.equal((await response.json() as { error: string }).error, "RATING_RATE_LIMITED"); break; } }
    assert.ok(limited > 0);
  } finally { await harness.close(); }
});

test("invalid body and invalid tool ids map to stable errors", async () => {
  const harness = await startRatingHarness();
  try {
    const invalid = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-rating`, {
      method: "PUT", headers: { authorization: `Bearer ${harness.userSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ rating: 9 })
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json() as { error: string }).error, "INVALID_TOOL_RATING");
    const unknown = await fetch(`${harness.baseUrl}/api/tools/00000000-0000-4000-8000-000000000000/my-rating`, {
      method: "GET", headers: { authorization: `Bearer ${harness.userSession.token}` }
    });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json() as { error: string }).error, "TOOL_NOT_FOUND");
    const archived = await fetch(`${harness.baseUrl}/api/tools/${harness.toolId}/my-rating`, {
      method: "PUT", headers: { authorization: `Bearer ${harness.userSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ rating: 3 })
    });
    assert.equal(archived.status, 200);
    const list = await fetch(`${harness.baseUrl}/api/tools`);
    assert.equal(list.status, 200);
    const body = await list.json() as { items: Array<{ id: string; ratingSummary: { total: number } }> };
    const item = body.items.find(candidate => candidate.id === harness.toolId);
    assert.equal(item?.ratingSummary.total, 1);
    const publicList = await fetch(`${harness.baseUrl}/api/tools`);
    assert.equal(publicList.status, 200);
    const publicBody = await publicList.json() as { items: Array<{ ratingSummary?: { total: number } }> };
    assert.equal(publicBody.items.some(candidate => "ratingSummary" in candidate), true);
  } finally { await harness.close(); }
});

async function startRatingHarness(limiter = new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 })) {
  const authorizationRepository = new InMemoryAuthorizationRepository();
  const authorization = new AuthorizationService(authorizationRepository);
  const owner = await authorizationRepository.ensureAuthenticatedUser("76561198000000011", "2026-07-30T12:00:00.000Z");
  const guest = await authorizationRepository.ensureAuthenticatedUser("76561198000000012", "2026-07-30T13:00:00.000Z");
  await authorization.bootstrapOwner(owner.steamId64);
  const sessions = new SessionTokenService("tool-rating-test-secret-012345678901", authorizationRepository);
  const ownerSession = await sessions.issueForSteamIdentity(owner.steamId64, "2026-07-30T12:00:00.000Z");
  const guestSession = await sessions.issueForSteamIdentity(guest.steamId64, "2026-07-30T13:00:00.000Z");
  authorizationRepository.overrides.push({ userId: guest.id, permission: "tools.rate", effect: "deny" });
  const badges = new InMemoryToolBadgeRepository();
  const categories = new InMemoryToolCategoryRepository();
  const repository = new InMemoryToolRepository(badges, categories);
  const tools = new ToolService(repository, badges, categories);
  const ratings = new ToolRatingService(new InMemoryToolRatingRepository(repository));
  const reviewUsers = { displayName: async () => undefined, avatarUrl: async () => undefined };
  const reviewRepository = new InMemoryToolReviewRepository(repository, reviewUsers);
  const reportRepository = new InMemoryToolReviewReportRepository(repository, reviewRepository, reviewUsers);
  const helpfulRepository = new InMemoryToolReviewHelpfulRepository();
  const replyRepository = new InMemoryToolReviewDeveloperReplyRepository();
  reviewRepository.attachHelpfulSource(helpfulRepository);
  reviewRepository.attachReplySource(replyRepository);
  const toolReviews = new ToolReviewService(reviewRepository, reportRepository);
  const toolReviewModeration = new ToolReviewModerationService(reviewRepository, reportRepository);
  const toolReviewInteractions = new ToolReviewInteractionService(reviewRepository, helpfulRepository, replyRepository);
  const tool = await tools.create({ ...draft, slug: "rating-route-tool", name: "Rating Route Tool" }, owner.id);
  const config: AuthApiConfig = {
    nodeEnv: "test", port: 8787,
    publicBaseUrl: "https://auth.example.test",
    openIdRealm: "https://auth.example.test/",
    openIdReturnUrl: "https://auth.example.test/v1/auth/steam/callback",
    storageDriver: "memory",
    sessionSecret: "tool-rating-test-secret-012345678901",
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
    toolRatingRateLimiter: limiter,
    toolReviews,
    toolReviewModeration,
    toolReviewInteractions,
    toolReviewRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
    toolReportRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
    toolHelpfulRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 }),
    toolReplyRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 60_000, maxRequests: 100 })
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    toolId: tool.id,
    userSession: ownerSession,
    guestSession,
    async close() { await new Promise<void>((resolve) => server.close(() => resolve())); }
  };
}