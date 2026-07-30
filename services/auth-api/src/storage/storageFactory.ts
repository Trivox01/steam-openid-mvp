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
import { InMemoryBadgeRepository, type BadgeRepository } from "../badges/badgeRepository.ts";
import { PostgresBadgeRepository } from "./postgres/postgresBadgeRepository.ts";
import {
  InMemoryBadgeAssignmentRepository,
  type BadgeAssignmentRepository
} from "../badgeAssignments/badgeAssignmentRepository.ts";
import { PostgresBadgeAssignmentRepository } from "./postgres/postgresBadgeAssignmentRepository.ts";
import { InMemoryUserRepository, type UserRepository } from "../users/userRepository.ts";
import { PostgresUserRepository } from "./postgres/postgresUserRepository.ts";

export interface InitializedStorage {
  repository: AuthTransactionRepository;
  authorizationRepository: AuthorizationRepository;
  badgeRepository: BadgeRepository;
  badgeAssignmentRepository: BadgeAssignmentRepository;
  userRepository: UserRepository;
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
    const badgeRepository = new InMemoryBadgeRepository();
    await badgeRepository.validateSchema();
    const badgeAssignmentRepository = new InMemoryBadgeAssignmentRepository(
      authorizationRepository,
      badgeRepository
    );
    await badgeAssignmentRepository.validateSchema();
    const userRepository = new InMemoryUserRepository(
      authorizationRepository,
      badgeAssignmentRepository
    );
    return {
      repository,
      authorizationRepository,
      badgeRepository,
      badgeAssignmentRepository,
      userRepository,
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
    const badgeRepository = new PostgresBadgeRepository(pool);
    await badgeRepository.validateSchema();
    const badgeAssignmentRepository = new PostgresBadgeAssignmentRepository(pool);
    await badgeAssignmentRepository.validateSchema();
    const userRepository = new PostgresUserRepository(pool);
    await userRepository.validateSchema();
    return {
      repository,
      authorizationRepository,
      badgeRepository,
      badgeAssignmentRepository,
      userRepository,
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
