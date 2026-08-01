# Steam artwork pipeline

This document records the desktop artwork contract. It deliberately contains no game-specific routing.

| Surface | Expected artwork | Component/helper | Primary pattern | Bounded fallback | Persistence |
| --- | --- | --- | --- | --- | --- |
| Games Library grid/list and filtered search | Portrait cover | `GameCard` / `steamArtworkSources(kind: "cover")` | `library_600x900_2x.jpg` | `library_600x900.jpg` → `header.jpg` crop → `library_hero.jpg` crop → app icon | `cover_url` and `icon_url` in SQLite; generated alternatives from AppID |
| Game Details background | Wide hero | `GameArtwork` / `steamArtworkSources(kind: "hero")` | `library_hero.jpg` | `header.jpg` → `capsule_616x353.jpg` | `background_url` in SQLite; generated alternatives from AppID |
| Game Details game tile | Square | `GameArtwork` / `steamArtworkSources(kind: "square")` | app icon hash | `logo.png` → `capsule_231x87.jpg` crop → `library_hero.jpg` crop → `header.jpg` crop | `icon_url` in SQLite; generated alternatives from AppID |
| Dashboard game card | Portrait cover | shared `GameArtwork` / cover chain | Same as Library | Same as Library | Same game record |
| Statistics game rows | Portrait cover | shared `GameArtwork` / cover chain | Same as Library | Same as Library | Same game record |
| Achievement cards/dialogs and recommended achievement | Achievement icon, not game artwork | achievement components / `GameArtwork` where applicable | Backend achievement `iconUrl` or `lockedIconUrl` | Component placeholder | Achievement row in SQLite |

## Source lifecycle

1. Steam `GetOwnedGames` returns AppID, name, playtime, and optional icon/logo hashes. It does not return Store cover or hero URLs.
2. The Backend DTO preserves those bounded fields. The Game Details achievement endpoint does not provide game artwork.
3. Desktop generates Store asset candidates from the numeric AppID and maps a validated icon hash to the Steam Community image URL.
4. SQLite stores the canonical portrait, hero, and app-icon URL. Migration 008 normalizes the retired redirect origin without deleting rows or user flags.
5. Every game-art surface uses `GameArtwork`; list images are lazy, the visible details hero/tile are eager, and all use async decoding.
6. HTTP success is not sufficient. Steam can return a valid, uniform placeholder JPEG/PNG. Steam candidates are sampled through a CORS-enabled canvas; visually empty assets advance to the next bounded candidate.
7. Failure of an optional artwork candidate is never a Smart Sync or Application Refresh failure. Exhausting the chain shows a fixed-ratio Nexus placeholder.

## Development diagnostics

For each attempt, `GameArtwork` reports AppID, artwork kind, requested URL, browser-visible final URL, source marker, CSP allowlist result, component, and reason. HTTP status and response Content-Type are explicitly marked unavailable inside WebView because image elements do not expose them; external probes are used during investigation. No token, SteamID, or secret is logged.
