const STEAM_API_BASE = "https://api.steampowered.com";
const REQUEST_TIMEOUT_MS = 12_000;

export type SteamDataErrorCode =
  | "backend_not_configured"
  | "invalid_app_id"
  | "invalid_api_key"
  | "no_achievements"
  | "no_player_stats"
  | "game_not_owned"
  | "private_library"
  | "schema_unavailable"
  | "rate_limited"
  | "timeout"
  | "network"
  | "steam_api_unavailable"
  | "invalid_response";

export class SteamDataError extends Error {
  readonly code: SteamDataErrorCode;
  readonly httpStatus: number;
  readonly stage: "request" | "parse";

  constructor(
    code: SteamDataErrorCode,
    httpStatus = 502,
    stage: "request" | "parse" = "request"
  ) {
    super(code);
    this.code = code;
    this.httpStatus = httpStatus;
    this.stage = stage;
    this.name = "SteamDataError";
  }
}

export interface SteamDataLogEntry {
  event: "steam_data_request";
  endpoint: string;
  appId?: number;
  httpStatus?: number;
  success: boolean;
  itemCount: number;
  errorCode?: SteamDataErrorCode;
  stage: "request" | "parse";
  durationMs: number;
}

export interface SteamDataLogger {
  write(entry: SteamDataLogEntry): void;
}

export class SteamDataClient {
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: SteamDataLogger;
  private readonly timeoutMs: number;

  constructor(
    apiKey: string | undefined,
    fetchImpl: typeof fetch = fetch,
    logger: SteamDataLogger = { write() {} },
    timeoutMs = REQUEST_TIMEOUT_MS
  ) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
  }

  async getOwnedGames(steamId64: string) {
    const payload = await this.request(
      "/IPlayerService/GetOwnedGames/v1/",
      {
        steamid: steamId64,
        include_appinfo: "true",
        include_played_free_games: "true",
        format: "json"
      }
    );
    const response = record(payload.response);
    if (!response || (response.game_count === undefined && response.games === undefined)) {
      throw new SteamDataError("private_library", 403, "parse");
    }
    const raw = Array.isArray(response.games) ? response.games : [];
    const games = raw.flatMap((value) => {
      const game = record(value);
      const appId = positiveInteger(game?.appid);
      const name = stringValue(game?.name);
      if (!appId || !name) return [];
      return [{
        appId,
        name,
        playtimeForeverMinutes: nonNegativeNumber(game?.playtime_forever) ?? 0,
        playtimeTwoWeeksMinutes: nonNegativeNumber(game?.playtime_2weeks),
        playtimeWindowsMinutes: nonNegativeNumber(game?.playtime_windows_forever),
        playtimeMacMinutes: nonNegativeNumber(game?.playtime_mac_forever),
        playtimeLinuxMinutes: nonNegativeNumber(game?.playtime_linux_forever),
        lastPlayedUnix: positiveInteger(game?.rtime_last_played),
        iconHash: stringValue(game?.img_icon_url),
        logoHash: stringValue(game?.img_logo_url)
      }];
    });
    return {
      games: [...new Map(games.map((game) => [game.appId, game])).values()],
      fetched: raw.length,
      skipped: raw.length - games.length,
      warnings: raw.length === games.length ? [] : ["partial_records_skipped"]
    };
  }

  async getGameAchievements(steamId64: string, appId: number) {
    if (!Number.isSafeInteger(appId) || appId <= 0) {
      throw new SteamDataError("invalid_app_id", 400, "parse");
    }
    const schemaPayload = await this.request(
      "/ISteamUserStats/GetSchemaForGame/v2/",
      { appid: String(appId), l: "english" },
      appId
    );
    const game = record(schemaPayload.game);
    if (!game) throw new SteamDataError("schema_unavailable", 422, "parse");
    const stats = record(game.availableGameStats);
    const schemaAchievements = Array.isArray(stats?.achievements)
      ? stats.achievements
      : [];
    if (schemaAchievements.length === 0) {
      throw new SteamDataError("no_achievements", 422, "parse");
    }

    const playerPayload = await this.request(
      "/ISteamUserStats/GetPlayerAchievements/v1/",
      { steamid: steamId64, appid: String(appId), l: "english" },
      appId
    );
    const playerStats = record(playerPayload.playerstats);
    if (!playerStats) throw new SteamDataError("no_player_stats", 422, "parse");
    if (playerStats.success !== true) {
      throw new SteamDataError(classifyPlayerStatsError(stringValue(playerStats.error)), 422, "parse");
    }
    const playerItems = Array.isArray(playerStats.achievements)
      ? playerStats.achievements
      : [];
    const playerByName = new Map(playerItems.flatMap((value) => {
      const item = record(value);
      const apiName = stringValue(item?.apiname);
      return apiName ? [[apiName, item] as const] : [];
    }));
    const globalPayload = await this.request(
      "/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",
      { gameid: String(appId) },
      appId,
      false
    ).catch(() => undefined);
    const percentages = record(globalPayload?.achievementpercentages);
    const globalItems = Array.isArray(percentages?.achievements)
      ? percentages.achievements
      : [];
    const globalByName = new Map(globalItems.flatMap((value) => {
      const item = record(value);
      const name = stringValue(item?.name);
      const percent = finitePercent(item?.percent);
      return name && percent !== undefined ? [[name, percent] as const] : [];
    }));
    const warnings = globalPayload ? [] : ["global_percentages_unavailable"];
    const achievements = schemaAchievements.flatMap((value) => {
      const item = record(value);
      const apiName = stringValue(item?.name);
      if (!apiName) return [];
      const player = playerByName.get(apiName);
      const unlocked = Number(player?.achieved) > 0;
      const unlocktime = positiveInteger(player?.unlocktime);
      return [{
        apiName,
        displayName: stringValue(item?.displayName) ?? apiName,
        description: stringValue(item?.description) ?? "",
        hidden: Number(item?.hidden) !== 0,
        iconUrl: trustedSteamImage(stringValue(item?.icon)),
        lockedIconUrl: trustedSteamImage(stringValue(item?.icongray)),
        unlocked,
        ...(unlocked && unlocktime
          ? { unlockedAt: new Date(unlocktime * 1000).toISOString() }
          : {}),
        ...(globalByName.has(apiName)
          ? { globalUnlockPercent: globalByName.get(apiName)! }
          : {})
      }];
    });
    if (achievements.length === 0) {
      throw new SteamDataError("no_achievements", 422, "parse");
    }
    return {
      appId,
      gameName: stringValue(game.gameName) ?? "",
      achievements,
      warnings,
      fetchedAt: new Date().toISOString()
    };
  }

  private async request(
    path: string,
    query: Record<string, string>,
    appId?: number,
    includeKey = true
  ): Promise<Record<string, unknown>> {
    if (includeKey && !this.apiKey) {
      throw new SteamDataError("backend_not_configured", 503);
    }
    const started = Date.now();
    const endpoint = path.split("/").filter(Boolean).at(-2) ?? "SteamWebApi";
    const url = new URL(path, STEAM_API_BASE);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    if (includeKey) url.searchParams.set("key", this.apiKey!);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const code = error instanceof DOMException && error.name === "TimeoutError"
        ? "timeout"
        : "network";
      this.log(endpoint, appId, undefined, false, 0, code, "request", started);
      throw new SteamDataError(code);
    }
    if (!response.ok) {
      const code = classifyHttpStatus(response.status, path);
      this.log(endpoint, appId, response.status, false, 0, code, "request", started);
      throw new SteamDataError(code, response.status);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      this.log(endpoint, appId, response.status, false, 0, "invalid_response", "parse", started);
      throw new SteamDataError("invalid_response", 502, "parse");
    }
    const parsed = record(payload);
    if (!parsed) {
      this.log(endpoint, appId, response.status, false, 0, "invalid_response", "parse", started);
      throw new SteamDataError("invalid_response", 502, "parse");
    }
    this.log(endpoint, appId, response.status, true, countPayloadItems(parsed), undefined, "parse", started);
    return parsed;
  }

  private log(
    endpoint: string,
    appId: number | undefined,
    httpStatus: number | undefined,
    success: boolean,
    itemCount: number,
    errorCode: SteamDataErrorCode | undefined,
    stage: "request" | "parse",
    started: number
  ) {
    this.logger.write({
      event: "steam_data_request",
      endpoint,
      ...(appId ? { appId } : {}),
      ...(httpStatus ? { httpStatus } : {}),
      success,
      itemCount,
      ...(errorCode ? { errorCode } : {}),
      stage,
      durationMs: Date.now() - started
    });
  }
}

