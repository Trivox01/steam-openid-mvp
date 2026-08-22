/**
 * Backend-owned Nexus contracts (Phase 1, design-only).
 *
 * Never import this barrel from the React/Tauri desktop app. The desktop's
 * domain barrel (src/domain/nexus/index.ts) deliberately does not re-export
 * anything from this tree.
 */

export * from "./identity.ts";
export * from "./adapter.ts";
