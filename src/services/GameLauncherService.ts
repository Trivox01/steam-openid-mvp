export type GameAvailabilityStatus =
  | "installed" | "not_installed" | "running" | "owned_not_installed"
  | "not_owned" | "steam_not_installed" | "steam_unavailable" | "unknown";
export type GameOwnership = "owned" | "not_owned" | "unknown";
export type GameAction = "play" | "install" | "store" | "check" | "installSteam";
export type GameActionStatus = "idle" | "openingSteam" | "error";
export type GameSessionState = "running" | "notRunning" | "unknown";

export interface GameSessionProbe { getState(appId: string): Promise<GameSessionState>; }
export interface GameSessionLifecycleEvent { type: "sessionStarted" | "sessionEnded"; appId: string; occurredAt: string; }
export interface SteamLaunchTransport { open(uri: string): Promise<void>; }
export interface SteamInstallationState { steamStatus: "installed" | "not_installed" | "unavailable"; installed: boolean; }
export interface SteamInstallationProbe {
  getState(appId: string, forceRefresh?: boolean): Promise<SteamInstallationState>;
  invalidate(): Promise<void>;
}
export interface GameLaunchSnapshot {
  appId: string; availability: GameAvailabilityStatus; action: GameAction; actionStatus: GameActionStatus;
}

type Listener = (snapshot: GameLaunchSnapshot) => void;
type LauncherLogger = (entry: { appId: string; launchUri: string; result: string; durationMs: number }) => void;
const MAX_STEAM_APP_ID = 4_294_967_295;
const defaultSessionProbe: GameSessionProbe = { getState: async () => "unknown" };

export class GameLauncherService {
  private readonly snapshots = new Map<string, GameLaunchSnapshot>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly inFlight = new Map<string, Promise<GameLaunchSnapshot>>();
  private readonly ownership = new Map<string,GameOwnership>();
  private readonly transport:SteamLaunchTransport;private readonly installationProbe:SteamInstallationProbe;private readonly sessionProbe:GameSessionProbe;private readonly logger?:LauncherLogger;private readonly handoffDelayMs:number;
  constructor(
    transport: SteamLaunchTransport,installationProbe: SteamInstallationProbe,sessionProbe: GameSessionProbe = defaultSessionProbe,logger?: LauncherLogger,handoffDelayMs = 800
  ) {this.transport=transport;this.installationProbe=installationProbe;this.sessionProbe=sessionProbe;this.logger=logger;this.handoffDelayMs=handoffDelayMs}

  static normalizeAppId(value: string | number): string | undefined {
    const raw=String(value).trim(); if(!/^[1-9]\d*$/.test(raw))return undefined;
    const parsed=Number(raw); return Number.isSafeInteger(parsed)&&parsed<=MAX_STEAM_APP_ID?String(parsed):undefined;
  }
  static buildUri(action: "run"|"install"|"store", value: string|number) {
    const appId=this.normalizeAppId(value); if(!appId)throw new Error("invalid_app_id"); return `steam://${action}/${appId}`;
  }
  static buildLaunchUri(value:string|number){return this.buildUri("run",value)}

  getSnapshot(value:string|number):GameLaunchSnapshot {
    const appId=GameLauncherService.normalizeAppId(value); if(!appId)return {appId:String(value),availability:"unknown",action:"check",actionStatus:"error"};
    return this.snapshots.get(appId)??{appId,availability:"unknown",action:"check",actionStatus:"idle"};
  }
  subscribe(value:string|number,listener:Listener){const appId=GameLauncherService.normalizeAppId(value)??String(value);const set=this.listeners.get(appId)??new Set<Listener>();set.add(listener);this.listeners.set(appId,set);listener(this.getSnapshot(appId));return()=>{set.delete(listener);if(!set.size)this.listeners.delete(appId)}}

