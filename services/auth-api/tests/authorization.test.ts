import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { AuthTransactionService } from "../src/auth/authTransactionService.ts";
import type { AuthApiConfig } from "../src/config.ts";
import {
  InMemoryAuthorizationRepository
} from "../src/authorization/authorizationRepository.ts";
import { AuthorizationService } from "../src/authorization/authorizationService.ts";
import { AuthorizationError } from "../src/authorization/contracts.ts";
import {
  PERMISSION_KEYS,
  permissionRegistry
} from "../src/authorization/permissions.ts";
import {
  defaultRolePermissions,
  rolePresets
} from "../src/authorization/roles.ts";
import { SessionTokenService } from "../src/authorization/sessionTokenService.ts";
import {
  ME_AUTHORIZATION_PATH,
  authorizationErrorStatus
} from "../src/routes/meAuthorization.ts";
import { createRouter } from "../src/router.ts";
import { PollingRateLimiter } from "../src/security/pollingRateLimiter.ts";
import { noOpLogger } from "../src/security/safeLogger.ts";
import { SteamOpenIdVerifier } from "../src/steam/openIdVerifier.ts";
import { InMemoryAuthTransactionRepository } from "../src/storage/authRepository.ts";

const OWNER_STEAM_ID = "76561198000000001";
const ADMIN_STEAM_ID = "76561198000000002";
const USER_STEAM_ID = "76561198000000003";
const AUTHENTICATED_AT = "2026-07-28T12:00:00.000Z";

test("registry contains unique permissions and the five ordered system roles", () => {
  assert.equal(new Set(PERMISSION_KEYS).size, PERMISSION_KEYS.length);
  assert.equal(new Set(permissionRegistry.map((item) => item.key)).size, PERMISSION_KEYS.length);
  assert.deepEqual(
    rolePresets.map(({ slug, priority }) => [slug, priority]),
    [
      ["owner", 100],
      ["administrator", 80],
      ["developer", 60],
      ["moderator", 40],
      ["assistant", 20]
    ]
  );
});

test("default role grants preserve least privilege boundaries", () => {
  assert.deepEqual(new Set(defaultRolePermissions.owner), new Set(PERMISSION_KEYS));
  assert.equal(defaultRolePermissions.developer.includes("roles.manage_permissions"), false);
  assert.equal(defaultRolePermissions.moderator.includes("settings.edit"), false);
  assert.equal(defaultRolePermissions.assistant.length <
    defaultRolePermissions.moderator.length, true);
});

test("owner bootstrap is optional, requires an existing user, and runs once", async () => {
  const { repository, service } = setup();
  assert.equal(await service.bootstrapOwner(undefined), "not_configured");
  assert.equal(await service.bootstrapOwner(OWNER_STEAM_ID), "user_not_found");
  const owner = await repository.ensureAuthenticatedUser(OWNER_STEAM_ID, AUTHENTICATED_AT);
  assert.equal(await service.bootstrapOwner(OWNER_STEAM_ID), "assigned");
  assert.equal(await service.bootstrapOwner(OWNER_STEAM_ID), "owner_exists");
  assert.equal((await service.getUserRoles(owner.id))[0].slug, "owner");
  assert.equal(repository.auditEvents.filter((event) =>
    event.action === "authorization.bootstrap_owner").length, 1);
});

test("permission resolution applies deny, then allow, then role, then default deny", async () => {
  const { repository, service } = setup();
  const owner = await repository.ensureAuthenticatedUser(OWNER_STEAM_ID, AUTHENTICATED_AT);
  const user = await repository.ensureAuthenticatedUser(USER_STEAM_ID, AUTHENTICATED_AT);
  const developer = await repository.findRoleBySlug("developer");
  assert.ok(developer);
  await repository.assignRole({ userId: user.id, roleId: developer.id, assignedByUserId: owner.id });
  await repository.addPermissionOverride({
    userId: user.id,
    permission: "settings.edit",
    effect: "allow",
    assignedByUserId: owner.id
  });
  await repository.addPermissionOverride({
    userId: user.id,
    permission: "developer.tools",
    effect: "deny",
    assignedByUserId: owner.id
  });
  assert.equal(await service.hasPermission(user.id, "settings.edit"), true);
  assert.equal(await service.hasPermission(user.id, "developer.tools"), false);
  assert.equal(await service.hasPermission(user.id, "roles.assign"), false);
});

