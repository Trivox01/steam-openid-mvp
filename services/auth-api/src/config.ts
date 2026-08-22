export type AuthStorageDriver = "memory" | "postgres";
export type BadgeStorageDriver = "memory" | "local" | "s3";
export interface S3BadgeStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  keyPrefix: string;
  publicBaseUrl?: string;
}
export type RuntimeEnvironment =
  | "development"
  | "test"
  | "staging"
  | "production";

export interface AuthApiConfig {
  nodeEnv: RuntimeEnvironment;
  port: number;
  publicBaseUrl: string;
  openIdRealm: string;
  openIdReturnUrl: string;
  storageDriver: AuthStorageDriver;
  databaseUrl?: string;
  sessionSecret: string;
  logLevel: "error" | "warn" | "info" | "debug";
  trustProxy: boolean;
  allowedOrigins: string[];
  bootstrapOwnerSteamId64?: string;
  badgeAssetDirectory?: string;
  badgeStorageDriver?: BadgeStorageDriver;
  s3BadgeStorage?: S3BadgeStorageConfig;
  steamWebApiKey?: string;
  /**
   * Phase 2A rollout flag for the transitional Steam linked-account dual write.
   * Backend-only and off by default: while it is off, Steam authentication
   * behaves exactly as before. It never affects identity resolution, which
   * stays on users.steam_id64.
   */
  nexusLinkedAccountsDualWriteEnabled?: boolean;
}

export class ConfigurationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "ConfigurationError";
  }
}

export function loadAuthApiConfig(
  environment: NodeJS.ProcessEnv = process.env
): AuthApiConfig {
  const nodeEnv = parseNodeEnvironment(environment.NODE_ENV);
  const publicBaseUrl = parseSecureUrl(
    environment.PUBLIC_BASE_URL,
    "PUBLIC_BASE_URL"
  );
  const openIdRealm = parseSecureUrl(environment.OPENID_REALM, "OPENID_REALM");
  const openIdReturnUrl = parseSecureUrl(
    environment.OPENID_RETURN_URL,
    "OPENID_RETURN_URL"
  );
  const storageDriver = parseStorageDriver(environment.AUTH_STORAGE_DRIVER);
  const databaseUrl = environment.DATABASE_URL?.trim();
  const sessionSecret = environment.SESSION_SECRET ?? "";
  const trustProxy = parseBoolean(environment.TRUST_PROXY, "TRUST_PROXY");
  const bootstrapOwnerSteamId64 = parseOptionalSteamId(
    environment.BOOTSTRAP_OWNER_STEAM_ID64
  );
  const badgeStorageDriver = parseBadgeStorageDriver(
    environment.BADGE_STORAGE_DRIVER,
    nodeEnv
  );
  const s3BadgeStorage = badgeStorageDriver === "s3"
    ? parseS3BadgeStorage(environment, nodeEnv)
    : undefined;
  const steamWebApiKey = parseOptionalSecret(
    environment.STEAM_WEB_API_KEY,
    "STEAM_WEB_API_KEY"
  );
  const nexusLinkedAccountsDualWriteEnabled = parseOptionalBoolean(
    environment.NEXUS_LINKED_ACCOUNTS_DUAL_WRITE_ENABLED,
    "NEXUS_LINKED_ACCOUNTS_DUAL_WRITE_ENABLED"
  );

  if (publicBaseUrl.search || openIdRealm.search || openIdRealm.hash) {
    throw new ConfigurationError("invalid_OPENID_REALM");
  }
  if (openIdReturnUrl.search || openIdReturnUrl.hash) {
    throw new ConfigurationError("invalid_OPENID_RETURN_URL");
  }
  if (
    publicBaseUrl.origin !== openIdRealm.origin ||
    openIdRealm.origin !== openIdReturnUrl.origin ||
    !pathBelongsToRealm(openIdReturnUrl.pathname, openIdRealm.pathname)
  ) {
    throw new ConfigurationError("OPENID_RETURN_URL_outside_realm");
  }
  if (
    (nodeEnv === "staging" || nodeEnv === "production") &&
    storageDriver !== "postgres"
  ) {
    throw new ConfigurationError("persistent_storage_required");
  }
  if (
    (nodeEnv === "staging" || nodeEnv === "production") &&
    !trustProxy
  ) {
    throw new ConfigurationError("trusted_proxy_required");
  }
  if (
    (nodeEnv === "staging" || nodeEnv === "production") &&
    badgeStorageDriver !== "s3"
  ) throw new ConfigurationError("persistent_badge_storage_required");
  if (storageDriver === "postgres") validateDatabaseUrl(databaseUrl);
  if (
    sessionSecret.length < 32 ||
    sessionSecret.length > 256 ||
    /\s/.test(sessionSecret) ||
    new Set(sessionSecret).size < 12
  ) {
    throw new ConfigurationError("SESSION_SECRET_too_short");
  }

  return {
    nodeEnv,
    port: parsePort(environment.PORT),
    publicBaseUrl: trimTrailingSlash(publicBaseUrl.toString()),
    openIdRealm: normalizeRealm(openIdRealm),
    openIdReturnUrl: openIdReturnUrl.toString(),
    storageDriver,
    ...(databaseUrl ? { databaseUrl } : {}),
    sessionSecret,
    logLevel: parseLogLevel(environment.LOG_LEVEL),
    trustProxy,
    allowedOrigins: parseAllowedOrigins(environment.ALLOWED_ORIGINS),
    badgeStorageDriver,
    ...(s3BadgeStorage ? { s3BadgeStorage } : {}),
    ...(environment.BADGE_ASSET_DIRECTORY?.trim()
      ? { badgeAssetDirectory: environment.BADGE_ASSET_DIRECTORY.trim() }
      : {}),
    ...(bootstrapOwnerSteamId64 ? { bootstrapOwnerSteamId64 } : {}),
    ...(steamWebApiKey ? { steamWebApiKey } : {}),
    ...(nexusLinkedAccountsDualWriteEnabled
      ? { nexusLinkedAccountsDualWriteEnabled: true }
      : {})
  };
}

