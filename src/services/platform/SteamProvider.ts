import type { Achievement, Game, UserProfile } from "../../types";
import type { PlatformProvider } from "./PlatformProvider";
import {
  SteamConnectionService,
  steamProfileToUserProfile
} from "./SteamConnectionService";
import { steamArtworkUrls } from "./steamArtwork";
import type { SteamDataGateway } from "./SteamBackendDataClient";

export class SteamProvider implements PlatformProvider {
  constructor(
    private connection: SteamConnectionService,
    private data: SteamDataGateway = connection
  ) {}

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
    const result = await this.data.getOwnedGames();
    return result.games.map((game) => {
      const artwork = steamArtworkUrls(game.appId, game.iconHash);
      return ({
      id: `steam:${game.appId}`,
      appId: String(game.appId),
      platform: "steam",
      name: game.name,
      coverUrl: artwork.coverUrl,
      backgroundUrl: artwork.backgroundUrl,
      iconUrl: artwork.iconUrl || undefined,
      playtimeHours: game.playtimeForeverMinutes / 60,
      totalAchievements: 0,
      unlockedAchievements: 0,
      completionPercentage: 0,
      lastPlayedAt: game.lastPlayedUnix ? new Date(game.lastPlayedUnix * 1000).toISOString() : "",
      playtimeTwoWeeksMinutes: game.playtimeTwoWeeksMinutes ?? undefined,
      playtimeWindowsMinutes: game.playtimeWindowsMinutes ?? undefined,
      playtimeMacMinutes: game.playtimeMacMinutes ?? undefined,
      playtimeLinuxMinutes: game.playtimeLinuxMinutes ?? undefined
      });
    });
  }

  getOwnedGamesWithMetadata() {
    return this.data.getOwnedGames();
  }

  async getGameAchievements(_appId: string): Promise<Achievement[]> {
    const appId = Number(_appId);
    const result = await this.data.getGameAchievements(appId);
    return result.achievements.map((item) => ({
      id: `steam:${appId}:${item.apiName}`,
      gameId: "",
      title: item.displayName,
      description: item.description,
      iconUrl: item.iconUrl,
      lockedIconUrl: item.lockedIconUrl,
      unlocked: item.unlocked,
      unlockedAt: item.unlockedAt,
      rarityPercentage: item.globalUnlockPercent ?? 0,
      globalUnlockPercent: item.globalUnlockPercent,
      points: 0,
      isHidden: item.hidden,
      externalId: item.apiName,
      source: "steam",
      syncedAt: result.fetchedAt
    }));
  }

  getGameAchievementsWithMetadata(appId: string) {
    const numeric = Number(appId);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
      throw new Error("game_unsupported");
    }
    return this.data.getGameAchievements(numeric);
  }

  async syncData(): Promise<void> {
    throw new Error("Steam synchronization is not available in this phase.");
  }
}
