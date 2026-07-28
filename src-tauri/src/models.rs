use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRecord {
    pub id: String, pub platform_id: String, pub platform_game_id: String, pub name: String,
    pub cover_url: String, pub background_url: String, pub playtime_minutes: i64,
    pub achievements_unlocked: i64, pub achievements_total: i64, pub completion_percentage: f64,
    pub last_played_at: Option<String>,
    pub playtime_two_weeks_minutes: Option<i64>, pub playtime_windows_minutes: Option<i64>,
    pub playtime_mac_minutes: Option<i64>, pub playtime_linux_minutes: Option<i64>,
    pub icon_url: String, pub synced_at: Option<String>, pub favorite: bool, pub hidden: bool,
    pub game_status: String,
    pub achievements_synced_at: Option<String>, pub achievements_sync_status: String,
    pub achievements_sync_error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementRecord {
    pub id: String, pub game_id: String, pub platform_achievement_id: String, pub name: String,
    pub description: String, pub icon_url: String, pub is_unlocked: bool, pub is_hidden: bool,
    pub rarity_percentage: f64, pub unlocked_at: Option<String>,
    pub locked_icon_url: String, pub source: String,
    pub global_unlock_percent: Option<f64>, pub synced_at: Option<String>,
    pub unlock_state_known: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityRecord {
    pub id: String, pub activity_type: String, pub game_id: Option<String>, pub achievement_id: Option<String>,
    pub title: String, pub description: String, pub progress: Option<f64>, pub occurred_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRecord { pub id: String, pub display_name: String, pub avatar_url: String, pub active_platform: String }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncMetadataRecord {
    pub platform_id: String, pub last_sync_at: Option<String>, pub sync_status: String, pub error_message: Option<String>,
}
