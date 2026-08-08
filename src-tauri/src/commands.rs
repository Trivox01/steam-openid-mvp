use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use tauri::State;
use crate::{database::DatabaseState, models::*};

fn db_error(context: &str, error: rusqlite::Error) -> String { format!("{context}: {error}") }
const GAME_COLUMNS: &str = "id,platform_id,platform_game_id,name,cover_url,background_url,playtime_minutes,achievements_unlocked,achievements_total,completion_percentage,last_played_at,playtime_two_weeks_minutes,playtime_windows_minutes,playtime_mac_minutes,playtime_linux_minutes,icon_url,synced_at,favorite,hidden,game_status,achievements_synced_at,achievements_sync_status,achievements_sync_error,tracked,last_opened_at";

#[tauri::command]
pub fn list_game_sessions(
    state: State<crate::SessionMonitorState>,
) -> Result<Vec<crate::game_session::ActiveGameSession>, String> {
    let session_guard = state
        .0
        .lock()
        .map_err(|_| "Session monitor is unavailable".to_string())?;
    let Some(monitor) = session_guard.as_ref() else {
        return Ok(Vec::new());
    };
    let core_arc = monitor.core();
    let core_guard = core_arc
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    Ok(core_guard.snapshot())
}

#[tauri::command]
pub fn game_session_statistics(
    state: State<DatabaseState>,
    limit: Option<usize>,
) -> Result<crate::game_session::SessionStatistics, String> {
    let db = state
        .0
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?;
    let now = crate::game_session::now_ms();
    let today = crate::game_session::day_start_ms(now);
    crate::game_session::query_session_statistics(&db, today, now, limit.unwrap_or(20))
        .map_err(|error| format!("Unable to read session statistics: {error}"))
}

#[tauri::command]
pub fn game_session_diagnostics(
    state: State<crate::SessionMonitorState>,
) -> Result<crate::game_session::GameSessionDiagnostics, String> {
    let session_guard = state
        .0
        .lock()
        .map_err(|_| "Session monitor is unavailable".to_string())?;
    let Some(monitor) = session_guard.as_ref() else {
        return Ok(crate::game_session::GameSessionDiagnostics {
            scans: 0,
            last_scan_cost_ns: 0,
            average_scan_cost_ns: 0,
            scan_index_refreshes: 0,
            recovery: Vec::new(),
        });
    };
    let core_arc = monitor.core();
    let core_guard = core_arc
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    Ok(core_guard.diagnostics())
}

