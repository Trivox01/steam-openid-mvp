import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

const MIGRATION_LOCK_ID = 2_147_410_902;
const MIGRATIONS_DIRECTORY = new URL("./migrations/", import.meta.url);

export interface MigrationRecord {
  version: number;
  name: string;
  checksum: string;
  sql: string;
}

export class MigrationError extends Error {
  readonly code = "database_migration_failed";
  readonly migrationVersion: number;
  readonly migrationName: string;

  constructor(migrationVersion: number, migrationName: string) {
    super("database_migration_failed");
    this.name = "MigrationError";
    this.migrationVersion = migrationVersion;
    this.migrationName = migrationName;
  }
}

export async function loadPostgresMigrations(): Promise<MigrationRecord[]> {
  const directory = fileURLToPath(MIGRATIONS_DIRECTORY);
  const names = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const migrations = await Promise.all(names.map(async (name) => {
    const sql = await readFile(new URL(name, MIGRATIONS_DIRECTORY), "utf8");
    return {
      version: Number(name.slice(0, 3)),
      name,
      checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
      sql
    };
  }));
  const versions = new Set(migrations.map((migration) => migration.version));
  if (versions.size !== migrations.length) throw new Error("duplicate_migration_version");
  return migrations;
}

export async function runPostgresMigrations(
  pool: Pool,
  migrations?: MigrationRecord[]
) {
  const selectedMigrations = migrations ?? await loadPostgresMigrations();
  const client = await pool.connect();
  let activeMigration: MigrationRecord | undefined;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await ensureMigrationTable(client);
    for (const migration of selectedMigrations) {
      activeMigration = migration;
      await applyMigration(client, migration);
    }
  } catch {
    throw new MigrationError(
      activeMigration?.version ?? 0,
      activeMigration?.name ?? "migration_bootstrap"
    );
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    } finally {
      client.release();
    }
  }
}

async function ensureMigrationTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS auth_schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function applyMigration(client: PoolClient, migration: MigrationRecord) {
  const existing = await client.query<{
    checksum: string;
    name: string;
  }>(
    "SELECT checksum, name FROM auth_schema_migrations WHERE version = $1",
    [migration.version]
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.checksum !== migration.checksum || row.name !== migration.name) {
      throw new Error("migration_checksum_mismatch");
    }
    return;
  }
  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO auth_schema_migrations (version, name, checksum)
       VALUES ($1, $2, $3)`,
      [migration.version, migration.name, migration.checksum]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
