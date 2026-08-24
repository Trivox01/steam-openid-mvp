/**
 * Backend-owned Nexus contracts.
 *
 * Never import this barrel from the React/Tauri desktop app. The desktop's
 * domain barrel (src/domain/nexus/index.ts) deliberately does not re-export
 * anything from this tree.
 *
 * Phase 1 contributed design-only contracts. Phase 2A added linked-account
 * persistence and transitional Steam dual-write. Phase 2B added the backend-only
 * Steam identity resolver used for a guarded linked-account-first cutover.
 * Phase 3A adds inert backend catalog/ownership persistence primitives; no
 * provider adapter or public route is wired by this barrel.
 */

export * from "./identity.ts";
export * from "./adapter.ts";
export * from "./linkedAccountRepository.ts";
export * from "./linkedAccountService.ts";
export * from "./steamIdentityResolver.ts";
export * from "./catalogRepository.ts";
export * from "./achievementRepository.ts";
export * from "./steamPlatformAdapter.ts";
