import type { Pool, PoolClient } from "pg";
import {
  LEGACY_REFRESH_PROTOCOL_VERSION,
  LEGACY_REFRESH_ROTATION_GRACE_MS,
  MODERN_REFRESH_PROTOCOL_VERSION,
  isLegacyRefreshProtocol,
  normalizeRefreshProtocolVersion,
  type RefreshProtocolVersion
} from "./refreshProtocol.ts";

export interface DesktopSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  tokenFamilyId: string;
  generation: number;
  sessionEpochAtIssue: number;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string;
  rotatedAt?: string;
  replacementSessionId?: string;
  refreshOperationHash?: string;
  refreshOperationExpiresAt?: string;
  // Persisted protocol classification. Absent means the row was written by a
  // backend that predates the column, which the database default classifies as
  // legacy. New sessions are always written with an explicit value.
  refreshProtocolVersion?: RefreshProtocolVersion;
}

export type DesktopSessionRotationResult =
  | { status: "rotated"; session: DesktopSessionRecord }
  | { status: "duplicate"; session: DesktopSessionRecord }
  | { status: "invalid" | "expired" | "revoked" | "epoch_changed" }
  | { status: "account_not_active" }
  | { status: "reuse_detected" };

export interface DesktopSessionRepository {
  validateSchema(): Promise<void>;
  create(input: DesktopSessionRecord, maximumActiveFamilies: number): Promise<void>;
  findById(id: string): Promise<DesktopSessionRecord | undefined>;
  rotate(input: {
    predecessorId: string;
    predecessorHash: string;
    replacement: DesktopSessionRecord;
    now: string;
    operationHash?: string;
    recoveryExpiresAt: string;
  }): Promise<DesktopSessionRotationResult>;
  revokeFamily(familyId: string, now: string): Promise<void>;
  cleanup(now: string, retentionDays: number, limit: number): Promise<number>;
}

// A legacy predecessor is identified only by its own persisted protocol
// classification. Never by client version, user agent, request shape, or any
// deployment or migration timestamp.
function isLegacySession(predecessor: DesktopSessionRecord) {
  return isLegacyRefreshProtocol(predecessor.refreshProtocolVersion);
}

// Legacy first rotation: the session must have been issued under the legacy
// protocol and the request must carry no operation identity.
function legacyFirstRotationAllowed(
  predecessor: DesktopSessionRecord,
  operationHash: string | undefined
) {
  return !operationHash && isLegacySession(predecessor);
}

// Legacy duplicate grace: only a legacy session that was itself rotated without
// an operation identity gets the bounded historical window.
function withinLegacyGrace(
  predecessor: DesktopSessionRecord,
  operationHash: string | undefined,
  now: string
) {
  if (operationHash || !predecessor.rotatedAt) return false;
  if (!isLegacySession(predecessor)) return false;
  if (predecessor.refreshOperationHash || predecessor.refreshOperationExpiresAt) return false;
  return Date.parse(now) - Date.parse(predecessor.rotatedAt) <= LEGACY_REFRESH_ROTATION_GRACE_MS;
}

// The replacement inherits legacy only through a legacy rotation, so an old
// client keeps a usable family for its remaining lifetime. A rotation carrying a
// valid operation identity always produces a modern replacement, which is a
// safe one-way upgrade of the family.
function replacementProtocolVersion(operationHash: string | undefined): RefreshProtocolVersion {
  return operationHash ? MODERN_REFRESH_PROTOCOL_VERSION : LEGACY_REFRESH_PROTOCOL_VERSION;
}

export class InMemoryDesktopSessionRepository implements DesktopSessionRepository {
  readonly sessions = new Map<string, DesktopSessionRecord>();
  readonly users = new Map<string, { accountStatus: "active" | "suspended" | "disabled"; sessionEpoch: number }>();

  async validateSchema() {}

  async create(input: DesktopSessionRecord, maximumActiveFamilies: number) {
    // Stored verbatim so that an absent protocol column can be simulated the
    // same way an older backend writes it.
    this.sessions.set(input.id, { ...input });
    const families = [...this.sessions.values()]
      .filter((session) => session.userId === input.userId && !session.revokedAt && session.generation === 0)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    for (const old of families.slice(maximumActiveFamilies)) {
      await this.revokeFamily(old.tokenFamilyId, input.createdAt);
    }
  }

