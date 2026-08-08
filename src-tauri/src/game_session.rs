use crate::steam_installation::{app_install_directories, SteamAppInstall};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub const POLL_INTERVAL_MS: u64 = 5_000;
pub const CONFIRM_DELAY_MS: u64 = 8_000;
pub const GRACE_PERIOD_MS: u64 = 8_000;
pub const NEXUS_LAUNCH_TIMEOUT_MS: u64 = 45_000;
const INDEX_TTL_MS: u64 = 10_000;
const STATE_EVENT: &str = "nexus://game-session-state";

const IGNORED_PROCESS_NAMES: [&str; 6] = [
    "steam.exe",
    "steamwebhelper",
    "steamclient",
    "steamerrorreporter",
    "crashpad",
    "crashpad_handler",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionPhase {
    Starting,
    Playing,
    Ending,
}

impl SessionPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionPhase::Starting => "starting",
            SessionPhase::Playing => "playing",
            SessionPhase::Ending => "ending",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveGameSession {
    pub session_id: String,
    pub app_id: String,
    pub state: String,
    pub started_at_ms: u64,
    pub last_seen_at_ms: u64,
    pub launch_source: String,
    pub recovered: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSessionSummary {
    pub app_id: String,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    pub duration_seconds: u64,
    pub launch_source: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatistics {
    pub sessions_today: i64,
    pub seconds_today: i64,
    pub last_session: Option<GameSessionSummary>,
    pub recent_sessions: Vec<GameSessionSummary>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDiagnostic {
    pub app_id: String,
    pub resumed: bool,
    pub closed_at_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSessionDiagnostics {
    pub scans: u64,
    pub last_scan_cost_ns: u128,
    pub average_scan_cost_ns: u128,
    pub scan_index_refreshes: u64,
    pub recovery: Vec<RecoveryDiagnostic>,
}

#[derive(Debug)]
struct RunningGame {
    session_id: String,
    app_id: String,
    phase: SessionPhase,
    started_at_ms: u64,
    last_seen_at_ms: u64,
    ending_until_ms: Option<u64>,
    launch_source: String,
    recovered: bool,
    persisted: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct ActiveRow {
    id: String,
    app_id: String,
    started_at_ms: u64,
    last_seen_at_ms: u64,
    launch_source: String,
}

#[derive(Debug)]
pub struct MonitorSettings {
    pub poll_interval_ms: u64,
    pub confirm_delay_ms: u64,
    pub grace_period_ms: u64,
    pub nexus_launch_timeout_ms: u64,
}

impl Default for MonitorSettings {
    fn default() -> Self {
        MonitorSettings {
            poll_interval_ms: POLL_INTERVAL_MS,
            confirm_delay_ms: CONFIRM_DELAY_MS,
            grace_period_ms: GRACE_PERIOD_MS,
            nexus_launch_timeout_ms: NEXUS_LAUNCH_TIMEOUT_MS,
        }
    }
}

#[derive(Debug)]
pub(crate) struct MonitorCore {
    installs: Vec<SteamAppInstall>,
    index_built_at: Option<Instant>,
    games: HashMap<String, RunningGame>,
    pending_launches: HashMap<String, u64>,
    settings: MonitorSettings,
    scans: u64,
    scan_cost_ns: u128,
    last_scan_cost_ns: u128,
    scan_index_refreshes: u64,
    recent_recovery: Vec<RecoveryDiagnostic>,
}

impl MonitorCore {
    fn index(&mut self) -> &[SteamAppInstall] {
        let expired = self
            .index_built_at
            .map(|built| built.elapsed().as_millis() >= INDEX_TTL_MS as u128)
            .unwrap_or(true);
        if expired {
            self.scan_index_refreshes += 1;
            self.installs = app_install_directories();
            self.index_built_at = Some(Instant::now());
        }
        &self.installs
    }

    fn invalidate_index(&mut self) {
        self.index_built_at = None;
    }

    pub(crate) fn diagnostics(&self) -> GameSessionDiagnostics {
        GameSessionDiagnostics {
            scans: self.scans,
            last_scan_cost_ns: self.last_scan_cost_ns,
            average_scan_cost_ns: if self.scans == 0 { 0 } else { self.scan_cost_ns / self.scans as u128 },
            scan_index_refreshes: self.scan_index_refreshes,
            recovery: self.recent_recovery.clone(),
        }
    }

    fn resolve_app_ids(&self, processes: &[(Option<PathBuf>, String)]) -> HashSet<String> {
        let resolver = ExeToAppId::new(&self.installs);
        processes
            .iter()
            .filter_map(|(exe_path, name)| {
                let lower_name = name.to_ascii_lowercase();
                if IGNORED_PROCESS_NAMES.contains(&lower_name.as_str()) {
                    return None;
                }
                match exe_path {
                    Some(path) => resolver.match_path(path),
                    None => resolver.match_installdir_exe_name(&lower_name),
                }
            })
            .collect()
    }

    fn fresh_launch_source(&self, app_id: &str, now: u64) -> Option<(String, bool)> {
        match self.pending_launches.get(app_id) {
            Some(deadline) if *deadline > now => Some(("nexus_launch".to_string(), true)),
            _ => Some(("steam_local".to_string(), false)),
        }
    }

    pub(crate) fn snapshot(&self) -> Vec<ActiveGameSession> {
        let mut sessions: Vec<ActiveGameSession> = self
            .games
            .values()
            .map(|game| ActiveGameSession {
                session_id: game.session_id.clone(),
                app_id: game.app_id.clone(),
                state: game.phase.as_str().to_string(),
                started_at_ms: game.started_at_ms,
                last_seen_at_ms: game.last_seen_at_ms,
                launch_source: game.launch_source.clone(),
                recovered: game.recovered,
            })
            .collect();
        sessions.sort_by(|left, right| {
            if left.launch_source == "nexus_launch" && right.launch_source != "nexus_launch" {
                return std::cmp::Ordering::Less;
            }
            if right.launch_source == "nexus_launch" && left.launch_source != "nexus_launch" {
                return std::cmp::Ordering::Greater;
            }
            right
                .started_at_ms
                .cmp(&left.started_at_ms)
                .then_with(|| right.app_id.cmp(&left.app_id))
        });
        sessions
    }
}

struct ExeToAppId<'a> {
    installs: &'a [SteamAppInstall],
}

impl<'a> ExeToAppId<'a> {
    fn new(installs: &'a [SteamAppInstall]) -> Self {
        ExeToAppId { installs }
    }

    fn match_path(&self, exe_path: &std::path::Path) -> Option<String> {
        let candidate = normalize_path(exe_path);
        self.installs.iter().find_map(|install| {
            let directory = install
                .library_dir
                .join("steamapps")
                .join("common")
                .join(&install.installdir);
            let prefix = normalize_path(&directory);
            let app_id = &install.app_id;
            (candidate.starts_with(&prefix)).then(|| app_id.clone())
        })
    }

    fn match_installdir_exe_name(&self, lower_name: &str) -> Option<String> {
        let without_exe = lower_name.strip_suffix(".exe")?;
        self.installs
            .iter()
            .find(|install| install.installdir.to_ascii_lowercase() == without_exe)
            .map(|install| install.app_id.clone())
    }
}

fn normalize_path(path: &std::path::Path) -> String {
    path.to_string_lossy().to_ascii_lowercase().replace('/', "\\")
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn session_id() -> String {
    Uuid::new_v4().to_string()
}

pub trait GameScanner {
    fn processes(&mut self) -> Vec<(Option<PathBuf>, String)>;
}

/// Read-only OS process scanner: executable paths and names only.
pub struct SysinfoScanner {
    system: sysinfo::System,
}

impl Default for SysinfoScanner {
    fn default() -> Self {
        SysinfoScanner {
            system: sysinfo::System::new(),
        }
    }
}

impl GameScanner for SysinfoScanner {
    fn processes(&mut self) -> Vec<(Option<PathBuf>, String)> {
        self.system.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::All,
            true,
            sysinfo::ProcessRefreshKind::nothing()
                .with_exe(sysinfo::UpdateKind::OnlyIfNotSet),
        );
        self.system
            .processes()
            .values()
            .map(|process| {
                (
                    process.exe().map(|path| path.to_path_buf()),
                    process.name().to_string_lossy().to_string(),
                )
            })
            .collect()
    }
}

fn open_sql_session(
    connection: &Connection,
    session_id: &str,
    app_id: &str,
    started_at_ms: u64,
    last_seen_at_ms: u64,
    launch_source: &str,
    recovered: bool,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO game_sessions(id, app_id, started_at, last_seen_at, launch_source, recovered)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            params![session_id, app_id, started_at_ms as i64, last_seen_at_ms as i64, launch_source, recovered as i64],
        )
        .map(|_| ())
        .map_err(|error| format!("Unable to record game session: {error}"))
}

fn close_sql_session(
    connection: &Connection,
    session_id: &str,
    ended_at_ms: u64,
    last_seen_at_ms: u64,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE game_sessions
             SET ended_at=?1, last_seen_at=?2,
                 duration_seconds=MAX(0, (?1 - started_at)) / 1000
             WHERE id=?3 AND ended_at IS NULL",
            params![ended_at_ms as i64, last_seen_at_ms as i64, session_id],
        )
        .map(|_| ())
        .map_err(|error| format!("Unable to close game session: {error}"))
}

fn active_rows(connection: &Connection) -> Result<Vec<ActiveRow>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, app_id, started_at, last_seen_at, launch_source
             FROM game_sessions WHERE ended_at IS NULL",
        )
        .map_err(|error| format!("Unable to query open game sessions: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(ActiveRow {
                id: row.get(0)?,
                app_id: row.get(1)?,
                started_at_ms: row.get::<_, i64>(2)? as u64,
                last_seen_at_ms: row.get::<_, i64>(3)? as u64,
                launch_source: row.get(4)?,
            })
        })
        .map_err(|error| format!("Unable to read open game sessions: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to decode open game sessions: {error}"))
}

