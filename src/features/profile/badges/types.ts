export type BadgeSource = "system" | "achievement" | "event" | "staff";
export type BadgeRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "exclusive";
export type BadgeGrantMode = "automatic" | "manual";

export interface UserBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: BadgeRarity;
  source: BadgeSource;
  grantMode: BadgeGrantMode;
  priority: number;
  visible: boolean;
}
