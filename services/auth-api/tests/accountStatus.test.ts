import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { AuthApiConfig } from "../src/config.ts";
import { createRouter } from "../src/router.ts";
import { AuthTransactionService } from "../src/auth/authTransactionService.ts";
import { InMemoryAuthTransactionRepository } from "../src/storage/authRepository.ts";
import { SteamOpenIdVerifier } from "../src/steam/openIdVerifier.ts";
import { PollingRateLimiter } from "../src/security/pollingRateLimiter.ts";
import { noOpLogger, type SecurityLogEntry } from "../src/security/safeLogger.ts";
import { InMemoryAuthorizationRepository } from "../src/authorization/authorizationRepository.ts";
import { AuthorizationService } from "../src/authorization/authorizationService.ts";
import { AuthorizationError } from "../src/authorization/contracts.ts";
import { SessionTokenService } from "../src/authorization/sessionTokenService.ts";
import { InMemoryBadgeRepository } from "../src/badges/badgeRepository.ts";
import { BadgeService } from "../src/badges/badgeService.ts";
import { MemoryBadgeAssetStorage } from "../src/badges/badgeAssetStorage.ts";
import { InMemoryBadgeAssignmentRepository } from "../src/badgeAssignments/badgeAssignmentRepository.ts";
import { BadgeAssignmentService } from "../src/badgeAssignments/badgeAssignmentService.ts";
import { InMemoryUserRepository } from "../src/users/userRepository.ts";
import { UserService } from "../src/users/userService.ts";
import { ME_AUTHORIZATION_PATH, authorizationErrorStatus } from "../src/routes/meAuthorization.ts";
import { ME_PUBLIC_BADGES_PATH } from "../src/routes/publicBadges.ts";

const SECRET = "account-status-test-secret-0123456789";

test("a non-active account is refused with 403 and no status disclosure", async () => {
  const x = await startHarness();
  try {
    const allowed = await fetch(`${x.baseUrl}${ME_AUTHORIZATION_PATH}`, {
      headers: { authorization: `Bearer ${x.memberSession.token}` }
    });
    assert.equal(allowed.status, 200);

    for (const status of ["suspended", "disabled"] as const) {
      await x.authorizationRepository.setAccountStatus({ userId: x.member.id, status });
      const refused = await fetch(`${x.baseUrl}${ME_AUTHORIZATION_PATH}`, {
        headers: { authorization: `Bearer ${x.memberSession.token}` }
      });
      // 403, never 401: every frontend client calls expireSession() on 401, which
      // would turn a suspended account into an endless re-login loop.
      assert.equal(refused.status, 403);
      const body = await refused.json() as Record<string, unknown>;
      // One opaque code. The response must not reveal which moderation decision
      // produced it, nor anything about roles or the Steam identity.
      assert.deepEqual(body, { error: "ACCOUNT_NOT_ACTIVE" });
      assert.equal(JSON.stringify(body).includes(status), false);
      assert.equal(JSON.stringify(body).includes(x.member.steamId64), false);

      const badges = await fetch(`${x.baseUrl}${ME_PUBLIC_BADGES_PATH}`, {
        headers: { authorization: `Bearer ${x.memberSession.token}` }
      });
      assert.equal(badges.status, 403);
      assert.deepEqual(await badges.json(), { error: "ACCOUNT_NOT_ACTIVE" });
    }

    // Login must not mint a credential that every request then rejects.
    await assert.rejects(
      () => x.sessions.issueForSteamIdentity(x.member.steamId64, "2026-08-01T00:00:00.000Z"),
      (error: unknown) => error instanceof AuthorizationError &&
        error.code === "ACCOUNT_NOT_ACTIVE"
    );
  } finally {
    await x.close();
  }
});

test("ACCOUNT_NOT_ACTIVE maps to 403 in the shared authorization status map", () => {
  assert.equal(authorizationErrorStatus("ACCOUNT_NOT_ACTIVE"), 403);
  assert.equal(authorizationErrorStatus("AUTHENTICATION_REQUIRED"), 401);
});

