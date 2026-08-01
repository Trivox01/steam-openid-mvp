use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::{BTreeSet, HashMap},
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const CACHE_TTL: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamInstallationIndex {
    pub steam_status: &'static str,
    pub installed_app_ids: Vec<String>,
    pub scanned_at: u64,
}

struct CachedIndex {
    created: Instant,
    value: SteamInstallationIndex,
}

#[derive(Clone, Default)]
pub struct SteamInstallationProbe {
    cache: Arc<Mutex<Option<CachedIndex>>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamManifestChange {
    pub app_id: Option<String>,
    pub index: SteamInstallationIndex,
}

enum WatcherCommand { Event(Event), Stop }

pub struct SteamManifestWatcher { sender: mpsc::Sender<WatcherCommand> }

impl SteamManifestWatcher {
    pub fn start<F>(probe: SteamInstallationProbe, emit: F) -> notify::Result<Self>
    where F: Fn(SteamManifestChange) + Send + 'static {
        let (sender, receiver) = mpsc::channel();
        let callback_sender = sender.clone();
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
            if let Ok(mut event) = result { event.paths.retain(|path|is_watched_file(path));if !event.paths.is_empty(){let _ = callback_sender.send(WatcherCommand::Event(event));} }
        })?;
        let mut watched=BTreeSet::new();configure_watcher(&mut watcher,&mut watched);
        thread::Builder::new().name("steam-manifest-watcher".into()).spawn(move || {
            watcher_loop(watcher, watched, receiver, probe, emit);
        }).map_err(notify::Error::io)?;
        Ok(Self { sender })
    }
}

impl Drop for SteamManifestWatcher { fn drop(&mut self) { let _ = self.sender.send(WatcherCommand::Stop); } }

fn watcher_loop<F>(mut watcher: RecommendedWatcher, mut watched:BTreeSet<PathBuf>, receiver: mpsc::Receiver<WatcherCommand>, probe: SteamInstallationProbe, emit: F)
where F: Fn(SteamManifestChange) {
    loop {
        let Ok(command) = receiver.recv() else { break };
        match command {
            WatcherCommand::Stop => break,
            WatcherCommand::Event(first) => {
                let Some((paths,library_folders_changed))=collect_debounced(first,&receiver,Duration::from_millis(750)) else{return};
                let app_ids:BTreeSet<String>=paths.iter().filter_map(|path| manifest_app_id(path)).collect();
                probe.invalidate();let index=probe.index(true);
                emit(SteamManifestChange { app_id:(app_ids.len()==1).then(||app_ids.into_iter().next()).flatten(), index });
                if library_folders_changed { configure_watcher(&mut watcher,&mut watched); }
            }
        }
    }
}

fn collect_debounced(first:Event,receiver:&mpsc::Receiver<WatcherCommand>,wait:Duration)->Option<(Vec<PathBuf>,bool)>{
    let mut paths=first.paths;let mut library_folders_changed=paths.iter().any(|path|is_library_folders(path));
    loop{match receiver.recv_timeout(wait){Ok(WatcherCommand::Event(event))=>{library_folders_changed|=event.paths.iter().any(|path|is_library_folders(path));paths.extend(event.paths)},Ok(WatcherCommand::Stop)|Err(mpsc::RecvTimeoutError::Disconnected)=>return None,Err(mpsc::RecvTimeoutError::Timeout)=>return Some((paths,library_folders_changed))}}
}

fn configure_watcher(watcher:&mut RecommendedWatcher,watched:&mut BTreeSet<PathBuf>) {
    let next=watcher_paths();for path in watched.difference(&next){let _=watcher.unwatch(path);}for path in next.difference(watched){let _=watcher.watch(path,RecursiveMode::NonRecursive);}*watched=next;
}

fn watcher_paths()->BTreeSet<PathBuf>{
    let candidates=steam_candidates();let Some(root)=candidates.iter().find(|path|path.join("steamapps").is_dir()) else{return BTreeSet::new()};
    let mut paths=BTreeSet::from([root.join("steamapps")]);
    if let Ok(contents)=fs::read_to_string(root.join("steamapps/libraryfolders.vdf")){for library in parse_library_paths(&contents){let steamapps=library.join("steamapps");if steamapps.is_dir(){paths.insert(steamapps);}}}
    paths
}
fn is_library_folders(path:&Path)->bool{path.file_name().is_some_and(|name|name.eq_ignore_ascii_case("libraryfolders.vdf"))}
fn is_watched_file(path:&Path)->bool{is_library_folders(path)||manifest_app_id(path).is_some()}
fn manifest_app_id(path:&Path)->Option<String>{let name=path.file_name()?.to_str()?;let id=name.strip_prefix("appmanifest_")?.strip_suffix(".acf")?;valid_app_id(id).then(||id.to_string())}

impl SteamInstallationProbe {
    pub fn index(&self, force_refresh: bool) -> SteamInstallationIndex {
        let mut cache = self.cache.lock().unwrap_or_else(|error| error.into_inner());
        if !force_refresh {
            if let Some(entry) = cache
                .as_ref()
                .filter(|entry| entry.created.elapsed() < CACHE_TTL)
            {
                return entry.value.clone();
            }
        }
        let value = build_index(&steam_candidates());
        *cache = Some(CachedIndex {
            created: Instant::now(),
            value: value.clone(),
        });
        value
    }

