import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AuthorizationRepository, AuthorizationUser } from "./authorizationRepository.ts";
import { AuthorizationError } from "./contracts.ts";

const SESSION_TTL_MS = 15 * 60_000;

interface SessionClaims {
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

export class SessionTokenService {
  private readonly secret: string;
  private readonly repository: AuthorizationRepository;
  private readonly now: () => number;

  constructor(
    secret: string,
    repository: AuthorizationRepository,
    now: () => number = Date.now
  ) {
    this.secret = secret;
    this.repository = repository;
    this.now = now;
  }

  async issueForSteamIdentity(steamId64: string, authenticatedAt: string) {
    const user = await this.repository.ensureAuthenticatedUser(steamId64, authenticatedAt);
    const issuedAt = Math.floor(this.now() / 1000);
    const expiresAt = issuedAt + Math.floor(SESSION_TTL_MS / 1000);
    const claims: SessionClaims = { sub: user.id, iat: issuedAt, exp: expiresAt, jti: randomUUID() };
    const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    return {
      token: `${payload}.${this.sign(payload)}`,
      expiresAt: new Date(expiresAt * 1000).toISOString()
    };
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
      claims.exp <= Math.floor(this.now() / 1000)
    ) {
      throw new AuthorizationError("AUTHENTICATION_REQUIRED");
    }
    const user = await this.repository.findUserById(claims.sub);
    if (!user) throw new AuthorizationError("AUTHENTICATION_REQUIRED");
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
