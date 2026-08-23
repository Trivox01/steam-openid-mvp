import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PostgresAuthorizationRepository } from "../src/storage/postgres/postgresAuthorizationRepository.ts";
import { loadPostgresMigrations, runPostgresMigrations } from "../src/storage/postgres/migrationRunner.ts";
import { PostgresLinkedAccountRepository } from "../src/nexus/linkedAccountRepository.ts";
import { NexusSteamIdentityResolver, SteamIdentityResolutionError } from "../src/nexus/steamIdentityResolver.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "[::1]", "postgres"];
const STEAM_A = "76561198000009001";
const STEAM_B = "76561198000009002";
const STEAM_C = "76561198000009003";
const NOW = "2026-08-23T00:00:00.000Z";

test("Phase 2B dual-read identity resolution on PostgreSQL", {
  skip: databaseUrl ? false : "TEST_DATABASE_URL is not configured"
}, async () => {
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.ok(LOCAL_HOSTNAMES.includes(target.hostname), "TEST_DATABASE_URL must point at a local or ephemeral CI PostgreSQL host");
  const schema = `nir_gate_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  try {
    await runPostgresMigrations(pool, await loadPostgresMigrations());
    const users = new PostgresAuthorizationRepository(pool);
    const links = new PostgresLinkedAccountRepository(pool);
    const resolver = new NexusSteamIdentityResolver(users, links);
    const userA = await users.ensureAuthenticatedUser(STEAM_A, NOW);
    const userB = await users.ensureAuthenticatedUser(STEAM_B, NOW);

    await links.insert({ id: randomUUID(), userId: userA.id, provider: "steam", providerUserId: STEAM_A, connectionStatus: "connected", scopes: [], linkedAt: NOW });
    const linked = await resolver.resolve({ steamId64: STEAM_A, authenticatedAt: NOW });
    assert.equal(linked.source, "linked_account");
    assert.equal(linked.user.id, userA.id);

    const fallback = await resolver.resolve({ steamId64: STEAM_C, authenticatedAt: NOW });
    assert.equal(fallback.source, "legacy_fallback");
    assert.equal(fallback.user.steamId64, STEAM_C);
    assert.equal((await links.listByUser(fallback.user.id)).length, 0);

    const linkCountBefore = (await pool.query<{ count: string }>("SELECT count(*) FROM linked_platform_accounts")).rows[0].count;
    await resolver.resolve({ steamId64: STEAM_A, authenticatedAt: NOW });
    assert.equal((await pool.query<{ count: string }>("SELECT count(*) FROM linked_platform_accounts")).rows[0].count, linkCountBefore);

    await links.insert({ id: randomUUID(), userId: userB.id, provider: "steam", providerUserId: STEAM_C, connectionStatus: "connected", scopes: [], linkedAt: NOW });
    await assert.rejects(() => resolver.resolve({ steamId64: STEAM_C, authenticatedAt: NOW }), (error: unknown) => error instanceof SteamIdentityResolutionError && error.code === "IDENTITY_MAPPING_CONFLICT");
    assert.equal((await users.findUserBySteamId(STEAM_A))?.id, userA.id);
    assert.equal((await users.findUserBySteamId(STEAM_B))?.id, userB.id);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