test("hierarchy prevents owner assignment, equal-rank management, and self escalation", async () => {
  const { repository, service } = setup();
  const owner = await repository.ensureAuthenticatedUser(OWNER_STEAM_ID, AUTHENTICATED_AT);
  const admin = await repository.ensureAuthenticatedUser(ADMIN_STEAM_ID, AUTHENTICATED_AT);
  const user = await repository.ensureAuthenticatedUser(USER_STEAM_ID, AUTHENTICATED_AT);
  const ownerRole = await repository.findRoleBySlug("owner");
  const adminRole = await repository.findRoleBySlug("administrator");
  assert.ok(ownerRole && adminRole);
  await repository.assignRole({ userId: owner.id, roleId: ownerRole.id });
  await repository.assignRole({ userId: admin.id, roleId: adminRole.id, assignedByUserId: owner.id });
  assert.equal(await service.canAssignRole(admin.id, ownerRole.id), false);
  assert.equal(await service.canAssignRole(admin.id, adminRole.id), false);
  assert.equal(await service.canManageUser(admin.id, owner.id), false);
  await assert.rejects(
    service.requireRolePermissionMutation(owner.id, adminRole.id),
    (error: unknown) =>
      error instanceof AuthorizationError &&
      error.code === "PROTECTED_ROLE"
  );
  await assert.rejects(
    service.assignRole(admin.id, admin.id, adminRole.id),
    (error: unknown) =>
      error instanceof AuthorizationError &&
      error.code === "SELF_PRIVILEGE_CHANGE_DENIED"
  );
  assert.equal(await service.canManageUser(owner.id, user.id), true);
});

test("audit metadata drops secret-bearing fields", async () => {
  const repository = new InMemoryAuthorizationRepository();
  await repository.writeAuditEvent({
    action: "authorization.denied_sensitive_action",
    targetType: "permission",
    metadata: {
      permission: "roles.assign",
      sessionToken: "must-not-survive",
      pollSecret: "must-not-survive",
      openidParameters: "must-not-survive"
    }
  });
  assert.deepEqual(repository.auditEvents[0].metadata, {
    permission: "roles.assign"
  });
});

test("sensitive authorization mutations write the required audit actions", async () => {
  const { repository, service } = setup();
  const owner = await repository.ensureAuthenticatedUser(OWNER_STEAM_ID, AUTHENTICATED_AT);
  const user = await repository.ensureAuthenticatedUser(USER_STEAM_ID, AUTHENTICATED_AT);
  const ownerRole = await repository.findRoleBySlug("owner");
  const assistantRole = await repository.findRoleBySlug("assistant");
  assert.ok(ownerRole && assistantRole);
  await repository.assignRole({ userId: owner.id, roleId: ownerRole.id });
  await service.assignRole(owner.id, user.id, assistantRole.id);
  await service.setPermissionOverride({
    actorId: owner.id,
    targetUserId: user.id,
    permission: "developer.tools",
    effect: "allow",
    reason: "test"
  });
  await service.revokePermissionOverride({
    actorId: owner.id,
    targetUserId: user.id,
    permission: "developer.tools"
  });
  await service.revokeRole(owner.id, user.id, assistantRole.id);
  assert.deepEqual(
    repository.auditEvents.map((event) => event.action),
    [
      "authorization.role_assigned",
      "authorization.permission_override_added",
      "authorization.permission_override_revoked",
      "authorization.role_revoked"
    ]
  );
});

