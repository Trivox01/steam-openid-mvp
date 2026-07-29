import assert from "node:assert/strict";
import test from "node:test";
import {
  ConfigurationError,
  loadAuthApiConfig
} from "../src/config.ts";

const VALID_ENV = {
  NODE_ENV: "test",
  PORT: "8787",
  PUBLIC_BASE_URL: "https://auth.example.test",
  OPENID_REALM: "https://auth.example.test/",
  OPENID_RETURN_URL: "https://auth.example.test/v1/auth/steam/callback",
  AUTH_STORAGE_DRIVER: "memory",
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
  LOG_LEVEL: "error",
  TRUST_PROXY: "false",
  ALLOWED_ORIGINS: ""
};
const VALID_S3 = {
  BADGE_STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "https://objects.example.test",
  S3_REGION: "eu-west-1",
  S3_BUCKET: "achievement-nexus-staging",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key-not-for-production",
  S3_PUBLIC_BASE_URL: "https://cdn.example.test",
  S3_KEY_PREFIX: "tenant-a"
};

test("loads secure OpenID environment configuration", () => {
  assert.deepEqual(loadAuthApiConfig(VALID_ENV), {
    nodeEnv: "test",
    port: 8787,
    publicBaseUrl: "https://auth.example.test",
    openIdRealm: "https://auth.example.test/",
    openIdReturnUrl: "https://auth.example.test/v1/auth/steam/callback",
    storageDriver: "memory",
    sessionSecret: "test-session-secret-at-least-32-characters",
    logLevel: "error",
    trustProxy: false,
    allowedOrigins: [],
    badgeStorageDriver: "memory"
  });
});

test("parses the explicit Windows Tauri and Vite development origin allowlist", () => {
  const config = loadAuthApiConfig({
    ...VALID_ENV,
    ALLOWED_ORIGINS:
      "http://tauri.localhost,http://127.0.0.1:1420,http://127.0.0.1:1420"
  });
  assert.deepEqual(config.allowedOrigins, [
    "http://tauri.localhost",
    "http://127.0.0.1:1420"
  ]);
});

test("rejects wildcard and non-loopback insecure allowed origins", () => {
  for (const ALLOWED_ORIGINS of ["*", "http://example.test", "tauri://localhost"]) {
    assert.throws(
      () => loadAuthApiConfig({ ...VALID_ENV, ALLOWED_ORIGINS }),
      (error: unknown) =>
        error instanceof ConfigurationError &&
        error.code === "invalid_ALLOWED_ORIGINS"
    );
  }
});

test("rejects missing OpenID environment", () => {
  assert.throws(
    () => loadAuthApiConfig({}),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.code === "invalid_NODE_ENV"
  );
});

test("rejects an insecure realm", () => {
  assert.throws(() =>
    loadAuthApiConfig({ ...VALID_ENV, OPENID_REALM: "http://auth.example.test/" })
  );
});

test("rejects an insecure return URL", () => {
  assert.throws(() =>
    loadAuthApiConfig({
      ...VALID_ENV,
      OPENID_RETURN_URL: "http://auth.example.test/callback"
    })
  );
});

test("rejects a return URL outside the configured realm", () => {
  assert.throws(() =>
    loadAuthApiConfig({
      ...VALID_ENV,
      OPENID_REALM: "https://auth.example.test/auth/",
      OPENID_RETURN_URL: "https://auth.example.test/callback"
    })
  );
});

test("staging and production reject memory storage", () => {
  for (const NODE_ENV of ["staging", "production"]) {
    assert.throws(
      () => loadAuthApiConfig({ ...VALID_ENV, NODE_ENV }),
      (error: unknown) =>
        error instanceof ConfigurationError &&
        error.code === "persistent_storage_required"
    );
  }
});

test("PostgreSQL storage requires a valid database URL", () => {
  assert.throws(
    () => loadAuthApiConfig({
      ...VALID_ENV,
      AUTH_STORAGE_DRIVER: "postgres"
    }),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.code === "missing_DATABASE_URL"
  );
  assert.doesNotThrow(() => loadAuthApiConfig({
    ...VALID_ENV,
    NODE_ENV: "staging",
    AUTH_STORAGE_DRIVER: "postgres",
    DATABASE_URL: "postgresql://db.example.test/auth",
    TRUST_PROXY: "true",
    ...VALID_S3
  }));
});

test("S3 badge storage is environment-separated and rejects unsafe endpoints", () => {
  const config = loadAuthApiConfig({
    ...VALID_ENV,
    NODE_ENV: "staging",
    AUTH_STORAGE_DRIVER: "postgres",
    DATABASE_URL: "postgresql://db.example.test/auth",
    TRUST_PROXY: "true",
    ...VALID_S3
  });
  assert.equal(config.s3BadgeStorage?.keyPrefix, "tenant-a/badges/staging");
  assert.equal(config.s3BadgeStorage?.publicBaseUrl, "https://cdn.example.test");
  for (const S3_ENDPOINT of [
    "http://objects.example.test",
    "https://127.0.0.1",
    "https://169.254.169.254"
  ]) {
    assert.throws(
      () => loadAuthApiConfig({
        ...VALID_ENV,
        ...VALID_S3,
        S3_ENDPOINT
      }),
      (error: unknown) =>
        error instanceof ConfigurationError &&
        error.code === "invalid_S3_ENDPOINT" &&
        !error.message.includes(VALID_S3.S3_SECRET_ACCESS_KEY)
    );
  }
});

test("staging requires an explicitly trusted TLS-terminating proxy", () => {
  assert.throws(
    () => loadAuthApiConfig({
      ...VALID_ENV,
      NODE_ENV: "staging",
      AUTH_STORAGE_DRIVER: "postgres",
      DATABASE_URL: "postgresql://db.example.test/auth",
      TRUST_PROXY: "false"
    }),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.code === "trusted_proxy_required"
  );
});

test("requires a strong session secret without exposing its value", () => {
  assert.throws(
    () => loadAuthApiConfig({ ...VALID_ENV, SESSION_SECRET: "short-secret" }),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.code === "SESSION_SECRET_too_short" &&
      !error.message.includes("short-secret")
  );
});

test("accepts an optional valid bootstrap owner and rejects malformed values", () => {
  const config = loadAuthApiConfig({
    ...VALID_ENV,
    BOOTSTRAP_OWNER_STEAM_ID64: "76561198000000000"
  });
  assert.equal(config.bootstrapOwnerSteamId64, "76561198000000000");
  assert.throws(
    () => loadAuthApiConfig({
      ...VALID_ENV,
      BOOTSTRAP_OWNER_STEAM_ID64: "not-a-steam-id"
    }),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.code === "invalid_BOOTSTRAP_OWNER_STEAM_ID64"
  );
});