#[tauri::command]
pub fn get_all_games(state: State<DatabaseState>) -> Result<Vec<GameRecord>, String> {
    let db = state.0.lock().map_err(|_| "Local database is unavailable".to_string())?;
    let mut statement = db.prepare(&format!("SELECT {GAME_COLUMNS} FROM games ORDER BY last_played_at DESC")).map_err(|e| db_error("Unable to query games", e))?;
    let rows = statement.query_map([], map_game).map_err(|e| db_error("Unable to read games", e))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| db_error("Unable to decode games", e))
}
#[tauri::command]
pub fn query_games(query: GameLibraryQueryRecord, state: State<DatabaseState>) -> Result<GameLibraryPageRecord, String> {
    let limit = query.limit.clamp(1, 100);
    let offset = query.offset.max(0);
    if query.search.chars().count() > 120 { return Err("Library search is too long".into()); }
    let filters = ["all","tracked","recent","hasAchievements","noAchievementData","completed","incomplete","hidden"];
    let sorts = ["smart","recent","playtime","completion","nameAsc","nameDesc","synced","tracked"];
    if !filters.contains(&query.filter.as_str()) || !sorts.contains(&query.sort.as_str()) { return Err("Invalid library query".into()); }
    let db = state.0.lock().map_err(|_| "Local database is unavailable".to_string())?;
    let pattern = format!("%{}%", query.search.trim().to_lowercase().replace('%', "\\%").replace('_', "\\_"));
    let where_sql = "(?1='' OR LOWER(name) LIKE ?2 ESCAPE '\\' OR platform_game_id LIKE ?2 ESCAPE '\\') AND CASE ?3 WHEN 'tracked' THEN tracked=1 WHEN 'recent' THEN last_played_at IS NOT NULL WHEN 'hasAchievements' THEN achievements_total>0 WHEN 'noAchievementData' THEN achievements_total=0 WHEN 'completed' THEN achievements_total>0 AND completion_percentage>=100 WHEN 'incomplete' THEN achievements_total>0 AND completion_percentage<100 WHEN 'hidden' THEN hidden=1 ELSE hidden=0 END";
    let order_sql = match query.sort.as_str() {
        "recent" => "last_played_at DESC", "playtime" => "playtime_minutes DESC", "completion" => "completion_percentage DESC",
        "nameAsc" => "name COLLATE NOCASE ASC", "nameDesc" => "name COLLATE NOCASE DESC", "synced" => "synced_at DESC",
        "tracked" => "tracked DESC, last_opened_at DESC",
        _ => "tracked DESC, CASE WHEN last_opened_at IS NULL THEN 0 ELSE 1 END DESC, last_opened_at DESC, CASE WHEN completion_percentage BETWEEN 70 AND 99.999 THEN 1 ELSE 0 END DESC, last_played_at DESC, playtime_minutes DESC",
    };
    let total: i64 = db.query_row(&format!("SELECT COUNT(*) FROM games WHERE {where_sql}"), params![query.search.trim(), pattern, query.filter], |row| row.get(0)).map_err(|e| db_error("Unable to count games", e))?;
    let sql = format!("SELECT {GAME_COLUMNS} FROM games WHERE {where_sql} ORDER BY {order_sql}, name COLLATE NOCASE, platform_game_id LIMIT ?4 OFFSET ?5");
    let mut statement = db.prepare(&sql).map_err(|e| db_error("Unable to query library", e))?;
    let rows = statement.query_map(params![query.search.trim(), pattern, query.filter, limit, offset], map_game).map_err(|e| db_error("Unable to read library", e))?;
    let games = rows.collect::<Result<Vec<_>,_>>().map_err(|e| db_error("Unable to decode library", e))?;
    Ok(GameLibraryPageRecord { games, total, offset, limit })
}

#[tauri::command]
pub fn set_game_tracked(id: String, tracked: bool, state: State<DatabaseState>) -> Result<(), String> {
    let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;
    db.execute("UPDATE games SET tracked=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2",params![tracked,id]).map(|_|()).map_err(|e|db_error("Unable to update tracked game",e))
}
#[tauri::command]
pub fn record_game_opened(id: String, opened_at: String, state: State<DatabaseState>) -> Result<(), String> {
    let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;
    db.execute("UPDATE games SET last_opened_at=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2",params![opened_at,id]).map(|_|()).map_err(|e|db_error("Unable to record opened game",e))
}
#[tauri::command]
pub fn get_game_by_id(id: String, state: State<DatabaseState>) -> Result<Option<GameRecord>, String> {
    let db = state.0.lock().map_err(|_| "Local database is unavailable".to_string())?;
    db.query_row(&format!("SELECT {GAME_COLUMNS} FROM games WHERE id=?1"), [id], map_game).optional().map_err(|e| db_error("Unable to read game", e))
}
#[tauri::command]
pub fn upsert_games(games: Vec<GameRecord>, state: State<DatabaseState>) -> Result<(), String> {
    let mut db = state.0.lock().map_err(|_| "Local database is unavailable".to_string())?;
    let tx = db.transaction().map_err(|e| db_error("Unable to start game transaction", e))?;
    for game in games { upsert_game(&tx, &game).map_err(|e| db_error("Unable to save games", e))?; }
    tx.commit().map_err(|e| db_error("Unable to commit games", e))
}
#[tauri::command]
pub fn update_game(game: GameRecord, state: State<DatabaseState>) -> Result<(), String> {
    let db = state.0.lock().map_err(|_| "Local database is unavailable".to_string())?;
    upsert_game(&db, &game).map(|_| ()).map_err(|e| db_error("Unable to update game", e))
}
#[tauri::command]
pub fn clear_games(state: State<DatabaseState>) -> Result<(), String> { execute_clear(&state, "DELETE FROM games", "games") }

