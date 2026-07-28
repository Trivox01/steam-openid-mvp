import {
  EphemeralAchievementRepository,
  EphemeralActivityRepository,
  EphemeralGameRepository,
  EphemeralProfileRepository,
  EphemeralSettingsRepository,
  EphemeralSyncMetadataRepository
} from "../repositories/ephemeralRepositories";
import { SqliteAchievementRepository, SqliteActivityRepository, SqliteGameRepository, SqliteProfileRepository, SqliteSettingsRepository, SqliteSyncMetadataRepository } from "../repositories/sqlite/repositories";
import { isTauriRuntime } from "../runtime/environment";
import { AchievementService, ActivityService, GameService, ProfileService, SettingsService, StatisticsService } from "./applicationServices";
import { TauriSteamGateway } from "../integrations/steam/TauriSteamGateway";
import { SteamConnectionService } from "./platform/SteamConnectionService";
import { SteamProvider } from "./platform/SteamProvider";
import { SteamLibrarySyncService } from "./platform/SteamLibrarySyncService";
import { SteamAchievementSyncService } from "./platform/SteamAchievementSyncService";

const persistent = isTauriRuntime();
const games = persistent ? new SqliteGameRepository() : new EphemeralGameRepository();
const achievements = persistent ? new SqliteAchievementRepository() : new EphemeralAchievementRepository();
const activities = persistent ? new SqliteActivityRepository() : new EphemeralActivityRepository();
const settings = persistent ? new SqliteSettingsRepository() : new EphemeralSettingsRepository();
const profile = persistent ? new SqliteProfileRepository() : new EphemeralProfileRepository();
const sync = persistent ? new SqliteSyncMetadataRepository() : new EphemeralSyncMetadataRepository();
const steamConnection = new SteamConnectionService(new TauriSteamGateway());
export const steamProvider = new SteamProvider(steamConnection);

export const repositories = { games, achievements, activities, settings, profile, sync };
export const services = {
  games: new GameService(games, achievements),
  achievements: new AchievementService(achievements, games),
  activities: new ActivityService(activities),
  settings: new SettingsService(settings),
  profile: new ProfileService(profile),
  statistics: new StatisticsService(games, achievements),
  steam: steamConnection,
  steamLibrarySync: new SteamLibrarySyncService(steamProvider, games, sync),
  steamAchievementSync: new SteamAchievementSyncService(steamProvider, games, achievements, sync)
};
export const storageMode = persistent ? "sqlite" : "ephemeral";
