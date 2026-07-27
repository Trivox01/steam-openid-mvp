import type { Achievement, Game, UserProfile } from "../../types";
import type { PlatformProvider } from "./PlatformProvider";
import {
  SteamConnectionService,
  steamProfileToUserProfile
} from "./SteamConnectionService";

export class SteamProvider implements PlatformProvider {
  constructor(private connection: SteamConnectionService) {}

  async authenticate(): Promise<void> {
    const profile = await this.connection.getSavedProfile();
    if (!profile) throw new Error("No Steam account is connected.");
  }

  async getUserProfile(): Promise<UserProfile> {
    const profile = await this.connection.getSavedProfile();
    if (!profile) throw new Error("No Steam account is connected.");
    return steamProfileToUserProfile(profile);
  }

  async getOwnedGames(): Promise<Game[]> {
    throw new Error("Steam library synchronization is not available in this phase.");
  }

  async getGameAchievements(_appId: string): Promise<Achievement[]> {
    throw new Error("Steam achievement synchronization is not available in this phase.");
  }

  async syncData(): Promise<void> {
    throw new Error("Steam synchronization is not available in this phase.");
  }
}
