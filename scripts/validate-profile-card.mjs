import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveProfileBadges, visibleProfileBadges } from "../src/features/profile/badges/resolveProfileBadges.ts";

const translate = (key) => key;
const verified = resolveProfileBadges({ steamVerified: true, perfectGames: 3, rareAchievementsUnlocked: 10 }, translate);
assert.equal(verified.some((badge) => badge.id === "steam-verified"), true, "verified identity receives Steam badge");
assert.equal(verified.some((badge) => badge.id === "developer"), false, "editable profile evidence cannot grant developer");
assert.deepEqual(
  verified.map((badge) => badge.priority),
  [...verified].map((badge) => badge.priority).sort((a, b) => b - a),
  "badges are sorted by priority"
);
assert.equal(resolveProfileBadges({ steamVerified: false }, translate).some((badge) => badge.id === "steam-verified"), false);
assert.equal(resolveProfileBadges({ steamVerified: false, trustedRoleIds: ["developer"] }, translate).some((badge) => badge.id === "developer"), true);

const overflow = visibleProfileBadges([
  ...verified,
  ...resolveProfileBadges({ steamVerified: false, trustedRoleIds: ["developer"], trustedEventIds: ["early-supporter"] }, translate)
]);
assert.equal(overflow.visible.length, 3);
assert.equal(overflow.remaining, 2);

const trigger = await readFile(new URL("../src/components/profile/ProfileCardTrigger.tsx", import.meta.url), "utf8");
const card = await readFile(new URL("../src/components/profile/ProfileCard.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/styles/index.css", import.meta.url), "utf8");
const adapter = await readFile(new URL("../src/features/profile/profileSummaryAdapter.ts", import.meta.url), "utf8");
assert.match(trigger, /event\.key === "Escape"/);
assert.match(trigger, /aria-haspopup="dialog"/);
assert.match(trigger, /pointerdown/);
assert.match(card, /ProfileAvatar/);
assert.doesNotMatch(card, /steamId64|authRequestId|pollSecret|deviceId|apiKey/i);
assert.doesNotMatch(adapter, /steamLibrarySync|steamAchievementSync|\.sync\(/);
assert.match(css, /prefers-reduced-motion:reduce[\s\S]*profile-card-popover/);

console.log("Profile Card validation passed.");
