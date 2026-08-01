import type { Game } from "./index";

export type LibraryFilter = "all" | "tracked" | "recent" | "hasAchievements" | "noAchievementData" | "completed" | "incomplete" | "hidden";
export type LibrarySort = "smart" | "recent" | "playtime" | "completion" | "nameAsc" | "nameDesc" | "synced" | "tracked";
export interface LibraryQuery { search: string; filter: LibraryFilter; sort: LibrarySort; offset: number; limit: number; }
export interface LibraryPage { games: Game[]; total: number; offset: number; limit: number; }
