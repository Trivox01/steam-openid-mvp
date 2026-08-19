use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use uuid::Uuid;

const TARGET: &str = "AchievementNexus/DesktopSession";
const DESKTOP_CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const DESKTOP_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const HEALTH_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const HEALTH_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const SECURE_SESSION_RECORD_VERSION: u8 = 1;

pub trait SecureCredentialStore: Send + Sync {
    fn save(&self, credential: &str) -> Result<(), SecureCredentialError>;
    fn load(&self) -> Result<Option<String>, SecureCredentialError>;
    fn delete(&self) -> Result<(), SecureCredentialError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecureCredentialError {
    Unavailable,
    Invalid,
}

pub struct WindowsCredentialStore { target: String }

impl Default for WindowsCredentialStore {
    fn default() -> Self { Self { target: TARGET.into() } }
}

#[cfg(windows)]
impl SecureCredentialStore for WindowsCredentialStore {
    fn save(&self, credential: &str) -> Result<(), SecureCredentialError> {
        use windows_sys::Win32::Security::Credentials::{
            CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
        };
        if credential.is_empty() || credential.len() > 1_024 {
            return Err(SecureCredentialError::Invalid);
        }
        let mut target = wide(&self.target);
        let mut username = wide("Achievement Nexus");
        let mut blob = credential.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: username.as_mut_ptr(),
            ..Default::default()
        };
        let written = unsafe { CredWriteW(&credential, 0) };
        blob.fill(0);
        if written == 0 { Err(SecureCredentialError::Unavailable) } else { Ok(()) }
    }

    fn load(&self) -> Result<Option<String>, SecureCredentialError> {
        use windows_sys::Win32::Foundation::ERROR_NOT_FOUND;
        use windows_sys::Win32::Security::Credentials::{
            CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
        };
        let target = wide(&self.target);
        let mut pointer: *mut CREDENTIALW = std::ptr::null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pointer) } == 0 {
            let code = std::io::Error::last_os_error().raw_os_error().unwrap_or_default() as u32;
            return if code == ERROR_NOT_FOUND { Ok(None) } else { Err(SecureCredentialError::Unavailable) };
        }
        if pointer.is_null() { return Err(SecureCredentialError::Unavailable); }
        let result = unsafe {
            let item = &*pointer;
            let bytes = std::slice::from_raw_parts(item.CredentialBlob, item.CredentialBlobSize as usize);
            String::from_utf8(bytes.to_vec()).map_err(|_| SecureCredentialError::Invalid)
        };
        unsafe { CredFree(pointer.cast()) };
        result.map(Some)
    }

    fn delete(&self) -> Result<(), SecureCredentialError> {
        use windows_sys::Win32::Foundation::ERROR_NOT_FOUND;
        use windows_sys::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
        let target = wide(&self.target);
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 { return Ok(()); }
        let code = std::io::Error::last_os_error().raw_os_error().unwrap_or_default() as u32;
        if code == ERROR_NOT_FOUND { Ok(()) } else { Err(SecureCredentialError::Unavailable) }
    }
}

