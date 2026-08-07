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
import { InMemoryToolRepository, type ToolRepository } from "../tools/toolRepository.ts";
import { InMemoryToolBadgeRepository, type ToolBadgeRepository } from "../tools/toolBadgeRepository.ts";
import { InMemoryToolCategoryRepository, type ToolCategoryRepository } from "../tools/toolCategoryRepository.ts";
import { PostgresToolRepositories, PostgresToolBadgeRepository, PostgresToolCategoryRepository } from "./postgres/postgresToolRepositories.ts";
import { InMemoryToolRatingRepository, type ToolRatingRepository } from "../tools/toolRatingRepository.ts";
import { PostgresToolRatingRepository } from "./postgres/postgresToolRatingRepository.ts";

export interface InitializedStorage {
  repository: AuthTransactionRepository;
  authorizationRepository: AuthorizationRepository;
  badgeRepository: BadgeRepository;
  badgeAssignmentRepository: BadgeAssignmentRepository;
  userRepository: UserRepository;
  toolRepository: ToolRepository;
  toolBadgeRepository: ToolBadgeRepository;
  toolCategoryRepository: ToolCategoryRepository;
  toolRatingRepository: ToolRatingRepository;
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
    const toolBadgeRepository = new InMemoryToolBadgeRepository();
    const toolCategoryRepository = new InMemoryToolCategoryRepository();
    const toolRepository = new InMemoryToolRepository(toolBadgeRepository, toolCategoryRepository);
    const toolRatingRepository = new InMemoryToolRatingRepository(toolRepository);
    return {
      repository,
      authorizationRepository,
      badgeRepository,
      badgeAssignmentRepository,
      userRepository,
      toolRepository,
      toolBadgeRepository,
      toolCategoryRepository,
      toolRatingRepository,
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
    const toolRepository = new PostgresToolRepositories(pool);
    await toolRepository.validateSchema();
    const toolBadgeRepository = new PostgresToolBadgeRepository(toolRepository);
    const toolCategoryRepository = new PostgresToolCategoryRepository(toolRepository);
    const toolRatingRepository = new PostgresToolRatingRepository(pool);
    await toolRatingRepository.validateSchema();
    return {
      repository,
      authorizationRepository,
      badgeRepository,
      badgeAssignmentRepository,
      userRepository,
      toolRepository,
      toolBadgeRepository,
      toolCategoryRepository,
      toolRatingRepository,
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
