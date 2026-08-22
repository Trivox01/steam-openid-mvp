/**
 * Achievement contracts.
 *
 * An achievement definition belongs to a PlatformGame, because achievement sets
 * are provider-specific even for the same canonical title. Unlock state belongs
 * to a linked account, because it is earned on one provider account.
 */

import type { NexusProvider } from "./provider.ts";
import type { LinkedPlatformAccountId, NexusUserId } from "./identity.ts";
import type { PlatformGameId } from "./catalog.ts";

export type PlatformAchievementId = string;

/**
 * Provider scores are not a shared currency. Gamerscore and trophy grades are
 * never summed or compared across providers.
 */
export type ProviderScore =
  | { readonly kind: "none" }
  | { readonly kind: "xbox_gamerscore"; readonly value: number }
  | {
      readonly kind: "playstation_trophy";
      readonly grade: "bronze" | "silver" | "gold" | "platinum";
    };

export type PlatformAchievement = {
  readonly id: PlatformAchievementId;
  readonly platformGameId: PlatformGameId;
  readonly provider: NexusProvider;
  /** Steam api name, Xbox achievement id, PlayStation trophy id. */
  readonly providerAchievementId: string;
  readonly title: string;
  readonly description: string;
  readonly hidden: boolean;
  readonly iconUrl?: string;
  readonly lockedIconUrl?: string;
  readonly globalUnlockPercent?: number;
  readonly providerScore?: ProviderScore;
  readonly syncedAt?: string;
};

export type UserAchievementState = {
  readonly id: string;
  readonly userId: NexusUserId;
  readonly linkedAccountId: LinkedPlatformAccountId;
  readonly platformAchievementId: PlatformAchievementId;
  readonly unlocked: boolean;
  /**
   * Mirrors the existing Steam semantics: a provider may return a definition
   * without a reliable unlock state. Unknown state must never be counted as
   * locked in progress figures.
   */
  readonly unlockStateKnown: boolean;
  readonly unlockedAt?: string;
  readonly syncedAt?: string;
};

export type AchievementProgressSummary = {
  readonly total: number;
  readonly known: number;
  readonly unknown: number;
  readonly unlocked: number;
  /** Null when no unlock state is known. Never silently zero. */
  readonly completionPercentage: number | null;
};

export function platformAchievementKey(
  provider: NexusProvider,
  providerGameId: string,
  providerAchievementId: string
): PlatformAchievementId {
  return `${provider}:${providerGameId}:${providerAchievementId}`;
}

export function summarizeAchievementProgress(
  states: readonly UserAchievementState[]
): AchievementProgressSummary {
  const known = states.filter((state) => state.unlockStateKnown);
  const unlocked = known.filter((state) => state.unlocked).length;
  return {
    total: states.length,
    known: known.length,
    unknown: states.length - known.length,
    unlocked,
    completionPercentage:
      known.length === 0 ? null : Math.round((unlocked / known.length) * 100)
  };
}

export function canCompareProviderScores(
  first?: ProviderScore,
  second?: ProviderScore
): boolean {
  if (!first || !second) return false;
  if (first.kind === "none" || second.kind === "none") return false;
  return first.kind === second.kind;
}
