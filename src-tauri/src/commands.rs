use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use tauri::State;
use crate::{database::DatabaseState, models::*};

fn db_error(context: &str, error: rusqlite::Error) -> String { format!("{context}: {error}") }

#[tauri::command]
pub fn get_all_games(state: State<DatabaseState>) -> Result<Vec<GameRecord>, String> {
    let db = state.0.lock().map_err(|_| "Local database is unavailable".to_string())?;
    let mut statement = db.prepare("SELECT id,platform_id,platform_game_id,name,cover_url,background_url,playtime_minutes,achievements_unlocked,achievements_total,completion_percentage,last_played_at,playtime_two_weeks_minutes,playtime_windows_minutes,playtime_mac_minutes,playtime_linux_minutes,icon_url,synced_at,favorite,hidden,game_status FROM games ORDER BY last_played_at DESC").map_err(|e| db_error("Unable to query games", e))?;
    let rows = statement.query_map([], map_game).map_err(|e| db_error("Unable to read games", e))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| db_error("Unable to decode games", e))
}
#[tauri::command]
pub fn get_game_by_id(id: String, state: State<DatabaseState>) -> Result<Option<GameRecord>, String> {
    let db = state.0.lock().map_err(|_| "Local database is unavailable".to_string())?;
    db.query_row("SELECT id,platform_id,platform_game_id,name,cover_url,background_url,playtime_minutes,achievements_unlocked,achievements_total,completion_percentage,last_played_at,playtime_two_weeks_minutes,playtime_windows_minutes,playtime_mac_minutes,playtime_linux_minutes,icon_url,synced_at,favorite,hidden,game_status FROM games WHERE id=?1", [id], map_game).optional().map_err(|e| db_error("Unable to read game", e))
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
    db.query_row("SELECT id,game_id,platform_achievement_id,name,description,icon_url,is_unlocked,is_hidden,rarity_percentage,unlocked_at FROM achievements WHERE id=?1", [id], map_achievement).optional().map_err(|e| db_error("Unable to read achievement", e))
}
#[tauri::command]
pub fn upsert_achievements(items: Vec<AchievementRecord>, state: State<DatabaseState>) -> Result<(), String> {
    let mut db = state.0.lock().map_err(|_| "Local database is unavailable".to_string())?;
    let tx = db.transaction().map_err(|e| db_error("Unable to start achievement transaction", e))?;
    for item in items { tx.execute("INSERT INTO achievements(id,game_id,platform_achievement_id,name,description,icon_url,is_unlocked,is_hidden,rarity_percentage,unlocked_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) DO UPDATE SET game_id=excluded.game_id,platform_achievement_id=excluded.platform_achievement_id,name=excluded.name,description=excluded.description,icon_url=excluded.icon_url,is_unlocked=excluded.is_unlocked,is_hidden=excluded.is_hidden,rarity_percentage=excluded.rarity_percentage,unlocked_at=excluded.unlocked_at,updated_at=CURRENT_TIMESTAMP",
        params![item.id,item.game_id,item.platform_achievement_id,item.name,item.description,item.icon_url,item.is_unlocked,item.is_hidden,item.rarity_percentage,item.unlocked_at]).map_err(|e| db_error("Unable to save achievements", e))?; }
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
pub fn get_profile(state: State<DatabaseState>) -> Result<Option<ProfileRecord>, String> { let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?; db.query_row("SELECT id,display_name,avatar_url,active_platform FROM profile LIMIT 1",[],|r|Ok(ProfileRecord{id:r.get(0)?,display_name:r.get(1)?,avatar_url:r.get(2)?,active_platform:r.get(3)?})).optional().map_err(|e|db_error("Unable to read profile",e)) }
#[tauri::command]
pub fn save_profile(profile: ProfileRecord,state:State<DatabaseState>)->Result<(),String>{let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;db.execute("INSERT INTO profile(id,display_name,avatar_url,active_platform) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,avatar_url=excluded.avatar_url,active_platform=excluded.active_platform,updated_at=CURRENT_TIMESTAMP",params![profile.id,profile.display_name,profile.avatar_url,profile.active_platform]).map(|_|()).map_err(|e|db_error("Unable to save profile",e))}
#[tauri::command]
pub fn get_sync_metadata(platform_id:String,state:State<DatabaseState>)->Result<Option<SyncMetadataRecord>,String>{let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;db.query_row("SELECT platform_id,last_sync_at,sync_status,error_message FROM sync_metadata WHERE platform_id=?1",[platform_id],|r|Ok(SyncMetadataRecord{platform_id:r.get(0)?,last_sync_at:r.get(1)?,sync_status:r.get(2)?,error_message:r.get(3)?})).optional().map_err(|e|db_error("Unable to read sync metadata",e))}
#[tauri::command]
pub fn save_sync_metadata(item:SyncMetadataRecord,state:State<DatabaseState>)->Result<(),String>{let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;db.execute("INSERT INTO sync_metadata(platform_id,last_sync_at,sync_status,error_message) VALUES(?1,?2,?3,?4) ON CONFLICT(platform_id) DO UPDATE SET last_sync_at=excluded.last_sync_at,sync_status=excluded.sync_status,error_message=excluded.error_message,updated_at=CURRENT_TIMESTAMP",params![item.platform_id,item.last_sync_at,item.sync_status,item.error_message]).map(|_|()).map_err(|e|db_error("Unable to save sync metadata",e))}

fn map_game(row:&rusqlite::Row)->rusqlite::Result<GameRecord>{Ok(GameRecord{id:row.get(0)?,platform_id:row.get(1)?,platform_game_id:row.get(2)?,name:row.get(3)?,cover_url:row.get(4)?,background_url:row.get(5)?,playtime_minutes:row.get(6)?,achievements_unlocked:row.get(7)?,achievements_total:row.get(8)?,completion_percentage:row.get(9)?,last_played_at:row.get(10)?,playtime_two_weeks_minutes:row.get(11)?,playtime_windows_minutes:row.get(12)?,playtime_mac_minutes:row.get(13)?,playtime_linux_minutes:row.get(14)?,icon_url:row.get(15)?,synced_at:row.get(16)?,favorite:row.get(17)?,hidden:row.get(18)?,game_status:row.get(19)?})}
fn map_achievement(row:&rusqlite::Row)->rusqlite::Result<AchievementRecord>{Ok(AchievementRecord{id:row.get(0)?,game_id:row.get(1)?,platform_achievement_id:row.get(2)?,name:row.get(3)?,description:row.get(4)?,icon_url:row.get(5)?,is_unlocked:row.get(6)?,is_hidden:row.get(7)?,rarity_percentage:row.get(8)?,unlocked_at:row.get(9)?})}
fn upsert_game(db:&rusqlite::Connection,g:&GameRecord)->rusqlite::Result<usize>{db.execute("INSERT INTO games(id,platform_id,platform_game_id,name,cover_url,background_url,playtime_minutes,achievements_unlocked,achievements_total,completion_percentage,last_played_at,playtime_two_weeks_minutes,playtime_windows_minutes,playtime_mac_minutes,playtime_linux_minutes,icon_url,synced_at,favorite,hidden,game_status) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20) ON CONFLICT(id) DO UPDATE SET platform_id=excluded.platform_id,platform_game_id=excluded.platform_game_id,name=excluded.name,cover_url=excluded.cover_url,background_url=excluded.background_url,playtime_minutes=excluded.playtime_minutes,achievements_unlocked=excluded.achievements_unlocked,achievements_total=excluded.achievements_total,completion_percentage=excluded.completion_percentage,last_played_at=excluded.last_played_at,playtime_two_weeks_minutes=excluded.playtime_two_weeks_minutes,playtime_windows_minutes=excluded.playtime_windows_minutes,playtime_mac_minutes=excluded.playtime_mac_minutes,playtime_linux_minutes=excluded.playtime_linux_minutes,icon_url=excluded.icon_url,synced_at=excluded.synced_at,favorite=excluded.favorite,hidden=excluded.hidden,game_status=excluded.game_status,updated_at=CURRENT_TIMESTAMP",params![g.id,g.platform_id,g.platform_game_id,g.name,g.cover_url,g.background_url,g.playtime_minutes,g.achievements_unlocked,g.achievements_total,g.completion_percentage,g.last_played_at,g.playtime_two_weeks_minutes,g.playtime_windows_minutes,g.playtime_mac_minutes,g.playtime_linux_minutes,g.icon_url,g.synced_at,g.favorite,g.hidden,g.game_status])}
fn query_achievements(state:&State<DatabaseState>,game_id:Option<String>)->Result<Vec<AchievementRecord>,String>{let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;let sql=if game_id.is_some(){"SELECT id,game_id,platform_achievement_id,name,description,icon_url,is_unlocked,is_hidden,rarity_percentage,unlocked_at FROM achievements WHERE game_id=?1 ORDER BY rarity_percentage"}else{"SELECT id,game_id,platform_achievement_id,name,description,icon_url,is_unlocked,is_hidden,rarity_percentage,unlocked_at FROM achievements ORDER BY unlocked_at DESC"};let mut s=db.prepare(sql).map_err(|e|db_error("Unable to query achievements",e))?;let rows=if let Some(id)=game_id{s.query_map([id],map_achievement)}else{s.query_map([],map_achievement)}.map_err(|e|db_error("Unable to read achievements",e))?;rows.collect::<Result<Vec<_>,_>>().map_err(|e|db_error("Unable to decode achievements",e))}
fn execute_clear(state:&State<DatabaseState>,sql:&str,label:&str)->Result<(),String>{let db=state.0.lock().map_err(|_|"Local database is unavailable".to_string())?;db.execute(sql,[]).map(|_|()).map_err(|e|db_error(&format!("Unable to clear {label}"),e))}
