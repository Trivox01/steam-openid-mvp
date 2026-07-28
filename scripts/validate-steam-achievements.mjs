import { validateSteamAchievementSync } from "../src/services/platform/steamAchievementValidation.ts";

const assertions = await validateSteamAchievementSync();
console.log(`Steam achievement validation passed (${assertions} assertions).`);