#[cfg(not(windows))]
impl SecureCredentialStore for WindowsCredentialStore {
    fn save(&self, _: &str) -> Result<(), SecureCredentialError> { Err(SecureCredentialError::Unavailable) }
    fn load(&self) -> Result<Option<String>, SecureCredentialError> { Err(SecureCredentialError::Unavailable) }
    fn delete(&self) -> Result<(), SecureCredentialError> { Err(SecureCredentialError::Unavailable) }
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

pub struct DesktopCredentialState(pub Box<dyn SecureCredentialStore>);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SecureDesktopSessionRecord {
    version: u8,
    credential: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pending_refresh_operation_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshedDesktopSession {
    pub session_token: String,
    pub session_expires_at: String,
    pub refresh_expires_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopSessionCommandError {
    NoCredential,
    Network,
    Invalid,
    AccountNotActive,
    SecureStorageUnavailable,
    Server,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshResponse {
    session_token: String,
    session_expires_at: String,
    refresh_credential: String,
    refresh_expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSessionDiagnosticContext {
    boot_id: String,
    auth_operation_id: String,
    trigger: String,
}

#[tauri::command]
pub fn store_desktop_session_credential(
    credential: String,
    state: tauri::State<'_, DesktopCredentialState>,
) -> Result<(), DesktopSessionCommandError> {
    save_session_record(state.inner(), &SecureDesktopSessionRecord {
        version: SECURE_SESSION_RECORD_VERSION,
        credential,
        pending_refresh_operation_id: None,
    })
}

#[tauri::command]
pub fn has_desktop_session_credential(
    state: tauri::State<'_, DesktopCredentialState>,
) -> Result<bool, DesktopSessionCommandError> {
    load_session_record(state.inner()).map(|record| record.is_some())
}

#[tauri::command]
pub async fn probe_desktop_session_backend_health(
    base_url: String,
) -> Result<bool, DesktopSessionCommandError> {
    let url = endpoint(&base_url, "/health")?;
    let client = secure_http_client_with_timeouts(
        HEALTH_CONNECT_TIMEOUT,
        HEALTH_REQUEST_TIMEOUT,
    )?;
    Ok(client
        .get(url)
        .header("cache-control", "no-cache")
        .send()
        .await
        .map(|response| response.status() == reqwest::StatusCode::OK)
        .unwrap_or(false))
}

#[tauri::command]
pub async fn restore_desktop_session(
    base_url: String,
    diagnostic: Option<DesktopSessionDiagnosticContext>,
    state: tauri::State<'_, DesktopCredentialState>,
) -> Result<RefreshedDesktopSession, DesktopSessionCommandError> {
    refresh_inner(&base_url, state.inner(), diagnostic.as_ref()).await
}

#[tauri::command]
pub async fn logout_desktop_session(
    base_url: String,
    state: tauri::State<'_, DesktopCredentialState>,
) -> Result<(), DesktopSessionCommandError> {
    let credential = load_session_record(state.inner())?.map(|record| record.credential);
    // Local deletion is authoritative for logout and happens even when the
    // server cannot be reached. The credential is never restored afterward.
    state.0.delete().map_err(map_store_error)?;
    let Some(credential) = credential else { return Ok(()); };
    let url = endpoint(&base_url, "/v1/auth/desktop/logout")?;
    let client = secure_http_client()?;
    let _ = client
        .post(url)
        .header("cache-control", "no-store")
        .json(&serde_json::json!({ "credential": credential }))
        .send()
        .await;
    Ok(())
}

async fn refresh_inner(
    base_url: &str,
    state: &DesktopCredentialState,
    diagnostic: Option<&DesktopSessionDiagnosticContext>,
) -> Result<RefreshedDesktopSession, DesktopSessionCommandError> {
    log_transport_event(diagnostic, "desktop_credential_read_started", 0, None);
    let mut stored = match load_session_record(state) {
        Ok(Some(record)) => {
            log_transport_event(diagnostic, "desktop_credential_read_succeeded", 0, None);
            record
        }
        Ok(None) => {
            log_transport_event(diagnostic, "desktop_credential_read_absent", 0, None);
            return Err(DesktopSessionCommandError::NoCredential);
        }
        Err(error) => {
            log_transport_event(diagnostic, "desktop_credential_read_failed", 0, None);
            return Err(error);
        }
    };
    let operation_id = match stored.pending_refresh_operation_id.clone() {
        Some(operation_id) => operation_id,
        None => {
            let operation_id = Uuid::new_v4().to_string();
            stored.pending_refresh_operation_id = Some(operation_id.clone());
            log_credential_write(diagnostic, "desktop_credential_write_started");
            if let Err(error) = save_session_record(state, &stored) {
                log_credential_write(diagnostic, "desktop_credential_write_failed");
                return Err(error);
            }
            log_credential_write(diagnostic, "desktop_credential_write_succeeded");
            operation_id
        }
    };
    let credential = stored.credential.clone();
    let url = endpoint(base_url, "/v1/auth/desktop/refresh")?;
    let client = secure_http_client()?;
    let started = Instant::now();
    log_transport_event(
        diagnostic,
        "desktop_refresh_transport_started",
        0,
        None,
    );
    let response = match client
        .post(url)
        .header("cache-control", "no-store")
        .json(&serde_json::json!({
            "credential": credential,
            "operationId": operation_id
        }))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            log_transport_event(
                diagnostic,
                classify_transport_error(&error),
                started.elapsed().as_millis(),
                None,
            );
            return Err(DesktopSessionCommandError::Network);
        }
    };
    let status = response.status();
    log_transport_event(
        diagnostic,
        if status.is_success() { "response_received" } else { "http_status" },
        started.elapsed().as_millis(),
        Some(status.as_u16()),
    );
    if status.as_u16() == 403 {
        state.0.delete().map_err(map_store_error)?;
        return Err(DesktopSessionCommandError::AccountNotActive);
    }
    if status.as_u16() == 401 {
        state.0.delete().map_err(map_store_error)?;
        return Err(DesktopSessionCommandError::Invalid);
    }
    if !status.is_success() { return Err(DesktopSessionCommandError::Server); }
    let refreshed: RefreshResponse = match response.json().await {
        Ok(refreshed) => refreshed,
        Err(_) => {
            log_transport_event(
                diagnostic,
                "response_decode_failed",
                started.elapsed().as_millis(),
                Some(status.as_u16()),
            );
            return Err(DesktopSessionCommandError::Server);
        }
    };
    if refreshed.refresh_credential.is_empty() || refreshed.refresh_credential.len() > 512 ||
       !refreshed.refresh_credential.is_ascii() || refreshed.session_token.is_empty() ||
       refreshed.session_token.len() > 2_048 || refreshed.session_expires_at.len() > 64 ||
       refreshed.refresh_expires_at.len() > 64 {
        log_transport_event(
            diagnostic,
            "response_validation_failed",
            started.elapsed().as_millis(),
            Some(status.as_u16()),
        );
        return Err(DesktopSessionCommandError::Server);
    }
    log_credential_write(diagnostic, "desktop_credential_write_started");
    if let Err(error) = save_session_record(state, &SecureDesktopSessionRecord {
        version: SECURE_SESSION_RECORD_VERSION,
        credential: refreshed.refresh_credential,
        pending_refresh_operation_id: None,
    }) {
        log_credential_write(diagnostic, "desktop_credential_write_failed");
        return Err(error);
    }
    log_credential_write(diagnostic, "desktop_credential_write_succeeded");
    Ok(RefreshedDesktopSession {
        session_token: refreshed.session_token,
        session_expires_at: refreshed.session_expires_at,
        refresh_expires_at: refreshed.refresh_expires_at,
    })
}

fn load_session_record(
    state: &DesktopCredentialState,
) -> Result<Option<SecureDesktopSessionRecord>, DesktopSessionCommandError> {
    let Some(value) = state.0.load().map_err(map_store_error)? else { return Ok(None); };
    decode_session_record(&value).map(Some).map_err(map_store_error)
}

fn save_session_record(
    state: &DesktopCredentialState,
    record: &SecureDesktopSessionRecord,
) -> Result<(), DesktopSessionCommandError> {
    validate_session_record(record).map_err(map_store_error)?;
    let encoded = serde_json::to_string(record).map_err(|_| DesktopSessionCommandError::SecureStorageUnavailable)?;
    if encoded.len() > 1_024 {
        return Err(DesktopSessionCommandError::SecureStorageUnavailable);
    }
    state.0.save(&encoded).map_err(map_store_error)
}

fn decode_session_record(value: &str) -> Result<SecureDesktopSessionRecord, SecureCredentialError> {
    let record = if value.starts_with('{') {
        serde_json::from_str(value).map_err(|_| SecureCredentialError::Invalid)?
    } else {
        // Legacy raw credentials are upgraded in place before the next request.
        SecureDesktopSessionRecord {
            version: SECURE_SESSION_RECORD_VERSION,
            credential: value.to_string(),
            pending_refresh_operation_id: None,
        }
    };
    validate_session_record(&record)?;
    Ok(record)
}

fn validate_session_record(record: &SecureDesktopSessionRecord) -> Result<(), SecureCredentialError> {
    if record.version != SECURE_SESSION_RECORD_VERSION
        || record.credential.is_empty()
        || record.credential.len() > 512
        || !record.credential.is_ascii()
    {
        return Err(SecureCredentialError::Invalid);
    }
    if let Some(operation_id) = record.pending_refresh_operation_id.as_deref() {
        let parsed = Uuid::parse_str(operation_id).map_err(|_| SecureCredentialError::Invalid)?;
        if parsed.get_version_num() != 4 {
            return Err(SecureCredentialError::Invalid);
        }
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn log_credential_write(context: Option<&DesktopSessionDiagnosticContext>, event: &str) {
    let Some(context) = context else { return; };
    if !valid_diagnostic_id(&context.boot_id)
        || !valid_diagnostic_id(&context.auth_operation_id)
        || !matches!(
            context.trigger.as_str(),
            "boot_restore" | "access_token_expired"
                | "authenticated_request_missing_session" | "authenticated_request_401"
                | "manual_retry" | "other"
        )
    {
        return;
    }
    eprintln!(
        "[desktop-session] {{\"timestampMs\":{},\"bootId\":\"{}\",\"authOperationId\":\"{}\",\"processId\":{},\"event\":\"{}\",\"trigger\":\"{}\"}}",
        unix_timestamp_millis(), context.boot_id, context.auth_operation_id,
        std::process::id(), event, context.trigger
    );
}

#[cfg(not(debug_assertions))]
fn log_credential_write(_: Option<&DesktopSessionDiagnosticContext>, _: &str) {}

#[cfg(debug_assertions)]
fn valid_diagnostic_id(value: &str) -> bool {
    value.len() == 36 && value.bytes().all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

#[cfg(debug_assertions)]
fn unix_timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(debug_assertions)]
fn log_transport_event(
    context: Option<&DesktopSessionDiagnosticContext>,
    event: &str,
    elapsed_ms: u128,
    http_status: Option<u16>,
) {
    let Some(context) = context else { return; };
    if !valid_diagnostic_id(&context.boot_id)
        || !valid_diagnostic_id(&context.auth_operation_id)
        || !matches!(
            context.trigger.as_str(),
            "boot_restore" | "access_token_expired"
                | "authenticated_request_missing_session" | "authenticated_request_401"
                | "manual_retry" | "other"
        )
        || !matches!(
            event,
            "desktop_credential_read_started"
                | "desktop_credential_read_succeeded"
                | "desktop_credential_read_absent"
                | "desktop_credential_read_failed"
                | "desktop_refresh_transport_started"
                | "connect_timeout"
                | "request_timeout"
                | "dns_error"
                | "tls_error"
                | "connection_error"
                | "http_status"
                | "response_received"
                | "response_decode_failed"
                | "response_validation_failed"
        )
    {
        return;
    }
    let status = http_status
        .map(|value| format!(",\"httpStatus\":{value}"))
        .unwrap_or_default();
    eprintln!(
        "[desktop-session] {{\"timestampMs\":{},\"bootId\":\"{}\",\"authOperationId\":\"{}\",\"processId\":{},\"event\":\"{}\",\"trigger\":\"{}\",\"elapsedMs\":{}{} }}",
        unix_timestamp_millis(), context.boot_id, context.auth_operation_id,
        std::process::id(), event, context.trigger, elapsed_ms, status
    );
}

#[cfg(not(debug_assertions))]
fn log_transport_event(
    _: Option<&DesktopSessionDiagnosticContext>,
    _: &str,
    _: u128,
    _: Option<u16>,
) {}

fn classify_transport_error(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        return if error.is_connect() {
            "connect_timeout"
        } else {
            "request_timeout"
        };
    }
    if error.is_connect() {
        let chain = error_chain(error);
        if ["dns", "lookup address", "name or service not known", "nodename nor servname"]
            .iter()
            .any(|marker| chain.contains(marker))
        {
            return "dns_error";
        }
        if ["tls", "certificate", "handshake", "unknown issuer", "invalid peer"]
            .iter()
            .any(|marker| chain.contains(marker))
        {
            return "tls_error";
        }
    }
    "connection_error"
}

fn error_chain(error: &(dyn std::error::Error + 'static)) -> String {
    let mut messages = Vec::new();
    let mut current = Some(error);
    while let Some(value) = current {
        messages.push(value.to_string().to_lowercase());
        current = value.source();
    }
    messages.join(" ")
}

fn secure_http_client() -> Result<reqwest::Client, DesktopSessionCommandError> {
    secure_http_client_with_timeouts(DESKTOP_CONNECT_TIMEOUT, DESKTOP_REQUEST_TIMEOUT)
}

fn secure_http_client_with_timeouts(
    connect_timeout: Duration,
    request_timeout: Duration,
) -> Result<reqwest::Client, DesktopSessionCommandError> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(connect_timeout)
        .timeout(request_timeout)
        .build()
        .map_err(|_| DesktopSessionCommandError::Server)
}

fn endpoint(base_url: &str, path: &str) -> Result<String, DesktopSessionCommandError> {
    let parsed = url::Url::parse(base_url).map_err(|_| DesktopSessionCommandError::Invalid)?;
    let development_loopback = parsed.scheme() == "http" &&
        matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"));
    if (parsed.scheme() != "https" && !development_loopback) || parsed.username() != "" || parsed.password().is_some() || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(DesktopSessionCommandError::Invalid);
    }
    Ok(format!("{}{}", base_url.trim_end_matches('/'), path))
}

fn map_store_error(_: SecureCredentialError) -> DesktopSessionCommandError {
    DesktopSessionCommandError::SecureStorageUnavailable
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        future::Future,
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        },
        thread,
    };

