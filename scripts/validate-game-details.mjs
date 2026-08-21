import { validateGameDetailsExperience } from "../src/services/gameDetailsValidation.ts";
import assert from "node:assert/strict";
import fs from "node:fs";

const assertions = validateGameDetailsExperience();
const page = fs.readFileSync("src/pages/GameDetailsPage.tsx", "utf8");
const row = fs.readFileSync("src/components/achievements/AchievementRow.tsx", "utf8");
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
assert.doesNotMatch(page, /variant="background"|backgroundUrl/, "the portrait cover carries the identity, not background art");

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