    pub fn invalidate(&self) {
        *self.cache.lock().unwrap_or_else(|error| error.into_inner()) = None;
    }
}

pub fn build_index(candidates: &[PathBuf]) -> SteamInstallationIndex {
    let had_candidate = !candidates.is_empty();
    let steam_root = candidates
        .iter()
        .find(|path| path.join("steamapps").is_dir());
    let Some(steam_root) = steam_root else {
        return SteamInstallationIndex {
            steam_status: if had_candidate {
                "unavailable"
            } else {
                "not_installed"
            },
            installed_app_ids: vec![],
            scanned_at: now_seconds(),
        };
    };
    let mut libraries = BTreeSet::from([steam_root.clone()]);
    let folders = steam_root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(contents) = fs::read_to_string(folders) {
        libraries.extend(
            parse_library_paths(&contents)
                .into_iter()
                .filter(|path| path.join("steamapps").is_dir()),
        );
    }
    let mut installed = BTreeSet::new();
    for library in libraries {
        let Ok(entries) = fs::read_dir(library.join("steamapps")) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(app_id) = name
                .strip_prefix("appmanifest_")
                .and_then(|value| value.strip_suffix(".acf"))
            else {
                continue;
            };
            if valid_app_id(app_id) && manifest_is_installed(&entry.path(), app_id) {
                installed.insert(app_id.to_string());
            }
        }
    }
    SteamInstallationIndex {
        steam_status: "installed",
        installed_app_ids: installed.into_iter().collect(),
        scanned_at: now_seconds(),
    }
}

fn steam_candidates() -> Vec<PathBuf> {
    let mut candidates = BTreeSet::new();
    for key in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(path) = env::var_os(key) {
            let candidate = PathBuf::from(path).join("Steam");
            if candidate.exists() {
                candidates.insert(candidate);
            }
        }
    }
    for candidate in [
        PathBuf::from(r"C:\Program Files (x86)\Steam"),
        PathBuf::from(r"C:\Program Files\Steam"),
    ] {
        if candidate.exists() {
            candidates.insert(candidate);
        }
    }
    for (hive, key, value) in [
        ("HKCU", r"Software\Valve\Steam", "SteamPath"),
        ("HKLM", r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
        ("HKLM", r"SOFTWARE\Valve\Steam", "InstallPath"),
    ] {
        if let Some(path) = registry_value(hive, key, value) {
            candidates.insert(path);
        }
    }
    candidates.into_iter().collect()
}

fn registry_value(hive: &str, key: &str, value: &str) -> Option<PathBuf> {
    let output = Command::new("reg.exe")
        .args(["query", &format!(r"{}\{}", hive, key), "/v", value])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| {
            let (_, tail) = line.split_once("REG_SZ")?;
            let value = tail.trim();
            (!value.is_empty()).then(|| PathBuf::from(value.replace('/', "\\")))
        })
}

