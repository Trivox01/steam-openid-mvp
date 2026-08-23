import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthorizationRepository } from "../src/authorization/authorizationRepository.ts";
import { SessionTokenService } from "../src/authorization/sessionTokenService.ts";
import {
  ConfigurationError,
  loadAuthApiConfig
} from "../src/config.ts";
import { InMemoryLinkedAccountRepository } from "../src/nexus/linkedAccountRepository.ts";
import {
  NexusSteamIdentityResolver,
  SteamIdentityResolutionError
} from "../src/nexus/steamIdentityResolver.ts";

const SECRET = "identity-resolution-test-secret-0123456789abcdef";
const STEAM_A = "76561190000000101";
const STEAM_B = "76561190000000102";
const NOW = "2026-08-23T00:00:00.000Z";

const VALID_ENV = {
  NODE_ENV: "test",
  PORT: "8787",
  PUBLIC_BASE_URL: "https://auth.example.test",
  OPENID_REALM: "https://auth.example.test/",
  OPENID_RETURN_URL: "https://auth.example.test/v1/auth/steam/callback",
  AUTH_STORAGE_DRIVER: "memory",
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
  LOG_LEVEL: "error",
  TRUST_PROXY: "false",
  ALLOWED_ORIGINS: ""
};

function claimsOf(token: string) {
  const [payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub: string;
    iat: number;
    exp: number;
    jti: string;
    epc?: number;
  };
}

test("identity resolution flag defaults to the exact legacy path", () => {
  const config = loadAuthApiConfig(VALID_ENV);
  assert.equal(config.nexusLinkedAccountsIdentityResolutionEnabled, undefined);
});

test("identity resolution flag is explicit and malformed values fail closed", () => {
  assert.equal(
    loadAuthApiConfig({
      ...VALID_ENV,
      NEXUS_LINKED_ACCOUNTS_IDENTITY_RESOLUTION_ENABLED: "true"
    }).nexusLinkedAccountsIdentityResolutionEnabled,
    true
  );
  assert.throws(
    () => loadAuthApiConfig({
      ...VALID_ENV,
      NEXUS_LINKED_ACCOUNTS_IDENTITY_RESOLUTION_ENABLED: "dual_read"
    }),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.code === "invalid_NEXUS_LINKED_ACCOUNTS_IDENTITY_RESOLUTION_ENABLED"
  );
});

test("dual_read prefers the active linked account when both mappings agree", async () => {
  const authorization = new InMemoryAuthorizationRepository();
  const linkedAccounts = new InMemoryLinkedAccountRepository();
  const user = await authorization.ensureAuthenticatedUser(STEAM_A, NOW);
  await linkedAccounts.insert({
    id: "11111111-1111-4111-8111-111111111111",
    userId: user.id,
    provider: "steam",
    providerUserId: STEAM_A,
    connectionStatus: "connected",
    scopes: [],
    linkedAt: NOW
  });
  const resolver = new NexusSteamIdentityResolver(
    authorization,
    linkedAccounts
  );

  const resolved = await resolver.resolve({
    steamId64: STEAM_A,
    authenticatedAt: NOW
  });
  assert.equal(resolved.source, "linked_account");
  assert.equal(resolved.user.id, user.id);
});

test("dual_read falls back to the legacy resolver only when no active link exists", async () => {
  const authorization = new InMemoryAuthorizationRepository();
  const linkedAccounts = new InMemoryLinkedAccountRepository();
  const resolver = new NexusSteamIdentityResolver(
    authorization,
    linkedAccounts
  );

  const resolved = await resolver.resolve({
    steamId64: STEAM_A,
    authenticatedAt: NOW
  });
  assert.equal(resolved.source, "legacy_fallback");
  assert.equal(resolved.user.steamId64, STEAM_A);
  assert.equal((await linkedAccounts.listByUser(resolved.user.id)).length, 0);
});

