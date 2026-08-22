/**
 * Backend-owned Nexus contracts.
 *
 * Never import this barrel from the React/Tauri desktop app. The desktop's
 * domain barrel (src/domain/nexus/index.ts) deliberately does not re-export
 * anything from this tree.
 *
 * Phase 1 contributed design-only contracts. Phase 2A adds the first real
 * persistence: the linked-account repository and the Steam transitional ensure
 * service.
 */

export * from "./identity.ts";
export * from "./adapter.ts";
export * from "./linkedAccountRepository.ts";
export * from "./linkedAccountService.ts";
