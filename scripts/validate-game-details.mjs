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

// The recommendation is a th