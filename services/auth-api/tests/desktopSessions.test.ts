import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { InMemoryAuthorizationRepository } from "../src/authorization/authorizationRepository.ts";
import { SessionTokenService } from "../src/authorization/sessionTokenService.ts";
import { DesktopSessionError, DesktopSessionService } from "../src/desktopSessions/desktopSessionService.ts";
import { InMemoryDesktopSessionRepository } from "../src/desktopSessions/desktopSessionRepository.ts";
import { handleDesktopSessions } from "../src/routes/desktopSessions.ts";
import { PollingRateLimiter } from "../src/security/pollingRateLimiter.ts";
import type { AuthApiConfig } from "../src/config.ts";

const STEAM_ID = "76561198000000000";
const START = Date.parse("2026-08-12T12:00:00.000Z");
const REFRESH_SECRET = "test-refresh-secret-with-more-than-32-bytes";
const OPERATION_X = "00000000-0000-4000-8000-000000000001";
const OPERATION_Y = "00000000-0000-4000-8000-000000000002";
const OPERATION_Z = "00000000-0000-4000-8000-000000000003";

async function harness() {
  let now = START;
  const authorization = new InMemoryAuthorizationRepository();
  const sessions = new InMemoryDesktopSessionRepository();
  const access = new SessionTokenService("test-access-secret-with-more-than-32-bytes", authorization, () => now);
  const service = new DesktopSessionService(REFRESH_SECRET, sessions, authorization, access, () => now);
  const login = await service.issueForSteamIdentity(STEAM_ID, new Date(now).toISOString());
  const user = await authorization.findUserBySteamId(STEAM_ID);
  assert.ok(user);
  sessions.users.set(user.id, { accountStatus: user.accountStatus, sessionEpoch: user.sessionEpoch });
  return {
    authorization,
    sessions,
    service,
    login,
    user,
    advance(milliseconds: number) { now += milliseconds; },
    clock() { return now; }
  };
}

