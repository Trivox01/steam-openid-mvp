use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::{
    database::DatabaseState,
    secret_store::SecretStore,
    steam::{SteamClient, SteamConnectionResult, SteamError, SteamOwnedGamesResult, SteamProfile},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamCommandError {
    pub code: String,
}

#[tauri::command]
pub async fn validate_steam_connection(
    steam_id: String,
    api_key: String,
    database: State<'_, DatabaseState>,
    secrets: State<'_, SecretStore>,
) -> Result<SteamConnectionResult, String> {
    let client = match SteamClient::new() {
        Ok(client) => client,
        Err(error) => return Ok(connection_error(error)),
    };

    let profile = match client
        .get_player_summary(&steam_id, &api_key)
        .await
    {
        Ok(profile) => profile,
        Err(error) => return Ok(connection_error(error)),
    };

    if save_profile(&database, &profile).is_err() {
        return Ok(SteamConnectionResult::failed(
            "profile_storage_failed",
            "The Steam profile was verified but could not be saved locally.",
        ));
    }

    if secrets.save_steam_api_key(api_key).is_err() {
        let _ = delete_profile(&database);
        return Ok(SteamConnectionResult::failed(
            "secret_storage_failed",
            "The Steam profile was verified, but the API key could not be held securely.",
        ));
    }

    Ok(SteamConnectionResult::connected(profile))
}

#[tauri::command]
pub fn get_saved_steam_profile(
    database: State<'_, DatabaseState>,
) -> Result<Option<SteamProfile>, String> {
    let db = database
        .0
        .lock()
        .map_err(|_| "Local profile storage is unavailable.".to_string())?;
    db.query_row(
        "SELECT steam_id,persona_name,profile_url,avatar_url,avatar_medium_url,avatar_full_url,persona_state,last_logoff,visibility_state FROM steam_profile LIMIT 1",
        [],
        |row| {
            Ok(SteamProfile {
                steam_id: row.get(0)?,
                persona_name: row.get(1)?,
                profile_url: row.get(2)?,
                avatar_url: row.get(3)?,
                avatar_medium_url: row.get(4)?,
                avatar_full_url: row.get(5)?,
                persona_state: row.get(6)?,
                last_logoff: row.get(7)?,
                visibility_state: row.get(8)?,
            })
        },
    )
    .optional()
    .map_err(|_| "Unable to read the saved Steam profile.".to_string())
}

#[tauri::command]
pub fn disconnect_steam_account(
    database: State<'_, DatabaseState>,
    secrets: State<'_, SecretStore>,
) -> Result<(), String> {
    secrets.clear_steam_api_key()?;
    delete_profile(&database)
}

#[tauri::command]
pub async fn steam_get_owned_games(
    database: State<'_, DatabaseState>,
    secrets: State<'_, SecretStore>,
) -> Result<SteamOwnedGamesResult, SteamCommandError> {
    let steam_id = read_steam_id(&database)
        .map_err(|code| SteamCommandError { code })?
        .ok_or_else(|| SteamCommandError { code: "steam_not_connected".to_string() })?;
    let api_key = secrets
        .steam_api_key()
        .map_err(|_| SteamCommandError { code: "api_key_unavailable".to_string() })?
        .ok_or_else(|| SteamCommandError { code: "api_key_unavailable".to_string() })?;
    let client = SteamClient::new()
        .map_err(|error| SteamCommandError { code: error.code().to_string() })?;
    client
        .get_owned_games(&steam_id, &api_key)
        .await
        .map_err(|error| SteamCommandError { code: error.code().to_string() })
}

fn connection_error(error: SteamError) -> SteamConnectionResult {
    SteamConnectionResult::failed(error.code(), error.user_message())
}

fn save_profile(database: &DatabaseState, profile: &SteamProfile) -> Result<(), String> {
    let db = database
        .0
        .lock()
        .map_err(|_| "Local profile storage is unavailable.".to_string())?;
    db.execute(
        "INSERT INTO steam_profile(steam_id,persona_name,profile_url,avatar_url,avatar_medium_url,avatar_full_url,persona_state,last_logoff,visibility_state)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(steam_id) DO UPDATE SET persona_name=excluded.persona_name,profile_url=excluded.profile_url,avatar_url=excluded.avatar_url,avatar_medium_url=excluded.avatar_medium_url,avatar_full_url=excluded.avatar_full_url,persona_state=excluded.persona_state,last_logoff=excluded.last_logoff,visibility_state=excluded.visibility_state,updated_at=CURRENT_TIMESTAMP",
        params![
            &profile.steam_id,
            &profile.persona_name,
            &profile.profile_url,
            &profile.avatar_url,
            &profile.avatar_medium_url,
            &profile.avatar_full_url,
            profile.persona_state,
            profile.last_logoff,
            profile.visibility_state,
        ],
    )
    .map(|_| ())
    .map_err(|_| "Unable to save the Steam profile.".to_string())
}

fn delete_profile(database: &DatabaseState) -> Result<(), String> {
    let db = database
        .0
        .lock()
        .map_err(|_| "Local profile storage is unavailable.".to_string())?;
    db.execute("DELETE FROM steam_profile", [])
        .map(|_| ())
        .map_err(|_| "Unable to disconnect the Steam account.".to_string())
}

fn read_steam_id(database: &DatabaseState) -> Result<Option<String>, String> {
    let db = database
        .0
        .lock()
        .map_err(|_| "database_unavailable".to_string())?;
    db.query_row("SELECT steam_id FROM steam_profile LIMIT 1", [], |row| row.get(0))
        .optional()
        .map_err(|_| "database_error".to_string())
}
