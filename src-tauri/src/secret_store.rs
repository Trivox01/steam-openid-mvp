use std::sync::Mutex;

#[derive(Default)]
pub struct SecretStore(Mutex<Option<String>>);

impl SecretStore {
    pub fn save_steam_api_key(&self, api_key: String) -> Result<(), String> {
        let mut value = self
            .0
            .lock()
            .map_err(|_| "Secure credential memory is unavailable.".to_string())?;
        *value = Some(api_key);
        Ok(())
    }

    pub fn clear_steam_api_key(&self) -> Result<(), String> {
        let mut value = self
            .0
            .lock()
            .map_err(|_| "Secure credential memory is unavailable.".to_string())?;
        if let Some(secret) = value.as_mut() {
            secret.clear();
        }
        *value = None;
        Ok(())
    }
}
