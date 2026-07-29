export type BadgeCategory = "staff" | "community" | "achievement" | "event" | "legacy" | "special";
export type BadgeRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "exclusive";
export type BadgeGrantMode = "manual" | "automatic";

export interface ManagedBadge {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  category: BadgeCategory;
  rarity: BadgeRarity;
  iconAssetId?: string;
  priority: number;
  isActive: boolean;
  isVisible: boolean;
  grantMode: BadgeGrantMode;
  startsAt?: string;
  endsAt?: string;
  updatedAt: string;
  archivedAt?: string;
}

export type BadgeDraft = Omit<ManagedBadge, "id" | "updatedAt" | "archivedAt">;
