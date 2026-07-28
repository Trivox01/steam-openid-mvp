import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { profileBadgeRegistry } from "../src/features/profile/badges/badgeRegistry.ts";
import { resolveBadges, visibleBadges } from "../src/features/profile/badges/badgeResolver.ts";

assert.equal(profileBadgeRegistry.length, 10, "the Phase 1 registry contains exactly ten badges");
assert.equal(new Set(profileBadgeRegistry.map((badge) => badge.id)).size, 10, "badge ids are unique");
assert.equal(profileBadgeRegistry.every((badge) => typeof badge.icon === "string"), true, "registry stores icon filenames, not components");
const earned = resolveBadges({ perfectGames: 3, achievementsUnlocked: 100 });
assert.equal(earned.some((badge) => badge.id === "completionist"), true);
assert.equal(earned.some((badge) => badge.id === "quest-master"), true);
assert.equal(earned.some((badge) => badge.id === "developer"), false, "automatic evidence cannot grant staff badges");
assert.deepEqual(
  earned.map((badge) => badge.priority),
  [...earned].map((badge) => badge.priority).sort((a, b) => b - a),
  "badges are sorted by priority"
);
assert.equal(resolveBadges({ manualBadgeIds: ["developer"] }).some((badge) => badge.id === "developer"), true);

const overflow = visibleBadges(resolveBadges({
  perfectGames: 3,
  achievementsUnlocked: 100,
  manualBadgeIds: ["founder", "developer", "staff"]
}));
assert.equal(overflow.visible.length, 3);
assert.equal(overflow.remaining, 2);

const trigger = await readFile(new URL("../src/components/profile/ProfileCardTrigger.tsx", import.meta.url), "utf8");
const card = await readFile(new URL("../src/components/profile/ProfileCard.tsx", import.meta.url), "utf8");
const banner = await readFile(new URL("../src/components/profile/ProfileBanner.tsx", import.meta.url), "utf8");
const badges = await readFile(new URL("../src/components/profile/ProfileBadges.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/styles/index.css", import.meta.url), "utf8");
const adapter = await readFile(new URL("../src/features/profile/profileSummaryAdapter.ts", import.meta.url), "utf8");
assert.match(trigger, /event\.key === "Escape"/);
assert.match(trigger, /aria-haspopup="dialog"/);
assert.match(trigger, /pointerdown/);
assert.match(card, /ProfileAvatar/);
assert.match(card, /profile-card__name[\s\S]*ProfileBadges/, "badges render beside the profile name");
assert.match(card, /profile-card__verification/, "Steam verification and joined date use a dedicated panel");
assert.match(card, /value === undefined[\s\S]*"—"/, "partial statistics do not invent zero values");
assert.doesNotMatch(card, /•|\{"\/"\}/, "username is not joined to badges with a separator");
assert.match(banner, /onError=\{\(\) => setFailed\(true\)\}/, "broken banners fall back safely");
assert.match(badges, /size=\{24\}/, "badge tooltip contains a larger icon");
assert.match(css, /\.profile-badge\{[^}]*width:18px;height:18px/, "inline badges are exactly 18 by 18 pixels");
assert.match(css, /\.profile-badge\{[^}]*background:transparent/, "inline badges have no permanent tile background");
assert.doesNotMatch(card, /steamId64|authRequestId|pollSecret|deviceId|apiKey/i);
assert.doesNotMatch(adapter, /steamLibrarySync|steamAchievementSync|\.sync\(/);
assert.match(css, /prefers-reduced-motion:reduce[\s\S]*profile-card-popover/);

console.log("Profile Card validation passed.");
