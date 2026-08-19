import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AuthorizationRepository } from "../authorization/authorizationRepository.ts";
import type { SessionTokenService } from "../authorization/sessionTokenService.ts";
import type {
  DesktopSessionRecord,
  DesktopSessionRepository
} from "./desktopSessionRepository.ts";

const DESKTOP_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60_000;
const REFRESH_OPERATION_RECOVERY_MS = 10 * 60_000;
const MAXIMUM_ACTIVE_FAMILIES = 5;
const CLEANUP_RETENTION_DAYS = 7;

export type DesktopSessionErrorCode =
  | "DESKTOP_SESSION_INVALID"
  | "DESKTOP_SESSION_EXPIRED"
  | "DESKTOP_SESSION_REVOKED"
  | "DESKTOP_SESSION_REUSED"
  | "ACCOUNT_NOT_ACTIVE";

export class DesktopSessionError extends Error {
  readonly code: DesktopSessionErrorCode;
  constructor(code: DesktopSessionErrorCode) {
    super(code);
    this.code = code;
    this.name = "DesktopSessionError";
  }
}

export class DesktopSessionService {
  private readonly secret: string;
  readonly repository: DesktopSessionRepository;
  private readonly authorization: AuthorizationRepository;
  private readonly accessTokens: SessionTokenService;
  private readonly now: () => number;
  constructor(
    secret: string,
    repository: DesktopSessionRepository,
    authorization: AuthorizationRepository,
    accessTokens: SessionTokenService,
    now: () => number = Date.now
  ) {
    this.secret = secret;
    this.repository = repository;
    this.authorization = authorization;
    this.accessTokens = accessTokens;
    this.now = now;
  }

  async issueForSteamIdentity(steamId64: string, authenticatedAt: string) {
    const access = await this.accessTokens.issueForSteamIdentity(steamId64, authenticatedAt);
    const createdAt = new Date(this.now()).toISOString();
    const id = randomUUID();
    const record = this.record({
      id,
      userId: access.userId,
      familyId: id,
      generation: 0,
      sessionEpoch: access.sessionEpoch,
      createdAt
    });
    await this.repository.create(record, MAXIMUM_ACTIVE_FAMILIES);
    void this.repository.cleanup(createdAt, CLEANUP_RETENTION_DAYS, 100).catch(() => undefined);
    return this.response(access.token, access.expiresAt, record);
  }

  async refresh(credential: string, operationId?: string) {
    const predecessor = await this.validatedRecord(credential);
    const user = await this.authorization.findUserById(predecessor.userId);
    if (!user) throw new DesktopSessionError("DESKTOP_SESSION_INVALID");
    if (user.accountStatus !== "active") throw new DesktopSessionError("ACCOUNT_NOT_ACTIVE");
    if (user.sessionEpoch !== predecessor.sessionEpochAtIssue) {
      await this.repository.revokeFamily(predecessor.tokenFamilyId, new Date(this.now()).toISOString());
      throw new DesktopSessionError("DESKTOP_SESSION_REVOKED");
    }
    const now = new Date(this.now()).toISOString();
    const operationHash = hashRefreshOperation(operationId);
    const replacement = this.record({
      id: randomUUID(),
      userId: predecessor.userId,
      familyId: predecessor.tokenFamilyId,
      generation: predecessor.generation + 1,
      sessionEpoch: predecessor.sessionEpochAtIssue,
      createdAt: now,
      expiresAt: predecessor.expiresAt
    });
    const rotated = await this.repository.rotate({
      predecessorId: predecessor.id,
      predecessorHash: hashCredential(credential),
      replacement,
      now,
      operationHash,
      recoveryExpiresAt: new Date(this.now() + REFRESH_OPERATION_RECOVERY_MS).toISOString()
    });
    if (rotated.status === "account_not_active") throw new DesktopSessionError("ACCOUNT_NOT_ACTIVE");
    if (rotated.status === "expired") throw new DesktopSessionError("DESKTOP_SESSION_EXPIRED");
    if (rotated.status === "reuse_detected") throw new DesktopSessionError("DESKTOP_SESSION_REUSED");
    if (rotated.status === "revoked" || rotated.status === "epoch_changed") {
      throw new DesktopSessionError("DESKTOP_SESSION_REVOKED");
    }
    if (rotated.status === "invalid") throw new DesktopSessionError("DESKTOP_SESSION_INVALID");
    if (!("session" in rotated)) throw new DesktopSessionError("DESKTOP_SESSION_INVALID");
    const access = await this.accessTokens.issueForUserId(rotated.session.userId);
    return this.response(access.token, access.expiresAt, rotated.session);
  }

