import { validateSteamAchievementSync } from "../src/services/platform/steamAchievementValidation.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const assertions = await validateSteamAchievementSync();
const [page, en, ar, rustClient, rustCommand, service] = await Promise.all([
  readFile(new URL("../src/pages/GameDetailsPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/locales/en/gameDetails.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/locales/ar/gameDetails.ts", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/steam/client.rs", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/steam_commands.rs", import.meta.url), "utf8"),
  readFile(new URL("../src/services/platform/SteamAchievementSyncService.ts", import.meta.url), "utf8")
]);
for (const key of [
  "apiUnavailable", "apiKeyMissing", "noAchievements", "notOwned",
  "timeout", "rateLimited", "sessionExpired"
]) {
  assert.match(page, new RegExp(`gameDetails\\.sync\\.${key}`));
  assert.match(en, new RegExp(`gameDetails\\.sync\\.${key}`));
  assert.match(ar, new RegExp(`gameDetails\\.sync\\.${key}`));
}
assert.match(rustClient, /http_status=/);
assert.match(rustClient, /duration_ms=/);
assert.match(rustCommand, /achievements_received=/);
assert.match(service, /stage:\s*"steam"\s*\|\s*"sqlite"/);
assert.match(service, /httpStatus/);
assert.doesNotMatch(service, /apiKey|pollSecret|sessionToken/);

console.log(`Steam achievement validation passed (${assertions + 12} assertions).`);