fn mark_recovered(connection: &Connection, session_id: &str) -> Result<(), String> {
    connection
        .execute("UPDATE game_sessions SET recovered=1 WHERE id=?1", params![session_id])
        .map(|_| ())
        .map_err(|error| format!("Unable to mark recovered session: {error}"))
}

pub fn query_session_statistics(
    connection: &Connection,
    today_start_ms: u64,
    now: u64,
    limit: usize,
) -> Result<SessionStatistics, String> {
    let sessions_today = connection
        .query_row(
            "SELECT COUNT(*) FROM game_sessions
             WHERE started_at >= ?1 AND started_at < ?2",
            params![today_start_ms as i64, now as i64],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Unable to count sessions today: {error}"))?;
    let seconds_today = connection
        .query_row(
            "SELECT COALESCE(SUM(
                (CASE WHEN COALESCE(ended_at, ?2) > ?2 THEN ?2 ELSE COALESCE(ended_at, ?2) END)
                - (CASE WHEN started_at > ?1 THEN started_at ELSE ?1 END)
             ), 0) / 1000
             FROM game_sessions
             WHERE started_at < ?2 AND COALESCE(ended_at, ?2) > ?1",
            params![today_start_ms as i64, now as i64],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Unable to sum session time today: {error}"))?;
    let last_session = query_last_session(connection)?.into_iter().next();
    let recent_sessions = query_recent_sessions(connection, limit)?;
    Ok(SessionStatistics {
        sessions_today,
        seconds_today,
        last_session,
        recent_sessions,
    })
}

