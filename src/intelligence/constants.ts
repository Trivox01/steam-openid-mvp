export const JOURNEY_THRESHOLDS = {
  almostFinishedPercent: 80,
  worthReturningPercent: 50,
  recentDays: 14,
  returningDays: 30,
  forgottenDays: 90,
  recentlyCompletedDays: 14,
  minimumJourneyScore: 35,
  rareAchievementPercent: 10,
  minimumUsefulRarityPercent: 1
} as const;

export const JOURNEY_WEIGHTS = {
  completion: 35,
  remainingAchievements: 25,
  recency: 20,
  playing: 10,
  backlog: -5,
  abandoned: -15,
  favorite: 5
} as const;

export const DNA_THRESHOLDS = {
  minimumGames: 3,
  completionistAverage: 75,
  completionistCompletedRatio: 0.25,
  explorerMinimumStarted: 8,
  rareHunterMinimumRareUnlocks: 8,
  collectorMinimumGames: 12,
  collectorUnstartedRatio: 0.45,
  casualMaximumMinutes: 600,
  focusedMaximumStartedGames: 4,
  focusedConcentrationRatio: 0.7
} as const;
