mod commands;
mod database;
mod models;
mod steam_installation;
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
fn get_steam_installation_index(
    force_refresh: bool,
    state: tauri::State<'_, steam_installation::SteamInstallationProbe>,
) -> steam_installation::SteamInstallationIndex {
    state.index(force_refresh)
}

#[tauri::command]
fn invalidate_steam_installation_index(
    state: tauri::State<'_, steam_installation::SteamInstallationProbe>,
) {
    state.invalidate();
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
            app.manage(DesktopLifecycleState {
                minimize_to_tray: AtomicBool::new(true),
                ..Default::default()
            });
            app.manage(steam_installation::SteamInstallationProbe::default());
            let probe = app.state::<steam_installation::SteamInstallationProbe>().inner().clone();
            let handle = app.handle().clone();
            if let Ok(watcher) = steam_installation::SteamManifestWatcher::start(probe, move |change| {
                let _ = handle.emit("nexus://steam-installation-changed", change);
            }) { app.manage(watcher); }

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
            if matches!(event, WindowEvent::Focused(true)) {
                window
                    .state::<steam_installation::SteamInstallationProbe>()
                    .invalidate();
                let _ = window.emit("nexus://steam-installation-invalidated", ());
            }
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
            commands::query_games,
            commands::set_game_tracked,
            commands::record_game_opened,
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
            set_tray_behavior_enabled,
            get_steam_installation_index,
            invalidate_steam_installation_index
        ])
        .run(tauri::generate_context!())
        .expect("error while running Achievement Nexus");
}
