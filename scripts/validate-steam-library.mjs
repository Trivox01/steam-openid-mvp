import { validateSteamLibrarySync } from "../src/services/platform/steamLibraryValidation.ts";

const assertions = validateSteamLibrarySync();
console.log(`Steam library validation passed (${assertions} assertions).`);