function classifyHttpStatus(status: number, path: string): SteamDataErrorCode {
  if (status === 401 || status === 403) return "invalid_api_key";
  if (status === 429) return "rate_limited";
  if (status === 400) return path.includes("GetSchemaForGame") ? "invalid_app_id" : "no_player_stats";
  if (status === 404) return path.includes("GetSchemaForGame") ? "schema_unavailable" : "no_player_stats";
  return "steam_api_unavailable";
}

function classifyPlayerStatsError(message?: string): SteamDataErrorCode {
  const error = message?.toLowerCase() ?? "";
  if (error.includes("does not own") || error.includes("not own")) return "game_not_owned";
  if (error.includes("no stats")) return "no_player_stats";
  if (error.includes("private")) return "private_library";
  return "no_player_stats";
}

function trustedSteamImage(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "steamcdn-a.akamaihd.net" ||
        url.hostname === "cdn.cloudflare.steamstatic.com" ||
        url.hostname.endsWith(".steamstatic.com"))
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}
function nonNegativeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}
function finitePercent(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : undefined;
}
function countPayloadItems(payload: Record<string, unknown>) {
  const response = record(payload.response);
  const game = record(payload.game);
  const stats = record(game?.availableGameStats);
  const player = record(payload.playerstats);
  const percentages = record(payload.achievementpercentages);
  const candidates = [response?.games, stats?.achievements, player?.achievements, percentages?.achievements];
  return candidates.find(Array.isArray)?.length ?? 0;
}
