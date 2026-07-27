import type { Achievement, AchievementId, Game, GameId, PlayerActivity, SyncMetadata, UserPreferences, UserProfile } from "../../types";
import type { AchievementRepository, ActivityRepository, GameRepository, ProfileRepository, SettingsRepository, SyncMetadataRepository } from "../contracts";
import { databaseCommands as cmd } from "./commands";
import { invokeDatabase } from "./invoke";
import { achievementToRecord, activityToRecord, gameToRecord, profileToRecord, recordToAchievement, recordToActivity, recordToGame, recordToProfile, type AchievementRecord, type ActivityRecord, type GameRecord, type ProfileRecord, type SyncRecord } from "./mappers";

export class SqliteGameRepository implements GameRepository {
  async getAllGames(){return (await invokeDatabase<GameRecord[]>(cmd.games.all)).map(recordToGame)}
  async getGameById(id:GameId){const row=await invokeDatabase<GameRecord|null>(cmd.games.byId,{id});return row?recordToGame(row):undefined}
  async saveGames(games:Game[]){await invokeDatabase<void>(cmd.games.save,{games:games.map(gameToRecord)})}
  async updateGame(game:Game){await invokeDatabase<void>(cmd.games.update,{game:gameToRecord(game)})}
  async clearGames(){await invokeDatabase<void>(cmd.games.clear)}
}
export class SqliteAchievementRepository implements AchievementRepository {
  async getAchievements(){return (await invokeDatabase<AchievementRecord[]>(cmd.achievements.all)).map(recordToAchievement)}
  async getAchievementsByGame(gameId:GameId){return (await invokeDatabase<AchievementRecord[]>(cmd.achievements.byGame,{gameId})).map(recordToAchievement)}
  async getAchievementById(id:AchievementId){const row=await invokeDatabase<AchievementRecord|null>(cmd.achievements.byId,{id});return row?recordToAchievement(row):undefined}
  async saveAchievements(items:Achievement[]){await invokeDatabase<void>(cmd.achievements.save,{items:items.map(achievementToRecord)})}
  async clearAchievements(){await invokeDatabase<void>(cmd.achievements.clear)}
}
export class SqliteActivityRepository implements ActivityRepository {
  async getActivities(){return (await invokeDatabase<ActivityRecord[]>(cmd.activities.all)).map(recordToActivity)}
  async saveActivities(items:PlayerActivity[]){await invokeDatabase<void>(cmd.activities.save,{items:items.map(activityToRecord)})}
  async clearActivities(){await invokeDatabase<void>(cmd.activities.clear)}
}
export class SqliteSettingsRepository implements SettingsRepository {
  async getPreferences(){return (await invokeDatabase<unknown|null>(cmd.preferences.get))??undefined}
  async savePreferences(preferences:UserPreferences){await invokeDatabase<void>(cmd.preferences.save,{preferences})}
  async resetPreferences(){await invokeDatabase<void>(cmd.preferences.reset)}
}
export class SqliteProfileRepository implements ProfileRepository {
  async getProfile(){const row=await invokeDatabase<ProfileRecord|null>(cmd.profile.get);return row?recordToProfile(row):undefined}
  async saveProfile(profile:UserProfile){await invokeDatabase<void>(cmd.profile.save,{profile:profileToRecord(profile)})}
}
export class SqliteSyncMetadataRepository implements SyncMetadataRepository {
  async getSyncMetadata(platformId:string){const row=await invokeDatabase<SyncRecord|null>(cmd.sync.get,{platformId});return row?{source:row.platformId as SyncMetadata["source"],lastSyncedAt:row.lastSyncAt??undefined,status:row.syncStatus}:undefined}
  async saveSyncMetadata(item:SyncMetadata){await invokeDatabase<void>(cmd.sync.save,{item:{platformId:item.source,lastSyncAt:item.lastSyncedAt??null,syncStatus:item.status,errorMessage:null}})}
}