    #[derive(Default)]
    struct MemoryStore(Mutex<Option<String>>);
    impl SecureCredentialStore for MemoryStore {
        fn save(&self, value: &str) -> Result<(), SecureCredentialError> { *self.0.lock().unwrap() = Some(value.into()); Ok(()) }
        fn load(&self) -> Result<Option<String>, SecureCredentialError> { Ok(self.0.lock().unwrap().clone()) }
        fn delete(&self) -> Result<(), SecureCredentialError> { *self.0.lock().unwrap() = None; Ok(()) }
    }

    #[derive(Clone, Default)]
    struct SharedMemoryStore(Arc<Mutex<Option<String>>>);
    impl SecureCredentialStore for SharedMemoryStore {
        fn save(&self, value: &str) -> Result<(), SecureCredentialError> {
            *self.0.lock().unwrap() = Some(value.into());
            Ok(())
        }
        fn load(&self) -> Result<Option<String>, SecureCredentialError> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn delete(&self) -> Result<(), SecureCredentialError> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    struct FailReplacementWriteStore {
        value: Arc<Mutex<Option<String>>>,
        writes: Arc<AtomicUsize>,
    }
    impl SecureCredentialStore for FailReplacementWriteStore {
        fn save(&self, value: &str) -> Result<(), SecureCredentialError> {
            if self.writes.fetch_add(1, Ordering::SeqCst) == 1 {
                return Err(SecureCredentialError::Unavailable);
            }
            *self.value.lock().unwrap() = Some(value.into());
            Ok(())
        }
        fn load(&self) -> Result<Option<String>, SecureCredentialError> {
            Ok(self.value.lock().unwrap().clone())
        }
        fn delete(&self) -> Result<(), SecureCredentialError> {
            *self.value.lock().unwrap() = None;
            Ok(())
        }
    }

