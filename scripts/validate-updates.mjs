import fs from "node:fs";
import assert from "node:assert/strict";

const coordinator = fs.readFileSync("src/features/updates/UpdateCoordinator.ts", "utf8");
const experience = fs.readFileSync("src/features/updates/UpdateExperience.tsx", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");
const settings = fs.readFileSync("src/pages/SettingsPage.tsx", "utf8");
const capability = fs.readFileSync("src-tauri/capabilities/default.json", "utf8");
const notes = fs.readFileSync("src/features/updates/releaseNotes.ts", "utf8");

assert.match(coordinator, /allowDowngrades:\s*false/, "downgrades must be rejected");
assert.match(coordinator, /private pending\?: Promise<void>/, "checks and installs need one concurrency gate");
assert.match(coordinator, /timeout:\s*10_000/, "update checks need a bounded timeout");
assert.match(experience, /downloadAndInstall\(\)/, "installation must require a UI action");
assert.doesNotMatch(app, /plugin-updater/, "App must not bypass UpdateCoordinator");
assert.match(app, /updateCoordinator\.check\("tray"\)/, "tray must use UpdateCoordinator");
assert.match(settings, /updateCoordinator\.check\("settings"\)/, "settings must use UpdateCoordinator");
assert.match(capability, /updater:allow-check/);
assert.match(capability, /updater:allow-download-and-install/);
assert.equal(fs.existsSync("src-tauri/tauri.release.conf.json"), false, "generated updater config must not be present locally");
assert.match(notes, /"0\.1\.0-beta\.1"/);
assert.match(notes, /"0\.1\.0-beta\.2"/);
console.log("Update architecture validation passed.");
