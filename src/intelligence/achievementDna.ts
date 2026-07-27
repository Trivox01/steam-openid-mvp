import { DNA_THRESHOLDS } from "./constants.ts";
import { clamp, nonNegativeInteger } from "./scoring.ts";
import type { AchievementDna, AchievementDnaType, GameIntelligenceInput } from "./types.ts";

export function analyzeAchievementDna(games: GameIntelligenceInput[]): AchievementDna {
  const visible = games.filter((game) => game.hidden !== true);
  const completions = visible.map((game) => clamp(game.completionPercent, 0, 100));
  const playtimes = visible.map((game) => clamp(game.playtimeMinutes, 0, Number.MAX_SAFE_INTEGER));
  const averageCompletion = visible.length
    ? completions.reduce((sum, value) => sum + value, 0) / visible.length
    : 0;
  const completedGames = completions.filter((value) => value >= 100).length;
  const startedGames = playtimes.filter((value) => value > 0).length;
  const unstartedGames = visible.length - startedGames;
  const totalPlaytimeMinutes = playtimes.reduce((sum, value) => sum + value, 0);
  const rareAchievementsUnlocked = visible.reduce(
    (sum, game) => sum + nonNegativeInteger(game.rareAchievementsUnlocked),
    0
  );
  const metrics = {
    gamesAnalyzed: visible.length,
    averageCompletion: round(averageCompletion),
    completedGames,
    startedGames,
    unstartedGames,
    totalPlaytimeMinutes: round(totalPlaytimeMinutes),
    rareAchievementsUnlocked
  };
  if (visible.length < DNA_THRESHOLDS.minimumGames) {
    return {
      primaryType: "balanced",
      confidence: visible.length === 0 ? 0 : 0.2,
      metrics,
      reasonCodes: ["insufficient_game_sample"],
      translationKey: "intelligence.dna.insufficientData"
    };
  }

  const completedRatio = completedGames / visible.length;
  const unstartedRatio = unstartedGames / visible.length;
  const topPlaytime = Math.max(0, ...playtimes);
  const concentration = totalPlaytimeMinutes > 0 ? topPlaytime / totalPlaytimeMinutes : 0;
  const scores: Record<AchievementDnaType, number> = {
    completionist: averageCompletion >= DNA_THRESHOLDS.completionistAverage
      ? 0.55 + Math.min(0.45, completedRatio)
      : completedRatio * 0.6,
    explorer: startedGames >= DNA_THRESHOLDS.explorerMinimumStarted
      ? Math.min(1, 0.55 + startedGames / 40)
      : startedGames / 20,
    rareHunter: Math.min(1, rareAchievementsUnlocked / (DNA_THRESHOLDS.rareHunterMinimumRareUnlocks * 1.5)),
    focusedPlayer: startedGames <= DNA_THRESHOLDS.focusedMaximumStartedGames && concentration >= DNA_THRESHOLDS.focusedConcentrationRatio
      ? 0.8
      : concentration * 0.6,
    collector: visible.length >= DNA_THRESHOLDS.collectorMinimumGames && unstartedRatio >= DNA_THRESHOLDS.collectorUnstartedRatio
      ? 0.75 + Math.min(0.25, unstartedRatio - DNA_THRESHOLDS.collectorUnstartedRatio)
      : unstartedRatio * 0.6,
    casualPlayer: totalPlaytimeMinutes <= DNA_THRESHOLDS.casualMaximumMinutes
      ? 0.65
      : Math.max(0, 0.5 - totalPlaytimeMinutes / 20_000),
    balanced: 0.4
  };
  const ranked = (Object.entries(scores) as Array<[AchievementDnaType, number]>)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const [primary, secondary] = ranked;
  const primaryType = primary[1] < 0.55 ? "balanced" : primary[0];
  const confidence = primaryType === "balanced"
    ? 0.45
    : clamp(primary[1] * 0.75 + Math.max(0, primary[1] - secondary[1]) * 0.25, 0, 1);
  return {
    primaryType,
    secondaryType: secondary[1] >= 0.55 && secondary[0] !== primaryType ? secondary[0] : undefined,
    confidence: round(confidence),
    metrics,
    reasonCodes: [`dna_${primaryType}`, `sample_${visible.length}_games`],
    translationKey: `intelligence.dna.${primaryType}`
  };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
