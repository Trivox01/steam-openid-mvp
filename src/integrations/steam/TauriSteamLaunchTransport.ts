import { openUrl } from "@tauri-apps/plugin-opener";
import type { SteamLaunchTransport } from "../../services/GameLauncherService";
const STEAM_ACTION=/^steam:\/\/(run|install|store)\/[1-9]\d*$/;
const STEAM_ABOUT="https://store.steampowered.com/about/";
export class TauriSteamLaunchTransport implements SteamLaunchTransport {
  async open(uri:string){if(!STEAM_ACTION.test(uri)&&uri!=="steam://open/main"&&uri!==STEAM_ABOUT)throw new Error("invalid_steam_action_uri");await openUrl(uri)}
}