pub fn parse_library_paths(contents: &str) -> Vec<PathBuf> {
    parse_pairs(contents)
        .into_iter()
        .filter_map(|(key, value)| {
            (key.eq_ignore_ascii_case("path") && !value.is_empty())
                .then(|| PathBuf::from(value.replace(r"\\", r"\")))
        })
        .collect()
}

fn manifest_is_installed(path: &Path, expected_app_id: &str) -> bool {
    let Ok(contents) = fs::read_to_string(path) else {
        return false;
    };
    let pairs: HashMap<_, _> = parse_pairs(&contents)
        .into_iter()
        .map(|(key, value)| (key.to_ascii_lowercase(), value))
        .collect();
    let flags = pairs
        .get("stateflags")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    pairs
        .get("appid")
        .is_some_and(|value| value == expected_app_id)
        && pairs
            .get("installdir")
            .is_some_and(|value| !value.trim().is_empty())
        && flags & 4 == 4
}

fn parse_pairs(contents: &str) -> Vec<(String, String)> {
    let bytes = contents.as_bytes();
    let mut pairs = Vec::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let Some(key_start) = contents[cursor..]
            .find('"')
            .map(|offset| cursor + offset + 1)
        else {
            break;
        };
        let Some(key_end) = contents[key_start..]
            .find('"')
            .map(|offset| key_start + offset)
        else {
            break;
        };
        cursor = key_end + 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b'"' {
            continue;
        }
        let value_start = cursor + 1;
        let Some(value_end) = contents[value_start..]
            .find('"')
            .map(|offset| value_start + offset)
        else {
            break;
        };
        pairs.push((
            contents[key_start..key_end].to_owned(),
            contents[value_start..value_end].to_owned(),
        ));
        cursor = value_end + 1;
    }
    pairs
}

fn valid_app_id(value: &str) -> bool {
    value.parse::<u32>().is_ok_and(|id| id > 0) && !value.starts_with('0')
}
fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, write};

    fn temp(name: &str) -> PathBuf {
        let path = env::temp_dir().join(format!("nexus-steam-probe-{}-{}", name, now_seconds()));
        let _ = fs::remove_dir_all(&path);
        create_dir_all(path.join("steamapps")).unwrap();
        path
    }
    fn manifest(root: &Path, id: &str, flags: &str) {
        write(root.join("steamapps").join(format!("appmanifest_{id}.acf")), format!("\"AppState\" {{ \"appid\" \"{id}\" \"StateFlags\" \"{flags}\" \"installdir\" \"Game\" }}")).unwrap();
    }

    #[test]
    fn parses_modern_library_folders() {
        assert_eq!(
            parse_library_paths(r#""0" { "path" "D:\\SteamLibrary" }"#),
            vec![PathBuf::from(r"D:\SteamLibrary")]
        );
    }
    #[test]
    fn discovers_multiple_libraries_and_valid_manifests() {
        let root = temp("multiple");
        let second = temp("second");
        manifest(&root, "10", "4");
        manifest(&second, "20", "4");
        write(
            root.join("steamapps/libraryfolders.vdf"),
            format!("\"1\" {{ \"path\" \"{}\" }}", second.display()),
        )
        .unwrap();
        assert_eq!(build_index(&[root]).installed_app_ids, vec!["10", "20"]);
    }
    #[test]
    fn rejects_malformed_mismatched_and_incomplete_manifests() {
        let root = temp("invalid");
        manifest(&root, "30", "2");
        write(root.join("steamapps/appmanifest_40.acf"), "broken").unwrap();
        write(
            root.join("steamapps/appmanifest_50.acf"),
            "\"appid\" \"51\" \"StateFlags\" \"4\" \"installdir\" \"Game\"",
        )
        .unwrap();
        assert!(build_index(&[root]).installed_app_ids.is_empty());
    }
    #[test]
    fn inaccessible_candidate_is_unavailable() {
        assert_eq!(
            build_index(&[PathBuf::from(r"Z:\missing-steam")]).steam_status,
            "unavailable"
        );
    }
    #[test]
    fn empty_candidates_mean_not_installed() {
        assert_eq!(build_index(&[]).steam_status, "not_installed");
    }
    #[test]
    fn rejects_invalid_app_ids() {
        for value in ["", "0", "01", "-1", "abc", "4294967296"] {
            assert!(!valid_app_id(value));
        }
    }
    #[test]
    fn cache_can_be_invalidated() {
        let probe = SteamInstallationProbe::default();
        *probe.cache.lock().unwrap() = Some(CachedIndex {
            created: Instant::now(),
            value: SteamInstallationIndex {
                steam_status: "installed",
                installed_app_ids: vec!["10".into()],
                scanned_at: 1,
            },
        });
        assert_eq!(probe.index(false).installed_app_ids, vec!["10"]);
        probe.invalidate();
        assert_ne!(probe.index(false).scanned_at, 1);
    }
    #[test]
    fn install_modify_and_uninstall_change_the_index() {
        let root=temp("transitions");manifest(&root,"60","2");assert!(build_index(&[root.clone()]).installed_app_ids.is_empty());
        manifest(&root,"60","4");assert_eq!(build_index(&[root.clone()]).installed_app_ids,vec!["60"]);
        fs::remove_file(root.join("steamapps/appmanifest_60.acf")).unwrap();assert!(build_index(&[root]).installed_app_ids.is_empty());
    }
    #[test]
    fn watcher_events_are_debounced_and_target_the_app() {
        let (sender,receiver)=mpsc::channel();let first=Event::new(notify::EventKind::Create(notify::event::CreateKind::File)).add_path(PathBuf::from("appmanifest_70.acf"));
        sender.send(WatcherCommand::Event(Event::new(notify::EventKind::Modify(notify::event::ModifyKind::Any)).add_path(PathBuf::from("libraryfolders.vdf")))).unwrap();
        let (paths,libraries)=collect_debounced(first,&receiver,Duration::from_millis(1)).unwrap();assert_eq!(paths.len(),2);assert!(libraries);assert_eq!(manifest_app_id(&paths[0]).as_deref(),Some("70"));
    }
    #[test]
    fn watcher_drop_requests_cleanup() {
        let (sender,receiver)=mpsc::channel();{let _watcher=SteamManifestWatcher{sender};}assert!(matches!(receiver.recv().unwrap(),WatcherCommand::Stop));
    }
    #[test]
    fn operating_system_watcher_observes_a_new_manifest() {
        let root=temp("notify");let (sender,receiver)=mpsc::channel();
        let mut watcher=notify::recommended_watcher(move|result:notify::Result<Event>|{if let Ok(event)=result{let _=sender.send(event);}}).unwrap();
        watcher.watch(&root.join("steamapps"),RecursiveMode::NonRecursive).unwrap();manifest(&root,"80","4");
        let event=receiver.recv_timeout(Duration::from_secs(3)).unwrap();assert!(event.paths.iter().any(|path|manifest_app_id(path).as_deref()==Some("80")));
    }
}
