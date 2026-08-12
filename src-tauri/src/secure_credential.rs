use serde::{Deserialize, Serialize};

const TARGET: &str = "AchievementNexus/DesktopSession";

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
        if credential.is_empty() || credential.len() > 512 {
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

#[tauri::command]
pub fn store_desktop_session_credential(
    credential: String,
    state: tauri::State<'_, DesktopCredentialState>,
) -> Result<(), DesktopSessionCommandError> {
    state.0.save(&credential).map_err(map_store_error)
}

#[tauri::command]
pub async fn restore_desktop_session(
    base_url: String,
    state: tauri::State<'_, DesktopCredentialState>,
) -> Result<RefreshedDesktopSession, DesktopSessionCommandError> {
    refresh_inner(&base_url, state.inner()).await
}

#[tauri::command]
pub async fn logout_desktop_session(
    base_url: String,
    state: tauri::State<'_, DesktopCredentialState>,
) -> Result<(), DesktopSessionCommandError> {
    let credential = state.0.load().map_err(map_store_error)?;
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
) -> Result<RefreshedDesktopSession, DesktopSessionCommandError> {
    let credential = state.0.load().map_err(map_store_error)?
        .ok_or(DesktopSessionCommandError::NoCredential)?;
    let url = endpoint(base_url, "/v1/auth/desktop/refresh")?;
    let response = secure_http_client()?
        .post(url)
        .header("cache-control", "no-store")
        .json(&serde_json::json!({ "credential": credential }))
        .send()
        .await
        .map_err(|_| DesktopSessionCommandError::Network)?;
    let status = response.status();
    if status.as_u16() == 403 {
        state.0.delete().map_err(map_store_error)?;
        return Err(DesktopSessionCommandError::AccountNotActive);
    }
    if status.as_u16() == 401 {
        state.0.delete().map_err(map_store_error)?;
        return Err(DesktopSessionCommandError::Invalid);
    }
    if !status.is_success() { return Err(DesktopSessionCommandError::Server); }
    let refreshed: RefreshResponse = response.json().await.map_err(|_| DesktopSessionCommandError::Server)?;
    if refreshed.refresh_credential.is_empty() || refreshed.refresh_credential.len() > 512 ||
       !refreshed.refresh_credential.is_ascii() || refreshed.session_token.is_empty() ||
       refreshed.session_token.len() > 2_048 || refreshed.session_expires_at.len() > 64 ||
       refreshed.refresh_expires_at.len() > 64 {
        return Err(DesktopSessionCommandError::Server);
    }
    state.0.save(&refreshed.refresh_credential).map_err(map_store_error)?;
    Ok(RefreshedDesktopSession {
        session_token: refreshed.session_token,
        session_expires_at: refreshed.session_expires_at,
        refresh_expires_at: refreshed.refresh_expires_at,
    })
}

fn secure_http_client() -> Result<reqwest::Client, DesktopSessionCommandError> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(8))
        .timeout(std::time::Duration::from_secs(15))
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
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryStore(Mutex<Option<String>>);
    impl SecureCredentialStore for MemoryStore {
        fn save(&self, value: &str) -> Result<(), SecureCredentialError> { *self.0.lock().unwrap() = Some(value.into()); Ok(()) }
        fn load(&self) -> Result<Option<String>, SecureCredentialError> { Ok(self.0.lock().unwrap().clone()) }
        fn delete(&self) -> Result<(), SecureCredentialError> { *self.0.lock().unwrap() = None; Ok(()) }
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
    fn endpoints_require_https_except_loopback_development() {
        assert!(endpoint("https://api.example.com", "/refresh").is_ok());
        assert!(endpoint("http://127.0.0.1:8787", "/refresh").is_ok());
        assert!(endpoint("http://example.com", "/refresh").is_err());
        assert!(endpoint("file:///tmp/x", "/refresh").is_err());
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