test("suspending an account revokes its already-issued sessions", async () => {
  const x = await startHarness();
  try {
    // Reactivation later must not resurrect the old token, so the epoch bump is
    // what does the work rather than the status check alone.
    await x.users.changeStatus(x.owner.id, x.member.id, { status: "suspended" });
    assert.equal((await x.authorizationRepository.findUserById(x.member.id))?.sessionEpoch, 1);
    await x.authorizationRepository.setAccountStatus({ userId: x.member.id, status: "active" });
    const reactivated = await fetch(`${x.baseUrl}${ME_AUTHORIZATION_PATH}`, {
      headers: { authorization: `Bearer ${x.memberSession.token}` }
    });
    assert.equal(reactivated.status, 401);
    assert.deepEqual(await reactivated.json(), { error: "AUTHENTICATION_REQUIRED" });
    // A freshly issued token carries the new epoch and works again.
    const reissued = await x.sessions.issueForSteamIdentity(x.member.steamId64, "2026-08-01T00:00:00.000Z");
    assert.equal((await fetch(`${x.baseUrl}${ME_AUTHORIZATION_PATH}`, {
      headers: { authorization: `Bearer ${reissued.token}` }
    })).status, 200);

    // Reactivating does not revoke: the epoch stays where the suspension left it.
    await x.users.changeStatus(x.owner.id, x.member.id, { status: "disabled" });
    assert.equal((await x.authorizationRepository.findUserById(x.member.id))?.sessionEpoch, 2);
    await x.users.changeStatus(x.owner.id, x.member.id, { status: "active" });
    assert.equal((await x.authorizationRepository.findUserById(x.member.id))?.sessionEpoch, 2);
  } finally {
    await x.close();
  }
});

test("revocation covers role removal and deny overrides but not grants", async () => {
  const x = await startHarness();
  try {
    const moderatorRole = await x.authorizationRepository.findRoleBySlug("moderator");
    assert.ok(moderatorRole);
    const epoch = async () =>
      (await x.authorizationRepository.findUserById(x.member.id))?.sessionEpoch;

    // Granting authority cannot let an attacker keep a session alive, so it does
    // not revoke.
    await x.authorization.assignRole(x.owner.id, x.member.id, moderatorRole.id);
    assert.equal(await epoch(), 0);
    await x.authorization.setPermissionOverride({
      actorId: x.owner.id, targetUserId: x.member.id,
      permission: "badges.view", effect: "allow"
    });
    assert.equal(await epoch(), 0);

    // Both of these reduce authority while a signed token is already in the wild.
    await x.authorization.setPermissionOverride({
      actorId: x.owner.id, targetUserId: x.member.id,
      permission: "badges.view", effect: "deny"
    });
    assert.equal(await epoch(), 1);
    await x.authorization.revokeRole(x.owner.id, x.member.id, moderatorRole.id);
    assert.equal(await epoch(), 2);

    // The token minted before any of it is now rejected by the real HTTP path.
    assert.equal((await fetch(`${x.baseUrl}${ME_AUTHORIZATION_PATH}`, {
      headers: { authorization: `Bearer ${x.memberSession.token}` }
    })).status, 401);

    // revokePermissionOverride is deliberately out of scope: removing a deny
    // restores authority, and removing an allow is covered by the next real
    // privilege reduction.
    await x.authorization.revokePermissionOverride({
      actorId: x.owner.id, targetUserId: x.member.id, permission: "badges.view"
    });
    assert.equal(await epoch(), 2);
  } finally {
    await x.close();
  }
});

