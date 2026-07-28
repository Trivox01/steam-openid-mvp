import { validateGameDetailsExperience } from "../src/services/gameDetailsValidation.ts";
import assert from "node:assert/strict";
import fs from "node:fs";

const assertions = validateGameDetailsExperience();
const page = fs.readFileSync("src/pages/GameDetailsPage.tsx", "utf8");
assert.match(page, /game-v2-continue/);
assert.match(page, /insight\.nextAchievement\.translationKey/);
assert.match(page, /event\.ctrlKey \|\| event\.metaKey/);
assert.match(page, /searchRef\.current\?\.focus/);
console.log(`Game Details validation passed (${assertions} assertions).`);
