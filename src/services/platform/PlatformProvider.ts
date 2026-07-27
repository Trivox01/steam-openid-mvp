import type { Achievement, Game, UserProfile } from "../../types";

export interface PlatformProvider {
  authenticate(): Promise<void>;
  getUserProfile(): Promise<UserProfile>;
  getOwnedGames(): Promise<Game[]>;
  getGameAchievements(appId: string): Promise<Achievement[]>;
  syncData(): Promise<void>;
}
