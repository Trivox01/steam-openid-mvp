mod commands;
mod config;
mod database;
mod discord_presence;
mod game_session;
mod models;
mod steam_installation;
mod secure_credential;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use std::net::IpAddr;

#[derive(Default)]
struct DesktopLifecycleState {
    minimize_to_tray: AtomicBool,
    quitting: AtomicBool,
    update_checking: AtomicBool,
    tray_notice_shown: AtomicBool,
}

#[derive(Default)]
struct SessionMonitorState(pub Mutex<Option<game_session::SessionMonitor>>);

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

#[tauri::command]
fn open_external_tool_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = validate_external_tool_url(&url)?;
    app.opener().open_url(parsed.as_str(), None::<&str>).map_err(|_| "external_link_open_failed".to_string())
}

#[tauri::command]
fn note_game_session_launch(app_id: String, state: tauri::State<'_, SessionMonitorState>) {
    let session_guard = state
        .0
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if let Some(monitor) = session_guard.as_ref() {
        monitor.note_launch(&app_id);
    }
}

#[tauri::command]
fn invalidate_session_index(state: tauri::State<'_, SessionMonitorState>) {
    let session_guard = state
        .0
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if let Some(monitor) = session_guard.as_ref() {
        monitor.invalidate_index();
    }
}

fn validate_external_tool_url(value: &str) -> Result<url::Url, String> {
    if !value.is_ascii() { return Err("unsafe_external_url".into()); }
    let parsed = url::Url::parse(value).map_err(|_| "unsafe_external_url".to_string())?;
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() || parsed.port().is_some() {
        return Err("unsafe_external_url".into());
    }
      let host = parsed.host_str().ok_or_else(|| "unsafe_external_url".to_string())?.to_ascii_lowercase();
      if host.split('.').any(|label| label.starts_with("xn--")) { return Err("unsafe_external_url".into()); }
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || !host.contains('.') {
        return Err("unsafe_external_url".into());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
          let blocked = match ip { IpAddr::V4(v) => { let octets=v.octets(); v.is_private() || v.is_loopback() || v.is_link_local() || v.is_unspecified() || v.is_multicast() || (octets[0]==100 && (64..=127).contains(&octets[1])) }, IpAddr::V6(v) => v.is_loopback() || v.is_unspecified() || v.is_unique_local() || v.is_unicast_link_local() || v.is_multicast() };
        if blocked { return Err("unsafe_external_url".into()); }
    }
    Ok(parsed)
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("nexus://app-visibility-changed", true);
    }
}

/// Registers every Tauri plugin the desktop app depends on.
///
/// Declaring the crate in `Cargo.toml` and granting ACL permissions is not enough:
/// a plugin that is never handed to the builder has no state and no IPC commands,
/// so `check()` fails at runtime. Keeping registration in one function lets the
/// test suite prove the updater is wired without duplicating the builder chain.
pub fn register_plugins<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    register_plugins(tauri::Builder::default())
        .setup(|app| {
            let state = database::open_database(app.handle()).map_err(std::io::Error::other)?;
            app.manage(state);
            app.manage(discord_presence::DiscordPresenceManager::default());
            app.manage(discord_presence::DiscordPresenceSettingsState::default());
            app.manage(DesktopLifecycleState {
                minimize_to_tray: AtomicBool::new(true),
                ..Default::default()
            });
            app.manage(steam_installation::SteamInstallationProbe::default());
            app.manage(secure_credential::DesktopCredentialState(Box::new(
                secure_credential::WindowsCredentialStore::default(),
            )));
            let probe = app.state::<steam_installation::SteamInstallationProbe>().inner().clone();
            let handle = app.handle().clone();
            if let Ok(watcher) = steam_installation::SteamManifestWatcher::start(probe, move |change| {
                let _ = handle.emit("nexus://steam-installation-changed", change);
            }) { app.manage(watcher); }

            app.manage(SessionMonitorState::default());
            match game_session::SessionMonitor::new(app.handle()) {
                Ok(monitor) => {
                    let state = app.state::<SessionMonitorState>();
                    *state.0.lock().unwrap_or_else(|poison| poison.into_inner()) = Some(monitor);
                }
                Err(reason) => {
                    eprintln!("[game-session] monitor unavailable: {reason}");
                }
            }

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
            if let WindowEvent::Focused(focused) = event {
                let _ = window.emit("nexus://app-visibility-changed", *focused);
            }
            if matches!(event, WindowEvent::Focused(true)) {
                window
                    .state::<steam_installation::SteamInstallationProbe>()
                    .invalidate();
                let _ = window.emit("nexus://steam-installation-invalidated", ());
                discord_presence::refresh_from_app(window.app_handle(), true);
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<DesktopLifecycleState>();
                if state.minimize_to_tray.load(Ordering::Relaxed)
                    && !state.quitting.load(Ordering::Acquire)
                {
                    api.prevent_close();
                    let _ = window.emit("nexus://app-visibility-changed", false);
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
            ,open_external_tool_url
            ,note_game_session_launch
            ,invalidate_session_index
            ,commands::list_game_sessions
            ,commands::game_session_statistics
            ,commands::game_session_diagnostics
            ,commands::list_game_session_summaries
            ,commands::mark_game_session_summary_seen
            ,discord_presence::discord_presence_configure
            ,discord_presence::discord_presence_refresh
            ,discord_presence::discord_presence_status
            ,secure_credential::store_desktop_session_credential
            ,secure_credential::restore_desktop_session
            ,secure_credential::logout_desktop_session
        ])
        .build(tauri::generate_context!())
        .expect("error while building Achievement Nexus")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let app_state = app_handle.state::<SessionMonitorState>();
                let mut session_guard = app_state
                    .0
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner());
                if let Some(mut monitor) = session_guard.take() {
                    monitor.stop();
                }
                app_handle
                    .state::<discord_presence::DiscordPresenceManager>()
                    .shutdown();
            }
        });
}

#[cfg(test)]
mod external_tool_url_tests {
    use super::validate_external_tool_url;
    #[test] fn accepts_public_https() { for value in ["https://example.com/download?q=1", "https://www.mediafire.com/file/example/tool.zip/file"] { assert!(validate_external_tool_url(value).is_ok(), "{value}"); } }
    #[test] fn rejects_unsafe_destinations() { for value in ["javascript:alert(1)","data:text/plain,x","file:///tmp/x","http://example.com","https://localhost/x","https://127.0.0.1/x","https://10.0.0.1/x","https://100.64.0.1/x","https://[::1]/x","https://user:pass@example.com/x","https://example.com:8443/x","https://аррӏе.example/x","https://xn--80ak6aa92e.example/x","not a url"] { assert!(validate_external_tool_url(value).is_err(), "{value}"); } }
}
