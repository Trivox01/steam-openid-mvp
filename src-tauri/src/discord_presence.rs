use crate::{database::DatabaseState, game_session::ActiveGameSession, SessionMonitorState};
use discord_presence::{
    event_handler::EventCallbackHandle,
    models::{Activity, ActivityAssets, ActivityTimestamps},
    Client,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    sync::{mpsc, Arc, Mutex},
    thread::JoinHandle,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

const LOGO_ASSET_KEY: &str = "nexus_logo";
const MAX_VISIBLE_TEXT_CHARS: usize = 128;
const RECONNECT_DELAY: Duration = Duration::from_secs(5);
const RECONNECT_ATTEMPTS: usize = 6;
const RETRY_WATCHDOG_DELAY: Duration = Duration::from_secs(40);
const LONG_RECONNECT_DELAY: Duration = Duration::from_secs(300);

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscordPresenceSettings {
    pub enabled: bool,
    pub show_game_name: bool,
    pub show_achievement_progress: bool,
    pub show_session_duration: bool,
}

impl Default for DiscordPresenceSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            show_game_name: true,
            show_achievement_progress: true,
            show_session_duration: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ActivitySpec {
    details: String,
    state: Option<String>,
    started_at_seconds: Option<u64>,
}

impl ActivitySpec {
    fn apply(&self, mut activity: Activity) -> Activity {
        activity = activity.details(self.details.clone());
        if let Some(state) = &self.state {
            activity = activity.state(state.clone());
        }
        if let Some(started_at) = self.started_at_seconds {
            activity = activity.timestamps(|_| ActivityTimestamps::new().start(started_at));
        }
        activity.assets(|_| {
            ActivityAssets::new()
                .large_image(LOGO_ASSET_KEY)
                .large_text("Achievement Nexus")
        })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordPresenceStatus {
    pub availability: String,
    pub current_activity: String,
    pub queued_updates: u64,
}

#[derive(Debug)]
struct SharedStatus {
    availability: &'static str,
    current_activity: &'static str,
    queued_updates: u64,
    failed_connections: usize,
}

impl SharedStatus {
    fn snapshot(&self) -> DiscordPresenceStatus {
        DiscordPresenceStatus {
            availability: self.availability.to_string(),
            current_activity: self.current_activity.to_string(),
            queued_updates: self.queued_updates,
        }
    }
}

enum WorkerMessage {
    Configure(DiscordPresenceSettings, mpsc::SyncSender<()>),
    Refresh {
        activity: Option<ActivitySpec>,
        force_reconnect: bool,
        ack: Option<mpsc::SyncSender<()>>,
    },
    Connected,
    Disconnected,
    ConnectionFailed,
    Shutdown(mpsc::SyncSender<()>),
}

pub struct DiscordPresenceManager {
    sender: mpsc::Sender<WorkerMessage>,
    status: Arc<Mutex<SharedStatus>>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl Default for DiscordPresenceManager {
    fn default() -> Self {
        Self::new(configured_application_id())
    }
}

impl DiscordPresenceManager {
    fn new(application_id: Option<u64>) -> Self {
        let (sender, receiver) = mpsc::channel();
        let status = Arc::new(Mutex::new(SharedStatus {
            availability: if application_id.is_some() {
                "disabled"
            } else {
                "unconfigured"
            },
            current_activity: "none",
            queued_updates: 0,
            failed_connections: 0,
        }));
        let worker_status = status.clone();
        let worker_sender = sender.clone();
        let worker = std::thread::Builder::new()
            .name("discord-presence-manager".into())
            .spawn(move || presence_worker(application_id, receiver, worker_sender, worker_status))
            .expect("Discord presence manager thread should start");
        Self {
            sender,
            status,
            worker: Mutex::new(Some(worker)),
        }
    }

    pub fn configure(&self, settings: DiscordPresenceSettings) {
        let (ack_sender, ack_receiver) = mpsc::sync_channel(0);
        let _ = self
            .sender
            .send(WorkerMessage::Configure(settings, ack_sender));
        let _ = ack_receiver.recv_timeout(Duration::from_millis(500));
    }

    fn refresh(&self, activity: Option<ActivitySpec>, force_reconnect: bool) {
        let _ = self.sender.send(WorkerMessage::Refresh {
            activity,
            force_reconnect,
            ack: None,
        });
    }

    fn refresh_and_wait(&self, activity: Option<ActivitySpec>, force_reconnect: bool) {
        let (ack_sender, ack_receiver) = mpsc::sync_channel(0);
        let _ = self.sender.send(WorkerMessage::Refresh {
            activity,
            force_reconnect,
            ack: Some(ack_sender),
        });
        let _ = ack_receiver.recv_timeout(Duration::from_millis(500));
    }

    pub fn status(&self) -> DiscordPresenceStatus {
        self.status
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .snapshot()
    }

    pub fn shutdown(&self) {
        let mut worker = self
            .worker
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let Some(handle) = worker.take() else { return };
        let (ack_sender, ack_receiver) = mpsc::sync_channel(0);
        let _ = self.sender.send(WorkerMessage::Shutdown(ack_sender));
        let _ = ack_receiver.recv_timeout(Duration::from_secs(2));
        let _ = handle.join();
    }
}

fn configured_application_id() -> Option<u64> {
    option_env!("DISCORD_APPLICATION_ID")
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
}

fn presence_worker(
    application_id: Option<u64>,
    receiver: mpsc::Receiver<WorkerMessage>,
    sender: mpsc::Sender<WorkerMessage>,
    status: Arc<Mutex<SharedStatus>>,
) {
    let mut settings = DiscordPresenceSettings::default();
    let mut desired: Option<ActivitySpec> = None;
    let mut last_fingerprint: Option<ActivitySpec> = None;
    let mut client: Option<Client> = None;
    let mut handlers: Vec<EventCallbackHandle> = Vec::new();

    loop {
        let (availability, failed_connections) = {
            let current = status.lock().unwrap_or_else(|poison| poison.into_inner());
            (current.availability, current.failed_connections)
        };
        let waiting_to_retry = settings.enabled
            && desired.is_some()
            && application_id.is_some()
            && matches!(availability, "retrying" | "disconnected");
        let message = if waiting_to_retry {
            let wait = if failed_connections >= RECONNECT_ATTEMPTS {
                LONG_RECONNECT_DELAY
            } else {
                RETRY_WATCHDOG_DELAY
            };
            match receiver.recv_timeout(wait) {
                Ok(message) => message,
                Err(mpsc::RecvTimeoutError::Timeout) => WorkerMessage::Refresh {
                    activity: desired.clone(),
                    force_reconnect: true,
                    ack: None,
                },
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match receiver.recv() {
                Ok(message) => message,
                Err(_) => break,
            }
        };
        match message {
            WorkerMessage::Configure(next, ack) => {
                settings = next;
                if !settings.enabled || application_id.is_none() {
                    clear_and_stop(&mut client, &mut handlers, &status);
                    desired = None;
                    last_fingerprint = None;
                    set_status(
                        &status,
                        if application_id.is_some() {
                            "disabled"
                        } else {
                            "unconfigured"
                        },
                        "none",
                    );
                    development_log(if application_id.is_some() {
                        "disabled"
                    } else {
                        "unconfigured"
                    });
                }
                let _ = ack.send(());
            }
            WorkerMessage::Refresh {
                activity,
                force_reconnect,
                ack,
            } => {
                if !settings.enabled || application_id.is_none() {
                    if let Some(ack) = ack {
                        let _ = ack.send(());
                    }
                    continue;
                }
                desired = activity;
                let Some(next) = desired.clone() else {
                    clear_and_stop(&mut client, &mut handlers, &status);
                    last_fingerprint = None;
                    set_status(&status, "idle", "none");
                    development_log("activity cleared");
                    if let Some(ack) = ack {
                        let _ = ack.send(());
                    }
                    continue;
                };

                let fingerprint_changed = last_fingerprint.as_ref() != Some(&next);
                let (availability, failed_connections) = {
                    let current = status.lock().unwrap_or_else(|poison| poison.into_inner());
                    (current.availability, current.failed_connections)
                };
                let retries_exhausted = failed_connections >= RECONNECT_ATTEMPTS;
                let should_restart = (force_reconnect
                    && matches!(availability, "retrying" | "disconnected"))
                    || (retries_exhausted && fingerprint_changed);
                if should_restart {
                    stop_client(&mut client, &mut handlers);
                    last_fingerprint = None;
                }
                if client.is_none() {
                    let id = application_id.expect("checked above");
                    let (new_client, new_handlers) = start_client(id, sender.clone(), &status);
                    client = Some(new_client);
                    handlers = new_handlers;
                }
                if last_fingerprint.as_ref() != Some(&next) {
                    last_fingerprint = Some(next.clone());
                    set_current_activity(&status, "game");
                    if is_connected(&status) {
                        if let Some(active) = client.as_mut() {
                            queue_activity(active, next, &status);
                        }
                    }
                }
                if let Some(ack) = ack {
                    let _ = ack.send(());
                }
            }
            WorkerMessage::Connected => {
                {
                    let mut current = status.lock().unwrap_or_else(|poison| poison.into_inner());
                    current.availability = "connected";
                    current.failed_connections = 0;
                }
                if let (Some(client), Some(activity)) = (client.as_mut(), desired.as_ref()) {
                    queue_activity(client, activity.clone(), &status);
                }
                development_log("connected");
            }
            WorkerMessage::Disconnected => {
                set_availability(&status, "retrying");
                development_log("disconnected; retrying with bounded backoff");
            }
            WorkerMessage::ConnectionFailed => {
                let mut current = status.lock().unwrap_or_else(|poison| poison.into_inner());
                current.failed_connections += 1;
                current.availability = if current.failed_connections >= RECONNECT_ATTEMPTS {
                    "disconnected"
                } else {
                    "retrying"
                };
            }
            WorkerMessage::Shutdown(ack) => {
                clear_and_stop(&mut client, &mut handlers, &status);
                set_status(&status, "disabled", "none");
                let _ = ack.send(());
                break;
            }
        }
    }
}

fn start_client(
    application_id: u64,
    sender: mpsc::Sender<WorkerMessage>,
    status: &Arc<Mutex<SharedStatus>>,
) -> (Client, Vec<EventCallbackHandle>) {
    let mut client =
        Client::with_error_config(application_id, RECONNECT_DELAY, Some(RECONNECT_ATTEMPTS));
    let connected_sender = sender.clone();
    let disconnected_sender = sender.clone();
    let failed_sender = sender;
    let handlers = vec![
        client.on_connected(move |_| {
            let _ = connected_sender.send(WorkerMessage::Connected);
        }),
        client.on_disconnected(move |_| {
            let _ = disconnected_sender.send(WorkerMessage::Disconnected);
        }),
        client.on_error(move |_| {
            let _ = failed_sender.send(WorkerMessage::ConnectionFailed);
        }),
    ];
    {
        let mut current = status.lock().unwrap_or_else(|poison| poison.into_inner());
        current.availability = "connecting";
        current.failed_connections = 0;
    }
    client.start();
    development_log("connecting");
    (client, handlers)
}

fn clear_and_stop(
    client: &mut Option<Client>,
    handlers: &mut Vec<EventCallbackHandle>,
    status: &Arc<Mutex<SharedStatus>>,
) {
    if let Some(active) = client.as_mut() {
        if is_connected(status) {
            let _ = active.clear_activity();
        }
    }
    stop_client(client, handlers);
}

fn stop_client(client: &mut Option<Client>, handlers: &mut Vec<EventCallbackHandle>) {
    handlers.clear();
    if let Some(active) = client.take() {
        let _ = active.shutdown();
    }
}

fn set_status(
    status: &Arc<Mutex<SharedStatus>>,
    availability: &'static str,
    activity: &'static str,
) {
    let mut current = status.lock().unwrap_or_else(|poison| poison.into_inner());
    current.availability = availability;
    current.current_activity = activity;
    current.failed_connections = 0;
}

fn set_availability(status: &Arc<Mutex<SharedStatus>>, availability: &'static str) {
    status
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .availability = availability;
}

fn set_current_activity(status: &Arc<Mutex<SharedStatus>>, activity: &'static str) {
    status
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .current_activity = activity;
}

fn is_connected(status: &Arc<Mutex<SharedStatus>>) -> bool {
    status
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .availability
        == "connected"
}

fn queue_activity(client: &mut Client, activity: ActivitySpec, status: &Arc<Mutex<SharedStatus>>) {
    client.queue_activity(move |current| activity.apply(current));
    let mut current = status.lock().unwrap_or_else(|poison| poison.into_inner());
    current.queued_updates += 1;
    current.current_activity = "game";
    development_log("activity updated");
}

fn development_log(message: &str) {
    if cfg!(debug_assertions) {
        eprintln!("[discord-presence] {message}");
    }
}

fn current_activity(
    sessions: &[ActiveGameSession],
    db: &Connection,
    settings: DiscordPresenceSettings,
) -> Option<ActivitySpec> {
    if !settings.enabled {
        return None;
    }
    let session = sessions.iter().find(|session| session.state == "playing")?;
    if !session
        .app_id
        .chars()
        .all(|character| character.is_ascii_digit())
    {
        return None;
    }
    let metadata = db
        .query_row(
            "SELECT name, achievements_unlocked, achievements_total FROM games WHERE platform_game_id = ?1 ORDER BY synced_at DESC LIMIT 1",
            [&session.app_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
        )
        .optional()
        .ok()
        .flatten();

    let details = if settings.show_game_name {
        metadata
            .as_ref()
            .and_then(|(name, _, _)| sanitize_visible_text(name))
            .unwrap_or_else(|| "Playing a game".to_string())
    } else {
        "Playing a game".to_string()
    };
    let state = if settings.show_achievement_progress {
        metadata.as_ref().and_then(|(_, unlocked, total)| {
            (*total > 0 && *unlocked >= 0 && *unlocked <= *total)
                .then(|| format!("{unlocked} / {total} Achievements"))
        })
    } else {
        None
    };
    let started_at_seconds = settings
        .show_session_duration
        .then(|| valid_start_timestamp(session.started_at_ms))
        .flatten();
    Some(ActivitySpec {
        details,
        state,
        started_at_seconds,
    })
}

fn sanitize_visible_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return None;
    }
    Some(trimmed.chars().take(MAX_VISIBLE_TEXT_CHARS).collect())
}

fn valid_start_timestamp(started_at_ms: u64) -> Option<u64> {
    let seconds = started_at_ms.checked_div(1_000)?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    (seconds > 0 && seconds <= now.saturating_add(300)).then_some(seconds)
}

fn activity_from_app(app: &AppHandle) -> Option<ActivitySpec> {
    let session_state = app.state::<SessionMonitorState>();
    let sessions = {
        let monitor = session_state
            .0
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        monitor
            .as_ref()
            .map(|value| {
                value
                    .core()
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner())
                    .snapshot()
            })
            .unwrap_or_default()
    };
    let settings = app
        .state::<DiscordPresenceSettingsState>()
        .0
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .to_owned();
    let db_state = app.state::<DatabaseState>();
    db_state
        .0
        .lock()
        .ok()
        .and_then(|db| current_activity(&sessions, &db, settings))
}

pub fn refresh_from_app(app: &AppHandle, force_reconnect: bool) {
    app.state::<DiscordPresenceManager>()
        .refresh(activity_from_app(app), force_reconnect);
}

pub struct DiscordPresenceSettingsState(pub Mutex<DiscordPresenceSettings>);

impl Default for DiscordPresenceSettingsState {
    fn default() -> Self {
        Self(Mutex::new(DiscordPresenceSettings::default()))
    }
}

#[tauri::command]
pub fn discord_presence_configure(
    settings: DiscordPresenceSettings,
    app: AppHandle,
    manager: State<'_, DiscordPresenceManager>,
    settings_state: State<'_, DiscordPresenceSettingsState>,
) -> DiscordPresenceStatus {
    *settings_state
        .0
        .lock()
        .unwrap_or_else(|poison| poison.into_inner()) = settings;
    manager.configure(settings);
    manager.refresh_and_wait(activity_from_app(&app), false);
    manager.status()
}

#[tauri::command]
pub fn discord_presence_refresh(app: AppHandle) {
    refresh_from_app(&app, false);
}

#[tauri::command]
pub fn discord_presence_status(
    manager: State<'_, DiscordPresenceManager>,
) -> DiscordPresenceStatus {
    manager.status()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE games (platform_game_id TEXT, name TEXT, achievements_unlocked INTEGER, achievements_total INTEGER, synced_at TEXT);",
        ).unwrap();
        connection
    }

    fn session(app_id: &str, state: &str, started_at_ms: u64) -> ActiveGameSession {
        ActiveGameSession {
            session_id: "not-exported".into(),
            app_id: app_id.into(),
            state: state.into(),
            started_at_ms,
            last_seen_at_ms: started_at_ms,
            launch_source: "steam_local".into(),
            recovered: false,
        }
    }

    #[test]
    fn disabled_is_the_default_and_produces_no_activity() {
        let db = database();
        assert!(!DiscordPresenceSettings::default().enabled);
        assert_eq!(
            current_activity(
                &[session("10", "playing", 1_000)],
                &db,
                DiscordPresenceSettings::default()
            ),
            None
        );
    }

    #[test]
    fn only_confirmed_playing_session_is_used_in_existing_order() {
        let db = database();
        db.execute(
            "INSERT INTO games VALUES (?1, ?2, 12, 47, '2026-01-01')",
            params!["20", "TEKKEN 8"],
        )
        .unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let sessions = vec![
            session("10", "starting", now),
            session("20", "playing", now),
        ];
        let activity = current_activity(
            &sessions,
            &db,
            DiscordPresenceSettings {
                enabled: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(activity.details, "TEKKEN 8");
        assert_eq!(activity.state.as_deref(), Some("12 / 47 Achievements"));
        assert_eq!(activity.started_at_seconds, Some(now / 1_000));
    }

    #[test]
    fn missing_or_invalid_progress_never_becomes_zero_of_zero() {
        let db = database();
        db.execute(
            "INSERT INTO games VALUES ('10', 'Game', 0, 0, '2026-01-01')",
            [],
        )
        .unwrap();
        let activity = current_activity(
            &[session("10", "playing", 1_000)],
            &db,
            DiscordPresenceSettings {
                enabled: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(activity.state, None);
    }

    #[test]
    fn privacy_toggles_remove_name_progress_and_duration() {
        let db = database();
        db.execute(
            "INSERT INTO games VALUES ('10', 'Private Game', 3, 4, '2026-01-01')",
            [],
        )
        .unwrap();
        let activity = current_activity(
            &[session("10", "playing", 1_000)],
            &db,
            DiscordPresenceSettings {
                enabled: true,
                show_game_name: false,
                show_achievement_progress: false,
                show_session_duration: false,
            },
        )
        .unwrap();
        assert_eq!(
            activity,
            ActivitySpec {
                details: "Playing a game".into(),
                state: None,
                started_at_seconds: None
            }
        );
        let serialized = serde_json::to_string(&activity.apply(Activity::new())).unwrap();
        for forbidden in [
            "Private Game",
            "SteamID64",
            "userId",
            "email",
            "token",
            "not-exported",
            "platform_game_id",
        ] {
            assert!(!serialized.contains(forbidden), "leaked {forbidden}");
        }
        assert!(!serialized.contains("buttons") || serialized.contains("\"buttons\":[]"));
    }

    #[test]
    fn invalid_metadata_is_replaced_and_visible_text_is_bounded() {
        let db = database();
        db.execute(
            "INSERT INTO games VALUES ('10', ?1, 1, 2, '2026-01-01')",
            [format!("{}\n", "x".repeat(200))],
        )
        .unwrap();
        let activity = current_activity(
            &[session("10", "playing", 1_000)],
            &db,
            DiscordPresenceSettings {
                enabled: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(activity.details.chars().count(), 128);
        assert!(
            sanitize_visible_text(&"x".repeat(200))
                .unwrap()
                .chars()
                .count()
                <= 128
        );
        assert_eq!(sanitize_visible_text("\n"), None);
        assert_eq!(sanitize_visible_text("Bad\nName"), None);
    }

    #[test]
    fn activity_fingerprint_preserves_session_start_and_dedupes_equal_state() {
        let one = ActivitySpec {
            details: "Game".into(),
            state: Some("1 / 2 Achievements".into()),
            started_at_seconds: Some(100),
        };
        let repeated = one.clone();
        let changed = ActivitySpec {
            state: Some("2 / 2 Achievements".into()),
            ..one.clone()
        };
        assert_eq!(one, repeated);
        assert_ne!(one, changed);
        assert_eq!(one.started_at_seconds, changed.started_at_seconds);
    }

    #[test]
    fn reconnect_policy_is_bounded_and_never_uses_a_fast_poll() {
        assert_eq!(RECONNECT_ATTEMPTS, 6);
        assert_eq!(RECONNECT_DELAY, Duration::from_secs(5));
        assert!(RETRY_WATCHDOG_DELAY >= Duration::from_secs(30));
        assert!(LONG_RECONNECT_DELAY >= Duration::from_secs(300));
    }

    #[test]
    fn unconfigured_manager_is_safe_and_reports_no_activity() {
        let manager = DiscordPresenceManager::new(None);
        manager.configure(DiscordPresenceSettings {
            enabled: true,
            ..Default::default()
        });
        manager.refresh(
            Some(ActivitySpec {
                details: "Game".into(),
                state: None,
                started_at_seconds: None,
            }),
            true,
        );
        std::thread::sleep(Duration::from_millis(20));
        let status = manager.status();
        assert_eq!(status.availability, "unconfigured");
        assert_eq!(status.current_activity, "none");
        manager.shutdown();
    }
}