/**
 * Optional rollout flag. An unset or empty value is off, so an environment that
 * has never heard of the flag keeps its current behaviour. Only the exact
 * strings "true" and "false" are accepted, matching parseBoolean, so a typo
 * fails loudly at startup instead of silently deciding a rollout either way.
 */
function parseOptionalBoolean(value: string | undefined, name: string) {
  if (value === undefined || value.trim() === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ConfigurationError(`invalid_${name}`);
}

function parseOptionalSecret(
  value: string | undefined,
  name: string
) {
  if (!value?.trim()) return undefined;
  const secret = value.trim();
  if (secret.length < 20 || secret.length > 256 || /\s|[\r\n]/.test(secret)) {
    throw new ConfigurationError(`invalid_${name}`);
  }
  return secret;
}

function parseBadgeStorageDriver(
  value: string | undefined,
  nodeEnv: RuntimeEnvironment
): BadgeStorageDriver {
  if (!value) return nodeEnv === "test" ? "memory" : "local";
  if (value === "memory" || value === "local" || value === "s3") return value;
  throw new ConfigurationError("invalid_BADGE_STORAGE_DRIVER");
}

function parseS3BadgeStorage(
  environment: NodeJS.ProcessEnv,
  nodeEnv: RuntimeEnvironment
): S3BadgeStorageConfig {
  const endpoint = parseObjectStorageUrl(environment.S3_ENDPOINT, "S3_ENDPOINT");
  const publicBase = environment.S3_PUBLIC_BASE_URL?.trim()
    ? parseObjectStorageUrl(environment.S3_PUBLIC_BASE_URL, "S3_PUBLIC_BASE_URL")
    : undefined;
  const region = requiredBounded(environment.S3_REGION, "S3_REGION", 64);
  const bucket = requiredBounded(environment.S3_BUCKET, "S3_BUCKET", 63);
  const accessKeyId = requiredBounded(environment.S3_ACCESS_KEY_ID, "S3_ACCESS_KEY_ID", 256);
  const secretAccessKey = requiredBounded(environment.S3_SECRET_ACCESS_KEY, "S3_SECRET_ACCESS_KEY", 512);
  const configuredPrefix = environment.S3_KEY_PREFIX?.trim().replace(/^\/+|\/+$/g, "");
  if (configuredPrefix && !/^[a-z0-9][a-z0-9/_-]{0,127}$/i.test(configuredPrefix)) {
    throw new ConfigurationError("invalid_S3_KEY_PREFIX");
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new ConfigurationError("invalid_S3_BUCKET");
  }
  return {
    endpoint: endpoint.toString().replace(/\/$/, ""),
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    keyPrefix: `${configuredPrefix ? `${configuredPrefix}/` : ""}badges/${nodeEnv}`,
    ...(publicBase ? { publicBaseUrl: publicBase.toString().replace(/\/$/, "") } : {})
  };
}

function parseObjectStorageUrl(value: string | undefined, name: string) {
  if (!value?.trim()) throw new ConfigurationError(`missing_${name}`);
  let url: URL;
  try { url = new URL(value); } catch { throw new ConfigurationError(`invalid_${name}`); }
  if (
    url.protocol !== "https:" || url.username || url.password ||
    url.search || url.hash || isPrivateHost(url.hostname)
  ) throw new ConfigurationError(`invalid_${name}`);
  return url;
}

function isPrivateHost(host: string) {
  const normalized = host.toLowerCase();
  return normalized === "localhost" ||
    normalized === "::1" ||
    normalized.endsWith(".local") ||
    /^127\./.test(normalized) ||
    /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^169\.254\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}

function requiredBounded(
  value: string | undefined,
  name: string,
  max: number
) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > max || /[\r\n]/.test(normalized)) {
    throw new ConfigurationError(`invalid_${name}`);
  }
  return normalized;
}