test("linked mapping disagreement fails closed and never moves either identity", async () => {
  const authorization = new InMemoryAuthorizationRepository();
  const linkedAccounts = new InMemoryLinkedAccountRepository();
  const userA = await authorization.ensureAuthenticatedUser(STEAM_A, NOW);
  const userB = await authorization.ensureAuthenticatedUser(STEAM_B, NOW);
  await linkedAccounts.insert({
    id: "22222222-2222-4222-8222-222222222222",
    userId: userB.id,
    provider: "steam",
    providerUserId: STEAM_A,
    connectionStatus: "connected",
    scopes: [],
    linkedAt: NOW
  });
  const resolver = new NexusSteamIdentityResolver(
    authorization,
    linkedAccounts
  );

  await assert.rejects(
    () => resolver.resolve({ steamId64: STEAM_A, authenticatedAt: NOW }),
    (error: unknown) =>
      error instanceof SteamIdentityResolutionError &&
      error.code === "IDENTITY_MAPPING_CONFLICT"
  );
  assert.equal((await authorization.findUserBySteamId(STEAM_A))?.id, userA.id);
  assert.equal((await authorization.findUserBySteamId(STEAM_B))?.id, userB.id);
  assert.equal(
    (await linkedAccounts.findActiveByProviderIdentity("steam", STEAM_A))?.userId,
    userB.id
  );
});

test("linked mapping conflict cannot create a missing legacy Steam user", async () => {
  const authorization = new InMemoryAuthorizationRepository();
  const linkedAccounts = new InMemoryLinkedAccountRepository();
  const userB = await authorization.ensureAuthenticatedUser(STEAM_B, NOW);
  await linkedAccounts.insert({
    id: "44444444-4444-4444-8444-444444444444",
    userId: userB.id,
    provider: "steam",
    providerUserId: STEAM_A,
    connectionStatus: "connected",
    scopes: [],
    linkedAt: NOW
  });
  const resolver = new NexusSteamIdentityResolver(
    authorization,
    linkedAccounts
  );

  await assert.rejects(
    () => resolver.resolve({ steamId64: STEAM_A, authenticatedAt: NOW }),
    (error: unknown) =>
      error instanceof SteamIdentityResolutionError &&
      error.code === "IDENTITY_MAPPING_CONFLICT"
  );
  assert.equal(await authorization.findUserBySteamId(STEAM_A), undefined);
  assert.equal((await authorization.findUserBySteamId(STEAM_B))?.id, userB.id);
});

test("SessionTokenService keeps users.id as subject under linked resolution", async () => {
  const authorization = new InMemoryAuthorizationRepository();
  const linkedAccounts = new InMemoryLinkedAccountRepository();
  const user = await authorization.ensureAuthenticatedUser(STEAM_A, NOW);
  await linkedAccounts.insert({
    id: "33333333-3333-4333-8333-333333333333",
    userId: user.id,
    provider: "steam",
    providerUserId: STEAM_A,
    connectionStatus: "connected",
    scopes: [],
    linkedAt: NOW
  });
  const resolver = new NexusSteamIdentityResolver(
    authorization,
    linkedAccounts
  );
  const sessions = new SessionTokenService(
    SECRET,
    authorization,
    () => 1_800_000_000_000,
    undefined,
    undefined,
    async (input) => (await resolver.resolve(input)).user
  );

  const issued = await sessions.issueForSteamIdentity(STEAM_A, NOW);
  assert.equal(issued.userId, user.id);
  assert.equal(claimsOf(issued.token).sub, user.id);
  assert.notEqual(user.id, "33333333-3333-4333-8333-333333333333");
  const authenticated = await sessions.authenticateBearer(`Bearer ${issued.token}`);
  assert.equal(authenticated.id, user.id);
});

test("legacy SessionTokenService behavior remains unchanged when no resolver is injected", async () => {
  const authorization = new InMemoryAuthorizationRepository();
  const sessions = new SessionTokenService(
    SECRET,
    authorization,
    () => 1_800_000_000_000
  );
  const issued = await sessions.issueForSteamIdentity(STEAM_A, NOW);
  const user = await authorization.findUserBySteamId(STEAM_A);
  assert.ok(user);
  assert.equal(issued.userId, user.id);
  assert.equal(claimsOf(issued.token).sub, user.id);
});
