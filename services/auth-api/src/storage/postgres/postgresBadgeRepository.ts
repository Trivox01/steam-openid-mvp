import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { BadgeRepository } from "../../badges/badgeRepository.ts";
import type {
  BadgeAsset,
  BadgeDefinition,
  BadgeListQuery,
  BadgeMutation
} from "../../badges/contracts.ts";

export class PostgresBadgeRepository implements BadgeRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const result = await this.pool.query<{ count: string }>(
       `SELECT count(1) FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name IN (
           'badge_definitions',
           'badge_assets',
           'badge_asset_cleanup_jobs'
         )`
    );
    if (Number(result.rows[0]?.count) !== 3) throw new Error("badge_schema_invalid");
  }

  async list(query: BadgeListQuery) {
    const values: unknown[] = [];
    const clauses: string[] = [];
    const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (query.search) clauses.push(`(display_name ILIKE ${add(`%${query.search}%`)} OR slug ILIKE $${values.length})`);
    if (query.category) clauses.push(`category = ${add(query.category)}`);
    if (query.rarity) clauses.push(`rarity = ${add(query.rarity)}`);
    if (query.status === "active") clauses.push("archived_at IS NULL AND is_active = true");
    if (query.status === "inactive") clauses.push("archived_at IS NULL AND is_active = false");
    if (query.status === "archived") clauses.push("archived_at IS NOT NULL");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const order = {
      updated_desc: "updated_at DESC",
      updated_asc: "updated_at ASC",
      priority_desc: "priority DESC, display_name ASC",
      name_asc: "display_name ASC"
    }[query.sort];
    const count = await this.pool.query<{ count: string }>(
      `SELECT count(1) FROM badge_definitions ${where}`, values
    );
    const limit = add(query.pageSize);
    const offset = add((query.page - 1) * query.pageSize);
    const rows = await this.pool.query(
      `SELECT ${BADGE_COLUMNS} FROM badge_definitions
       ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    return { items: rows.rows.map(mapBadge), total: Number(count.rows[0].count) };
  }

  async get(id: string) {
    const result = await this.pool.query(
      `SELECT ${BADGE_COLUMNS} FROM badge_definitions WHERE id = $1`, [id]
    );
    return result.rows[0] ? mapBadge(result.rows[0]) : undefined;
  }

  create(input: BadgeMutation, actorUserId: string) {
    return this.mutate(async (client) => {
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO badge_definitions (
          id, slug, display_name, description, category, rarity, icon_asset_id,
          priority, is_active, is_visible, grant_mode, starts_at, ends_at,
          created_by_user_id, updated_by_user_id
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14
        ) RETURNING ${BADGE_COLUMNS}`,
        badgeValues(id, input, actorUserId)
      );
      await audit(client, actorUserId, "badge.created", id, {
        category: input.category, rarity: input.rarity
      });
      return mapBadge(result.rows[0]);
    });
  }

  update(id: string, input: BadgeMutation, actorUserId: string, changedFields: string[]) {
    return this.mutate(async (client) => {
      const previous = await client.query<{ is_active: boolean }>(
        "SELECT is_active FROM badge_definitions WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
        [id]
      );
      if (!previous.rowCount) return undefined;
      const result = await client.query(
        `UPDATE badge_definitions SET
          slug=$2, display_name=$3, description=$4, category=$5, rarity=$6,
          icon_asset_id=$7, priority=$8, is_active=$9, is_visible=$10,
          grant_mode=$11, starts_at=$12, ends_at=$13,
          updated_by_user_id=$14, updated_at=now()
         WHERE id=$1 AND archived_at IS NULL RETURNING ${BADGE_COLUMNS}`,
        badgeValues(id, input, actorUserId)
      );
      const action = !previous.rows[0].is_active && input.isActive
        ? "badge.reactivated" : "badge.updated";
      await audit(client, actorUserId, action, id, {
        changedFields: changedFields.join(","),
        category: input.category,
        rarity: input.rarity
      });
      if (changedFields.includes("iconAssetId")) {
        await audit(client, actorUserId, "badge.icon_replaced", id, {});
      }
      return result.rows[0] ? mapBadge(result.rows[0]) : undefined;
    });
  }

  archive(id: string, actorUserId: string) {
    return this.mutate(async (client) => {
      const result = await client.query(
        `UPDATE badge_definitions SET is_active=false, archived_at=now(),
          updated_at=now(), updated_by_user_id=$2
         WHERE id=$1 AND archived_at IS NULL RETURNING ${BADGE_COLUMNS}`,
        [id, actorUserId]
      );
      if (!result.rowCount) return undefined;
      await audit(client, actorUserId, "badge.archived", id, {});
      return mapBadge(result.rows[0]);
    });
  }

  saveAsset(input: Omit<BadgeAsset, "id" | "createdAt"> & { storageKey: string }, actorUserId: string) {
    return this.mutate(async (client) => {
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO badge_assets (
          id, storage_key, content_type, byte_size, width, height, created_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id, content_type, byte_size, width, height, created_at`,
        [id, input.storageKey, input.contentType, input.byteSize, input.width, input.height, actorUserId]
      );
      await audit(client, actorUserId, "badge.icon_uploaded", id, {
        contentType: input.contentType,
        byteSize: input.byteSize,
        width: input.width,
        height: input.height
      });
      return mapAsset(result.rows[0]);
    });
  }

  async getAsset(id: string) {
    const result = await this.pool.query(
      `SELECT id, storage_key, content_type, byte_size, width, height,
              created_at, deleted_at
       FROM badge_assets WHERE id=$1`, [id]
    );
    if (!result.rows[0]) return undefined;
    const row = result.rows[0];
    return {
      ...mapAsset(row),
      storageKey: String(row.storage_key),
      ...(row.deleted_at ? { deletedAt: toIso(row.deleted_at) } : {})
    };
  }

  deleteUnusedAsset(id: string, actorUserId: string) {
    return this.mutate(async (client) => {
      const result = await client.query<{ storage_key: string }>(
        `UPDATE badge_assets SET deleted_at=now()
         WHERE id=$1 AND deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM badge_definitions
             WHERE icon_asset_id=$1
           )
         RETURNING storage_key`,
        [id]
      );
      if (!result.rowCount) {
        const used = await client.query(
          "SELECT 1 FROM badge_definitions WHERE icon_asset_id=$1",
          [id]
        );
        if (used.rowCount) throw new Error("badge_asset_in_use");
        return undefined;
      }
      await audit(client, actorUserId, "badge.asset_deleted", id, {});
      return result.rows[0].storage_key;
    });
  }

  async listAvailableAssets(limit: number) {
    const result = await this.pool.query(
      `SELECT id, storage_key, content_type, byte_size, width, height, created_at
       FROM badge_assets
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT $1`,
      [Math.min(Math.max(limit, 1), 500)]
    );
    return result.rows.map((row) => ({
      ...mapAsset(row),
      storageKey: String(row.storage_key)
    }));
  }

  async enqueueAssetCleanup(input: {
    storageKey: string;
    assetId?: string;
    reason: "metadata_rollback" | "icon_replaced" | "asset_deleted";
  }) {
    await this.pool.query(
      `INSERT INTO badge_asset_cleanup_jobs (
        id, asset_id, storage_key, reason
      ) VALUES ($1,$2,$3,$4)
      ON CONFLICT (storage_key) WHERE completed_at IS NULL DO NOTHING`,
      [randomUUID(), input.assetId ?? null, input.storageKey, input.reason]
    );
  }

  private async mutate<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

const BADGE_COLUMNS = `id, slug, display_name, description, category, rarity,
  icon_asset_id, priority, is_active, is_visible, grant_mode, starts_at,
  ends_at, created_at, updated_at, archived_at`;

function badgeValues(id: string, input: BadgeMutation, actorUserId: string) {
  return [
    id, input.slug, input.displayName, input.description, input.category,
    input.rarity, input.iconAssetId ?? null, input.priority, input.isActive,
    input.isVisible, input.grantMode, input.startsAt ?? null,
    input.endsAt ?? null, actorUserId
  ];
}
function mapBadge(row: QueryResultRow): BadgeDefinition {
  return {
    id: String(row.id), slug: String(row.slug),
    displayName: String(row.display_name), description: String(row.description),
    category: row.category, rarity: row.rarity,
    ...(row.icon_asset_id ? { iconAssetId: String(row.icon_asset_id) } : {}),
    priority: Number(row.priority), isActive: Boolean(row.is_active),
    isVisible: Boolean(row.is_visible), grantMode: row.grant_mode,
    ...(row.starts_at ? { startsAt: toIso(row.starts_at) } : {}),
    ...(row.ends_at ? { endsAt: toIso(row.ends_at) } : {}),
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
    ...(row.archived_at ? { archivedAt: toIso(row.archived_at) } : {})
  };
}
function mapAsset(row: QueryResultRow): BadgeAsset {
  const width = Number(row.width);
  const height = Number(row.height);
  return {
    id: String(row.id), contentType: row.content_type,
    byteSize: Number(row.byte_size), width, height, isSquare: width === height,
    createdAt: toIso(row.created_at)
  };
}
function toIso(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
async function audit(
  client: PoolClient,
  actorUserId: string,
  action: string,
  targetId: string,
  metadata: Record<string, string | number>
) {
  await client.query(
    `INSERT INTO audit_events (
      actor_user_id, action, target_type, target_id, metadata_json
    ) VALUES ($1,$2,'badge',$3,$4::jsonb)`,
    [actorUserId, action, targetId, JSON.stringify(metadata)]
  );
}
