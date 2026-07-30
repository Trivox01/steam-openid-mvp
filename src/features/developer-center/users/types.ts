export interface ManagedUser {
  id: string;
  displayName?: string;
  steamNickname?: string;
  avatarUrl?: string;
  createdAt: string;
  lastLoginAt: string;
  status: "active";
  badgeCount: number;
  roleCount: number;
}

export interface ManagedUserDetails extends ManagedUser {
  steamId64: string;
  roles: Array<{ slug: string; displayName: string }>;
  badges: Array<{
    slug: string;
    displayName: string;
    rarity: string;
    iconUrl?: string;
  }>;
}

export interface UserPage {
  items: ManagedUser[];
  total: number;
  page: number;
  pageSize: number;
}
