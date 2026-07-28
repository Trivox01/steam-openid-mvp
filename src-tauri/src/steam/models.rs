use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamProfile {
    pub steam_id: String,
    pub persona_name: String,
    pub profile_url: String,
    pub avatar_url: String,
    pub avatar_medium_url: String,
    pub avatar_full_url: String,
    pub persona_state: Option<i32>,
    pub last_logoff: Option<i64>,
    pub visibility_state: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamConnectionResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<SteamProfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_message: Option<String>,
}

impl SteamConnectionResult {
    pub fn connected(profile: SteamProfile) -> Self {
        Self { success: true, profile: Some(profile), error_code: None, user_message: None }
    }

    pub fn failed(error_code: impl Into<String>, user_message: impl Into<String>) -> Self {
        Self {
            success: false,
            profile: None,
            error_code: Some(error_code.into()),
            user_message: Some(user_message.into()),
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct SteamApiResponse {
    pub response: SteamApiResponseBody,
}

#[derive(Deserialize)]
pub(crate) struct SteamApiResponseBody {
    pub players: Vec<SteamApiPlayer>,
}

#[derive(Deserialize)]
pub(crate) struct SteamApiPlayer {
    pub steamid: String,
    pub personaname: String,
    #[serde(default)]
    pub profileurl: String,
    #[serde(default)]
    pub avatar: String,
    #[serde(default)]
    pub avatarmedium: String,
    #[serde(default)]
    pub avatarfull: String,
    pub personastate: Option<i32>,
    pub lastlogoff: Option<i64>,
    #[serde(default)]
    pub communityvisibilitystate: i32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamOwnedGame {
    pub app_id: u32,
    pub name: String,
    pub playtime_forever_minutes: u64,
    pub playtime_two_weeks_minutes: Option<u64>,
    pub playtime_windows_minutes: Option<u64>,
    pub playtime_mac_minutes: Option<u64>,
    pub playtime_linux_minutes: Option<u64>,
    pub last_played_unix: Option<i64>,
    pub icon_hash: Option<String>,
    pub logo_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamOwnedGamesResult {
    pub games: Vec<SteamOwnedGame>,
    pub fetched: usize,
    pub skipped: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamAchievement {
    pub api_name: String,
    pub display_name: String,
    pub description: String,
    pub hidden: bool,
    pub icon_url: String,
    pub locked_icon_url: String,
    pub unlocked: bool,
    pub unlocked_at: Option<String>,
    pub global_unlock_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamGameAchievements {
    pub app_id: u32,
    pub game_name: String,
    pub achievements: Vec<SteamAchievement>,
    pub warnings: Vec<String>,
    pub fetched_at: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamSchemaResponse {
    pub game: Option<SteamSchemaGame>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamSchemaGame {
    #[serde(default, rename = "gameName")]
    pub game_name: String,
    #[serde(rename = "availableGameStats")]
    pub available_game_stats: Option<SteamAvailableGameStats>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamAvailableGameStats {
    pub achievements: Option<Vec<SteamSchemaAchievement>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamSchemaAchievement {
    pub name: Option<String>,
    #[serde(default, rename = "displayName")]
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub hidden: i32,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub icongray: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamPlayerAchievementsResponse {
    pub playerstats: Option<SteamPlayerStats>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamPlayerStats {
    #[serde(default)]
    pub success: bool,
    pub achievements: Option<Vec<SteamPlayerAchievement>>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamPlayerAchievement {
    pub apiname: Option<String>,
    #[serde(default)]
    pub achieved: i32,
    #[serde(default)]
    pub unlocktime: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamGlobalAchievementsResponse {
    pub achievementpercentages: Option<SteamGlobalAchievementList>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamGlobalAchievementList {
    pub achievements: Option<Vec<SteamGlobalAchievement>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamGlobalAchievement {
    pub name: Option<String>,
    pub percent: Option<f64>,
}

#[derive(Deserialize)]
pub(crate) struct SteamOwnedGamesApiResponse {
    pub response: SteamOwnedGamesApiBody,
}

#[derive(Deserialize)]
pub(crate) struct SteamOwnedGamesApiBody {
    pub game_count: Option<u64>,
    pub games: Option<Vec<SteamOwnedGameApiItem>>,
}

#[derive(Deserialize)]
pub(crate) struct SteamOwnedGameApiItem {
    pub appid: Option<u32>,
    pub name: Option<String>,
    #[serde(default)]
    pub playtime_forever: Option<u64>,
    #[serde(default)]
    pub playtime_2weeks: Option<u64>,
    #[serde(default)]
    pub playtime_windows_forever: Option<u64>,
    #[serde(default)]
    pub playtime_mac_forever: Option<u64>,
    #[serde(default)]
    pub playtime_linux_forever: Option<u64>,
    #[serde(default)]
    pub rtime_last_played: Option<i64>,
    #[serde(default)]
    pub img_icon_url: Option<String>,
    #[serde(default)]
    pub img_logo_url: Option<String>,
}

impl From<SteamApiPlayer> for SteamProfile {
    fn from(player: SteamApiPlayer) -> Self {
        Self {
            steam_id: player.steamid,
            persona_name: player.personaname,
            profile_url: player.profileurl,
            avatar_url: player.avatar,
            avatar_medium_url: player.avatarmedium,
            avatar_full_url: player.avatarfull,
            persona_state: player.personastate,
            last_logoff: player.lastlogoff,
            visibility_state: player.communityvisibilitystate,
        }
    }
}
