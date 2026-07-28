import type { UserBadge } from "./types";

export const profileBadgeRegistry: readonly UserBadge[] = [
  { id: "founder", name: "Founder", description: "Helped establish Achievement Nexus from its earliest foundation.", icon: "crown.svg", rarity: "exclusive", source: "staff", grantMode: "manual", priority: 100, visible: true },
  { id: "developer", name: "Developer", description: "Member of the Achievement Nexus development team.", icon: "code-2.svg", rarity: "exclusive", source: "staff", grantMode: "manual", priority: 95, visible: true },
  { id: "staff", name: "Staff", description: "Official member of the Achievement Nexus team.", icon: "shield-check.svg", rarity: "exclusive", source: "staff", grantMode: "manual", priority: 90, visible: true },
  { id: "moderator", name: "Moderator", description: "Trusted moderator of the Achievement Nexus community.", icon: "shield.svg", rarity: "legendary", source: "staff", grantMode: "manual", priority: 85, visible: true },
  { id: "tournament-supervisor", name: "Tournament Supervisor", description: "Supervises official Achievement Nexus tournaments.", icon: "swords.svg", rarity: "epic", source: "staff", grantMode: "manual", priority: 80, visible: true },
  { id: "bug-hunter", name: "Bug Hunter", description: "Reported a verified issue that improved Achievement Nexus.", icon: "bug.svg", rarity: "rare", source: "event", grantMode: "manual", priority: 70, visible: true },
  { id: "early-supporter", name: "Early Supporter", description: "Joined Achievement Nexus during its early release period.", icon: "sparkles.svg", rarity: "epic", source: "event", grantMode: "manual", priority: 65, visible: true },
  { id: "completionist", name: "Completionist", description: "Completed multiple games at 100%.", icon: "trophy.svg", rarity: "rare", source: "achievement", grantMode: "automatic", priority: 60, visible: true },
  { id: "quest-master", name: "Quest Master", description: "Unlocked a remarkable collection of achievements.", icon: "scroll-text.svg", rarity: "uncommon", source: "achievement", grantMode: "automatic", priority: 50, visible: true },
  { id: "legacy-username", name: "Legacy Username", description: "Preserved a recognized username from an earlier era.", icon: "history.svg", rarity: "common", source: "system", grantMode: "manual", priority: 40, visible: true }
] as const;