    #[test]
    fn secure_store_contract_saves_loads_and_deletes_without_sqlite() {
        let store = MemoryStore::default();
        store.save("opaque-secret").unwrap();
        assert_eq!(store.load().unwrap().as_deref(), Some("opaque-secret"));
        store.delete().unwrap();
        assert_eq!(store.load().unwrap(), None);
    }

    #[test]
    fn secure_record_upgrades_legacy_credentials_and_rejects_invalid_pending_metadata() {
        let legacy = decode_session_record("opaque-legacy-credential").unwrap();
        assert_eq!(legacy.credential, "opaque-legacy-credential");
        assert_eq!(legacy.pending_refresh_operation_id, None);

        let invalid = SecureDesktopSessionRecord {
            version: SECURE_SESSION_RECORD_VERSION,
            credential: "opaque-credential".into(),
            pending_refresh_operation_id: Some("not-an-operation-id".into()),
        };
        assert_eq!(validate_session_record(&invalid), Err(SecureCredentialError::Invalid));
    }

    #[test]
    fn endpoints_require_https_except_loopback_development() {
        assert!(endpoint("https://api.example.com", "/refresh").is_ok());
        assert!(endpoint("http://127.0.0.1:8787", "/refresh").is_ok());
        assert!(endpoint("http://example.com", "/refresh").is_err());
        assert!(endpoint("file:///tmp/x", "/refresh").is_err());
    }