function parseOptionalSteamId(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const steamId = value.trim();
  if (!/^\d{17}$/.test(steamId)) {
    throw new ConfigurationError("invalid_BOOTSTRAP_OWNER_STEAM_ID64");
  }
  return steamId;
}

export function returnToBelongsToRealm(returnTo: string, realm: string) {
  try {
    const returnUrl = new URL(returnTo);
    const realmUrl = new URL(realm);
    return (
      returnUrl.protocol === "https:" &&
      returnUrl.origin === realmUrl.origin &&
      pathBelongsToRealm(returnUrl.pathname, realmUrl.pathname)
    );
  } catch {
    return false;
  }
}

function parseNodeEnvironment(value: string | undefined): RuntimeEnvironment {
  if (
    value === "development" ||
    value === "test" ||
    value === "staging" ||
    value === "production"
  ) {
    return value;
  }
  throw new ConfigurationError("invalid_NODE_ENV");
}

function parseStorageDriver(value: string | undefined): AuthStorageDriver {
  if (value === "memory" || value === "postgres") return value;
  throw new ConfigurationError("invalid_AUTH_STORAGE_DRIVER");
}

function parseSecureUrl(value: string | undefined, name: string) {
  if (!value?.trim()) throw new ConfigurationError(`missing_${name}`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(`invalid_${name}`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new ConfigurationError(`invalid_${name}`);
  }
  return url;
}

function validateDatabaseUrl(value: string | undefined) {
  if (!value) throw new ConfigurationError("missing_DATABASE_URL");
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
      !url.hostname ||
      !url.pathname.slice(1)
    ) {
      throw new Error();
    }
  } catch {
    throw new ConfigurationError("invalid_DATABASE_URL");
  }
}

function parseBoolean(value: string | undefined, name: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ConfigurationError(`invalid_${name}`);
}

function parseAllowedOrigins(value: string | undefined) {
  if (!value?.trim()) return [];
  const origins = value.split(",").map((entry) =>
    parseAllowedOrigin(entry.trim())
  );
  return [...new Set(origins)];
}

function parseAllowedOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError("invalid_ALLOWED_ORIGINS");
  }
  const isSecureWebOrigin = url.protocol === "https:";
  const isTauriWindowsOrigin =
    url.protocol === "http:" && url.hostname === "tauri.localhost";
  const isLoopbackDevelopmentOrigin =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
    Boolean(url.port);
  if (
    (!isSecureWebOrigin &&
      !isTauriWindowsOrigin &&
      !isLoopbackDevelopmentOrigin) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== value
  ) {
    throw new ConfigurationError("invalid_ALLOWED_ORIGINS");
  }
  return url.origin;
}

function parseLogLevel(value: string | undefined) {
  if (
    value === "error" ||
    value === "warn" ||
    value === "info" ||
    value === "debug"
  ) {
    return value;
  }
  throw new ConfigurationError("invalid_LOG_LEVEL");
}

function parsePort(value: string | undefined) {
  if (!value) return 8787;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigurationError("invalid_PORT");
  }
  return port;
}

function pathBelongsToRealm(pathname: string, realmPathname: string) {
  const base = realmPathname.endsWith("/") ? realmPathname : `${realmPathname}/`;
  return pathname === realmPathname || pathname.startsWith(base);
}

function normalizeRealm(url: URL) {
  const normalized = new URL(url);
  if (!normalized.pathname.endsWith("/")) normalized.pathname += "/";
  return normalized.toString();
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