test("status changes enforce hierarchy without requiring a second permission", async () => {
  const x = await startHarness();
  try {
    const administratorRole = await x.authorizationRepository.findRoleBySlug("administrator");
    const moderatorRole = await x.authorizationRepository.findRoleBySlug("moderator");
    assert.ok(administratorRole && moderatorRole);
    await x.authorization.assignRole(x.owner.id, x.administrator.id, administratorRole.id);
    await x.authorization.assignRole(x.owner.id, x.moderator.id, moderatorRole.id);
    const adminSession = await x.sessions.issueForSteamIdentity(
      x.administrator.steamId64, "2026-07-30T15:00:00.000Z"
    );
    const patch = (targetId: string, token: string) =>
      fetch(`${x.baseUrl}/api/admin/users/${targetId}/status`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "suspended" })
      });

    // Lower priority target: allowed, and the effect is real.
    const allowed = await patch(x.moderator.id, adminSession.token);
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json() as { status: string }).status, "suspended");

    // Self, owner and an equal-priority peer are all refused by numeric priority,
    // never by matching a role name.
    assert.equal((await patch(x.administrator.id, adminSession.token)).status, 403);
    assert.equal((await patch(x.owner.id, adminSession.token)).status, 403);
    const peer = await x.authorizationRepository.ensureAuthenticatedUser(
      "76561198000000025", "2026-07-30T16:00:00.000Z"
    );
    await x.authorization.assignRole(x.owner.id, peer.id, administratorRole.id);
    assert.equal((await patch(peer.id, adminSession.token)).status, 403);
    assert.deepEqual(
      await (await patch(peer.id, adminSession.token)).json(),
      { error: "PERMISSION_DENIED" }
    );

    // The policy is unchanged: "users.change_status" alone still suffices. This
    // actor has no "users.manage", so a canManageUser-based gate would have
    // silently introduced a second required permission.
    // The policy is unchanged: "users.change_status" alone still suffices. The
    // assistant role carries neither "users.change_status" nor "users.manage", so
    // the only thing standing between this actor and the route is the single
    // granted permission — a canManageUser-based gate would have silently
    // introduced "users.manage" as a second requirement.
    const assistantRole = await x.authorizationRepository.findRoleBySlug("assistant");
    assert.ok(assistantRole);
    await x.authorization.assignRole(x.owner.id, x.member.id, assistantRole.id);
    x.authorizationRepository.overrides.push({
      userId: x.member.id, permission: "users.change_status", effect: "allow"
    });
    assert.equal(await x.authorization.hasPermission(x.member.id, "users.change_status"), true);
    assert.equal(await x.authorization.hasPermission(x.member.id, "users.manage"), false);
    const target = await x.authorizationRepository.ensureAuthenticatedUser(
      "76561198000000026", "2026-07-30T17:00:00.000Z"
    );
    const granted = await patch(target.id, x.memberSession.token);
    assert.equal(granted.status, 200);

    // A deny override still wins over the granted allow, and it revokes the live
    // session, so the check is made with a freshly minted token.
    await x.authorization.setPermissionOverride({
      actorId: x.owner.id, targetUserId: x.member.id,
      permission: "users.change_status", effect: "deny"
    });
    const reissued = await x.sessions.issueForSteamIdentity(
      x.member.steamId64, "2026-07-30T18:00:00.000Z"
    );
    const secondTarget = await x.authorizationRepository.ensureAuthenticatedUser(
      "76561198000000027", "2026-07-30T18:30:00.000Z"
    );
    const denied = await patch(secondTarget.id, reissued.token);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: "PERMISSION_DENIED" });
  } finally {
    await x.close();
  }
});

