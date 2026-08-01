import type { Game } from "../types";
import type { LibraryPage, LibraryQuery } from "../types/library";

export const SMART_LIBRARY_WEIGHTS = Object.freeze({ tracked: 10_000, opened: 2_000, recent: 1_000, nearComplete: 500, synced: 100 });

export function smartScore(game: Game, now = Date.now()) {
  const ageDays = (value?: string) => value ? Math.max(0, (now - new Date(value).getTime()) / 86_400_000) : Number.POSITIVE_INFINITY;
  return (game.tracked ? SMART_LIBRARY_WEIGHTS.tracked : 0)
    + Math.max(0, SMART_LIBRARY_WEIGHTS.opened - ageDays(game.lastOpenedAt) * 30)
    + Math.max(0, SMART_LIBRARY_WEIGHTS.recent - ageDays(game.lastPlayedAt) * 10)
    + (game.completionPercentage >= 70 && game.completionPercentage < 100 ? SMART_LIBRARY_WEIGHTS.nearComplete : 0)
    + Math.max(0, SMART_LIBRARY_WEIGHTS.synced - ageDays(game.syncedAt));
}

export function compareSmartGames(a: Game, b: Game) {
  return smartScore(b) - smartScore(a)
    || timestamp(b.lastPlayedAt) - timestamp(a.lastPlayedAt)
    || b.playtimeHours - a.playtimeHours
    || a.name.localeCompare(b.name)
    || a.appId.localeCompare(b.appId);
}

export function queryGamesInMemory(source: Game[], query: LibraryQuery): LibraryPage {
  const needle = query.search.trim().toLocaleLowerCase();
  const games = source.filter((game) => (!needle || game.name.toLocaleLowerCase().includes(needle) || game.appId.includes(needle)) && matches(game, query.filter));
  games.sort((a, b) => compare(a, b, query.sort));
  return { games: structuredClone(games.slice(query.offset, query.offset + query.limit)), total: games.length, offset: query.offset, limit: query.limit };
}

function matches(game: Game, filter: LibraryQuery["filter"]) {
  if (filter === "tracked") return Boolean(game.tracked);
  if (filter === "recent") return Boolean(game.lastPlayedAt);
  if (filter === "hasAchievements") return game.totalAchievements > 0;
  if (filter === "noAchievementData") return game.totalAchievements === 0;
  if (filter === "completed") return game.totalAchievements > 0 && game.completionPercentage >= 100;
  if (filter === "incomplete") return game.totalAchievements > 0 && game.completionPercentage < 100;
  if (filter === "hidden") return Boolean(game.hidden);
  return !game.hidden;
}
function compare(a: Game, b: Game, sort: LibraryQuery["sort"]) {
  if (sort === "recent") return timestamp(b.lastPlayedAt) - timestamp(a.lastPlayedAt);
  if (sort === "playtime") return b.playtimeHours - a.playtimeHours;
  if (sort === "completion") return b.completionPercentage - a.completionPercentage;
  if (sort === "nameAsc" || sort === "nameDesc") return a.name.localeCompare(b.name) * (sort === "nameDesc" ? -1 : 1);
  if (sort === "synced") return timestamp(b.syncedAt) - timestamp(a.syncedAt);
  if (sort === "tracked") return Number(Boolean(b.tracked)) - Number(Boolean(a.tracked)) || compareSmartGames(a, b);
  return compareSmartGames(a, b);
}
const timestamp = (value?: string) => value ? new Date(value).getTime() || 0 : 0;
