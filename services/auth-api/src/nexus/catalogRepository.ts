/**
 * Nexus multi-platform catalog persistence — BACKEND-OWNED.
 *
 * Phase 3A introduces inert persistence primitives only. No desktop/public
 * route and no provider adapter is wired here. Provider sync code may upsert
 * provider metadata and ownership facts, but it must never overwrite verified
 * canonical mapping evidence.
 */

import type { Pool } from "pg";
import type { NexusProvider } from "../../../../src/domain/nexus/provider.ts";
import type {
  PlatformGame,
  UserGameOwnership
} from "../../../../src/domain/nexus/catalog.ts";

export interface NexusCatalogRepository {
  validateSchema(): Promise<void>;
  findPlatformGameByProviderIdentity(
    provider: NexusProvider,
    providerGameId: string
  ): Promise<PlatformGame | undefined>;
  upsertPlatformGame(game: PlatformGame): Promise<PlatformGame>;
  upsertOwnership(ownership: UserGameOwnership): Promise<UserGameOwnership>;
  listOwnershipByLinkedAccount(
    linkedAccountId: string
  ): Promise<UserGameOwnership[]>;
}

interface PlatformGameRow {
  id: string;
  provider: NexusProvider;
  providerGameId: string;
  title: string;
  canonicalGameId: string | null;
  canonicalMappingMethod: "provider_verified" | "editorial_verified" | null;
  canonicalVerifiedBy: string | null;
  canonicalVerifiedAt: Date | string | null;
  firstSeenAt: Date | string;
  updatedAt: Date | string;
}

interface OwnershipRow {
  id: string;
  linkedAccountId: string;
  platformGameId: string;
  playtimeMinutes: number | null;
  playtimeKnown: boolean;
  lastPlayedAt: Date | string | null;
  acquiredAt: Date | string | null;
  firstSeenAt: Date | string;
  lastSyncAt: Date | string | null;
}

const PLATFORM_GAME_COLUMNS = `id, provider,
  provider_game_id AS "providerGameId", title,
  canonical_game_id AS "canonicalGameId",
  canonical_mapping_method AS "canonicalMappingMethod",
  canonical_verified_by AS "canonicalVerifiedBy",
  canonical_verified_at AS "canonicalVerifiedAt",
  first_seen_at AS "firstSeenAt", updated_at AS "updatedAt"`;

const OWNERSHIP_COLUMNS = `id,
  linked_account_id AS "linkedAccountId",
  platform_game_id AS "platformGameId",
  playtime_minutes AS "playtimeMinutes",
  playtime_known AS "playtimeKnown",
  last_played_at AS "lastPlayedAt",
  acquired_at AS "acquiredAt",
  first_seen_at AS "firstSeenAt",
  last_sync_at AS "lastSyncAt"`;

function iso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function fromPlatformGameRow(row: PlatformGameRow): PlatformGame {
  const canonicalMapping =
    row.canonicalGameId &&
    row.canonicalMappingMethod &&
    row.canonicalVerifiedBy &&
    row.canonicalVerifiedAt
      ? {
          method: row.canonicalMappingMethod,
          confidence: "verified" as const,
          verifiedBy: row.canonicalVerifiedBy,
          verifiedAt: iso(row.canonicalVerifiedAt)
        }
      : undefined;

  return {
    id: row.id,
    provider: row.provider,
    providerGameId: row.providerGameId,
    title: row.title,
    firstSeenAt: iso(row.firstSeenAt),
    updatedAt: iso(row.updatedAt),
    ...(row.canonicalGameId ? { canonicalGameId: row.canonicalGameId } : {}),
    ...(canonicalMapping ? { canonicalMapping } : {})
  };
}

function fromOwnershipRow(row: OwnershipRow): UserGameOwnership {
  return {
    id: row.id,
    linkedAccountId: row.linkedAccountId,
    platformGameId: row.platformGameId,
    playtimeKnown: row.playtimeKnown,
    firstSeenAt: iso(row.firstSeenAt),
    ...(row.playtimeMinutes !== null
      ? { playtimeMinutes: row.playtimeMinutes }
      : {}),
    ...(row.lastPlayedAt ? { lastPlayedAt: iso(row.lastPlayedAt) } : {}),
    ...(row.acquiredAt ? { acquiredAt: iso(row.acquiredAt) } : {}),
    ...(row.lastSyncAt ? { lastSyncAt: iso(row.lastSyncAt) } : {})
  };
}

