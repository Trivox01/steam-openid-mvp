import { validateGameDetailsExperience } from "../src/services/gameDetailsValidation.ts";
import assert from "node:assert/strict";
import fs from "node:fs";

const assertions = validateGameDetailsExperience();
const page = fs.readFileSync("src/pages/GameDetailsPage.tsx", "utf8");
const row = fs.readFileSync("src/components/achievements/AchievementRow.tsx", "utf8");
const platformStrip = fs.readFileSync("src/components/ui/PlatformStrip.tsx", "utf8");
const hook = fs.readFileSync("src/hooks/useGameInstallState.ts", "utf8");
const pageStyles = fs.readFileSync("src/styles/game-details-v1.css", "utf8");
const styles = fs.readFileSync("src/styles/index.css", "utf8");
const entry = fs.readFileSync("src/main.tsx", "utf8");
const localeEn = fs.readFileSync("src/locales/en/gameDetails.ts", "utf8");
const localeAr = fs.readFileSync("src/locales/ar/gameDetails.ts", "utf8");

// v2 reads as one identity panel (cover, title, metadata, progress, data state)
// followed by the achievement list, with optional sessions last.
assert.match(page, /gd-identity/);
assert.match(page, /gd-identity__main/);
assert.match(page, /gd-progress/);
assert.match(page, /gd-status/);
assert.match(page, /gd-achievements/);
assert.match(page, /gd-achievements__head/, "the list header carries the count and the filter reset");
assert.doesNotMatch(
  page,
  /game-v2-hero|game-v2-overview|game-v2-shelf|game-v2-rare-columns|game-v2-continue|game-v2-metric/,
  "the cinematic hero, the metric wall and the shelves must not come back"
);
assert.match(page, /kind: "cover"/);
assert.match(page, /variant="cover"/);
assert.match(page, /gd-identity__mount/, "the cover is framed by its mount, not dropped into the panel");

