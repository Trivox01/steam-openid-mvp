import type { ComponentType } from "react";

export type BadgeSource = "system" | "role" | "achievement" | "event";
export type BadgeRarity = "common" | "rare" | "epic" | "legendary";

export interface UserBadge {
  id: string;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string; size?: number; "aria-hidden"?: boolean }>;
  source: BadgeSource;
  rarity: BadgeRarity;
  earnedAt?: string;
  priority: number;
}

export interface BadgeDefinition extends Omit<UserBadge, "name" | "description" | "earnedAt"> {
  nameKey: string;
  descriptionKey: string;
}
