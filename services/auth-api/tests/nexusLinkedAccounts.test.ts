import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthorizationRepository } from "../src/authorization/authorizationRepository.ts";
import { SessionTokenService } from "../src/authorization/sessionTokenService.ts";
import { loadPostgresMigrations } from "../src/storage/postgres/migrationRunner.ts";
import {
  InMemoryLinkedAccountRepository,
  LinkedAccountUniqueViolation,
  type LinkedPlatformAccountRecord
} from "../src/nexus/linkedAccountRepository.ts";
import {
  LinkedAccountConflictError,
  NexusLinkedAccountService
} from "../src/nexus/linkedAccountService.ts";

const SECRET = "n".repeat(48);
const STEAM_A = "76561190000000001";
const STEAM_B = "76561190000000002";
const NOW = "2026-08-22T00:00:00.000Z";

function record(
  overrides: Partial<LinkedPlatformAccountRecord> = {}
): LinkedPlatformAccountRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "user-a",
    provider: "steam",
    providerUserId: STEAM_A,
    connectionStatus: "connected",
    scopes: [],
    linkedAt: NOW,
    ...overrides
  };
}

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

// ---------------------------------------------------------------------------
// Migration 020
// ---------------------------------------------------------------------------

test("migration 020 creates linked_platform_accounts with the approved invariants", async () => {
  const migrations = await loadPostgresMigrations();
  const linked = migrations.find((item) => item.version === 20);
  assert.ok(linked, "migration 020 is missing");
  assert.equal(linked.name, "020_nexus_linked_platform_accounts.sql");

  const sql = linked.sql;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS linked_platform_accounts/);
  assert.match(sql, /user_id\s+uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /CHECK \(provider IN \('steam', 'xbox', 'playstation'\)\)/);
  for (const column of [
    "provider_user_id", "display_name", "avatar_url", "connection_status",
    "scopes", "linked_at", "last_sync_at", "last_sync_status", "revoked_at"
  ]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`), `020 must define ${column}`);
  }
  // revoked_at IS NULL is the single definition of "active", so the terminal
  // statuses and the timestamp can never disagree.
  assert.match(
    sql,
    /CONSTRAINT linked_platform_accounts_revocation_consistency CHECK \(\s*\(connection_status IN \('revoked', 'disconnected'\)\) = \(revoked_at IS NOT NULL\)/
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_provider_identity_uniq[\s\S]*\(provider, provider_user_id\)[\s\S]*WHERE revoked_at IS NULL/
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_one_per_provider_uniq[\s\S]*\(user_id, provider\)[\s\S]*WHERE revoked_at IS NULL/
  );
});

test("migration 020 backfills additively and never rewrites the authoritative identity", async () => {
  const migrations = await loadPostgresMigrations();
  const sql = migrations.find((item) => item.version === 20)?.sql ?? "";

  assert.match(sql, /INSERT INTO linked_platform_accounts[\s\S]*FROM users u/);
  // Deterministic identity: a replay derives the same primary key instead of a
  // second link for the same user.
  assert.match(sql, /md5\('nexus:linked-platform-account:steam:' \|\| u\.id::text\)\)::uuid/);
  assert.match(sql, /trim\(u\.steam_id64\) ~ '\^\[0-9\]\{17\}\$'/);
  assert.match(sql, /'connected'/);
  assert.match(sql, /'\{\}'::text\[\]/);
  assert.match(
    sql,
    /NOT EXISTS[\s\S]*existing\.user_id = u\.id[\s\S]*existing\.provider = 'steam'[\s\S]*existing\.provider_user_id = trim\(u\.steam_id64\)[\s\S]*existing\.revoked_at IS NULL/
  );
  // Replay safety is scoped to the deterministic primary key only. Conflicts
  // on the active provider/user unique indexes must surface and stop migration.
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/);
  assert.doesNotMatch(sql, /ON CONFLICT DO NOTHING/);

  // Additive only. Executable statements are inspected because the comments
  // deliberately discuss what is NOT done.
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(statements, /DELETE\s+FROM\s+users/i);
  assert.doesNotMatch(statements, /UPDATE\s+users\b/i);
  assert.doesNotMatch(statements, /ALTER\s+TABLE\s+users\b/i);
  assert.doesNotMatch(statements, /DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i);
  assert.doesNotMatch(statements, /desktop_sessions|user_roles|role_permissions/i);
  // The credential store is deferred; no catalog tables in this phase either.
  assert.doesNotMatch(
    statements,
    /provider_credentials|canonical_games|platform_games|platform_achievements/i
  );
});

// ---------------------------------------------------------------------------
// Active-uniqueness invariants
// ---------------------------------------------------------------------------

test("one provider identity stays attached to at most one Nexus user", async () => {
  const repository = new InMemoryLinkedAccountRepository();
  await repository.insert(record());
  await assert.rejects(
    () =>
      repository.insert(
        record({ id: "22222222-2222-4222-8222-222222222222", userId: "user-b" })
      ),
    (error: unknown) =>
      error instanceof LinkedAccountUniqueViolation &&
      error.slot === "provider_identity"
  );
});

test("a Nexus user holds at most one active Steam account", async () => {
  const repository = new InMemoryLinkedAccountRepository();
  await repository.insert(record());
  await assert.rejects(
    () =>
      repository.insert(
        record({
          id: "22222222-2222-4222-8222-222222222222",
          providerUserId: STEAM_B
        })
      ),
    (error: unknown) =>
      error instanceof LinkedAccountUniqueViolation &&
      error.slot === "user_provider"
  );
});

test("a disconnected or revoked link frees both active uniqueness slots", async () => {
  const repository = new InMemoryLinkedAccountRepository();
  await repository.insert(record());
  await repository.revoke(record().id, "2026-08-23T00:00:00.000Z");

  assert.equal(
    await repository.findActiveByProviderIdentity("steam", STEAM_A),
    undefined
  );
  assert.equal(
    await repository.findActiveByUserAndProvider("user-a", "steam"),
    undefined
  );
  // The same identity may be relinked, and the audit row survives.
  await repository.insert(
    record({ id: "33333333-3333-4333-8333-333333333333", userId: "user-b" })
  );
  assert.equal((await repository.listByUser("user-a")).length, 1);
  assert.equal((await repository.listByUser("user-b")).length, 1);
});

// ---------------------------------------------------------------------------
// ensureSteamLinkedAccount
// ---------------------------------------------------------------------------

test("ensureSteamLinkedAccount is idempotent and refreshes profile data only", async () => {
  const repository = new InMemoryLinkedAccountRepository();
  const service = new NexusLinkedAccountService(repository);

  const created = await service.ensureSteamLinkedAccount({
    userId: "user-a",
    steamId64: STEAM_A
  });
  assert.equal(created.status, "created");
  assert.equal(created.account.connectionStatus, "connected");
  assert.deepEqual([...created.account.scopes], []);
  assert.equal(created.account.credentialMetadata, undefined);

  const again = await service.ensureSteamLinkedAccount({
    userId: "user-a",
    steamId64: STEAM_A
  });
  assert.equal(again.status, "unchanged");
  assert.equal(again.account.id, created.account.id);
  assert.equal((await repository.listByUser("user-a")).length, 1);

  const refreshed = await service.ensureSteamLinkedAccount({
    userId: "user-a",
    steamId64: STEAM_A,
    profile: { displayName: "Player One" }
  });
  assert.equal(refreshed.status, "updated");
  assert.equal(refreshed.account.displayName, "Player One");
  assert.equal((await repository.listByUser("user-a")).length, 1);
});

test("a Steam identity is never silently moved to another Nexus user", async () => {
  const repository = new InMemoryLinkedAccountRepository();
  const service = new NexusLinkedAccountService(repository);
  await service.ensureSteamLinkedAccount({ userId: "user-a", steamId64: STEAM_A });

  await assert.rejects(
    () => service.ensureSteamLinkedAccount({ userId: "user-b", steamId64: STEAM_A }),
    (error: unknown) =>
      error instanceof LinkedAccountConflictError &&
      error.code === "PROVIDER_IDENTITY_OWNED_BY_ANOTHER_USER"
  );
  // The original ownership is untouched.
  const owner = await repository.findActiveByProviderIdentity("steam", STEAM_A);
  assert.equal(owner?.userId, "user-a");
  assert.equal((await repository.listByUser("user-b")).length, 0);
});

test("a Nexus user never silently acquires a second Steam identity", async () => {
  const repository = new InMemoryLinkedAccountRepository();
  const service = new NexusLinkedAccountService(repository);
  await service.ensureSteamLinkedAccount({ userId: "user-a", steamId64: STEAM_A });

  await assert.rejects(
    () => service.ensureSteamLinkedAccount({ userId: "user-a", steamId64: STEAM_B }),
    (error: unknown) =>
      error instanceof LinkedAccountConflictError &&
      error.code === "USER_ALREADY_LINKED_TO_ANOTHER_PROVIDER_IDENTITY"
  );
  const existing = await repository.findActiveByUserAndProvider("user-a", "steam");
  assert.equal(existing?.providerUserId, STEAM_A);
});

test("a malformed Steam identity is rejected before any write", async () => {
  const repository = new InMemoryLinkedAccountRepository();
  const service = new NexusLinkedAccountService(repository);
  await assert.rejects(
    () => service.ensureSteamLinkedAccount({ userId: "user-a", steamId64: "not-a-steam-id" }),
    (error: unknown) =>
      error instanceof LinkedAccountConflictError &&
      error.code === "INVALID_PROVIDER_IDENTITY"
  );
  assert.equal((await repository.listByUser("user-a")).length, 0);
});

test("a lost concurrency race resolves to the winning row instead of a duplicate", async () => {
  // Simulates two simultaneous logins: the first read misses, the insert then
  // loses to the unique index. The constraint stays authoritative and the
  // service re-derives the outcome from the row that actually won.
  class StaleReadRepository extends InMemoryLinkedAccountRepository {
    reads = 0;
    async findActiveByProviderIdentity(provider: "steam" | "xbox" | "playstation", providerUserId: string) {
      this.reads += 1;
      if (this.reads <= 1) return undefined;
      return super.findActiveByProviderIdentity(provider, providerUserId);
    }
    async findActiveByUserAndProvider(userId: string, provider: "steam" | "xbox" | "playstation") {
      if (this.reads <= 1) return undefined;
      return super.findActiveByUserAndProvider(userId, provider);
    }
  }

  const repository = new StaleReadRepository();
  const winner = record({ id: "44444444-4444-4444-8444-444444444444" });
  repository.records.set(winner.id, winner);

  const service = new NexusLinkedAccountService(repository);
  const result = await service.ensureSteamLinkedAccount({
    userId: "user-a",
    steamId64: STEAM_A
  });
  assert.equal(result.status, "unchanged");
  assert.equal(result.account.id, winner.id);
  assert.equal(repository.records.size, 1);
});

// ---------------------------------------------------------------------------
// Steam dual-write integration point
// ---------------------------------------------------------------------------

async function issueSteamSession(hook?: NexusLinkedAccountService) {
  const authRepository = new InMemoryAuthorizationRepository();
  const linkedAccounts = new InMemoryLinkedAccountRepository();
  const service = hook ?? new NexusLinkedAccountService(linkedAccounts);
  const sessions = new SessionTokenService(
    SECRET,
    authRepository,
    Date.now,
    undefined,
    hook
      ? async ({ userId, steamId64 }) => {
          await service.ensureSteamLinkedAccount({ userId, steamId64 });
        }
      : undefined
  );
  return { authRepository, linkedAccounts, service, sessions };
}

test("dual-write OFF leaves Steam authentication exactly as before", async () => {
  const { linkedAccounts, sessions, authRepository } = await issueSteamSession();
  const issued = await sessions.issueForSteamIdentity(STEAM_A, NOW);

  const user = await authRepository.findUserBySteamId(STEAM_A);
  assert.ok(user, "the Steam identity must still resolve a Nexus user");
  // Session identity is still users.id, never a linked-account id.
  assert.equal(issued.userId, user.id);
  assert.equal(claimsOf(issued.token).sub, user.id);
  assert.equal(issued.sessionEpoch, user.sessionEpoch);
  // No linked-account row is written while the flag is off.
  assert.equal((await linkedAccounts.listByUser(user.id)).length, 0);
});

test("dual-write ON adds the Steam link without changing session semantics", async () => {
  const repository = new InMemoryLinkedAccountRepository();
  const service = new NexusLinkedAccountService(repository);
  const authRepository = new InMemoryAuthorizationRepository();
  const sessions = new SessionTokenService(
    SECRET,
    authRepository,
    Date.now,
    undefined,
    async ({ userId, steamId64 }) => {
      await service.ensureSteamLinkedAccount({ userId, steamId64 });
    }
  );

  const issued = await sessions.issueForSteamIdentity(STEAM_A, NOW);
  const user = await authRepository.findUserBySteamId(STEAM_A);
  assert.ok(user);

  const linked = await repository.findActiveByUserAndProvider(user.id, "steam");
  assert.ok(linked, "the Steam link must exist once dual-write is enabled");
  assert.equal(linked.providerUserId, STEAM_A);
  assert.equal(linked.connectionStatus, "connected");
  assert.deepEqual([...linked.scopes], []);
  assert.equal(linked.revokedAt, undefined);
  // users.id remains the session subject; the link is additive metadata.
  assert.equal(issued.userId, user.id);
  assert.equal(claimsOf(issued.token).sub, user.id);
  assert.notEqual(linked.id, user.id);
});

test("repeated Steam logins create no duplicate linked account", async () => {
  const repository = new InMemoryLinkedAccountRepository();
  const service = new NexusLinkedAccountService(repository);
  const authRepository = new InMemoryAuthorizationRepository();
  const sessions = new SessionTokenService(
    SECRET,
    authRepository,
    Date.now,
    undefined,
    async ({ userId, steamId64 }) => {
      await service.ensureSteamLinkedAccount({ userId, steamId64 });
    }
  );

  const first = await sessions.issueForSteamIdentity(STEAM_A, NOW);
  const second = await sessions.issueForSteamIdentity(STEAM_A, "2026-08-23T00:00:00.000Z");
  const third = await sessions.issueForSteamIdentity(STEAM_A, "2026-08-24T00:00:00.000Z");

  const user = await authRepository.findUserBySteamId(STEAM_A);
  assert.ok(user);
  assert.equal((await repository.listByUser(user.id)).length, 1);
  for (const issued of [first, second, third]) {
    assert.equal(issued.userId, user.id);
  }
});

test("the token shape is identical whether or not dual-write is enabled", async () => {
  const authOff = new InMemoryAuthorizationRepository();
  const off = new SessionTokenService(SECRET, authOff, () => 1_800_000_000_000);

  const repository = new InMemoryLinkedAccountRepository();
  const service = new NexusLinkedAccountService(repository);
  const authOn = new InMemoryAuthorizationRepository();
  const on = new SessionTokenService(
    SECRET,
    authOn,
    () => 1_800_000_000_000,
    undefined,
    async ({ userId, steamId64 }) => {
      await service.ensureSteamLinkedAccount({ userId, steamId64 });
    }
  );

  const issuedOff = await off.issueForSteamIdentity(STEAM_A, NOW);
  const issuedOn = await on.issueForSteamIdentity(STEAM_A, NOW);
  const claimsOff = claimsOf(issuedOff.token);
  const claimsOn = claimsOf(issuedOn.token);

  assert.deepEqual(Object.keys(claimsOff).sort(), Object.keys(claimsOn).sort());
  assert.equal(issuedOff.expiresAt, issuedOn.expiresAt);
  assert.equal(claimsOff.exp, claimsOn.exp);
  assert.equal(claimsOff.iat, claimsOn.iat);
  assert.equal(claimsOff.epc, claimsOn.epc);
  assert.equal(issuedOff.token.split(".").length, issuedOn.token.split(".").length);
  // Both sessions still authenticate through the unchanged bearer path.
  const user = await authOn.findUserBySteamId(STEAM_A);
  assert.ok(user);
  const authenticated = await on.authenticateBearer(`Bearer ${issuedOn.token}`);
  assert.equal(authenticated.id, user.id);
});

test("a linked-account failure never breaks Steam authentication", async () => {
  // The hook is wired non-fatally on purpose: an integrity conflict must be an
  // operational signal, not a login outage.
  const authRepository = new InMemoryAuthorizationRepository();
  const sessions = new SessionTokenService(
    SECRET,
    authRepository,
    Date.now,
    undefined,
    async () => {
      throw new LinkedAccountConflictError("PROVIDER_IDENTITY_OWNED_BY_ANOTHER_USER");
    }
  );

  const issued = await sessions.issueForSteamIdentity(STEAM_A, NOW);
  const user = await authRepository.findUserBySteamId(STEAM_A);
  assert.ok(user);
  assert.equal(issued.userId, user.id);
  assert.equal(claimsOf(issued.token).sub, user.id);
});
