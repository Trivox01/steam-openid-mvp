import type { UserBadge } from "./badges/types";

export interface UserProfileStats {
  gamesOwned?: number;
  achievementsUnlocked?: number;
  perfectGames?: number;
  completionRate?: number;
}

export interface UserProfileSummary {
  id: string;
  steamId64?: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  bio?: string;
  status?: "online" | "idle" | "offline";
  isCurrentUser: boolean;
  isSteamVerified: boolean;
  authenticatedAt?: string;
  memberSince?: string;
  stats?: UserProfileStats;
  badges: UserBadge[];
}