  async logout(credential: string) {
    try {
      const session = await this.validatedRecord(credential);
      await this.repository.revokeFamily(session.tokenFamilyId, new Date(this.now()).toISOString());
    } catch (error) {
      if (!(error instanceof DesktopSessionError)) throw error;
      // Logout is intentionally idempotent and reveals no session existence.
    }
  }

  cleanup() {
    return this.repository.cleanup(
      new Date(this.now()).toISOString(), CLEANUP_RETENTION_DAYS, 100
    );
  }

  private async validatedRecord(credential: string) {
    const parsed = parseCredential(credential);
    if (!parsed) throw new DesktopSessionError("DESKTOP_SESSION_INVALID");
    const record = await this.repository.findById(parsed.id);
    if (!record) throw new DesktopSessionError("DESKTOP_SESSION_INVALID");
    const expected = this.credentialFor(record);
    if (!safeEqual(credential, expected) || !safeEqual(hashCredential(credential), record.tokenHash)) {
      throw new DesktopSessionError("DESKTOP_SESSION_INVALID");
    }
    return record;
  }

  private record(input: {
    id: string;
    userId: string;
    familyId: string;
    generation: number;
    sessionEpoch: number;
    createdAt: string;
    expiresAt?: string;
  }): DesktopSessionRecord {
    const unsigned = {
      id: input.id,
      userId: input.userId,
      tokenFamilyId: input.familyId,
      generation: input.generation,
      sessionEpochAtIssue: input.sessionEpoch,
      createdAt: input.createdAt,
      lastUsedAt: input.createdAt,
      expiresAt: input.expiresAt ?? new Date(Date.parse(input.createdAt) + DESKTOP_SESSION_LIFETIME_MS).toISOString()
    };
    return { ...unsigned, tokenHash: hashCredential(this.credentialFor(unsigned)) };
  }

  private credentialFor(input: Pick<DesktopSessionRecord, "id" | "tokenFamilyId" | "generation">) {
    const signature = createHmac("sha256", this.secret)
      .update(`desktop-session\0${input.id}\0${input.tokenFamilyId}\0${input.generation}`, "utf8")
      .digest("base64url");
    return `${input.id}.${signature}`;
  }

  private response(accessToken: string, accessExpiresAt: string, record: DesktopSessionRecord) {
    return {
      sessionToken: accessToken,
      sessionExpiresAt: accessExpiresAt,
      refreshCredential: this.credentialFor(record),
      refreshExpiresAt: record.expiresAt
    };
  }
}

function parseCredential(value: string) {
  if (value.length > 128) return undefined;
  const [id, signature, extra] = value.split(".");
  if (extra || !id || !signature || !/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    return undefined;
  }
  return { id, signature };
}

function hashCredential(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashRefreshOperation(value?: string) {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return undefined;
  }
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export const desktopSessionPolicy = {
  lifetimeMs: DESKTOP_SESSION_LIFETIME_MS,
  refreshOperationRecoveryMs: REFRESH_OPERATION_RECOVERY_MS,
  maximumActiveFamilies: MAXIMUM_ACTIVE_FAMILIES
} as const;
