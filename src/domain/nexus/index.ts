/**
 * Nexus multi-platform domain foundation (Phase 1, design-only).
 *
 * DESKTOP-SAFE barrel: only contracts that may ship to the React/Tauri app are
 * re-exported here. Backend-owned Nexus contracts (the provider-facing sync
 * runtime, credential metadata, the linked-account server record and the
 * linking/disconnect policy) live in the auth-api backend tree and are
 * deliberately NOT re-exported, so the desktop cannot import them through its
 * normal domain barrel.
 *
 * Nothing exported here is wired into the running application yet. See
 * docs/architecture/MULTI_PLATFORM_ACCOUNTS.md for scope and migration path.
 */

export * from "./provider.ts";
export * from "./identity.ts";
export * from "./catalog.ts";
export * from "./achievements.ts";
export * from "./steamCompatibility.ts";
