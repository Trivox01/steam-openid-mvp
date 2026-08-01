import assert from "node:assert/strict";
import fs from "node:fs";
import { isMeaningfulArtworkPixels } from "../src/services/platform/artworkContent.ts";
import {
  normalizeSteamArtworkUrl,
  steamArtworkSources,
  steamArtworkUrls
} from "../src/services/platform/steamArtwork.ts";
import { mergeSteamLibrary } from "../src/services/platform/SteamLibraryMerge.ts";

const fixtures = [
  [2807960, "Battlefield 6"],
  [2920270, "Super Sus"],
  [578080, "PUBG"],
  [570, "Dota 2"]
];

for (const [appId] of fixtures) {
  const artwork = steamArtworkUrls(appId);
  assert.match(artwork.coverUrl, new RegExp(`/apps/${appId}/library_600x900_2x\\.jpg$`));
  const cover = steamArtworkSources({ appId, kind: "cover", storedUrl: artwork.coverUrl });
  const hero = steamArtworkSources({ appId, kind: "hero", storedUrl: artwork.backgroundUrl });
  const square = steamArtworkSources({ appId, kind: "square" });
  assert.deepEqual(cover.map((item) => item.kind), [
    "portrait-stored", "library-capsule-portrait", "header-crop", "library-hero-crop"
  ]);
  assert.deepEqual(hero.map((item) => item.kind), ["hero-stored", "header", "main-capsule"]);
  assert.deepEqual(square.map((item) => item.kind), ["library-logo", "small-capsule-crop", "library-hero-crop", "header-crop"]);
  assert.ok([...cover, ...hero, ...square].every((item) => item.url.startsWith("https://")));
}

const withIcon = steamArtworkSources({
  appId: 570,
  kind: "square",
  iconUrl: "https://media.steampowered.com/steamcommunity/public/images/apps/570/abc123.jpg"
});
assert.equal(withIcon[0].kind, "app-icon");
assert.equal(steamArtworkSources({ appId: 570, kind: "square" }).some((item) => item.kind === "app-icon"), false);
assert.equal(new Set(withIcon.map((item) => item.url)).size, withIcon.length, "fallbacks must not loop");
assert.ok(withIcon.length <= 6, "fallback attempts must remain bounded");

const flat = new Uint8ClampedArray(16 * 16 * 4);
for (let index = 0; index < flat.length; index += 4) {
  flat[index] = 72; flat[index + 1] = 72; flat[index + 2] = 72; flat[index + 3] = 255;
}
const varied = flat.slice();
varied[0] = 0;
varied[4] = 255;
assert.equal(isMeaningfulArtworkPixels(flat), false, "HTTP 200 uniform placeholders must be rejected");
assert.equal(isMeaningfulArtworkPixels(varied), true, "real visual variation must be accepted");

const oldUrl = "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/570/library_600x900_2x.jpg";
assert.equal(normalizeSteamArtworkUrl(oldUrl), "https://shared.steamstatic.com/store_item_assets/steam/apps/570/library_600x900_2x.jpg");
const cached = {
  id: "steam:570", appId: "570", platform: "steam", name: "Dota 2", coverUrl: oldUrl,
  backgroundUrl: oldUrl.replace("library_600x900_2x", "library_hero"), playtimeHours: 1,
  totalAchievements: 0, unlockedAchievements: 0, completionPercentage: 0, lastPlayedAt: "", favorite: true
};
const remote = { games: [{ appId: 570, name: "Dota 2", playtimeForeverMinutes: 60 }], fetched: 1, skipped: 0, warnings: [] };
const refreshed = mergeSteamLibrary([cached], remote, "2026-08-01T00:00:00.000Z");
assert.equal(refreshed.updated, 1);
assert.equal(refreshed.changedGames[0].coverUrl, steamArtworkUrls(570).coverUrl, "refresh repairs SQLite without clearing it");
assert.equal(refreshed.changedGames[0].favorite, true, "artwork repair must preserve user data");
assert.equal(mergeSteamLibrary([cached], { ...remote, games: [] }, "2026-08-01T00:00:00.000Z").changedGames.length, 0, "offline retains cached artwork");

const generator = fs.readFileSync("src/services/platform/steamArtwork.ts", "utf8");
assert.doesNotMatch(generator, /appId\s*={2,3}\s*2807960|case\s+2807960/);
const loader = fs.readFileSync("src/components/ui/GameArtwork.tsx", "utf8");
assert.match(loader, /loading=\{eager \? "eager" : "lazy"\}/);
assert.match(loader, /decoding="async"/);
assert.match(loader, /visually_empty_image/);
assert.match(loader, /sourceIndex \+ 1 < sources\.length/);
assert.match(loader, /return \(\) => \{ generationRef\.current \+= 1; \}/, "unmount must invalidate pending content checks");
assert.match(loader, /httpStatus: "unavailable_in_webview"/);

const details = fs.readFileSync("src/pages/GameDetailsPage.tsx", "utf8");
assert.match(details, /kind: "hero"/);
assert.match(details, /kind: "cover"/);
assert.match(details, /variant="cover"/);
assert.match(details, /componentName="GameDetailsCover"/);
assert.doesNotMatch(details, /GameDetailsSquare|src=\{game\.iconUrl \|\| game\.coverUrl\}/);
const card = fs.readFileSync("src/components/games/GameCard.tsx", "utf8");
assert.match(card, /kind: "cover"/);

console.log(`Steam artwork pipeline validation passed (${fixtures.length} representative games).`);
