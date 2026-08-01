import { validateSteamAchievementSync } from "../src/services/platform/steamAchievementValidation.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const assertions = await validateSteamAchievementSync();
const [page, en, ar, backendClient, desktopClient, service] = await Promise.all([
  readFile(new URL("../src/pages/GameDetailsPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/locales/en/gameDetails.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/locales/ar/gameDetails.ts", import.meta.url), "utf8"),
  readFile(new URL("../services/auth-api/src/steam/steamDataClient.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/services/platform/SteamBackendDataClient.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/services/platform/SteamAchievementSyncService.ts", import.meta.url), "utf8")
]);
for (const key of [
  "apiUnavailable", "apiKeyMissing", "noAchievements", "notOwned",
  "noPlayerStats", "schemaUnavailable", "invalidAppId",
  "timeout", "rateLimited", "sessionExpired", "storageFailed"
]) {
  assert.match(en, new RegExp(`gameDetails\\.sync\\.${key}`));
  assert.match(ar, new RegExp(`gameDetails\\.sync\\.${key}`));
}
assert.match(backendClient, /GetSchemaForGame\/v2/);
assert.match(backendClient, /GetPlayerAchievements\/v1/);
assert.match(desktopClient, /authorization: `Bearer \$\{session\.token\}`/);
assert.doesNotMatch(desktopClient, /api\.steampowered\.com/);
assert.match(service, /stage:\s*"steam"\s*\|\s*"sqlite"/);
assert.match(service, /stage === "sqlite" \? "database" : "request"/);
assert.match(service, /httpStatus/);
assert.doesNotMatch(service, /apiKey|pollSecret|sessionToken/);

console.log(`Steam achievement validation passed (${assertions + 18} assertions).`);
