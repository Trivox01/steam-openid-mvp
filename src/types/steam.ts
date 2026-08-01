export type SteamProfile = {
  steamId: string;
  personaName: string;
  profileUrl: string;
  avatarUrl: string;
  avatarMediumUrl: string;
  avatarFullUrl: string;
  personaState?: number;
  lastLogoff?: number;
  visibilityState: number;
};

export type SteamOwnedGameDto = {
  appId: number;
  name: string;
  playtimeForeverMinutes: number;
  playtimeTwoWeeksMinutes?: number | null;
  playtimeWindowsMinutes?: number | null;
  playtimeMacMinutes?: number | null;
  playtimeLinuxMinutes?: number | null;
  lastPlayedUnix?: number | null;
  iconHash?: string | null;
  logoHash?: string | null;
};

export type SteamOwnedGamesResult = {
  games: SteamOwnedGameDto[];
  fetched: number;
  skipped: number;
  warnings: string[];
};

export type SteamLibrarySyncResult = {
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  syncedAt: string;
  warnings: string[];
};

export type SteamAchievementDto = {
  apiName: string;
  displayName: string;
  description: string;
  hidden: boolean;
  iconUrl: string;
  lockedIconUrl: string;
  unlocked: boolean;
  unlockedAt?: string;
  globalUnlockPercent?: number;
};

export type SteamGameAchievementsDto = {
  appId: number;
  gameName: string;
  achievements: SteamAchievementDto[];
  warnings: string[];
  fetchedAt: string;
};

export type SteamAchievementGameSyncResult = {
  gameId: string;
  appId: string;
  gameName: string;
  status: "success" | "partial" | "unsupported" | "failed";
  achievementsFetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  warnings: string[];
  errorCode?: string;
};

export type SteamAchievementSyncResult = {
  gamesRequested: number;
  gamesSucceeded: number;
  gamesUnsupported: number;
  gamesFailed: number;
  achievementsFetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  partial: boolean;
  syncedAt: string;
  warnings: string[];
  games: SteamAchievementGameSyncResult[];
};
