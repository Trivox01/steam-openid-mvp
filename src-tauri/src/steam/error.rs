#[derive(Debug)]
pub enum SteamError {
    InvalidSteamId,
    EmptyApiKey,
    InvalidApiKey,
    UserNotFound,
    ProfileUnavailable,
    NoInternet,
    Timeout,
    ApiUnavailable,
    InvalidResponse,
}

impl SteamError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidSteamId => "invalid_steam_id",
            Self::EmptyApiKey => "empty_api_key",
            Self::InvalidApiKey => "invalid_api_key",
            Self::UserNotFound => "user_not_found",
            Self::ProfileUnavailable => "profile_unavailable",
            Self::NoInternet => "no_internet",
            Self::Timeout => "timeout",
            Self::ApiUnavailable => "steam_api_unavailable",
            Self::InvalidResponse => "invalid_response",
        }
    }

    pub fn user_message(&self) -> &'static str {
        match self {
            Self::InvalidSteamId => "Enter a valid 17-digit SteamID64.",
            Self::EmptyApiKey => "Enter your Steam Web API key.",
            Self::InvalidApiKey => "Steam rejected the Web API key. Check the key and try again.",
            Self::UserNotFound => "No Steam user was found for this SteamID64.",
            Self::ProfileUnavailable => "The Steam profile is unavailable or cannot be read.",
            Self::NoInternet => "Achievement Nexus could not reach Steam. Check your internet connection.",
            Self::Timeout => "Steam took too long to respond. Try again in a moment.",
            Self::ApiUnavailable => "Steam Web API is currently unavailable.",
            Self::InvalidResponse => "Steam returned an unexpected response.",
        }
    }
}
