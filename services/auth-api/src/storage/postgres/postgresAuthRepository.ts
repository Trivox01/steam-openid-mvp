import type { Pool, PoolClient } from "pg";
import type { AuthTransaction } from "../../auth/authTransaction.ts";
import {
  StorageError,
  type AuthTransactionRepository
} from "../authRepository.ts";

const REQUIRED_TRANSACTION_COLUMNS = [
  "auth_request_id",
  "poll_secret_hash",
  "device_id_hash",
  "status",
  "return_to",
  "created_at",
  "expires_at",
  "steam_id",
  "response_nonce_hash",
  "failure_code",
  "verified_at",
  "consumed_at",
  "cancelled_at",
  "version"
];
const REQUIRED_NONCE_COLUMNS = [
  "nonce_hash",
  "auth_request_id",
  "created_at",
  "expires_at",
  "consumed_at"
];

export class PostgresAuthTransactionRepository
implements AuthTransactionRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async create(transaction: AuthTransaction) {
    try {
      await this.#pool.query(
        `INSERT INTO auth_transactions (
        auth_request_id, poll_secret_hash, device_id_hash, status, return_to,
        created_at, expires_at, steam_id, response_nonce_hash, failure_code,
        verified_at, consumed_at, cancelled_at, version
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      )`,
        valuesFor(transaction)
      );
    } catch {
      throw new StorageError();
    }
  }

  async find(authRequestId: string) {
    try {
      const result = await this.#pool.query<TransactionRow>(
        "SELECT * FROM auth_transactions WHERE auth_request_id = $1",
        [authRequestId]
      );
      return result.rowCount ? fromRow(result.rows[0]) : undefined;
    } catch {
      throw new StorageError();
    }
  }

  async save(transaction: AuthTransaction) {
    let rowCount: number | null;
    try {
      const result = await this.#pool.query(
        `UPDATE auth_transactions SET
        status = $2,
        steam_id = $3,
        response_nonce_hash = $4,
        failure_code = $5,
        verified_at = $6,
        consumed_at = $7,
        cancelled_at = $8,
        version = version + 1
      WHERE auth_request_id = $1 AND version = $9`,
      [
        transaction.authRequestId,
        transaction.status,
        transaction.steamId ?? null,
        transaction.responseNonceHash ?? null,
        transaction.errorCode ?? null,
        transaction.verifiedAt ?? null,
        transaction.consumedAt ?? null,
        transaction.cancelledAt ?? null,
        transaction.version
        ]
      );
      rowCount = result.rowCount;
    } catch {
      throw new StorageError();
    }
    if (rowCount !== 1) throw new Error("auth_request_conflict");
  }

  async delete(authRequestId: string) {
    try {
      await this.#pool.query(
        "DELETE FROM auth_transactions WHERE auth_request_id = $1",
        [authRequestId]
      );
    } catch {
      throw new StorageError();
    }
  }

  async verifyWithNonce(input: {
    authRequestId: string;
    steamId: string;
    nonceHash: string;
    nonceExpiresAt: string;
    verifiedAt: string;
  }) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const transaction = await client.query<{ status: string; expires_at: Date }>(
        `SELECT status, expires_at FROM auth_transactions
         WHERE auth_request_id = $1 FOR UPDATE`,
        [input.authRequestId]
      );
      if (!transaction.rowCount) {
        await client.query("ROLLBACK");
        return "not_found" as const;
      }
      const row = transaction.rows[0];
      if (row.status !== "pending" || row.expires_at.getTime() <= Date.now()) {
        if (row.status === "pending") {
          await client.query(
            `UPDATE auth_transactions
             SET status = 'expired', consumed_at = now(), version = version + 1
             WHERE auth_request_id = $1`,
            [input.authRequestId]
          );
        }
        await client.query("COMMIT");
        return "not_pending" as const;
      }
      const nonce = await client.query(
        `INSERT INTO openid_nonces (
          nonce_hash, auth_request_id, created_at, expires_at, consumed_at
        ) VALUES ($1, $2, $3, $4, $3)
        ON CONFLICT (nonce_hash) DO NOTHING`,
        [
          input.nonceHash,
          input.authRequestId,
          input.verifiedAt,
          input.nonceExpiresAt
        ]
      );
      if (nonce.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "nonce_reused" as const;
      }
      const update = await client.query(
        `UPDATE auth_transactions SET
          status = 'verified',
          steam_id = $2,
          response_nonce_hash = $3,
          verified_at = $4,
          version = version + 1
        WHERE auth_request_id = $1 AND status = 'pending'`,
        [input.authRequestId, input.steamId, input.nonceHash, input.verifiedAt]
      );
      if (update.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "not_pending" as const;
      }
      await client.query("COMMIT");
      return "verified" as const;
    } catch {
      await rollbackQuietly(client);
      throw new StorageError();
    } finally {
      client.release();
    }
  }

  async cleanup(input: {
    now: string;
    transactionRetentionBefore: string;
    batchSize: number;
  }) {
    try {
      await this.#pool.query(
      `UPDATE auth_transactions SET
        status = 'expired', consumed_at = $1, version = version + 1
       WHERE auth_request_id IN (
         SELECT auth_request_id FROM auth_transactions
         WHERE status = 'pending' AND expires_at <= $1
         ORDER BY expires_at LIMIT $2
         FOR UPDATE SKIP LOCKED
       )`,
      [input.now, input.batchSize]
    );
      const nonces = await deleteBatch(
      this.#pool,
      "openid_nonces",
      "nonce_hash",
      "expires_at <= $1",
      [input.now, input.batchSize]
    );
      const transactions = await deleteBatch(
      this.#pool,
      "auth_transactions",
      "auth_request_id",
      "status <> 'pending' AND created_at < $1",
      [input.transactionRetentionBefore, input.batchSize]
    );
      return {
        transactionsDeleted: transactions,
        noncesDeleted: nonces
      };
    } catch {
      throw new StorageError();
    }
  }

  async validateSchema() {
    try {
      const result = await this.#pool.query<{
        table_name: string;
        column_name: string;
      }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name IN ('auth_transactions', 'openid_nonces')`
    );
      const transactionColumns = new Set(
        result.rows
          .filter((row) => row.table_name === "auth_transactions")
          .map((row) => row.column_name)
      );
      const nonceColumns = new Set(
        result.rows
          .filter((row) => row.table_name === "openid_nonces")
          .map((row) => row.column_name)
      );
      if (
        REQUIRED_TRANSACTION_COLUMNS.some(
          (column) => !transactionColumns.has(column)
        ) ||
        REQUIRED_NONCE_COLUMNS.some((column) => !nonceColumns.has(column))
      ) {
        throw new Error("database_schema_invalid");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "database_schema_invalid") {
        throw error;
      }
      throw new StorageError();
    }
  }
}

interface TransactionRow {
  auth_request_id: string;
  poll_secret_hash: string;
  device_id_hash: string;
  status: AuthTransaction["status"];
  return_to: string;
  created_at: Date;
  expires_at: Date;
  steam_id: string | null;
  response_nonce_hash: string | null;
  failure_code: string | null;
  verified_at: Date | null;
  consumed_at: Date | null;
  cancelled_at: Date | null;
  version: number;
}

function valuesFor(transaction: AuthTransaction) {
  return [
    transaction.authRequestId,
    transaction.pollSecretHash,
    transaction.deviceIdHash,
    transaction.status,
    transaction.returnTo,
    transaction.createdAt,
    transaction.expiresAt,
    transaction.steamId ?? null,
    transaction.responseNonceHash ?? null,
    transaction.errorCode ?? null,
    transaction.verifiedAt ?? null,
    transaction.consumedAt ?? null,
    transaction.cancelledAt ?? null,
    transaction.version
  ];
}

function fromRow(row: TransactionRow): AuthTransaction {
  return {
    authRequestId: row.auth_request_id,
    pollSecretHash: row.poll_secret_hash,
    deviceIdHash: row.device_id_hash,
    status: row.status,
    returnTo: row.return_to,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    version: row.version,
    ...(row.steam_id ? { steamId: row.steam_id } : {}),
    ...(row.response_nonce_hash
      ? { responseNonceHash: row.response_nonce_hash }
      : {}),
    ...(row.failure_code ? { errorCode: row.failure_code } : {}),
    ...(row.verified_at ? { verifiedAt: row.verified_at.toISOString() } : {}),
    ...(row.consumed_at ? { consumedAt: row.consumed_at.toISOString() } : {}),
    ...(row.cancelled_at
      ? { cancelledAt: row.cancelled_at.toISOString() }
      : {})
  };
}

async function deleteBatch(
  pool: Pool,
  table: "openid_nonces" | "auth_transactions",
  key: "nonce_hash" | "auth_request_id",
  predicate: string,
  parameters: [string, number]
) {
  const result = await pool.query(
    `DELETE FROM ${table} WHERE ${key} IN (
      SELECT ${key} FROM ${table}
      WHERE ${predicate}
      ORDER BY ${key}
      LIMIT $2
    )`,
    parameters
  );
  return result.rowCount ?? 0;
}

async function rollbackQuietly(client: PoolClient) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The original database error is intentionally replaced with a safe code.
  }
}
