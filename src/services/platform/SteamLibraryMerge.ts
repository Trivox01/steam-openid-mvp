import type { Game, SteamOwnedGameDto, SteamOwnedGamesResult } from "../../types";
import { steamArtworkUrls } from "./steamArtwork.ts";

export function mergeSteamLibrary(local: Game[], remote: SteamOwnedGamesResult, syncedAt: string) {
  const byExternalId = new Map(local.filter((game) => game.platform === "steam").map((game) => [game.appId, game]));
  const seen = new Set<string>();
  const changedGames: Game[] = [];
  let inserted = 0, updated = 0, unchanged = 0, skipped = 0;
  for (const item of remote.games) {
    const appId = String(item.appId);
    if (!isValidSteamGame(item) || seen.has(appId)) { skipped += 1; continue; }
    seen.add(appId);
    const existing = byExternalId.get(appId);
    const next = mapSteamGame(item, existing, syncedAt);
    if (!existing) { changedGames.push(next); inserted += 1; }
    else if (providerFieldsEqual(existing, next)) unchanged += 1;
    else { changedGames.push(next); updated += 1; }
  }
  return { changedGames, inserted, updated, unchanged, skipped };
}

function mapSteamGame(item: SteamOwnedGameDto, existing: Game | undefined, syncedAt: string): Game {
  const artwork = steamArtworkUrls(item.appId, item.iconHash);
  return {
    id: existing?.id ?? `steam:${item.appId}`, appId: String(item.appId), platform: "steam",
    name: item.name.trim(), coverUrl: artwork.coverUrl, backgroundUrl: artwork.backgroundUrl,
    iconUrl: artwork.iconUrl || existing?.iconUrl, playtimeHours: item.playtimeForeverMinutes / 60,
    playtimeTwoWeeksMinutes: item.playtimeTwoWeeksMinutes, playtimeWindowsMinutes: item.playtimeWindowsMinutes,
    playtimeMacMinutes: item.playtimeMacMinutes, playtimeLinuxMinutes: item.playtimeLinuxMinutes,
    totalAchievements: existing?.totalAchievements ?? 0, unlockedAchievements: existing?.unlockedAchievements ?? 0,
    completionPercentage: existing?.completionPercentage ?? 0,
    lastPlayedAt: unixToIso(item.lastPlayedUnix) || existing?.lastPlayedAt || "", syncedAt,
    favorite: existing?.favorite ?? false, hidden: existing?.hidden ?? false,
    status: existing?.status ?? (item.playtimeForeverMinutes > 0 ? "playing" : "notStarted")
  };
}

function providerFieldsEqual(a: Game, b: Game) {
  return a.name === b.name && a.coverUrl === b.coverUrl && a.backgroundUrl === b.backgroundUrl &&
    a.iconUrl === b.iconUrl && a.playtimeHours === b.playtimeHours &&
    a.playtimeTwoWeeksMinutes === b.playtimeTwoWeeksMinutes &&
    a.playtimeWindowsMinutes === b.playtimeWindowsMinutes && a.playtimeMacMinutes === b.playtimeMacMinutes &&
    a.playtimeLinuxMinutes === b.playtimeLinuxMinutes && a.lastPlayedAt === b.lastPlayedAt;
}

function isValidSteamGame(item: SteamOwnedGameDto) {
  return Number.isSafeInteger(item.appId) && item.appId > 0 && typeof item.name === "string" &&
    item.name.trim().length > 0 && Number.isFinite(item.playtimeForeverMinutes) && item.playtimeForeverMinutes >= 0;
}

function unixToIso(value?: number) {
  if (!value || !Number.isFinite(value) || value < 0) return "";
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
