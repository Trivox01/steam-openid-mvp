import type { UserPreferences, UserProfile } from "../types";
import { repositories, services, storageMode } from "./compositionRoot";
export { defaultPreferences } from "./settingsPreferences";
export interface InitializationResult { preferences: UserPreferences; profile: UserProfile; storageMode: "sqlite"|"ephemeral" }

export async function initializeApplication(): Promise<InitializationResult> {
  await services.steamOpenId?.restoreSession();
  const preferences = await services.settings.get();
  const localProfile = await repositories.profile.getProfile() ?? {
    id: "local-player",
    displayName: "Player",
    avatarUrl: "",
    level: 0
  };
  return { preferences, profile: localProfile, storageMode };
}
