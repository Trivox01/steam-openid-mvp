import { randomUUID } from "node:crypto";
import type {
  BadgeAssignment,
  BadgeAssignmentQuery,
  BadgeAssignmentSource
} from "./contracts.ts";
import { BadgeAssignmentError } from "./contracts.ts";
import type { BadgeRepository } from "../badges/badgeRepository.ts";
import type { AuthorizationRepository } from "../authorization/authorizationRepository.ts";

export interface BadgeAssignmentRepository {
  validateSchema(): Promise<void>;
  list(query: BadgeAssignmentQuery): Promise<{ items: BadgeAssignment[]; total: number }>;
  get(id: string): Promise<BadgeAssignment | undefined>;
  assign(input: {
    userId: string;
    badgeDefinitionId: string;
    actorUserId: string;
    assignedAt: string;
    reason?: string;
    source: BadgeAssignmentSource;
  }): Promise<BadgeAssignment>;
  revoke(input: {
    assignmentId: string;
    actorUserId: string;
    revokedAt: string;
    reason?: string;
  }): Promise<BadgeAssignment>;
  hasActive(userId: string, badgeDefinitionId: string): Promise<boolean>;
}

export class InMemoryBadgeAssignmentRepository implements BadgeAssignmentRepository {
  readonly assignments = new Map<string, BadgeAssignment>();
  private readonly users: AuthorizationRepository;
  private readonly badges: BadgeRepository;
  constructor(
    users: AuthorizationRepository,
    badges: BadgeRepository
  ) {
    this.users = users;
    this.badges = badges;
  }
  async validateSchema() {}
  async list(query: BadgeAssignmentQuery) {
    let items = [...this.assignments.values()].filter((item) => {
      if (query.status === "active" && item.revokedAt) return false;
      if (query.status === "revoked" && !item.revokedAt) return false;
      if (query.userId && item.userId !== query.userId) return false;
      if (query.badgeDefinitionId && item.badgeDefinitionId !== query.badgeDefinitionId) return false;
      if (query.source && item.source !== query.source) return false;
      if (query.from && item.assignedAt < query.from) return false;
      if (query.to && item.assignedAt > query.to) return false;
      return true;
    });
    items.sort((a, b) => {
      const field = query.sort === "updated_desc" ? "updatedAt" : "assignedAt";
      const delta = Date.parse(a[field]) - Date.parse(b[field]);
      return query.sort === "assigned_asc" ? delta : -delta;
    });
    return {
      total: items.length,
      items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
    };
  }
  async get(id: string) { return this.assignments.get(id); }
  async hasActive(userId: string, badgeDefinitionId: string) {
    return [...this.assignments.values()].some((item) =>
      item.userId === userId &&
      item.badgeDefinitionId === badgeDefinitionId &&
      !item.revokedAt
    );
  }
  async assign(input: {
    userId: string; badgeDefinitionId: string; actorUserId: string;
    assignedAt: string; reason?: string; source: BadgeAssignmentSource;
  }) {
    if (!await this.users.findUserById(input.userId)) {
      throw new BadgeAssignmentError("USER_NOT_FOUND");
    }
    const badge = await this.badges.get(input.badgeDefinitionId);
    assertBadgeAssignable(badge, input.source, input.assignedAt);
    if (await this.hasActive(input.userId, input.badgeDefinitionId)) {
      throw new BadgeAssignmentError("BADGE_ALREADY_ASSIGNED");
    }
    const assignment: BadgeAssignment = {
      id: randomUUID(),
      userId: input.userId,
      badgeDefinitionId: input.badgeDefinitionId,
      assignedByUserId: input.actorUserId,
      assignedAt: input.assignedAt,
      ...(input.reason ? { assignmentReason: input.reason } : {}),
      source: input.source,
      createdAt: input.assignedAt,
      updatedAt: input.assignedAt
    };
    this.assignments.set(assignment.id, assignment);
    await this.users.writeAuditEvent({
      actorUserId: input.actorUserId,
      action: "badge.assignment_created",
      targetType: "badge_assignment",
      targetId: assignment.id,
      metadata: {
        userId: input.userId,
        badgeId: input.badgeDefinitionId,
        source: input.source,
        reasonPresent: Boolean(input.reason)
      }
    });
    return assignment;
  }
  async revoke(input: {
    assignmentId: string; actorUserId: string; revokedAt: string; reason?: string;
  }) {
    const current = this.assignments.get(input.assignmentId);
    if (!current) throw new BadgeAssignmentError("BADGE_ASSIGNMENT_NOT_FOUND");
    if (current.revokedAt) {
      throw new BadgeAssignmentError("BADGE_ASSIGNMENT_ALREADY_REVOKED");
    }
    const next: BadgeAssignment = {
      ...current,
      revokedByUserId: input.actorUserId,
      revokedAt: input.revokedAt,
      ...(input.reason ? { revokeReason: input.reason } : {}),
      updatedAt: input.revokedAt
    };
    this.assignments.set(next.id, next);
    await this.users.writeAuditEvent({
      actorUserId: input.actorUserId,
      action: "badge.assignment_revoked",
      targetType: "badge_assignment",
      targetId: next.id,
      metadata: {
        userId: next.userId,
        badgeId: next.badgeDefinitionId,
        source: next.source,
        reasonPresent: Boolean(input.reason)
      }
    });
    return next;
  }
}

export function assertBadgeAssignable(
  badge: Awaited<ReturnType<BadgeRepository["get"]>>,
  source: BadgeAssignmentSource,
  assignedAt: string
) {
  if (!badge) throw new BadgeAssignmentError("BADGE_NOT_FOUND");
  if (badge.archivedAt) throw new BadgeAssignmentError("BADGE_ARCHIVED");
  if (!badge.isActive) throw new BadgeAssignmentError("BADGE_INACTIVE");
  if (badge.startsAt && Date.parse(assignedAt) < Date.parse(badge.startsAt)) {
    throw new BadgeAssignmentError("BADGE_NOT_STARTED");
  }
  if (badge.endsAt && Date.parse(assignedAt) >= Date.parse(badge.endsAt)) {
    throw new BadgeAssignmentError("BADGE_EXPIRED");
  }
  if (source === "manual" && badge.grantMode === "automatic") {
    throw new BadgeAssignmentError("BADGE_MANUAL_ASSIGNMENT_NOT_ALLOWED");
  }
}
