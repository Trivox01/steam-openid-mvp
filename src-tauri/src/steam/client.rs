use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::{Client, StatusCode};
use std::collections::BTreeMap;

use super::{
    models::{SteamApiResponse, SteamGlobalAchievementsResponse, SteamOwnedGameApiItem, SteamOwnedGamesApiResponse, SteamOwnedGamesResult, SteamPlayerAchievementsResponse, SteamSchemaResponse, SteamProfile},
    SteamError,
};

const PLAYER_SUMMARIES_ENDPOINT: &str =
    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/";
const OWNED_GAMES_ENDPOINT: &str =
    "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";
const GAME_SCHEMA_ENDPOINT: &str =
    "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/";
const PLAYER_ACHIEVEMENTS_ENDPOINT: &str =
    "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/";
const GLOBAL_ACHIEVEMENTS_ENDPOINT: &str =
    "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/";

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
            .query(&owned_games_query(steam_id, api_key))
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

    pub async fn get_game_achievements(
        &self,
        steam_id: &str,
        api_key: &str,
        app_id: u32,
    ) -> Result<super::SteamGameAchievements, SteamError> {
        validate_steam_id(steam_id)?;
        if api_key.trim().is_empty() { return Err(SteamError::ApiKeyUnavailable); }
        if app_id == 0 { return Err(SteamError::InvalidAppId); }
        let app_id_text = app_id.to_string();

        let schema_text = self.get_text(
            GAME_SCHEMA_ENDPOINT,
            &[("key", api_key.trim()), ("appid", &app_id_text), ("l", "english")],
            app_id,
            "GetSchemaForGame/v2",
        ).await?;
        let player_text = self.get_text(
            PLAYER_ACHIEVEMENTS_ENDPOINT,
            &[("key", api_key.trim()), ("steamid", steam_id), ("appid", &app_id_text), ("l", "english")],
            app_id,
            "GetPlayerAchievements/v1",
        ).await?;
        let global_text = self.get_text(
            GLOBAL_ACHIEVEMENTS_ENDPOINT,
            &[("gameid", &app_id_text)],
            app_id,
            "GetGlobalAchievementPercentagesForApp/v2",
        ).await.ok();
        merge_achievement_payloads(app_id, &schema_text, &player_text, global_text.as_deref())
    }

    async fn get_text(
        &self,
        endpoint: &str,
        query: &[(&str, &str)],
        app_id: u32,
        operation: &'static str,
    ) -> Result<String, SteamError> {
        let started = Instant::now();
        let response = match self.http.get(endpoint).query(query).send().await {
            Ok(response) => response,
            Err(error) => {
                let mapped = map_request_error(error);
                log_steam_request(app_id, operation, None, mapped.code(), started.elapsed());
                return Err(mapped);
            }
        };
        let status = response.status();
        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                log_steam_request(app_id, operation, Some(status.as_u16()), "invalid_api_key", started.elapsed());
                return Err(SteamError::InvalidApiKey);
            }
            StatusCode::TOO_MANY_REQUESTS => {
                log_steam_request(app_id, operation, Some(status.as_u16()), "rate_limited", started.elapsed());
                return Err(SteamError::RateLimited);
            }
            StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND => {
                let error = map_achievement_http_error(operation, status);
                log_steam_request(app_id, operation, Some(status.as_u16()), error.code(), started.elapsed());
                return Err(error);
            }
            status if !status.is_success() => {
                log_steam_request(app_id, operation, Some(status.as_u16()), "steam_api_unavailable", started.elapsed());
                return Err(SteamError::ApiUnavailable);
            }
            _ => {}
        }
        let result = response.text().await.map_err(|_| SteamError::InvalidResponse);
        log_steam_request(
            app_id,
            operation,
            Some(status.as_u16()),
            if result.is_ok() { "success" } else { "invalid_response" },
            started.elapsed(),
        );
        result
    }
}

fn owned_games_query<'a>(steam_id: &'a str, api_key: &'a str) -> [(&'static str, &'a str); 5] {
    [
        ("key", api_key.trim()),
        ("steamid", steam_id),
        ("include_appinfo", "true"),
        ("include_played_free_games", "true"),
        ("format", "json"),
    ]
}