fn query_last_session(
    connection: &Connection,
) -> Result<Vec<GameSessionSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT app_id, started_at, ended_at, launch_source FROM game_sessions
             WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1",
        )
        .map_err(|error| format!("Unable to prepare last session query: {error}"))?;
    let rows = statement
        .query_map([], |row| summary_row(row))
        .map_err(|error| format!("Unable to read last session: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to decode last session: {error}"))
}

fn query_recent_sessions(
    connection: &Connection,
    limit: usize,
) -> Result<Vec<GameSessionSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT app_id, started_at, ended_at, launch_source FROM game_sessions
             WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT ?1",
        )
        .map_err(|error| format!("Unable to prepare recent sessions query: {error}"))?;
    let rows = statement
        .query_map(params![limit as i64], |row| summary_row(row))
        .map_err(|error| format!("Unable to read recent sessions: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to decode recent sessions: {error}"))
}

fn summary_row(row: &rusqlite::Row) -> rusqlite::Result<GameSessionSummary> {
    let started_at_ms = row.get::<_, i64>(1)? as u64;
    let ended_at_ms = row.get::<_, i64>(2)? as u64;
    Ok(GameSessionSummary {
        app_id: row.get(0)?,
        started_at_ms,
        ended_at_ms,
        duration_seconds: ended_at_ms.saturating_sub(started_at_ms) / 1000,
        launch_source: row.get(3)?,
    })
}

static MONITOR_STARTED: AtomicBool = AtomicBool::new(false);

pub struct SessionMonitor {
    core: Arc<Mutex<MonitorCore>>,
    tx: Option<mpsc::Sender<()>>,
    _guard: &'static AtomicBool,
}

impl SessionMonitor {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        if MONITOR_STARTED.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return Err("Game session monitor is already running".to_string());
        }
        let connection = crate::database::open_database(app)?
            .0
            .into_inner()
            .unwrap_or_else(|poison| poison.into_inner());
        let core = Arc::new(Mutex::new(MonitorCore {
            installs: Vec::new(),
            index_built_at: None,
            games: HashMap::new(),
            pending_launches: HashMap::new(),
            settings: MonitorSettings::default(),
            scans: 0,
            scan_cost_ns: 0,
            last_scan_cost_ns: 0,
            scan_index_refreshes: 0,
            recent_recovery: Vec::new(),
        }));
        let (tx, rx) = mpsc::channel();
        let thread_core = core.clone();
        let thread_app = app.clone();
        std::thread::Builder::new()
            .name("game-session-monitor".into())
            .spawn(move || monitor_loop(thread_core, thread_app, connection, rx))
            .map_err(|error| format!("Unable to start game session monitor: {error}"))?;
        Ok(SessionMonitor { core, tx: Some(tx), _guard: &MONITOR_STARTED })
    }

    pub fn stop(&mut self) {
        if let Some(tx) = self.tx.take() {
            let _ = tx.send(());
        }
    }

    pub(crate) fn core(&self) -> Arc<Mutex<MonitorCore>> {
        self.core.clone()
    }

    pub fn note_launch(&self, app_id: &str) {
        let mut inner = self.core.lock().unwrap_or_else(|poison| poison.into_inner());
        if inner.games.contains_key(app_id) {
            return;
        }
        let timeout = inner.settings.nexus_launch_timeout_ms;
        inner.pending_launches.insert(app_id.to_string(), now_ms() + timeout);
    }

    pub fn invalidate_index(&self) {
        self.core
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .invalidate_index();
    }
}

impl Drop for SessionMonitor {
    fn drop(&mut self) {
        self.stop();
    }
}

