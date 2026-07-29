import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { AuthTransactionService } from "../src/auth/authTransactionService.ts";
import type { AuthApiConfig } from "../src/config.ts";
import { createRouter } from "../src/router.ts";
import { PollingRateLimiter } from "../src/security/pollingRateLimiter.ts";
import type {
  SafeLogger,
  SecurityLogEntry
} from "../src/security/safeLogger.ts";
import { SteamOpenIdVerifier } from "../src/steam/openIdVerifier.ts";
import {
  OPENID_2_NAMESPACE,
  STEAM_OPENID_ENDPOINT,
  type OpenIdFields,
  type SteamAssertionChecker,
  type SteamAssertionCheckResult
} from "../src/steam/openIdTypes.ts";
import { InMemoryAuthTransactionRepository } from "../src/storage/authRepository.ts";

const NOW = Date.parse("2026-07-28T12:00:00Z");
const STEAM_ID = "76561198000000000";
const DEVICE_ID = "opaque-device-01";
const CONFIG: AuthApiConfig = {
  nodeEnv: "test",
  port: 8787,
  publicBaseUrl: "https://auth.example.test",
  openIdRealm: "https://auth.example.test/",
  openIdReturnUrl: "https://auth.example.test/v1/auth/steam/callback",
  storageDriver: "memory",
  sessionSecret: "test-session-secret-at-least-32-characters",
  logLevel: "error",
  trustProxy: false,
  allowedOrigins: []
};

class FakeChecker implements SteamAssertionChecker {
  result: SteamAssertionCheckResult = { ok: true, isValid: true };
  async checkAssertion(_fields: OpenIdFields) {
    return this.result;
  }
}

class CapturingLogger implements SafeLogger {
  entries: SecurityLogEntry[] = [];
  write(entry: SecurityLogEntry) {
    this.entries.push(structuredClone(entry));
  }
}

interface Harness {
  server: Server;
  baseUrl: string;
  repository: InMemoryAuthTransactionRepository;
  transactions: AuthTransactionService;
  checker: FakeChecker;
  logger: CapturingLogger;
  setNow(value: number): void;
}

