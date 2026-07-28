import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { shouldShowOnboarding, completeOnboardingPreferences } from "../src/features/onboarding/onboardingFlow.ts";
import { validateGameDetailsExperience } from "../src/services/gameDetailsValidation.ts";

const localeRoot = "src/locales";
const localeKeys = (language) => {
  const keys = new Set();
  for (const file of fs.readdirSync(path.join(localeRoot, language)).filter((name) => name.endsWith(".ts"))) {
    const source = fs.readFileSync(path.join(localeRoot, language, file), "utf8");
    for (const match of source.matchAll(/^\s*"([^"]+)":/gm)) keys.add(match[1]);
  }
  return keys;
};
const en = localeKeys("en");
const ar = localeKeys("ar");
assert.deepEqual([...en].filter((key) => !ar.has(key)), [], "Arabic locale is missing keys");
assert.deepEqual([...ar].filter((key) => !en.has(key)), [], "English locale is missing keys");

const css = fs.readFileSync("src/styles/index.css", "utf8");
const details = fs.readFileSync("src/pages/GameDetailsPage.tsx", "utf8");
const statistics = fs.readFileSync("src/pages/StatisticsPage.tsx", "utf8");
const navigation = fs.readFileSync("src/components/layout/Sidebar.tsx", "utf8");
const artwork = fs.readFileSync("src/components/ui/GameArtwork.tsx", "utf8");
const settings = fs.readFileSync("src/pages/SettingsPage.tsx", "utf8");
const enSteam = fs.readFileSync("src/locales/en/steam.ts", "utf8");
const arSteam = fs.readFileSync("src/locales/ar/steam.ts", "utf8");
const tauriMain = fs.readFileSync("src-tauri/src/main.rs", "utf8");
assert.doesNotMatch(css, /html\[dir=["']rtl["']\]\s+svg\s*\{/i, "RTL must not reset every SVG transform");
assert.doesNotMatch(css, /,\s*@media\b/, "CSS selector must not end immediately before an at-rule");
assert.match(css, /prefers-reduced-motion:reduce/);
assert.match(artwork, /image\?\.complete/);
assert.match(artwork, /image\.naturalWidth > 0/);
assert.match(settings, /event\.key === "Escape"/);
assert.match(settings, /confirmTriggerRef\.current\?\.focus\(\)/);
assert.match(settings, /aria-modal="true"/);
assert.match(enSteam, /"steam\.achievements\.summaryCounts": "\{\{completed\}\}/);
assert.match(arSteam, /"steam\.achievements\.summaryCounts": "اكتملت \{\{completed\}\}/);
assert.match(css, /\.game-v2-toolbar\s*\{[^}]*position:sticky/s);
assert.match(details, /aria-pressed=\{props\.filter === item\}/);
assert.match(details, /aria-pressed=\{props\.view === "grid"\}/);
assert.doesNotMatch(statistics, /\+4\.2% this month|WEEKLY ACTIVITY|MOST PLAYED|LEADERBOARD/);
assert.equal((navigation.match(/aria-current=/g) ?? []).length, 1);
assert.match(
  tauriMain,
  /#!\[cfg_attr\(not\(debug_assertions\),\s*windows_subsystem\s*=\s*"windows"\)\]/,
  "Windows release builds must use the GUI subsystem"
);

const preferences = {
  theme:"dark", language:"en", onboardingCompleted:false, sidebarCollapsed:false,
  launchAtStartup:false, minimizeToTray:false, notificationsEnabled:true,
  autoCheckForUpdates:true, hidePlaytime:false, hideHiddenGames:false
};
assert.equal(shouldShowOnboarding(false), true);
assert.equal(completeOnboardingPreferences(preferences).onboardingCompleted, true);
assert.equal(preferences.onboardingCompleted, false);
assert.equal(validateGameDetailsExperience(), 18);
console.log(`Product quality validation passed (${en.size} locale keys checked).`);
