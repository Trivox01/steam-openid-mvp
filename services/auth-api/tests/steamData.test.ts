import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { AuthTransactionService } from "../src/auth/authTransactionService.ts";
import { SessionTokenService } from "../src/authorization/sessionTokenService.ts";
import type { AuthApiConfig } from "../src/config.ts";
import { createRouter } from "../src/router.ts";
import { PollingRateLimiter } from "../src/security/pollingRateLimiter.ts";
import { noOpLogger } from "../src/security/safeLogger.ts";
import { SteamOpenIdVerifier } from "../src/steam/openIdVerifier.ts";
import type { SteamAssertionChecker } from "../src/steam/openIdTypes.ts";
import {
  SteamDataClient,
  SteamDataError,
  type SteamDataLogEntry
} from "../src/steam/steamDataClient.ts";
import {
  InMemoryAuthTransactionRepository
} from "../src/storage/authRepository.ts";
import { InMemoryAuthorizationRepository } from "../src/authorization/authorizationRepository.ts";

const STEAM_ID = "76561198000000000";
const API_KEY = "server-only-test-key-123456789";

test("successful achievement sync normalizes a 53-achievement payload", async () => {
  const logs: SteamDataLogEntry[] = [];
  const client = new SteamDataClient(API_KEY, steamFetch({
    schema: schemaPayload(53),
    player: playerPayload(53)
  }), { write: (entry) => logs.push(entry) });
  const result = await client.getGameAchievements(STEAM_ID, 2807960);
  assert.equal(result.appId, 2807960);
  assert.equal(result.achievements.length, 53);
  assert.equal(result.achievements[0].unlocked, true);
  assert.ok(logs.every((entry) =>
    !JSON.stringify(entry).includes(API_KEY) &&
    !JSON.stringify(entry).includes(STEAM_ID)
  ));
});

test("missing server key and invalid app id are explicit", async () => {
  await assert.rejects(
    new SteamDataClient(undefined, steamFetch({})).getGameAchievements(STEAM_ID, 10),
    (error: unknown) => error instanceof SteamDataError && error.code === "backend_not_configured"
  );
  await assert.rejects(
    new SteamDataClient(API_KEY, steamFetch({})).getGameAchievements(STEAM_ID, 0),
    (error: unknown) => error instanceof SteamDataError && error.code === "invalid_app_id"
  );
});

test("library sync uses the authenticated Steam identity and deduplicates AppIDs", async () => {
  const client = new SteamDataClient(API_KEY, async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("steamid"), STEAM_ID);
    return json({
      response: {
        game_count: 3,
        games: [
          { appid: 2807960, name: "Battlefield™ 6", playtime_forever: 120 },
          { appid: 2807960, name: "Battlefield™ 6", playtime_forever: 120 },
          { appid: 0, name: "Invalid" }
        ]
      }
    });
  });
  const result = await client.getOwnedGames(STEAM_ID);
  assert.equal(result.fetched, 3);
  assert.equal(result.games.length, 1);
  assert.equal(result.games[0].appId, 2807960);
});

test("Steam achievement availability failures retain precise codes", async () => {
  await expectCode({ schema: { game: { gameName: "No achievements", availableGameStats: {} } } }, "no_achievements");
  await expectCode({ schema: { game: null } }, "schema_unavailable");
  await expectCode({
    schema: schemaPayload(1),
    player: { playerstats: { success: false, error: "Requested app has no stats" } }
  }, "no_player_stats");
  await expectCode({
    schema: schemaPayload(1),
    player: { playerstats: { success: false, error: "User does not own this game" } }
  }, "game_not_owned");
  await expectCode({
    schema: schemaPayload(1),
    player: { playerstats: { success: false, error: "Profile is private" } }
  }, "private_library");
});

