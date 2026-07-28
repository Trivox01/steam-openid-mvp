import type { Game, SteamOwnedGamesResult } from "../../types";
import { mergeSteamLibrary } from "./SteamLibraryMerge.ts";
import { steamArtworkUrls } from "./steamArtwork.ts";

const timestamp = "2026-01-02T03:04:05.000Z";

export function validateSteamLibrarySync() {
  const existing = createGame({
    favorite: true,
    hidden: true,
    status: "backlog",
    totalAchievements: 12,
    unlockedAchievements: 4,
    completionPercentage: 33
  });
  const remote: SteamOwnedGamesResult = {
    fetched: 4,
    skipped: 1,
    warnings: ["partial_records_skipped"],
    games: [
      gameDto(10, "Updated title", 180, 1_700_000_000),
      gameDto(10, "Duplicate", 180),
      gameDto(20, "New game", 0),
      gameDto(0, "", -1)
    ]
  };
  const result = mergeSteamLibrary([existing], remote, timestamp);
  assert(result.inserted === 1, "new game should be inserted");
  assert(result.updated === 1, "changed game should be updated");
  assert(result.skipped === 2, "duplicate and malformed rows should be skipped");
  const updated = result.changedGames.find((game) => game.appId === "10");
  assert(updated?.favorite === true && updated.hidden === true, "user flags must be preserved");
  assert(updated?.status === "backlog", "user status must be preserved");
  assert(updated?.totalAchievements === 12 && updated.unlockedAchievements === 4, "achievement state must be preserved");
  assert(updated?.name === "Updated title", "Steam name must replace an existing placeholder or stale title");
  assert(updated?.appId === "10", "Steam appid must become platformGameId");

  const unchangedRemote = {
    games: [gameDto(10, existing.name, existing.playtimeHours * 60)],
    fetched: 1,
    skipped: 0,
    warnings: []
  };
  const artwork = steamArtworkUrls(10);
  const normalizedExisting = { ...existing, coverUrl: artwork.coverUrl, backgroundUrl: artwork.backgroundUrl };
  const unchanged = mergeSteamLibrary([normalizedExisting], unchangedRemote, timestamp);
  assert(unchanged.unchanged === 1 && unchanged.changedGames.length === 0, "unchanged games must not be rewritten");
  const nullableRemote = {
    games: [{ ...gameDto(10, existing.name, existing.playtimeHours * 60), playtimeTwoWeeksMinutes: null }],
    fetched: 1,
    skipped: 0,
    warnings: []
  };
  const normalizedNulls = mergeSteamLibrary([normalizedExisting], nullableRemote, timestamp);
  assert(normalizedNulls.unchanged === 1, "Rust null optionals must normalize before equality checks");

  const empty = mergeSteamLibrary([existing], { games: [], fetched: 0, skipped: 0, warnings: [] }, timestamp);
  assert(empty.changedGames.length === 0, "empty remote library must not delete local games");
  assert(steamArtworkUrls(-1).coverUrl === "", "invalid app ids must not create URLs");
  assert(steamArtworkUrls(10, "../secret").iconUrl === "", "invalid hashes must not enter URLs");
  const artworkWithFallbacks = steamArtworkUrls(10, "abc123");
  assert(artworkWithFallbacks.coverUrl.includes("/10/library_600x900_2x.jpg"), "primary cover must be a vertical Steam library capsule");
  assert(artworkWithFallbacks.coverFallbackUrls.length === 2, "cover fallback chain must be available");
  assert(artworkWithFallbacks.coverFallbackUrls.every((url) => url.startsWith("https://")), "cover fallbacks must use HTTPS");
  assert(artworkWithFallbacks.iconUrl.includes("/10/abc123.jpg"), "icon hash must only build an icon URL");

  const secondSync = mergeSteamLibrary(
    result.changedGames,
    { ...remote, games: remote.games.filter((game) => game.appId > 0 && Boolean(game.name)) },
    timestamp
  );
  assert(secondSync.inserted === 0, "a second sync must not insert duplicate Steam games");
  return 20;
}

function createGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "existing",
    appId: "10",
    platform: "steam",
    name: "Existing",
    coverUrl: "",
    backgroundUrl: "",
    playtimeHours: 2,
    totalAchievements: 0,
    unlockedAchievements: 0,
    completionPercentage: 0,
    lastPlayedAt: "",
    ...overrides
  };
}

function gameDto(appId: number, name: string, playtimeForeverMinutes: number, lastPlayedUnix?: number) {
  return { appId, name, playtimeForeverMinutes, lastPlayedUnix };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Steam library validation failed: ${message}`);
}
