import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const component = readFileSync(new URL("../src/components/ui/AchievementIcon.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/index.css", import.meta.url), "utf8");
const assetUrl = new URL("../src/assets/nexus-achievement-fallback.png", import.meta.url);
const png = readFileSync(assetUrl);
const consumers = [
  "../src/pages/DashboardPage.tsx",
  "../src/pages/StatisticsPage.tsx",
  "../src/components/dashboard/AchievementCard.tsx",
  "../src/components/achievements/AchievementListCard.tsx",
  "../src/components/achievements/AchievementExperienceCard.tsx",
  "../src/components/achievements/AchievementDetailsDialog.tsx"
].map(path => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

assert.equal(png.toString("ascii", 1, 4), "PNG");
assert.equal(png.readUInt32BE(16), 192);
assert.equal(png.readUInt32BE(20), 192);
assert.equal(png[25], 6, "fallback PNG must include alpha");
assert.ok(statSync(assetUrl).size < 40_000, "fallback must remain compressed and small");

assert.match(component, /useFallback = !src \|\| failed/, "missing src and failed Steam image must use fallback");
assert.match(component, /onError=\{useFallback \? undefined/, "fallback must not enter a retry loop");
assert.match(component, /loading = "lazy"/);
assert.match(component, /decoding = "async"/);
assert.match(component, /draggable=\{false\}/);
assert.match(component, /Math\.min\(inner, naturalSize\)/, "low-resolution images must not be excessively enlarged");
assert.match(component, /useEffect\([^]*\}, \[src\]\)/, "load state must reset only when src changes");
assert.match(component, /data-achievement-icon-source=\{useFallback \? "nexus-fallback" : "steam"\}/);

assert.match(css, /--achievement-icon-size,48px/);
assert.match(css, /--achievement-icon-inner,44px/);
assert.match(css, /achievement-icon--compact/);
assert.match(css, /border-radius:11px/);
assert.match(css, /object-fit:contain/);
assert.match(css, /forced-colors:active[^}]*\.achievement-icon/);
assert.match(css, /@media\(max-width:560px\)[^{]*\{\.achievement-icon/);
assert.match(consumers, /AchievementIcon[^>]*size=\{56\}[^>]*loading="eager"/, "details modal must request its fixed desktop frame");
assert.match(css, /\.achievement-dialog-hero\{width:56px;margin:8px auto 12px\}/);
assert.match(css, /\.achievement-dialog-hero \.achievement-icon\{--achievement-icon-size:56px!important;--achievement-icon-inner:48px!important/);
assert.match(css, /\.achievement-dialog-hero \.achievement-icon>img\{inline-size:48px;block-size:48px[^}]*object-fit:contain/);
assert.match(css, /@media\(max-width:560px\)[^}]*\.achievement-dialog-hero\{width:48px[^}]*\}\.achievement-dialog-hero \.achievement-icon\{--achievement-icon-size:48px!important;--achievement-icon-inner:42px!important/);
assert.match(css, /\.achievement-dialog \.dialog-close\{right:auto;inset-inline-end:14px\}/, "close button must stay in its logical corner for RTL and LTR");

assert.equal((consumers.match(/<AchievementIcon/g) ?? []).length, 6, "all current achievement image surfaces must use the shared component");
assert.doesNotMatch(consumers, /<img\s+src=\{(?:achievement|details|nextAchievement)\.iconUrl/, "achievement consumers must not bypass fallback handling");

console.log("Steam-first achievement icons, low-resolution sizing and Nexus fallback validation passed.");