test("an unexpected repository throw becomes a sanitized 500 without leaking internals", async () => {
  const entries: SecurityLogEntry[] = [];
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  const badges = new InMemoryBadgeRepository();
  // A storage failure carrying a Postgres SQLSTATE and a connection string is the
  // realistic shape of what used to escape as an unhandled rejection.
  badges.getPublicAssetByBadgeSlug = async () => {
    const error = new Error("connect ECONNREFUSED postgres://nexus:s3cret@db:5432/nexus");
    error.name = "StorageError";
    (error as { code?: string }).code = "28P01";
    throw error;
  };
  const x = await startHarness({ badges, logger: { write: (entry) => entries.push(entry) } });
  try {
    const response = await fetch(`${x.baseUrl}/api/public/badge-icons/verified`);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { error: "internal_error" });
    for (const secret of ["ECONNREFUSED", "s3cret", "postgres://", "28P01", "StorageError", "at "]) {
      assert.equal(text.includes(secret), false, `response leaked ${secret}`);
    }

    // The process survived, so the next request still succeeds.
    assert.equal((await fetch(`${x.baseUrl}${ME_AUTHORIZATION_PATH}`, {
      headers: { authorization: `Bearer ${x.memberSession.token}` }
    })).status, 200);

    const logged = entries.find((entry) => entry.endpoint === "router_dispatch");
    assert.ok(logged, "the boundary must log the failure");
    assert.equal(logged.status, "failure");
    assert.equal(logged.event, "router_unhandled_error GET /api/public/badge-icons/verified");
    // sanitizeLogCode only accepts lowercase [a-z0-9_], so an unlowered
    // error.name would silently collapse to "internal_error" and lose all triage
    // value.
    assert.equal(logged.errorCode, "storageerror");
    const serialized = JSON.stringify(entries);
    for (const secret of ["s3cret", "postgres://", "ECONNREFUSED", "28P01"]) {
      assert.equal(serialized.includes(secret), false, `log leaked ${secret}`);
    }
  } finally {
    await x.close();
    process.off("unhandledRejection", onRejection);
  }
  assert.deepEqual(rejections, []);
});

async function startHarness(options?: {
  badges?: InMemoryBadgeRepository;
  logger?: { write(entry: SecurityLogEntry): void };
}) {
  const authorizationRepository = new InMemoryAuthorizationRepository();
  const authorization = new AuthorizationService(authorizationRepository);
  const owner = await authorizationRepository.ensureAuthenticatedUser(
    "76561198000000021", "2026-07-30T12:00:00.000Z"
  );
  const member = await authorizationRepository.ensureAuthenticatedUser(
    "76561198000000022", "2026-07-30T13:00:00.000Z"
  );
  const moderator = await authorizationRepository.ensureAuthenticatedUser(
    "76561198000000023", "2026-07-30T14:00:00.000Z"
  );
  const administrator = await authorizationRepository.ensureAuthenticatedUser(
    "76561198000000024", "2026-07-30T15:00:00.000Z"
  );
  await authorization.bootstrapOwner(owner.steamId64);
  const sessions = new SessionTokenService(SECRET, authorizationRepository);
  const badgeRepository = options?.badges ?? new InMemoryBadgeRepository();
  const assignmentRepository = new InMemoryBadgeAssignmentRepository(
    authorizationRepository, badgeRepository
  );
  const assignments = new BadgeAssignmentService(assignmentRepository);
  const users = new UserService(
    new InMemoryUserRepository(authorizationRepository, assignmentRepository),
    authorizationRepository
  );
  const config: AuthApiConfig = {
    nodeEnv: "test", port: 8790,
    publicBaseUrl: "https://auth.example.test",
    openIdRealm: "https://auth.example.test/",
    openIdReturnUrl: "https://auth.example.test/v1/auth/steam/callback",
    storageDriver: "memory",
    sessionSecret: SECRET,
    logLevel: "error", trustProxy: false, allowedOrigins: []
  };
  const server = createServer(createRouter({
    config,
    transactions: new AuthTransactionService(new InMemoryAuthTransactionRepository()),
    verifier: new SteamOpenIdVerifier({
      async checkAssertion() { return { ok: true, isValid: true }; }
    }, { realm: config.openIdRealm }),
    rateLimiter: new PollingRateLimiter(),
    logger: options?.logger ?? noOpLogger,
    authorization, sessions,
    badges: new BadgeService(badgeRepository),
    badgeAssets: new MemoryBadgeAssetStorage(),
    badgeAssignments: assignments,
    users
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    authorizationRepository, authorization, sessions, users,
    owner, member, moderator, administrator,
    ownerSession: await sessions.issueForSteamIdentity(owner.steamId64, "2026-07-30T12:00:00.000Z"),
    memberSession: await sessions.issueForSteamIdentity(member.steamId64, "2026-07-30T13:00:00.000Z"),
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
