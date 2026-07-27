import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../runtime/environment";
import type {
  SteamConnectionResult,
  SteamCredentials,
  SteamProfile
} from "../../types";

export class SteamIntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SteamIntegrationError";
  }
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
