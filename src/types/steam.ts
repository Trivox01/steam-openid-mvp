export type SteamCredentials = {
  steamId: string;
  apiKey: string;
};

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

export type SteamConnectionStatus =
  | "disconnected"
  | "validating"
  | "connected"
  | "error";

export type SteamConnectionResult = {
  success: boolean;
  profile?: SteamProfile;
  errorCode?: string;
  userMessage?: string;
};

export type SteamOwnedGameDto = {
  appId: number;
  name: string;
  playtimeForeverMinutes: number;
  playtimeTwoWeeksMinutes?: number;
  playtimeWindowsMinutes?: number;
  playtimeMacMinutes?: number;
  playtimeLinuxMinutes?: number;
  lastPlayedUnix?: number;
  iconHash?: string;
  logoHash?: string;
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
