import assert from "node:assert/strict";
import { profileBadgeRegistry } from "../src/features/profile/badges/badgeRegistry.ts";
import { resolveBadges, visibleBadges } from "../src/features/profile/badges/badgeResolver.ts";
import { badgeRarity } from "../src/features/profile/badges/badgeRarity.ts";

assert.equal(profileBadgeRegistry.length, 10);
assert.equal(new Set(profileBadgeRegistry.map((badge) => badge.id)).size, 10);
assert.equal(profileBadgeRegistry.every((badge) => badge.icon.endsWith(".svg")), true);
assert.equal(profileBadgeRegistry.every((badge) => badge.visible), true);
assert.equal(Object.keys(badgeRarity).length, 6);

const automatic = resolveBadges({ perfectGames: 3, achievementsUnlocked: 100 });
assert.deepEqual(automatic.map((badge) => badge.id), ["completionist", "quest-master"]);
assert.equal(automatic.some((badge) => badge.source === "staff"), false);

const manual = resolveBadges({
  manualBadgeIds: ["founder", "developer", "staff", "moderator"]
});
assert.deepEqual(manual.map((badge) => badge.id), ["founder", "developer", "staff", "moderator"]);
const limited = visibleBadges(manual);
assert.equal(limited.visible.length, 3);
assert.equal(limited.remaining, 1);

console.log("Profile Badge validation passed.");
