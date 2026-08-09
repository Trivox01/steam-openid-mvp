pub const APPLICATION_ID: u64 = 1535813475257950319;

pub fn configured_application_id() -> Option<u64> {
    application_id_from(
        std::env::var("DISCORD_APPLICATION_ID").ok(),
        Some(APPLICATION_ID),
    )
}

fn application_id_from(env_override: Option<String>, builtin: Option<u64>) -> Option<u64> {
    env_override
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .or(builtin.filter(|value| *value > 0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_application_id_is_a_positive_numeric_snowflake() {
        let digits = APPLICATION_ID.to_string();
        assert!(digits.chars().all(|c| c.is_ascii_digit()));
        assert!((17..=19).contains(&digits.len()), "snowflake length");
        assert!(APPLICATION_ID > 0);
    }

    #[test]
    fn environment_override_takes_precedence_over_builtin() {
        let override_value = "1535813460000000000".to_string();
        assert_eq!(
            application_id_from(Some(override_value.clone()), Some(APPLICATION_ID)),
            Some(1535813460000000000)
        );
    }

    #[test]
    fn invalid_environment_value_falls_back_to_builtin() {
        for invalid in ["not-a-number", "", "0", "-5", " 12.5 "] {
            assert_eq!(
                application_id_from(Some(invalid.to_string()), Some(APPLICATION_ID)),
                Some(APPLICATION_ID),
                "unexpected result for {invalid:?}"
            );
        }
        assert_eq!(
            application_id_from(Some(" 1535813460000000000 ".to_string()), Some(APPLICATION_ID)),
            Some(1535813460000000000),
            "whitespace is trimmed"
        );
    }

    #[test]
    fn no_id_anywhere_yields_none() {
        assert_eq!(application_id_from(None, None), None);
        assert_eq!(application_id_from(Some("junk".to_string()), None), None);
    }
}
