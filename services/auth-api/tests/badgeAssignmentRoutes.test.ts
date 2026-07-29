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
  const harness = await startHarness({
    authorization,
    sessions,
    badges,
    assignments
  });
  try {
    const body = {
      userId: target.id,
      badgeDefinitionId: badge.id,
      reason: "manual acceptance"
    };
    assert.equal((await fetch(`${harness.baseUrl}/api/admin/badge-assignments`)).status, 401);
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

async function startHarness(deps: {
  authorization: AuthorizationService;
  sessions: SessionTokenService;
  badges: BadgeService;
  assignments: BadgeAssignmentService;
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
    badgeAssets: new MemoryBadgeAssetStorage(),
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