async function createHarness(
  config: AuthApiConfig = CONFIG
): Promise<Harness> {
  let now = NOW;
  const repository = new InMemoryAuthTransactionRepository();
  const transactions = new AuthTransactionService(repository, {
    now: () => now
  });
  const checker = new FakeChecker();
  const logger = new CapturingLogger();
  const server = createServer(createRouter({
    config,
    transactions,
    verifier: new SteamOpenIdVerifier(checker, {
      realm: config.openIdRealm,
      now: () => now
    }),
    rateLimiter: new PollingRateLimiter({ now: () => now }),
    logger,
    now: () => now
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    repository,
    transactions,
    checker,
    logger,
    setNow(value) { now = value; }
  };
}

test("approved Tauri and Vite origins receive exact CORS headers", async () => {
  const allowedOrigins = [
    "http://tauri.localhost",
    "http://127.0.0.1:1420"
  ];
  const harness = await createHarness({ ...CONFIG, allowedOrigins });
  try {
    for (const origin of allowedOrigins) {
      const response = await fetch(`${harness.baseUrl}/v1/auth/steam/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin
        },
        body: JSON.stringify({ deviceId: DEVICE_ID })
      });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      assert.match(response.headers.get("vary") ?? "", /(?:^|,\s*)Origin(?:,|$)/i);
      assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
    }
  } finally {
    await closeHarness(harness);
  }
});

test("approved OPTIONS preflight returns 204 and unknown origin is not allowed", async () => {
  const origin = "http://127.0.0.1:1420";
  const harness = await createHarness({
    ...CONFIG,
    allowedOrigins: [origin, "http://tauri.localhost"]
  });
  try {
    const approved = await fetch(`${harness.baseUrl}/v1/auth/steam/start`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "Content-Type"
      }
    });
    assert.equal(approved.status, 204);
    assert.equal(approved.headers.get("access-control-allow-origin"), origin);
    assert.equal(
      approved.headers.get("access-control-allow-methods"),
      "POST, GET, PATCH, DELETE, OPTIONS"
    );
    assert.equal(
      approved.headers.get("access-control-allow-headers"),
      "Content-Type, Authorization"
    );
    assert.equal(approved.headers.get("access-control-max-age"), "600");

    const rejected = await fetch(`${harness.baseUrl}/v1/auth/steam/start`, {
      method: "OPTIONS",
      headers: {
        origin: "https://attacker.example.test",
        "access-control-request-method": "POST",
        "access-control-request-headers": "Content-Type"
      }
    });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  } finally {
    await closeHarness(harness);
  }
});

async function closeHarness(harness: Harness) {
  await new Promise<void>((resolve, reject) =>
    harness.server.close((error) => error ? reject(error) : resolve())
  );
}

async function start(harness: Harness) {
  const response = await fetch(`${harness.baseUrl}/v1/auth/steam/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: DEVICE_ID })
  });
  return {
    response,
    body: await response.json() as {
      authRequestId: string;
      pollSecret: string;
      steamLoginUrl: string;
      expiresAt: string;
      pollingInterval: number;
    }
  };
}

function callbackUrl(
  loginUrl: string,
  baseUrl: string,
  patch: Record<string, string> = {}
) {
  const login = new URL(loginUrl);
  const returnTo = login.searchParams.get("openid.return_to");
  assert.ok(returnTo);
  const callback = new URL(returnTo);
  const claimedId = `https://steamcommunity.com/openid/id/${STEAM_ID}`;
  const fields = {
    "openid.ns": OPENID_2_NAMESPACE,
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_OPENID_ENDPOINT,
    "openid.return_to": returnTo,
    "openid.claimed_id": claimedId,
    "openid.identity": claimedId,
    "openid.response_nonce": "2026-07-28T12:00:00Zunique",
    "openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce",
    "openid.sig": "opaque-signature",
    ...patch
  };
  for (const [key, value] of Object.entries(fields)) {
    callback.searchParams.set(key, value);
  }
  const local = new URL(baseUrl);
  callback.protocol = local.protocol;
  callback.host = local.host;
  return callback;
}

async function poll(harness: Harness, body: object) {
  return fetch(`${harness.baseUrl}/v1/auth/steam/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, deviceId: DEVICE_ID })
  });
}

test("start returns correct Steam fields without leaking the poll secret", async () => {
  const harness = await createHarness();
  try {
    const { response, body } = await start(harness);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.pollingInterval, 3000);
    assert.match(body.pollSecret, /^[A-Za-z0-9_-]{43}$/);
    const login = new URL(body.steamLoginUrl);
    assert.equal(login.toString().split("?")[0], STEAM_OPENID_ENDPOINT);
    assert.equal(login.searchParams.get("openid.ns"), OPENID_2_NAMESPACE);
    assert.equal(login.searchParams.get("openid.mode"), "checkid_setup");
    assert.equal(login.searchParams.get("openid.realm"), CONFIG.openIdRealm);
    assert.ok(login.searchParams.get("openid.return_to")?.includes(body.authRequestId));
    assert.equal(body.steamLoginUrl.includes(body.pollSecret), false);
    const stored = await harness.repository.find(body.authRequestId);
    assert.ok(stored);
    assert.notEqual(stored.pollSecretHash, body.pollSecret);
  } finally {
    await closeHarness(harness);
  }
});

test("readiness reports repository validation without infrastructure details", async () => {
  const harness = await createHarness();
  try {
    const response = await fetch(`${harness.baseUrl}/ready`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { status: "ready" });
  } finally {
    await closeHarness(harness);
  }
});

test("valid callback returns device-bound identity without token or poll secret", async () => {
  const harness = await createHarness();
  try {
    const { body } = await start(harness);
    const callback = await fetch(callbackUrl(body.steamLoginUrl, harness.baseUrl));
    assert.equal(callback.status, 200);
    assert.match(await callback.text(), /Steam connected successfully/);
    assert.equal(callback.headers.get("cache-control"), "no-store");
    assert.equal(callback.headers.get("referrer-policy"), "no-referrer");
    assert.equal(callback.headers.get("x-content-type-options"), "nosniff");
    assert.match(callback.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    const stored = await harness.repository.find(body.authRequestId);
    assert.match(stored?.responseNonceHash ?? "", /^[a-f0-9]{64}$/);
    assert.notEqual(
      stored?.responseNonceHash,
      "2026-07-28T12:00:00Zunique"
    );
    const status = await poll(harness, body);
    assert.equal(status.status, 200);
    const text = await status.text();
    assert.deepEqual(JSON.parse(text), {
      status: "verified",
      steamId: STEAM_ID,
      authenticatedAt: new Date(NOW).toISOString()
    });
    assert.equal(text.includes(body.pollSecret), false);
    assert.equal(/token/i.test(text), false);
  } finally {
    await closeHarness(harness);
  }
});

test("status rejects a valid poll secret presented by another device", async () => {
  const harness = await createHarness();
  try {
    const { body } = await start(harness);
    const response = await fetch(`${harness.baseUrl}/v1/auth/steam/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        authRequestId: body.authRequestId,
        pollSecret: body.pollSecret,
        deviceId: "967de9ac-aac0-4b92-b0cc-843307c4f851"
      })
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "invalid_device_id" });
  } finally {
    await closeHarness(harness);
  }
});

test("cancel callback sets cancelled status", async () => {
  const harness = await createHarness();
  try {
    const { body } = await start(harness);
    const callback = await fetch(callbackUrl(body.steamLoginUrl, harness.baseUrl, {
      "openid.mode": "cancel"
    }));
    assert.equal(callback.status, 200);
    assert.deepEqual(await (await poll(harness, body)).json(), {
      status: "cancelled"
    });
  } finally {
    await closeHarness(harness);
  }
});

