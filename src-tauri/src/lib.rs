mod commands;
mod database;
mod models;
mod secret_store;
mod steam;
mod steam_commands;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

#[derive(Default)]
struct DesktopLifecycleState {
    minimize_to_tray: AtomicBool,
    quitting: AtomicBool,
    update_checking: AtomicBool,
    tray_notice_shown: AtomicBool,
}

#[tauri::command]
fn set_tray_behavior_enabled(enabled: bool, state: tauri::State<'_, DesktopLifecycleState>) {
    state.minimize_to_tray.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn has_steam_api_key(state: tauri::State<'_, secret_store::SecretStore>) -> Result<bool, String> {
    state.steam_api_key().map(|value| value.is_some())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let state = database::open_database(app.handle()).map_err(std::io::Error::other)?;
            app.manage(state);
            app.manage(secret_store::SecretStore::default());
            app.manage(DesktopLifecycleState {
                minimize_to_tray: AtomicBool::new(true),
                ..Default::default()
            });

            let open = MenuItem::with_id(app, "open-nexus", "Open Nexus", true, None::<&str>)?;
            let check = MenuItem::with_id(
                app,
                "check-for-updates",
                "Check for Updates",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit-nexus", "Quit Nexus", true, None::<&str>)?;
            let separator_one = PredefinedMenuItem::separator(app)?;
            let separator_two = PredefinedMenuItem::separator(app)?;
            let menu =
                Menu::with_items(app, &[&open, &separator_one, &check, &separator_two, &quit])?;
            let mut tray = TrayIconBuilder::with_id("achievement-nexus-tray")
                .menu(&menu)
                .tooltip("Achievement Nexus")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open-nexus" => show_main_window(app),
                    "check-for-updates" => {
                        let state = app.state::<DesktopLifecycleState>();
                        if !state.update_checking.swap(true, Ordering::AcqRel) {
                            show_main_window(app);
                            let _ = app.emit("nexus://check-for-updates", ());
                            state.update_checking.store(false, Ordering::Release);
                        }
                    }
                    "quit-nexus" => {
                        app.state::<DesktopLifecycleState>()
                            .quitting
                            .store(true, Ordering::Release);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } | TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<DesktopLifecycleState>();
                if state.minimize_to_tray.load(Ordering::Relaxed)
                    && !state.quitting.load(Ordering::Acquire)
                {
                    api.prevent_close();
                    if !state.tray_notice_shown.swap(true, Ordering::AcqRel) {
                        let _ = window
                            .app_handle()
                            .notification()
                            .builder()
                            .title("Achievement Nexus")
                            .body("Nexus is still running in the system tray.")
                            .show();
                    }
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_all_games,
            commands::get_game_by_id,
            commands::upsert_games,
            commands::update_game,
            commands::clear_games,
            commands::get_achievements,
            commands::get_achievements_by_game,
            commands::get_achievement_by_id,
            commands::upsert_achievements,
            commands::clear_achievements,
            commands::get_activities,
            commands::save_activities,
            commands::clear_activities,
            commands::get_preferences,
            commands::save_preferences,
            commands::reset_preferences,
            commands::get_steam_openid_desktop_state,
            commands::save_steam_openid_desktop_state,
            commands::clear_steam_openid_authenticated_identity,
            commands::get_profile,
            commands::save_profile,
            commands::get_sync_metadata,
            commands::save_sync_metadata,
            steam_commands::validate_steam_connection,
            steam_commands::get_saved_steam_profile,
            steam_commands::disconnect_steam_account,
            steam_commands::steam_get_owned_games,
            steam_commands::steam_get_game_achievements,
            set_tray_behavior_enabled,
            has_steam_api_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running Achievement Nexus");
}
