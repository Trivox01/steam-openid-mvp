export type UserStatus = "active" | "suspended" | "disabled";
export type UserSort =
  | "created_desc" | "created_asc" | "last_login_desc"
  | "name_asc" | "badges_desc";

export interface UserSummary {
  id: string;
  displayName?: string;
  steamNickname?: string;
  avatarUrl?: string;
  createdAt: string;
  lastLoginAt: string;
  status: UserStatus;
  badgeCount: number;
  roleCount: number;
}

export interface UserDetails extends UserSummary {
  steamId64: string;
  roles: Array<{ slug: string; displayName: string }>;
  badges: Array<{
    slug: string;
    displayName: string;
    rarity: string;
    iconUrl?: string;
  }>;
}

export interface UserQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: UserStatus;
  sort: UserSort;
}

export class UserManagementError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "UserManagementError";
  }
}

export interface ChangeUserStatusInput {
  status: UserStatus;
  reason?: string;
}
