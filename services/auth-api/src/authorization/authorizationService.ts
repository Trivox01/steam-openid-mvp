import type { AuthorizationSnapshot, RoleSummary } from "./contracts.ts";
import { AuthorizationError } from "./contracts.ts";
import type {
  AuthorizationRepository,
  AuthorizationRole
} from "./authorizationRepository.ts";
import type { PermissionKey } from "./permissions.ts";

export class AuthorizationService {
  readonly repository: AuthorizationRepository;
  private readonly now: () => number;

  constructor(
    repository: AuthorizationRepository,
    now: () => number = Date.now
  ) {
    this.repository = repository;
    this.now = now;
  }

  getUserRoles(userId: string) {
    return this.repository.getUserRoles(userId);
  }

  async getEffectivePermissions(userId: string): Promise<PermissionKey[]> {
    const roles = await this.repository.getUserRoles(userId);
    const rolePermissions = await this.repository.getRolePermissions(roles.map((role) => role.id));
    const overrides = await this.repository.getUserPermissionOverrides(userId);
    const denied = new Set(overrides.filter((item) => item.effect === "deny").map((item) => item.permission));
    const allowed = new Set(overrides.filter((item) => item.effect === "allow").map((item) => item.permission));

    // Resolution order is deliberately deny -> allow -> role -> default deny.
    const authenticatedDefaults: PermissionKey[] = ["tools.rate", "tools.view_ratings", "tools.view_reviews", "tools.write_review", "tools.report_review", "tools.vote_review_helpful", "tools.favorite", "tools.view_public_stats"];
    return [...new Set([...authenticatedDefaults, ...rolePermissions, ...allowed])]
      .filter((permission) => !denied.has(permission))
      .sort();
  }

  async hasPermission(userId: string, permission: PermissionKey) {
    return (await this.getEffectivePermissions(userId)).includes(permission);
  }

  async requirePermission(userId: string, permission: PermissionKey) {
    if (!await this.hasPermission(userId, permission)) {
      await this.auditDenied(userId, permission);
      throw new AuthorizationError("PERMISSION_DENIED");
    }
  }

  async getSnapshot(userId: string): Promise<AuthorizationSnapshot> {
    const roles = await this.getUserRoles(userId);
    const permissions = await this.getEffectivePermissions(userId);
    return {
      roles: roles
        .map(toRoleSummary)
        .sort((left, right) => right.priority - left.priority),
      permissions,
      canAccessDeveloperCenter: permissions.includes("admin.access")
    };
  }

  async canManageUser(actorId: string, targetUserId: string) {
    if (!await this.hasPermission(actorId, "users.manage")) return false;
    return this.canManageUserHierarchy(actorId, targetUserId);
  }

  /**
   * The self / owner / priority half of user management, without the
   * "users.manage" requirement. Routes that already gate on their own permission
   * (for example "users.change_status") use this so the hierarchy is enforced
   * without silently introducing a second required permission.
   */
  async canManageUserHierarchy(actorId: string, targetUserId: string) {
    if (actorId === targetUserId) return false;
    const [actorPriority, targetPriority, targetRoles] = await Promise.all([
      this.highestPriority(actorId),
      this.highestPriority(targetUserId),
      this.getUserRoles(targetUserId)
    ]);
    if (targetRoles.some((role) => role.slug === "owner")) {
      return (await this.getUserRoles(actorId)).some((role) => role.slug === "owner");
    }
    return actorPriority > targetPriority;
  }

  async canAssignRole(actorId: string, roleId: string) {
    const role = await this.repository.findRole(roleId);
    if (!role || role.slug === "owner") return false;
    if (!await this.hasPermission(actorId, "roles.assign")) return false;
    return (await this.highestPriority(actorId)) > role.priority;
  }

  async assignRole(actorId: string, targetUserId: string, roleId: string) {
    if (actorId === targetUserId) {
      throw new AuthorizationError("SELF_PRIVILEGE_CHANGE_DENIED");
    }
    if (!await this.canManageUser(actorId, targetUserId) ||
        !await this.canAssignRole(actorId, roleId)) {
      throw new AuthorizationError("ROLE_ASSIGNMENT_DENIED");
    }
    await this.repository.assignRole({
      userId: targetUserId,
      roleId,
      assignedByUserId: actorId
    });
    await this.repository.writeAuditEvent({
      actorUserId: actorId,
      action: "authorization.role_assigned",
      targetType: "user",
      targetId: targetUserId,
      metadata: { roleId }
    });
  }

