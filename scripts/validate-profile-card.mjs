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
const identity = await readFile(new URL("../src/components/profile/ProfileIdentity.tsx", import.meta.url), "utf8");
const stats = await readFile(new URL("../src/components/profile/ProfileStats.tsx", import.meta.url), "utf8");
const verification = await readFile(new URL("../src/components/profile/ProfileVerification.tsx", import.meta.url), "utf8");
const banner = await readFile(new URL("../src/components/profile/ProfileBanner.tsx", import.meta.url), "utf8");
const badges = await readFile(new URL("../src/components/profile/ProfileBadges.tsx", import.meta.url), "utf8");
const badgeTooltip = await readFile(new URL("../src/components/profile/BadgeTooltip.tsx", import.meta.url), "utf8");
const publicBadgeList = await readFile(new URL("../src/components/profile/publicBadges/PublicBadgeList.tsx", import.meta.url), "utf8");
const publicBadgeClient = await readFile(new URL("../src/features/profile/publicBadges/PublicBadgeClient.ts", import.meta.url), "utf8");
const publicBadgeStore = await readFile(new URL("../src/features/profile/publicBadges/PublicBadgeStore.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../src/styles/index.css", import.meta.url), "utf8");
const adapter = await readFile(new URL("../src/features/profile/profileSummaryAdapter.ts", import.meta.url), "utf8");
assert.match(trigger, /event\.key === "Escape"/);
assert.match(trigger, /aria-haspopup="dialog"/);
assert.match(trigger, /pointerdown/);
assert.match(trigger, /cardRef\.current\?\.focus\(\)/, "opening the card focuses the dialog, not the first badge");
assert.match(trigger, /requestGeneration/, "stale profile requests cannot reopen or mutate a closed card");
assert.match(trigger, /status === "loading"[\s\S]*return/, "a second click cannot toggle the card while it is loading");
assert.match(trigger, /createPortal\([\s\S]*document\.body/, "profile popover escapes Topbar stacking and clipping contexts");
assert.match(card, /ProfileBanner[\s\S]*ProfileIdentity[\s\S]*ProfileStats[\s\S]*ProfileVerification/, "card is composed from focused profile sections");
assert.match(identity, /ProfileAvatar/);
assert.match(identity, /profile-card__name-row[\s\S]*PublicBadgeList/, "public badges render beside the profile name");
assert.match(verification, /profile-card__verification/, "Steam verification and connected date use a dedicated panel");
assert.match(verification, /summary\.memberSince[\s\S]*profile\.connected/, "authenticatedAt is labelled as Connected when memberSince is unavailable");
assert.match(stats, /value === undefined[\s\S]*"—"/, "partial statistics do not invent zero values");
assert.doesNotMatch(identity, /•|\{"\/"\}/, "username is not joined to badges with a separator");
assert.match(card, /disabled=\{!onAction\}/, "unavailable profile editing remains visibly disabled");
assert.match(banner, /onError=\{\(\) => setFailed\(true\)\}/, "broken banners fall back safely");
assert.match(badges, /size=\{24\}/, "badge tooltip contains a larger icon");
assert.match(badgeTooltip, /createPortal\([\s\S]*document\.body/, "badge tooltip renders through a document body portal");
assert.match(badgeTooltip, /window\.innerWidth[\s\S]*window\.innerHeight/, "badge tooltip handles viewport collisions");
assert.match(badgeTooltip, /event\.key === "Escape" && open/, "Escape closes the tooltip before bubbling to the profile popover");
assert.match(publicBadgeStore, /AbortController/, "prefetched public badge request is cancellable");
assert.match(publicBadgeStore, /subscribeSession/, "public badges preload when the authenticated session becomes available");
assert.match(publicBadgeStore, /private clear\(\)[\s\S]*generation \+= 1/, "session changes clear cached badges and invalidate stale requests");
assert.match(publicBadgeList, /VISIBLE_BADGES = 5/, "public badge overflow remains bounded");
assert.match(publicBadgeClient, /\/api\/me\/public-badges/, "profile uses one public badge endpoint");
assert.doesNotMatch(publicBadgeClient, /assignmentReason|assignedBy|steamId/i, "public client does not model administrative data");
assert.doesNotMatch(badges, /role="tooltip"/, "tooltip content is not nested inside the Profile Card badge DOM");
assert.match(css, /\.profile-badge\{[^}]*width:20px;height:20px/, "inline badges are exactly 20 by 20 pixels");
assert.match(css, /\.profile-badge\{[^}]*background:transparent/, "inline badges have no permanent tile background");
assert.match(css, /\.public-badge\{[^}]*background:transparent/, "public badge icons have no surrounding tile");
assert.doesNotMatch(css, /\.public-badge--(?:rare|epic|legendary|exclusive)\{[^}]*box-shadow/, "rarity does not add a square around public icons");
assert.match(css, /\.profile-badge-tooltip-portal\{[^}]*z-index:1000/, "portal tooltip layers above the profile popover");
assert.match(css, /\.profile-card-popover\{[^}]*width:400px/, "desktop profile card width remains stable");
assert.match(css, /\.profile-card-popover\{[^}]*position:fixed/, "profile card is positioned against the viewport");
assert.match(css, /\.profile-card-popover\{[^}]*max-width:calc\(100vw - 24px\)/, "profile card respects narrow viewports");
assert.match(css, /\.profile-card__banner\{[^}]*height:130px/, "banner uses the final reference height");
assert.match(css, /\.profile-card__avatar\{[^}]*width:96px;height:96px/, "avatar uses the final 96px size");
assert.match(css, /\.profile-card__stats>div\{[^}]*min-height:92px/, "stat cells preserve their minimum visual height");
assert.match(css, /\.profile-card__action\{[^}]*height:48px/, "profile action uses the required desktop control height");
assert.doesNotMatch(card, /steamId64|authRequestId|pollSecret|deviceId|apiKey/i);
assert.doesNotMatch(adapter, /steamLibrarySync|steamAchievementSync|\.sync\(/);
assert.match(css, /prefers-reduced-motion:reduce[\s\S]*profile-card-popover/);

console.log("Profile Card validation passed.");
