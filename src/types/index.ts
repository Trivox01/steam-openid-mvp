export type Platform = "steam" | "playstation" | "xbox" | "other";
export type PageId = "dashboard" | "games" | "achievements" | "activity" | "statistics" | "settings";

export interface UserProfile {
  id: string;
  displayName: string;
  avatarUrl: string;
  level: number;
}

export interface Game {
  id: string;
  appId: string;
  platform: Platform;
  name: string;
  coverUrl: string;
  heroUrl: string;
  playtimeHours: number;
  totalAchievements: number;
  unlockedAchievements: number;
  completionPercentage: number;
  lastPlayedAt: string;
}

export interface Achievement {
  id: string;
  gameId: string;
  title: string;
  description: string;
  iconUrl: string;
  unlockedAt?: string;
  rarityPercentage: number;
  points: number;
  isHidden?: boolean;
}

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
