export type Platform = "steam" | "playstation" | "xbox" | "other";
export type GameId = string;
export type AchievementId = string;
export type PlatformId = Platform;
export type PageId = "dashboard" | "games" | "achievements" | "activity" | "statistics" | "settings";

export interface UserProfile {
  id: string;
  displayName: string;
  avatarUrl: string;
  level: number;
}

export interface Game {
  id: GameId;
  appId: string;
  platform: Platform;
  name: string;
  coverUrl: string;
  backgroundUrl: string;
  playtimeHours: number;
  totalAchievements: number;
  unlockedAchievements: number;
  completionPercentage: number;
  lastPlayedAt: string;
}

export interface Achievement {
  id: AchievementId;
  gameId: GameId;
  title: string;
  description: string;
  iconUrl: string;
  unlockedAt?: string;
  rarityPercentage: number;
  points: number;
  isHidden?: boolean;
}

export interface GameDetails extends Game {
  rareAchievements: number;
  lockedAchievements: number;
  averageRarity: number;
  latestAchievement?: Achievement;
}

export interface AchievementDetails extends Achievement {
  gameName: string;
  rarityTier: "common" | "uncommon" | "rare" | "ultra_rare";
}

export interface UserPreferences {
  theme: "light" | "dark" | "system";
  language: "en" | "ar";
  launchAtStartup: boolean;
  minimizeToTray: boolean;
  notificationsEnabled: boolean;
  autoCheckForUpdates: boolean;
  hidePlaytime: boolean;
  hideHiddenGames: boolean;
}

export interface SyncMetadata {
  lastSyncedAt?: string;
  status: "idle" | "syncing" | "success" | "error";
  source: PlatformId | "mock";
}

export type NavigationView =
  | { kind: "page"; page: PageId }
  | { kind: "game"; gameId: GameId }
  | { kind: "achievement"; achievementId: AchievementId; gameId: GameId };

export type ActivityType = "achievement" | "new_game" | "completed_game" | "progress" | "weekly_goal";

export interface PlayerActivity {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  gameId?: string;
  occurredAt: string;
  metadata?: string;
}

export interface ActivityPoint {
  day: string;
  hours: number;
}

export interface DashboardData {
  profile: UserProfile;
  games: Game[];
  recentAchievements: Achievement[];
  weeklyActivity: ActivityPoint[];
  weeklyGoalHours: number;
}

export type AsyncState<T> =
  | { status: "loading"; data?: never; error?: never }
  | { status: "success"; data: T; error?: never }
  | { status: "empty"; data?: never; error?: never }
  | { status: "error"; data?: never; error: string };

export type {
  SteamConnectionResult,
  SteamConnectionStatus,
  SteamCredentials,
  SteamProfile
} from "./steam";