test("rate limits, timeouts, and malformed Steam payloads are sanitized", async () => {
  const rateLimited = new SteamDataClient(API_KEY, async () =>
    new Response("limited", { status: 429 })
  );
  await assert.rejects(
    rateLimited.getGameAchievements(STEAM_ID, 10),
    (error: unknown) => error instanceof SteamDataError && error.code === "rate_limited"
  );
  const timedOut = new SteamDataClient(API_KEY, async () => {
    throw new DOMException("timed out", "TimeoutError");
  });
  await assert.rejects(
    timedOut.getGameAchievements(STEAM_ID, 10),
    (error: unknown) => error instanceof SteamDataError && error.code === "timeout"
  );
  const malformed = new SteamDataClient(API_KEY, async () =>
    new Response("{", { status: 200, headers: { "content-type": "application/json" } })
  );
  await assert.rejects(
    malformed.getGameAchievements(STEAM_ID, 10),
    (error: unknown) => error instanceof SteamDataError && error.code === "invalid_response"
  );
});

test("authenticated route derives Steam identity from the Nexus session", async () => {
  const authorization = new InMemoryAuthorizationRepository();
  const sessions = new SessionTokenService(
    "test-session-secret-at-least-32-characters",
    authorization
  );
  const issued = await sessions.issueForSteamIdentity(STEAM_ID, new Date().toISOString());
  const transactionRepository = new InMemoryAuthTransactionRepository();
  const config: AuthApiConfig = {
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
  const checker: SteamAssertionChecker = {
    async checkAssertion() { return { ok: true, isValid: true }; }
  };
  const server = createServer(createRouter({
    config,
    transactions: new AuthTransactionService(transactionRepository),
    verifier: new SteamOpenIdVerifier(checker, { realm: config.openIdRealm }),
    rateLimiter: new PollingRateLimiter(),
    logger: noOpLogger,
    sessions,
    steamData: new SteamDataClient(API_KEY, steamFetch({
      schema: schemaPayload(53),
      player: playerPayload(53)
    })),
    steamDataRateLimiter: new PollingRateLimiter({ minimumIntervalMs: 0 })
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const unauthorized = await fetch(`${base}/api/steam/games/2807960/achievements/sync`, {
      method: "POST"
    });
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { error: "session_expired" });
    const authenticated = await fetch(`${base}/api/steam/games/2807960/achievements/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${issued.token}` }
    });
    assert.equal(authenticated.status, 200);
    const body = await authenticated.json() as { achievements: unknown[] };
    assert.equal(body.achievements.length, 53);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function expectCode(
  fixtures: { schema?: unknown; player?: unknown },
  code: string
) {
  const client = new SteamDataClient(API_KEY, steamFetch(fixtures));
  await assert.rejects(
    client.getGameAchievements(STEAM_ID, 10),
    (error: unknown) => error instanceof SteamDataError && error.code === code
  );
}

function steamFetch(fixtures: {
  schema?: unknown;
  player?: unknown;
  global?: unknown;
}) {
  return async (input: string | URL | Request) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("key") === API_KEY || !url.searchParams.has("key"), true);
    if (url.pathname.includes("GetSchemaForGame")) return json(fixtures.schema ?? schemaPayload(1));
    if (url.pathname.includes("GetPlayerAchievements")) return json(fixtures.player ?? playerPayload(1));
    if (url.pathname.includes("GetGlobalAchievement")) {
      return json(fixtures.global ?? { achievementpercentages: { achievements: [] } });
    }
    return json({ response: { game_count: 0, games: [] } });
  };
}

function schemaPayload(count: number) {
  return {
    game: {
      gameName: "Fixture",
      availableGameStats: {
        achievements: Array.from({ length: count }, (_, index) => ({
          name: `ACH_${index}`,
          displayName: `Achievement ${index}`,
          description: "",
          hidden: 0,
          icon: "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/10/icon.jpg",
          icongray: "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/10/gray.jpg"
        }))
      }
    }
  };
}

function playerPayload(count: number) {
  return {
    playerstats: {
      success: true,
      achievements: Array.from({ length: count }, (_, index) => ({
        apiname: `ACH_${index}`,
        achieved: index === 0 ? 1 : 0,
        unlocktime: index === 0 ? 1_700_000_000 : 0
      }))
    }
  };
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
