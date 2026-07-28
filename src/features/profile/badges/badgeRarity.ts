import type { BadgeRarity } from "./types";

export interface BadgeRarityPresentation {
  labelKey: string;
  className: string;
  rank: number;
}

export const badgeRarity: Readonly<Record<BadgeRarity, BadgeRarityPresentation>> = {
  common: { labelKey: "profile.rarity.common", className: "profile-badge--common", rank: 0 },
  uncommon: { labelKey: "profile.rarity.uncommon", className: "profile-badge--uncommon", rank: 1 },
  rare: { labelKey: "profile.rarity.rare", className: "profile-badge--rare", rank: 2 },
  epic: { labelKey: "profile.rarity.epic", className: "profile-badge--epic", rank: 3 },
  legendary: { labelKey: "profile.rarity.legendary", className: "profile-badge--legendary", rank: 4 },
  exclusive: { labelKey: "profile.rarity.exclusive", className: "profile-badge--exclusive", rank: 5 }
};
