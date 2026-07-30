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
import { InMemoryUserRepository } from "../src/users/userRepository.ts";
import { UserService } from "../src/users/userService.ts";

test("admin users support protected reads and account status changes", async () => {
  const authorizationRepository = new InMemoryAuthorizationRepository();
  const authorization = new AuthorizationService(authorizationRepository);
  const owner = await authorizationRepository.ensureAuthenticatedUser(
    "76561198000000011", "2026-07-30T12:00:00.000Z"
  );
  const target = await authorizationRepository.ensureAuthenticatedUser(
    "76561198000000012", "2026-07-30T13:00:00.000Z"
  );
  const outsider = await authorizationRepository.ensureAuthenticatedUser(
    "76561198000000013", "2026-07-30T14:00:00.000Z"
  );
  await authorization.bootstrapOwner(owner.steamId64);
  const sessions = new SessionTokenService(
    "admin-users-test-secret-012345678901",
    authorizationRepository
  );
  const ownerSession = await sessions.issueForSteamIdentity(owner.steamId64, "2026-07-30T12:00:00.000Z");
  const outsiderSession = await sessions.issueForSteamIdentity(outsider.steamId64, "2026-07-30T14:00:00.000Z");
  const badgeRepository = new InMemoryBadgeRepository();
  const badges = new BadgeService(badgeRepository);
  const assignmentRepository = new InMemoryBadgeAssignmentRepository(
    authorizationRepository, badgeRepository
  );
  const assignments = new BadgeAssignmentService(assignmentRepository);
  const users = new UserService(new InMemoryUserRepository(
    authorizationRepository, assignmentRepository
  ), authorizationRepository);
  const harness = await startHarness({
    authorization, sessions, badges, assignments, users
  });
  try {
    assert.equal((await fetch(`${harness.baseUrl}/api/admin/users`)).status, 401);
    assert.equal((await fetch(`${harness.baseUrl}/api/admin/users`, {
      headers: { authorization: `Bearer ${outsiderSession.token}` }
    })).status, 403);
    const list = await fetch(
      `${harness.baseUrl}/api/admin/users?page=1&pageSize=2&search=${target.id.slice(0, 8)}&sort=created_desc`,
      { headers: { authorization: `Bearer ${ownerSession.token}` } }
    );
    assert.equal(list.status, 200);
    const page = await list.json() as { items: Array<Record<string, unknown>>; total: number };
    assert.equal(page.total, 1);
    assert.equal(page.items[0].id, target.id);
    assert.equal("steamId64" in page.items[0], false);
    const details = await fetch(`${harness.baseUrl}/api/admin/users/${target.id}`, {
      headers: { authorization: `Bearer ${ownerSession.token}` }
    });
    assert.equal(details.status, 200);
    const user = await details.json() as Record<string, unknown>;
    assert.equal(user.steamId64, target.steamId64);
    assert.deepEqual(Object.keys(user).sort(), [
      "badgeCount", "badges", "createdAt", "displayName", "id", "lastLoginAt",
      "roleCount", "roles", "status", "steamId64"
    ]);
    assert.equal((await fetch(`${harness.baseUrl}/api/admin/users/${target.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${ownerSession.token}` }
    })).status, 405);

    authorizationRepository.overrides.push({
      userId: outsider.id,
      permission: "users.view",
      effect: "allow"
    });
    assert.equal((await fetch(`${harness.baseUrl}/api/admin/users/${target.id}/status`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${outsiderSession.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ status: "suspended" })
    })).status, 403);

    const invalid = await fetch(`${harness.baseUrl}/api/admin/users/${target.id}/status`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${ownerSession.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ status: "banned" })
    });
    assert.equal(invalid.status, 400);

    const changed = await fetch(`${harness.baseUrl}/api/admin/users/${target.id}/status`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${ownerSession.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ status: "suspended", reason: "Temporary review" })
    });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json() as { status: string }).status, "suspended");
    assert.equal((await fetch(`${harness.baseUrl}/api/admin/users/${target.id}/status`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${ownerSession.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ status: "suspended" })
    })).status, 409);
    assert.deepEqual(
      authorizationRepository.auditEvents.find(
        (event) => event.action === "user.status_changed"
      ),
      {
        actorUserId: owner.id,
        action: "user.status_changed",
        targetType: "user",
        targetId: target.id,
        metadata: {
          previousStatus: "active",
          newStatus: "suspended",
          reason: "Temporary review"
        }
      }
    );
  } finally {
    await harness.close();
  }
});

async function startHarness(deps: {
  authorization: AuthorizationService;
  sessions: SessionTokenService;
  badges: BadgeService;
  assignments: BadgeAssignmentService;
  users: UserService;
}) {
  const config: AuthApiConfig = {
    nodeEnv: "test", port: 8787,
    publicBaseUrl: "https://auth.example.test",
    openIdRealm: "https://auth.example.test/",
    openIdReturnUrl: "https://auth.example.test/v1/auth/steam/callback",
    storageDriver: "memory",
    sessionSecret: "admin-users-test-secret-012345678901",
    logLevel: "error", trustProxy: false, allowedOrigins: []
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
    badgeAssignments: deps.assignments,
    users: deps.users
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
