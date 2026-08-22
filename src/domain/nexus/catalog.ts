/**
 * Game catalog contracts.
 *
 * CanonicalGame and PlatformGame are different concepts and must stay that way:
 * a canonical game is the product-level title, a platform game is one
 * provider's concrete entry (Steam AppID, Xbox title id, PlayStation title id).
 *
 * Trust model (correction pass):
 * - A shared canonical link is only ever created from provider or editorial
 *   verification. A single user's confirmation can NEVER promote a platform
 *   game into the shared canonical catalog; it only ever produces a per-user
 *   suggestion/candidate that lives outside PlatformGame.
 * - Matching titles are not evidence and remain candidate-only.
 *
 * ID model: PlatformGame.id is an internal opaque (future UUID) database id.
 * provider + providerGameId is the unique provider identity. The legacy
 * "steam:<appId>" string is a compatibility key only, not a future DB PK.
 */

import type { NexusProvider } from "./provider.ts";
import type { LinkedPlatformAccountId, NexusUserId } from "./identity.ts";

export type CanonicalGameId = string;
export type PlatformGameId = string;
export type UserGameOwnershipId = string;

export type CanonicalGame = {
  readonly id: CanonicalGameId;
  readonly title: string;
  readonly slug: string;
  readonly releaseYear?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/**
 * Only these methods may create a shared, globally verified mapping. A single
 * user's confirmation is NOT in this union on purpose: it can never become
 * global catalog truth.
 */
export type VerifiedCanonicalMappingMethod =
  | "provider_verified"
  | "editorial_verified";

/** Sources of non-authoritative per-user suggestions. */
export type CanonicalSuggestionMethod =
  | "user_confirmed"
  | "title_similarity_candidate";

/** Backwards-compatible alias kept for documentation; only verified methods. */
export type CanonicalMappingMethod = VerifiedCanonicalMappingMethod;

export type CanonicalMappingConfidence = "verified" | "candidate";

export type CanonicalMapping = {
  readonly method: VerifiedCanonicalMappingMethod;
  readonly confidence: CanonicalMappingConfidence;
  readonly verifiedBy: string;
  readonly verifiedAt: string;
  readonly evidence?: string;
};

/**
 * A per-user mapping suggestion. It references a PlatformGame but is stored
 * OUTSIDE the shared catalog (PlatformGame). It can never create a global
 * canonical link; it only queues a hint for editorial/provider verification.
 */
export type UserCanonicalMappingSuggestion = {
  readonly id: string;
  readonly platformGameId: PlatformGameId;
  readonly proposedCanonicalGameId: CanonicalGameId;
  readonly method: CanonicalSuggestionMethod;
  readonly suggestedByUserId: NexusUserId;
  readonly status: "pending" | "accepted_as_verified" | "rejected";
  readonly suggestedAt: string;
};

export type PlatformGameArtwork = {
  readonly coverUrl?: string;
  readonly backgroundUrl?: string;
  readonly iconUrl?: string;
};

export type PlatformGame = {
  /** Internal opaque/UUID database id. NOT the legacy "steam:<appId>" key. */
  readonly id: PlatformGameId;
  readonly provider: NexusProvider;
  /** Steam AppID, Xbox product/title id, PlayStation title id. */
  readonly providerGameId: string;
  readonly title: string;
  /** Absent until a verified mapping exists. Never inferred. */
  readonly canonicalGameId?: CanonicalGameId;
  readonly canonicalMapping?: CanonicalMapping;
  readonly artwork?: PlatformGameArtwork;
  readonly firstSeenAt: string;
  readonly updatedAt: string;
};

export type UserGameOwnership = {
  /** Internal opaque/UUID database id. */
  readonly id: UserGameOwnershipId;
  /**
   * Ownership belongs to a linked account. The owning Nexus user is derived
   * via linked_platform_accounts.user_id; there is intentionally no redundant
   * userId column here so a cross-user row is structurally impossible.
   */
  readonly linkedAccountId: LinkedPlatformAccountId;
  readonly platformGameId: PlatformGameId;
  readonly provider: NexusProvider;
  readonly playtimeMinutes?: number;
  /** False when the provider cannot supply playtime. Zero is not "unknown". */
  readonly playtimeKnown: boolean;
  readonly lastPlayedAt?: string;
  readonly acquiredAt?: string;
  readonly firstSeenAt: string;
  readonly lastSyncAt?: string;
};

export class CanonicalMappingError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "CanonicalMappingError";
  }
}

