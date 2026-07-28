import { Pool } from "pg";
import type { AuthApiConfig } from "../config.ts";
import {
  InMemoryAuthTransactionRepository,
  type AuthTransactionRepository
} from "./authRepository.ts";
import {
  MigrationError,
  runPostgresMigrations
} from "./postgres/migrationRunner.ts";
import { PostgresAuthTransactionRepository } from "./postgres/postgresAuthRepository.ts";
import {
  InMemoryAuthorizationRepository,
  type AuthorizationRepository
} from "../authorization/authorizationRepository.ts";
import { PostgresAuthorizationRepository } from "./postgres/postgresAuthorizationRepository.ts";

export interface InitializedStorage {
  repository: AuthTransactionRepository;
  authorizationRepository: AuthorizationRepository;
  close(): Promise<void>;
}

export async function initializeStorage(
  config: AuthApiConfig
): Promise<InitializedStorage> {
  if (config.storageDriver === "memory") {
    const repository = new InMemoryAuthTransactionRepository();
    await repository.validateSchema();
    const authorizationRepository = new InMemoryAuthorizationRepository();
    await authorizationRepository.validateSchema();
    return {
      repository,
      authorizationRepository,
      async close() {}
    };
  }

  if (!config.databaseUrl) throw new Error("invalid_configuration");
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    application_name: "achievement-nexus-auth-api",
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000
  });
  try {
    await pool.query("SELECT 1");
    await runPostgresMigrations(pool);
    const repository = new PostgresAuthTransactionRepository(pool);
    await repository.validateSchema();
    const authorizationRepository = new PostgresAuthorizationRepository(pool);
    await authorizationRepository.validateSchema();
    return {
      repository,
      authorizationRepository,
      async close() {
        await pool.end();
      }
    };
  } catch (error) {
    await pool.end();
    if (error instanceof MigrationError) throw error;
    throw new Error("database_initialization_failed");
  }
}
