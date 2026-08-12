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
import { InMemoryToolReviewRepository, type ToolReviewRepository } from "../tools/toolReviewRepository.ts";
import { PostgresToolReviewRepository } from "./postgres/postgresToolReviewRepository.ts";
import { InMemoryToolReviewReportRepository, type ToolReviewReportRepository } from "../tools/toolReviewReportRepository.ts";
import { PostgresToolReviewReportRepository } from "./postgres/postgresToolReviewReportRepository.ts";
import { InMemoryToolReviewHelpfulRepository, type ToolReviewHelpfulRepository } from "../tools/toolReviewHelpfulRepository.ts";
import { PostgresToolReviewHelpfulRepository } from "./postgres/postgresToolReviewHelpfulRepository.ts";
import { InMemoryToolReviewDeveloperReplyRepository, type ToolReviewDeveloperReplyRepository } from "../tools/toolReviewDeveloperReplyRepository.ts";
import { PostgresToolReviewDeveloperReplyRepository } from "./postgres/postgresToolReviewDeveloperReplyRepository.ts";
import { InMemoryToolAnalyticsRepository, type ToolAnalyticsRepository } from "../tools/toolAnalyticsRepository.ts";
import { PostgresToolAnalyticsRepository } from "./postgres/postgresToolAnalyticsRepository.ts";
import { InMemoryToolFavoriteRepository, type ToolFavoriteRepository } from "../tools/toolFavoriteRepository.ts";
import { PostgresToolFavoriteRepository } from "./postgres/postgresToolFavoriteRepository.ts";
import {
  InMemoryDesktopSessionRepository,
  PostgresDesktopSessionRepository,
  type DesktopSessionRepository
} from "../desktopSessions/desktopSessionRepository.ts";

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
  toolReviewRepository: ToolReviewRepository;
  toolReviewReportRepository: ToolReviewReportRepository;
  toolReviewHelpfulRepository: ToolReviewHelpfulRepository;
  toolReviewReplyRepository: ToolReviewDeveloperReplyRepository;
  toolAnalyticsRepository: ToolAnalyticsRepository;
  toolFavoriteRepository: ToolFavoriteRepository;
  desktopSessionRepository: DesktopSessionRepository;
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
    const reviewUsers = {
      displayName: async (userId: string) =>
        (await authorizationRepository.findUserById(userId)) ? `User ${userId.slice(0, 8)}` : undefined,
      avatarUrl: async () => undefined
    };
    const toolReviewRepository = new InMemoryToolReviewRepository(toolRepository, reviewUsers, toolRatingRepository);
    const toolReviewReportRepository = new InMemoryToolReviewReportRepository(toolRepository, toolReviewRepository, reviewUsers);
    const toolReviewHelpfulRepository = new InMemoryToolReviewHelpfulRepository();
    const toolReviewReplyRepository = new InMemoryToolReviewDeveloperReplyRepository();
    const toolAnalyticsRepository = new InMemoryToolAnalyticsRepository();
    const toolFavoriteRepository = new InMemoryToolFavoriteRepository();
    const desktopSessionRepository = new InMemoryDesktopSessionRepository();
    await desktopSessionRepository.validateSchema();
    toolReviewRepository.attachReportSource(toolReviewReportRepository);
    toolReviewRepository.attachHelpfulSource(toolReviewHelpfulRepository);
    toolReviewRepository.attachReplySource(toolReviewReplyRepository);
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
      toolReviewRepository,
      toolReviewReportRepository,
      toolReviewHelpfulRepository,
      toolReviewReplyRepository,
      toolAnalyticsRepository,
      toolFavoriteRepository,
      desktopSessionRepository,
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
    const toolReviewRepository = new PostgresToolReviewRepository(pool);
    await toolReviewRepository.validateSchema();
    const toolReviewReportRepository = new PostgresToolReviewReportRepository(pool);
    await toolReviewReportRepository.validateSchema();
    const toolReviewHelpfulRepository = new PostgresToolReviewHelpfulRepository(pool);
    await toolReviewHelpfulRepository.validateSchema();
    const toolReviewReplyRepository = new PostgresToolReviewDeveloperReplyRepository(pool);
    await toolReviewReplyRepository.validateSchema();
    const toolAnalyticsRepository = new PostgresToolAnalyticsRepository(pool);
    await toolAnalyticsRepository.validateSchema();
    const toolFavoriteRepository = new PostgresToolFavoriteRepository(pool);
    await toolFavoriteRepository.validateSchema();
    const desktopSessionRepository = new PostgresDesktopSessionRepository(pool);
    await desktopSessionRepository.validateSchema();
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
      toolReviewRepository,
      toolReviewReportRepository,
      toolReviewHelpfulRepository,
      toolReviewReplyRepository,
      toolAnalyticsRepository,
      toolFavoriteRepository,
      desktopSessionRepository,
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
