import type { AchievementToastEvent } from "./AchievementToastCoordinator";

const fixtures = [
  { name: "First Victory", description: "Win your first match.", rarity: 8.4 },
  { name: "A remarkably long achievement title that still fits comfortably", description: "Complete every optional objective without allowing the notification to grow beyond the screen.", rarity: 2.1 },
  { name: "Hidden Path", description: undefined, rarity: undefined },
  { name: "Fallback Champion", description: "Preview the local Nexus artwork fallback.", rarity: 14.2 },
  { name: "خطوة نحو القمة", description: "أكمل التحدي الأخير وافتح طريقًا جديدًا.", rarity: 4.8 }
] as const;

let previewIndex = 0;
export function nextAchievementToastPreview(): AchievementToastEvent {
  const fixture = fixtures[previewIndex++ % fixtures.length];
  const id = `preview-${Date.now()}-${previewIndex}`;
  return { eventId: id, appId: "preview", achievementId: id, ...fixture, source: "test_preview" };
}

export function achievementToastPreview(mode: "sound" | "silent") {
  return { ...nextAchievementToastPreview(), sound: mode === "silent" ? "silent" as const : "default" as const };
}

export function achievementToastQueuePreview(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...nextAchievementToastPreview(),
    eventId: `preview-queue-${Date.now()}-${index}`,
    achievementId: `preview-queue-${Date.now()}-${index}`
  }));
}
