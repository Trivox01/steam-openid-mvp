import { profileBadgeRegistry } from "./badgeRegistry.ts";
import type { UserBadge } from "./types.ts";

type Translate = (key: string) => string;

export interface ProfileBadgeEvidence {
  steamVerified: boolean;
  perfectGames?: number;
  rareAchievementsUnlocked?: number;
  trustedRoleIds?: readonly string[];
  trustedEventIds?: readonly string[];
}

export function resolveProfileBadges(evidence: ProfileBadgeEvidence, translate: Translate): UserBadge[] {
  const granted = new Set<string>();
  if (evidence.steamVerified) granted.add("steam-verified");
  if ((evidence.perfectGames ?? 0) >= 3) granted.add("completionist");
  if ((evidence.rareAchievementsUnlocked ?? 0) >= 10) granted.add("rare-hunter");
  if (evidence.trustedRoleIds?.includes("developer")) granted.add("developer");
  if (evidence.trustedEventIds?.includes("early-supporter")) granted.add("early-supporter");

  return profileBadgeRegistry
    .filter((definition) => granted.has(definition.id))
    .map(({ nameKey, descriptionKey, ...definition }) => ({
      ...definition,
      name: translate(nameKey),
      description: translate(descriptionKey)
    }))
    .sort((left, right) => right.priority - left.priority);
}

export function visibleProfileBadges(badges: readonly UserBadge[], limit = 3) {
  const sorted = [...badges].sort((left, right) => right.priority - left.priority);
  return { visible: sorted.slice(0, limit), remaining: Math.max(0, sorted.length - limit) };
}
