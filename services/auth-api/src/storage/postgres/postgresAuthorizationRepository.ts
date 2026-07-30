import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import type {
  AuditEventInput,
  AuthorizationRepository,
  AuthorizationRole,
  AuthorizationUser,
  PermissionOverride
} from "../../authorization/authorizationRepository.ts";
import { sanitizeAuditMetadata } from "../../authorization/authorizationRepository.ts";
import {
  PERMISSION_KEYS,
  isPermissionKey,
  type PermissionKey
} from "../../authorization/permissions.ts";
import { StorageError } from "../authRepository.ts";

export class PostgresAuthorizationRepository implements AuthorizationRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const requiredTables = [
      "users", "roles", "permissions", "role_permissions", "user_roles",
      "user_permission_overrides", "audit_events"
    ];
    const rows = await this.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
      [requiredTables]
    );
    if (new Set(rows.map((row) => row.table_name)).size !== requiredTables.length) {
      throw new Error("authorization_schema_invalid");
    }
    const [roles, permissions] = await Promise.all([
      this.query<{ count: string }>(
        "SELECT count(*) FROM roles WHERE is_system = true",
        []
      ),
      this.query<{ count: string }>("SELECT count(*) FROM permissions", [])
    ]);
    if (
      Number(roles[0]?.count) !== 5 ||
      Number(permissions[0]?.count) !== PERMISSION_KEYS.length
    ) {
      throw new Error("authorization_schema_invalid");
    }
  }

  async ensureAuthenticatedUser(steamId64: string, authenticatedAt: string) {
    return this.queryOne<AuthorizationUser>(
      `INSERT INTO users (id, steam_id64, authenticated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (steam_id64) DO UPDATE SET
         authenticated_at = EXCLUDED.authenticated_at,
         updated_at = now()
       RETURNING id, trim(steam_id64) AS "steamId64"`,
      [randomUUID(), steamId64, authenticatedAt]
    );
  }

  async findUserById(userId: string) {
    return this.queryOptional<AuthorizationUser>(
      `SELECT id, trim(steam_id64) AS "steamId64" FROM users WHERE id = $1`,
      [userId]
    );
  }

  async findUserBySteamId(steamId64: string) {
    return this.queryOptional<AuthorizationUser>(
      `SELECT id, trim(steam_id64) AS "steamId64" FROM users WHERE steam_id64 = $1`,
      [steamId64]
    );
  }

  async getUserRoles(userId: string) {
    return this.query<AuthorizationRole>(
      `SELECT r.id, r.slug, r.display_name AS "displayName",
              r.priority, r.is_system AS "isSystem"
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND ur.revoked_at IS NULL
       ORDER BY r.priority DESC`,
      [userId]
    );
  }

  async getRolePermissions(roleIds: readonly string[]) {
    if (!roleIds.length) return [];
    const rows = await this.query<{ key: string }>(
      `SELECT DISTINCT p.key FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ANY($1::text[])`,
      [roleIds]
    );
    return rows.map((row) => row.key).filter(isPermissionKey);
  }

  async getUserPermissionOverrides(userId: string) {
    const rows = await this.query<{ permission: string; effect: "allow" | "deny" }>(
      `SELECT p.key AS permission, upo.effect
       FROM user_permission_overrides upo
       JOIN permissions p ON p.id = upo.permission_id
       WHERE upo.user_id = $1 AND upo.revoked_at IS NULL`,
      [userId]
    );
    return rows.filter((row): row is PermissionOverride => isPermissionKey(row.permission));
  }

  async findRole(roleId: string) {
    return this.roleQuery("r.id = $1", roleId);
  }

  async findRoleBySlug(slug: string) {
    return this.roleQuery("r.slug = $1", slug);
  }

  async hasActiveOwner() {
    const rows = await this.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE r.slug = 'owner' AND ur.revoked_at IS NULL
       ) AS exists`,
      []
    );
    return rows[0]?.exists ?? false;
  }

  async assignRole(input: { userId: string; roleId: string; assignedByUserId?: string }) {
    await this.execute(
      `INSERT INTO user_roles (user_id, role_id, assigned_by_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, role_id) WHERE revoked_at IS NULL DO NOTHING`,
      [input.userId, input.roleId, input.assignedByUserId ?? null]
    );
  }

  async revokeRole(input: { userId: string; roleId: string; revokedAt: string }) {
    await this.execute(
      `UPDATE user_roles SET revoked_at = $3
       WHERE user_id = $1 AND role_id = $2 AND revoked_at IS NULL`,
      [input.userId, input.roleId, input.revokedAt]
    );
  }

  async addPermissionOverride(input: {
    userId: string; permission: PermissionKey; effect: "allow" | "deny";
    assignedByUserId: string; reason?: string;
  }) {
    await this.execute(
      `INSERT INTO user_permission_overrides (
         user_id, permission_id, effect, assigned_by_user_id, reason
       ) SELECT $1, id, $3, $4, $5 FROM permissions WHERE key = $2`,
      [input.userId, input.permission, input.effect, input.assignedByUserId, input.reason ?? null]
    );
  }

  async revokePermissionOverride(input: { userId: string; permission: PermissionKey; revokedAt: string }) {
    await this.execute(
      `UPDATE user_permission_overrides upo SET revoked_at = $3
       FROM permissions p
       WHERE upo.permission_id = p.id AND upo.user_id = $1
         AND p.key = $2 AND upo.revoked_at IS NULL`,
      [input.userId, input.permission, input.revokedAt]
    );
  }

  async writeAuditEvent(event: AuditEventInput) {
    const metadata = sanitizeAuditMetadata(event.metadata);
    await this.execute(
      `INSERT INTO audit_events (
         actor_user_id, action, target_type, target_id, metadata_json
       ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        event.actorUserId ?? null,
        event.action,
        event.targetType,
        event.targetId ?? null,
        JSON.stringify(metadata)
      ]
    );
  }

  private roleQuery(predicate: string, value: string) {
    return this.queryOptional<AuthorizationRole>(
      `SELECT r.id, r.slug, r.display_name AS "displayName",
              r.priority, r.is_system AS "isSystem"
       FROM roles r WHERE ${predicate}`,
      [value]
    );
  }
  private async query<T extends QueryResultRow>(sql: string, values: unknown[]) {
    try { return (await this.pool.query<T>(sql, values)).rows; }
    catch { throw new StorageError(); }
  }
  private async queryOne<T extends QueryResultRow>(sql: string, values: unknown[]) {
    const row = (await this.query<T>(sql, values))[0];
    if (!row) throw new StorageError();
    return row;
  }
  private async queryOptional<T extends QueryResultRow>(sql: string, values: unknown[]) {
    return (await this.query<T>(sql, values))[0];
  }
  private async execute(sql: string, values: unknown[]) {
    try { await this.pool.query(sql, values); }
    catch { throw new StorageError(); }
  }
}
