import { BadgeCheck, Code2, Gem, Sparkles, Trophy } from "lucide-react";
import type { BadgeDefinition } from "./types";

export const profileBadgeRegistry: readonly BadgeDefinition[] = [
  { id: "developer", nameKey: "profile.badge.developer", descriptionKey: "profile.badge.developerDescription", icon: Code2, source: "role", rarity: "legendary", priority: 100 },
  { id: "steam-verified", nameKey: "profile.badge.steamVerified", descriptionKey: "profile.badge.steamVerifiedDescription", icon: BadgeCheck, source: "system", rarity: "common", priority: 90 },
  { id: "early-supporter", nameKey: "profile.badge.earlySupporter", descriptionKey: "profile.badge.earlySupporterDescription", icon: Sparkles, source: "event", rarity: "epic", priority: 70 },
  { id: "completionist", nameKey: "profile.badge.completionist", descriptionKey: "profile.badge.completionistDescription", icon: Trophy, source: "achievement", rarity: "rare", priority: 60 },
  { id: "rare-hunter", nameKey: "profile.badge.rareHunter", descriptionKey: "profile.badge.rareHunterDescription", icon: Gem, source: "achievement", rarity: "rare", priority: 50 }
] as const;
