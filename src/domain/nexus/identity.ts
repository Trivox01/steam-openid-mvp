/**
 * Nexus account identity: the owner identity of the product.
 *
 * A NexusUser is never a Steam user. Steam, Xbox and PlayStation accounts are
 * LinkedPlatformAccount rows owned by a NexusUser. Phase 1 defines the
 * contracts and the linking/disconnect policy only; nothing here touches the
 * live Steam OpenID or desktop session implementation.
 */

import type { NexusProvider } from "./provider.ts";
import { isProviderLinkable, providerDescriptor } from "./provider.ts";

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
 * Metadata about a provider credential. It deliberately cannot carry a token:
 * `credentialRef` is an opaque handle into a server-side, encrypted credential
 * store. No field of this type may ever reach React, frontend persistence, the
 * desktop SQLite cache, source control or logs.
 */
export type ProviderTokenMetadata = {
  readonly credentialRef: string;
  readonly encryptionKeyId: string;
  readonly expiresAt?: string;
  readonly refreshExpiresAt?: string;
  readonly lastRefreshedAt?: string;
  readonly revocationSupported: boolean;
};

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
  /** Absent for Steam OpenID, which issues no tokens. */
  readonly tokenMetadata?: ProviderTokenMetadata;
  readonly linkedAt: string;
  readonly lastSyncAt?: string;
  readonly lastSyncStatus?: LinkedAccountSyncStatus;
};

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
  if (descriptor.expectsProviderCredentials && account.tokenMetadata) {
    credentialDisposition = account.tokenMetadata.revocationSupported
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
 * Structural guard used by the contract validators and available to any future
 * serializer that crosses a trust boundary (HTTP response, desktop cache, log
 * line). Returns the dotted paths of fields that look like raw credentials.
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
