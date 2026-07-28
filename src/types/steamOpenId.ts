export type SteamOpenIdFinalStatus =
  | "verified"
  | "expired"
  | "failed"
  | "cancelled";

export type SteamOpenIdStatus =
  | { status: "pending" }
  | {
      status: "verified";
      steamId: string;
      authenticatedAt: string;
      sessionToken: string;
      sessionExpiresAt: string;
    }
  | { status: "expired" | "cancelled" }
  | { status: "failed"; errorCode?: string };

export interface SteamOpenIdIdentity {
  steamId: string;
  authenticatedAt: string;
  authMethod: "steam_openid";
}

export interface SteamOpenIdDesktopState {
  deviceId: string;
  identity?: SteamOpenIdIdentity;
}

export interface SteamOpenIdStartResult {
  authRequestId: string;
  pollSecret: string;
  steamLoginUrl: string;
  expiresAt: string;
  pollingInterval: number;
}

export interface SteamBackendSession {
  token: string;
  expiresAt: string;
}