  async findById(id: string) {
    const value = this.sessions.get(id);
    return value ? readRecord(value) : undefined;
  }

  async rotate(input: {
    predecessorId: string;
    predecessorHash: string;
    replacement: DesktopSessionRecord;
    now: string;
    operationHash?: string;
    recoveryExpiresAt: string;
  }): Promise<DesktopSessionRotationResult> {
    const stored = this.sessions.get(input.predecessorId);
    const predecessor = stored ? readRecord(stored) : undefined;
    if (!stored || !predecessor || predecessor.tokenHash !== input.predecessorHash) return { status: "invalid" };
    const user = this.users.get(predecessor.userId);
    if (user && user.accountStatus !== "active") return { status: "account_not_active" };
    if (user && user.sessionEpoch !== predecessor.sessionEpochAtIssue) {
      await this.revokeFamily(predecessor.tokenFamilyId, input.now);
      return { status: "epoch_changed" };
    }
    if (predecessor.revokedAt) return { status: "revoked" };
    if (Date.parse(predecessor.expiresAt) <= Date.parse(input.now)) return { status: "expired" };
    if (predecessor.rotatedAt && predecessor.replacementSessionId) {
      const sameOperation = Boolean(input.operationHash &&
        predecessor.refreshOperationHash === input.operationHash);
      const withinRecovery = Boolean(predecessor.refreshOperationExpiresAt &&
        Date.parse(input.now) <= Date.parse(predecessor.refreshOperationExpiresAt));
      const legacyRecovery = withinLegacyGrace(predecessor, input.operationHash, input.now);
      const replacement = this.sessions.get(predecessor.replacementSessionId);
      if (((sameOperation && withinRecovery) || legacyRecovery) && replacement &&
          !replacement.revokedAt && !replacement.rotatedAt &&
          Date.parse(replacement.expiresAt) > Date.parse(input.now)) {
        return { status: "duplicate", session: readRecord(replacement) };
      }
      await this.revokeFamily(predecessor.tokenFamilyId, input.now);
      return { status: "reuse_detected" };
    }
    if (!legacyFirstRotationAllowed(predecessor, input.operationHash) && !input.operationHash) {
      return { status: "invalid" };
    }
    stored.rotatedAt = input.now;
    stored.lastUsedAt = input.now;
    stored.replacementSessionId = input.replacement.id;
    // A legacy rotation keeps both operation columns unset, which is what marks
    // the predecessor as legacy-rotated for the bounded grace policy.
    if (input.operationHash) {
      stored.refreshOperationHash = input.operationHash;
      stored.refreshOperationExpiresAt = input.recoveryExpiresAt;
    }
    const replacement: DesktopSessionRecord = {
      ...input.replacement,
      refreshProtocolVersion: replacementProtocolVersion(input.operationHash)
    };
    this.sessions.set(replacement.id, { ...replacement });
    return { status: "rotated", session: replacement };
  }

  async revokeFamily(familyId: string, now: string) {
    for (const session of this.sessions.values()) {
      if (session.tokenFamilyId === familyId && !session.revokedAt) session.revokedAt = now;
    }
  }

  async cleanup(now: string, retentionDays: number, limit: number) {
    const threshold = Date.parse(now) - retentionDays * 86_400_000;
    const candidates = [...this.sessions.values()]
      .filter((session) => Date.parse(session.expiresAt) < threshold || Boolean(session.revokedAt && Date.parse(session.revokedAt) < threshold))
      .slice(0, limit);
    for (const session of candidates) this.sessions.delete(session.id);
    return candidates.length;
  }
}

const COLUMNS = `ds.id, ds.user_id AS "userId", ds.token_hash AS "tokenHash",
  ds.token_family_id AS "tokenFamilyId", ds.generation,
  ds.session_epoch_at_issue AS "sessionEpochAtIssue",
  ds.created_at AS "createdAt", ds.last_used_at AS "lastUsedAt",
  ds.expires_at AS "expiresAt", ds.revoked_at AS "revokedAt",
  ds.rotated_at AS "rotatedAt", ds.replacement_session_id AS "replacementSessionId",
  ds.refresh_operation_hash AS "refreshOperationHash",
  ds.refresh_operation_expires_at AS "refreshOperationExpiresAt",
  ds.refresh_protocol_version AS "refreshProtocolVersion"`;

