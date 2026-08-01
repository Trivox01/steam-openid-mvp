import { invoke } from "@tauri-apps/api/core";
import type { SteamInstallationProbe, SteamInstallationState } from "../../services/GameLauncherService";
import { isTauriRuntime } from "../../runtime/environment";

type Index = { steamStatus:"installed"|"not_installed"|"unavailable";installedAppIds:string[];scannedAt:number };

export class TauriSteamInstallationProbe implements SteamInstallationProbe {
  private index?:Index; private active?:Promise<Index>;
  async getState(appId:string,forceRefresh=false):Promise<SteamInstallationState>{
    if(!isTauriRuntime())return {steamStatus:"unavailable",installed:false};
    const index=await this.load(forceRefresh);return {steamStatus:index.steamStatus,installed:index.installedAppIds.includes(appId)};
  }
  async invalidate(){this.index=undefined;this.active=undefined;if(isTauriRuntime())await invoke("invalidate_steam_installation_index").catch(()=>undefined)}
  private load(forceRefresh:boolean){
    if(this.index&&!forceRefresh)return Promise.resolve(this.index);if(this.active)return this.active;
    const task=invoke<Index>("get_steam_installation_index",{forceRefresh}).then(index=>(this.index=index,index)).finally(()=>{if(this.active===task)this.active=undefined});this.active=task;return task;
  }
}
