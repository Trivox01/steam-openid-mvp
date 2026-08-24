/** Backend-only Steam adapter. Legacy services are injected, never imported from desktop. */
import type { AdapterContext, AchievementSyncRequest, AchievementSyncOutcome, GameSyncOutcome, LibrarySyncOutcome, PlatformAdapter, ProviderProfile } from "./adapter.ts";
import { emptyCounters, unsupportedAchievementSync, unsupportedLibrarySync } from "./adapter.ts";
import { providerDescriptor } from "../../../../src/domain/nexus/provider.ts";

export type SteamLegacySyncBridge = { syncLibrary(signal?: AbortSignal): Promise<{ fetched:number; inserted:number; updated:number; unchanged:number; skipped:number; failed:number; syncedAt:string; warnings:readonly string[] }>; syncAchievements(input:{ gameIds?:string[]; signal?:AbortSignal }): Promise<{ gamesRequested:number; gamesSucceeded:number; gamesFailed:number; syncedAt:string; warnings:readonly string[] }> };

export class SteamPlatformAdapter implements PlatformAdapter {
  readonly provider = "steam" as const;
  readonly capabilities = providerDescriptor("steam").capabilities;
  private readonly legacy: SteamLegacySyncBridge;
  constructor(legacy: SteamLegacySyncBridge) {
    this.legacy = legacy;
  }
  async getProfile(context: AdapterContext): Promise<ProviderProfile> { return {provider:"steam",providerUserId:context.providerUserId,displayName:"Steam user"}; }
  async syncLibrary(context: AdapterContext): Promise<LibrarySyncOutcome> { if(this.capabilities.library !== "supported") return unsupportedLibrarySync("steam",context.linkedAccountId,new Date().toISOString()); const result=await this.legacy.syncLibrary(context.signal); return {provider:"steam",linkedAccountId:context.linkedAccountId,capability:"library",status:"success",syncedAt:result.syncedAt,counters:{fetched:result.fetched,inserted:result.inserted,updated:result.updated,unchanged:result.unchanged,skipped:result.skipped,failed:result.failed},warnings:result.warnings}; }
  async syncGame(context: AdapterContext, providerGameId: string): Promise<GameSyncOutcome> { const result=await this.syncLibrary(context); return {...result,capability:"game_metadata",providerGameId}; }
  async syncAchievements(context: AdapterContext, request: AchievementSyncRequest): Promise<AchievementSyncOutcome> { if(this.capabilities.achievements !== "supported") return unsupportedAchievementSync("steam",context.linkedAccountId,request.providerGameIds,new Date().toISOString()); const result=await this.legacy.syncAchievements({gameIds:[...request.providerGameIds],signal:context.signal}); return {provider:"steam",linkedAccountId:context.linkedAccountId,capability:"achievements",providerGameIds:request.providerGameIds,status:result.gamesFailed ? "partial":"success",syncedAt:result.syncedAt,counters:{...emptyCounters(),fetched:result.gamesRequested,updated:result.gamesSucceeded,failed:result.gamesFailed},warnings:result.warnings}; }
  async disconnect(): Promise<never> { throw new Error("capability_unsupported:steam:disconnect"); }
}
