import { openUrl } from "@tauri-apps/plugin-opener";
import type { SteamLaunchTransport } from "../../services/GameLauncherService";

export class TauriSteamLaunchTransport implements SteamLaunchTransport {
  async open(uri: string) {
    if (!/^steam:\/\/run\/[1-9]\d*$/.test(uri) && uri !== "steam://open/main") {
      throw new Error("invalid_steam_launch_uri");
    }
    await openUrl(uri);
  }
}
