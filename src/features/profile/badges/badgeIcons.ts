import {
  Bug,
  Code2,
  Crown,
  History,
  ScrollText,
  Shield,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  type LucideIcon
} from "lucide-react";

const badgeIcons: Readonly<Record<string, LucideIcon>> = {
  "bug.svg": Bug,
  "code-2.svg": Code2,
  "crown.svg": Crown,
  "history.svg": History,
  "scroll-text.svg": ScrollText,
  "shield.svg": Shield,
  "shield-check.svg": ShieldCheck,
  "sparkles.svg": Sparkles,
  "swords.svg": Swords,
  "trophy.svg": Trophy
};

export function resolveBadgeIcon(iconName: string): LucideIcon {
  return badgeIcons[iconName] ?? Shield;
}
