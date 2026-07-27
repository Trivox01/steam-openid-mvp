use std::time::Duration;

use reqwest::{Client, StatusCode};
use std::collections::BTreeMap;

use super::{
    models::{SteamApiResponse, SteamOwnedGameApiItem, SteamOwnedGamesApiResponse, SteamOwnedGamesResult, SteamProfile},
    SteamError,
};

const PLAYER_SUMMARIES_ENDPOINT: &str =
    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/";
const OWNED_GAMES_ENDPOINT: &str =
    "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";

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
            .query(&[("key", api_key.trim()), ("steamids", steam_id)])
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

    pub async fn get_owned_games(
        &self,
        steam_id: &str,
        api_key: &str,
    ) -> Result<SteamOwnedGamesResult, SteamError> {
        validate_steam_id(steam_id)?;
        if api_key.trim().is_empty() {
            return Err(SteamError::ApiKeyUnavailable);
        }
        let response = self
            .http
            .get(OWNED_GAMES_ENDPOINT)
            .query(&[
                ("key", api_key.trim()),
                ("steamid", steam_id),
                ("include_appinfo", "true"),
                ("include_played_free_games", "true"),
                ("format", "json"),
            ])
            .send()
            .await
            .map_err(map_request_error)?;
        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => return Err(SteamError::InvalidApiKey),
            StatusCode::TOO_MANY_REQUESTS => return Err(SteamError::RateLimited),
            status if !status.is_success() => return Err(SteamError::ApiUnavailable),
            _ => {}
        }
        let text = response.text().await.map_err(|_| SteamError::InvalidResponse)?;
        parse_owned_games_payload(&text)
    }
}

pub(crate) fn parse_owned_games_payload(payload: &str) -> Result<SteamOwnedGamesResult, SteamError> {
    let payload: SteamOwnedGamesApiResponse =
        serde_json::from_str(payload).map_err(|_| SteamError::InvalidResponse)?;
    if payload.response.game_count.is_none() && payload.response.games.is_none() {
        return Err(SteamError::PrivateLibrary);
    }
    let raw = payload.response.games.unwrap_or_default();
    let fetched = raw.len();
    let mut skipped = 0usize;
    let mut unique = BTreeMap::new();
    for item in raw {
        if let Some(game) = map_owned_game(item) {
            unique.insert(game.app_id, game);
        } else {
            skipped += 1;
        }
    }
    skipped += fetched.saturating_sub(skipped + unique.len());
    let warnings = if skipped > 0 { vec!["partial_records_skipped".to_string()] } else { Vec::new() };
    Ok(SteamOwnedGamesResult { games: unique.into_values().collect(), fetched, skipped, warnings })
}

fn map_owned_game(item: SteamOwnedGameApiItem) -> Option<super::SteamOwnedGame> {
    let app_id = item.appid?;
    let name = item.name?.trim().to_string();
    if app_id == 0 || name.is_empty() {
        return None;
    }
    Some(super::SteamOwnedGame {
        app_id,
        name,
        playtime_forever_minutes: item.playtime_forever.unwrap_or(0),
        playtime_two_weeks_minutes: item.playtime_2weeks,
        playtime_windows_minutes: item.playtime_windows_forever,
        playtime_mac_minutes: item.playtime_mac_forever,
        playtime_linux_minutes: item.playtime_linux_forever,
        last_played_unix: item.rtime_last_played.filter(|value| *value > 0),
        icon_hash: clean_hash(item.img_icon_url),
        logo_hash: clean_hash(item.img_logo_url),
    })
}

fn clean_hash(value: Option<String>) -> Option<String> {
    value.map(|item| item.trim().to_string()).filter(|item| !item.is_empty())
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

#[cfg(test)]
mod tests {
    use super::parse_owned_games_payload;
    use crate::steam::SteamError;

    #[test]
    fn parses_deduplicates_and_skips_partial_games() {
        let payload = r#"{"response":{"game_count":4,"games":[
          {"appid":10,"name":"Alpha","playtime_forever":120,"rtime_last_played":1700000000},
          {"appid":10,"name":"Alpha","playtime_forever":120},
          {"appid":0,"name":"Broken"},
          {"appid":20}
        ]}}"#;
        let result = parse_owned_games_payload(payload).expect("fixture should parse");
        assert_eq!(result.fetched, 4);
        assert_eq!(result.games.len(), 1);
        assert_eq!(result.skipped, 3);
        assert_eq!(result.games[0].app_id, 10);
    }

    #[test]
    fn accepts_empty_public_library() {
        let result = parse_owned_games_payload(r#"{"response":{"game_count":0}}"#)
            .expect("empty public library should parse");
        assert!(result.games.is_empty());
    }

    #[test]
    fn detects_private_library_and_invalid_json() {
        assert!(matches!(
            parse_owned_games_payload(r#"{"response":{}}"#),
            Err(SteamError::PrivateLibrary)
        ));
        assert!(matches!(
            parse_owned_games_payload("not-json"),
            Err(SteamError::InvalidResponse)
        ));
    }
}
