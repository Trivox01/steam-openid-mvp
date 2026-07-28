import { profileBadgeRegistry } from "./badgeRegistry.ts";
import type { UserBadge } from "./types.ts";

export interface LocalBadgeEvidence {
  perfectGames?: number;
  achievementsUnlocked?: number;
  /**
   * Trusted local fixtures or a future privileged source may supply manual grants.
   * User-editable profile fields must never be passed here.
   */
  manualBadgeIds?: readonly string[];
}

export function resolveBadges(evidence: LocalBadgeEvidence): UserBadge[] {
  const granted = new Set(evidence.manualBadgeIds ?? []);
  if ((evidence.perfectGames ?? 0) >= 3) granted.add("completionist");
  if ((evidence.achievementsUnlocked ?? 0) >= 100) granted.add("quest-master");

  return profileBadgeRegistry
    .filter((badge) => badge.visible && granted.has(badge.id))
    .filter((badge) => badge.grantMode === "automatic" || evidence.manualBadgeIds?.includes(badge.id))
    .sort((left, right) => right.priority - left.priority)
    .map((badge) => ({ ...badge }));
}

export function visibleBadges(badges: readonly UserBadge[], limit = 3) {
  const sorted = badges.filter((badge) => badge.visible).sort((left, right) => right.priority - left.priority);
  return { visible: sorted.slice(0, limit), remaining: Math.max(0, sorted.length - limit) };
}
