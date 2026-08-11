import fs from "node:fs";
import assert from "node:assert/strict";

const coordinator = fs.readFileSync("src/features/updates/UpdateCoordinator.ts", "utf8");
const experience = fs.readFileSync("src/features/updates/UpdateExperience.tsx", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");
const settings = fs.readFileSync("src/pages/SettingsPage.tsx", "utf8");
const capability = fs.readFileSync("src-tauri/capabilities/default.json", "utf8");
const notes = fs.readFileSync("src/features/updates/releaseNotes.ts", "utf8");
const lib = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const registrationTest = fs.readFileSync("src-tauri/tests/plugin_registration.rs", "utf8");
const tauriConfig = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));

assert.match(coordinator, /allowDowngrades:\s*false/, "downgrades must be rejected");
assert.match(coordinator, /private pending\?: Promise<void>/, "checks and installs need one concurrency gate");
assert.match(coordinator, /timeout:\s*10_000/, "update checks need a bounded timeout");
assert.match(experience, /downloadAndInstall\(\)/, "installation must require a UI action");
assert.doesNotMatch(app, /plugin-updater/, "App must not bypass UpdateCoordinator");
assert.match(app, /updateCoordinator\.check\("tray"\)/, "tray must use UpdateCoordinator");
assert.match(settings, /updateCoordinator\.check\("settings"\)/, "settings must use UpdateCoordinator");
assert.match(capability, /updater:allow-check/);
assert.match(capability, /updater:allow-download-and-install/);

// A dependency in Cargo.toml plus ACL permissions does not give the updater any state
// or IPC commands: it must be handed to the builder, otherwise `check()` fails at
// runtime with "updater.check not allowed. Plugin not found".
assert.match(lib, /\.plugin\(tauri_plugin_updater::Builder::new\(\)\.build\(\)\)/, "tauri-plugin-updater must be registered in the Tauri builder");
assert.match(lib, /pub fn register_plugins</, "plugin registration must stay in one testable function");
assert.match(registrationTest, /fn updater_plugin_is_registered_in_the_builder/, "registration must be covered by a cargo test");
assert.match(registrationTest, /register_plugins\(mock_builder\(\)\)/, "the registration test must build the app through register_plugins");

// The updater plugin's config requires `pubkey`, so an absent `plugins.updater` block
// makes plugin initialization fail. The committed placeholder keeps dev and test builds
// working; the real key and endpoint are injected at release time only.
assert.deepEqual(tauriConfig.plugins?.updater, { pubkey: "", endpoints: [] }, "committed config must hold an empty updater placeholder, never a real key or endpoint");

assert.equal(fs.existsSync("src-tauri/tauri.release.conf.json"), false, "generated updater config must not be present locally");
assert.match(notes, /"0\.1\.0-beta\.1"/);
assert.match(notes, /"0\.1\.0-beta\.2"/);
console.log("Update architecture validation passed.");
