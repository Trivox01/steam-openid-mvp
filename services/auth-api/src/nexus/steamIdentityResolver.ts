/**
 * Phase 2B Steam identity resolution — BACKEND-OWNED.
 *
 * This resolver is deliberately transitional. The session subject remains
 * users.id and users.steam_id64 is still present on the users table. What
 * changes is how a successful Steam OpenID identity selects the Nexus user:
 *
 * - dual_read: linked account first, legacy users.steam_id64 fallback when the
 *   link is missing.
 * - linked: linked account is required; a missing or conflicting link fails
 *   closed and never creates/reassigns a Nexus user.
 *
 * A linked mapping is never trusted blindly while the legacy Steam column is
 * still authoritative data. The resolver cross-checks the user returned by the
 * existing repository path and rejects any disagreement.
 */

import type {
  AuthorizationRepository,
  AuthorizationUser
} from "../authorization/authorizationRepository.ts";
import type { LinkedAccountRepository } from "./linkedAccountRepository.ts";

export type NexusSteamIdentityResolutionMode = "dual_read" | "linked";

export type SteamIdentityResolutionSource =
  | "linked_account"
  | "legacy_fallback";

export type SteamIdentityResolutionErrorCode =
  | "LINKED_ACCOUNT_REQUIRED"
  | "IDENTITY_MAPPING_CONFLICT";

export class SteamIdentityResolutionError extends Error {
  readonly code: SteamIdentityResolutionErrorCode;

  constructor(code: SteamIdentityResolutionErrorCode) {
    super(code);
    this.name = "SteamIdentityResolutionError";
    this.code = code;
  }
}

export type SteamIdentityResolutionResult = {
  readonly user: AuthorizationUser;
  readonly source: SteamIdentityResolutionSource;
};

export class NexusSteamIdentityResolver {
  private readonly authorizationRepository: AuthorizationRepository;
  private readonly linkedAccountRepository: LinkedAccountRepository;
  private readonly mode: NexusSteamIdentityResolutionMode;

  constructor(
    authorizationRepository: AuthorizationRepository,
    linkedAccountRepository: LinkedAccountRepository,
    mode: NexusSteamIdentityResolutionMode
  ) {
    this.authorizationRepository = authorizationRepository;
    this.linkedAccountRepository = linkedAccountRepository;
    this.mode = mode;
  }

  async resolve(input: {
    steamId64: string;
    authenticatedAt: string;
  }): Promise<SteamIdentityResolutionResult> {
    const linked = await this.linkedAccountRepository.findActiveByProviderIdentity(
      "steam",
      input.steamId64
    );

    if (!linked) {
      if (this.mode === "linked") {
        throw new SteamIdentityResolutionError("LINKED_ACCOUNT_REQUIRED");
      }
      // Dual-read rollout fallback. This is intentionally the exact legacy
      // resolver, so users with a not-yet-backfilled link keep working while
      // operators inspect the fallback signal and complete the rollout.
      const user = await this.authorizationRepository.ensureAuthenticatedUser(
        input.steamId64,
        input.authenticatedAt
      );
      return { user, source: "legacy_fallback" };
    }

    // Keep the existing repository call during the transition for two reasons:
    // it preserves authenticated_at/updated_at semantics, and it provides an
    // independent legacy mapping to compare against the link. The linked row is
    // the selected mapping; disagreement is treated as an integrity fault.
    const legacyUser = await this.authorizationRepository.ensureAuthenticatedUser(
      input.steamId64,
      input.authenticatedAt
    );
    if (legacyUser.id !== linked.userId) {
      throw new SteamIdentityResolutionError("IDENTITY_MAPPING_CONFLICT");
    }

    return { user: legacyUser, source: "linked_account" };
  }
}
