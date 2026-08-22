/**
 * Nexus identity — BACKEND-OWNED server records and account policy.
 *
 * This module lives in the auth-api backend tree on purpose: the linked-account
 * server record, credential metadata, the public-projection mapper and the
 * linking/disconnect policy must never execute in, or be importable from, the
 * React/Tauri desktop app. The desktop only knows the allowlisted
 * LinkedPlatformAccountPublic projection defined in src/domain/nexus/identity.ts.
 *
 * Phase 1 defines contracts and pure policy only: no credential store, no
 * provider I/O, no runtime integration.
 */

import type { NexusProvider } from "../../../../src/domain/nexus/provider.ts";
import {
  isProviderLinkable,
  providerDescriptor
} from "../../../../src/domain/nexus/provider.ts";
import type {
  LinkedAccountConnectionStatus,
  LinkedAccountSyncStatus,
  LinkedPlatformAccountId,
  LinkedPlatformAccountPublic,
  NexusUserId
} from "../../../../src/domain/nexus/identity.ts";

/**
 * BACKEND-ONLY credential metadata. It deliberately cannot carry a token:
 * `credentialRef` is an opaque handle into a server-side, encrypted credential
 * store. It must never appear in a desktop-facing payload.
 */
export type ProviderCredentialMetadata = {
  readonly credentialRef: string;
  readonly encryptionKeyId: string;
  readonly expiresAt?: string;
  readonly refreshExpiresAt?: string;
  readonly lastRefreshedAt?: string;
  readonly revocationSupported: boolean;
};

/** Backend server record for one linked provider account. Never a UI DTO. */
export type LinkedPlatformAccount = {
  readonly id: LinkedPlatformAccountId;
  readonly userId: NexusUserId;
  readonly provider: NexusProvider;
  /** Steam ID64, Xbox XUID, PlayStation account id. Provider-scoped only. */
  readonly providerUserId: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
  readonly connectionStatus: LinkedAccountConnectionStatus;
  readonly scopes: readonly string[];
  /** Backend-only. Absent for Steam OpenID, which issues no tokens. */
  readonly credentialMetadata?: ProviderCredentialMetadata;
  readonly linkedAt: string;
  readonly lastSyncAt?: string;
  readonly lastSyncStatus?: LinkedAccountSyncStatus;
};

/**
 * Explicit allowlist projection: only the named safe fields cross to the
 * desktop. userId and credentialMetadata stay server-side. This allowlist is
 * the primary security boundary.
 */
export function toPublicLinkedAccount(
  account: LinkedPlatformAccount
): LinkedPlatformAccountPublic {
  return {
    id: account.id,
    provider: account.provider,
    providerUserId: account.providerUserId,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    connectionStatus: account.connectionStatus,
    scopes: account.scopes,
    linkedAt: account.linkedAt,
    lastSyncAt: account.lastSyncAt,
    lastSyncStatus: account.lastSyncStatus
  };
}

export type AccountLinkRejectionReason =
  | "unauthenticated_nexus_user"
  | "provider_not_enabled"
  | "implicit_email_match_not_allowed"
  | "provider_account_already_linked"
  | "duplicate_provider_for_user";

export type AccountLinkEvaluationInput = {
  /** Linking always requires an already authenticated Nexus user. */
  readonly authenticatedNexusUserId?: NexusUserId | null;
  readonly provider: NexusProvider;
  readonly providerUserId: string;
  readonly existingAccounts: readonly LinkedPlatformAccount[];
  /**
   * True when the only evidence connecting this provider account to the Nexus
   * user is a matching email address. That is never sufficient.
   */
  readonly matchedByEmailOnly?: boolean;
};

export type AccountLinkEvaluation =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: AccountLinkRejectionReason };

function isActiveLink(account: LinkedPlatformAccount): boolean {
  return (
    account.connectionStatus !== "revoked" &&
    account.connectionStatus !== "disconnected"
  );
}

/**
 * Explicit, user-initiated linking policy. Automatic linking is impossible by
 * construction: without an authenticated Nexus user the evaluation fails.
 */
