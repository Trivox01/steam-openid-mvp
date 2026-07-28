import type {
  Achievement,
  AchievementId,
  Game,
  GameId,
  PlayerActivity,
  SyncMetadata,
  UserPreferences,
  UserProfile
} from "../types";
import type {
  AchievementRepository,
  ActivityRepository,
  GameRepository,
  ProfileRepository,
  SettingsRepository,
  SyncMetadataRepository
} from "./contracts";
import { defaultPreferences } from "../services/settingsPreferences";

export class EphemeralGameRepository implements GameRepository {
  private games: Game[] = [];

  async getAllGames() { return structuredClone(this.games); }
  async getGameById(id: GameId) { return structuredClone(this.games.find((game) => game.id === id)); }
  async saveGames(games: Game[]) { this.games = structuredClone(games); }
  async updateGame(game: Game) {
    const index = this.games.findIndex((item) => item.id === game.id);
    if (index === -1) this.games.push(structuredClone(game));
    else this.games[index] = structuredClone(game);
  }
  async clearGames() { this.games = []; }
}

export class EphemeralAchievementRepository implements AchievementRepository {
  private achievements: Achievement[] = [];

  async getAchievements() { return structuredClone(this.achievements); }
  async getAchievementsByGame(gameId: GameId) {
    return structuredClone(this.achievements.filter((item) => item.gameId === gameId));
  }
  async getAchievementById(id: AchievementId) {
    return structuredClone(this.achievements.find((item) => item.id === id));
  }
  async saveAchievements(achievements: Achievement[]) { this.achievements = structuredClone(achievements); }
  async clearAchievements() { this.achievements = []; }
}

export class EphemeralSettingsRepository implements SettingsRepository {
  private preferences = structuredClone(defaultPreferences);

  async getPreferences() { return structuredClone(this.preferences); }
  async savePreferences(preferences: UserPreferences) { this.preferences = structuredClone(preferences); }
  async resetPreferences() { this.preferences = structuredClone(defaultPreferences); }
}

export class EphemeralActivityRepository implements ActivityRepository {
  private activities: PlayerActivity[] = [];

  async getActivities() { return structuredClone(this.activities); }
  async saveActivities(activities: PlayerActivity[]) { this.activities = structuredClone(activities); }
  async clearActivities() { this.activities = []; }
}

export class EphemeralProfileRepository implements ProfileRepository {
  private profile?: UserProfile;

  async getProfile() { return this.profile ? structuredClone(this.profile) : undefined; }
  async saveProfile(profile: UserProfile) { this.profile = structuredClone(profile); }
}

export class EphemeralSyncMetadataRepository implements SyncMetadataRepository {
  private values = new Map<string, SyncMetadata>();

  async getSyncMetadata(platformId: string) {
    const value = this.values.get(platformId);
    return value ? structuredClone(value) : undefined;
  }
  async saveSyncMetadata(metadata: SyncMetadata) {
    this.values.set(metadata.source, structuredClone(metadata));
  }
}
