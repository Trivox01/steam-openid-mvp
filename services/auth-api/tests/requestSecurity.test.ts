import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import type { AuthApiConfig } from "../src/config.ts";
import {
  getSecureTransportDiagnostic,
  validatePublicAuthRequest
} from "../src/security/requestSecurity.ts";

const config: AuthApiConfig = {
  nodeEnv: "staging",
  port: 8787,
  publicBaseUrl: "https://auth-staging.example.test",
  openIdRealm: "https://auth-staging.example.test/",
  openIdReturnUrl: "https://auth-staging.example.test/callback",
  storageDriver: "postgres",
  databaseUrl: "postgresql://db.example.test/auth",
  sessionSecret: "test-session-secret-at-least-32-characters",
  logLevel: "info",
  trustProxy: true,
  allowedOrigins: ["https://desktop.example.test"]
};

test("accepts a directly encrypted HTTPS connection", () => {
  assert.doesNotThrow(() => validatePublicAuthRequest(request(
    { host: "auth-staging.example.test" },
    true
  ), { ...config, trustProxy: false }));
});

test("accepts HTTPS reported by a trusted proxy", () => {
  assert.doesNotThrow(() => validatePublicAuthRequest(request({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "auth-staging.example.test"
  }), config));
  assert.doesNotThrow(() => validatePublicAuthRequest(request({
    "x-forwarded-proto": " https , http",
    "x-forwarded-host": "auth-staging.example.test"
  }), config));
  assert.doesNotThrow(() => validatePublicAuthRequest(request({
    "x-forwarded-proto": "https",
    host: "auth-staging.example.test"
  }), config));
});

test("rejects HTTP reported by a trusted proxy", () => {
  assert.throws(() => validatePublicAuthRequest(request({
    "x-forwarded-proto": "http",
    "x-forwarded-host": "auth-staging.example.test"
  }), config));
  assert.throws(() => validatePublicAuthRequest(request({
    "x-forwarded-proto": "http, https",
    "x-forwarded-host": "auth-staging.example.test"
  }), config));
});

test("ignores forwarded HTTPS when proxy trust is disabled", () => {
  assert.throws(() => validatePublicAuthRequest(request({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "auth-staging.example.test",
    host: "auth-staging.example.test"
  }), { ...config, trustProxy: false }));
});

test("retains the exact public host allowlist", () => {
  assert.throws(() => validatePublicAuthRequest(request({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "attacker.example.test"
  }), config));
});

test("rejects an unapproved browser origin", () => {
  assert.throws(() => validatePublicAuthRequest(request({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "auth-staging.example.test",
    origin: "https://attacker.example.test"
  }), config));
});

test("exposes only the approved safe transport diagnostics", () => {
  assert.deepEqual(getSecureTransportDiagnostic(request({
    "x-forwarded-proto": " https, http",
    cookie: "must-not-appear",
    authorization: "Bearer must-not-appear"
  }), config, "/v1/auth/steam/start?secret=must-not-appear"), {
    trustProxy: true,
    forwardedProto: "https",
    socketEncrypted: false,
    endpoint: "/v1/auth/steam/start"
  });
});

function request(
  headers: IncomingMessage["headers"],
  encrypted = false
) {
  return {
    headers,
    socket: { encrypted }
  } as unknown as IncomingMessage;
}