#[tauri::command]
pub fn get_achievements(state: State<DatabaseState>) -> Result<Vec<AchievementRecord>, String> { query_achievements(&state, None) }
#[tauri::command]
pub fn get_achievements_by_game(game_id: String, state: State<DatabaseState>) -> Result<Vec<AchievementRecord>, String> { query_achievements(&state, Some(game_id)) }
#[tauri::command]
pub fn get_achievement_by_id(id: String, state: State<DatabaseState>) -> Result<Option<AchievementRecord>, String> {
    let db = state.0.lock().map_err(|_| "Local database is unavailable".to_string())?;
    db.query_row("SELECT id,game_id,platform_achievement_id,name,description,icon_url,is_unlocked,is_hidden,rarity_percentage,unlocked_at,locked_icon_url,source,global_unlock_percent,synced_at,unlock_state_known FROM achievements WHERE id=?1", [id], map_achievement).optional().map_err(|e| db_error("Unable to read achievement", e))
}
#[tauri::command]
pub fn upsert_achievements(items: Vec<AchievementRecord>, state: State<DatabaseState>) -> Result<(), String> {
    let mut db = state.0.lock().map_err(|_| "Local database is unavailable".to_string())?;
    let tx = db.transaction().map_err(|e| db_error("Unable to start achievement transaction", e))?;
    for item in items { tx.execute("INSERT INTO achievements(id,game_id,platform_achievement_id,name,description,icon_url,is_unlocked,is_hidden,rarity_percentage,unlocked_at,locked_icon_url,source,global_unlock_percent,synced_at,unlock_state_known) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15) ON CONFLICT(id) DO UPDATE SET game_id=excluded.game_id,platform_achievement_id=excluded.platform_achievement_id,name=excluded.name,description=excluded.description,icon_url=excluded.icon_url,is_unlocked=excluded.is_unlocked,is_hidden=excluded.is_hidden,rarity_percentage=excluded.rarity_percentage,unlocked_at=excluded.unlocked_at,locked_icon_url=excluded.locked_icon_url,source=excluded.source,global_unlock_percent=excluded.global_unlock_percent,synced_at=excluded.synced_at,unlock_state_known=excluded.unlock_state_known,updated_at=CURRENT_TIMESTAMP",
        params![item.id,item.game_id,item.platform_achievement_id,item.name,item.description,item.icon_url,item.is_unlocked,item.is_hidden,item.rarity_percentage,item.unlocked_at,item.locked_icon_url,item.source,item.global_unlock_percent,item.synced_at,item.unlock_state_known]).map_err(|e| db_error("Unable to save achievements", e))?; }
    tx.commit().map_err(|e| db_error("Unable to commit achievements", e))
}
#[tauri::command]
pub fn clear_achievements(state: State<DatabaseState>) -> Result<(), String> { execute_clear(&state, "DELETE FROM achievements", "achievements") }

#[tauri::command]
pub fn get_activities(state: State<DatabaseState>) -> Result<Vec<ActivityRecord>, String> {
    let db = state.0.lock().map_err(|_| "Local database is unavailable".to_string())?;
    let mut s=db.prepare("SELECT id,type,game_id,achievement_id,title,description,progress,occurred_at FROM activities ORDER BY occurred_at DESC").map_err(|e|db_error("Unable to query activities",e))?;
    let rows=s.query_map([], |r| Ok(ActivityRecord{id:r.get(0)?,activity_type:r.get(1)?,game_id:r.get(2)?,achievement_id:r.get(3)?,title:r.get(4)?,description:r.get(5)?,progress:r.get(6)?,occurred_at:r.get(7)?})).map_err(|e|db_error("Unable to read activities",e))?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e|db_error("Unable to decode activities",e))
}
#[tauri::command]
pub fn save_activities(items: Vec<ActivityRecord>, state: State<DatabaseState>) -> Result<(), String> {
    let mut db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?; let tx=db.transaction().map_err(|e|db_error("Unable to start activity transaction",e))?;
    for item in items { tx.execute("INSERT INTO activities(id,type,game_id,achievement_id,title,description,progress,occurred_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO UPDATE SET type=excluded.type,game_id=excluded.game_id,achievement_id=excluded.achievement_id,title=excluded.title,description=excluded.description,progress=excluded.progress,occurred_at=excluded.occurred_at",params![item.id,item.activity_type,item.game_id,item.achievement_id,item.title,item.description,item.progress,item.occurred_at]).map_err(|e|db_error("Unable to save activities",e))?; }
    tx.commit().map_err(|e|db_error("Unable to commit activities",e))
}
#[tauri::command]
pub fn clear_activities(state: State<DatabaseState>) -> Result<(), String> { execute_clear(&state, "DELETE FROM activities", "activities") }

