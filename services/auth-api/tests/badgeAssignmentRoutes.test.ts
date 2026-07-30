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
import { InMemoryBadgeAssignmentRepository } from "../src/badgeAssignments/badgeAssignmentRepository.ts";
import { BadgeAssignmentService } from "../src/badgeAssignments/badgeAssignmentService.ts";

const authenticatedAt = "2026-07-30T12:00:00.000Z";

test("assignment routes enforce permissions and expose stable lifecycle errors", async () => {
  const authorizationRepository = new InMemoryAuthorizationRepository();
  const authorization = new AuthorizationService(authorizationRepository);
  const actor = await authorizationRepository.ensureAuthenticatedUser(
    "76561198000000001",
    authenticatedAt
  );
  const target = await authorizationRepository.ensureAuthenticatedUser(
    "76561198000000002",
    authenticatedAt
  );
  const unprivileged = await authorizationRepository.ensureAuthenticatedUser(
    "76561198000000003",
    authenticatedAt
  );
  assert.equal(await authorization.bootstrapOwner(actor.steamId64), "assigned");
  const sessions = new SessionTokenService(
    "badge-assignment-route-secret-0123456789",
    authorizationRepository
  );
  const actorSession = await sessions.issueForSteamIdentity(
    actor.steamId64,
    authenticatedAt
  );
  const unprivilegedSession = await sessions.issueForSteamIdentity(
    unprivileged.steamId64,
    authenticatedAt
  );
  const badgeRepository = new InMemoryBadgeRepository();
  const badges = new BadgeService(badgeRepository);
  const badge = await badges.create({
    slug: "route-founder",
    displayName: "Route Founder",
    description: "Route assignment fixture.",
    category: "special",
    rarity: "exclusive",
    priority: 10,
    isActive: true,
    isVisible: false,
    grantMode: "manual"
  }, actor.id);
  const assignments = new BadgeAssignmentService(
    new InMemoryBadgeAssignmentRepository(
      authorizationRepository,
      badgeRepository
    )
  );
  const badgeAssets = new MemoryBadgeAssetStorage();
  const harness = await startHarness({
    authorization,
    sessions,
    badges,
    assignments,
    badgeAssets
  });
  try {
    const body = {
      userId: target.id,
      badgeDefinitionId: badge.id,
      reason: "manual acceptance"
    };
    assert.equal((await fetch(`${harness.baseUrl}/api/admin/badge-assignments`)).status, 401);
    const userPicker = await fetch(
      `${harness.baseUrl}/api/admin/badge-assignment-users?page=1&pageSize=20`,
      { headers: { authorization: `Bearer ${actorSession.token}` } }
    );
    assert.equal(userPicker.status, 200);
    const userPickerPayload = await userPicker.json() as {
      items: Array<Record<string, unknown>>;
    };
    assert.ok(userPickerPayload.items.some((item) => item.id === target.id));
    assert.deepEqual(
      Object.keys(userPickerPayload.items[0]).sort(),
      ["displayName", "id", "status"]
    );
    assert.ok(userPickerPayload.items.every((item) => !("steamId64" in item)));
    assert.equal((await fetch(
      `${harness.baseUrl}/api/admin/badge-assignment-users`,
      { headers: { authorization: `Bearer ${unprivilegedSession.token}` } }
    )).status, 403);
    assert.equal((await fetch(`${harness.baseUrl}/api/admin/badge-assignments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${unprivilegedSession.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    })).status, 403);
    const assigned = await fetch(`${harness.baseUrl}/api/admin/badge-assignments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${actorSession.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    assert.equal(assigned.status, 201);
    const assignment = await assigned.json() as { id: string };
    const duplicate = await fetch(`${harness.baseUrl}/api/admin/badge-assignments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${actorSession.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), { error: "BADGE_ALREADY_ASSIGNED" });
    const list = await fetch(
      `${harness.baseUrl}/api/admin/users/${target.id}/badge-assignments?status=active`,
      { headers: { authorization: `Bearer ${actorSession.token}` } }
    );
    assert.equal(list.status, 200);
    assert.equal((await list.json() as { total: number }).total, 1);
    const revoked = await fetch(
      `${harness.baseUrl}/api/admin/badge-assignments/${assignment.id}/revoke`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${actorSession.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ reason: "completed test" })
      }
    );
    assert.equal(revoked.status, 200);
    const repeated = await fetch(
      `${harness.baseUrl}/api/admin/badge-assignments/${assignment.id}/revoke`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${actorSession.token}`,
          "content-type": "application/json"
        },
        body: "{}"
      }
    );
    assert.equal(repeated.status, 409);
    assert.ok(authorizationRepository.auditEvents.some(
      (event) =>
        event.action === "badge.assignment_denied" &&
        event.metadata?.denialCode === "BADGE_ALREADY_ASSIGNED"
    ));
  } finally {
    await harness.close();
  }
});

test("public badges expose only eligible readable presentation data", async () => {
  const authorizationRepository = new InMemoryAuthorizationRepository();
  const authorization = new AuthorizationService(authorizationRepository);
  const user = await authorizationRepository.ensureAuthenticatedUser(
    "76561198000000004",
    authenticatedAt
  );
  const sessions = new SessionTokenService(
    "public-badge-route-secret-012345678901",
    authorizationRepository
  );
  const session = await sessions.issueForSteamIdentity(user.steamId64, authenticatedAt);
  const badgeRepository = new InMemoryBadgeRepository();
  const badges = new BadgeService(badgeRepository);
  const badgeAssets = new MemoryBadgeAssetStorage();
  const storageKey = await badgeAssets.upload({
    contentType: "image/png",
    bytes: Buffer.from("public-icon"),
    width: 64,
    height: 64,
    isSquare: true
  });
  const asset = await badgeRepository.saveAsset({
    storageKey,
    contentType: "image/png",
    byteSize: 11,
    width: 64,
    height: 64,
    isSquare: true
  }, user.id);
  const badge = await badges.create({
    slug: "public-founder",
    displayName: "Public Founder",
    description: "Safe public description.",
    category: "special",
    rarity: "exclusive",
    iconAssetId: asset.id,
    priority: 1,
    isActive: true,
    isVisible: true,
    grantMode: "manual"
  }, user.id);
  const assignments = new BadgeAssignmentService(
    new InMemoryBadgeAssignmentRepository(authorizationRepository, badgeRepository),
    () => Date.parse(authenticatedAt)
  );
  await assignments.assign({
    userId: user.id,
    badgeDefinitionId: badge.id
  }, user.id);
  const harness = await startHarness({
    authorization, sessions, badges, assignments, badgeAssets
  });
  try {
    assert.equal((await fetch(`${harness.baseUrl}/api/me/public-badges`)).status, 401);
    const response = await fetch(`${harness.baseUrl}/api/me/public-badges`, {
      headers: { authorization: `Bearer ${session.token}` }
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as { items: Array<Record<string, unknown>> };
    assert.equal(payload.items.length, 1);
    assert.deepEqual(Object.keys(payload.items[0]).sort(), [
      "category", "description", "displayName", "iconUrl", "rarity", "slug"
    ]);
    assert.equal(JSON.stringify(payload).includes(user.id), false);
    const icon = await fetch(`${harness.baseUrl}${payload.items[0].iconUrl}`);
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get("content-type"), "image/png");
    assert.match(icon.headers.get("cache-control") ?? "", /public/);
    await badgeAssets.delete(storageKey);
    assert.equal((await fetch(`${harness.baseUrl}${payload.items[0].iconUrl}`)).status, 404);
    const missing = await fetch(`${harness.baseUrl}/api/me/public-badges`, {
      headers: { authorization: `Bearer ${session.token}` }
    });
    assert.deepEqual(await missing.json(), { items: [] });
  } finally {
    await harness.close();
  }
});

async function startHarness(deps: {
  authorization: AuthorizationService;
  sessions: SessionTokenService;
  badges: BadgeService;
  assignments: BadgeAssignmentService;
  badgeAssets: MemoryBadgeAssetStorage;
}) {
  const config: AuthApiConfig = {
    nodeEnv: "test",
    port: 8787,
    publicBaseUrl: "https://auth.example.test",
    openIdRealm: "https://auth.example.test/",
    openIdReturnUrl: "https://auth.example.test/v1/auth/steam/callback",
    storageDriver: "memory",
    sessionSecret: "badge-assignment-route-secret-0123456789",
    logLevel: "error",
    trustProxy: false,
    allowedOrigins: []
  };
  const server = createServer(createRouter({
    config,
    transactions: new AuthTransactionService(new InMemoryAuthTransactionRepository()),
    verifier: new SteamOpenIdVerifier({
      async checkAssertion() { return { ok: true, isValid: true }; }
    }, { realm: config.openIdRealm }),
    rateLimiter: new PollingRateLimiter(),
    logger: noOpLogger,
    authorization: deps.authorization,
    sessions: deps.sessions,
    badges: deps.badges,
    badgeAssets: deps.badgeAssets,
    badgeAssignments: deps.assignments
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
