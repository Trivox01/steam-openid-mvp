use std::time::Duration;

use reqwest::{Client, StatusCode};

use super::{
    models::{SteamApiResponse, SteamProfile},
    SteamError,
};

const PLAYER_SUMMARIES_ENDPOINT: &str =
    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/";

pub struct SteamClient {
    http: Client,
}

impl SteamClient {
    pub fn new() -> Result<Self, SteamError> {
        let http = Client::builder()
            .timeout(Duration::from_secs(12))
            .user_agent("Achievement-Nexus/0.1")
            .https_only(true)
            .build()
            .map_err(|_| SteamError::ApiUnavailable)?;
        Ok(Self { http })
    }

    pub async fn get_player_summary(
        &self,
        steam_id: &str,
        api_key: &str,
    ) -> Result<SteamProfile, SteamError> {
        validate_steam_id(steam_id)?;
        if api_key.trim().is_empty() {
            return Err(SteamError::EmptyApiKey);
        }

        let response = self
            .http
            .get(PLAYER_SUMMARIES_ENDPOINT)
            .header("x-webapi-key", api_key.trim())
            .query(&[("steamids", steam_id)])
            .send()
            .await
            .map_err(map_request_error)?;

        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                return Err(SteamError::InvalidApiKey);
            }
            StatusCode::TOO_MANY_REQUESTS
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT => return Err(SteamError::ApiUnavailable),
            status if !status.is_success() => return Err(SteamError::ApiUnavailable),
            _ => {}
        }

        let payload = response
            .json::<SteamApiResponse>()
            .await
            .map_err(|_| SteamError::InvalidResponse)?;
        let player = payload
            .response
            .players
            .into_iter()
            .next()
            .ok_or(SteamError::UserNotFound)?;
        let profile = SteamProfile::from(player);
        if profile.persona_name.trim().is_empty() {
            return Err(SteamError::ProfileUnavailable);
        }
        Ok(profile)
    }
}

pub fn validate_steam_id(steam_id: &str) -> Result<(), SteamError> {
    let value = steam_id.trim();
    if value.len() != 17 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(SteamError::InvalidSteamId);
    }
    Ok(())
}

fn map_request_error(error: reqwest::Error) -> SteamError {
    if error.is_timeout() {
        SteamError::Timeout
    } else if error.is_connect() {
        SteamError::NoInternet
    } else {
        SteamError::ApiUnavailable
    }
}