#[tauri::command]
pub fn get_preferences(state: State<DatabaseState>) -> Result<Option<Value>, String> {
    let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;
    let value:Option<String>=db.query_row("SELECT value_json FROM preferences WHERE key='user_preferences'",[],|r|r.get(0)).optional().map_err(|e|db_error("Unable to read preferences",e))?;
    value.map(|v|serde_json::from_str(&v).map_err(|e|format!("Stored preferences are invalid: {e}"))).transpose()
}
#[tauri::command]
pub fn save_preferences(preferences: Value, state: State<DatabaseState>) -> Result<(), String> {
    let encoded=serde_json::to_string(&preferences).map_err(|e|format!("Unable to encode preferences: {e}"))?; let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;
    db.execute("INSERT INTO preferences(key,value_json) VALUES('user_preferences',?1) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP",[encoded]).map(|_|()).map_err(|e|db_error("Unable to save preferences",e))
}
#[tauri::command]
pub fn reset_preferences(state: State<DatabaseState>) -> Result<(), String> { execute_clear(&state, "DELETE FROM preferences WHERE key='user_preferences'", "preferences") }

#[tauri::command]
pub fn get_steam_openid_desktop_state(state: State<DatabaseState>) -> Result<Option<SteamOpenIdDesktopStateRecord>, String> {
    let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;
    let value:Option<String>=db.query_row("SELECT value_json FROM preferences WHERE key='steam_openid_desktop'",[],|r|r.get(0)).optional().map_err(|e|db_error("Unable to read Steam sign-in state",e))?;
    value.map(|v|serde_json::from_str(&v).map_err(|_|"Stored Steam sign-in state is invalid".to_string())).transpose()
}

#[tauri::command]
pub fn save_steam_openid_desktop_state(value: SteamOpenIdDesktopStateRecord, state: State<DatabaseState>) -> Result<(), String> {
    let encoded=serde_json::to_string(&value).map_err(|_|"Unable to encode Steam sign-in state".to_string())?;
    let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;
    db.execute("INSERT INTO preferences(key,value_json) VALUES('steam_openid_desktop',?1) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP",[encoded]).map(|_|()).map_err(|e|db_error("Unable to save Steam sign-in state",e))
}

#[tauri::command]
pub fn clear_steam_openid_authenticated_identity(state: State<DatabaseState>) -> Result<(), String> {
    let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;
    let encoded:Option<String>=db.query_row("SELECT value_json FROM preferences WHERE key='steam_openid_desktop'",[],|r|r.get(0)).optional().map_err(|e|db_error("Unable to read Steam sign-in state",e))?;
    let sanitized=encoded.ok_or_else(||"Stored Steam sign-in state is unavailable".to_string()).and_then(|raw|steam_openid_state_without_identity(&raw))?;
    db.execute("UPDATE preferences SET value_json=?1,updated_at=CURRENT_TIMESTAMP WHERE key='steam_openid_desktop'",[sanitized]).map(|_|()).map_err(|e|db_error("Unable to clear Steam identity",e))
}

fn steam_openid_state_without_identity(raw:&str)->Result<String,String>{
    let mut value:SteamOpenIdDesktopStateRecord=serde_json::from_str(raw).map_err(|_|"Stored Steam sign-in state is invalid".to_string())?;
    value.identity=None;
    serde_json::to_string(&value).map_err(|_|"Unable to encode Steam sign-in state".to_string())
}

