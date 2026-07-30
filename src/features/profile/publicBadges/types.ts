export type PublicBadgeRarity =
  | "common" | "uncommon" | "rare" | "epic" | "legendary" | "exclusive";

export type PublicBadgeCategory =
  | "staff" | "community" | "achievement" | "event" | "legacy" | "special";

export interface PublicBadge {
  slug: string;
  displayName: string;
  description: string;
  category: PublicBadgeCategory;
  rarity: PublicBadgeRarity;
  iconUrl: string;
}
