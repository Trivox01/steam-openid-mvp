# Steam Library Sync v1

Achievement Nexus imports the connected player's owned-game library through
Steam Web API `IPlayerService/GetOwnedGames/v1`.

## Security boundary

- The React UI sends the API key only while connecting the account.
- Rust keeps the key in process memory through `SecretStore`; it is never written
  to SQLite, returned to JavaScript, logged, or included in command errors.
- After an application restart, the user reconnects before syncing because the
  in-memory key is intentionally gone.

## Data flow

`SteamAccountSettings` calls `SteamLibrarySyncService` through the composition
root. The service asks `SteamProvider`, which calls the Tauri gateway and the
Rust `steam_get_owned_games` command. Rust validates the saved SteamID64 and
in-memory key, calls Steam with a bounded timeout, parses and deduplicates the
response, and returns a safe DTO.

The application service merges by `(platform, appId)`. Steam-owned fields such
as title, artwork, playtime, and last-played time are updated. Local fields
including favorite, hidden, status, and achievement progress are preserved.
Missing remote games are never deleted.

## Errors and counters

The command exposes stable codes for missing credentials, invalid key, private
library, rate limiting, network failure, timeout, and invalid responses. The UI
translates these codes without displaying response bodies or secrets.

Each successful result reports fetched, inserted, updated, unchanged, skipped,
and failed counts. The last successful sync timestamp is stored in
`sync_metadata`.

## Scope

This version is manual and one-shot. It does not poll, synchronize achievements,
run in the background, or persist analysis results.