pub(crate) fn merge_achievement_payloads(
    app_id: u32,
    schema_payload: &str,
    player_payload: &str,
    global_payload: Option<&str>,
) -> Result<super::SteamGameAchievements, SteamError> {
    let schema: SteamSchemaResponse = serde_json::from_str(schema_payload).map_err(|_| SteamError::InvalidResponse)?;
    let game = schema.game.ok_or(SteamError::SchemaUnavailable)?;
    let schema_items = game.available_game_stats.and_then(|stats| stats.achievements).unwrap_or_default();
    if schema_items.is_empty() { return Err(SteamError::NoAchievements); }

    let player: SteamPlayerAchievementsResponse =
        serde_json::from_str(player_payload).map_err(|_| SteamError::InvalidResponse)?;
    let mut warnings = Vec::new();
    let player_items = match player.playerstats {
        Some(stats) if !stats.success && stats.error.is_some() => {
            let error = stats.error.unwrap_or_default().to_ascii_lowercase();
            return Err(if error.contains("requested app has no stats")
                || error.contains("user has no stats")
                || error.contains("no stats")
            {
                SteamError::NoPlayerStats
            } else if error.contains("does not own") || error.contains("not own") {
                SteamError::GameNotOwned
            } else {
                SteamError::PrivateLibrary
            });
        }
        Some(stats) if stats.success => stats.achievements.unwrap_or_default(),
        _ => {
            warnings.push("player_stats_unavailable".to_string());
            Vec::new()
        }
    };
    let player_by_name: BTreeMap<String, _> = player_items.into_iter()
        .filter_map(|item| item.apiname.clone().map(|name| (name, item)))
        .collect();

    let mut global_by_name = BTreeMap::new();
    if let Some(payload) = global_payload {
        match serde_json::from_str::<SteamGlobalAchievementsResponse>(payload) {
            Ok(response) => {
                for item in response.achievementpercentages.and_then(|list| list.achievements).unwrap_or_default() {
                    if let (Some(name), Some(percent)) = (item.name, item.percent) {
                        if percent.is_finite() && (0.0..=100.0).contains(&percent) {
                            global_by_name.insert(name, percent);
                        } else {
                            warnings.push("invalid_global_percentage".to_string());
                        }
                    }
                }
            }
            Err(_) => warnings.push("global_percentages_unavailable".to_string()),
        }
    } else {
        warnings.push("global_percentages_unavailable".to_string());
    }

    let mut unique = BTreeMap::new();
    for schema_item in schema_items {
        let Some(api_name) = schema_item.name.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) else {
            warnings.push("partial_schema_record".to_string());
            continue;
        };
        if unique.contains_key(&api_name) {
            warnings.push("duplicate_api_name".to_string());
            continue;
        }
        let player_item = player_by_name.get(&api_name);
        let unlocked = player_item.map(|item| item.achieved > 0).unwrap_or(false);
        let unlocked_at = player_item.and_then(|item| {
            if unlocked && item.unlocktime > 0 { unix_timestamp_to_iso(item.unlocktime) } else { None }
        });
        if unlocked && player_item.is_some_and(|item| item.unlocktime > 0) && unlocked_at.is_none() {
            warnings.push("invalid_unlock_time".to_string());
        }
        unique.insert(api_name.clone(), super::SteamAchievement {
            api_name: api_name.clone(),
            display_name: if schema_item.display_name.trim().is_empty() { api_name.clone() } else { schema_item.display_name },
            description: schema_item.description,
            hidden: schema_item.hidden != 0,
            icon_url: schema_item.icon,
            locked_icon_url: schema_item.icongray,
            unlocked,
            unlocked_at,
            global_unlock_percent: global_by_name.get(&api_name).copied(),
        });
    }
    if unique.is_empty() { return Err(SteamError::NoAchievements); }
    warnings.sort();
    warnings.dedup();
    let fetched_at = unix_timestamp_to_iso(
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
    ).unwrap_or_default();
    Ok(super::SteamGameAchievements {
        app_id,
        game_name: game.game_name,
        achievements: unique.into_values().collect(),
        warnings,
        fetched_at,
    })
}