test("invalid assertion becomes failed with a safe error code", async () => {
  const harness = await createHarness();
  try {
    harness.checker.result = { ok: true, isValid: false };
    const { body } = await start(harness);
    const callback = await fetch(callbackUrl(body.steamLoginUrl, harness.baseUrl));
    assert.equal(callback.status, 400);
    assert.deepEqual(await (await poll(harness, body)).json(), {
      status: "failed",
      errorCode: "assertion_invalid"
    });
  } finally {
    await closeHarness(harness);
  }
});

test("temporary Steam failure leaves the transaction pending", async () => {
  const harness = await createHarness();
  try {
    harness.checker.result = {
      ok: false,
      reason: "verification_timeout",
      temporary: true
    };
    const { body } = await start(harness);
    assert.equal((await fetch(callbackUrl(body.steamLoginUrl, harness.baseUrl))).status, 503);
    assert.deepEqual(await (await poll(harness, body)).json(), {
      status: "pending"
    });
  } finally {
    await closeHarness(harness);
  }
});

test("expired, cancelled, and consumed transactions reject callbacks", async () => {
  const expired = await createHarness();
  try {
    const { body } = await start(expired);
    expired.setNow(NOW + 10 * 60_000);
    assert.equal((await fetch(callbackUrl(body.steamLoginUrl, expired.baseUrl))).status, 410);
  } finally {
    await closeHarness(expired);
  }

  const cancelled = await createHarness();
  try {
    const { body } = await start(cancelled);
    await cancelled.transactions.cancel(body.authRequestId, body.pollSecret);
    assert.equal((await fetch(callbackUrl(body.steamLoginUrl, cancelled.baseUrl))).status, 400);
  } finally {
    await closeHarness(cancelled);
  }

  const consumed = await createHarness();
  try {
    const { body } = await start(consumed);
    await consumed.transactions.markVerified(
      body.authRequestId,
      STEAM_ID,
      "2026-07-28T12:00:00Zfirst"
    );
    await consumed.transactions.consume(body.authRequestId, body.pollSecret);
    assert.equal((await fetch(callbackUrl(body.steamLoginUrl, consumed.baseUrl))).status, 400);
  } finally {
    await closeHarness(consumed);
  }
});

test("replayed nonce and reused callback are rejected", async () => {
  const harness = await createHarness();
  try {
    const first = (await start(harness)).body;
    assert.equal((await fetch(callbackUrl(first.steamLoginUrl, harness.baseUrl))).status, 200);
    assert.equal((await fetch(callbackUrl(first.steamLoginUrl, harness.baseUrl))).status, 400);

    const second = (await start(harness)).body;
    assert.equal((await fetch(callbackUrl(second.steamLoginUrl, harness.baseUrl))).status, 400);
    const stored = await harness.repository.find(second.authRequestId);
    assert.equal(stored?.status, "pending");
  } finally {
    await closeHarness(harness);
  }
});

test("status supports pending, expired, wrong secret, unknown request, and rate limit", async () => {
  const harness = await createHarness();
  try {
    const { body } = await start(harness);
    assert.deepEqual(await (await poll(harness, body)).json(), {
      status: "pending"
    });
    const limited = await poll(harness, body);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "3");

    harness.setNow(NOW + 3_000);
    assert.equal((await poll(harness, {
      ...body,
      pollSecret: "wrong-secret"
    })).status, 401);

    harness.setNow(NOW + 6_000);
    assert.equal((await poll(harness, {
      authRequestId: "unknown-request",
      pollSecret: body.pollSecret
    })).status, 401);

    harness.setNow(NOW + 10 * 60_000);
    assert.deepEqual(await (await poll(harness, body)).json(), {
      status: "expired"
    });
  } finally {
    await closeHarness(harness);
  }
});

test("logs and errors contain no poll secret, assertion, nonce, or sensitive query", async () => {
  const harness = await createHarness();
  try {
    const { body } = await start(harness);
    const callback = callbackUrl(body.steamLoginUrl, harness.baseUrl, {
      "openid.op_endpoint": "https://attacker.invalid/secret-query"
    });
    await fetch(callback);
    const serialized = JSON.stringify(harness.logger.entries);
    assert.equal(serialized.includes(body.pollSecret), false);
    assert.equal(serialized.includes("opaque-signature"), false);
    assert.equal(serialized.includes("2026-07-28T12:00:00Zunique"), false);
    assert.equal(serialized.includes(STEAM_ID), false);
    assert.equal(serialized.includes("secret-query"), false);
    const responseText = await (await fetch(callback)).text();
    assert.equal(responseText.includes("secret-query"), false);
    assert.equal(responseText.includes("opaque-signature"), false);
  } finally {
    await closeHarness(harness);
  }
});
