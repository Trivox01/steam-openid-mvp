import type { PermissionKey } from "./permissions.ts";

export interface RoleSummary {
  slug: string;
  displayName: string;
  priority: number;
}

export interface AuthorizationSnapshot {
  roles: RoleSummary[];
  permissions: PermissionKey[];
  canAccessDeveloperCenter: boolean;
}

export type AuthorizationErrorCode =
  | "AUTHENTICATION_REQUIRED"
  // The signature and expiry were valid, but the account itself may no longer
  // act. Deliberately one opaque code for every non-active status so the
  // response never discloses whether an account is suspended or disabled.
  | "ACCOUNT_NOT_ACTIVE"
  | "PERMISSION_DENIED"
  | "ROLE_ASSIGNMENT_DENIED"
  | "PROTECTED_ROLE"
  | "SELF_PRIVILEGE_CHANGE_DENIED";

export class AuthorizationError extends Error {
  readonly code: AuthorizationErrorCode;

  constructor(code: AuthorizationErrorCode) {
    super(code);
    this.code = code;
    this.name = "AuthorizationError";
  }
}
