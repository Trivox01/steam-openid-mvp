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
