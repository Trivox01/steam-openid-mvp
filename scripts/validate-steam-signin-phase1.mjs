import assert from "node:assert/strict";
import fs from "node:fs";

const flags = fs.readFileSync("src/config/featureFlags.ts", "utf8");
const compositionRoot = fs.readFileSync("src/services/compositionRoot.ts", "utf8");
const settings = fs.readFileSync(
  "src/components/settings/SteamAccountSettings.tsx",
  "utf8"
);
const onboarding = fs.readFileSync(
  "src/features/onboarding/FirstLaunchExperience.tsx",
  "utf8"
);
const exampleEnvironment = fs.readFileSync(
  "services/auth-api/.env.example",
  "utf8"
);

assert.match(flags, /steamOpenIdEnabled:\s*enabled\(/);
assert.match(flags, /value\.trim\(\)\.toLowerCase\(\)\s*===\s*"true"/);
assert.match(compositionRoot, /new TauriSteamGateway\(\)/);
assert.doesNotMatch(compositionRoot, /BackendSteamGateway/);
assert.match(settings, />SteamID64</);
assert.match(settings, /value=\{apiKey\}/);
assert.match(onboarding, /services\.steam\.connect\(\{steamId,\s*apiKey\}\)/);

for (const line of exampleEnvironment.trim().split(/\r?\n/)) {
  assert.match(line, /^[A-Z][A-Z0-9_]*=$/, `Environment example must not contain a value: ${line}`);
}

console.log("Steam Sign-In Phase 1 feature-flag validation passed.");
