import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import type { AuthApiConfig } from "../src/config.ts";
import { validatePublicAuthRequest } from "../src/security/requestSecurity.ts";

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

test("trusted proxy requires exact forwarded HTTPS and host", () => {
  assert.doesNotThrow(() => validatePublicAuthRequest(request({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "auth-staging.example.test"
  }), config));
  assert.throws(() => validatePublicAuthRequest(request({
    "x-forwarded-proto": "http",
    "x-forwarded-host": "auth-staging.example.test"
  }), config));
  assert.throws(() => validatePublicAuthRequest(request({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "attacker.example.test"
  }), config));
});

test("forwarded headers are ignored when trust proxy is disabled", () => {
  assert.throws(() => validatePublicAuthRequest(request({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "auth-staging.example.test",
    host: "auth-staging.example.test"
  }), { ...config, trustProxy: false }));
});

test("rejects an unapproved browser origin", () => {
  assert.throws(() => validatePublicAuthRequest(request({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "auth-staging.example.test",
    origin: "https://attacker.example.test"
  }), config));
});

function request(headers: IncomingMessage["headers"]) {
  return {
    headers,
    socket: {}
  } as IncomingMessage;
}
