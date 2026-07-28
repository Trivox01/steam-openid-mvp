import type { Achievement } from "../types";

export function knownAchievementRarity(achievement: Achievement) {
  return achievement.globalUnlockPercent ??
    (achievement.source === "steam" ? undefined : achievement.rarityPercentage);
}

export function isAchievementUnlocked(achievement: Achievement) {
  return achievement.unlocked ?? Boolean(achievement.unlockedAt);
}
