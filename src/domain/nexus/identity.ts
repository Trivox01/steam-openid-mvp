/**
 * Nexus account identity — DESKTOP-SAFE public contracts.
 *
 * This module intentionally contains only types that are safe to ship to the
 * React/Tauri desktop app. The backend server record, credential metadata,
 * linking/disconnect policy and the projection mapper live in the
 * backend-owned Nexus module inside services/auth-api and cannot be imported
 * through this desktop barrel.
 */

import type { NexusProvider } from "./provider.ts";

export type NexusUserId = string;
export type LinkedPlatformAccountId = string;

export type NexusAccountStatus = "active" | "suspended" | "disabled";

export type NexusUser = {
  /** Nexus-owned identifier. Never a provider identifier. */
  readonly id: NexusUserId;
  readonly displayName: string;
  readonly avatarUrl?: string;
  readonly status: NexusAccountStatus;
  readonly createdAt: string;
  readonly lastLoginAt?: string;
  /** RBAC role slugs stay attached to the Nexus user, not to a provider. */
  readonly roleSlugs?: readonly string[];
  /** Presentation default only. It carries no identity meaning. */
  readonly preferredProvider?: NexusProvider;
};

export type LinkedAccountConnectionStatus =
  | "connected"
  | "reauth_required"
  | "revoked"
  | "disconnected"
  | "error";

export type LinkedAccountSyncStatus = "idle" | "success" | "partial" | "error";

/**
 * Allowlisted desktop/Tauri-facing projection of a linked account. This is the
 * primary security boundary: the desktop only ever receives this shape, which
 * structurally cannot contain credentialRef, encryptionKeyId or any other
 * credential detail. The backend builds it from the server record; that record
 * never crosses to the desktop.
 */
export type LinkedPlatformAccountPublic = {
  readonly id: LinkedPlatformAccountId;
  readonly provider: NexusProvider;
  readonly providerUserId: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
  readonly connectionStatus: LinkedAccountConnectionStatus;
  readonly scopes: readonly string[];
  readonly linkedAt: string;
  readonly lastSyncAt?: string;
  readonly lastSyncStatus?: LinkedAccountSyncStatus;
};
