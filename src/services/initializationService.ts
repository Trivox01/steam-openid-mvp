import type { UserPreferences, UserProfile } from "../types";
import { repositories, services, storageMode } from "./compositionRoot";
import { steamProfileToUserProfile } from "./platform/SteamConnectionService";
export { defaultPreferences } from "./settingsPreferences";
export interface InitializationResult { preferences: UserPreferences; profile: UserProfile; storageMode: "sqlite"|"mock" }

export async function initializeApplication(): Promise<InitializationResult> {
  const preferences = await services.settings.get();
  const localProfile = await repositories.profile.getProfile() ?? {
    id: "local-player",
    displayName: "Player",
    avatarUrl: "",
    level: 0
  };
  let profile = localProfile;
  try {
    const steamProfile = await services.steam.getSavedProfile();
    if (steamProfile) profile = steamProfileToUserProfile(steamProfile);
  } catch {
    profile = localProfile;
  }
  return { preferences, profile, storageMode };
}