export class PostgresNexusCatalogRepository implements NexusCatalogRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const expected: Record<string, number> = {
      canonical_games: 6,
      platform_games: 10,
      user_canonical_mapping_suggestions: 7,
      user_game_ownership: 9
    };
    for (const [tableName, columnCount] of Object.entries(expected)) {
      const result = await this.pool.query<{ count: string }>(
        `SELECT count(*) FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1`,
        [tableName]
      );
      if (Number(result.rows[0]?.count) !== columnCount) {
        throw new Error(`nexus_catalog_schema_invalid:${tableName}`);
      }
    }
  }

  async findPlatformGameByProviderIdentity(
    provider: NexusProvider,
    providerGameId: string
  ) {
    const result = await this.pool.query<PlatformGameRow>(
      `SELECT ${PLATFORM_GAME_COLUMNS}
       FROM platform_games
       WHERE provider = $1 AND provider_game_id = $2`,
      [provider, providerGameId]
    );
    return result.rows[0] ? fromPlatformGameRow(result.rows[0]) : undefined;
  }

  /**
   * Provider sync is allowed to refresh provider title/timestamps only.
   * On natural-key conflict, canonical mapping columns and the existing
   * internal id are deliberately preserved.
   */
  async upsertPlatformGame(game: PlatformGame) {
    const result = await this.pool.query<PlatformGameRow>(
      `INSERT INTO platform_games (
         id, provider, provider_game_id, title,
         canonical_game_id, canonical_mapping_method,
         canonical_verified_by, canonical_verified_at,
         first_seen_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (provider, provider_game_id) DO UPDATE SET
         title = EXCLUDED.title,
         updated_at = EXCLUDED.updated_at
       RETURNING ${PLATFORM_GAME_COLUMNS}`,
      [
        game.id,
        game.provider,
        game.providerGameId,
        game.title,
        game.canonicalGameId ?? null,
        game.canonicalMapping?.method ?? null,
        game.canonicalMapping?.verifiedBy ?? null,
        game.canonicalMapping?.verifiedAt ?? null,
        game.firstSeenAt,
        game.updatedAt
      ]
    );
    return fromPlatformGameRow(result.rows[0]);
  }

  /**
   * Ownership is idempotent per linked account + platform game. Unknown
   * playtime is stored as NULL, never as zero. Existing acquisition/last-played
   * facts survive a provider response that omits them.
   */
  async upsertOwnership(ownership: UserGameOwnership) {
    const playtimeMinutes = ownership.playtimeKnown
      ? ownership.playtimeMinutes ?? 0
      : null;
    const result = await this.pool.query<OwnershipRow>(
      `INSERT INTO user_game_ownership (
         id, linked_account_id, platform_game_id,
         playtime_minutes, playtime_known, last_played_at, acquired_at,
         first_seen_at, last_sync_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (linked_account_id, platform_game_id) DO UPDATE SET
         playtime_minutes = EXCLUDED.playtime_minutes,
         playtime_known = EXCLUDED.playtime_known,
         last_played_at = COALESCE(EXCLUDED.last_played_at, user_game_ownership.last_played_at),
         acquired_at = COALESCE(EXCLUDED.acquired_at, user_game_ownership.acquired_at),
         last_sync_at = COALESCE(EXCLUDED.last_sync_at, user_game_ownership.last_sync_at)
       RETURNING ${OWNERSHIP_COLUMNS}`,
      [
        ownership.id,
        ownership.linkedAccountId,
        ownership.platformGameId,
        playtimeMinutes,
        ownership.playtimeKnown,
        ownership.lastPlayedAt ?? null,
        ownership.acquiredAt ?? null,
        ownership.firstSeenAt,
        ownership.lastSyncAt ?? null
      ]
    );
    return fromOwnershipRow(result.rows[0]);
  }

  async listOwnershipByLinkedAccount(linkedAccountId: string) {
    const result = await this.pool.query<OwnershipRow>(
      `SELECT ${OWNERSHIP_COLUMNS}
       FROM user_game_ownership
       WHERE linked_account_id = $1
       ORDER BY first_seen_at, id`,
      [linkedAccountId]
    );
    return result.rows.map(fromOwnershipRow);
  }
}
