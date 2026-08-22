/**
 * Nexus linked-account persistence — BACKEND-OWNED.
 *
 * This module lives in the auth-api backend tree on purpose. It resolves and
 * writes server records and must never execute in, or be importable from, the
 * React/Tauri desktop app. The desktop only ever receives the allowlisted
 * LinkedPlatformAccountPublic projection.
 *
 * Phase 2A stores account links only. There is no provider credential column
 * here: Steam OpenID issues no access or refresh tokens, so the credential
 * store stays deferred until a token-based provider needs it.
 */

import type { Pool } from "pg";
import type { NexusProvider } from "../../../../src/domain/nexus/provider.ts";
import type { LinkedAccountSyncStatus } from "../../../../src/domain/nexus/identity.ts";
import type { LinkedPlatformAccount } from "./identity.ts";

/**
 * The persisted server record: the Phase 1 contract plus the revocation column.
 * `revokedAt === undefined` is the single definition of an active link and
 * mirrors the `revoked_at IS NULL` partial-index predicate in migration 020.
 */
export type LinkedPlatformAccountRecord = LinkedPlatformAccount & {
  readonly revokedAt?: string;
};

export const PROVIDER_IDENTITY_UNIQUE_INDEX =
  "linked_accounts_provider_identity_uniq";
export const USER_PROVIDER_UNIQUE_INDEX =
  "linked_accounts_one_per_provider_uniq";

/** Which active-uniqueness slot a write collided with. */
export type LinkedAccountUniqueSlot =
  | "provider_identity"
  | "user_provider"
  | "unknown";

/**
 * Raised when the database rejects a write because an active slot is taken.
 * The constraint, not an application read, is what guarantees uniqueness, so
 * this error is the signal that a concurrent writer won a race.
 */
export class LinkedAccountUniqueViolation extends Error {
  readonly code = "linked_account_unique_violation";
  readonly slot: LinkedAccountUniqueSlot;

  constructor(slot: LinkedAccountUniqueSlot) {
    super("linked_account_unique_violation");
    this.name = "LinkedAccountUniqueViolation";
    this.slot = slot;
  }
}

export interface LinkedAccountRepository {
  validateSchema(): Promise<void>;
  findActiveByProviderIdentity(
    provider: NexusProvider,
    providerUserId: string
  ): Promise<LinkedPlatformAccountRecord | undefined>;
  findActiveByUserAndProvider(
    userId: string,
    provider: NexusProvider
  ): Promise<LinkedPlatformAccountRecord | undefined>;
  listByUser(userId: string): Promise<LinkedPlatformAccountRecord[]>;
  insert(record: LinkedPlatformAccountRecord): Promise<void>;
  updateProfile(input: {
    id: string;
    displayName?: string;
    avatarUrl?: string;
    lastSyncAt?: string;
    lastSyncStatus?: LinkedAccountSyncStatus;
  }): Promise<void>;
}

function isActive(record: LinkedPlatformAccountRecord) {
  return record.revokedAt === undefined;
}

/**
 * In-memory repository used by focused unit tests. It enforces exactly the two
 * partial unique slots that migration 020 enforces, so a test that passes here
 * is testing the same invariant the database owns.
 */
export class InMemoryLinkedAccountRepository
implements LinkedAccountRepository {
  readonly records = new Map<string, LinkedPlatformAccountRecord>();

  async validateSchema() {}

  async findActiveByProviderIdentity(
    provider: NexusProvider,
    providerUserId: string
  ) {
    return [...this.records.values()].find(
      (record) =>
        isActive(record) &&
        record.provider === provider &&
        record.providerUserId === providerUserId
    );
  }

  async findActiveByUserAndProvider(userId: string, provider: NexusProvider) {
    return [...this.records.values()].find(
      (record) =>
        isActive(record) &&
        record.userId === userId &&
        record.provider === provider
    );
  }

  async listByUser(userId: string) {
    return [...this.records.values()]
      .filter((record) => record.userId === userId)
      .sort((left, right) => left.linkedAt.localeCompare(right.linkedAt));
  }

  async insert(record: LinkedPlatformAccountRecord) {
    if (isActive(record)) {
      if (
        await this.findActiveByProviderIdentity(
          record.provider,
          record.providerUserId
        )
      ) {
        throw new LinkedAccountUniqueViolation("provider_identity");
      }
      if (
        await this.findActiveByUserAndProvider(record.userId, record.provider)
      ) {
        throw new LinkedAccountUniqueViolation("user_provider");
      }
    }
    this.records.set(record.id, { ...record });
  }

  async updateProfile(input: {
    id: string;
    displayName?: string;
    avatarUrl?: string;
    lastSyncAt?: string;
    lastSyncStatus?: LinkedAccountSyncStatus;
  }) {
    const existing = this.records.get(input.id);
    if (!existing || !isActive(existing)) return;
    this.records.set(input.id, {
      ...existing,
      ...(input.displayName !== undefined
        ? { displayName: input.displayName }
        : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      ...(input.lastSyncAt !== undefined
        ? { lastSyncAt: input.lastSyncAt }
        : {}),
      ...(input.lastSyncStatus !== undefined
        ? { lastSyncStatus: input.lastSyncStatus }
        : {})
    });
  }

  /** Test helper mirroring a disconnect: frees both active unique slots. */
  async revoke(id: string, revokedAt: string) {
    const existing = this.records.get(id);
    if (!existing) return;
    this.records.set(id, {
      ...existing,
      connectionStatus: "disconnected",
      revokedAt
    });
  }
}

const COLUMNS = `id, user_id AS "userId", provider,
  provider_user_id AS "providerUserId", display_name AS "displayName",
  avatar_url AS "avatarUrl", connection_status AS "connectionStatus", scopes,
  linked_at AS "linkedAt", last_sync_at AS "lastSyncAt",
  last_sync_status AS "lastSyncStatus", revoked_at AS "revokedAt"`;

interface LinkedAccountRow {
  id: string;
  userId: string;
  provider: NexusProvider;
  providerUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  connectionStatus: LinkedPlatformAccount["connectionStatus"];
  scopes: string[] | null;
  linkedAt: Date | string;
  lastSyncAt: Date | string | null;
  lastSyncStatus: LinkedAccountSyncStatus | null;
  revokedAt: Date | string | null;
}

function iso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function fromRow(row: LinkedAccountRow): LinkedPlatformAccountRecord {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    providerUserId: row.providerUserId,
    connectionStatus: row.connectionStatus,
    scopes: row.scopes ?? [],
    linkedAt: iso(row.linkedAt),
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
    ...(row.lastSyncAt ? { lastSyncAt: iso(row.lastSyncAt) } : {}),
    ...(row.lastSyncStatus ? { lastSyncStatus: row.lastSyncStatus } : {}),
    ...(row.revokedAt ? { revokedAt: iso(row.revokedAt) } : {})
  };
}