test("login stores only a SHA-256 digest and issues a 30-day desktop credential", async () => {
  const h = await harness();
  assert.match(h.login.refreshCredential, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(Date.parse(h.login.refreshExpiresAt) - START, 30 * 24 * 60 * 60_000);
  const stored = [...h.sessions.sessions.values()][0];
  assert.match(stored.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify([...h.sessions.sessions.values()]).includes(h.login.refreshCredential), false);
  assert.equal(Date.parse(h.login.sessionExpiresAt) - START, 15 * 60_000);
});

test("refresh rotates once and ten concurrent duplicates share one child", async () => {
  const h = await harness();
  const results = await Promise.all(Array.from(
    { length: 10 },
    () => h.service.refresh(h.login.refreshCredential, OPERATION_X)
  ));
  assert.equal(new Set(results.map((item) => item.refreshCredential)).size, 1);
  assert.equal(h.sessions.sessions.size, 2);
  const next = await h.service.refresh(results[0].refreshCredential, OPERATION_Y);
  assert.notEqual(next.refreshCredential, results[0].refreshCredential);
});

test("a lost response recovers the same child after the former eight-second grace", async () => {
  const h = await harness();
  const credentialA = h.login.refreshCredential;

  // The server committed A -> B, but the client never received this response.
  const lostResponse = await h.service.refresh(credentialA, OPERATION_X);
  const credentialB = lostResponse.refreshCredential;
  h.advance(60_000);

  // Retrying A with the persisted operation must recover the exact same B.
  const recoveredResponse = await h.service.refresh(credentialA, OPERATION_X);
  assert.equal(recoveredResponse.refreshCredential, credentialB);
  assert.equal(JSON.stringify([...h.sessions.sessions.values()]).includes(OPERATION_X), false);
  assert.match(
    [...h.sessions.sessions.values()].find((session) => session.generation === 0)?.refreshOperationHash ?? "",
    /^[a-f0-9]{64}$/
  );
  const children = [...h.sessions.sessions.values()].filter((session) => session.generation === 1);
  assert.equal(children.length, 1);
  assert.equal(h.sessions.sessions.size, 2);

  // Prove the recovered credential is usable by rotating B -> C.
  const credentialC = (await h.service.refresh(
    recoveredResponse.refreshCredential,
    OPERATION_Y
  )).refreshCredential;
  assert.notEqual(credentialC, credentialB);

  // A different operation cannot use the predecessor and revokes the family.
  await assert.rejects(
    h.service.refresh(credentialA, OPERATION_Z),
    (error: unknown) => error instanceof DesktopSessionError && error.code === "DESKTOP_SESSION_REUSED"
  );
  await assert.rejects(
    h.service.refresh(credentialC, OPERATION_Z),
    (error: unknown) => error instanceof DesktopSessionError && error.code === "DESKTOP_SESSION_REVOKED"
  );
});

test("a second backend instance recovers the same replacement from shared storage", async () => {
  const h = await harness();
  const first = await h.service.refresh(h.login.refreshCredential, OPERATION_X);
  h.advance(60_000);
  const secondAccess = new SessionTokenService(
    "test-access-secret-with-more-than-32-bytes",
    h.authorization,
    h.clock
  );
  const secondInstance = new DesktopSessionService(
    REFRESH_SECRET,
    h.sessions,
    h.authorization,
    secondAccess,
    h.clock
  );
  const recovered = await secondInstance.refresh(h.login.refreshCredential, OPERATION_X);
  assert.equal(recovered.refreshCredential, first.refreshCredential);
  assert.equal([...h.sessions.sessions.values()].filter((row) => row.generation === 1).length, 1);
});

test("missing operation on a rotated predecessor revokes its family", async () => {
  const h = await harness();
  const next = await h.service.refresh(h.login.refreshCredential, OPERATION_X);
  await assert.rejects(h.service.refresh(h.login.refreshCredential), (error: unknown) => error instanceof DesktopSessionError && error.code === "DESKTOP_SESSION_REUSED");
  await assert.rejects(h.service.refresh(next.refreshCredential, OPERATION_Y), (error: unknown) => error instanceof DesktopSessionError && error.code === "DESKTOP_SESSION_REVOKED");
});

test("missing operation cannot rotate a fresh credential", async () => {
  const h = await harness();
  await assert.rejects(
    h.service.refresh(h.login.refreshCredential),
    (error: unknown) => error instanceof DesktopSessionError && error.code === "DESKTOP_SESSION_INVALID"
  );
  assert.equal(h.sessions.sessions.size, 1);
  assert.ok(await h.service.refresh(h.login.refreshCredential, OPERATION_X));
});

test("the same operation cannot recover a predecessor after the bounded window", async () => {
  const h = await harness();
  const next = await h.service.refresh(h.login.refreshCredential, OPERATION_X);
  h.advance(10 * 60_000 + 1);
  await assert.rejects(
    h.service.refresh(h.login.refreshCredential, OPERATION_X),
    (error: unknown) => error instanceof DesktopSessionError && error.code === "DESKTOP_SESSION_REUSED"
  );
  await assert.rejects(
    h.service.refresh(next.refreshCredential, OPERATION_Y),
    (error: unknown) => error instanceof DesktopSessionError && error.code === "DESKTOP_SESSION_REVOKED"
  );
});

test("the original operation cannot resurrect a replacement that was already rotated", async () => {
  const h = await harness();
  const credentialB = (await h.service.refresh(
    h.login.refreshCredential,
    OPERATION_X
  )).refreshCredential;
  const credentialC = (await h.service.refresh(credentialB, OPERATION_Y)).refreshCredential;
  await assert.rejects(
    h.service.refresh(h.login.refreshCredential, OPERATION_X),
    (error: unknown) => error instanceof DesktopSessionError && error.code === "DESKTOP_SESSION_REUSED"
  );
  await assert.rejects(
    h.service.refresh(credentialC, OPERATION_Z),
    (error: unknown) => error instanceof DesktopSessionError && error.code === "DESKTOP_SESSION_REVOKED"
  );
});

test("expiration, account status, and session epoch are authoritative", async () => {
  const expired = await harness();
  expired.advance(30 * 24 * 60 * 60_000 + 1);
  await assert.rejects(expired.service.refresh(expired.login.refreshCredential, OPERATION_X), /DESKTOP_SESSION_EXPIRED/);
  for (const status of ["suspended", "disabled"] as const) {
    const blocked = await harness();
    await blocked.authorization.setAccountStatus({ userId: blocked.user.id, status });
    await assert.rejects(blocked.service.refresh(blocked.login.refreshCredential, OPERATION_X), (error: unknown) => error instanceof DesktopSessionError && error.code === "ACCOUNT_NOT_ACTIVE");
  }
  const revoked = await harness();
  await revoked.authorization.revokeSessions(revoked.user.id);
  await assert.rejects(revoked.service.refresh(revoked.login.refreshCredential, OPERATION_X), /DESKTOP_SESSION_REVOKED/);
});

test("logout is idempotent and prevents future refresh", async () => {
  const h = await harness();
  await h.service.logout(h.login.refreshCredential);
  await h.service.logout(h.login.refreshCredential);
  await assert.rejects(h.service.refresh(h.login.refreshCredential, OPERATION_X), /DESKTOP_SESSION_REVOKED/);
});

test("a sixth login revokes the oldest family", async () => {
  const h = await harness();
  const credentials = [h.login.refreshCredential];
  for (let index = 1; index < 6; index += 1) {
    h.advance(1_000);
    credentials.push((await h.service.issueForSteamIdentity(STEAM_ID, new Date(START).toISOString())).refreshCredential);
  }
  await assert.rejects(h.service.refresh(credentials[0], OPERATION_X), /DESKTOP_SESSION_REVOKED/);
  assert.ok(await h.service.refresh(credentials[5], OPERATION_X));
});

test("HTTP refresh is POST-only, private no-store, rate-limited, and never echoes credentials", async () => {
  const h = await harness();
  const config = { nodeEnv: "test", trustProxy: false } as AuthApiConfig;
  const limiter = new PollingRateLimiter({ minimumIntervalMs: 500 });
  const server = createServer((request, response) => {
    void handleDesktopSessions(
      request, response, new URL(request.url ?? "/", "http://localhost"),
      { sessions: h.service, rateLimiter: limiter, config }
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/v1/auth/desktop/refresh`;
  try {
    const refreshed = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: h.login.refreshCredential, operationId: OPERATION_X })
    });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.headers.get("cache-control"), "private, no-store");
    const text = await refreshed.text();
    assert.equal(text.includes(h.login.refreshCredential), false);
    assert.equal(text.includes(OPERATION_X), false);
    const limited = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: h.login.refreshCredential, operationId: OPERATION_X })
    });
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("retry-after"));
    assert.equal((await fetch(url)).status, 405);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("malformed, unknown, and database failures use bounded safe errors", async () => {
  const config = { nodeEnv: "test", trustProxy: false } as AuthApiConfig;
  const server = createServer((request, response) => {
    const sessions = {
      refresh: async (credential: string) => {
        if (credential === "database-failure") throw new Error("password=must-never-leak");
        throw new DesktopSessionError("DESKTOP_SESSION_INVALID");
      },
      logout: async () => undefined
    } as unknown as DesktopSessionService;
    void handleDesktopSessions(request, response, new URL(request.url ?? "/", "http://localhost"), {
      sessions, rateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0 }), config
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/v1/auth/desktop/refresh`;
  try {
    for (const body of ["not-json", JSON.stringify({ credential: "unknown", operationId: OPERATION_X })]) {
      const response = await fetch(url, { method: "POST", body });
      assert.equal(response.status, 401);
      assert.equal(await response.text(), '{"error":"DESKTOP_SESSION_INVALID"}');
    }
    const failed = await fetch(url, { method: "POST", body: JSON.stringify({ credential: "database-failure", operationId: OPERATION_X }) });
    assert.equal(failed.status, 503);
    const text = await failed.text();
    assert.equal(text, '{"error":"SESSION_REFRESH_FAILED"}');
    assert.equal(text.includes("password"), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
