import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { AuthTransactionService } from "../src/auth/authTransactionService.ts";
import {
  loadPostgresMigrations,
  runPostgresMigrations
} from "../src/storage/postgres/migrationRunner.ts";
import { PostgresAuthTransactionRepository } from "../src/storage/postgres/postgresAuthRepository.ts";
import { PostgresAuthorizationRepository } from "../src/storage/postgres/postgresAuthorizationRepository.ts";
import { AuthorizationService } from "../src/authorization/authorizationService.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL repository integration and concurrency", {
  skip: databaseUrl ? false : "TEST_DATABASE_URL is not configured"
}, async () => {
  assert.ok(databaseUrl);
  const schema = `openid_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`
  });
  try {
    await runPostgresMigrations(pool);
    await runPostgresMigrations(pool);
    const repository = new PostgresAuthTransactionRepository(pool);
    await repository.validateSchema();
    const authorizationRepository = new PostgresAuthorizationRepository(pool);
    const authorization = new AuthorizationService(authorizationRepository);
    const user = await authorizationRepository.ensureAuthenticatedUser(
      "76561198000000000",
      "2026-07-28T12:00:00.000Z"
    );
    assert.equal(await authorization.bootstrapOwner("76561198000000000"), "assigned");
    assert.equal(await authorization.bootstrapOwner("76561198000000000"), "owner_exists");
    assert.equal(await authorization.hasPermission(user.id, "admin.access"), true);
    const roleCount = await pool.query<{ count: string }>(
      "SELECT count(*) FROM roles WHERE is_system = true"
    );
    const permissionCount = await pool.query<{ count: string }>(
      "SELECT count(*) FROM permissions"
    );
    assert.equal(Number(roleCount.rows[0].count), 5);
    assert.equal(Number(permissionCount.rows[0].count), 18);
    const serviceA = new AuthTransactionService(repository);
    const serviceB = new AuthTransactionService(
      new PostgresAuthTransactionRepository(pool)
    );
    const first = await serviceA.start({
      returnToBase: "https://auth.example.test/callback",
      deviceId: "postgres-device-01"
    });
    assert.equal(
      (await serviceB.status(first.authRequestId, first.pollSecret)).status,
      "pending"
    );
    const race = await Promise.allSettled([
      serviceA.markVerified(
        first.authRequestId,
        "76561198000000000",
        "2026-07-28T12:00:00Zrace"
      ),
      serviceB.markVerified(
        first.authRequestId,
        "76561198000000000",
        "2026-07-28T12:00:00Zrace"
      )
    ]);
    assert.equal(race.filter((item) => item.status === "fulfilled").length, 1);

    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1`,
      [schema]
    );
    const names = columns.rows.map((row) => row.column_name);
    assert.equal(names.includes("poll_secret"), false);
    assert.equal(names.some((name) => /assertion|api_key|token/.test(name)), false);

    const migrations = await loadPostgresMigrations();
    await assert.rejects(runPostgresMigrations(pool, [
      ...migrations,
      {
        version: 99,
        name: "099_rollback_test.sql",
        checksum: "d".repeat(64),
        sql: "CREATE TABLE rollback_probe(id integer); SELECT invalid syntax;"
      }
    ]));
    const rollbackProbe = await pool.query<{ exists: boolean }>(
      "SELECT to_regclass('rollback_probe') IS NOT NULL AS exists"
    );
    assert.equal(rollbackProbe.rows[0].exists, false);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
