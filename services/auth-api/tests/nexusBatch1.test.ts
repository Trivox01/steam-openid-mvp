/**
 * Nexus Batch 1 unit tests (Phase 3B/3C/3D).
 *
 * Runs with: npm --prefix services/auth-api run test:nexus-batch1
 * No PostgreSQL connection required; repository DTOs are exercised against the
 * schema in the separate PostgreSQL integration test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Phase 3B domain contracts.
import {
  canCompareProviderScores,
  legacySteamAchievementKey,
  platformAchievementKey,
  summarizeAchievementProgress
} from "../../../src/domain/nexus/achievements.ts";
import type {
  PlatformAchievement,
  ProviderScore,
  UserAchievementState
} from "../../../src/domain/nexus/achievements.ts";

// Phase 3D domain contracts (catalog + canonical trust).
import {
  canonicalGroupKey,
  groupOwnershipByCanonical,
  isVerifiedMapping,
  legacySteamGameKey,
  linkPlatformGameToCanonical,
  platformGameKey,
  suggestionFromUserConfirmation
} from "../../../src/domain/nexus/catalog.ts";
import type {
  CanonicalMapping,
  PlatformGame,
  UserGameOwnership
} from "../../../src/domain/nexus/catalog.ts";

// Phase 3C capability model.
import {
  capabilityStatus,
  isProviderLinkable,
  providerDescriptor,
  supportsCapability
} from "../../../src/domain/nexus/provider.ts";

// Phase 3C backend adapter (injected legacy bridge, no credentials).
import { SteamPlatformAdapter } from "../src/nexus/steamPlatformAdapter.ts";
import type { SteamLegacySyncBridge } from "../src/nexus/steamPlatformAdapter.ts";
import {
  adapterSupports,
  emptyCounters,
  unsupportedAchievementSync,
  unsupportedLibrarySync
} from "../src/nexus/adapter.ts";
import type { AdapterContext } from "../src/nexus/adapter.ts";

const NOW = "2026-08-23T00:00:00.000Z";
const STEAM_ID = "76561190000000001";
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

// ---------------------------------------------------------------------------
// Phase 3B — Achievements Foundation
// ---------------------------------------------------------------------------

test("completion truth: unknown unlock state is never counted as locked", () => {
  const states: UserAchievementState[] = [
    { id: "s1", linkedAccountId: "link-1", platformAchievementId: "a", unlocked: true, unlockStateKnown: true },
    { id: "s2", linkedAccountId: "link-1", platformAchievementId: "b", unlocked: false, unlockStateKnown: true },
    { id: "s3", linkedAccountId: "link-1", platformAchievementId: "c", unlocked: false, unlockStateKnown: false }
  ];
  const summary = summarizeAchievementProgress(states);
  assert.equal(summary.total, 3);
  assert.equal(summary.known, 2);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.unlocked, 1);
  assert.equal(
    summary.completionPercentage,
    null,
    "an exact completion figure is impossible while unknown states exist"
  );
  assert.equal(summary.knownCompletionPercentage, 50, "the diagnostic known-only figure stays available");
  assert.ok(!("userId" in states[0]), "achievement state carries no redundant userId");
});

test("completion percentage is exact only when every state is known", () => {
  const allKnown = summarizeAchievementProgress([
    { id: "s1", linkedAccountId: "link-1", platformAchievementId: "a", unlocked: true, unlockStateKnown: true },
    { id: "s2", linkedAccountId: "link-1", platformAchievementId: "b", unlocked: false, unlockStateKnown: true }
  ]);
  assert.equal(allKnown.completionPercentage, 50);

  const empty = summarizeAchievementProgress([]);
  assert.equal(empty.completionPercentage, null);
  assert.equal(empty.knownCompletionPercentage, null);

  const unknownOnly = summarizeAchievementProgress([
    { id: "s3", linkedAccountId: "link-1", platformAchievementId: "c", unlocked: false, unlockStateKnown: false }
  ]);
  assert.equal(unknownOnly.completionPercentage, null);
  assert.equal(unknownOnly.knownCompletionPercentage, null);
});

test("provider scores are never compared across providers", () => {
  assert.ok(
    canCompareProviderScores(
      { kind: "xbox_gamerscore", value: 10 } as ProviderScore,
      { kind: "xbox_gamerscore", value: 20 } as ProviderScore
    ),
    "same-provider scores are comparable"
  );
  assert.ok(
    !canCompareProviderScores(
      { kind: "xbox_gamerscore", value: 10 } as ProviderScore,
      { kind: "playstation_trophy", grade: "gold" } as ProviderScore
    ),
    "scores must never be compared across providers"
  );
  assert.ok(
    !canCompareProviderScores({ kind: "none" } as ProviderScore, { kind: "none" } as ProviderScore),
    "Steam has no comparable score currency"
  );
});

test("achievement identity keys stay provider and game scoped", () => {
  assert.equal(platformAchievementKey("steam", "10", "ACH"), "steam:10:ACH");
  assert.equal(legacySteamAchievementKey(10, "ACH"), "steam:10:ACH");
});

test("internal achievement id is opaque and distinct from the provider id", () => {
  const achievement: PlatformAchievement = {
    id: "internal-uuid-0001",
    platformGameId: "pg-0001",
    providerAchievementId: "ACH_WIN_ONE_GAME",
    title: "Winner",
    description: "",
    hidden: false
  };
  assert.notEqual(achievement.id, achievement.providerAchievementId, "the internal id is never the provider id");
  assert.ok(!("provider" in achievement), "an achievement carries no provider field; it is derived via its PlatformGame");
});

// ---------------------------------------------------------------------------
// Phase 3C — Steam Adapter
// ---------------------------------------------------------------------------

function fakeBridge() {
  const calls = { syncLibrary: 0, syncAchievements: 0 };
  const bridge: SteamLegacySyncBridge = {
    syncLibrary: async () => {
      calls.syncLibrary += 1;
      return { fetched: 2, inserted: 1, updated: 1, unchanged: 0, skipped: 0, failed: 0, syncedAt: NOW, warnings: ["w1"] };
    },
    syncAchievements: async (input) => {
      calls.syncAchievements += 1;
      const requested = input.gameIds?.length ?? 0;
      return { gamesRequested: requested, gamesSucceeded: requested, gamesFailed: 0, syncedAt: NOW, warnings: [] };
    }
  };
  return { bridge, calls };
}

function steamContext(): AdapterContext {
  return {
    nexusUserId: "nexus-user-1",
    linkedAccountId: "link-1",
    providerUserId: STEAM_ID
  };
}

test("Steam adapter exposes proven Steam capabilities only", () => {
  const { bridge } = fakeBridge();
  const adapter = new SteamPlatformAdapter(bridge);
  assert.equal(adapter.provider, "steam");
  assert.deepEqual(adapter.capabilities, providerDescriptor("steam").capabilities);
  assert.ok(supportsCapability("steam", "library") && supportsCapability("steam", "achievements"));
  assert.ok(adapter.capabilities.library === "supported" && adapter.capabilities.achievements === "supported");
});

test("Steam adapter delegates library sync to the legacy bridge", async () => {
  const { bridge, calls } = fakeBridge();
  const adapter = new SteamPlatformAdapter(bridge);
  const outcome = await adapter.syncLibrary(steamContext());
  assert.equal(calls.syncLibrary, 1, "the legacy bridge must be invoked exactly once");
  assert.equal(outcome.provider, "steam");
  assert.equal(outcome.linkedAccountId, "link-1");
  assert.equal(outcome.status, "success");
  assert.equal(outcome.counters.fetched, 2);
  assert.deepEqual(outcome.warnings, ["w1"]);
});

test("Steam adapter delegates achievement sync to the legacy bridge", async () => {
  const { bridge, calls } = fakeBridge();
  const adapter = new SteamPlatformAdapter(bridge);
  const outcome = await adapter.syncAchievements(steamContext(), { providerGameIds: ["10", "20"], reason: "manual" });
  assert.equal(calls.syncAchievements, 1, "the legacy bridge must be invoked exactly once");
  assert.equal(outcome.capability, "achievements");
  assert.deepEqual(outcome.providerGameIds, ["10", "20"]);
  assert.equal(outcome.status, "success");
  assert.equal(outcome.counters.updated, 2);
});

test("Steam profile projection carries no credentials", async () => {
  const { bridge } = fakeBridge();
  const adapter = new SteamPlatformAdapter(bridge);
  const profile = await adapter.getProfile(steamContext());
  assert.equal(profile.provider, "steam");
  assert.equal(profile.providerUserId, STEAM_ID);
  const serialized = JSON.stringify(profile);
  for (const forbidden of ["token", "secret", "credential", "password", "api_key", "access_token"]) {
    assert.ok(!serialized.toLowerCase().includes(forbidden), `profile must not expose ${forbidden}`);
  }
});

test("Steam adapter fails clearly on an unsupported capability", async () => {
  const { bridge } = fakeBridge();
  const adapter = new SteamPlatformAdapter(bridge);
  await assert.rejects(() => adapter.disconnect());
});

test("unsupported capability helpers return honest empty outcomes", () => {
  const libraryRefusal = unsupportedLibrarySync("playstation", "link-ps-1", NOW);
  assert.equal(libraryRefusal.status, "unsupported");
  assert.equal(libraryRefusal.counters.fetched, 0);
  assert.deepEqual(libraryRefusal.counters, emptyCounters());

  const achievementRefusal = unsupportedAchievementSync("xbox", "link-x-1", ["1"], NOW);
  assert.equal(achievementRefusal.status, "unsupported");
  assert.deepEqual(achievementRefusal.counters, emptyCounters());

  assert.ok(
    !adapterSupports({ capabilities: providerDescriptor("xbox").capabilities }, "library"),
    "adapters must gate on proven capabilities only"
  );
  assert.ok(
    adapterSupports({ capabilities: providerDescriptor("steam").capabilities }, "library"),
    "the Steam adapter surface must keep its library capability"
  );
});

// ---------------------------------------------------------------------------
// Phase 3D — Nexus Integration (Catalog <-> Achievements ownership flow)
// ---------------------------------------------------------------------------

test("provider identity derives the canonical mapping, never the other way", () => {
  const steamGame: PlatformGame = {
    id: "pg-internal-0001",
    provider: "steam",
    providerGameId: "1091500",
    title: "Cyberpunk 2077",
    firstSeenAt: NOW,
    updatedAt: NOW
  };
  assert.equal(platformGameKey("steam", "1091500"), "steam:1091500");
  assert.equal(legacySteamGameKey(1091500), "steam:1091500");
  assert.equal(steamGame.id, "pg-internal-0001");
  assert.notEqual(steamGame.id, steamGame.providerGameId, "the internal id is opaque and distinct from the provider key");
  assert.equal(steamGame.canonicalGameId, undefined, "platform games start without a canonical link");

  const userMapping = suggestionFromUserConfirmation("sug-1", steamGame.id, "canonical-cp2077", "nexus-user-1", NOW);
  assert.equal(userMapping.method, "user_confirmed");
  assert.equal(userMapping.status, "pending");
  assert.ok(!("verifiedBy" in userMapping), "a user suggestion carries no verification evidence");

  const forged = {
    method: "user_confirmed",
    confidence: "verified",
    verifiedBy: "nexus-user-1",
    verifiedAt: NOW
  };
  assert.ok(!isVerifiedMapping(forged as unknown as CanonicalMapping), "user_confirmed is never a verified mapping method");
  assert.throws(() => linkPlatformGameToCanonical(steamGame, "canonical-cp2077", forged as unknown as CanonicalMapping, NOW));

  const editorial: CanonicalMapping = {
    method: "editorial_verified",
    confidence: "verified",
    verifiedBy: "catalog-operator",
    verifiedAt: NOW
  };
  const mapped = linkPlatformGameToCanonical(steamGame, "canonical-cp2077", editorial, NOW);
  assert.equal(mapped.canonicalGameId, "canonical-cp2077");
});

test("ownership and achievement state derive the Nexus user via the linked account", () => {
  const sampleOwnership: UserGameOwnership = {
    id: "own-1",
    linkedAccountId: "link-1",
    platformGameId: "pg-0001",
    playtimeKnown: true,
    firstSeenAt: NOW
  };
  assert.ok(!("userId" in sampleOwnership), "ownership carries no redundant userId");
  assert.ok(!("provider" in sampleOwnership), "ownership carries no redundant provider");

  const state: UserAchievementState = {
    id: "state-1",
    linkedAccountId: "link-1",
    platformAchievementId: "a-1",
    unlocked: true,
    unlockStateKnown: true
  };
  assert.ok(!("userId" in state), "achievement state carries no redundant userId");
});

test("unmapped platform games keep a provider-scoped group key (no silent merge)", () => {
  const portal: PlatformGame = {
    id: "pg-portal",
    provider: "steam",
    providerGameId: "400",
    title: "Portal",
    firstSeenAt: NOW,
    updatedAt: NOW
  };
  const cyberpunkUnmapped: PlatformGame = {
    id: "pg-cp-unmapped",
    provider: "steam",
    providerGameId: "1091500",
    title: "Cyberpunk 2077",
    firstSeenAt: NOW,
    updatedAt: NOW
  };
  const groups = groupOwnershipByCanonical([
    { ownership: { id: "o1", linkedAccountId: "link-1", platformGameId: "pg-portal", playtimeKnown: true, firstSeenAt: NOW }, platformGame: portal },
    { ownership: { id: "o2", linkedAccountId: "link-1", platformGameId: "pg-cp-unmapped", playtimeKnown: true, firstSeenAt: NOW }, platformGame: cyberpunkUnmapped }
  ]);
  assert.equal(groups.length, 2, "unmapped platform games must not merge into one group");
  for (const group of groups) {
    assert.ok(group.key.startsWith("unmapped:"), "unmapped entries keep a provider-scoped group key");
    assert.ok(!group.key.includes("steam:1091500"), "the group key must use the internal id, not the provider id");
  }
  assert.equal(canonicalGroupKey(cyberpunkUnmapped), `unmapped:${cyberpunkUnmapped.id}`);
});

// ---------------------------------------------------------------------------
// Security / boundary guards
// ---------------------------------------------------------------------------

test("no desktop code imports the backend adapter or achievement repository", () => {
  const desktopFiles = walk(path.join(REPO_ROOT, "src"));
  const forbiddenImports = [
    "services/auth-api/src/nexus/steamPlatformAdapter",
    "services/auth-api/src/nexus/achievementRepository"
  ];
  const violations: string[] = [];
  for (const file of desktopFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const forbidden of forbiddenImports) {
      if (source.includes(forbidden)) violations.push(`${file} -> ${forbidden}`);
    }
  }
  assert.deepEqual(violations, [], "desktop must never import backend-only Nexus persistence/adapters");
});

test("backend adapter and repository carry no provider credentials", () => {
  const scanned = [
    path.join(REPO_ROOT, "services/auth-api/src/nexus/steamPlatformAdapter.ts"),
    path.join(REPO_ROOT, "services/auth-api/src/nexus/achievementRepository.ts")
  ];
  const forbidden = [
    "access_token",
    "refresh_token",
    "client_secret",
    "api_key",
    "credential_ref",
    "encryption_key",
    "session_token",
    "poll_secret",
    "password"
  ];
  for (const file of scanned) {
    const source = fs.readFileSync(file, "utf8").toLowerCase();
    for (const token of forbidden) {
      assert.ok(!source.includes(token), `${file} must not contain ${token}`);
    }
  }
});

test("the domain tree does not import the backend tree (no circular dependency)", () => {
  const domainDir = path.join(REPO_ROOT, "src/domain/nexus");
  // Only genuine import specifiers matter; documentation may name the backend
  // module without importing it. Match `from "...services/auth-api..."` only.
  const importPattern = /from\s+["'][^"']*services\/auth-api[^"']*["']/;
  for (const file of fs.readdirSync(domainDir).filter((name) => name.endsWith(".ts"))) {
    const source = fs.readFileSync(path.join(domainDir, file), "utf8");
    assert.ok(!importPattern.test(source), `${file} must not import the backend tree`);
  }
});
