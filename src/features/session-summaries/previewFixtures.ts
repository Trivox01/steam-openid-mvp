import type { GameSessionSummary, SessionAchievement } from "../../services/GameSessionSummaryStore";

const now = Date.now();

function achievement(index: number, arabic = false): SessionAchievement {
  return {
    achievementId: `preview-achievement-${index}`,
    name: arabic ? `إنجاز تجريبي ${index}` : `Preview Achievement ${index}`,
    description: arabic ? "واصل رحلتك الرائعة." : "Keep your journey moving.",
    unlockedAt: new Date(now - (6 - index) * 60_000).toISOString(),
    rarityPercentage: 8 + index * 3
  };
}

export function sessionSummaryPreview(kind: "none" | "one" | "five" | "long" | "arabic"): GameSessionSummary {
  const counts = { none: 0, one: 1, five: 5, long: 1, arabic: 1 } as const;
  const arabic = kind === "arabic";
  const achievements = Array.from({ length: counts[kind] }, (_, index) => achievement(index + 1, arabic));
  return {
    sessionId: `preview-session-${kind}-${now}`,
    appId: "2807960",
    gameId: "preview-game",
    gameName: arabic ? "رحلة الأبطال: الإصدار الكامل" : kind === "long" ? "A Very Long Game Title: The Complete Definitive Adventure Edition" : "Achievement Nexus Preview",
    startedAtMs: now - 5_400_000,
    endedAtMs: now,
    durationSeconds: 5_400,
    achievementsUnlocked: achievements,
    unlockedCount: achievements.length,
    progressBefore: kind === "none" ? undefined : { unlocked: 12, total: 50, completionPercentage: 24 },
    progressAfter: kind === "none" ? undefined : { unlocked: 12 + achievements.length, total: 50, completionPercentage: (12 + achievements.length) * 2 },
    progressDelta: kind === "none" ? undefined : achievements.length,
    source: achievements.length ? "steam_unlock_time" : "session_monitor",
    generatedAtMs: now,
    recovered: false,
    seen: false
  };
}
