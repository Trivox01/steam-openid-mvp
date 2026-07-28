import { openUrl } from "@tauri-apps/plugin-opener";
import type { ExternalUrlOpener } from "../../services/platform/SteamOpenIdSignInService";

export class TauriExternalUrlOpener implements ExternalUrlOpener {
  async open(url: string) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "steamcommunity.com" ||
      parsed.pathname !== "/openid/login"
    ) {
      throw new Error("invalid_steam_login_url");
    }
    await openUrl(parsed.toString());
  }
}