  async revokeRole(actorId: string, targetUserId: string, roleId: string) {
    if (actorId === targetUserId) {
      throw new AuthorizationError("SELF_PRIVILEGE_CHANGE_DENIED");
    }
    if (!await this.canManageUser(actorId, targetUserId)) {
      throw new AuthorizationError("ROLE_ASSIGNMENT_DENIED");
    }
    const role = await this.repository.findRole(roleId);
    if (!role || role.slug === "owner" &&
        !(await this.getUserRoles(actorId)).some((item) => item.slug === "owner")) {
      throw new AuthorizationError("PROTECTED_ROLE");
    }
    await this.repository.revokeRole({
      userId: targetUserId,
      roleId,
      revokedAt: new Date(this.now()).toISOString()
    });
    // Losing a role reduces privileges, and existing bearer tokens carry no
    // permission claims of their own, so the sessions are invalidated to force a
    // re-read of the reduced authority.
    await this.repository.revokeSessions(targetUserId);
    await this.repository.writeAuditEvent({
      actorUserId: actorId,
      action: "authorization.role_revoked",
      targetType: "user",
      targetId: targetUserId,
      metadata: { roleId }
    });
  }

  async setPermissionOverride(input: {
    actorId: string;
    targetUserId: string;
    permission: PermissionKey;
    effect: "allow" | "deny";
    reason?: string;
  }) {
    if (input.actorId === input.targetUserId) {
      throw new AuthorizationError("SELF_PRIVILEGE_CHANGE_DENIED");
    }
    await this.requirePermission(input.actorId, "roles.manage_permissions");
    if (!await this.canManageUser(input.actorId, input.targetUserId)) {
      throw new AuthorizationError("PERMISSION_DENIED");
    }
    await this.repository.addPermissionOverride({
      userId: input.targetUserId,
      permission: input.permission,
      effect: input.effect,
      assignedByUserId: input.actorId,
      ...(input.reason ? { reason: input.reason } : {})
    });
    // Only privilege reductions revoke. A deny override takes authority away, so
    // live sessions must be re-evaluated; granting does not need revocation.
    if (input.effect === "deny") {
      await this.repository.revokeSessions(input.targetUserId);
    }
    await this.repository.writeAuditEvent({
      actorUserId: input.actorId,
      action: "authorization.permission_override_added",
      targetType: "user",
      targetId: input.targetUserId,
      metadata: { permission: input.permission, effect: input.effect }
    });
  }

  async revokePermissionOverride(input: {
    actorId: string;
    targetUserId: string;
    permission: PermissionKey;
  }) {
    if (input.actorId === input.targetUserId) {
      throw new AuthorizationError("SELF_PRIVILEGE_CHANGE_DENIED");
    }
    await this.requirePermission(input.actorId, "roles.manage_permissions");
    if (!await this.canManageUser(input.actorId, input.targetUserId)) {
      throw new AuthorizationError("PERMISSION_DENIED");
    }
    await this.repository.revokePermissionOverride({
      userId: input.targetUserId,
      permission: input.permission,
      revokedAt: new Date(this.now()).toISOString()
    });
    await this.repository.writeAuditEvent({
      actorUserId: input.actorId,
      action: "authorization.permission_override_revoked",
      targetType: "user",
      targetId: input.targetUserId,
      metadata: { permission: input.permission }
    });
  }

  async requireRolePermissionMutation(actorId: string, roleId: string) {
    const role = await this.repository.findRole(roleId);
    if (!role) throw new AuthorizationError("PERMISSION_DENIED");
    if (role.isSystem) throw new AuthorizationError("PROTECTED_ROLE");
    await this.requirePermission(actorId, "roles.manage_permissions");
  }

  async bootstrapOwner(steamId64: string | undefined) {
    if (!steamId64) return "not_configured" as const;
    if (!/^\d{17}$/.test(steamId64)) return "invalid_steam_id" as const;
    if (await this.repository.hasActiveOwner()) return "owner_exists" as const;
    const [user, owner] = await Promise.all([
      this.repository.findUserBySteamId(steamId64),
      this.repository.findRoleBySlug("owner")
    ]);
    if (!user) return "user_not_found" as const;
    if (!owner) throw new Error("owner_role_missing");
    await this.repository.assignRole({ userId: user.id, roleId: owner.id });
    await this.repository.writeAuditEvent({
      action: "authorization.bootstrap_owner",
      targetType: "user",
      targetId: user.id,
      metadata: { roleSlug: "owner" }
    });
    return "assigned" as const;
  }

  private async highestPriority(userId: string) {
    return Math.max(0, ...(await this.getUserRoles(userId)).map((role) => role.priority));
  }

  private async auditDenied(actorUserId: string, permission: PermissionKey) {
    await this.repository.writeAuditEvent({
      actorUserId,
      action: "authorization.denied_sensitive_action",
      targetType: "permission",
      metadata: { permission, occurredAt: new Date(this.now()).toISOString() }
    });
  }
}

function toRoleSummary(role: AuthorizationRole): RoleSummary {
  return {
    slug: role.slug,
    displayName: role.displayName,
    priority: role.priority
  };
}
