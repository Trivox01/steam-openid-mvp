import { mockAchievements, mockActivities, mockDashboardData, mockGames } from "../data/mockData";
import type { UserPreferences, UserProfile } from "../types";
import { repositories, services, storageMode } from "./compositionRoot";
import { steamProfileToUserProfile } from "./platform/SteamConnectionService";
export { defaultPreferences } from "./settingsPreferences";
export interface InitializationResult { preferences: UserPreferences; profile: UserProfile; storageMode: "sqlite"|"mock" }

export async function initializeApplication(): Promise<InitializationResult> {
  const games = await repositories.games.getAllGames();
  if (storageMode === "sqlite" && games.length === 0) {
    await repositories.games.saveGames(mockGames);
    await repositories.achievements.saveAchievements(mockAchievements);
    await repositories.activities.saveActivities(mockActivities);
    await repositories.profile.saveProfile(mockDashboardData.profile);
  }
  const preferences = await services.settings.get();
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
