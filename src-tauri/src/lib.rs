mod database;
mod commands;
mod models;
mod secret_store;
mod steam;
mod steam_commands;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = database::open_database(app.handle())
                .map_err(std::io::Error::other)?;
            app.manage(state);
            app.manage(secret_store::SecretStore::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_all_games, commands::get_game_by_id, commands::upsert_games, commands::update_game, commands::clear_games,
            commands::get_achievements, commands::get_achievements_by_game, commands::get_achievement_by_id, commands::upsert_achievements, commands::clear_achievements,
            commands::get_activities, commands::save_activities, commands::clear_activities,
            commands::get_preferences, commands::save_preferences, commands::reset_preferences,
            commands::get_profile, commands::save_profile, commands::get_sync_metadata, commands::save_sync_metadata,
            steam_commands::validate_steam_connection, steam_commands::get_saved_steam_profile, steam_commands::disconnect_steam_account,
            steam_commands::steam_get_owned_games
        ])
        .run(tauri::generate_context!())
        .expect("error while running Achievement Nexus");
}