export class PostgresDesktopSessionRepository implements DesktopSessionRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'desktop_sessions'
         AND column_name = ANY($1::text[])`,
      [["id", "user_id", "token_hash", "token_family_id", "generation", "session_epoch_at_issue",
        "expires_at", "revoked_at", "rotated_at", "replacement_session_id",
        "refresh_operation_hash", "refresh_operation_expires_at", "refresh_protocol_version"]]
    );
    if (Number(result.rows[0]?.count) !== 13) throw new Error("desktop_session_schema_invalid");
  }

  async create(input: DesktopSessionRecord, maximumActiveFamilies: number) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await insertSession(client, input);
      await client.query(
        `WITH excess AS (
           SELECT token_family_id FROM desktop_sessions
           WHERE user_id = $1 AND generation = 0 AND revoked_at IS NULL
           ORDER BY created_at DESC OFFSET $2
         )
         UPDATE desktop_sessions SET revoked_at = $3
         WHERE token_family_id IN (SELECT token_family_id FROM excess)
           AND revoked_at IS NULL`,
        [input.userId, maximumActiveFamilies, input.createdAt]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async findById(id: string) {
    const result = await this.pool.query<DesktopSessionRecord>(
      `SELECT ${COLUMNS} FROM desktop_sessions ds WHERE ds.id = $1`, [id]
    );
    return result.rows[0] ? normalize(result.rows[0]) : undefined;
  }

  async rotate(input: {
    predecessorId: string;
    predecessorHash: string;
    replacement: DesktopSessionRecord;
    now: string;
    operationHash?: string;
    recoveryExpiresAt: string;
  }): Promise<DesktopSessionRotationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<DesktopSessionRecord & { accountStatus: string; currentEpoch: number }>(
        `SELECT ${COLUMNS}, u.account_status AS "accountStatus", u.session_epoch AS "currentEpoch"
         FROM desktop_sessions ds JOIN users u ON u.id = ds.user_id
         WHERE ds.id = $1 FOR UPDATE OF ds`, [input.predecessorId]
      );
      const predecessor = result.rows[0] ? normalize(result.rows[0]) : undefined;
      if (!predecessor || predecessor.tokenHash !== input.predecessorHash) return await rollback(client, { status: "invalid" });
      if (result.rows[0].accountStatus !== "active") return await rollback(client, { status: "account_not_active" });
      if (Number(result.rows[0].currentEpoch) !== predecessor.sessionEpochAtIssue) {
        await revokeFamilyWithClient(client, predecessor.tokenFamilyId, input.now);
        await client.query("COMMIT");
        return { status: "epoch_changed" };
      }
      if (predecessor.revokedAt) return await rollback(client, { status: "revoked" });
      if (Date.parse(predecessor.expiresAt) <= Date.parse(input.now)) return await rollback(client, { status: "expired" });
      if (predecessor.rotatedAt && predecessor.replacementSessionId) {
        const sameOperation = Boolean(input.operationHash &&
          predecessor.refreshOperationHash === input.operationHash);
        const withinRecovery = Boolean(predecessor.refreshOperationExpiresAt &&
          Date.parse(input.now) <= Date.parse(predecessor.refreshOperationExpiresAt));
        const legacyRecovery = withinLegacyGrace(predecessor, input.operationHash, input.now);
        if ((sameOperation && withinRecovery) || legacyRecovery) {
          const child = await client.query<DesktopSessionRecord>(
            `SELECT ${COLUMNS} FROM desktop_sessions ds WHERE ds.id = $1`, [predecessor.replacementSessionId]
          );
          if (child.rows[0]) {
            const replacement = normalize(child.rows[0]);
            if (!replacement.revokedAt && !replacement.rotatedAt &&
                Date.parse(replacement.expiresAt) > Date.parse(input.now)) {
              return await rollback(client, { status: "duplicate", session: replacement });
            }
          }
        }
        await revokeFamilyWithClient(client, predecessor.tokenFamilyId, input.now);
        await client.query("COMMIT");
        return { status: "reuse_detected" };
      }
      if (!legacyFirstRotationAllowed(predecessor, input.operationHash) && !input.operationHash) {
        return await rollback(client, { status: "invalid" });
      }
      const replacement: DesktopSessionRecord = {
        ...input.replacement,
        refreshProtocolVersion: replacementProtocolVersion(input.operationHash)
      };
      await insertSession(client, replacement);
      await client.query(
        `UPDATE desktop_sessions SET rotated_at = $2, last_used_at = $2,
           replacement_session_id = $3, refresh_operation_hash = $4,
           refresh_operation_expires_at = $5 WHERE id = $1`,
        [predecessor.id, input.now, replacement.id, input.operationHash ?? null,
          input.operationHash ? input.recoveryExpiresAt : null]
      );
      await client.query("COMMIT");
      return { status: "rotated", session: replacement };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async revokeFamily(familyId: string, now: string) {
    await this.pool.query(
      "UPDATE desktop_sessions SET revoked_at = $2 WHERE token_family_id = $1 AND revoked_at IS NULL",
      [familyId, now]
    );
  }

  async cleanup(now: string, retentionDays: number, limit: number) {
    const result = await this.pool.query(
      `DELETE FROM desktop_sessions WHERE id IN (
         SELECT id FROM desktop_sessions
         WHERE expires_at < $1::timestamptz - ($2 * interval '1 day')
            OR revoked_at < $1::timestamptz - ($2 * interval '1 day')
         ORDER BY COALESCE(revoked_at, expires_at) LIMIT $3
       )`, [now, retentionDays, limit]
    );
    return result.rowCount ?? 0;
  }
}

async function insertSession(client: PoolClient, input: DesktopSessionRecord) {
  // The protocol version is written explicitly, never left to the column
  // default, so a session issued by this backend can never be misclassified as
  // legacy. A missing value fails loudly against the NOT NULL column instead of
  // silently widening legacy eligibility.
  await client.query(
    `INSERT INTO desktop_sessions
      (id,user_id,token_hash,token_family_id,generation,session_epoch_at_issue,
       created_at,last_used_at,expires_at,revoked_at,rotated_at,replacement_session_id,
       refresh_protocol_version)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [input.id, input.userId, input.tokenHash, input.tokenFamilyId, input.generation,
      input.sessionEpochAtIssue, input.createdAt, input.lastUsedAt, input.expiresAt,
      input.revokedAt ?? null, input.rotatedAt ?? null, input.replacementSessionId ?? null,
      input.refreshProtocolVersion ?? null]
  );
}

