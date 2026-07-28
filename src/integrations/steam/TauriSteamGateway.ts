import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../runtime/environment";
import type {
  SteamConnectionResult,
  SteamCredentials,
  SteamOwnedGamesResult,
  SteamGameAchievementsDto,
  SteamProfile
} from "../../types";

export class SteamIntegrationError extends Error {
  constructor(message: string, readonly code = "unknown") {
    super(message);
    this.name = "SteamIntegrationError";
  }

}

function readErrorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (typeof error === "string") {
    try {
      const decoded = JSON.parse(error) as { code?: unknown };
      if (typeof decoded.code === "string") return decoded.code;
    } catch {
      // Tauri can also return a plain string for non-structured command failures.
    }
  }
  return "unknown";
}

export class TauriSteamGateway {
  readonly available = isTauriRuntime();

  async validate(credentials: SteamCredentials): Promise<SteamConnectionResult> {
    if (!this.available) {
      return {
        success: false,
        errorCode: "tauri_required",
        userMessage: "Steam integration is available only in the desktop application."
      };
    }

    try {
      return await invoke<SteamConnectionResult>("validate_steam_connection", {
        steamId: credentials.steamId,
        apiKey: credentials.apiKey
      });
    } catch {
      throw new SteamIntegrationError(
        "The desktop application could not complete the Steam connection request."
      );
    }
  }

  async getOwnedGames(): Promise<SteamOwnedGamesResult> {
    if (!this.available) {
      throw new SteamIntegrationError(
        "Steam integration is available only in the desktop application.",
        "tauri_required"
      );
    }
    try {
      return await invoke<SteamOwnedGamesResult>("steam_get_owned_games");
    } catch (error) {
      throw new SteamIntegrationError(
        "The Steam library could not be synchronized.",
        readErrorCode(error)
      );
    }
  }

  async getGameAchievements(appId: number): Promise<SteamGameAchievementsDto> {
    if (!this.available) {
      throw new SteamIntegrationError("Steam integration is available only in the desktop application.", "tauri_required");
    }
    try {
      return await invoke<SteamGameAchievementsDto>("steam_get_game_achievements", { appId });
    } catch (error) {
      throw new SteamIntegrationError("Steam achievements could not be synchronized.", readErrorCode(error));
    }
  }

  async getSavedProfile(): Promise<SteamProfile | undefined> {
    if (!this.available) return undefined;
    try {
      return (await invoke<SteamProfile | null>("get_saved_steam_profile")) ?? undefined;
    } catch {
      throw new SteamIntegrationError("The saved Steam profile could not be loaded.");
    }
  }

  async disconnect(): Promise<void> {
    if (!this.available) {
      throw new SteamIntegrationError(
        "Steam integration is available only in the desktop application."
      );
    }
    try {
      await invoke<void>("disconnect_steam_account");
    } catch {
      throw new SteamIntegrationError("The Steam account could not be disconnected.");
    }
  }
}