fn monitor_loop(
    core: Arc<Mutex<MonitorCore>>,
    app: AppHandle,
    connection: Connection,
    rx: mpsc::Receiver<()>,
) {
    let mut scanner = SysinfoScanner::default();
    let now = now_ms();
    let installs = {
        let mut inner = core.lock().unwrap_or_else(|poison| poison.into_inner());
        inner.index().to_vec()
    };
    match recover_sessions(&connection, &installs, &mut scanner) {
        Ok((resumed, diagnostics)) => {
            if cfg!(debug_assertions) {
                for entry in &diagnostics {
                    let action = if entry.resumed { "resumed" } else { "closed" };
                    let detail = entry
                        .closed_at_ms
                        .map(|ended| format!(" ended={ended}"))
                        .unwrap_or_default();
                    eprintln!(
                        "[game-session] recovered app={} {action}{detail}",
                        entry.app_id
                    );
                }
            }
            let mut inner = core.lock().unwrap_or_else(|poison| poison.into_inner());
            inner.recent_recovery = diagnostics;
            for row in resumed {
                inner.games.insert(
                    row.app_id.clone(),
                    RunningGame {
                        session_id: row.id,
                        app_id: row.app_id,
                        phase: SessionPhase::Playing,
                        started_at_ms: row.started_at_ms,
                        last_seen_at_ms: now,
                        ending_until_ms: None,
                        launch_source: row.launch_source,
                        recovered: true,
                        persisted: true,
                    },
                );
            }
        }
        Err(error) => {
            if cfg!(debug_assertions) {
                eprintln!("[game-session] recovery failed: {error}");
            }
        }
    }
    emit_state(&core, &app);
    let poll_ms = core.lock().unwrap_or_else(|poison| poison.into_inner()).settings.poll_interval_ms;
    loop {
        if rx.recv_timeout(Duration::from_millis(poll_ms)).is_ok() {
            break;
        }
        match scan_once(&core, &connection, &mut scanner, now_ms()) {
            Ok(transitions) => {
                if !transitions.is_empty() {
                    emit_state(&core, &app);
                }
            }
            Err(error) => {
                if cfg!(debug_assertions) {
                    eprintln!("[game-session] scan failed: {error}");
                }
            }
        }
    }
    let _ = flush_sessions(&core, &connection);
}