    #[cfg(debug_assertions)]
    #[test]
    fn diagnostic_context_accepts_only_uuid_shaped_ids() {
        assert!(valid_diagnostic_id("00000000-0000-4000-8000-000000000001"));
        assert!(!valid_diagnostic_id("credential-A"));
        assert!(!valid_diagnostic_id("00000000-0000-4000-8000-000000000001-extra"));
    }

    #[test]
    fn production_transport_timeouts_remain_eight_and_fifteen_seconds() {
        assert_eq!(DESKTOP_CONNECT_TIMEOUT, Duration::from_secs(8));
        assert_eq!(DESKTOP_REQUEST_TIMEOUT, Duration::from_secs(15));
        assert_eq!(HEALTH_CONNECT_TIMEOUT, Duration::from_secs(3));
        assert_eq!(HEALTH_REQUEST_TIMEOUT, Duration::from_secs(5));
    }

    #[test]
    fn health_probe_is_get_only_and_sends_no_credential() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let join = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
            let mut buffer = [0_u8; 2_048];
            let read = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(request.starts_with("GET /health HTTP/1.1\r\n"));
            assert!(!request.to_lowercase().contains("credential"));
            let body = r#"{"status":"ok"}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        let healthy = run_async(async move {
            probe_desktop_session_backend_health(format!("http://{address}"))
                .await
        }).unwrap();
        assert!(healthy);
        join.join().unwrap();
    }

    #[test]
    fn lost_response_and_process_restart_reuse_pending_operation_then_clear_it() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let join = thread::spawn(move || {
            let (mut first, _) = listener.accept().unwrap();
            let first_body = read_request_json(&mut first);
            assert_eq!(first_body["credential"], "credential-A");
            let operation = first_body["operationId"].as_str().unwrap().to_string();
            assert_eq!(Uuid::parse_str(&operation).unwrap().get_version_num(), 4);
            drop(first);

            let (mut second, _) = listener.accept().unwrap();
            let second_body = read_request_json(&mut second);
            assert_eq!(second_body["credential"], "credential-A");
            assert_eq!(second_body["operationId"], operation);
            write_refresh_response(&mut second, "credential-B");
        });

        let shared = SharedMemoryStore::default();
        *shared.0.lock().unwrap() = Some("credential-A".into());
        let first_state = DesktopCredentialState(Box::new(shared.clone()));
        let base_url = format!("http://{address}");
        let first = tauri::async_runtime::block_on(refresh_inner(&base_url, &first_state, None));
        assert!(matches!(first, Err(DesktopSessionCommandError::Network)));
        let pending = decode_session_record(shared.0.lock().unwrap().as_deref().unwrap()).unwrap();
        assert_eq!(pending.credential, "credential-A");
        assert!(pending.pending_refresh_operation_id.is_some());

        // A new state value represents a fresh desktop process reading the same
        // Windows Credential Manager target.
        let restarted_state = DesktopCredentialState(Box::new(shared.clone()));
        let recovered = tauri::async_runtime::block_on(refresh_inner(
            &base_url,
            &restarted_state,
            None,
        )).unwrap();
        assert_eq!(recovered.session_token, "access-token");
        let stored = decode_session_record(shared.0.lock().unwrap().as_deref().unwrap()).unwrap();
        assert_eq!(stored.credential, "credential-B");
        assert_eq!(stored.pending_refresh_operation_id, None);
        join.join().unwrap();
    }

    #[test]
    fn replacement_write_failure_preserves_predecessor_and_pending_operation() {
        let server = spawn_refresh_server("credential-B");
        let value = Arc::new(Mutex::new(Some("credential-A".into())));
        let writes = Arc::new(AtomicUsize::new(0));
        let state = DesktopCredentialState(Box::new(FailReplacementWriteStore {
            value: value.clone(),
            writes,
        }));
        let result = tauri::async_runtime::block_on(refresh_inner(&server.url, &state, None));
        assert!(matches!(result, Err(DesktopSessionCommandError::SecureStorageUnavailable)));
        let stored = decode_session_record(value.lock().unwrap().as_deref().unwrap()).unwrap();
        assert_eq!(stored.credential, "credential-A");
        assert!(stored.pending_refresh_operation_id.is_some());
        server.join.join().unwrap();
    }

    #[test]
    fn fast_refresh_transport_succeeds() {
        let server = spawn_http_server(Duration::ZERO, 200, "{}");
        let url = server.url.clone();
        let response = run_async(async move {
            secure_http_client_with_timeouts(
                Duration::from_millis(100),
                Duration::from_millis(250),
            ).unwrap().post(url)
                .json(&serde_json::json!({ "credential": "opaque-test" }))
                .send().await
        }).unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        server.join.join().unwrap();
    }

    #[test]
    fn stalled_proxy_connect_is_classified_as_connect_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let join = thread::spawn(move || {
            let (_stream, _) = listener.accept().unwrap();
            thread::sleep(Duration::from_millis(300));
        });
        let started = Instant::now();
        let error = run_async(async move {
            reqwest::Client::builder()
                .proxy(reqwest::Proxy::all(format!("http://{address}")).unwrap())
                .connect_timeout(Duration::from_millis(80))
                .timeout(Duration::from_millis(500))
                .build().unwrap()
                .post("https://api.example.test/v1/auth/desktop/refresh")
                .json(&serde_json::json!({ "credential": "opaque-test" }))
                .send().await
        }).unwrap_err();
        let elapsed = started.elapsed();
        assert_eq!(classify_transport_error(&error), "connect_timeout");
        assert!(elapsed >= Duration::from_millis(60), "elapsed={elapsed:?}");
        assert!(elapsed < Duration::from_millis(250), "elapsed={elapsed:?}");
        join.join().unwrap();
    }

    #[test]
    fn established_connection_with_response_beyond_total_timeout_is_request_timeout() {
        let server = spawn_http_server(Duration::from_millis(180), 200, "{}");
        let url = server.url.clone();
        let started = Instant::now();
        let error = run_async(async move {
            secure_http_client_with_timeouts(
                Duration::from_millis(80),
                Duration::from_millis(100),
            ).unwrap().post(url)
                .json(&serde_json::json!({ "credential": "opaque-test" }))
                .send().await
        }).unwrap_err();
        let elapsed = started.elapsed();
        assert_eq!(classify_transport_error(&error), "request_timeout");
        assert!(elapsed >= Duration::from_millis(80), "elapsed={elapsed:?}");
        assert!(elapsed < Duration::from_millis(170), "elapsed={elapsed:?}");
        server.join.join().unwrap();
    }

    #[test]
    fn established_connection_with_response_inside_total_timeout_succeeds() {
        let server = spawn_http_server(Duration::from_millis(110), 200, "{}");
        let url = server.url.clone();
        let started = Instant::now();
        let response = run_async(async move {
            secure_http_client_with_timeouts(
                Duration::from_millis(80),
                Duration::from_millis(220),
            ).unwrap().post(url)
                .json(&serde_json::json!({ "credential": "opaque-test" }))
                .send().await
        }).unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        assert!(started.elapsed() >= Duration::from_millis(90));
        server.join.join().unwrap();
    }

    // These four ignored tests use the production timeout values and wall-clock
    // delays. Run them explicitly for release diagnostics; keeping them ignored
    // prevents every ordinary cargo test invocation from taking roughly 40s.
    #[test]
    #[ignore = "controlled production-timeout transport probe"]
    fn production_case_a_fast_server_succeeds() {
        let server = spawn_http_server(Duration::ZERO, 200, "{}");
        let started = Instant::now();
        let url = server.url.clone();
        let response = run_async(async move {
            secure_http_client().unwrap().post(url).send().await
        }).unwrap();
        eprintln!("production case A elapsed_ms={}", started.elapsed().as_millis());
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        server.join.join().unwrap();
    }

    #[test]
    #[ignore = "controlled production-timeout transport probe"]
    fn production_case_b_unavailable_connect_times_out_near_eight_seconds() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let join = thread::spawn(move || {
            let (_stream, _) = listener.accept().unwrap();
            thread::sleep(Duration::from_secs(10));
        });
        let started = Instant::now();
        let error = run_async(async move {
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .proxy(reqwest::Proxy::all(format!("http://{address}")).unwrap())
                .connect_timeout(DESKTOP_CONNECT_TIMEOUT)
                .timeout(DESKTOP_REQUEST_TIMEOUT)
                .build().unwrap()
                .post("https://api.example.test/v1/auth/desktop/refresh")
                .send().await
        }).unwrap_err();
        let elapsed = started.elapsed();
        eprintln!("production case B elapsed_ms={}", elapsed.as_millis());
        assert_eq!(classify_transport_error(&error), "connect_timeout");
        assert!(elapsed >= Duration::from_millis(7_500), "elapsed={elapsed:?}");
        assert!(elapsed < Duration::from_millis(9_500), "elapsed={elapsed:?}");
        join.join().unwrap();
    }

    #[test]
    #[ignore = "controlled production-timeout transport probe"]
    fn production_case_c_established_connection_times_out_near_fifteen_seconds() {
        let server = spawn_http_server(Duration::from_secs(16), 200, "{}");
        let url = server.url.clone();
        let started = Instant::now();
        let error = run_async(async move {
            secure_http_client().unwrap().post(url).send().await
        }).unwrap_err();
        let elapsed = started.elapsed();
        eprintln!("production case C elapsed_ms={}", elapsed.as_millis());
        assert_eq!(classify_transport_error(&error), "request_timeout");
        assert!(elapsed >= Duration::from_millis(14_500), "elapsed={elapsed:?}");
        assert!(elapsed < Duration::from_millis(16_000), "elapsed={elapsed:?}");
        server.join.join().unwrap();
    }

    #[test]
    #[ignore = "controlled production-timeout transport probe"]
    fn production_case_d_established_connection_at_eleven_seconds_succeeds() {
        let server = spawn_http_server(Duration::from_secs(11), 200, "{}");
        let url = server.url.clone();
        let started = Instant::now();
        let response = run_async(async move {
            secure_http_client().unwrap().post(url).send().await
        }).unwrap();
        let elapsed = started.elapsed();
        eprintln!("production case D elapsed_ms={}", elapsed.as_millis());
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        assert!(elapsed >= Duration::from_millis(10_500), "elapsed={elapsed:?}");
        assert!(elapsed < DESKTOP_REQUEST_TIMEOUT, "elapsed={elapsed:?}");
        server.join.join().unwrap();
    }

    struct TestServer {
        url: String,
        join: thread::JoinHandle<()>,
    }

    fn run_async<F>(future: F) -> F::Output
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        tauri::async_runtime::block_on(tauri::async_runtime::spawn(future)).unwrap()
    }

    fn spawn_http_server(delay: Duration, status: u16, body: &'static str) -> TestServer {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let join = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            drain_request(&mut stream);
            thread::sleep(delay);
            let reason = if status == 200 { "OK" } else { "Service Unavailable" };
            let response = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        });
        TestServer { url: format!("http://{address}/v1/auth/desktop/refresh"), join }
    }

    fn spawn_refresh_server(replacement: &'static str) -> TestServer {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let join = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_request_json(&mut stream);
            assert_eq!(request["credential"], "credential-A");
            assert!(request["operationId"].as_str().is_some());
            write_refresh_response(&mut stream, replacement);
        });
        TestServer { url: format!("http://{address}"), join }
    }

    fn read_request_json(stream: &mut TcpStream) -> serde_json::Value {
        stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 2_048];
        loop {
            let read = stream.read(&mut buffer).unwrap();
            if read == 0 { break; }
            bytes.extend_from_slice(&buffer[..read]);
            let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") else {
                continue;
            };
            let headers = String::from_utf8_lossy(&bytes[..header_end]);
            let content_length = headers.lines().find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok()).flatten()
            }).unwrap_or_default();
            if bytes.len() >= header_end + 4 + content_length {
                return serde_json::from_slice(
                    &bytes[header_end + 4..header_end + 4 + content_length],
                ).unwrap();
            }
        }
        panic!("request body was incomplete")
    }

    fn write_refresh_response(stream: &mut TcpStream, replacement: &str) {
        let body = serde_json::json!({
            "sessionToken": "access-token",
            "sessionExpiresAt": "2026-08-17T12:15:00.000Z",
            "refreshCredential": replacement,
            "refreshExpiresAt": "2026-09-16T12:00:00.000Z"
        }).to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).unwrap();
    }

    fn drain_request(stream: &mut TcpStream) {
        stream.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
        let mut buffer = [0_u8; 2_048];
        let _ = stream.read(&mut buffer);
    }

    #[cfg(windows)]
    #[test]
    fn windows_credential_manager_round_trip_uses_an_isolated_test_target() {
        let store = WindowsCredentialStore {
            target: format!("AchievementNexus/Test/DesktopSession/{}", std::process::id())
        };
        store.delete().unwrap();
        store.save("opaque-test-secret").unwrap();
        assert_eq!(store.load().unwrap().as_deref(), Some("opaque-test-secret"));
        store.delete().unwrap();
        assert_eq!(store.load().unwrap(), None);
    }
}
