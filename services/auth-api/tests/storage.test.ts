import assert from "node:assert/strict";
import test from "node:test";
import type { AuthTransaction } from "../src/auth/authTransaction.ts";
import { InMemoryAuthTransactionRepository } from "../src/storage/authRepository.ts";
import { startStorageCleanup } from "../src/storage/cleanupJob.ts";
import { loadPostgresMigrations } from "../src/storage/postgres/migrationRunner.ts";
import { PERMISSION_KEYS } from "../src/authorization/permissions.ts";
import { rolePresets } from "../src/authorization/roles.ts";
import { readFile } from "node:fs/promises";

function transaction(overrides: Partial<AuthTransaction> = {}): AuthTransaction {
  return {
    authRequestId: "9fa6a58f-f626-493d-921c-e640169ba48f",
    pollSecretHash: "a".repeat(64),
    deviceIdHash: "b".repeat(64),
    createdAt: "2026-07-27T00:00:00.000Z",
    expiresAt: "2026-07-27T00:10:00.000Z",
    status: "pending",
    returnTo: "https://auth.example.test/callback?transaction=public",
    version: 0,
    ...overrides
  };
}

test("in-memory repository atomically reserves a nonce and verifies once", async () => {
  const repository = new InMemoryAuthTransactionRepository();
  await repository.create(transaction());
  const input = {
    authRequestId: transaction().authRequestId,
    steamId: "76561198000000000",
    nonceHash: "c".repeat(64),
    nonceExpiresAt: "2026-07-27T00:12:00.000Z",
    verifiedAt: "2026-07-27T00:01:00.000Z"
  };
  const results = await Promise.all([
    repository.verifyWithNonce(input),
    repository.verifyWithNonce(input)
  ]);
  assert.deepEqual(results.sort(), ["not_pending", "verified"]);
});

test("cleanup is bounded and removes retained terminal memory records", async () => {
  const repository = new InMemoryAuthTransactionRepository();
  await repository.create(transaction({ status: "failed" }));
  const cleanup = startStorageCleanup(repository, {
    now: () => Date.parse("2026-07-29T00:00:00.000Z")
  });
  cleanup.stop();
  await cleanup.run();
  assert.equal(await repository.find(transaction().authRequestId), undefined);
});

test("PostgreSQL migrations are ordered and contain no secret-bearing columns", async () => {
  const migrations = await loadPostgresMigrations();
  assert.deepEqual(migrations.map((item) => item.version), [1, 2, 3, 4, 5, 6, 7]);
  const sql = migrations.map((item) => item.sql).join("\n").toLowerCase();
  assert.match(sql, /poll_secret_hash/);
  assert.match(sql, /nonce_hash/);
  assert.doesNotMatch(sql, /\bpoll_secret\b(?!_hash)/);
  assert.doesNotMatch(sql, /assertion|api_key|session_token|access_token/);
  assert.match(sql, /create table roles/);
  assert.match(sql, /create table permissions/);
  assert.match(sql, /create table audit_events/);
  assert.match(sql, /create table badge_asset_cleanup_jobs/);
  assert.match(sql, /create table badge_assignments/);
  assert.match(sql, /badge_assignments_active_unique/);
  for (const key of PERMISSION_KEYS) assert.match(sql, new RegExp(`'${key.replace(".", "\\.")}'`));
  for (const role of rolePresets) assert.match(sql, new RegExp(`'${role.slug}'`));
});

test("authorization schema validation derives its permission count from the registry", async () => {
  const source = await readFile(
    new URL("../src/storage/postgres/postgresAuthorizationRepository.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /PERMISSION_KEYS\.length/);
  assert.equal(PERMISSION_KEYS.length, 19);
  assert.doesNotMatch(source, /permissions\[0\]\?\.count\)\s*!==\s*18/);
});
