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
