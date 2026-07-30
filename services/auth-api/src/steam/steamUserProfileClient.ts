const PLAYER_SUMMARIES_URL =
  "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/";

export interface SteamUserProfile {
  steamNickname: string;
  avatarUrl?: string;
}

export class SteamUserProfileClient {
  private readonly apiKey: string;
  private readonly request: typeof fetch;
  constructor(
    apiKey: string,
    request: typeof fetch = fetch
  ) {
    this.apiKey = apiKey;
    this.request = request;
  }

  async get(steamId64: string): Promise<SteamUserProfile | undefined> {
    const url = new URL(PLAYER_SUMMARIES_URL);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("steamids", steamId64);
    const response = await this.request(url, {
      signal: AbortSignal.timeout(5_000),
      headers: { accept: "application/json" }
    });
    if (!response.ok) return undefined;
    const payload: unknown = await response.json().catch(() => undefined);
    const player = readPlayer(payload, steamId64);
    if (!player) return undefined;
    const avatarUrl = safeAvatar(player.avatarfull) ? player.avatarfull : undefined;
    return {
      steamNickname: player.personaname.trim(),
      ...(avatarUrl ? { avatarUrl } : {})
    };
  }
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
