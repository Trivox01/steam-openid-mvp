import assert from "node:assert/strict";
import fs from "node:fs";
import { defaultPreferences, normalizePreferences, preferencesEqual } from "../src/services/settingsPreferences.ts";

assert.equal(defaultPreferences.discordPresenceEnabled, false, "Discord sharing must default to off");
assert.equal(defaultPreferences.discordShowGameName, true);
assert.equal(defaultPreferences.discordShowAchievementProgress, true);
assert.equal(defaultPreferences.discordShowSessionDuration, true);

const normalized = normalizePreferences({
  ...defaultPreferences,
  discordPresenceEnabled: true,
  discordShowGameName: false,
  discordShowAchievementProgress: false,
  discordShowSessionDuration: false
});
assert.equal(normalized.discordPresenceEnabled, true, "Discord preference persists");
assert.equal(normalized.discordShowGameName, false, "game-name privacy preference persists");
assert.equal(normalized.discordShowAchievementProgress, false, "progress privacy preference persists");
assert.equal(normalized.discordShowSessionDuration, false, "duration privacy preference persists");
assert.equal(preferencesEqual(normalized, { ...normalized }), true);
assert.equal(preferencesEqual(normalized, { ...normalized, discordPresenceEnabled: false }), false);

const rust = fs.readFileSync("src-tauri/src/discord_presence.rs", "utf8");
const lib = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const sessions = fs.readFileSync("src-tauri/src/game_session.rs", "utf8");
const bridge = fs.readFileSync("src/services/DiscordPresenceBridge.ts", "utf8");
const settings = fs.readFileSync("src/pages/SettingsPage.tsx", "utf8");
const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
const docs = fs.readFileSync("docs/integrations/DISCORD_RICH_PRESENCE.md", "utf8");
const en = fs.readFileSync("src/locales/en/settings.ts", "utf8");
const ar = fs.readFileSync("src/locales/ar/settings.ts", "utf8");

assert.match(cargo, /discord-presence = "3\.2"/);
assert.match(rust, /option_env!\("DISCORD_APPLICATION_ID"\)/, "Application ID has no invented fallback");
assert.match(rust, /session\.state == "playing"/, "only confirmed sessions are eligible");
assert.match(rust, /ActivityTimestamps::new\(\)\.start\(started_at\)/, "Discord owns elapsed-time rendering");
assert.match(rust, /\*total > 0 && \*unlocked >= 0 && \*unlocked <= \*total/);
assert.match(rust, /Client::with_error_config[\s\S]*RECONNECT_DELAY[\s\S]*RECONNECT_ATTEMPTS/);
assert.match(rust, /RETRY_WATCHDOG_DELAY: Duration = Duration::from_secs\(40\)/);
assert.match(rust, /LONG_RECONNECT_DELAY: Duration = Duration::from_secs\(300\)/);
assert.match(rust, /recv_timeout\(wait\)/, "reconnect waits are event-driven, not a fast poll");
assert.match(rust, /last_fingerprint\.as_ref\(\) != Some\(&next\)/, "equal activity is deduplicated");
assert.match(rust, /queue_activity/, "the dependency rate limiter is used");
assert.match(rust, /large_image\(LOGO_ASSET_KEY\)/);
assert.doesNotMatch(rust.slice(0, rust.indexOf("#[cfg(test)]")), /\.buttons\(|https?:\/\//, "production payload has no buttons or URLs");
assert.match(sessions, /discord_presence::refresh_from_app\(app, false\)/, "session transitions refresh presence internally");
assert.match(lib, /WindowEvent::Focused\(true\)[\s\S]*discord_presence::refresh_from_app\(window\.app_handle\(\), true\)/);
assert.match(lib, /DiscordPresenceManager>[\s\S]*\.shutdown\(\)/, "real quit cleans up the manager");
assert.match(bridge, /discord_presence_configure/);
assert.match(bridge, /discord_presence_refresh/);
assert.doesNotMatch(bridge, /details|state:|buttons|url/i, "React cannot submit activity payload fields");
assert.match(settings, /disabled=\{!draft\.discordPresenceEnabled\}/);
assert.match(en, /"settings\.discordStatus": "Discord status"/);
assert.match(ar, /"settings\.discordStatus": "حالة Discord"/);
assert.match(docs, /does not use Discord OAuth, a bot, account linking, access tokens/);

console.log("Discord Rich Presence privacy defaults, typed boundary, lifecycle, dedupe, throttling, retry, settings and localization validated.");