  async refresh(value:string|number,ownership:GameOwnership,forceRefresh=false){
    const appId=GameLauncherService.normalizeAppId(value);if(!appId)return this.publish({appId:String(value),availability:"unknown",action:"check",actionStatus:"error"});
    this.ownership.set(appId,ownership);
    try {
      const local=await this.installationProbe.getState(appId,forceRefresh);
      let availability:GameAvailabilityStatus;
      if(local.steamStatus==="not_installed")availability="steam_not_installed";
      else if(local.steamStatus==="unavailable")availability="steam_unavailable";
      else if(local.installed)availability=(await this.sessionProbe.getState(appId))==="running"?"running":"installed";
      else if(ownership==="owned")availability="owned_not_installed";
      else if(ownership==="not_owned")availability="not_owned";
      else availability="not_installed";
      return this.publish({...fromAvailability(appId,availability),actionStatus:"idle"});
    } catch { return this.publish({...fromAvailability(appId,"unknown"),actionStatus:"idle"}); }
  }

  act(value:string|number,ownership:GameOwnership):Promise<GameLaunchSnapshot>{
    const appId=GameLauncherService.normalizeAppId(value);if(!appId)return Promise.resolve(this.getSnapshot(value));
    const existing=this.inFlight.get(appId);if(existing)return existing;
    const task=this.performAction(appId,ownership).finally(()=>this.inFlight.delete(appId));this.inFlight.set(appId,task);return task;
  }

  async openSteamInstaller(value:string|number){
    const appId=GameLauncherService.normalizeAppId(value);if(!appId)return this.getSnapshot(value);
    return this.open(appId,"https://store.steampowered.com/about/","installSteam");
  }

  async invalidate(){await this.installationProbe.invalidate();await Promise.all([...this.ownership].map(([appId,ownership])=>this.refresh(appId,ownership,true)));}
  async installationChanged(appId?:string){const entries=appId?(this.ownership.has(appId)?[[appId,this.ownership.get(appId)!] as const]:[]):[...this.ownership];await Promise.all(entries.map(([id,ownership])=>this.refresh(id,ownership)));}

  private async performAction(appId:string,ownership:GameOwnership){
    let snapshot=this.getSnapshot(appId);
    if(snapshot.availability==="unknown")snapshot=await this.refresh(appId,ownership);
    if(snapshot.availability==="running")return snapshot;
    if(snapshot.availability==="steam_not_installed")return snapshot;
    const uri=snapshot.action==="play"?GameLauncherService.buildUri("run",appId)
      :snapshot.action==="install"?GameLauncherService.buildUri("install",appId)
      :GameLauncherService.buildUri("store",appId);
    return this.open(appId,uri,snapshot.action);
  }

  private async open(appId:string,uri:string,action:GameAction){
    const started=performance.now();const current=this.getSnapshot(appId);
    this.publish({...current,actionStatus:"openingSteam"});
    try{await this.transport.open(uri);if(action==="install"){await this.installationProbe.invalidate();await delay(this.handoffDelayMs)}
      const result=this.publish({...current,actionStatus:"idle"});this.log(appId,uri,"opened",started);return result;
    }catch{const result=this.publish({...current,actionStatus:"error"});this.log(appId,uri,"failed",started);return result;}
  }
  private publish(snapshot:GameLaunchSnapshot){this.snapshots.set(snapshot.appId,snapshot);this.listeners.get(snapshot.appId)?.forEach(listener=>listener(snapshot));return snapshot}
  private log(appId:string,launchUri:string,result:string,started:number){this.logger?.({appId,launchUri,result,durationMs:Math.round(performance.now()-started)})}
}

function fromAvailability(appId:string,availability:GameAvailabilityStatus):Omit<GameLaunchSnapshot,"actionStatus">{
  const action:GameAction=availability==="installed"?"play":availability==="owned_not_installed"?"install":availability==="not_owned"?"store":availability==="steam_not_installed"?"installSteam":"check";
  return {appId,availability,action};
}
function delay(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms))}
