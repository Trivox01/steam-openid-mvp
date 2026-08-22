/**
 * Steam transitional link service (Phase 2A) — BACKEND-OWNED.
 *
 * users.steam_id64 remains the authoritative login identity. This service only
 * ensures that an already-resolved Nexus user also owns the matching active
 * Steam row in linked_platform_accounts. It never resolves authentication, and
 * it is never reachable from the desktop app.
 */

import { randomUUID } from "node:crypto";
import type { NexusProvider } from "../../../../src/domain/nexus/provider.ts";
import type {
  LinkedAccountRepository,
  LinkedPlatformAccountRecord
} from "./linkedAccountRepository.ts";
import { LinkedAccountUniqueViolation } from "./linkedAccountRepository.ts";

const STEAM: NexusProvider = "steam";
const STEAM_ID64_PATTERN = /^[0-9]{17}$/;

export type LinkedAccountConflictCode =
  /** Steam ID X is already actively linked to a different Nexus user. */
  | "PROVIDER_IDENTITY_OWNED_BY_ANOTHER_USER"
  /** This Nexus user already owns a different active Steam identity. */
  | "USER_ALREADY_LINKED_TO_ANOTHER_PROVIDER_IDENTITY"
  | "INVALID_PROVIDER_IDENTITY";

/**
 * A provider identity is never silently moved between Nexus accounts and a
 * Nexus account never silently swaps its Steam identity. Both situations stop
 * here with an explicit conflict instead of an overwrite.
 */
export class LinkedAccountConflictError extends Error {
  readonly code: LinkedAccountConflictCode;

  constructor(code: LinkedAccountConflictCode) {
    super(code);
    this.name = "LinkedAccountConflictError";
    this.code = code;
  }
}

export type EnsureLinkedAccountResult = {
  readonly status: "created" | "unchanged" | "updated";
  readonly account: LinkedPlatformAccountRecord;
};

export type SteamLinkProfile = {
  readonly displayName?: string;
  readonly avatarUrl?: string;
};

export class NexusLinkedAccountService {
  private readonly repository: LinkedAccountRepository;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(
    repository: LinkedAccountRepository,
    now: () => number = Date.now,
    newId: () => string = randomUUID
  ) {
    this.repository = repository;
    this.now = now;
    this.newId = newId;
  }

  findActiveSteamAccountByIdentity(steamId64: string) {
    return this.repository.findActiveByProviderIdentity(STEAM, steamId64);
  }

  findActiveSteamAccountForUser(userId: string) {
    return this.repository.findActiveByUserAndProvider(userId, STEAM);
  }

  listAccountsForUser(userId: string) {
    return this.repository.listByUser(userId);
  }

  /**
   * Idempotent. The Nexus user must already be resolved by the existing
   * users.steam_id64 path before this is called; nothing here creates users or
   * influences session issuance.
   */
  async ensureSteamLinkedAccount(input: {
    userId: string;
    steamId64: string;
    profile?: SteamLinkProfile;
  }): Promise<EnsureLinkedAccountResult> {
    if (!STEAM_ID64_PATTERN.test(input.steamId64)) {
      throw new LinkedAccountConflictError("INVALID_PROVIDER_IDENTITY");
    }
    const existing = await this.resolveExisting(input.userId, input.steamId64);
    if (existing) return this.reconcile(existing, input.profile);

    const record: LinkedPlatformAccountRecord = {
      id: this.newId(),
      userId: input.userId,
      provider: STEAM,
      providerUserId: input.steamId64,
      connectionStatus: "connected",
      // Steam OpenID grants no scopes and issues no tokens, so the link carries
      // neither scopes nor credential metadata.
      scopes: [],
      linkedAt: new Date(this.now()).toISOString(),
      ...(input.profile?.displayName !== undefined
        ? { displayName: input.profile.displayName }
        : {}),
      ...(input.profile?.avatarUrl !== undefined
        ? { avatarUrl: input.profile.avatarUrl }
        : {})
    };

    try {
      await this.repository.insert(record);
      return { status: "created", account: record };
    } catch (error) {
      if (!(error instanceof LinkedAccountUniqueViolation)) throw error;
      // The database constraint, not the read above, is what guarantees
      // uniqueness. Losing the race is normal under concurrent logins, so the
      // outcome is re-derived from the row the winner actually wrote.
      const winner = await this.resolveExisting(input.userId, input.steamId64);
      if (!winner) throw error;
      return this.reconcile(winner, input.profile);
    }
  }

  /**
   * Returns the caller's own active Steam link, or throws the specific
   * integrity conflict. Never returns another user's row.
   */
  private async resolveExisting(userId: string, steamId64: string) {
    const byIdentity = await this.repository.findActiveByProviderIdentity(
      STEAM,
      steamId64
    );
    if (byIdentity) {
      if (byIdentity.userId !== userId) {
        throw new LinkedAccountConflictError(
          "PROVIDER_IDENTITY_OWNED_BY_ANOTHER_USER"
        );
      }
      return byIdentity;
    }
    const byUser = await this.repository.findActiveByUserAndProvider(
      userId,
      STEAM
    );
    if (byUser) {
      // Same user, different active Steam identity: replacing it would silently
      // rewrite which Steam account this Nexus user owns.
      throw new LinkedAccountConflictError(
        "USER_ALREADY_LINKED_TO_ANOTHER_PROVIDER_IDENTITY"
      );
    }
    return undefined;
  }

  private async reconcile(
    account: LinkedPlatformAccountRecord,
    profile?: SteamLinkProfile
  ): Promise<EnsureLinkedAccountResult> {
    const displayName =
      profile?.displayName !== undefined &&
      profile.displayName !== account.displayName
        ? profile.displayName
        : undefined;
    const avatarUrl =
      profile?.avatarUrl !== undefined && profile.avatarUrl !== account.avatarUrl
        ? profile.avatarUrl
        : undefined;
    if (displayName === undefined && avatarUrl === undefined) {
      return { status: "unchanged", account };
    }
    await this.repository.updateProfile({
      id: account.id,
      ...(displayName !== undefined ? { displayName } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {})
    });
    return {
      status: "updated",
      account: {
        ...account,
        ...(displayName !== undefined ? { displayName } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {})
      }
    };
  }
}
