/** Backend-only Phase 3B persistence. Provider and Nexus user are derived. */
import type { Pool } from "pg";
import type { PlatformAchievement, ProviderScore, UserAchievementState } from "../../../../src/domain/nexus/achievements.ts";

export interface NexusAchievementRepository {
  upsertPlatformAchievement(value: PlatformAchievement): Promise<PlatformAchievement>;
  upsertUserAchievementState(value: UserAchievementState): Promise<UserAchievementState>;
  listStatesByLinkedAccount(linkedAccountId: string): Promise<UserAchievementState[]>;
}

export class PostgresNexusAchievementRepository implements NexusAchievementRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }
  async upsertPlatformAchievement(value: PlatformAchievement) {
    const score = value.providerScore ?? { kind: "none" as const };
    const result = await this.pool.query<any>(`INSERT INTO platform_achievements (id,platform_game_id,provider_achievement_id,title,description,hidden,icon_url,locked_icon_url,global_unlock_percent,provider_score_kind,provider_score_value,provider_score_grade,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (platform_game_id,provider_achievement_id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,hidden=EXCLUDED.hidden,icon_url=EXCLUDED.icon_url,locked_icon_url=EXCLUDED.locked_icon_url,global_unlock_percent=EXCLUDED.global_unlock_percent,provider_score_kind=EXCLUDED.provider_score_kind,provider_score_value=EXCLUDED.provider_score_value,provider_score_grade=EXCLUDED.provider_score_grade,synced_at=EXCLUDED.synced_at
      RETURNING id,platform_game_id AS "platformGameId",provider_achievement_id AS "providerAchievementId",title,description,hidden,icon_url AS "iconUrl",locked_icon_url AS "lockedIconUrl",global_unlock_percent AS "globalUnlockPercent",provider_score_kind AS kind,provider_score_value AS value,provider_score_grade AS grade,synced_at AS "syncedAt"`, [value.id,value.platformGameId,value.providerAchievementId,value.title,value.description,value.hidden,value.iconUrl ?? null,value.lockedIconUrl ?? null,value.globalUnlockPercent ?? null,score.kind,score.kind === "xbox_gamerscore" ? score.value : null,score.kind === "playstation_trophy" ? score.grade : null,value.syncedAt ?? null]);
    const row = result.rows[0]; const providerScore: ProviderScore =
      row.kind === "none"
        ? { kind: "none" }
        : row.kind === "xbox_gamerscore"
          ? { kind: "xbox_gamerscore", value: row.value }
          : { kind: "playstation_trophy", grade: row.grade };
    return {...row, ...(row.iconUrl ? {iconUrl:row.iconUrl}:{}), ...(row.lockedIconUrl ? {lockedIconUrl:row.lockedIconUrl}:{}), ...(row.globalUnlockPercent !== null ? {globalUnlockPercent:Number(row.globalUnlockPercent)}:{}), ...(row.syncedAt ? {syncedAt:new Date(row.syncedAt).toISOString()}:{}), providerScore};
  }
  async upsertUserAchievementState(value: UserAchievementState) {
    const result = await this.pool.query<any>(`INSERT INTO user_achievement_states (id,linked_account_id,platform_achievement_id,unlocked,unlock_state_known,unlocked_at,synced_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (linked_account_id,platform_achievement_id) DO UPDATE SET unlocked=EXCLUDED.unlocked,unlock_state_known=EXCLUDED.unlock_state_known,unlocked_at=COALESCE(EXCLUDED.unlocked_at,user_achievement_states.unlocked_at),synced_at=EXCLUDED.synced_at
      RETURNING id,linked_account_id AS "linkedAccountId",platform_achievement_id AS "platformAchievementId",unlocked,unlock_state_known AS "unlockStateKnown",unlocked_at AS "unlockedAt",synced_at AS "syncedAt"`, [value.id,value.linkedAccountId,value.platformAchievementId,value.unlocked,value.unlockStateKnown,value.unlockedAt ?? null,value.syncedAt ?? null]);
    const row=result.rows[0]; return {...row, ...(row.unlockedAt ? {unlockedAt:new Date(row.unlockedAt).toISOString()}:{}), ...(row.syncedAt ? {syncedAt:new Date(row.syncedAt).toISOString()}: {})};
  }
  async listStatesByLinkedAccount(linkedAccountId: string) {
    const result=await this.pool.query<any>(`SELECT id,linked_account_id AS "linkedAccountId",platform_achievement_id AS "platformAchievementId",unlocked,unlock_state_known AS "unlockStateKnown",unlocked_at AS "unlockedAt",synced_at AS "syncedAt" FROM user_achievement_states WHERE linked_account_id=$1 ORDER BY id`,[linkedAccountId]);
    return result.rows.map((row:any)=>({...row,...(row.unlockedAt?{unlockedAt:new Date(row.unlockedAt).toISOString()}:{}),...(row.syncedAt?{syncedAt:new Date(row.syncedAt).toISOString()}: {})}));
  }
}
