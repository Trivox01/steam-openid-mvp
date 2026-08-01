import assert from "node:assert/strict";
import fs from "node:fs";
import { steamArtworkUrls } from "../src/services/platform/steamArtwork.ts";
import { mergeSteamLibrary } from "../src/services/platform/SteamLibraryMerge.ts";

const fixtures = [
  [2807960, "Battlefield 6"],
  [2920270, "Super Sus"],
  [570, "Dota 2"]
];

for (const [appId] of fixtures) {
  const artwork = steamArtworkUrls(appId);
  assert.match(artwork.coverUrl, new RegExp(`/apps/${appId}/library_600x900_2x\\.jpg$`));
  assert.equal(artwork.coverFallbackUrls.length, 1, "each image gets exactly one retry");
  assert.ok(artwork.coverFallbackUrls[0].endsWith(`/apps/${appId}/header.jpg`));
}

const oldUrl = "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/570/library_600x900_2x.jpg";
const cached = {
  id: "steam:570", appId: "570", platform: "steam", name: "Dota 2", coverUrl: oldUrl,
  backgroundUrl: "", playtimeHours: 1, totalAchievements: 0, unlockedAchievements: 0,
  completionPercentage: 0, lastPlayedAt: ""
};
const remote = { games: [{ appId: 570, name: "Dota 2", playtimeForeverMinutes: 60 }], fetched: 1, skipped: 0, warnings: [] };
const refreshed = mergeSteamLibrary([cached], remote, "2026-08-01T00:00:00.000Z");
assert.equal(refreshed.updated, 1);
assert.equal(refreshed.changedGames[0].coverUrl, steamArtworkUrls(570).coverUrl, "refresh repairs SQLite without clearing it");
assert.equal(mergeSteamLibrary([cached], { ...remote, games: [] }, "2026-08-01T00:00:00.000Z").changedGames.length, 0, "offline/empty results retain cached artwork");

const generator = fs.readFileSync("src/services/platform/steamArtwork.ts", "utf8");
assert.doesNotMatch(generator, /appId\s*={2,3}\s*2807960|case\s+2807960/);
const loader = fs.readFileSync("src/components/ui/GameArtwork.tsx", "utf8");
assert.match(loader, /loading=\{eager \? "eager" : "lazy"\}/);
assert.match(loader, /decoding="async"/);
assert.match(loader, /\.slice\(0, 2\)/, "loader must cap attempts to primary plus one retry");
assert.match(loader, /httpStatus: "unavailable"/);

console.log(`Steam artwork reliability validation passed (${fixtures.length} representative games).`);
