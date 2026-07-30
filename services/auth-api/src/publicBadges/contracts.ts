import type { BadgeCategory, BadgeRarity } from "../badges/contracts.ts";

export const PUBLIC_BADGE_LIMIT = 24;

export interface PublicBadge {
  slug: string;
  displayName: string;
  description: string;
  category: BadgeCategory;
  rarity: BadgeRarity;
  iconUrl: string;
}

export interface PublicBadgeAsset {
  storageKey: string;
  contentType: "image/png" | "image/webp";
}

export interface PublicBadgeCandidate {
  badge: PublicBadge;
  storageKey: string;
}
