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
    const result = await this.connection.getOwnedGames();
    return result.games.map((game) => ({
      id: `steam:${game.appId}`,
      appId: String(game.appId),
      platform: "steam",
      name: game.name,
      coverUrl: "",
      backgroundUrl: "",
      playtimeHours: game.playtimeForeverMinutes / 60,
      totalAchievements: 0,
      unlockedAchievements: 0,
      completionPercentage: 0,
      lastPlayedAt: game.lastPlayedUnix ? new Date(game.lastPlayedUnix * 1000).toISOString() : "",
      playtimeTwoWeeksMinutes: game.playtimeTwoWeeksMinutes,
      playtimeWindowsMinutes: game.playtimeWindowsMinutes,
      playtimeMacMinutes: game.playtimeMacMinutes,
      playtimeLinuxMinutes: game.playtimeLinuxMinutes
    }));
  }

  getOwnedGamesWithMetadata() {
    return this.connection.getOwnedGames();
  }

  async getGameAchievements(_appId: string): Promise<Achievement[]> {
    throw new Error("Steam achievement synchronization is not available in this phase.");
  }

  async syncData(): Promise<void> {
    throw new Error("Steam synchronization is not available in this phase.");
  }
}
