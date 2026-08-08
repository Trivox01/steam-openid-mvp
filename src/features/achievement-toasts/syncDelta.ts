import type { Achievement } from "../../types";
import type { AchievementToastEvent } from "./AchievementToastCoordinator";

export function trustedUnlockTransitions(appId: string, previous: Achievement[], next: Achievement[]) {
  const byId = new Map(previous.map((item) => [item.externalId ?? item.id, item]));
  return next.flatMap((item): AchievementToastEvent[] => {
    const before = byId.get(item.externalId ?? item.id);
    if (!before?.unlockStateKnown || before.unlocked !== false || item.unlockStateKnown !== true || item.unlocked !== true) return [];
    const achievementId = item.externalId ?? item.id;
    return [{ eventId: `${appId}:${achievementId}:${item.unlockedAt ?? "unlocked"}`, appId, achievementId,
      name: item.title, description: item.description || undefined, iconUrl: item.iconUrl || undefined,
      rarity: item.globalUnlockPercent, unlockedAt: item.unlockedAt, source: "sync_delta" }];
  });
}