export function evaluateAccountLink(
  input: AccountLinkEvaluationInput
): AccountLinkEvaluation {
  if (!input.authenticatedNexusUserId) {
    return { allowed: false, reason: "unauthenticated_nexus_user" };
  }
  if (!isProviderLinkable(input.provider)) {
    return { allowed: false, reason: "provider_not_enabled" };
  }
  if (input.matchedByEmailOnly === true) {
    return { allowed: false, reason: "implicit_email_match_not_allowed" };
  }
  const active = input.existingAccounts.filter(isActiveLink);
  const sameProviderIdentity = active.some(
    (account) =>
      account.provider === input.provider &&
      account.providerUserId === input.providerUserId
  );
  if (sameProviderIdentity) {
    return { allowed: false, reason: "provider_account_already_linked" };
  }
  const alreadyHasProvider = active.some(
    (account) =>
      account.userId === input.authenticatedNexusUserId &&
      account.provider === input.provider
  );
  if (alreadyHasProvider) {
    return { allowed: false, reason: "duplicate_provider_for_user" };
  }
  return { allowed: true };
}

export type CredentialDisposition =
  | "revoke_then_delete"
  | "delete_only"
  | "not_applicable";

export type DisconnectPlan = {
  readonly provider: NexusProvider;
  readonly linkedAccountId: LinkedPlatformAccountId;
  readonly credentialDisposition: CredentialDisposition;
  readonly removesOwnership: boolean;
  readonly removesAchievementState: boolean;
  /** Canonical and platform catalog rows are shared reference data. */
  readonly retainsCanonicalCatalog: boolean;
};

export function planDisconnect(account: LinkedPlatformAccount): DisconnectPlan {
  const descriptor = providerDescriptor(account.provider);
  let credentialDisposition: CredentialDisposition = "not_applicable";
  if (descriptor.expectsProviderCredentials && account.credentialMetadata) {
    credentialDisposition = account.credentialMetadata.revocationSupported
      ? "revoke_then_delete"
      : "delete_only";
  } else if (descriptor.expectsProviderCredentials) {
    credentialDisposition = "delete_only";
  }
  return {
    provider: account.provider,
    linkedAccountId: account.id,
    credentialDisposition,
    removesOwnership: true,
    removesAchievementState: true,
    retainsCanonicalCatalog: true
  };
}

/** Binding between a Nexus user and a linked account id (backend use). */
export type NexusAccountBinding = {
  readonly userId: NexusUserId;
  readonly linkedAccountId: LinkedPlatformAccountId;
};

/** Minimal Steam identity assertion as verified by the backend OpenID flow. */
export type SteamIdentityProfile = {
  readonly steamId: string;
  readonly personaName: string;
  readonly avatarUrl?: string;
};

/**
 * Steam OpenID returns an identity assertion, not tokens, so the linked account
 * carries no scopes and no credential metadata.
 */
export function linkedAccountFromSteamIdentity(
  profile: SteamIdentityProfile,
  binding: NexusAccountBinding,
  linkedAt: string,
  lastSyncAt?: string
): LinkedPlatformAccount {
  return {
    id: binding.linkedAccountId,
    userId: binding.userId,
    provider: "steam",
    providerUserId: profile.steamId,
    displayName: profile.personaName,
    avatarUrl: profile.avatarUrl,
    connectionStatus: "connected",
    scopes: [],
    linkedAt,
    lastSyncAt
  };
}

const FORBIDDEN_CREDENTIAL_KEYS: readonly string[] = [
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessionticket",
  "clientsecret",
  "apikey",
  "password",
  "privatekey",
  "webapikey"
];

function normalizeKey(key: string): string {
  return key.replace(/[-_\s]/g, "").toLowerCase();
}

/**
 * Defense-in-depth TEST helper only. This is NOT the primary security
 * boundary: scanning a blacklist of suspicious key names cannot prove a
 * payload is free of secrets. The real boundary is the allowlisted
 * LinkedPlatformAccountPublic projection, which cannot structurally contain
 * credential material. These helpers exist so validators can catch an
 * accidental leak during development.
 */
export function findRawCredentialFields(
  value: unknown,
  path = "$",
  seen: Set<object> = new Set()
): string[] {
  if (value === null || typeof value !== "object") return [];
  if (seen.has(value as object)) return [];
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findRawCredentialFields(item, `${path}[${index}]`, seen)
    );
  }
  const findings: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_CREDENTIAL_KEYS.includes(normalizeKey(key))) {
      findings.push(`${path}.${key}`);
    }
    findings.push(...findRawCredentialFields(child, `${path}.${key}`, seen));
  }
  return findings;
}

export class CredentialBoundaryError extends Error {
  readonly code = "raw_credential_field_detected";
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super("raw_credential_field_detected");
    this.name = "CredentialBoundaryError";
    this.fields = fields;
  }
}

export function assertNoRawCredentials(value: unknown): void {
  const fields = findRawCredentialFields(value);
  if (fields.length > 0) throw new CredentialBoundaryError(fields);
}
