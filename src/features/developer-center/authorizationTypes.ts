export interface AuthorizationRole {
  slug: string;
  displayName: string;
  priority: number;
}

export interface AuthorizationSnapshot {
  roles: AuthorizationRole[];
  permissions: string[];
  canAccessDeveloperCenter: boolean;
}

export type AuthorizationLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "authenticated"; snapshot: AuthorizationSnapshot }
  | { status: "error"; error: "network" | "malformed" | "unknown" };
