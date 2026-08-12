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

async function harness() {
  let now = START;
  const authorization = new InMemoryAuthorizationRepository();
  const sessions = new InMemoryDesktopSessionRepository();
  const access = new SessionTokenService("test-access-secret-with-more-than-32-bytes", authorization, () => now);
  const service = new DesktopSessionService("test-refresh-secret-with-more-than-32-bytes", sessions, authorization, access, () => now);
  const login = await service.issueForSteamIdentity(STEAM_ID, new Date(now).toISOString());
  const user = await authorization.findUserBySteamId(STEAM_ID);
  assert.ok(user);
  sessions.users.set(user.id, { accountStatus: user.accountStatus, sessionEpoch: user.sessionEpoch });
  return { authorization, sessions, service, login, user, advance(milliseconds: number) { now += milliseconds; } };
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
  const results = await Promise.all(Array.from({ length: 10 }, () => h.service.refresh(h.login.refreshCredential)));
  assert.equal(new Set(results.map((item) => item.refreshCredential)).size, 1);
  assert.equal(h.sessions.sessions.size, 2);
  const next = await h.service.refresh(results[0].refreshCredential);
  assert.notEqual(next.refreshCredential, results[0].refreshCredential);
});

test("a lost refresh response is recovered with the same valid child inside grace", async () => {
  const h = await harness();
  const credentialA = h.login.refreshCredential;

  // The server committed A -> B, but the client never received this response.
  const lostResponse = await h.service.refresh(credentialA);
  const credentialB = lostResponse.refreshCredential;
  h.advance(4_000);

  // Retrying A must recover the exact same B rather than minting another child.
  const recoveredResponse = await h.service.refresh(credentialA);
  assert.equal(recoveredResponse.refreshCredential, credentialB);
  const children = [...h.sessions.sessions.values()].filter((session) => session.generation === 1);
  assert.equal(children.length, 1);
  assert.equal(h.sessions.sessions.size, 2);

  // Prove the recovered credential is usable by rotating B -> C.
  const credentialC = (await h.service.refresh(recoveredResponse.refreshCredential)).refreshCredential;
  assert.notEqual(credentialC, credentialB);

  // Once A is outside its grace window, replay is treated as reuse and revokes
  // the family, including the otherwise-current C credential.
  h.advance(4_001);
  await assert.rejects(
    h.service.refresh(credentialA),
    (error: unknown) => error instanceof DesktopSessionError && error.code === "DESKTOP_SESSION_REUSED"
  );
  await assert.rejects(
    h.service.refresh(credentialC),
    (error: unknown) => error instanceof DesktopSessionError && error.code === "DESKTOP_SESSION_REVOKED"
  );
});

test("old credential reuse outside the eight-second grace revokes its family", async () => {
  const h = await harness();
  const next = await h.service.refresh(h.login.refreshCredential);
  h.advance(8_001);
  await assert.rejects(h.service.refresh(h.login.refreshCredential), (error: unknown) => error instanceof DesktopSessionError && error.code === "DESKTOP_SESSION_REUSED");
  await assert.rejects(h.service.refresh(next.refreshCredential), (error: unknown) => error instanceof DesktopSessionError && error.code === "DESKTOP_SESSION_REVOKED");
});

test("expiration, account status, and session epoch are authoritative", async () => {
  const expired = await harness();
  expired.advance(30 * 24 * 60 * 60_000 + 1);
  await assert.rejects(expired.service.refresh(expired.login.refreshCredential), /DESKTOP_SESSION_EXPIRED/);
  for (const status of ["suspended", "disabled"] as const) {
    const blocked = await harness();
    await blocked.authorization.setAccountStatus({ userId: blocked.user.id, status });
    await assert.rejects(blocked.service.refresh(blocked.login.refreshCredential), (error: unknown) => error instanceof DesktopSessionError && error.code === "ACCOUNT_NOT_ACTIVE");
  }
  const revoked = await harness();
  await revoked.authorization.revokeSessions(revoked.user.id);
  await assert.rejects(revoked.service.refresh(revoked.login.refreshCredential), /DESKTOP_SESSION_REVOKED/);
});

test("logout is idempotent and prevents future refresh", async () => {
  const h = await harness();
  await h.service.logout(h.login.refreshCredential);
  await h.service.logout(h.login.refreshCredential);
  await assert.rejects(h.service.refresh(h.login.refreshCredential), /DESKTOP_SESSION_REVOKED/);
});

test("a sixth login revokes the oldest family", async () => {
  const h = await harness();
  const credentials = [h.login.refreshCredential];
  for (let index = 1; index < 6; index += 1) {
    h.advance(1_000);
    credentials.push((await h.service.issueForSteamIdentity(STEAM_ID, new Date(START).toISOString())).refreshCredential);
  }
  await assert.rejects(h.service.refresh(credentials[0]), /DESKTOP_SESSION_REVOKED/);
  assert.ok(await h.service.refresh(credentials[5]));
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
      body: JSON.stringify({ credential: h.login.refreshCredential })
    });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.headers.get("cache-control"), "private, no-store");
    const text = await refreshed.text();
    assert.equal(text.includes(h.login.refreshCredential), false);
    const limited = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: h.login.refreshCredential })
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
    for (const body of ["not-json", JSON.stringify({ credential: "unknown" })]) {
      const response = await fetch(url, { method: "POST", body });
      assert.equal(response.status, 401);
      assert.equal(await response.text(), '{"error":"DESKTOP_SESSION_INVALID"}');
    }
    const failed = await fetch(url, { method: "POST", body: JSON.stringify({ credential: "database-failure" }) });
    assert.equal(failed.status, 503);
    const text = await failed.text();
    assert.equal(text, '{"error":"SESSION_REFRESH_FAILED"}');
    assert.equal(text.includes("password"), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
