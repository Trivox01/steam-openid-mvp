# Discord Rich Presence

Achievement Nexus uses local Discord Rich Presence only. It does not use Discord OAuth, a bot, account linking, access tokens, or remote Discord APIs.

## Build configuration

The public Discord Application ID is baked into desktop builds in `src-tauri/src/config/discord.rs`. Production executables installers work without any environment setup. During development, the `DISCORD_APPLICATION_ID` environment variable still overrides the built-in ID for experiments and CI; an invalid or missing override falls back to the built-in value. Builds always remain fully functional and keep Discord sharing off until the user enables it in Settings.

Before producing a configured build:

1. Create the Achievement Nexus application in the Discord Developer Portal.
2. Upload the static Achievement Nexus logo as a Rich Presence asset with the key `nexus_logo`.
3. Publish the resulting Application ID as the `APPLICATION_ID` constant in `src-tauri/src/config/discord.rs`.

The Application ID is public configuration, not a credential. Never add Discord tokens or OAuth credentials; this integration does not need them.

## Dependency decision

The desktop uses `discord-presence` 3.2 under the MIT license. It is a Rust-native local IPC client with Windows support, connection events, and a built-in queued activity rate limiter. It adds no JavaScript server, async runtime, browser permissions, or network dependency at runtime. The manager limits retries to six attempts with a five-second backoff, then waits for a meaningful application event or a five-minute quiet retry window before trying again.

## Data boundary

Rust constructs the final activity from the confirmed local game session and locally saved game metadata. The frontend can only submit typed privacy settings or request a refresh; it cannot submit activity text, URLs, buttons, or arbitrary payload fields.

The activity may contain only:

- the game name, when allowed;
- saved achievement counts, when valid and allowed;
- the confirmed session start timestamp, when allowed;
- the static `nexus_logo` asset and `Achievement Nexus` label.

No dynamic Steam artwork or Discord buttons are used.

## Protocol metadata boundary

Discord's documented local `SET_ACTIVITY` command requires the application's operating-system process ID in the command envelope. `discord-presence` supplies that required value internally. It is not included in `ActivitySpec`, visible Rich Presence fields, settings, diagnostics, or Nexus logs, and React cannot access or submit it.

If the product requirement to never send a process ID also covers Discord's mandatory local protocol envelope, the transport must remain unconfigured: that stricter requirement cannot be met by the documented Discord RPC command. This decision must be resolved before enabling a production Discord Application ID.