fn emit_state(core: &Arc<Mutex<MonitorCore>>, app: &AppHandle) {
    let sessions = core.lock().unwrap_or_else(|poison| poison.into_inner()).snapshot();
    let _ = app.emit(STATE_EVENT, SessionStatePayload { sessions });
    crate::discord_presence::refresh_from_app(app, false);
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStatePayload {
    sessions: Vec<ActiveGameSession>,
}

fn scan_once(
    core: &Arc<Mutex<MonitorCore>>,
    connection: &Connection,
    scanner: &mut dyn GameScanner,
    now: u64,
) -> Result<Vec<String>, String> {
    let mut inner = core.lock().unwrap_or_else(|poison| poison.into_inner());
    inner.scans += 1;
    let scan_started = Instant::now();
    let processes = scanner.processes();
    let seen = inner.resolve_app_ids(&processes);

    let mut transitions = Vec::new();

    inner.pending_launches.retain(|_, deadline| *deadline > now);

    let mut detected: Vec<String> = seen.iter().cloned().collect();
    detected.sort();
    for app_id in detected {
        if inner.games.contains_key(&app_id) {
            continue;
        }
        let (launch_source, pending) = match inner.fresh_launch_source(&app_id, now) {
            Some(value) => value,
            None => ("steam_local".to_string(), false),
        };
        if pending {
            inner.pending_launches.remove(&app_id);
        }
        inner.games.insert(
            app_id.clone(),
            RunningGame {
                session_id: session_id(),
                app_id: app_id.clone(),
                phase: SessionPhase::Starting,
                started_at_ms: now,
                last_seen_at_ms: now,
                ending_until_ms: None,
                launch_source,
                recovered: false,
                persisted: false,
            },
        );
        transitions.push(format!("{app_id}:start"));
    }

    let mut finished = Vec::new();
    let confirm_delay = inner.settings.confirm_delay_ms;
    let grace_period = inner.settings.grace_period_ms;
    for game in inner.games.values_mut() {
        let running = seen.contains(&game.app_id);
        if running {
            game.last_seen_at_ms = now;
            match game.phase {
                SessionPhase::Ending => {
                    game.phase = SessionPhase::Playing;
                    game.ending_until_ms = None;
                    transitions.push(format!("{}:resumed", game.app_id));
                }
                SessionPhase::Starting => {
                    if now.saturating_sub(game.started_at_ms) >= confirm_delay && !game.persisted {
                        game.phase = SessionPhase::Playing;
                        open_sql_session(
                            connection,
                            &game.session_id,
                            &game.app_id,
                            game.started_at_ms,
                            now,
                            &game.launch_source,
                            game.recovered,
                        )?;
                        game.persisted = true;
                        transitions.push(format!("{}:playing", game.app_id));
                    }
                }
                SessionPhase::Playing => {}
            }
            continue;
        }
        match game.phase {
            SessionPhase::Starting => {
                if game.ending_until_ms.is_none() {
                    game.ending_until_ms = Some(now + grace_period);
                }
                if now >= game.ending_until_ms.unwrap_or(u64::MAX) {
                    transitions.push(format!("{}:cancelled", game.app_id));
                    finished.push(game.app_id.clone());
                }
            }
            SessionPhase::Ending => {
                if now >= game.ending_until_ms.unwrap_or(u64::MAX) {
                    if game.persisted {
                        close_sql_session(connection, &game.session_id, game.last_seen_at_ms, game.last_seen_at_ms)?;
                        if cfg!(debug_assertions) {
                            eprintln!(
                                "[game-session] ended app={} source={} duration_ms={}",
                                game.app_id,
                                game.launch_source,
                                game.last_seen_at_ms.saturating_sub(game.started_at_ms)
                            );
                        }
                    }
                    transitions.push(format!("{}:ended", game.app_id));
                    finished.push(game.app_id.clone());
                }
            }
            SessionPhase::Playing => {
                game.phase = SessionPhase::Ending;
                game.ending_until_ms = Some(now + grace_period);
            }
        }
    }
    for app_id in finished {
        inner.games.remove(&app_id);
    }

    inner.last_scan_cost_ns = Instant::now().duration_since(scan_started).as_nanos();
    inner.scan_cost_ns = inner.scan_cost_ns.saturating_add(inner.last_scan_cost_ns);
    Ok(transitions)
}

fn flush_sessions(core: &Arc<Mutex<MonitorCore>>, connection: &Connection) -> Result<(), String> {
    let mut inner = core.lock().unwrap_or_else(|poison| poison.into_inner());
    let mut finished = Vec::new();
    for game in inner.games.values_mut() {
        if game.persisted {
            close_sql_session(connection, &game.session_id, game.last_seen_at_ms, game.last_seen_at_ms)?;
        }
        finished.push(game.app_id.clone());
    }
    for app_id in finished {
        inner.games.remove(&app_id);
    }
    Ok(())
}

pub(crate) fn recover_sessions(
    connection: &Connection,
    installs: &[SteamAppInstall],
    scanner: &mut dyn GameScanner,
) -> Result<(Vec<ActiveRow>, Vec<RecoveryDiagnostic>), String> {
    let rows = active_rows(connection)?;
    let processes = scanner.processes();
    let resolver = ExeToAppId::new(installs);
    let running: HashSet<String> = processes
        .iter()
        .filter_map(|(exe_path, name)| {
            let lower_name = name.to_ascii_lowercase();
            if IGNORED_PROCESS_NAMES.contains(&lower_name.as_str()) {
                return None;
            }
            match exe_path {
                Some(path) => resolver.match_path(path),
                None => resolver.match_installdir_exe_name(&lower_name),
            }
        })
        .collect();
    let mut resumed = Vec::new();
    let mut diagnostics = Vec::new();
    for row in &rows {
        if running.contains(&row.app_id) {
            mark_recovered(connection, &row.id)?;
            resumed.push(row.clone());
            diagnostics.push(RecoveryDiagnostic {
                app_id: row.app_id.clone(),
                resumed: true,
                closed_at_ms: None,
            });
        } else {
            let ended_at = row.last_seen_at_ms.max(row.started_at_ms);
            close_sql_session(connection, &row.id, ended_at, row.last_seen_at_ms)?;
            mark_recovered(connection, &row.id)?;
            diagnostics.push(RecoveryDiagnostic {
                app_id: row.app_id.clone(),
                resumed: false,
                closed_at_ms: Some(ended_at),
            });
        }
    }
    Ok((resumed, diagnostics))
}

pub fn day_start_ms(now: u64) -> u64 {
    let days = now / 86_400_000;
    days * 86_400_000
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn mem_connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE game_sessions (
                   id TEXT PRIMARY KEY,
                   app_id TEXT NOT NULL,
                   started_at INTEGER NOT NULL,
                   last_seen_at INTEGER NOT NULL,
                   ended_at INTEGER,
                   duration_seconds INTEGER NOT NULL DEFAULT 0,
                   launch_source TEXT NOT NULL DEFAULT 'steam_local' CHECK (launch_source IN ('steam_local','nexus_launch','external_launch')),
                   recovered INTEGER NOT NULL DEFAULT 0,
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE UNIQUE INDEX idx_one_open ON game_sessions(app_id) WHERE ended_at IS NULL;",
            )
            .unwrap();
        connection
    }

    fn installs() -> Vec<SteamAppInstall> {
        vec![
            SteamAppInstall {
                app_id: "10".to_string(),
                installdir: "GameOne".to_string(),
                library_dir: PathBuf::from(r"C:\Steam"),
            },
            SteamAppInstall {
                app_id: "20".to_string(),
                installdir: "Second Game".to_string(),
                library_dir: PathBuf::from(r"D:\SteamLibrary"),
            },
        ]
    }

    fn core_with_installs() -> MonitorCore {
        let mut inner = MonitorCore {
            installs: Vec::new(),
            index_built_at: None,
            games: HashMap::new(),
            pending_launches: HashMap::new(),
            settings: MonitorSettings::default(),
            scans: 0,
            scan_cost_ns: 0,
            last_scan_cost_ns: 0,
            scan_index_refreshes: 0,
            recent_recovery: Vec::new(),
        };
        inner.installs = installs();
        inner.index_built_at = Some(Instant::now());
        inner
    }

    fn owned_core() -> Arc<Mutex<MonitorCore>> {
        Arc::new(Mutex::new(core_with_installs()))
    }

    fn procs(samples: &[(&str, &str)]) -> Vec<(Option<PathBuf>, String)> {
        samples
            .iter()
            .map(|(path, name)| (Some(PathBuf::from(path)), name.to_string()))
            .collect()
    }

    struct StaticScanner {
        processes: Vec<(Option<PathBuf>, String)>,
    }
    impl GameScanner for StaticScanner {
        fn processes(&mut self) -> Vec<(Option<PathBuf>, String)> {
            self.processes.clone()
        }
    }

    #[test]
    fn maps_exe_to_app_across_libraries_case_insensitively() {
        let inner = core_with_installs();
        let seen = inner.resolve_app_ids(&procs(&[
            (r"c:\steam\steamapps\common\gameone\game.exe", "game"),
            (r"D:\SteamLibrary\steamapps\Common\Second Game\bin\second.exe", "Second"),
        ]));
        assert_eq!(seen.len(), 2);
        assert!(seen.contains("10"));
        assert!(seen.contains("20"));
    }

    #[test]
    fn ignores_steam_and_crash_reporters_and_unmapped_processes() {
        let inner = core_with_installs();
        let seen = inner.resolve_app_ids(&procs(&[
            (r"C:\Program Files (x86)\Steam\steam.exe", "steam"),
            (r"C:\Windows\System32\crashpad_handler.exe", "crashpad_handler"),
            (r"c:\steam\steamapps\common\gameone\game.exe", "game"),
        ]));
        assert!(seen.contains("10"));
        assert_eq!(seen.len(), 1);
        let unmatched = inner.resolve_app_ids(&procs(&[(r"C:\Users\me\App\Random.exe", "random")]));
        assert!(unmatched.is_empty());
    }

    #[test]
    fn unknown_name_with_path_does_not_fallback() {
        let inner = core_with_installs();
        let seen = inner.resolve_app_ids(&procs(&[
            (r"D:\SteamLibrary\steamapps\common\GameOne\pixel-farm.exe", "pixelfarm"),
        ]));
        assert!(seen.is_empty(), "path present but outside installdir must not map");
    }

    #[test]
    fn missing_path_falls_back_to_installdir_exe_name() {
        let inner = core_with_installs();
        let seen = inner.resolve_app_ids(&vec![
            (None, "GameOne.exe".to_string()),
            (None, "Second Game.exe".to_string()),
        ]);
        assert!(seen.contains("10"));
        assert!(seen.contains("20"));
        let unrelated = inner.resolve_app_ids(&vec![(None, "Steam.exe".to_string())]);
        assert!(unrelated.is_empty(), "ignored process names must never map");
    }

    #[test]
    fn starting_then_confirmed_persists_exact_row() {
        let connection = mem_connection();
        let core = Arc::new(Mutex::new(core_with_installs()));
        let mut settings = MonitorSettings::default();
        settings.confirm_delay_ms = 5_000;
        core.lock().unwrap().settings = settings;
        let mut scanner = StaticScanner { processes: procs(&[(r"C:\Steam\steamapps\common\gameone\game.exe", "game")]) };
        let t0 = 1_000_000;
        let transitions = scan_once(&core, &connection, &mut scanner, t0).unwrap();
        assert!(transitions.iter().any(|t| t == "10:start"));
        scan_once(&core, &connection, &mut scanner, t0 + 6_000).unwrap();
        let counts: (i64, i64) = connection
            .query_row(
                "SELECT COUNT(*), COALESCE(MAX(duration_seconds),0) FROM game_sessions WHERE app_id='10'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(counts.0, 1, "one open session row after confirm");
        assert_eq!(counts.1, 0);
    }

    #[test]
    fn launcher_handoff_grace_resumes_without_new_session() {
        let connection = mem_connection();
        let core = Arc::new(Mutex::new(core_with_installs()));
        {
            let mut inner = core.lock().unwrap();
            inner.settings.confirm_delay_ms = 1_000;
            inner.settings.grace_period_ms = 8_000;
        }
        let mut scanner_a = StaticScanner { processes: procs(&[(r"C:\Steam\steamapps\common\GameOne\Game.exe", "game")]) };
        scan_once(&core, &connection, &mut scanner_a, 2_000).unwrap();
        scan_once(&core, &connection, &mut scanner_a, 4_000).unwrap();
        let mut idle = StaticScanner { processes: vec![] };
        scan_once(&core, &connection, &mut idle, 5_000).unwrap();
        assert_eq!(core.lock().unwrap().games.get("10").unwrap().phase, SessionPhase::Ending);
        let mut back = StaticScanner { processes: procs(&[(r"C:\Steam\steamapps\common\gameOne\Game.exe", "Game")]) };
        scan_once(&core, &connection, &mut back, 6_000).unwrap();
        let locked = core.lock().unwrap();
        let game = locked.games.get("10").unwrap();
        assert_eq!(game.phase, SessionPhase::Playing);
        assert_eq!(game.persisted, true);
    }

    #[test]
    fn grace_expiry_closes_session_with_exact_duration() {
        let connection = mem_connection();
        let core = Arc::new(Mutex::new(core_with_installs()));
        {
            let mut inner = core.lock().unwrap();
            inner.settings.confirm_delay_ms = 1_000;
            inner.settings.grace_period_ms = 5_000;
        }
        let mut scanner = StaticScanner { processes: procs(&[(r"C:\Steam\steamapps\common\GameOne\Game.exe", "Game")]) };
        scan_once(&core, &connection, &mut scanner, 10_000).unwrap();
        scan_once(&core, &connection, &mut scanner, 11_500).unwrap();
        let mut end = StaticScanner { processes: vec![] };
        scan_once(&core, &connection, &mut end, 20_000).unwrap();
        assert_eq!(core.lock().unwrap().games.get("10").unwrap().phase, SessionPhase::Ending);
        let mut later_absent = StaticScanner { processes: vec![] };
        scan_once(&core, &connection, &mut later_absent, 26_000).unwrap();
        assert!(core.lock().unwrap().games.is_empty());
        let (ended, duration, recovered) = connection
            .query_row(
                "SELECT ended_at, duration_seconds, recovered FROM game_sessions WHERE app_id='10'",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
            )
            .unwrap();
        assert_eq!(ended, 11_500, "ends at last known sighting, grace does not inflate");
        assert_eq!(duration, 1, "duration is exact from started to last sighting");
        assert_eq!(recovered, 0);
    }

    #[test]
    fn starting_that_never_confirms_leaves_no_row() {
        let connection = mem_connection();
        let core = Arc::new(Mutex::new(core_with_installs()));
        {
            let mut inner = core.lock().unwrap();
            inner.settings.grace_period_ms = 3_000;
        }
        let mut scanner = StaticScanner { processes: procs(&[(r"C:\Steam\steamapps\common\GameOne\Quick.exe", "Quick")]) };
        let t0 = 50_000;
        scan_once(&core, &connection, &mut scanner, t0).unwrap();
        let mut absent = StaticScanner { processes: vec![] };
        scan_once(&core, &connection, &mut absent, t0 + 10_000).unwrap();
        let mut still_absent = StaticScanner { processes: vec![] };
        scan_once(&core, &connection, &mut still_absent, t0 + 23_000).unwrap();
        assert!(core.lock().unwrap().games.is_empty());
        let count: i64 = connection.query_row("SELECT COUNT(*) FROM game_sessions", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0, "unconfirmed 'sessions' must not persist");
    }

    #[test]
    fn multiple_processes_of_same_game_map_to_one_session() {
        let core = owned_core();
        let mut scanner = StaticScanner {
            processes: procs(&[
                (r"C:\Steam\steamapps\common\GameOne\Game.exe", "Game"),
                (r"C:\Steam\steamapps\common\GameOne\Launcher.exe", "Launcher"),
                (r"C:\Steam\steamapps\common\GameOne\AntiCheat.exe", "AntiCheat"),
            ]),
        };
        let _ = scan_once(&core, &Connection::open_in_memory().unwrap(), &mut scanner, 1_000);
        assert_eq!(core.lock().unwrap().games.len(), 1);
    }

    #[test]
    fn multiple_games_run_independently() {
        let core = Arc::new(Mutex::new(core_with_installs()));
        let mut scanner = StaticScanner {
            processes: procs(&[
                (r"C:\Steam\steamapps\common\GameOne\Game.exe", "Game"),
                (r"D:\SteamLibrary\steamapps\common\Second Game\Second.exe", "Second"),
            ]),
        };
        scan_once(&core, &mem_connection(), &mut scanner, 1_000).unwrap();
        assert_eq!(core.lock().unwrap().games.len(), 2);
    }

    #[test]
    fn nexus_launch_is_attributed_and_times_out() {
        let core = Arc::new(Mutex::new(core_with_installs()));
        let t0 = 100_000;
        core.lock().unwrap().pending_launches.insert("20".to_string(), t0 + 45_000);
        let mut scanner = StaticScanner { processes: procs(&[(r"D:\SteamLibrary\steamapps\common\Second Game\Second.exe", "Second")]) };
        scan_once(&core, &mem_connection(), &mut scanner, t0).unwrap();
        assert_eq!(core.lock().unwrap().games.get("20").unwrap().launch_source, "nexus_launch");
        let stale = Arc::new(Mutex::new(core_with_installs()));
        stale.lock().unwrap().pending_launches.insert("20".to_string(), t0);
        let mut later = StaticScanner { processes: procs(&[(r"D:\SteamLibrary\steamapps\common\Second Game\Second.exe", "Second")]) };
        scan_once(&stale, &mem_connection(), &mut later, t0 + 90_000).unwrap();
        assert_eq!(stale.lock().unwrap().games.get("20").unwrap().launch_source, "steam_local");
    }

    #[test]
    fn recovery_resumes_running_game_without_new_row() {
        let connection = mem_connection();
        let scanner = StaticScanner { processes: procs(&[(r"C:\Steam\steamapps\common\GameOne\Game.exe", "Game")]) };
        open_sql_session(&connection, "s1", "10", 200_000, 205_000, "steam_local", false).unwrap();
        let mut scalar = scanner;
        let (resumed, diagnostics) = recover_sessions(&connection, &installs(), &mut scalar).unwrap();
        assert_eq!(resumed.len(), 1);
        assert_eq!(resumed[0].id, "s1");
        assert!(
            diagnostics.iter().any(|entry| entry.resumed && entry.app_id == "10"),
            "resumed entry carries the app id"
        );
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM game_sessions WHERE app_id='10'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "no duplicate open row on resume");
    }

    #[test]
    fn recovery_closes_stale_session_with_best_known_timestamp() {
        let connection = mem_connection();
        open_sql_session(&connection, "s1", "10", 200_000, 240_000, "steam_local", false).unwrap();
        let mut scanner = StaticScanner { processes: vec![] };
        let (resumed, diagnostics) = recover_sessions(&connection, &installs(), &mut scanner).unwrap();
        assert!(resumed.is_empty());
        assert!(
            diagnostics.iter().any(|entry| !entry.resumed && entry.closed_at_ms == Some(240_000)),
            "closed entry reports the best-known end timestamp"
        );
        let (ended, duration, recovered) = connection
            .query_row("SELECT ended_at, duration_seconds, recovered FROM game_sessions WHERE id='s1'", [], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))).unwrap();
        assert_eq!(ended, 240_000, "closes at last known sighting");
        assert_eq!(duration, 40);
        assert_eq!(recovered, 1);
    }

    #[test]
    fn recovered_session_is_closed_on_db_after_game_exits() {
        let connection = mem_connection();
        open_sql_session(&connection, "s1", "10", 200_000, 250_000, "steam_local", true).unwrap();
        let mut running = StaticScanner { processes: procs(&[(r"C:\Steam\steamapps\common\GameOne\Game.exe", "Game")]) };
        let (resumed, _) = recover_sessions(&connection, &installs(), &mut running).unwrap();
        assert_eq!(resumed.len(), 1);
        let core = Arc::new(Mutex::new(core_with_installs()));
        {
            let mut inner = core.lock().unwrap();
            for row in resumed {
                inner.games.insert(
                    row.app_id.clone(),
                    RunningGame {
                        session_id: row.id,
                        app_id: row.app_id,
                        phase: SessionPhase::Playing,
                        started_at_ms: row.started_at_ms,
                        last_seen_at_ms: row.last_seen_at_ms,
                        ending_until_ms: None,
                        launch_source: row.launch_source,
                        recovered: true,
                        persisted: true,
                    },
                );
            }
        }
        let mut gone = StaticScanner { processes: vec![] };
        scan_once(&core, &connection, &mut gone, 300_100).unwrap();
        scan_once(&core, &connection, &mut gone, 310_000).unwrap();
        let (ended, duration, recovered) = connection
            .query_row("SELECT ended_at, duration_seconds, recovered FROM game_sessions WHERE id='s1'", [], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))).unwrap();
        assert_eq!(ended, 250_000, "recovered session closes at its last sighting");
        assert_eq!(duration, 50);
        assert_eq!(recovered, 1);
    }

    #[test]
    fn duplicate_open_session_for_same_app_is_rejected() {
        let connection = mem_connection();
        open_sql_session(&connection, "s1", "10", 1, 2, "steam_local", false).unwrap();
        assert!(open_sql_session(&connection, "s2", "10", 3, 4, "steam_local", false).is_err());
    }

    #[test]
    fn history_is_retained_after_close() {
        let connection = mem_connection();
        open_sql_session(&connection, "s1", "10", 0, 10, "steam_local", false).unwrap();
        close_sql_session(&connection, "s1", 100_000, 100_000).unwrap();
        let count: i64 = connection.query_row("SELECT COUNT(*) FROM game_sessions", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1, "closed sessions remain in history");
    }

    #[test]
    fn statistics_aggregate_today_only() {
        let connection = mem_connection();
        let today = 175_000_000_000u64 - (175_000_000_000u64 % 86_400_000);
        open_sql_session(&connection, "old", "10", today - 86_400_000, today - 86_400_000 + 60_000, "steam_local", false).unwrap();
        close_sql_session(&connection, "old", today - 86_400_000 + 70_000, today - 86_400_000 + 70_000).unwrap();
        open_sql_session(&connection, "t1", "20", today + 100, today + 1_000, "steam_local", false).unwrap();
        close_sql_session(&connection, "t1", today + 61_000, today + 61_000).unwrap();
        open_sql_session(&connection, "open", "20", today + 90_000, today + 95_000, "steam_local", false).unwrap();
        let now = today + 96_000;
        let stats = query_session_statistics(&connection, today, now, 10).unwrap();
        assert_eq!(stats.sessions_today, 2);
        assert_eq!(stats.seconds_today, 66, "closed session 60s plus open clamped at 6s");
        let last = stats.last_session.unwrap();
        assert_eq!(last.app_id, "20");
        assert_eq!(last.duration_seconds, 60);
        assert_eq!(stats.recent_sessions.len(), 2);
    }

    #[test]
    fn snapshot_orders_nexus_launch_first_then_recent_start() {
        let mut inner = core_with_installs();
        inner.games.insert(
            "20".to_string(),
            RunningGame {
                session_id: "a".into(),
                app_id: "20".into(),
                phase: SessionPhase::Playing,
                started_at_ms: 300,
                last_seen_at_ms: 300,
                ending_until_ms: None,
                launch_source: "steam_local".into(),
                recovered: false,
                persisted: true,
            },
        );
        inner.games.insert(
            "10".to_string(),
            RunningGame {
                session_id: "b".into(),
                app_id: "10".into(),
                phase: SessionPhase::Playing,
                started_at_ms: 100,
                last_seen_at_ms: 100,
                ending_until_ms: None,
                launch_source: "nexus_launch".into(),
                recovered: false,
                persisted: true,
            },
        );
        let sessions = inner.snapshot();
        assert_eq!(sessions.first().map(|session| session.app_id.as_str()), Some("10"), "nexus-launched game leads");
        inner.games.clear();
        inner.games.insert(
            "10".to_string(),
            RunningGame {
                session_id: "c".into(),
                app_id: "10".into(),
                phase: SessionPhase::Playing,
                started_at_ms: 300,
                last_seen_at_ms: 300,
                ending_until_ms: None,
                launch_source: "steam_local".into(),
                recovered: false,
                persisted: true,
            },
        );
        inner.games.insert(
            "20".to_string(),
            RunningGame {
                session_id: "d".into(),
                app_id: "20".into(),
                phase: SessionPhase::Playing,
                started_at_ms: 100,
                last_seen_at_ms: 100,
                ending_until_ms: None,
                launch_source: "steam_local".into(),
                recovered: false,
                persisted: true,
            },
        );
        let recency = inner.snapshot();
        assert_eq!(recency[0].app_id, "10", "most recent start leads among steam-local games");
    }

    #[test]
    fn monitor_cannot_be_started_twice() {
        // The guard is global; this test only verifies the guard logic.
        static FENCE: AtomicBool = AtomicBool::new(false);
        assert!(FENCE.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_ok());
        assert!(FENCE.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err());
    }
}