// The identity panel now carries this game's real hero art, and the rules that
// keep it atmosphere instead of content are testable ones. This replaces the
// older blanket ban on background artwork, which was the right guard while the
// page had no artwork layer and the wrong one now: it forbade the treatment
// instead of the failure modes. The portrait cover is still the identity anchor
// inside its mount, the banner is a second decorative layer rather than a
// replacement for it, and it exists only when the existing artwork pipeline
// resolves a real source. That last point is the whole fallback contract: no
// source means no element, so nothing can break and nothing is invented to fill
// the space.
assert.match(
  page,
  /gd-identity__mount[\s\S]*?variant="cover"/,
  "the portrait cover stays the identity anchor inside its mount"
);
assert.equal(
  page.match(/variant="background"/g)?.length,
  1,
  "one background layer only: the banner is added to the identity panel, never in place of the cover"
);
assert.match(
  page,
  /className="gd-identity__banner" aria-hidden="true"/,
  "the banner is decoration, so assistive technology never sees it"
);
assert.match(
  page,
  /kind: "hero"/,
  "the banner comes from the existing Steam artwork pipeline, not from a new image service"
);
assert.match(
  page,
  /storedUrl: game\.backgroundUrl/,
  "the real stored background is preferred before any derived Steam asset"
);
assert.match(
  page,
  /\{bannerSources\.length > 0 && \(/,
  "no real source means no banner element at all, which is what keeps the failure state silent"
);

// The achievement list is the primary content and owns its own async states.
assert.match(page, /<AchievementRow/);
assert.doesNotMatch(page, /AchievementExperienceCard|achievement-x-collection/, "the card grid is replaced by rows");
assert.match(page, /const PAGE_SIZE = 60/);
assert.match(page, /achievementsState\.status === "loading"/);
assert.match(page, /achievementsState\.status === "error"/);
assert.match(page, /achievementsState\.retry/);
assert.doesNotMatch(
  page,
  /if \(achievementsState\.status === "error"\) return/,
  "a failed achievement load must not replace the page or the Play action"
);
assert.doesNotMatch(page, /AchievementDensity|AchievementView|"recent"/, "density, grid/list and the recent filter are gone");
assert.doesNotMatch(page, /addEventListener\("keydown"|event\.ctrlKey/, "the page must not hijack Ctrl+F from dialogs");
assert.doesNotMatch(page, /<ProgressBar/, "there is no real partial achievement progress to draw yet");

// The recommendation is a thin row above the list, never another card.
assert.match(page, /className="gd-next"/);
assert.match(page, /gd-next__label/);

// Visible copy must never expose template syntax. A locale value carrying a
// {{variable}} is a sentence, not a label: it may only be rendered together with
// its variables, because the translator re-emits the raw placeholder when one is
// missing. That is exactly how "NEXT ACHIEVEMENT: {{NAME}}" reached the real UI,
// so the guard below covers the whole class of bug, not just the key that broke.
const localeEntries = (source) => {
  const entries = new Map();
  for (const match of source.matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) {
    entries.set(match[1], match[2]);
  }
  return entries;
};
const enCopy = localeEntries(localeEn);
const arCopy = localeEntries(localeAr);
assert.ok(enCopy.size > 50 && arCopy.size > 50, "both locale files must parse into real key/value pairs");

const parameterizedKeys = new Set(
  [...enCopy, ...arCopy].filter(([, value]) => value.includes("{{")).map(([key]) => key)
);
assert.ok(
  parameterizedKeys.has("gameDetails.nextAchievement"),
  "nextAchievement is a parameterized sentence, so it must stay inside the guarded set"
);
for (const [source, name] of [[page, "GameDetailsPage.tsx"], [row, "AchievementRow.tsx"]]) {
  for (const [, key] of source.matchAll(/t\("([^"]+)"\)/g)) {
    assert.ok(
      !parameterizedKeys.has(key),
      `${name} renders ${key} with no variables; a parameterized sentence would print its raw placeholder on screen`
    );
  }
}
assert.doesNotMatch(
  page,
  /t\("gameDetails\.nextAchievement"\)/,
  "the recommendation label must be the placeholder-free key, not the parameterized sentence"
);
assert.ok(
  enCopy.has("gameDetails.nextTarget") && arCopy.has("gameDetails.nextTarget"),
  "the recommendation label needs a real translation in both languages"
);
for (const [, key] of [...page.matchAll(/"(gameDetails\.[A-Za-z.]+)"/g), ...row.matchAll(/"(gameDetails\.[A-Za-z.]+)"/g)]) {
  assert.ok(enCopy.has(key), `${key} is used by Game Details but missing from the English locale`);
  assert.ok(arCopy.has(key), `${key} is used by Game Details but missing from the Arabic locale`);
}

// Nothing may be presented as more certain than it is.
assert.match(page, /calculateAchievementSummary/);
assert.match(page, /unknownUnlockStates > 0/);
assert.match(page, /insight\.nextAchievement\.translationKey/);
assert.match(page, /achievementDataUnavailable/);
assert.match(page, /hasAchievementData/);
assert.match(page, /window\.addEventListener\("offline"/);
assert.match(page, /gameDetails\.offlineCached/);
assert.match(page, /disabled=\{updating \|\| !online\}/, "no sync action while clearly offline");
assert.match(page, /<RecentGameSessions appId=\{game\.appId\}/);

// The data-state line says a thing once, and never says it more confidently than
// the persisted data allows. The state text and the stored timestamp are the
// freshness truth; the coordinator's operational statuses are not allowed to
// speak about freshness at all, and no second phrase may repeat what the state
// text and the disabled action already say. Manual sync still reads the real
// per-game result before it claims anything.
assert.doesNotMatch(
  page,
  /smartStatus === "success" \? t\("gameDetails\.smartSync\.updated"\)/,
  "the coordinator success status alone must not claim 'Updated just now'"
);
assert.doesNotMatch(
  page,
  /gameDetails\.smartSync\.updated/,
  "a coordinator status must never claim freshness; the persisted sync state and the stored timestamp are the only freshness truth on that line"
);
assert.doesNotMatch(
  page,
  /gameDetails\.smartSync\.unavailable|gameDetails\.smartSync\.saved/,
  "a second phrase that also means 'the update cannot run now' only repeats the state text and the disabled action"
);
assert.match(
  page,
  /<time className="gd-status__time"/,
  "the stored sync timestamp stays on the line, because it is what replaces the removed phrases"
);
assert.match(
  page,
  /await smartSync\.syncGame\(game\.id, "manual", true\) as SteamAchievementSyncResult/,
  "manual sync must capture the result summary"
);
assert.match(
  page,
  /if \(gameResult\?\.status === "success" \|\| gameResult\?\.status === "partial"\)/,
  "manual sync may claim success only when the result confirms it"
);
assert.match(
  page,
  /const gameResult = result\?\.games\?\.find\(\(item\) => item\.gameId === game\.id\)/,
  "manual sync reads the real per-game outcome"
);
// The state marker is part of that same truth: it is derived from the persisted
// sync state, so the dot can never disagree with the words beside it.
assert.match(
  page,
  /const statusTone = !isSteam \|\| syncState === "never"/,
  "the state marker must follow the persisted sync state, not the coordinator status"
);

assert.doesNotMatch(page, /GameDetailsSquare/);

// The SmartSync status on screen is live: one subscription with its own
// cleanup, one status read per render, no polling and no timers.
assert.match(
  page,
  /useEffect\(\(\) => smartSync\.subscribe\(/,
  "the page must re-render when the coordinator status changes"
);
assert.equal(
  page.match(/smartSync\.getStatus\(/g)?.length,
  1,
  "the coordinator status is read once per render"
);
assert.doesNotMatch(page, /setInterval|setTimeout/, "no polling and no timers behind the status");

// The background page-open sync is bounded: it never escapes as an unhandled
// rejection and it never reports a success it did not get.
assert.match(
  page,
  /smartSync\.syncGame\(steamGameId, "page-open"\)\.catch\(/,
  "the background sync needs a deliberate catch"
);
assert.doesNotMatch(page, /void smartSync\.syncGame\(/, "a fire-and-forget sync leaves an unhandled rejection");

// A non-Steam game never borrows Steam sync semantics.
assert.match(page, /const syncState = isSteam \? getSyncState\(/, "only Steam games get a Steam sync state");
assert.match(page, /const smartStatus = isSteam \?/);
assert.match(page, /const lastSynced = isSteam &&/, "a local game has no last Steam sync time");
assert.match(page, /gameDetails\.localGame/, "a local game states the real local text");
assert.match(page, /\{isSteam && \(\s*<button/s, "the sync action exists for Steam only");
assert.match(
  page,
  /const installKey = isSteam \? gameInstallStateKey\(/,
  "installation state must not leak to a non-Steam game"
);

// Platform identity is data, not decoration. The union below is the whitelist: a
// glyph may only exist for a platform this app can actually prove, which is the
// Windows desktop it runs on and the Steam library it reads. A console icon has
// no data source behind it, so drawing one would be invented metadata of exactly
// the kind the design rules forbid.
assert.match(
  platformStrip,
  /export type PlatformKey = "pc" \| "steam";/,
  "the platform union is the whitelist; widening it needs real data behind it"
);
assert.doesNotMatch(
  platformStrip,
  /xbox|playstation|nintendo|epic|gog/i,
  "a platform glyph may only exist for a platform the data can prove"
);
assert.doesNotMatch(
  page,
  /xbox|playstation|nintendo/i,
  "the page must not claim a platform that no data source can back"
);
assert.match(
  page,
  /const platforms: PlatformKey\[\] = isSteam \? \["pc", "steam"\] : \["pc"\];/,
  "the strip is derived from the real platform of the game, never from the layout"
);
assert.match(page, /<PlatformStrip platforms=\{platforms\}/, "the identity area shows the strip instead of a repeated text label");
// Icon-only information still has to be readable, and the strip is information
// rather than a control: no click target, no link, no tab stop.
assert.match(platformStrip, /role="img"/, "an icon that carries information needs an accessible role");
assert.match(platformStrip, /aria-label=\{LABELS\[platform\]\}/, "each glyph is named with its real platform");
assert.match(platformStrip, /aria-hidden="true"/, "the svg beneath the named wrapper is hidden from assistive tech");
assert.doesNotMatch(platformStrip, /onClick|href=|tabIndex/, "the strip is metadata, not a control");
assert.match(platformStrip, /currentColor/, "the glyphs inherit the text colour instead of hard-coding white");
assert.doesNotMatch(
  platformStrip,
  /<img|url\(|\.svg|\.png/,
  "no third-party brand file is bundled for a platform icon; the glyphs are our own geometry"
);
// Legibility at runtime size is part of the same contract, because the strip
// failed its visual review once: at 13px both marks were visually lost and the
// round one no longer read as Steam. Filled shapes on one drawing grid are the
// fix, since a hairline outline is the first thing to disappear at 16px and
// under Windows display scaling.
assert.match(
  platformStrip,
  /size = 16/,
  "16px is the reviewed glyph size; a smaller default is exactly the regression this pass fixed"
);
assert.match(
  platformStrip,
  /viewBox="0 0 16 16"/,
  "both glyphs are drawn on one 16 unit grid, which is what keeps their perceived weight comparable"
);
assert.doesNotMatch(
  platformStrip,
  /strokeWidth|stroke=/,
  "platform glyphs are filled silhouettes; a hairline outline collapses into a smudge at 16px"
);
// The PC mark names a computer, not an operating system: a monitor is screen,
// neck and base, which is three closed subpaths in one filled path. The four
// pane mark it replaced may not come back. The Steam disc passed its visual
// review, so it is frozen here; only the PC glyph was in scope for this pass.
const pcGlyph = platformStrip.match(/pc: \(\s*<path[\s\S]*?\/>\s*\)/)?.[0] ?? "";
assert.ok(pcGlyph.length > 0, "the PC glyph must stay one filled path, not a group of strokes");
assert.equal(
  (pcGlyph.match(/Z/g) ?? []).length,
  3,
  "the PC mark is a monitor: three closed subpaths for screen, neck and base"
);
assert.doesNotMatch(
  platformStrip,
  /M1\.8 1\.8h5\.4v5\.4h-5\.4Zm7 0/,
  "the four-pane mark named an operating system instead of a computer"
);
assert.match(
  platformStrip,
  /steam: \(\s*<path[\s\S]*?d="M8 1a7 7 0 1 0 0 14/,
  "the Steam disc is visually approved and deliberately frozen"
);

// Rows are real buttons, state is never colour alone, rarity is never invented.
assert.match(row, /type="button"/);
assert.match(row, /aria-label=/);
assert.match(row, /knownAchievementRarity/);
assert.match(row, /unlockStateKnown !== false/);
assert.match(row, /ChevronRight/);
assert.match(row, /size=\{40\}/, "the row shows real 40px achievement artwork, not a table thumbnail");
assert.match(row, /gd-achievement-row__state/, "every state carries its own glyph chip");
assert.doesNotMatch(
  row,
  /achievement\.rarityPercentage|rarityTier/,
  "displayed rarity comes from known global percentages only"
);

// The install-state hook observes; it never launches anything, and it never
// keeps one app's snapshot for another.
assert.match(hook, /gameLauncher\.subscribe/);
assert.doesNotMatch(hook, /gameLauncher\.(?:act|openSteamInstaller)\(/);
assert.match(hook, /const key = appId \?\? ""/);
assert.match(hook, /gameLauncher\.getSnapshot\(key\)/);
assert.match(hook, /if \(state\.key !== key\)/, "a changed or absent appId resynchronises the snapshot");

assert.match(entry, /game-details-v1\.css/);

// v2 geometry: a real portrait cover anchors the identity, rows are 52px, and
// the content stays bounded so achievement text never crosses 1920.
assert.match(pageStyles, /--gd-cover: 112px/, "the cover is a real identity anchor, not metadata artwork");
assert.match(pageStyles, /\.gd-identity \.gd-identity__cover \{[^}]*aspect-ratio: 2 \/ 3/s);
assert.match(
  pageStyles,
  /\.gd-identity__mount \{[^}]*inline-size: var\(--gd-cover\)/s,
  "the mount reserves the cover geometry so the artwork is framed, not floating"
);
assert.match(pageStyles, /\.gd-achievement-row \{[^}]*min-block-size: 52px/s);
assert.match(pageStyles, /max-inline-size: 1240px/, "achievement text must not stretch across 1920");
assert.match(pageStyles, /html\[dir="rtl"\] \.gd-identity__back svg/);
assert.match(pageStyles, /html\[dir="rtl"\] \.gd-achievement-row__chevron/);
assert.match(pageStyles, /html\[dir="rtl"\] \.gd-identity \{[^}]*clip-path/s, "the clipped corner mirrors in RTL");
assert.match(pageStyles, /html\[lang="ar"\] \.gd-next__label/, "Arabic must not inherit Latin HUD tracking");
assert.match(
  pageStyles,
  /html\[lang="ar"\] \.gd-achievements__title/,
  "the uppercase tactical header must be neutralised for Arabic"
);
assert.match(pageStyles, /html\[data-theme="light"\] \.game-details-v1/, "light mode is designed, not inverted dark");
assert.match(pageStyles, /forced-colors: active/);

// The hero banner is a layer, not a block. It is absolutely positioned inside a
// panel that owns its stacking context, so it can neither add height nor paint
// over the content; the readability veil above it is a flat surface fill rather
// than a wash; and the shared artwork skin's loading and error states are
// suppressed, because a decorative image may never announce a failure behind the
// identity panel. Strength is a token, so light mode answers for its own
// readability instead of inheriting the dark treatment, and forced colours drop
// the atmosphere entirely.
assert.match(
  pageStyles,
  /\.gd-identity \{[^}]*isolation: isolate/s,
  "the panel owns the stacking context the banner is layered against"
);
assert.match(
  pageStyles,
  /\.gd-identity__banner \{[^}]*position: absolute/s,
  "the banner is a layer inside the panel, so it cannot change the panel height"
);
assert.match(
  pageStyles,
  /\.gd-identity__banner \{[^}]*z-index: -1/s,
  "the artwork stays behind the cover, the title, the progress and the status line"
);
assert.match(
  pageStyles,
  /\.gd-identity__banner::after \{[^}]*background: var\(--gd-banner-veil\)/s,
  "the readability veil is a flat surface fill, not a gradient wash"
);
assert.match(
  pageStyles,
  /\.gd-identity__banner img \{[^}]*opacity: var\(--gd-banner-strength\)/s,
  "banner strength is a token, so each theme can answer for its own readability"
);
assert.match(
  pageStyles,
  /\.gd-identity__banner \.game-artwork__fallback \{ display: none/,
  "a failed decorative image must never draw an artwork-unavailable box behind the panel"
);
assert.match(
  pageStyles,
  /html\[data-theme="light"\] \.game-details-v1 \{[^}]*--gd-banner-strength/s,
  "light mode sets its own banner strength and veil instead of reusing the dark treatment"
);
assert.match(
  pageStyles,
  /html\[dir="rtl"\] \.gd-identity__banner img \{[^}]*transform: none/s,
  "the panel mirrors in RTL, the artwork never does"
);
assert.match(
  pageStyles,
  /@media \(forced-colors: active\)[\s\S]*\.gd-identity__banner \{ display: none/,
  "forced colours drop the atmosphere and keep guaranteed contrast"
);

// Hierarchy is carried by structure, not decoration: a section mark instead of a
// header card, a surface band instead of a table border, one control geometry for
// search/filters/sort, and colour that means something.
assert.match(pageStyles, /\.gd-achievements__head::before/, "the section mark replaces a header card");
assert.match(
  pageStyles,
  /\.gd-achievement-list \{[^}]*background: var\(--gd-band\)/s,
  "the list sits on its own surface band, which is what gives the page depth"
);
assert.match(
  pageStyles,
  /\.gd-achievement-row--unlocked::before \{[^}]*var\(--action-play\)/s,
  "an unlocked row is rewarded on its state rail, not with a glow"
);
assert.match(
  pageStyles,
  /\.gd-achievements \.library-search,\s*\.gd-achievements \.segmented-filter,\s*\.gd-achievements \.select-control select \{[^}]*border-radius: 0/s,
  "search, filters and sort must share one geometry instead of three design systems"
);
// The shared Sort control is a label wrapping a select, and the shared styles
// give that label a pill. The page-scoped reset is what makes the three controls
// one family, so it is now part of the tested contract.
assert.match(
  pageStyles,
  /\.game-details-v1 \.gd-achievements \.select-control \{[^}]*border-radius: 0/s,
  "the Sort wrapper must never reintroduce a pill around the select"
);
assert.match(pageStyles, /--gd-data:/, "data colour is a named role, so cyan cannot spread across the page");

// The identity panel is composed, not filled: a spine between the cover column
// and the data column, a header band that binds the title to the primary action,
// and a marked data band. None of them may become a card.
assert.match(
  pageStyles,
  /\.gd-identity__main \{[^}]*border-inline-start: 1px solid var\(--gd-hairline\)/s,
  "the spine separates the cover column from the data column"
);
assert.match(
  pageStyles,
  /\.gd-identity__head \{[^}]*border-block-end: 1px solid var\(--gd-hairline\)/s,
  "the title and the primary action form one header band"
);
assert.match(
  pageStyles,
  /\.gd-progress::before \{/,
  "the data band is marked by a deliberate tick, not by a card"
);
assert.match(
  pageStyles,
  /\.gd-status--warn \.gd-status__state::before \{[^}]*background: none/s,
  "a problem state differs in geometry, not in colour alone"
);

// Three typographic tiers and no more: the white title, one named secondary tier
// for the metadata line, and supporting text on the data-state line. The strip
// closes on a hairline instead of becoming a badge, and its glyphs take the page
// text colour, which is what keeps light mode designed rather than inverted.
assert.match(pageStyles, /--gd-secondary:/, "the metadata line has its own named tier between title and supporting text");
assert.match(
  pageStyles,
  /\.gd-identity__meta \{[^}]*color: var\(--gd-secondary\)/s,
  "the metadata line is the secondary tier, not the muted supporting one"
);
assert.match(
  pageStyles,
  /\.gd-status__time \{[^}]*font-variant-numeric: tabular-nums/s,
  "the stored timestamp is technical numerics on the supporting line"
);
assert.match(
  pageStyles,
  /\.gd-platforms \{[^}]*border-inline-end: 1px solid var\(--gd-hairline\)/s,
  "the platform strip is closed by a technical hairline, not by a badge box"
);
assert.match(
  pageStyles,
  /\.gd-platform \{[^}]*color: var\(--text-primary\)/s,
  "platform glyphs take the page text colour, so light mode is not an inverted dark mode"
);

// Cyberpunk accents stay accents. Comments may name forbidden properties without
// declaring them, so the declaration checks run on the executable CSS only.
const executablePageStyles = pageStyles.replace(/\/\*[\s\S]*?\*\//g, "");
assert.doesNotMatch(
  executablePageStyles,
  /blur\(|backdrop-filter|radial-gradient|text-shadow/,
  "no glass, no radial light bloom, no glowing text"
);
assert.equal(
  executablePageStyles.match(/box-shadow: 0 0/g)?.length,
  1,
  "exactly one controlled glow on the whole page"
);
assert.match(
  executablePageStyles,
  /html\[data-theme="dark"\] \.gd-progress__fill \{[^}]*box-shadow: 0 0/s,
  "the one glow belongs to the progress fill in dark mode only"
);
assert.equal(
  executablePageStyles.match(/linear-gradient\(/g)?.length,
  executablePageStyles.match(/repeating-linear-gradient\(/g)?.length,
  "the only gradients are the repeating, meaningful ones: the cover grid, the progress segments and ticks, and the unknown-state rail"
);
assert.match(styles, /scrollbar-gutter:stable/);
assert.match(styles, /::-webkit-scrollbar-thumb:hover/);
assert.match(styles, /forced-colors:active/);
console.log(`Game Details validation passed (${assertions} assertions).`);