#[tauri::command]
pub fn get_profile(state: State<DatabaseState>) -> Result<Option<ProfileRecord>, String> { let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?; db.query_row("SELECT id,display_name,avatar_url,active_platform FROM profile LIMIT 1",[],|r|Ok(ProfileRecord{id:r.get(0)?,display_name:r.get(1)?,avatar_url:r.get(2)?,active_platform:r.get(3)?})).optional().map_err(|e|db_error("Unable to read profile",e)) }
#[tauri::command]
pub fn save_profile(profile: ProfileRecord,state:State<DatabaseState>)->Result<(),String>{let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;db.execute("INSERT INTO profile(id,display_name,avatar_url,active_platform) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,avatar_url=excluded.avatar_url,active_platform=excluded.active_platform,updated_at=CURRENT_TIMESTAMP",params![profile.id,profile.display_name,profile.avatar_url,profile.active_platform]).map(|_|()).map_err(|e|db_error("Unable to save profile",e))}
#[tauri::command]
pub fn get_sync_metadata(platform_id:String,state:State<DatabaseState>)->Result<Option<SyncMetadataRecord>,String>{let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;db.query_row("SELECT platform_id,last_sync_at,sync_status,error_message FROM sync_metadata WHERE platform_id=?1",[platform_id],|r|Ok(SyncMetadataRecord{platform_id:r.get(0)?,last_sync_at:r.get(1)?,sync_status:r.get(2)?,error_message:r.get(3)?})).optional().map_err(|e|db_error("Unable to read sync metadata",e))}
#[tauri::command]
pub fn save_sync_metadata(item:SyncMetadataRecord,state:State<DatabaseState>)->Result<(),String>{let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;db.execute("INSERT INTO sync_metadata(platform_id,last_sync_at,sync_status,error_message) VALUES(?1,?2,?3,?4) ON CONFLICT(platform_id) DO UPDATE SET last_sync_at=excluded.last_sync_at,sync_status=excluded.sync_status,error_message=excluded.error_message,updated_at=CURRENT_TIMESTAMP",params![item.platform_id,item.last_sync_at,item.sync_status,item.error_message]).map(|_|()).map_err(|e|db_error("Unable to save sync metadata",e))}

