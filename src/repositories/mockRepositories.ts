import { mockAchievements, mockActivities, mockGames } from "../data/mockData";
import type { Achievement, AchievementId, Game, GameId, PlayerActivity, UserPreferences } from "../types";
import type { AchievementRepository, ActivityRepository, GameRepository, ProfileRepository, SettingsRepository, SyncMetadataRepository } from "./contracts";
import type { SyncMetadata, UserProfile } from "../types";
import { mockDashboardData } from "../data/mockData";

const defaultPreferences: UserPreferences = {
  theme: "dark", language: "English", launchAtStartup: false, minimizeToTray: true, automaticUpdates: true,
  achievementNotifications: true, completionNotifications: true, weeklyGoalReminder: true,
  hidePlaytime: false, hideHiddenGames: true
};

export class MockGameRepository implements GameRepository {
  private games = structuredClone(mockGames);
  async getAllGames() { return structuredClone(this.games); }
  async getGameById(id: GameId) { return structuredClone(this.games.find((game) => game.id === id)); }
  async saveGames(games: Game[]) { this.games = structuredClone(games); }
  async updateGame(game: Game) { this.games = this.games.map((item) => item.id === game.id ? structuredClone(game) : item); }
  async clearGames() { this.games = []; }
}
export class MockAchievementRepository implements AchievementRepository {
  private achievements = structuredClone(mockAchievements);
  async getAchievements() { return structuredClone(this.achievements); }
  async getAchievementsByGame(gameId: GameId) { return structuredClone(this.achievements.filter((item) => item.gameId === gameId)); }
  async getAchievementById(id: AchievementId) { return structuredClone(this.achievements.find((item) => item.id === id)); }
  async saveAchievements(achievements: Achievement[]) { this.achievements = structuredClone(achievements); }
  async clearAchievements() { this.achievements = []; }
}
export class MockSettingsRepository implements SettingsRepository {
  private preferences = structuredClone(defaultPreferences);
  async getPreferences() { return structuredClone(this.preferences); }
  async savePreferences(preferences: UserPreferences) { this.preferences = structuredClone(preferences); }
  async resetPreferences() { this.preferences = structuredClone(defaultPreferences); }
}
export class MockActivityRepository implements ActivityRepository {
  private activities = structuredClone(mockActivities);
  async getActivities() { return structuredClone(this.activities); }
  async saveActivities(activities: PlayerActivity[]) { this.activities = structuredClone(activities); }
  async clearActivities() { this.activities = []; }
}
export class MockProfileRepository implements ProfileRepository {
  private profile: UserProfile = structuredClone(mockDashboardData.profile);
  async getProfile() { return structuredClone(this.profile); }
  async saveProfile(profile: UserProfile) { this.profile = structuredClone(profile); }
}
export class MockSyncMetadataRepository implements SyncMetadataRepository {
  private values = new Map<string, SyncMetadata>();
  async getSyncMetadata(platformId: string) { const value = this.values.get(platformId); return value ? structuredClone(value) : undefined; }
  async saveSyncMetadata(metadata: SyncMetadata) { this.values.set(metadata.source, structuredClone(metadata)); }
}
