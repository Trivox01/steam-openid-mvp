import type { ManagedBadge } from "../badges/types";

export type AssignmentSource = "manual" | "automatic" | "system" | "migration";
export type AssignmentStatus = "all" | "active" | "revoked";

export interface BadgeAssignment {
  id: string;
  userId: string;
  badgeDefinitionId: string;
  assignedByUserId: string;
  assignedAt: string;
  assignmentReason?: string;
  source: AssignmentSource;
  revokedByUserId?: string;
  revokedAt?: string;
  revokeReason?: string;
}

export interface AssignmentUser {
  id: string;
  displayName: string;
  status: "active";
}

export interface AssignmentPage {
  items: BadgeAssignment[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AssignmentUserPage {
  items: AssignmentUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AssignmentReferenceData {
  users: AssignmentUser[];
  badges: ManagedBadge[];
}