function uniqueSlotFor(error: unknown): LinkedAccountUniqueSlot | undefined {
  const candidate = error as { code?: string; constraint?: string };
  if (candidate?.code !== "23505") return undefined;
  if (candidate.constraint === PROVIDER_IDENTITY_UNIQUE_INDEX) {
    return "provider_identity";
  }
  if (candidate.constraint === USER_PROVIDER_UNIQUE_INDEX) {
    return "user_provider";
  }
  return "unknown";
}

export class PostgresLinkedAccountRepository
implements LinkedAccountRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'linked_platform_accounts'
         AND column_name = ANY($1::text[])`,
      [[
        "id", "user_id", "provider", "provider_user_id", "display_name",
        "avatar_url", "connection_status", "scopes", "linked_at",
        "last_sync_at", "last_sync_status", "revoked_at"
      ]]
    );
    if (Number(result.rows[0]?.count) !== 12) {
      throw new Error("linked_platform_accounts_schema_invalid");
    }
  }

  async findActiveByProviderIdentity(
    provider: NexusProvider,
    providerUserId: string
  ) {
    const result = await this.pool.query<LinkedAccountRow>(
      `SELECT ${COLUMNS} FROM linked_platform_accounts
       WHERE provider = $1 AND provider_user_id = $2 AND revoked_at IS NULL`,
      [provider, providerUserId]
    );
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async findActiveByUserAndProvider(userId: string, provider: NexusProvider) {
    const result = await this.pool.query<LinkedAccountRow>(
      `SELECT ${COLUMNS} FROM linked_platform_accounts
       WHERE user_id = $1 AND provider = $2 AND revoked_at IS NULL`,
      [userId, provider]
    );
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async listByUser(userId: string) {
    const result = await this.pool.query<LinkedAccountRow>(
      `SELECT ${COLUMNS} FROM linked_platform_accounts
       WHERE user_id = $1 ORDER BY linked_at, id`,
      [userId]
    );
    return result.rows.map(fromRow);
  }

  async insert(record: LinkedPlatformAccountRecord) {
    try {
      await this.pool.query(
        `INSERT INTO linked_platform_accounts (
           id, user_id, provider, provider_user_id, display_name, avatar_url,
           connection_status, scopes, linked_at, last_sync_at,
           last_sync_status, revoked_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11,$12)`,
        [
          record.id,
          record.userId,
          record.provider,
          record.providerUserId,
          record.displayName ?? null,
          record.avatarUrl ?? null,
          record.connectionStatus,
          [...record.scopes],
          record.linkedAt,
          record.lastSyncAt ?? null,
          record.lastSyncStatus ?? null,
          record.revokedAt ?? null
        ]
      );
    } catch (error) {
      const slot = uniqueSlotFor(error);
      if (slot) throw new LinkedAccountUniqueViolation(slot);
      throw error;
    }
  }

  /**
   * Profile refresh only. COALESCE means an omitted field is left alone rather
   * than cleared, and the active predicate means a revoked link is never
   * silently resurrected.
   */
  async updateProfile(input: {
    id: string;
    displayName?: string;
    avatarUrl?: string;
    lastSyncAt?: string;
    lastSyncStatus?: LinkedAccountSyncStatus;
  }) {
    await this.pool.query(
      `UPDATE linked_platform_accounts SET
         display_name = COALESCE($2, display_name),
         avatar_url = COALESCE($3, avatar_url),
         last_sync_at = COALESCE($4, last_sync_at),
         last_sync_status = COALESCE($5, last_sync_status)
       WHERE id = $1 AND revoked_at IS NULL`,
      [
        input.id,
        input.displayName ?? null,
        input.avatarUrl ?? null,
        input.lastSyncAt ?? null,
        input.lastSyncStatus ?? null
      ]
    );
  }
}
