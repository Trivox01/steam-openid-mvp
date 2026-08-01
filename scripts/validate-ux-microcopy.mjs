import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const localeRoot = resolve("src/locales");
const publicFiles = ["common.ts", "gameCard.ts", "gameDetails.ts", "gameLauncher.ts", "intelligence.ts", "onboarding.ts", "profile.ts", "settings.ts", "smartLibrary.ts", "statistics.ts", "steam.ts"];

function entries(language) {
  const result = new Map();
  for (const file of publicFiles) {
    const text = readFileSync(resolve(localeRoot, language, file), "utf8");
    for (const match of text.matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) {
      assert.ok(!result.has(match[1]), `duplicate ${language} key: ${match[1]}`);
      result.set(match[1], match[2]);
    }
  }
  return result;
}

const en = entries("en");
const ar = entries("ar");
assert.deepEqual([...en.keys()].sort(), [...ar.keys()].sort(), "English and Arabic public keys must match");

const technical = /\b(?:API|Backend|SQLite|PostgreSQL|JSON|Cache|HTTP|Token|Manifest|Rate Limit|Auth|Endpoint|CSP|Rust|React|SteamID64)\b/i;
const coldCopy = /based on (?:the )?available data|data currently available|request completed|fetching|foundation ready|future phase|lorem|\bTBD\b|\bTODO\b/i;
const technicalArabic = /واجهة\s*(?:Web\s*)?API|مفتاح\s*(?:Steam\s*)?API|وفق البيانات المتاحة|البيانات المتاحة حاليًا|تقييد الطلبات|ذاكرة Rust|نسخة Tauri/;

for (const [key, value] of en) {
  assert.doesNotMatch(value, technical, `technical language in public English copy: ${key}`);
  assert.doesNotMatch(value, coldCopy, `placeholder or developer-style English copy: ${key}`);
}
for (const [key, value] of ar) {
  assert.doesNotMatch(value, technicalArabic, `technical language in public Arabic copy: ${key}`);
}

const canonical = new Map([
  ["gameCard.sync.updated", ["Updated", "محدّثة"]],
  ["gameCard.sync.needsUpdate", ["Needs update", "تحتاج إلى تحديث"]],
  ["gameCard.sync.saved", ["Using saved data", "بيانات محفوظة"]],
  ["gameLauncher.installed", ["Play", "تشغيل"]],
  ["gameLauncher.owned_not_installed", ["Install via Steam", "تثبيت عبر Steam"]],
  ["gameLauncher.not_owned", ["View in Steam", "عرض في Steam"]]
]);
for (const [key, [english, arabic]] of canonical) {
  assert.equal(en.get(key), english, `${key} must stay consistent in English`);
  assert.equal(ar.get(key), arabic, `${key} must stay consistent in Arabic`);
}

const publicTsx = readdirSync(resolve("src/pages")).filter(file => file.endsWith(".tsx") && file !== "DeveloperCenterPage.tsx")
  .map(file => readFileSync(resolve("src/pages", file), "utf8")).join("\n");
assert.doesNotMatch(publicTsx, /Foundation ready|future release|future phase|based on available data/i);
assert.match(readFileSync(resolve("src/styles/index.css"), "utf8"), /html\[dir="rtl"\]/, "RTL support must remain present");

console.log(`UX microcopy validation passed (${en.size} bilingual public strings).`);
