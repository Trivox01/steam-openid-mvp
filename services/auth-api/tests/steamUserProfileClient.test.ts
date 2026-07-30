import assert from "node:assert/strict";
import test from "node:test";
import { SteamUserProfileClient } from "../src/steam/steamUserProfileClient.ts";

const STEAM_ID = "76561198190954413";

test("maps the verified Steam player summary", async () => {
  let requestedUrl = "";
  const diagnostics: unknown[] = [];
  const client = new SteamUserProfileClient("server-secret-key", async (input) => {
    requestedUrl = String(input);
    return Response.json({
      response: {
        players: [{
          steamid: STEAM_ID,
          personaname: " Trivox ",
          avatarfull: "https://avatars.steamstatic.com/profile_hash_full.jpg"
        }]
      }
    });
  }, { write(entry) { diagnostics.push(entry); } });

  assert.deepEqual(await client.get(STEAM_ID), {
    steamNickname: "Trivox",
    avatarUrl: "https://avatars.steamstatic.com/profile_hash_full.jpg"
  });
  assert.match(requestedUrl, /ISteamUser\/GetPlayerSummaries\/v2/);
  assert.match(requestedUrl, /steamids=76561198190954413/);
  assert.deepEqual(diagnostics, [{
    event: "steam_profile_summary",
    responseStatus: 200,
    playerCount: 1,
    matchingPlayer: true
  }]);
});

test("rejects a player summary for a different Steam identity", async () => {
  const client = new SteamUserProfileClient("server-secret-key", async () =>
    Response.json({ response: { players: [{
      steamid: "76561198000000000",
      personaname: "Another user",
      avatarfull: "https://avatars.steamstatic.com/profile_hash_full.jpg"
    }] } })
  );
  assert.equal(await client.get(STEAM_ID), undefined);
});

test("keeps a valid name but drops an avatar from an untrusted host", async () => {
  const client = new SteamUserProfileClient("server-secret-key", async () =>
    Response.json({ response: { players: [{
      steamid: STEAM_ID,
      personaname: "Trivox",
      avatarfull: "https://example.test/avatar.jpg"
    }] } })
  );
  assert.deepEqual(await client.get(STEAM_ID), { steamNickname: "Trivox" });
});

test("returns no profile for malformed or unsuccessful responses", async () => {
  const malformed = new SteamUserProfileClient("server-secret-key", async () =>
    Response.json({ response: { players: "invalid" } })
  );
  const failed = new SteamUserProfileClient("server-secret-key", async () =>
    new Response(null, { status: 503 })
  );
  assert.equal(await malformed.get(STEAM_ID), undefined);
  assert.equal(await failed.get(STEAM_ID), undefined);
});
