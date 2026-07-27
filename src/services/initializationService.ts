import { mockAchievements, mockActivities, mockDashboardData, mockGames } from "../data/mockData";
import type { UserPreferences, UserProfile } from "../types";
import { repositories, services, storageMode } from "./compositionRoot";
import { steamProfileToUserProfile } from "./platform/SteamConnectionService";

export const defaultPreferences: UserPreferences = {
  theme:"dark",language:"English",launchAtStartup:false,minimizeToTray:true,automaticUpdates:true,
  achievementNotifications:true,completionNotifications:true,weeklyGoalReminder:true,hidePlaytime:false,hideHiddenGames:true
};
export interface InitializationResult { preferences: UserPreferences; profile: UserProfile; storageMode: "sqlite"|"mock" }

export async function initializeApplication(): Promise<InitializationResult> {
  const games = await repositories.games.getAllGames();
  if (storageMode === "sqlite" && games.length === 0) {
    await repositories.games.saveGames(mockGames);
    await repositories.achievements.saveAchievements(mockAchievements);
    await repositories.activities.saveActivities(mockActivities);
    await repositories.profile.saveProfile(mockDashboardData.profile);
    await repositories.settings.savePreferences(defaultPreferences);
  }
  let preferences: UserPreferences;
  try { preferences = await repositories.settings.getPreferences(); }
  catch { preferences = defaultPreferences; await repositories.settings.savePreferences(preferences); }
  const localProfile = await repositories.profile.getProfile() ?? mockDashboardData.profile;
  let profile = localProfile;
  try {
    const steamProfile = await services.steam.getSavedProfile();
    if (steamProfile) profile = steamProfileToUserProfile(steamProfile);
  } catch {
    profile = localProfile;
  }
  return { preferences, profile, storageMode };
}
