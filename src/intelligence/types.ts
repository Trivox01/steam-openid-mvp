export type IntelligenceGameStatus =
  | "notStarted"
  | "playing"
  | "completed"
  | "backlog"
  | "abandoned";

export interface GameIntelligenceInput {
  gameId: string;
  title?: string | null;
  platform?: string | null;
  playtimeMinutes?: number | null;
  unlockedAchievements?: number | null;
  totalAchievements?: number | null;
  completionPercent?: number | null;
  lastPlayedAt?: string | null;
  favorite?: boolean | null;
  hidden?: boolean | null;
  status?: IntelligenceGameStatus | null;
  rareAchievementsUnlocked?: number | null;
  rareAchievementsAvailable?: number | null;
  recentlyUnlockedAchievements?: number | null;
}

export interface AchievementIntelligenceInput {
  achievementId: string;
  gameId: string;
  title?: string | null;
  unlocked?: boolean | null;
  unlockDate?: string | null;
  globalUnlockPercent?: number | null;
  progressCurrent?: number | null;
  progressTarget?: number | null;
  hidden?: boolean | null;
}

export interface UserActivityInput {
  date: string;
  playtimeMinutes?: number | null;
  achievementsUnlocked?: number | null;
  gamesPlayed?: string[] | number | null;
}

export interface JourneyScoreBreakdown {
  completion: number;
  remainingAchievements: number;
  recency: number;
  status: number;
  favorite: number;
}

export interface RankedGame {
  gameId: string;
  title: string;
  score: number;
  eligible: boolean;
  breakdown: JourneyScoreBreakdown;
}

export type JourneyCardType =
  | "oneAchievementLeft"
  | "almostFinished"
  | "continueJourney"
  | "worthReturning"
  | "forgottenAdventure"
  | "rareOpportunity"
  | "recentlyCompleted"
  | "noAchievementsYet";

export interface JourneyCard {
  type: JourneyCardType;
  priority: number;
  gameId: string;
  title: string;
  reasonCode: string;
  metadata: Record<string, string | number | boolean | null>;
  translationKey: string;
  translationParams: Record<string, string | number>;
}

export interface NextAchievementRecommendation {
  achievementId: string;
  gameId: string;
  score: number;
  reasonCode: string;
  translationKey: string;
  metadata: {
    progressPercent: number | null;
    globalUnlockPercent: number | null;
    estimatedTimeMinutes: null;
  };
}

export type AchievementDnaType =
  | "completionist"
  | "explorer"
  | "rareHunter"
  | "focusedPlayer"
  | "collector"
  | "casualPlayer"
  | "balanced";

export interface AchievementDna {
  primaryType: AchievementDnaType;
  secondaryType?: AchievementDnaType;
  confidence: number;
  metrics: {
    gamesAnalyzed: number;
    averageCompletion: number;
    completedGames: number;
    startedGames: number;
    unstartedGames: number;
    totalPlaytimeMinutes: number;
    rareAchievementsUnlocked: number;
  };
  reasonCodes: string[];
  translationKey: string;
}

export interface WeeklyInsights {
  totalPlaytimeMinutes: number;
  achievementsUnlocked: number;
  gamesPlayed: number;
  activeDays: number;
  mostActiveDay: string | null;
  changeComparedToPreviousWeek: number | null;
  streakDays: number;
  translationKeys: string[];
}

export interface IntelligenceDiagnostics {
  ignoredInvalidGames: string[];
  ignoredInvalidAchievements: string[];
  insufficientDataFlags: string[];
}

export interface AchievementJourneyInput {
  games?: GameIntelligenceInput[] | null;
  achievements?: AchievementIntelligenceInput[] | null;
  activity?: UserActivityInput[] | null;
  now?: Date | string | number | null;
}

export interface AchievementJourneyAnalysis {
  rankedGames: RankedGame[];
  journeyCards: JourneyCard[];
  nextAchievement: NextAchievementRecommendation | null;
  achievementDna: AchievementDna;
  weeklyInsights: WeeklyInsights;
  diagnostics: IntelligenceDiagnostics;
}