test("/api/me/authorization requires authentication and returns only current-user authorization", async () => {
  const { repository, service, sessions } = setup();
  const owner = await repository.ensureAuthenticatedUser(OWNER_STEAM_ID, AUTHENTICATED_AT);
  const ownerRole = await repository.findRoleBySlug("owner");
  assert.ok(ownerRole);
  await repository.assignRole({ userId: owner.id, roleId: ownerRole.id });
  const issued = await sessions.issueForSteamIdentity(OWNER_STEAM_ID, AUTHENTICATED_AT);
  const harness = await startAuthorizationHarness(service, sessions);
  try {
    const unauthorized = await fetch(`${harness.baseUrl}${ME_AUTHORIZATION_PATH}`);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { error: "AUTHENTICATION_REQUIRED" });

    const response = await fetch(`${harness.baseUrl}${ME_AUTHORIZATION_PATH}`, {
      headers: {
        authorization: `Bearer ${issued.token}`,
        origin: "http://tauri.localhost"
      }
    });
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "http://tauri.localhost"
    );
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.canAccessDeveloperCenter, true);
    assert.deepEqual(body.roles, [{ slug: "owner", displayName: "Owner", priority: 100 }]);
    assert.equal(Array.isArray(body.permissions), true);
    assert.equal(JSON.stringify(body).includes(OWNER_STEAM_ID), false);
    assert.equal(JSON.stringify(body).includes(owner.id), false);
  } finally {
    await harness.close();
  }
});

test("session authentication ignores client supplied roles and permissions", async () => {
  const { repository, sessions } = setup();
  const user = await repository.ensureAuthenticatedUser(USER_STEAM_ID, AUTHENTICATED_AT);
  const issued = await sessions.issueForSteamIdentity(USER_STEAM_ID, AUTHENTICATED_AT);
  const authenticated = await sessions.authenticateBearer(
    `Bearer ${issued.token}`
  );
  assert.equal(authenticated.id, user.id);
  await assert.rejects(
    sessions.authenticateBearer("Bearer forged.roles.assign"),
    (error: unknown) =>
      error instanceof AuthorizationError &&
      error.code === "AUTHENTICATION_REQUIRED"
  );
  const expiredSessions = new SessionTokenService(
    "authorization-test-secret-0123456789-ABCDEF",
    repository,
    () => Date.parse(AUTHENTICATED_AT) + 16 * 60_000
  );
  await assert.rejects(
    expiredSessions.authenticateBearer(`Bearer ${issued.token}`),
    (error: unknown) =>
      error instanceof AuthorizationError &&
      error.code === "AUTHENTICATION_REQUIRED"
  );
});

test("HTTP authorization errors distinguish missing authentication from denied permission", () => {
  assert.equal(authorizationErrorStatus("AUTHENTICATION_REQUIRED"), 401);
  assert.equal(authorizationErrorStatus("PERMISSION_DENIED"), 403);
  assert.equal(authorizationErrorStatus("ROLE_ASSIGNMENT_DENIED"), 403);
});

function setup() {
  const repository = new InMemoryAuthorizationRepository();
  const now = () => Date.parse(AUTHENTICATED_AT);
  return {
    repository,
    service: new AuthorizationService(repository, now),
    sessions: new SessionTokenService(
      "authorization-test-secret-0123456789-ABCDEF",
      repository,
      now
    )
  };
}

async function startAuthorizationHarness(
  authorization: AuthorizationService,
  sessions: SessionTokenService
) {
  const config: AuthApiConfig = {
    nodeEnv: "test",
    port: 8787,
    publicBaseUrl: "https://auth.example.test",
    openIdRealm: "https://auth.example.test/",
    openIdReturnUrl: "https://auth.example.test/v1/auth/steam/callback",
    storageDriver: "memory",
    sessionSecret: "authorization-test-secret-0123456789-ABCDEF",
    logLevel: "error",
    trustProxy: false,
    allowedOrigins: ["http://tauri.localhost"]
  };
  const server = createServer(createRouter({
    config,
    transactions: new AuthTransactionService(new InMemoryAuthTransactionRepository()),
    verifier: new SteamOpenIdVerifier({
      async checkAssertion() { return { ok: true, isValid: true }; }
    }, { realm: config.openIdRealm }),
    rateLimiter: new PollingRateLimiter(),
    logger: noOpLogger,
    authorization,
    sessions
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
