import type { AuthTransaction } from "../auth/authTransaction.ts";

export class StorageError extends Error {
  readonly code = "database_unavailable";

  constructor() {
    super("database_unavailable");
    this.name = "StorageError";
  }
}

export interface AuthTransactionRepository {
  create(transaction: AuthTransaction): Promise<void>;
  find(authRequestId: string): Promise<AuthTransaction | undefined>;
  save(transaction: AuthTransaction): Promise<void>;
  delete(authRequestId: string): Promise<void>;
  verifyWithNonce(input: {
    authRequestId: string;
    steamId: string;
    nonceHash: string;
    nonceExpiresAt: string;
    verifiedAt: string;
  }): Promise<"verified" | "nonce_reused" | "not_pending" | "not_found">;
  cleanup(input: {
    now: string;
    transactionRetentionBefore: string;
    batchSize: number;
  }): Promise<{ transactionsDeleted: number; noncesDeleted: number }>;
  validateSchema(): Promise<void>;
}

export class InMemoryAuthTransactionRepository implements AuthTransactionRepository {
  readonly #transactions = new Map<string, AuthTransaction>();
  readonly #responseNonces = new Map<string, string>();

  async create(transaction: AuthTransaction) {
    if (this.#transactions.has(transaction.authRequestId)) {
      throw new Error("auth_request_conflict");
    }
    this.#transactions.set(transaction.authRequestId, structuredClone(transaction));
  }

  async find(authRequestId: string) {
    const transaction = this.#transactions.get(authRequestId);
    return transaction ? structuredClone(transaction) : undefined;
  }

  async save(transaction: AuthTransaction) {
    const current = this.#transactions.get(transaction.authRequestId);
    if (!current) {
      throw new Error("auth_request_not_found");
    }
    if (current.version !== transaction.version) {
      throw new Error("auth_request_conflict");
    }
    this.#transactions.set(transaction.authRequestId, {
      ...structuredClone(transaction),
      version: transaction.version + 1
    });
  }

  async delete(authRequestId: string) {
    this.#transactions.delete(authRequestId);
  }

  async verifyWithNonce(input: {
    authRequestId: string;
    steamId: string;
    nonceHash: string;
    nonceExpiresAt: string;
    verifiedAt: string;
  }) {
    const transaction = this.#transactions.get(input.authRequestId);
    if (!transaction) return "not_found" as const;
    if (transaction.status !== "pending") return "not_pending" as const;
    if (this.#responseNonces.has(input.nonceHash)) return "nonce_reused" as const;
    this.#responseNonces.set(input.nonceHash, input.authRequestId);
    this.#transactions.set(input.authRequestId, {
      ...transaction,
      status: "verified",
      steamId: input.steamId,
      responseNonceHash: input.nonceHash,
      verifiedAt: input.verifiedAt,
      version: transaction.version + 1
    });
    return "verified" as const;
  }

  async cleanup(input: {
    now: string;
    transactionRetentionBefore: string;
    batchSize: number;
  }) {
    let transactionsDeleted = 0;
    for (const [id, transaction] of this.#transactions) {
      if (transactionsDeleted >= input.batchSize) break;
      if (
        transaction.status !== "pending" &&
        transaction.createdAt < input.transactionRetentionBefore
      ) {
        this.#transactions.delete(id);
        transactionsDeleted += 1;
      }
    }
    let noncesDeleted = 0;
    for (const [nonceHash, authRequestId] of this.#responseNonces) {
      if (noncesDeleted >= input.batchSize) break;
      if (!this.#transactions.has(authRequestId)) {
        this.#responseNonces.delete(nonceHash);
        noncesDeleted += 1;
      }
    }
    return { transactionsDeleted, noncesDeleted };
  }

  async validateSchema() {
    return;
  }
}
