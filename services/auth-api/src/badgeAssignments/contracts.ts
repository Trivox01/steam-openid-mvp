export const assignmentSources = [
  "manual",
  "automatic",
  "system",
  "migration"
] as const;
export type BadgeAssignmentSource = typeof assignmentSources[number];

export interface BadgeAssignment {
  id: string;
  userId: string;
  badgeDefinitionId: string;
  assignedByUserId: string;
  assignedAt: string;
  assignmentReason?: string;
  source: BadgeAssignmentSource;
  revokedByUserId?: string;
  revokedAt?: string;
  revokeReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BadgeAssignmentQuery {
  page: number;
  pageSize: number;
  status: "all" | "active" | "revoked";
  userId?: string;
  badgeDefinitionId?: string;
  source?: BadgeAssignmentSource;
  from?: string;
  to?: string;
  sort: "assigned_desc" | "assigned_asc" | "updated_desc";
}

export class BadgeAssignmentError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "BadgeAssignmentError";
    this.code = code;
  }
}