fn unix_timestamp_to_iso(value: i64) -> Option<String> {
    if !(1..=253_402_300_799).contains(&value) { return None; }
    // SQLite and JavaScript accept this stable UTC representation; avoid adding a date dependency.
    let days = value.div_euclid(86_400);
    let seconds = value.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    Some(format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", seconds / 3600, (seconds % 3600) / 60, seconds % 60))
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    (year, month, day)
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

fn map_achievement_http_error(operation: &str, status: StatusCode) -> SteamError {
    if operation == "GetSchemaForGame/v2" {
        if status == StatusCode::BAD_REQUEST {
            SteamError::InvalidAppId
        } else {
            SteamError::SchemaUnavailable
        }
    } else if operation == "GetPlayerAchievements/v1" {
        SteamError::NoPlayerStats
    } else {
        SteamError::GameUnsupported
    }
}

#[cfg(debug_assertions)]
fn log_steam_request(
    app_id: u32,
    operation: &str,
    http_status: Option<u16>,
    outcome: &str,
    duration: Duration,
) {
    eprintln!(
        "[steam-achievements] app_id={} operation={} http_status={} outcome={} duration_ms={}",
        app_id,
        operation,
        http_status.map_or_else(|| "none".to_string(), |value| value.to_string()),
        outcome,
        duration.as_millis()
    );
}

#[cfg(not(debug_assertions))]
fn log_steam_request(_: u32, _: &str, _: Option<u16>, _: &str, _: Duration) {}

#[cfg(test)]
mod tests {
    use reqwest::StatusCode;
    use super::{map_achievement_http_error, merge_achievement_payloads, owned_games_query, parse_owned_games_payload};
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
    fn owned_games_query_requests_official_names_and_free_games() {
        let query = owned_games_query("76561198000000000", " secret ");
        assert!(query.contains(&("key", "secret")));
        assert!(query.contains(&("steamid", "76561198000000000")));
        assert!(query.contains(&("include_appinfo", "true")));
        assert!(query.contains(&("include_played_free_games", "true")));
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

    #[test]
    fn merges_achievement_sources_by_api_name_and_sanitizes_values() {
        let schema = r#"{"game":{"gameName":"Fixture","availableGameStats":{"achievements":[
          {"name":"A_TWO","displayName":"Second","description":"Two","hidden":0,"icon":"two.png","icongray":"two-gray.png"},
          {"name":"A_ONE","displayName":"First","description":"One","hidden":1,"icon":"one.png","icongray":"one-gray.png"},
          {"name":"A_ONE","displayName":"Duplicate"}
        ]}}}"#;
        let player = r#"{"playerstats":{"success":true,"achievements":[
          {"apiname":"A_ONE","achieved":1,"unlocktime":1700000000},
          {"apiname":"A_TWO","achieved":0,"unlocktime":0}
        ]}}"#;
        let global = r#"{"achievementpercentages":{"achievements":[
          {"name":"A_TWO","percent":101},
          {"name":"A_ONE","percent":2.5}
        ]}}"#;
        let result = merge_achievement_payloads(10, schema, player, Some(global)).expect("fixtures should merge");
        assert_eq!(result.achievements.len(), 2);
        let first = result.achievements.iter().find(|item| item.api_name == "A_ONE").unwrap();
        assert!(first.unlocked);
        assert!(first.hidden);
        assert_eq!(first.global_unlock_percent, Some(2.5));
        assert!(result.warnings.contains(&"duplicate_api_name".to_string()));
        assert!(result.warnings.contains(&"invalid_global_percentage".to_string()));
    }

    #[test]
    fn handles_no_achievements_private_and_partial_sources() {
        let empty_schema = r#"{"game":{"gameName":"Empty","availableGameStats":{}}}"#;
        assert!(matches!(
            merge_achievement_payloads(20, empty_schema, r#"{"playerstats":{"success":true}}"#, None),
            Err(SteamError::NoAchievements)
        ));
        let schema = r#"{"game":{"gameName":"Game","availableGameStats":{"achievements":[{"name":"A","displayName":"A"}]}}}"#;
        assert!(matches!(
            merge_achievement_payloads(20, schema, r#"{"playerstats":{"success":false,"error":"Profile is not public"}}"#, None),
            Err(SteamError::PrivateLibrary)
        ));
        assert!(matches!(
            merge_achievement_payloads(20, schema, r#"{"playerstats":{"success":false,"error":"User does not own this game"}}"#, None),
            Err(SteamError::GameNotOwned)
        ));
        assert!(matches!(
            merge_achievement_payloads(20, schema, r#"{"playerstats":{"success":false,"error":"Requested app has no stats"}}"#, None),
            Err(SteamError::NoPlayerStats)
        ));
        assert!(matches!(
            merge_achievement_payloads(20, r#"{"game":null}"#, r#"{"playerstats":{"success":true}}"#, None),
            Err(SteamError::SchemaUnavailable)
        ));
        assert!(matches!(
            merge_achievement_payloads(20, "malformed", r#"{"playerstats":{"success":true}}"#, None),
            Err(SteamError::InvalidResponse)
        ));
        let partial = merge_achievement_payloads(20, schema, "{}", None).expect("missing player stats is partial");
        assert!(!partial.achievements[0].unlocked);
        assert!(partial.warnings.contains(&"player_stats_unavailable".to_string()));
        assert!(partial.warnings.contains(&"global_percentages_unavailable".to_string()));
    }

    #[test]
    fn classifies_invalid_app_and_endpoint_specific_http_failures() {
        assert!(matches!(
            map_achievement_http_error("GetSchemaForGame/v2", StatusCode::BAD_REQUEST),
            SteamError::InvalidAppId
        ));
        assert!(matches!(
            map_achievement_http_error("GetSchemaForGame/v2", StatusCode::NOT_FOUND),
            SteamError::SchemaUnavailable
        ));
        assert!(matches!(
            map_achievement_http_error("GetPlayerAchievements/v1", StatusCode::BAD_REQUEST),
            SteamError::NoPlayerStats
        ));
        assert!(matches!(
            map_achievement_http_error("GetGlobalAchievementPercentagesForApp/v2", StatusCode::NOT_FOUND),
            SteamError::GameUnsupported
        ));
    }
}
