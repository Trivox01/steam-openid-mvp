const PLAYER_SUMMARIES_URL =
  "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/";

export interface SteamUserProfile {
  steamNickname: string;
  avatarUrl?: string;
}

export interface SteamUserProfileDiagnostics {
  write(entry: {
    event: "steam_profile_summary";
    responseStatus: number;
    playerCount: number;
    matchingPlayer: boolean;
  }): void;
}

export class SteamUserProfileClient {
  private readonly apiKey: string;
  private readonly request: typeof fetch;
  private readonly diagnostics?: SteamUserProfileDiagnostics;
  constructor(
    apiKey: string,
    request: typeof fetch = fetch,
    diagnostics?: SteamUserProfileDiagnostics
  ) {
    this.apiKey = apiKey;
    this.request = request;
    this.diagnostics = diagnostics;
  }

  async get(steamId64: string): Promise<SteamUserProfile | undefined> {
    const url = new URL(PLAYER_SUMMARIES_URL);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("steamids", steamId64);
    const response = await this.request(url, {
      signal: AbortSignal.timeout(5_000),
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      this.diagnostics?.write({
        event: "steam_profile_summary",
        responseStatus: response.status,
        playerCount: 0,
        matchingPlayer: false
      });
      return undefined;
    }
    const payload: unknown = await response.json().catch(() => undefined);
    const playerCount = readPlayerCount(payload);
    const player = readPlayer(payload, steamId64);
    this.diagnostics?.write({
      event: "steam_profile_summary",
      responseStatus: response.status,
      playerCount,
      matchingPlayer: Boolean(player)
    });
    if (!player) return undefined;
    const avatarUrl = safeAvatar(player.avatarfull) ? player.avatarfull : undefined;
    return {
      steamNickname: player.personaname.trim(),
      ...(avatarUrl ? { avatarUrl } : {})
    };
  }
}

function readPlayerCount(value: unknown) {
  return record(value) &&
    record(value.response) &&
    Array.isArray(value.response.players)
    ? value.response.players.length
    : 0;
}

function readPlayer(value: unknown, steamId64: string) {
  if (!record(value) || !record(value.response) || !Array.isArray(value.response.players)) {
    return undefined;
  }
  const player = value.response.players.find((candidate) =>
    record(candidate) &&
    candidate.steamid === steamId64 &&
    typeof candidate.personaname === "string" &&
    candidate.personaname.trim().length > 0 &&
    candidate.personaname.trim().length <= 80 &&
    typeof candidate.avatarfull === "string"
  );
  return player as { personaname: string; avatarfull: string } | undefined;
}

function safeAvatar(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username && !url.password &&
      (
        url.hostname === "avatars.steamstatic.com" ||
        url.hostname.endsWith(".steamstatic.com") ||
        url.hostname === "steamcdn-a.akamaihd.net"
      );
  } catch {
    return false;
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