/** The unique provider identity of a platform game (NOT the internal DB id). */
export function platformGameKey(
  provider: NexusProvider,
  providerGameId: string
): string {
  return `${provider}:${providerGameId}`;
}

/**
 * Legacy compatibility key for the existing Steam runtime. This is a
 * compatibility handle only; it is NOT a future database primary key.
 */
export function legacySteamGameKey(appId: number | string): string {
  return `steam:${String(appId)}`;
}

export function isVerifiedMapping(mapping?: CanonicalMapping): boolean {
  if (!mapping) return false;
  return (
    (mapping.method === "provider_verified" ||
      mapping.method === "editorial_verified") &&
    mapping.confidence === "verified" &&
    mapping.verifiedBy.length > 0
  );
}

/**
 * A user confirmation only ever produces a per-user SUGGESTION. It is
 * deliberately typed so it cannot be passed to linkPlatformGameToCanonical(),
 * and a validator proves it cannot create a global link.
 */
export function suggestionFromUserConfirmation(
  id: string,
  platformGameId: PlatformGameId,
  proposedCanonicalGameId: CanonicalGameId,
  userId: NexusUserId,
  suggestedAt: string
): UserCanonicalMappingSuggestion {
  return {
    id,
    platformGameId,
    proposedCanonicalGameId,
    method: "user_confirmed",
    suggestedByUserId: userId,
    status: "pending",
    suggestedAt
  };
}

/**
 * Title similarity produces a review candidate, never a mapping. It is also
 * only a suggestion and can never be persisted as a shared link.
 */
export function candidateMappingFromTitleMatch(
  similarity: number,
  observedAt: string
): CanonicalMapping {
  return {
    method: "provider_verified",
    confidence: "candidate",
    verifiedBy: "automated_title_similarity",
    verifiedAt: observedAt,
    evidence: `title_similarity=${similarity.toFixed(2)}`
  };
}

/**
 * Only provider/editorial verified mappings may attach a shared canonical id.
 * A user-confirmed or title-similarity value can never reach this function in
 * a way that succeeds.
 */
export function linkPlatformGameToCanonical(
  platformGame: PlatformGame,
  canonicalGameId: CanonicalGameId,
  mapping: CanonicalMapping,
  updatedAt: string
): PlatformGame {
  if (!canonicalGameId) {
    throw new CanonicalMappingError("canonical_game_id_required");
  }
  if (!isVerifiedMapping(mapping)) {
    throw new CanonicalMappingError("unverified_mapping_rejected");
  }
  return {
    ...platformGame,
    canonicalGameId,
    canonicalMapping: mapping,
    updatedAt
  };
}

/** Unmapped platform games stay separate; they never merge by accident. */
export function canonicalGroupKey(platformGame: PlatformGame): string {
  return platformGame.canonicalGameId
    ? `canonical:${platformGame.canonicalGameId}`
    : `unmapped:${platformGame.id}`;
}

export type OwnershipEntry = {
  readonly ownership: UserGameOwnership;
  readonly platformGame: PlatformGame;
};

export type UnifiedLibraryGroup = {
  readonly key: string;
  readonly canonicalGameId?: CanonicalGameId;
  readonly providers: readonly NexusProvider[];
  readonly entries: readonly OwnershipEntry[];
};

/**
 * Pure grouping used to reason about a future unified library. No UI consumes
 * it in Phase 1.
 */
export function groupOwnershipByCanonical(
  entries: readonly OwnershipEntry[]
): UnifiedLibraryGroup[] {
  const groups = new Map<
    string,
    {
      canonicalGameId?: CanonicalGameId;
      providers: NexusProvider[];
      entries: OwnershipEntry[];
    }
  >();
  for (const entry of entries) {
    const key = canonicalGroupKey(entry.platformGame);
    const group = groups.get(key) ?? {
      canonicalGameId: entry.platformGame.canonicalGameId,
      providers: [],
      entries: []
    };
    group.entries.push(entry);
    if (!group.providers.includes(entry.platformGame.provider)) {
      group.providers.push(entry.platformGame.provider);
    }
    groups.set(key, group);
  }
  return Array.from(groups.entries()).map(([key, group]) => ({
    key,
    canonicalGameId: group.canonicalGameId,
    providers: group.providers,
    entries: group.entries
  }));
}
