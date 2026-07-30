import { randomUUID } from "node:crypto";
import type { PermissionKey } from "./permissions.ts";
import { defaultRolePermissions, rolePresets } from "./roles.ts";

export interface AuthorizationUser {
  id: string;
  steamId64: string;
}

export interface AuthorizationUserSummary {
  id: string;
  displayName: string;
  status: "active" | "suspended" | "disabled";
}

export interface AuthorizationRole {
  id: string;
  slug: string;
  displayName: string;
  priority: number;
  isSystem: boolean;
}

export interface PermissionOverride {
  permission: PermissionKey;
  effect: "allow" | "deny";
}

export interface AuditEventInput {
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AuthorizationRepository {
  validateSchema(): Promise<void>;
  ensureAuthenticatedUser(steamId64: string, authenticatedAt: string): Promise<AuthorizationUser>;
  findUserById(userId: string): Promise<AuthorizationUser | undefined>;
  findUserBySteamId(steamId64: string): Promise<AuthorizationUser | undefined>;
  listUserSummaries(input: {
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: AuthorizationUserSummary[]; total: number }>;
  getUserRoles(userId: string): Promise<AuthorizationRole[]>;
  getRolePermissions(roleIds: readonly string[]): Promise<PermissionKey[]>;
  getUserPermissionOverrides(userId: string): Promise<PermissionOverride[]>;
  findRole(roleId: string): Promise<AuthorizationRole | undefined>;
  findRoleBySlug(slug: string): Promise<AuthorizationRole | undefined>;
  hasActiveOwner(): Promise<boolean>;
  assignRole(input: { userId: string; roleId: string; assignedByUserId?: string }): Promise<void>;
  revokeRole(input: { userId: string; roleId: string; revokedAt: string }): Promise<void>;
  addPermissionOverride(input: {
    userId: string;
    permission: PermissionKey;
    effect: "allow" | "deny";
    assignedByUserId: string;
    reason?: string;
  }): Promise<void>;
  revokePermissionOverride(input: { userId: string; permission: PermissionKey; revokedAt: string }): Promise<void>;
  writeAuditEvent(event: AuditEventInput): Promise<void>;
}

export class InMemoryAuthorizationRepository implements AuthorizationRepository {
  readonly users = new Map<string, AuthorizationUser>();
  readonly roles = new Map<string, AuthorizationRole>();
  readonly userRoles: Array<{ userId: string; roleId: string; revokedAt?: string }> = [];
  readonly overrides: Array<PermissionOverride & { userId: string; revokedAt?: string }> = [];
  readonly auditEvents: AuditEventInput[] = [];

  constructor() {
    for (const preset of rolePresets) {
      const id = `role-${preset.slug}`;
      this.roles.set(id, { id, ...preset, isSystem: true });
    }
  }

  async validateSchema() {}

  async ensureAuthenticatedUser(steamId64: string, _authenticatedAt: string) {
    const existing = await this.findUserBySteamId(steamId64);
    if (existing) return existing;
    const user = { id: randomUUID(), steamId64 };
    this.users.set(user.id, user);
    return user;
  }

  async findUserById(userId: string) { return this.users.get(userId); }
  async findUserBySteamId(steamId64: string) {
    return [...this.users.values()].find((user) => user.steamId64 === steamId64);
  }
  async listUserSummaries(input: {
    search?: string; page: number; pageSize: number;
  }) {
    const query = input.search?.trim().toLowerCase();
    const users = [...this.users.values()].filter((user) =>
      !query || user.id.toLowerCase().includes(query)
    );
    const start = (input.page - 1) * input.pageSize;
    return {
      items: users.slice(start, start + input.pageSize).map((user) => ({
        id: user.id,
        displayName: `User ${user.id.slice(0, 8)}`,
        status: "active" as const
      })),
      total: users.length
    };
  }
  async getUserRoles(userId: string) {
    return this.userRoles
      .filter((entry) => entry.userId === userId && !entry.revokedAt)
      .map((entry) => this.roles.get(entry.roleId))
      .filter((role): role is AuthorizationRole => Boolean(role));
  }
  async getRolePermissions(roleIds: readonly string[]) {
    const permissions = new Set<PermissionKey>();
    for (const roleId of roleIds) {
      const role = this.roles.get(roleId);
      if (!role || !(role.slug in defaultRolePermissions)) continue;
      for (const permission of defaultRolePermissions[role.slug as keyof typeof defaultRolePermissions]) {
        permissions.add(permission);
      }
    }
    return [...permissions];
  }
  async getUserPermissionOverrides(userId: string) {
    return this.overrides
      .filter((entry) => entry.userId === userId && !entry.revokedAt)
      .map(({ permission, effect }) => ({ permission, effect }));
  }
  async findRole(roleId: string) { return this.roles.get(roleId); }
  async findRoleBySlug(slug: string) {
    return [...this.roles.values()].find((role) => role.slug === slug);
  }
  async hasActiveOwner() {
    const owner = await this.findRoleBySlug("owner");
    return Boolean(owner && this.userRoles.some((entry) => entry.roleId === owner.id && !entry.revokedAt));
  }
  async assignRole(input: { userId: string; roleId: string; assignedByUserId?: string }) {
    if (!this.userRoles.some((entry) => entry.userId === input.userId && entry.roleId === input.roleId && !entry.revokedAt)) {
      this.userRoles.push({ userId: input.userId, roleId: input.roleId });
    }
  }
  async revokeRole(input: { userId: string; roleId: string; revokedAt: string }) {
    const active = this.userRoles.find((entry) => entry.userId === input.userId && entry.roleId === input.roleId && !entry.revokedAt);
    if (active) active.revokedAt = input.revokedAt;
  }
  async addPermissionOverride(input: {
    userId: string; permission: PermissionKey; effect: "allow" | "deny";
    assignedByUserId: string; reason?: string;
  }) {
    this.overrides.push({ userId: input.userId, permission: input.permission, effect: input.effect });
  }
  async revokePermissionOverride(input: { userId: string; permission: PermissionKey; revokedAt: string }) {
    for (const entry of this.overrides) {
      if (entry.userId === input.userId && entry.permission === input.permission && !entry.revokedAt) {
        entry.revokedAt = input.revokedAt;
      }
    }
  }
  async writeAuditEvent(event: AuditEventInput) {
    this.auditEvents.push({
      ...structuredClone(event),
      metadata: sanitizeAuditMetadata(event.metadata)
    });
  }
}

export function sanitizeAuditMetadata(metadata: AuditEventInput["metadata"]) {
  if (!metadata) return {};
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/token|secret|password|openid|api.?key/i.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}
