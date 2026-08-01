import assert from "node:assert/strict";
import fs from "node:fs";
import { GameLauncherService } from "../src/services/GameLauncherService.ts";

assert.equal(GameLauncherService.buildLaunchUri("2807960"), "steam://run/2807960");
for (const invalid of ["", "0", "-1", "12.3", "1/2", "4294967296", "abc"]) {
  assert.throws(() => GameLauncherService.buildLaunchUri(invalid), /invalid_app_id/);
}

let resolveOpen;
const calls = [];
const pendingTransport = { open: (uri) => { calls.push(uri); return new Promise((resolve) => { resolveOpen = resolve; }); } };
const launcher = new GameLauncherService(pendingTransport, undefined, () => true, undefined, 0);
const first = launcher.launch("578080");
const duplicate = launcher.launch("578080");
assert.equal(first, duplicate, "duplicate clicks join the same launch task");
await Promise.resolve();
assert.equal(launcher.getSnapshot("578080").status, "launching");
resolveOpen();
assert.equal((await first).result, "launchRequested");
assert.deepEqual(calls, ["steam://run/578080"]);

const retryCalls = [];
const retryLauncher = new GameLauncherService({ open: async (uri) => {
  retryCalls.push(uri);
  if (retryCalls.length === 1) throw new Error("handler unavailable");
}}, undefined, () => true, undefined, 0);
assert.equal((await retryLauncher.launch("2807960")).result, "launchRequested");
assert.deepEqual(retryCalls, ["steam://run/2807960", "steam://open/main", "steam://run/2807960"]);

const missing = new GameLauncherService({ open: async () => { throw new Error("missing"); } }, undefined, () => true, undefined, 0);
assert.equal((await missing.launch("2913300")).status, "steamNotInstalled");
const running = new GameLauncherService({ open: async () => assert.fail("must not relaunch") }, { getState: async () => "running" });
assert.equal((await running.launch("578080")).status, "alreadyRunning");
const offline = new GameLauncherService({ open: async () => undefined }, undefined, () => false);
assert.equal((await offline.launch("578080")).status, "offline");

const card = fs.readFileSync("src/components/games/GameCard.tsx", "utf8");
const details = fs.readFileSync("src/pages/GameDetailsPage.tsx", "utf8");
const button = fs.readFileSync("src/components/games/PlayButton.tsx", "utf8");
const styles = fs.readFileSync("src/styles/index.css", "utf8");
assert.match(card, /<PlayButton/);
assert.match(details, /<PlayButton/);
assert.match(button, /event\.stopPropagation\(\)/);
assert.match(button, /aria-busy/);
assert.match(styles, /prefers-reduced-motion:reduce/);
assert.match(styles, /forced-colors:active/);
assert.doesNotMatch(`${card}\n${details}\n${button}`, /openUrl\(|steam:\/\/run\//, "components contain no direct launch logic");
console.log("Game Launcher service, retry, deduplication, UI integration and accessibility validated.");
