export const badgeCategories = ["staff", "community", "achievement", "event", "legacy", "special"] as const;
export const badgeRarities = ["common", "uncommon", "rare", "epic", "legendary", "exclusive"] as const;
export const badgeGrantModes = ["manual", "automatic"] as const;

export type BadgeCategory = typeof badgeCategories[number];
export type BadgeRarity = typeof badgeRarities[number];
export type BadgeGrantMode = typeof badgeGrantModes[number];

export interface BadgeDefinition {
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
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface BadgeMutation {
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
}

export interface BadgeListQuery {
  page: number;
  pageSize: number;
  search?: string;
  category?: BadgeCategory;
  rarity?: BadgeRarity;
  status?: "active" | "inactive" | "archived";
  sort: "updated_desc" | "updated_asc" | "priority_desc" | "name_asc";
}

export interface BadgeAsset {
  id: string;
  contentType: "image/png" | "image/webp";
  byteSize: number;
  width: number;
  height: number;
  isSquare: boolean;
  createdAt: string;
}

export class BadgeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "BadgeError";
  }
}