async function revokeFamilyWithClient(client: PoolClient, familyId: string, now: string) {
  await client.query(
    "UPDATE desktop_sessions SET revoked_at = $2 WHERE token_family_id = $1 AND revoked_at IS NULL",
    [familyId, now]
  );
}

async function rollback<T extends DesktopSessionRotationResult>(client: PoolClient, result: T): Promise<T> {
  await client.query("ROLLBACK");
  return result;
}

// Reads a stored record with the same classification semantics as the database
// column default: an absent value is legacy.
function readRecord(record: DesktopSessionRecord): DesktopSessionRecord {
  return {
    ...record,
    refreshProtocolVersion: normalizeRefreshProtocolVersion(record.refreshProtocolVersion)
  };
}

function normalize(record: DesktopSessionRecord): DesktopSessionRecord {
  const { revokedAt: _revokedAt, rotatedAt: _rotatedAt,
    replacementSessionId: _replacementSessionId,
    refreshOperationHash: _refreshOperationHash,
    refreshOperationExpiresAt: _refreshOperationExpiresAt,
    refreshProtocolVersion: _refreshProtocolVersion,
    ...required } = record;
  return {
    ...required,
    generation: Number(record.generation),
    sessionEpochAtIssue: Number(record.sessionEpochAtIssue),
    createdAt: new Date(record.createdAt).toISOString(),
    lastUsedAt: new Date(record.lastUsedAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    refreshProtocolVersion: normalizeRefreshProtocolVersion(record.refreshProtocolVersion),
    ...(record.revokedAt ? { revokedAt: new Date(record.revokedAt).toISOString() } : {}),
    ...(record.rotatedAt ? { rotatedAt: new Date(record.rotatedAt).toISOString() } : {}),
    ...(record.replacementSessionId ? { replacementSessionId: record.replacementSessionId } : {}),
    ...(record.refreshOperationHash ? { refreshOperationHash: record.refreshOperationHash } : {}),
    ...(record.refreshOperationExpiresAt
      ? { refreshOperationExpiresAt: new Date(record.refreshOperationExpiresAt).toISOString() }
      : {})
  };
}
