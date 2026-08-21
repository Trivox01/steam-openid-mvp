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

// Sync messaging must follow the persisted game data, never the coordinator's
// operational success flag. A resolved promise is not proof that Steam
// achievement data synced, so a failed/private/unsupported/never game must never
// be shown next to "Updated just now", and manual sync must not declare success
// without reading the real per-game result.
assert.doesNotMatch(
  page,
  /smartStatus === "success" \? t\("gameDetails\.smartSync\.updated"\)/,
  "the coordinator success status alone must not claim 'Updated just now'"
);
assert.match(page, /dataSyncSucceeded/, "the updated message must be gated by the real data state");
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
assert.match(pageStyles, /\.gd-achievement-row \{[^}]*min-block-size: 52px/s);
assert.match(pageStyles, /max-inline-size: 1240px/, "achievement text must not stretch across 1920");
assert.match(pageStyles, /html\[dir="rtl"\] \.gd-identity__back svg/);
assert.match(pageStyles, /html\[dir="rtl"\] \.gd-achievement-row__chevron/);
assert.match(pageStyles, /html\[dir="rtl"\] \.gd-identity \{[^}]*clip-path/s, "the clipped corner mirrors in RTL");
assert.match(pageStyles, /html\[lang="ar"\] \.gd-next__label/, "Arabic must not inherit Latin HUD tracking");
assert.match(pageStyles, /html\[data-theme="light"\] \.game-details-v1/, "light mode is designed, not inverted dark");
assert.match(pageStyles, /forced-colors: active/);

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
  "the only gradients are the repeating, meaningful ones: progress segments and the unknown-state rail"
);
assert.match(styles, /scrollbar-gutter:stable/);
assert.match(styles, /::-webkit-scrollbar-thumb:hover/);
assert.match(styles, /forced-colors:active/);
console.log(`Game Details validation passed (${assertions} assertions).`);
