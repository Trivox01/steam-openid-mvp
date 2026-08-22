/**
 * Game catalog contracts.
 *
 * CanonicalGame and PlatformGame are different concepts and must stay that way:
 * a canonical game is the product-level title, a platform game is one
 * provider's concrete entry (Steam AppID, Xbox title id, PlayStation title id).
 * A canonical link is only ever created from verified evidence. Matching titles
 * are not evidence.
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

export type CanonicalMappingMethod =
  | "provider_verified"
  | "editorial_verified"
  | "user_confirmed"
  /** Review hint only. This method can never produce a link. */
  | "title_similarity_candidate";

export type CanonicalMappingConfidence = "verified" | "candidate";

export type CanonicalMapping = {
  readonly method: CanonicalMappingMethod;
  readonly confidence: CanonicalMappingConfidence;
  readonly verifiedBy: string;
  readonly verifiedAt: string;
  readonly evidence?: string;
};

export type PlatformGameArtwork = {
  readonly coverUrl?: string;
  readonly backgroundUrl?: string;
  readonly iconUrl?: string;
};

export type PlatformGame = {
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
  readonly id: UserGameOwnershipId;
  readonly userId: NexusUserId;
  /** Ownership belongs to a linked account, not directly to a provider. */
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

export function platformGameKey(
  provider: NexusProvider,
  providerGameId: string
): PlatformGameId {
  return `${provider}:${providerGameId}`;
}

export function isVerifiedMapping(mapping?: CanonicalMapping): boolean {
  if (!mapping) return false;
  if (mapping.method === "title_similarity_candidate") return false;
  return mapping.confidence === "verified" && mapping.verifiedBy.length > 0;
}

/**
 * Title similarity produces a review candidate, never a mapping. It exists so
 * a future matching phase has a typed place to put hints that the domain will
 * still refuse to persist as a link.
 */
export function candidateMappingFromTitleMatch(
  similarity: number,
  observedAt: string
): CanonicalMapping {
  return {
    method: "title_similarity_candidate",
    confidence: "candidate",
    verifiedBy: "automated_title_similarity",
    verifiedAt: observedAt,
    evidence: `title_similarity=${similarity.toFixed(2)}`
  };
}

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
