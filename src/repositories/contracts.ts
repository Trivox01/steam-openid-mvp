import type { Achievement, AchievementId, Game, GameId, PlayerActivity, SyncMetadata, UserPreferences, UserProfile } from "../types";

export interface GameRepository {
  getAllGames(): Promise<Game[]>;
  getGameById(id: GameId): Promise<Game | undefined>;
  saveGames(games: Game[]): Promise<void>;
  updateGame(game: Game): Promise<void>;
  clearGames(): Promise<void>;
}
export interface AchievementRepository {
  getAchievements(): Promise<Achievement[]>;
  getAchievementsByGame(gameId: GameId): Promise<Achievement[]>;
  getAchievementById(id: AchievementId): Promise<Achievement | undefined>;
  saveAchievements(achievements: Achievement[]): Promise<void>;
  clearAchievements(): Promise<void>;
}
export interface SettingsRepository {
  getPreferences(): Promise<UserPreferences>;
  savePreferences(preferences: UserPreferences): Promise<void>;
  resetPreferences(): Promise<void>;
}
export interface ActivityRepository {
  getActivities(): Promise<PlayerActivity[]>;
  saveActivities(activities: PlayerActivity[]): Promise<void>;
  clearActivities(): Promise<void>;
}
export interface ProfileRepository {
  getProfile(): Promise<UserProfile | undefined>;
  saveProfile(profile: UserProfile): Promise<void>;
}
export interface SyncMetadataRepository {
  getSyncMetadata(platformId: string): Promise<SyncMetadata | undefined>;
  saveSyncMetadata(metadata: SyncMetadata): Promise<void>;
}
