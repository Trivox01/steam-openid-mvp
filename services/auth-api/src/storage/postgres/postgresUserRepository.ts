import type { Pool, QueryResultRow } from "pg";
import type { UserRepository } from "../../users/userRepository.ts";
import type { UserDetails, UserQuery, UserSummary } from "../../users/contracts.ts";

export class PostgresUserRepository implements UserRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name='users'
         AND column_name IN (
           'display_name','steam_nickname','avatar_url','account_status'
         )`
    );
    if (Number(result.rows[0]?.count) !== 4) {
      throw new Error("user_management_schema_invalid");
    }
  }

  async list(query: UserQuery) {
    const values: unknown[] = [];
    const clauses: string[] = [];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    if (query.search) {
      const term = add(`%${query.search}%`);
      clauses.push(`(
        u.display_name ILIKE ${term} OR u.steam_nickname ILIKE ${term}
        OR u.id::text ILIKE ${term} OR trim(u.steam_id64) ILIKE ${term}
      )`);
    }
    if (query.status) clauses.push(`u.account_status=${add(query.status)}`);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const order = {
      created_desc: "u.created_at DESC, u.id ASC",
      created_asc: "u.created_at ASC, u.id ASC",
      last_login_desc: "u.authenticated_at DESC, u.id ASC",
      name_asc: "coalesce(u.display_name,u.steam_nickname,'') ASC, u.id ASC",
      badges_desc: "badge_count DESC, u.id ASC"
    }[query.sort];
    const count = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM users u ${where}`,
      values
    );
    const limit = add(query.pageSize);
    const offset = add((query.page - 1) * query.pageSize);
    const result = await this.pool.query(
      `SELECT u.id, u.display_name, u.steam_nickname, u.avatar_url,
              u.created_at, u.authenticated_at, u.account_status,
              count(DISTINCT ba.id) FILTER (WHERE ba.revoked_at IS NULL) AS badge_count,
              count(DISTINCT ur.id) FILTER (WHERE ur.revoked_at IS NULL) AS role_count
       FROM users u
       LEFT JOIN badge_assignments ba ON ba.user_id=u.id
       LEFT JOIN user_roles ur ON ur.user_id=u.id
       ${where}
       GROUP BY u.id
       ORDER BY ${order}
       LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    return {
      items: result.rows.map(mapSummary),
      total: Number(count.rows[0]?.count ?? 0)
    };
  }

  async get(id: string): Promise<UserDetails | undefined> {
    const result = await this.pool.query(
      `SELECT u.id, trim(u.steam_id64) AS steam_id64,
              u.display_name, u.steam_nickname, u.avatar_url,
              u.created_at, u.authenticated_at, u.account_status,
              (SELECT count(*) FROM badge_assignments ba
                WHERE ba.user_id=u.id AND ba.revoked_at IS NULL) AS badge_count,
              (SELECT count(*) FROM user_roles ur
                WHERE ur.user_id=u.id AND ur.revoked_at IS NULL) AS role_count,
              coalesce((SELECT jsonb_agg(jsonb_build_object(
                'slug', r.slug, 'displayName', r.display_name
              ) ORDER BY r.priority DESC)
                FROM user_roles ur JOIN roles r ON r.id=ur.role_id
                WHERE ur.user_id=u.id AND ur.revoked_at IS NULL), '[]') AS roles,
              coalesce((SELECT jsonb_agg(jsonb_build_object(
                'slug', bd.slug, 'displayName', bd.display_name,
                'rarity', bd.rarity,
                'iconUrl', CASE WHEN asset.id IS NOT NULL
                  THEN '/api/public/badge-icons/' || bd.slug ELSE NULL END
              ) ORDER BY bd.priority ASC, ba.assigned_at ASC, bd.id ASC)
                FROM badge_assignments ba
                JOIN badge_definitions bd ON bd.id=ba.badge_definition_id
                LEFT JOIN badge_assets asset ON asset.id=bd.icon_asset_id
                  AND asset.deleted_at IS NULL
                WHERE ba.user_id=u.id AND ba.revoked_at IS NULL
              ), '[]') AS badges
       FROM users u WHERE u.id=$1`,
      [id]
    );
    if (!result.rows[0]) return undefined;
    const row = result.rows[0];
    return {
      ...mapSummary(row),
      steamId64: String(row.steam_id64),
      roles: row.roles,
      badges: row.badges
    };
  }

  async count() {
    const result = await this.pool.query<{ count: string }>("SELECT count(*) FROM users");
    return Number(result.rows[0]?.count ?? 0);
  }
  async changeStatus(id: string, status: UserDetails["status"]) {
    const result = await this.pool.query(
      `UPDATE users SET account_status=$2, updated_at=now() WHERE id=$1`,
      [id, status]
    );
    if (result.rowCount !== 1) throw new Error("user_status_update_failed");
  }
  async updateSteamProfile(
    steamId64: string,
    profile: { steamNickname: string; avatarUrl?: string }
  ) {
    await this.pool.query(
      `UPDATE users SET steam_nickname=$2, avatar_url=$3, updated_at=now()
       WHERE steam_id64=$1`,
      [steamId64, profile.steamNickname, profile.avatarUrl ?? null]
    );
  }
}

function mapSummary(row: QueryResultRow): UserSummary {
  return {
    id: String(row.id),
    ...(row.display_name ? { displayName: String(row.display_name) } : {}),
    ...(row.steam_nickname ? { steamNickname: String(row.steam_nickname) } : {}),
    ...(row.avatar_url ? { avatarUrl: String(row.avatar_url) } : {}),
    createdAt: iso(row.created_at),
    lastLoginAt: iso(row.authenticated_at),
    status: row.account_status,
    badgeCount: Number(row.badge_count),
    roleCount: Number(row.role_count)
  };
}
function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
