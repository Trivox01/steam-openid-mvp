import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  AuthTransaction,
  AuthTransactionStatusView
} from "./authTransaction.ts";
import type { AuthTransactionRepository } from "../storage/authRepository.ts";

const MIN_TTL_MS = 5 * 60_000;
const MAX_TTL_MS = 10 * 60_000;

export interface StartedAuthTransaction {
  authRequestId: string;
  pollSecret: string;
  expiresAt: string;
  returnTo: string;
}

export class AuthTransactionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "AuthTransactionError";
  }
}

export class AuthTransactionService {
  readonly #repository: AuthTransactionRepository;
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(
    repository: AuthTransactionRepository,
    options: { transactionTtlMs?: number; now?: () => number } = {}
  ) {
    this.#repository = repository;
    this.#ttlMs = options.transactionTtlMs ?? MAX_TTL_MS;
    if (this.#ttlMs < MIN_TTL_MS || this.#ttlMs > MAX_TTL_MS) {
      throw new Error("auth_transaction_ttl_out_of_range");
    }
    this.#now = options.now ?? Date.now;
  }

  get repository() {
    return this.#repository;
  }

  async start(input: {
    returnToBase: string;
    deviceId: string;
  }): Promise<StartedAuthTransaction> {
    assertDeviceId(input.deviceId);
    const returnToUrl = assertSecureReturnTo(input.returnToBase);
    const createdAt = this.#now();
    const authRequestId = randomUUID();
    const pollSecret = randomBytes(32).toString("base64url");
    returnToUrl.searchParams.set("transaction", authRequestId);
    const returnTo = returnToUrl.toString();
    const transaction: AuthTransaction = {
      authRequestId,
      pollSecretHash: hashSecret(pollSecret),
      deviceIdHash: hashSecret(input.deviceId),
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + this.#ttlMs).toISOString(),
      status: "pending",
      returnTo,
      version: 0
    };
    await this.#repository.create(transaction);
    return {
      authRequestId,
      pollSecret,
      expiresAt: transaction.expiresAt,
      returnTo
    };
  }

  async status(
    authRequestId: string,
    pollSecret: string,
    deviceId?: string
  ): Promise<AuthTransactionStatusView> {
    const transaction = await this.authorize(authRequestId, pollSecret);
    if (deviceId !== undefined) {
      assertDeviceId(deviceId);
      if (!secretMatches(transaction.deviceIdHash, deviceId)) {
        throw new AuthTransactionError("invalid_device_id");
      }
    }
    await this.expireIfNeeded(transaction);
    return {
      status: transaction.status,
      ...(transaction.status === "failed" && transaction.errorCode
        ? { errorCode: transaction.errorCode }
        : {}),
      ...(transaction.status === "verified" && transaction.steamId
        ? {
            steamId: transaction.steamId,
            authenticatedAt: transaction.verifiedAt
          }
        : {})
    };
  }

  async cancel(authRequestId: string, pollSecret: string) {
    const transaction = await this.authorize(authRequestId, pollSecret);
    await this.expireIfNeeded(transaction);
    if (transaction.status === "pending") {
      transaction.status = "cancelled";
      transaction.consumedAt = new Date(this.#now()).toISOString();
      transaction.cancelledAt = transaction.consumedAt;
      await this.#repository.save(transaction);
    }
  }

  async markVerified(authRequestId: string, steamId: string, responseNonce: string) {
    const transaction = await this.requireTransaction(authRequestId);
    await this.expireIfNeeded(transaction);
    if (transaction.status !== "pending") {
      throw new AuthTransactionError("auth_request_not_pending");
    }
    if (!/^\d{17}$/.test(steamId) || !responseNonce.trim()) {
      throw new AuthTransactionError("invalid_verified_identity");
    }
    const verifiedAt = new Date(this.#now()).toISOString();
    const result = await this.#repository.verifyWithNonce({
      authRequestId,
      steamId,
      nonceHash: hashSecret(responseNonce),
      nonceExpiresAt: new Date(this.#now() + MAX_TTL_MS + 2 * 60_000).toISOString(),
      verifiedAt
    });
    if (result === "nonce_reused") {
      throw new AuthTransactionError("nonce_replayed");
    }
    if (result !== "verified") {
      throw new AuthTransactionError(
        result === "not_found" ? "auth_request_not_found" : "auth_request_not_pending"
      );
    }
  }

  async getForCallback(authRequestId: string) {
    const transaction = await this.requireTransaction(authRequestId);
    await this.expireIfNeeded(transaction);
    if (transaction.status !== "pending") {
      throw new AuthTransactionError(`auth_request_${transaction.status}`);
    }
    return transaction;
  }

  async markCancelled(authRequestId: string) {
    const transaction = await this.requireTransaction(authRequestId);
    await this.expireIfNeeded(transaction);
    if (transaction.status !== "pending") {
      throw new AuthTransactionError(`auth_request_${transaction.status}`);
    }
    transaction.status = "cancelled";
    transaction.consumedAt = new Date(this.#now()).toISOString();
    transaction.cancelledAt = transaction.consumedAt;
    await this.#repository.save(transaction);
  }

  async markFailed(authRequestId: string, errorCode: string) {
    const transaction = await this.requireTransaction(authRequestId);
    await this.expireIfNeeded(transaction);
    if (transaction.status !== "pending") {
      throw new AuthTransactionError(`auth_request_${transaction.status}`);
    }
    transaction.status = "failed";
    transaction.errorCode = errorCode;
    transaction.consumedAt = new Date(this.#now()).toISOString();
    await this.#repository.save(transaction);
  }

  async consume(authRequestId: string, pollSecret: string) {
    const transaction = await this.authorize(authRequestId, pollSecret);
    await this.expireIfNeeded(transaction);
    if (transaction.status !== "verified" || !transaction.steamId) {
      throw new AuthTransactionError("auth_request_not_verified");
    }
    transaction.status = "consumed";
    transaction.consumedAt = new Date(this.#now()).toISOString();
    await this.#repository.save(transaction);
    return { steamId: transaction.steamId };
  }

  private async authorize(authRequestId: string, pollSecret: string) {
    const transaction = await this.requireTransaction(authRequestId);
    if (!secretMatches(transaction.pollSecretHash, pollSecret)) {
      throw new AuthTransactionError("invalid_poll_secret");
    }
    return transaction;
  }

  private async requireTransaction(authRequestId: string) {
    const transaction = await this.#repository.find(authRequestId);
    if (!transaction) throw new AuthTransactionError("auth_request_not_found");
    return transaction;
  }

  private async expireIfNeeded(transaction: AuthTransaction) {
    if (
      transaction.status === "pending" &&
      this.#now() >= Date.parse(transaction.expiresAt)
    ) {
      transaction.status = "expired";
      transaction.consumedAt = new Date(this.#now()).toISOString();
      await this.#repository.save(transaction);
    }
  }
}

function assertSecureReturnTo(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthTransactionError("invalid_return_to");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.has("transaction")
  ) {
    throw new AuthTransactionError("invalid_return_to");
  }
  return url;
}

function assertDeviceId(value: string) {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._~-]+$/.test(value)
  ) {
    throw new AuthTransactionError("invalid_device_id");
  }
}

function hashSecret(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function secretMatches(expectedHash: string, candidate: string) {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(hashSecret(candidate), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
