import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateNexusPlatformFoundation } from "../src/domain/nexus/validation.ts";

// 1. The new domain contracts hold (completion truth, canonical trust,
// ownership integrity, id strategy, backend-only boundary, credential split).
const assertions = validateNexusPlatformFoundation();
assert.ok(
  assertions >= 50,
  `expected focused coverage of the new domain contracts, got ${assertions} assertions`
);

// 2. Phase 1 stays design-only: SuperTokens is documented, not installed.
for (const manifest of ["package.json", "services/auth-api/package.json"]) {
  assert.doesNotMatch(
    fs.readFileSync(manifest, "utf8"),
    /supertokens/i,
    `${manifest} must not gain a SuperTokens dependency in this phase`
  );
}

// 3. No multi-platform migration may exist yet; the schema stays a proposal.
const migrationsDir = "services/auth-api/src/storage/postgres/migrations";
const migrations = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"));
assert.ok(migrations.length > 0, "existing migrations must remain in place");
const migrationSql = migrations
  .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
  .join("\n");
for (const table of [
  "linked_platform_accounts",
  "provider_credentials",
  "canonical_games",
  "platform_games",
  "user_game_ownership",
  "platform_achievements",
  "user_achievement_states",
  "user_canonical_mapping_suggestions"
]) {
  assert.doesNotMatch(
    migrationSql,
    new RegExp(table),
    `${table} must stay a proposal until a later phase applies it`
  );
}

// 4. The domain layer stays free of UI, state, persistence and provider I/O.
const domainDir = "src/domain/nexus";
const domainFiles = fs.readdirSync(domainDir).filter((name) => name.endsWith(".ts"));
assert.ok(domainFiles.length >= 7, "the Nexus domain modules must be present");
for (const file of domainFiles) {
  const source = fs.readFileSync(path.join(domainDir, file), "utf8");
  assert.doesNotMatch(source, /from "react/, `${file} must not depend on React`);
  assert.doesNotMatch(
    source,
    /from "\.\.\/\.\.\/(components|pages|state|store|hooks|repositories)\//,
    `${file} must not depend on UI or persistence layers`
  );
  assert.doesNotMatch(
    source,
    /api\.steampowered\.com|fetch\(/,
    `${file} must stay a pure domain module`
  );
}

// 5. Existing Steam-first surfaces are untouched by this phase.
for (const kept of [
  "src/services/platform/PlatformProvider.ts",
  "src/services/platform/SteamProvider.ts",
  "src/services/platform/SteamLibrarySyncService.ts",
  "src/services/platform/steamLibraryValidation.ts",
  "src/types/steam.ts",
  "src/types/library.ts"
]) {
  assert.ok(fs.existsSync(kept), `${kept} must remain in place`);
}
assert.match(
  fs.readFileSync("src/types/index.ts", "utf8"),
  /export type Platform =[^;]*"steam"[^;]*"other"[^;]*;/,
  "the existing frontend Platform union must remain unchanged"
);

// 6. The architecture documentation covers every required topic.
const architectureDoc = fs.readFileSync(
  "docs/architecture/MULTI_PLATFORM_ACCOUNTS.md",
  "utf8"
);
for (const topic of [
  "Why the Nexus account is independent from Steam",
  "Linked provider architecture",
  "Canonical game vs platform game",
  "Identity and key strategy",
  "Achievement ownership",
  "Adapter boundaries",
  "Security and token boundaries",
  "Capability differences",
  "Migration path",
  "Transitional stage",
  "Provider-neutral onboarding",
  "What Phase 1 implements",
  "What later phases defer"
]) {
  assert.ok(
    architectureDoc.includes(topic),
    `the architecture document must cover: ${topic}`
  );
}

// 7. The database design is a proposal, with the required semantics documented.
const dbProposal = fs.readFileSync(
  "docs/architecture/MULTI_PLATFORM_DB_PROPOSAL.md",
  "utf8"
);
assert.match(dbProposal, /DO NOT APPLY/, "the schema must be marked as not applied");
for (const topic of [
  "PRIMARY KEY",
  "REFERENCES",
  "CREATE UNIQUE INDEX",
  "uniqueness semantics",
  "Unlink behaviour",
  "Deletion and privacy behaviour",
  "connection_status",
  "revoked_at"
]) {
  assert.ok(dbProposal.includes(topic), `the database proposal must document: ${topic}`);
}

// Ownership and achievement state must not carry a redundant user_id column;
// the Nexus user is derived through the linked account.
const ownershipTable = dbProposal.match(/CREATE TABLE user_game_ownership \(([\s\S]*?)\);/);
assert.ok(ownershipTable, "user_game_ownership must be defined in the proposal");
assert.doesNotMatch(
  ownershipTable[1],
  /\buser_id\b/,
  "user_game_ownership must derive the Nexus user via linked_account_id"
);
const statesTable = dbProposal.match(/CREATE TABLE user_achievement_states \(([\s\S]*?)\);/);
assert.ok(statesTable, "user_achievement_states must be defined in the proposal");
assert.doesNotMatch(
  statesTable[1],
  /\buser_id\b/,
  "user_achievement_states must derive the Nexus user via linked_account_id"
);

// credential_ref lives in exactly one place so the relationship is enforced by
// a single FK, not duplicated between tables.
const linksTable = dbProposal.match(/CREATE TABLE linked_platform_accounts \(([\s\S]*?)\);/);
assert.ok(linksTable, "linked_platform_accounts must be defined in the proposal");
assert.doesNotMatch(
  linksTable[1],
  /credential_ref/,
  "linked_platform_accounts must not duplicate credential_ref"
);

assert.ok(
  !fs.existsSync(path.join(migrationsDir, "020_nexus_multi_platform_foundation.sql")),
  "the proposed migration must not be added to the migrations directory"
);

console.log(
  `Nexus multi-platform foundation validation passed (${assertions} domain assertions, ${domainFiles.length} domain modules).`
);
