import type {
  SteamConnectionResult,
  SteamCredentials,
  SteamProfile,
  UserProfile
} from "../../types";
import { TauriSteamGateway } from "../../integrations/steam/TauriSteamGateway";

const steamIdPattern = /^\d{17}$/;

export class SteamConnectionService {
  constructor(private gateway: TauriSteamGateway) {}

  get available() {
    return this.gateway.available;
  }

  async connect(credentials: SteamCredentials): Promise<SteamConnectionResult> {
    const steamId = credentials.steamId.trim();
    if (!steamIdPattern.test(steamId)) {
      return {
        success: false,
        errorCode: "invalid_steam_id",
        userMessage: "Enter a valid 17-digit SteamID64."
      };
    }
    if (!credentials.apiKey.trim()) {
      return {
        success: false,
        errorCode: "empty_api_key",
        userMessage: "Enter your Steam Web API key."
      };
    }
    return this.gateway.validate({ steamId, apiKey: credentials.apiKey });
  }

  getSavedProfile() {
    return this.gateway.getSavedProfile();
  }

  disconnect() {
    return this.gateway.disconnect();
  }

  getOwnedGames() {
    return this.gateway.getOwnedGames();
  }
}

export function steamProfileToUserProfile(profile: SteamProfile): UserProfile {
  return {
    id: profile.steamId,
    displayName: profile.personaName,
    avatarUrl: profile.avatarMediumUrl || profile.avatarFullUrl || profile.avatarUrl,
    level: 0
  };
}
