import { MockAchievementRepository, MockActivityRepository, MockGameRepository, MockProfileRepository, MockSettingsRepository, MockSyncMetadataRepository } from "../repositories/mockRepositories";
import { SqliteAchievementRepository, SqliteActivityRepository, SqliteGameRepository, SqliteProfileRepository, SqliteSettingsRepository, SqliteSyncMetadataRepository } from "../repositories/sqlite/repositories";
import { isTauriRuntime } from "../runtime/environment";
import { AchievementService, ActivityService, GameService, ProfileService, SettingsService, StatisticsService } from "./applicationServices";
import { TauriSteamGateway } from "../integrations/steam/TauriSteamGateway";
import { SteamConnectionService } from "./platform/SteamConnectionService";
import { SteamProvider } from "./platform/SteamProvider";
import { SteamLibrarySyncService } from "./platform/SteamLibrarySyncService";

const persistent = isTauriRuntime();
const games = persistent ? new SqliteGameRepository() : new MockGameRepository();
const achievements = persistent ? new SqliteAchievementRepository() : new MockAchievementRepository();
const activities = persistent ? new SqliteActivityRepository() : new MockActivityRepository();
const settings = persistent ? new SqliteSettingsRepository() : new MockSettingsRepository();
const profile = persistent ? new SqliteProfileRepository() : new MockProfileRepository();
const sync = persistent ? new SqliteSyncMetadataRepository() : new MockSyncMetadataRepository();
const steamConnection = new SteamConnectionService(new TauriSteamGateway());
export const steamProvider = new SteamProvider(steamConnection);

export const repositories = { games, achievements, activities, settings, profile, sync };
export const services = {
  games: new GameService(games, achievements),
  achievements: new AchievementService(achievements, games),
  activities: new ActivityService(activities),
  settings: new SettingsService(settings),
  profile: new ProfileService(profile),
  statistics: new StatisticsService(games, achievements, activities),
  steam: steamConnection,
  steamLibrarySync: new SteamLibrarySyncService(steamProvider, games, sync)
};
export const storageMode = persistent ? "sqlite" : "mock";