fn map_game(row:&rusqlite::Row)->rusqlite::Result<GameRecord>{Ok(GameRecord{id:row.get(0)?,platform_id:row.get(1)?,platform_game_id:row.get(2)?,name:row.get(3)?,cover_url:row.get(4)?,background_url:row.get(5)?,playtime_minutes:row.get(6)?,achievements_unlocked:row.get(7)?,achievements_total:row.get(8)?,completion_percentage:row.get(9)?,last_played_at:row.get(10)?,playtime_two_weeks_minutes:row.get(11)?,playtime_windows_minutes:row.get(12)?,playtime_mac_minutes:row.get(13)?,playtime_linux_minutes:row.get(14)?,icon_url:row.get(15)?,synced_at:row.get(16)?,favorite:row.get(17)?,hidden:row.get(18)?,game_status:row.get(19)?,achievements_synced_at:row.get(20)?,achievements_sync_status:row.get(21)?,achievements_sync_error:row.get(22)?,tracked:row.get(23)?,last_opened_at:row.get(24)?})}
fn map_achievement(row:&rusqlite::Row)->rusqlite::Result<AchievementRecord>{Ok(AchievementRecord{id:row.get(0)?,game_id:row.get(1)?,platform_achievement_id:row.get(2)?,name:row.get(3)?,description:row.get(4)?,icon_url:row.get(5)?,is_unlocked:row.get(6)?,is_hidden:row.get(7)?,rarity_percentage:row.get(8)?,unlocked_at:row.get(9)?,locked_icon_url:row.get(10)?,source:row.get(11)?,global_unlock_percent:row.get(12)?,synced_at:row.get(13)?,unlock_state_known:row.get(14)?})}
fn upsert_game(db:&rusqlite::Connection,g:&GameRecord)->rusqlite::Result<usize>{db.execute("INSERT INTO games(id,platform_id,platform_game_id,name,cover_url,background_url,playtime_minutes,achievements_unlocked,achievements_total,completion_percentage,last_played_at,playtime_two_weeks_minutes,playtime_windows_minutes,playtime_mac_minutes,playtime_linux_minutes,icon_url,synced_at,favorite,hidden,game_status,achievements_synced_at,achievements_sync_status,achievements_sync_error) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23) ON CONFLICT(id) DO UPDATE SET platform_id=excluded.platform_id,platform_game_id=excluded.platform_game_id,name=excluded.name,cover_url=excluded.cover_url,background_url=excluded.background_url,playtime_minutes=excluded.playtime_minutes,achievements_unlocked=excluded.achievements_unlocked,achievements_total=excluded.achievements_total,completion_percentage=excluded.completion_percentage,last_played_at=excluded.last_played_at,playtime_two_weeks_minutes=excluded.playtime_two_weeks_minutes,playtime_windows_minutes=excluded.playtime_windows_minutes,playtime_mac_minutes=excluded.playtime_mac_minutes,playtime_linux_minutes=excluded.playtime_linux_minutes,icon_url=excluded.icon_url,synced_at=excluded.synced_at,favorite=excluded.favorite,hidden=excluded.hidden,game_status=excluded.game_status,achievements_synced_at=excluded.achievements_synced_at,achievements_sync_status=excluded.achievements_sync_status,achievements_sync_error=excluded.achievements_sync_error,updated_at=CURRENT_TIMESTAMP",params![g.id,g.platform_id,g.platform_game_id,g.name,g.cover_url,g.background_url,g.playtime_minutes,g.achievements_unlocked,g.achievements_total,g.completion_percentage,g.last_played_at,g.playtime_two_weeks_minutes,g.playtime_windows_minutes,g.playtime_mac_minutes,g.playtime_linux_minutes,g.icon_url,g.synced_at,g.favorite,g.hidden,g.game_status,g.achievements_synced_at,g.achievements_sync_status,g.achievements_sync_error])}
fn query_achievements(state:&State<DatabaseState>,game_id:Option<String>)->Result<Vec<AchievementRecord>,String>{let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;let sql=if game_id.is_some(){"SELECT id,game_id,platform_achievement_id,name,description,icon_url,is_unlocked,is_hidden,rarity_percentage,unlocked_at,locked_icon_url,source,global_unlock_percent,synced_at,unlock_state_known FROM achievements WHERE game_id=?1 ORDER BY rarity_percentage"}else{"SELECT id,game_id,platform_achievement_id,name,description,icon_url,is_unlocked,is_hidden,rarity_percentage,unlocked_at,locked_icon_url,source,global_unlock_percent,synced_at,unlock_state_known FROM achievements ORDER BY unlocked_at DESC"};let mut s=db.prepare(sql).map_err(|e|db_error("Unable to query achievements",e))?;let rows=if let Some(id)=game_id{s.query_map([id],map_achievement)}else{s.query_map([],map_achievement)}.map_err(|e|db_error("Unable to read achievements",e))?;rows.collect::<Result<Vec<_>,_>>().map_err(|e|db_error("Unable to decode achievements",e))}
fn execute_clear(state:&State<DatabaseState>,sql:&str,label:&str)->Result<(),String>{let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;db.execute(sql,[]).map(|_|()).map_err(|e|db_error(&format!("Unable to clear {label}"),e))}

#[cfg(test)]
mod steam_openid_identity_tests {
    use super::steam_openid_state_without_identity;
    use serde_json::Value;

    #[test]
    fn removes_only_identity_and_preserves_device_id() {
        let device_id="f7930e64-64c0-4e25-8681-39362ac65478";
        let raw=format!(r#"{{"deviceId":"{device_id}","identity":{{"steamId":"76561198000000000","authenticatedAt":"2026-07-28T12:00:00.000Z","authMethod":"steam_openid"}}}}"#);
        let sanitized=steam_openid_state_without_identity(&raw).unwrap();
        let value:Value=serde_json::from_str(&sanitized).unwrap();
        assert_eq!(value["deviceId"],device_id);
        assert!(value["identity"].is_null());
    }

    #[test]
    fn closed_schema_rejects_transaction_secrets() {
        let raw=r#"{"deviceId":"f7930e64-64c0-4e25-8681-39362ac65478","identity":null,"pollSecret":"must-not-be-stored"}"#;
        assert!(steam_openid_state_without_identity(raw).is_err());
    }
}
