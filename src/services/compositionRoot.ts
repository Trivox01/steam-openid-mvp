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
import { SteamOpenIdClient } from "./platform/SteamOpenIdClient";
import { SteamOpenIdSignInService } from "./platform/SteamOpenIdSignInService";
import { SteamBackendDataClient } from "./platform/SteamBackendDataClient";
import { SteamOpenIdDesktopRepository } from "../repositories/steamOpenIdDesktopRepository";
import { TauriExternalUrlOpener } from "../integrations/steam/TauriExternalUrlOpener";
import { getSteamAuthApiBaseUrl } from "../config/steamAuthApi";
import { featureFlags } from "../config/featureFlags";
import { AuthorizationClient } from "../features/developer-center/AuthorizationClient";
import { AuthorizationStore } from "../features/developer-center/AuthorizationStore";
import { BadgeAdminClient } from "../features/developer-center/badges/BadgeAdminClient";
import { BadgeAssignmentClient } from "../features/developer-center/assignments/BadgeAssignmentClient";
import { PublicBadgeClient } from "../features/profile/publicBadges/PublicBadgeClient";
import { PublicBadgeStore } from "../features/profile/publicBadges/PublicBadgeStore";
import { UserAdminClient } from "../features/developer-center/users/UserAdminClient";
import {
  publishAdminUserChange,
  publishApplicationRefresh,
  publishLibraryChange,
  subscribeToAdminUserChanges
} from "./dataEvents";
import {
  ApplicationRefreshCoordinator,
  RefreshHandlerError,
  skipped
} from "./ApplicationRefreshCoordinator";

const persistent = isTauriRuntime();
const games = persistent ? new SqliteGameRepository() : new EphemeralGameRepository();
const achievements = persistent ? new SqliteAchievementRepository() : new EphemeralAchievementRepository();
const activities = persistent ? new SqliteActivityRepository() : new EphemeralActivityRepository();
const settings = persistent ? new SqliteSettingsRepository() : new EphemeralSettingsRepository();
const profile = persistent ? new SqliteProfileRepository() : new EphemeralProfileRepository();
const sync = persistent ? new SqliteSyncMetadataRepository() : new EphemeralSyncMetadataRepository();
const steamConnection = new SteamConnectionService(new TauriSteamGateway());
const steamOpenId = createSteamOpenIdService();
const authorization = steamOpenId
  ? new AuthorizationStore(
      new AuthorizationClient(getSteamAuthApiBaseUrl()),
      steamOpenId
    )
  : undefined;
const badgeAdmin = steamOpenId
  ? new BadgeAdminClient(getSteamAuthApiBaseUrl(), steamOpenId)
  : undefined;
const badgeAssignments = steamOpenId
  ? new BadgeAssignmentClient(getSteamAuthApiBaseUrl(), steamOpenId)
  : undefined;
const publicBadges = steamOpenId
  ? new PublicBadgeStore(
      new PublicBadgeClient(getSteamAuthApiBaseUrl(), steamOpenId),
      steamOpenId
    )
  : undefined;
const userAdmin = steamOpenId
  ? new UserAdminClient(getSteamAuthApiBaseUrl(), steamOpenId)
  : undefined;
if (userAdmin) {
  subscribeToAdminUserChanges((userId) => userAdmin.invalidate(userId));
}

function createSteamOpenIdService() {
  if (!persistent || !featureFlags.steamOpenIdEnabled) return undefined;
  try {
    return new SteamOpenIdSignInService(
      new SteamOpenIdClient(getSteamAuthApiBaseUrl()),
      new SteamOpenIdDesktopRepository(),
      new TauriExternalUrlOpener()
    );
  } catch {
    return undefined;
  }
}
const steamData = steamOpenId
  ? new SteamBackendDataClient(getSteamAuthApiBaseUrl(), steamOpenId)
  : steamConnection;
export const steamProvider = new SteamProvider(steamConnection, steamData);

export const repositories = { games, achievements, activities, settings, profile, sync };
export const services = {
  games: new GameService(games, achievements),
  achievements: new AchievementService(achievements, games),
  activities: new ActivityService(activities),
  settings: new SettingsService(settings),
  profile: new ProfileService(profile),
  statistics: new StatisticsService(games, achievements),
  steam: steamConnection,
  steamOpenId,
  authorization,
  badgeAdmin,
  badgeAssignments,
  publicBadges,
  userAdmin,
  steamLibrarySync: new SteamLibrarySyncService(steamProvider, games, sync),
  steamAchievementSync: new SteamAchievementSyncService(steamProvider, games, achievements, sync)
};
export const applicationRefresh = new ApplicationRefreshCoordinator();
applicationRefresh.register({
  id: "local-library",
  run: async () => {
    await Promise.all([
      services.games.list(),
      services.achievements.list(),
      services.activities.list()
    ]);
    publishLibraryChange();
  }
});
applicationRefresh.register({
  id: "profile",
  run: async () => { await services.profile.get(); }
});
applicationRefresh.register({
  id: "statistics",
  run: async () => { await services.statistics.get(); }
});
applicationRefresh.register({
  id: "authorization",
  run: async () => {
    if (!services.authorization || !services.steamOpenId?.getActiveSession()) {
      return skipped("session_unavailable");
    }
    await services.authorization.retry();
    const state = services.authorization.getState();
    if (state.status === "error") throw new RefreshHandlerError(state.error);
    if (state.status === "unauthorized") return skipped("session_expired");
  }
});
applicationRefresh.register({
  id: "steam-library",
  run: async () => {
    if (services.steamOpenId) {
      if (!services.steamOpenId.getActiveSession()) return skipped("session_expired");
    } else {
      if (!services.steam.available || !await services.steam.hasApiKey()) {
        return skipped("steam_credentials_unavailable");
      }
      const legacyProfile = await services.steam.getSavedProfile();
      if (!legacyProfile) return skipped("steam_profile_unavailable");
    }
    await services.steamLibrarySync.sync();
    publishLibraryChange();
  }
});
applicationRefresh.register({
  id: "steam-achievements",
  run: async () => {
    if (services.steamOpenId) {
      if (!services.steamOpenId.getActiveSession()) return skipped("session_expired");
    } else {
      if (!services.steam.available || !await services.steam.hasApiKey()) {
        return skipped("steam_credentials_unavailable");
      }
      const legacyProfile = await services.steam.getSavedProfile();
      if (!legacyProfile) return skipped("steam_profile_unavailable");
    }
    await services.steamAchievementSync.sync();
    publishLibraryChange();
  }
});
applicationRefresh.register({
  id: "public-badges",
  run: async () => {
    if (!services.publicBadges || !services.steamOpenId?.getActiveSession()) {
      return skipped("session_unavailable");
    }
    await services.publicBadges.retry();
    if (services.publicBadges.getState().status === "error") {
      throw new RefreshHandlerError("network");
    }
  }
});
applicationRefresh.register({
  id: "developer-data",
  run: async () => {
    services.userAdmin?.invalidate();
    publishAdminUserChange();
    publishApplicationRefresh();
  }
});
export const storageMode = persistent ? "sqlite" : "ephemeral";
