/**
 * Achievement contracts.
 *
 * An achievement definition belongs to a PlatformGame, because achievement sets
 * are provider-specific even for the same canonical title. Unlock state belongs
 * to a linked account, because it is earned on one provider account.
 *
 * Completion truth (correction pass): a completion percentage is exact only
 * when every state is known. If any state is unknown, the exact figure is null
 * and only a clearly-labelled, non-exact diagnostic figure is exposed.
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
  /** Internal opaque/UUID database id. NOT the legacy "steam:<appId>:<api>" key. */
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
  /** Internal opaque/UUID database id. */
  readonly id: string;
  /**
   * Unlock state belongs to a linked account. The owning Nexus user is derived
   * via linked_platform_accounts.user_id; there is no redundant userId here so
   * a cross-user row is structurally impossible.
   */
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
  /**
   * Exact completion percentage. Null unless EVERY state is known.
   *   - total === 0  -> null
   *   - known === 0  -> null
   *   - unknown > 0  -> null
   * Only when unknown === 0 and total > 0 is this an exact figure.
   */
  readonly completionPercentage: number | null;
  /**
   * Diagnostic/internal only. Computed over known states regardless of unknown
   * ones, and is therefore NOT an exact completion figure. Never surface this
   * as the user-facing completion percentage.
   */
  readonly knownCompletionPercentage: number | null;
};

/** The unique provider identity of an achievement (NOT the internal DB id). */
export function platformAchievementKey(
  provider: NexusProvider,
  providerGameId: string,
  providerAchievementId: string
): string {
  return `${provider}:${providerGameId}:${providerAchievementId}`;
}

/**
 * Legacy compatibility key for the existing Steam runtime. This is a
 * compatibility handle only; it is NOT a future database primary key.
 */
export function legacySteamAchievementKey(
  appId: number | string,
  apiName: string
): string {
  return `steam:${String(appId)}:${apiName}`;
}

export function summarizeAchievementProgress(
  states: readonly UserAchievementState[]
): AchievementProgressSummary {
  const total = states.length;
  const known = states.filter((state) => state.unlockStateKnown);
  const unknown = total - known.length;
  const unlocked = known.filter((state) => state.unlocked).length;
  const knownCompletionPercentage =
    known.length === 0 ? null : Math.round((unlocked / known.length) * 100);
  const completionPercentage =
    total === 0 || known.length === 0 || unknown > 0
      ? null
      : Math.round((unlocked / total) * 100);
  return {
    total,
    known: known.length,
    unknown,
    unlocked,
    completionPercentage,
    knownCompletionPercentage
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
