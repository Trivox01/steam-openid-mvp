# Steam Achievements Sync v1

## Data flow

The React UI calls `SteamAchievementSyncService` through the composition root.
The service selects a bounded set of local Steam games, invokes `SteamProvider`,
and stores normalized achievements through `AchievementRepository`. React never
invokes Tauri directly.

`TauriSteamGateway` calls `steam_get_game_achievements`. Rust reads the saved
SteamID64 from SQLite and the API key from `SecretStore` process memory.
Credentials and raw Steam payloads are never returned to TypeScript.

## Steam endpoints

For each game Rust combines:

- `ISteamUserStats/GetSchemaForGame/v2` for API names, display text, hidden state,
  and unlocked/locked icons.
- `ISteamUserStats/GetPlayerAchievements/v1` for the player's unlock state and
  unlock timestamp.
- `ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2` for global rarity.

Records are matched by achievement `apiName`, never by response order.

## Partial synchronization

Schema is required. A missing schema or an empty achievement list classifies the
game as unsupported/no achievements. Private player stats fail that game without
failing the rest of the batch.

Global percentages are optional. Their failure adds a warning while schema and
player state are still saved. Missing player data in an otherwise parseable
response is marked partial: existing unlock state is preserved, and new records
are stored with `unlockStateKnown=false`. Partial data never resets game
completion counters.

Malformed records, duplicate API names, invalid timestamps, and percentages
outside `0..100` are skipped or converted to absent values with warning codes.
No fabricated description, timestamp, progress, or rarity is generated.

## Upsert rules

The logical key is `(local game id, source=steam, external id=apiName)`.
Migration 005 adds Steam-owned fields and an index without deleting or rebuilding
existing achievement data.

Steam may update:

- display name and description;
- hidden state and icons;
- unlock state and timestamp;
- global unlock percentage;
- synchronization timestamp.

Existing record IDs and unknown user-owned fields are preserved by object merge.
Achievements absent from a response are never deleted in v1.

## Concurrency and rate limiting

Manual library synchronization processes at most 20 eligible games per action
with concurrency limited to 2. Duplicate App IDs are removed before requests.
Every Rust request uses the existing 12-second HTTP client timeout. A failed or
unsupported game produces a per-game result and does not abort other games.
There is no polling, automatic retry loop, startup sync, or background sync.

## Intelligence integration

After a completed batch the UI publishes one data revision. Achievement Journey
then reloads persisted games and achievements. The adapter supplies real totals,
unlock state, recent dated unlocks, and known global rarity to the intelligence
engine. Unknown rarity is `null`, not zero, and achievements with unknown player
state are excluded from achievement-level recommendations.

## Privacy

The API key remains in Rust memory only and must be entered again after an
application restart. It is not stored in SQLite, logged, placed in an error, or
sent back to JavaScript. Full request URLs and raw API responses are not logged.

## v1 limits

- Manual sync only.
- English Steam schema text is requested; names are stored exactly as returned.
- No achievement progress counters beyond unlocked/locked.
- No deletion policy for removed Steam achievements.
- No cloud sync, background sync, auto sync, or AI processing.
- Retry is manual and limited to games that failed in the previous UI result.
