import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AuthorizationRepository, AuthorizationUser } from "./authorizationRepository.ts";
import { AuthorizationError } from "./contracts.ts";

const SESSION_TTL_MS = 15 * 60_000;

interface SessionClaims {
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  /**
   * Session generation the token was born with. Absent in tokens issued before
   * revocation existed, which are treated as generation 0 so they keep working
   * until a revocation actually happens.
   */
  epc?: number;
}

export class SessionTokenService {
  private readonly secret: string;
  private readonly repository: AuthorizationRepository;
  private readonly now: () => number;
  private readonly enrichProfile?: (steamId64: string) => Promise<void>;

  constructor(
    secret: string,
    repository: AuthorizationRepository,
    now: () => number = Date.now,
    enrichProfile?: (steamId64: string) => Promise<void>
  ) {
    this.secret = secret;
    this.repository = repository;
    this.now = now;
    this.enrichProfile = enrichProfile;
  }

  async issueForSteamIdentity(steamId64: string, authenticatedAt: string) {
    const user = await this.repository.ensureAuthenticatedUser(steamId64, authenticatedAt);
    // A suspended or disabled account must not get a fresh token either, otherwise
    // the login path would hand out a credential that every request then rejects.
    assertActive(user);
    await this.enrichProfile?.(steamId64).catch(() => undefined);
    const issuedAt = Math.floor(this.now() / 1000);
    const expiresAt = issuedAt + Math.floor(SESSION_TTL_MS / 1000);
    const claims: SessionClaims = {
      sub: user.id,
      iat: issuedAt,
      exp: expiresAt,
      jti: randomUUID(),
      epc: user.sessionEpoch
    };
    const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    return {
      token: `${payload}.${this.sign(payload)}`,
      expiresAt: new Date(expiresAt * 1000).toISOString()
    };
  }

  /**
   * Invalidates every session of a user. Used by logout and by any
   * security-sensitive change (status, roles, permission overrides).
   */
  async revokeSessions(userId: string) {
    await this.repository.revokeSessions(userId);
  }

  async authenticateBearer(header: string | undefined): Promise<AuthorizationUser> {
    if (!header?.startsWith("Bearer ")) throw new AuthorizationError("AUTHENTICATION_REQUIRED");
    const token = header.slice(7);
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra || !safeEqual(signature, this.sign(payload))) {
      throw new AuthorizationError("AUTHENTICATION_REQUIRED");
    }
    let claims: SessionClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
    } catch {
      throw new AuthorizationError("AUTHENTICATION_REQUIRED");
    }
    if (
      typeof claims.sub !== "string" ||
      typeof claims.exp !== "number" ||
      typeof claims.iat !== "number" ||
      typeof claims.jti !== "string" ||
      (claims.epc !== undefined && !Number.isSafeInteger(claims.epc)) ||
      claims.exp <= Math.floor(this.now() / 1000)
    ) {
      throw new AuthorizationError("AUTHENTICATION_REQUIRED");
    }
    // A valid signature only proves the token was minted here. Account state and
    // session generation are authoritative and are re-read on every request.
    const user = await this.repository.findUserById(claims.sub);
    if (!user) throw new AuthorizationError("AUTHENTICATION_REQUIRED");
    if ((claims.epc ?? 0) !== user.sessionEpoch) {
      throw new AuthorizationError("AUTHENTICATION_REQUIRED");
    }
    assertActive(user);
    return user;
  }

  private sign(payload: string) {
    return createHmac("sha256", this.secret).update(payload, "utf8").digest("base64url");
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * One opaque code for every non-active status: the caller learns it may not act,
 * not which moderation decision produced that. Status comes from the users table,
 * never from a role name.
 */
function assertActive(user: AuthorizationUser) {
  if (user.accountStatus !== "active") {
    throw new AuthorizationError("ACCOUNT_NOT_ACTIVE");
  }
}
