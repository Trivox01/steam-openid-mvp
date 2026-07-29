import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { BadgeAssignmentRepository } from "../../badgeAssignments/badgeAssignmentRepository.ts";
import { assertBadgeAssignable } from "../../badgeAssignments/badgeAssignmentRepository.ts";
import {
  BadgeAssignmentError,
  type BadgeAssignment,
  type BadgeAssignmentQuery,
  type BadgeAssignmentSource
} from "../../badgeAssignments/contracts.ts";
import type { BadgeDefinition } from "../../badges/contracts.ts";

export class PostgresBadgeAssignmentRepository implements BadgeAssignmentRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }

  async validateSchema() {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM information_schema.tables
       WHERE table_schema=current_schema()
         AND table_name='badge_assignments'`
    );
    if (Number(result.rows[0]?.count) !== 1) {
      throw new Error("badge_assignment_schema_invalid");
    }
  }

  async list(query: BadgeAssignmentQuery) {
    const values: unknown[] = [];
    const clauses: string[] = [];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    if (query.status === "active") clauses.push("revoked_at IS NULL");
    if (query.status === "revoked") clauses.push("revoked_at IS NOT NULL");
    if (query.userId) clauses.push(`user_id=${add(query.userId)}`);
    if (query.badgeDefinitionId) {
      clauses.push(`badge_definition_id=${add(query.badgeDefinitionId)}`);
    }
    if (query.source) clauses.push(`source=${add(query.source)}`);
    if (query.from) clauses.push(`assigned_at>=${add(query.from)}`);
    if (query.to) clauses.push(`assigned_at<=${add(query.to)}`);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const order = {
      assigned_desc: "assigned_at DESC, id DESC",
      assigned_asc: "assigned_at ASC, id ASC",
      updated_desc: "updated_at DESC, id DESC"
    }[query.sort];
    const count = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM badge_assignments ${where}`,
      values
    );
    const limit = add(query.pageSize);
    const offset = add((query.page - 1) * query.pageSize);
    const result = await this.pool.query(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM badge_assignments
       ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    return {
      total: Number(count.rows[0].count),
      items: result.rows.map(mapAssignment)
    };
  }

  async get(id: string) {
    const result = await this.pool.query(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM badge_assignments WHERE id=$1`,
      [id]
    );
    return result.rows[0] ? mapAssignment(result.rows[0]) : undefined;
  }

  async hasActive(userId: string, badgeDefinitionId: string) {
    const result = await this.pool.query(
      `SELECT 1 FROM badge_assignments
       WHERE user_id=$1 AND badge_definition_id=$2 AND revoked_at IS NULL`,
      [userId, badgeDefinitionId]
    );
    return Boolean(result.rowCount);
  }

  assign(input: {
    userId: string;
    badgeDefinitionId: string;
    actorUserId: string;
    assignedAt: string;
    reason?: string;
    source: BadgeAssignmentSource;
  }) {
    return this.mutate(async (client) => {
      const user = await client.query(
        "SELECT id FROM users WHERE id=$1 FOR SHARE",
        [input.userId]
      );
      if (!user.rowCount) throw new BadgeAssignmentError("USER_NOT_FOUND");
      const badgeResult = await client.query(
        `SELECT id, slug, display_name, description, category, rarity,
          icon_asset_id, priority, is_active, is_visible, grant_mode,
          starts_at, ends_at, created_at, updated_at, archived_at
         FROM badge_definitions WHERE id=$1 FOR SHARE`,
        [input.badgeDefinitionId]
      );
      assertBadgeAssignable(
        badgeResult.rows[0] ? mapBadgeForAssignment(badgeResult.rows[0]) : undefined,
        input.source,
        input.assignedAt
      );
      const id = randomUUID();
      let result;
      try {
        result = await client.query(
          `INSERT INTO badge_assignments (
            id, user_id, badge_definition_id, assigned_by_user_id,
            assigned_at, assignment_reason, source
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)
          RETURNING ${ASSIGNMENT_COLUMNS}`,
          [
            id, input.userId, input.badgeDefinitionId, input.actorUserId,
            input.assignedAt, input.reason ?? null, input.source
          ]
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new BadgeAssignmentError("BADGE_ALREADY_ASSIGNED");
        }
        throw error;
      }
      await audit(client, {
        actorUserId: input.actorUserId,
        action: "badge.assignment_created",
        assignmentId: id,
        userId: input.userId,
        badgeId: input.badgeDefinitionId,
        source: input.source,
        reasonPresent: Boolean(input.reason)
      });
      return mapAssignment(result.rows[0]);
    });
  }

  revoke(input: {
    assignmentId: string;
    actorUserId: string;
    revokedAt: string;
    reason?: string;
  }) {
    return this.mutate(async (client) => {
      const result = await client.query(
        `UPDATE badge_assignments SET
           revoked_by_user_id=$2, revoked_at=$3, revoke_reason=$4,
           updated_at=$3
         WHERE id=$1 AND revoked_at IS NULL
         RETURNING ${ASSIGNMENT_COLUMNS}`,
        [input.assignmentId, input.actorUserId, input.revokedAt, input.reason ?? null]
      );
      if (!result.rowCount) {
        const existing = await client.query<{ revoked_at: Date | null }>(
          "SELECT revoked_at FROM badge_assignments WHERE id=$1",
          [input.assignmentId]
        );
        if (!existing.rowCount) {
          throw new BadgeAssignmentError("BADGE_ASSIGNMENT_NOT_FOUND");
        }
        throw new BadgeAssignmentError("BADGE_ASSIGNMENT_ALREADY_REVOKED");
      }
      const assignment = mapAssignment(result.rows[0]);
      await audit(client, {
        actorUserId: input.actorUserId,
        action: "badge.assignment_revoked",
        assignmentId: assignment.id,
        userId: assignment.userId,
        badgeId: assignment.badgeDefinitionId,
        source: assignment.source,
        reasonPresent: Boolean(input.reason)
      });
      return assignment;
    });
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

const ASSIGNMENT_COLUMNS = `id, user_id, badge_definition_id,
  assigned_by_user_id, assigned_at, assignment_reason, source,
  revoked_by_user_id, revoked_at, revoke_reason, created_at, updated_at`;

function mapAssignment(row: QueryResultRow): BadgeAssignment {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    badgeDefinitionId: String(row.badge_definition_id),
    assignedByUserId: String(row.assigned_by_user_id),
    assignedAt: toIso(row.assigned_at),
    ...(row.assignment_reason ? { assignmentReason: String(row.assignment_reason) } : {}),
    source: row.source,
    ...(row.revoked_by_user_id ? { revokedByUserId: String(row.revoked_by_user_id) } : {}),
    ...(row.revoked_at ? { revokedAt: toIso(row.revoked_at) } : {}),
    ...(row.revoke_reason ? { revokeReason: String(row.revoke_reason) } : {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapBadgeForAssignment(row: QueryResultRow): BadgeDefinition {
  return {
    id: String(row.id),
    slug: String(row.slug),
    displayName: String(row.display_name),
    description: String(row.description),
    category: row.category,
    rarity: row.rarity,
    ...(row.icon_asset_id ? { iconAssetId: String(row.icon_asset_id) } : {}),
    priority: Number(row.priority),
    isActive: Boolean(row.is_active),
    isVisible: Boolean(row.is_visible),
    grantMode: row.grant_mode,
    ...(row.starts_at ? { startsAt: toIso(row.starts_at) } : {}),
    ...(row.ends_at ? { endsAt: toIso(row.ends_at) } : {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    ...(row.archived_at ? { archivedAt: toIso(row.archived_at) } : {})
  };
}

async function audit(client: PoolClient, input: {
  actorUserId: string;
  action: string;
  assignmentId: string;
  userId: string;
  badgeId: string;
  source: string;
  reasonPresent: boolean;
}) {
  await client.query(
    `INSERT INTO audit_events (
      actor_user_id, action, target_type, target_id, metadata_json
    ) VALUES ($1,$2,'badge_assignment',$3,$4::jsonb)`,
    [
      input.actorUserId,
      input.action,
      input.assignmentId,
      JSON.stringify({
        assignmentId: input.assignmentId,
        userId: input.userId,
        badgeId: input.badgeId,
        source: input.source,
        reasonPresent: input.reasonPresent
      })
    ]
  );
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "23505";
}
function toIso(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
