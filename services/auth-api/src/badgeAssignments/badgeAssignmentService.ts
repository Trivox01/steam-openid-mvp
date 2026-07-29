import type { BadgeAssignmentRepository } from "./badgeAssignmentRepository.ts";
import {
  assignmentSources,
  BadgeAssignmentError,
  type BadgeAssignmentQuery
} from "./contracts.ts";

export class BadgeAssignmentService {
  readonly repository: BadgeAssignmentRepository;
  private readonly now: () => number;
  constructor(
    repository: BadgeAssignmentRepository,
    now: () => number = Date.now
  ) {
    this.repository = repository;
    this.now = now;
  }
  list(query: BadgeAssignmentQuery) { return this.repository.list(query); }
  get(id: string) {
    return this.repository.get(parseUuid(id, "INVALID_ASSIGNMENT_ID"));
  }
  hasActive(userId: string, badgeDefinitionId: string) {
    return this.repository.hasActive(userId, badgeDefinitionId);
  }
  assign(value: unknown, actorUserId: string) {
    const input = parseAssign(value);
    return this.repository.assign({
      ...input,
      actorUserId,
      assignedAt: new Date(this.now()).toISOString(),
      source: "manual"
    });
  }
  revoke(id: string, value: unknown, actorUserId: string) {
    return this.repository.revoke({
      assignmentId: parseUuid(id, "INVALID_ASSIGNMENT_ID"),
      actorUserId,
      revokedAt: new Date(this.now()).toISOString(),
      reason: parseReason(value)
    });
  }
}

export function parseAssignmentQuery(params: URLSearchParams): BadgeAssignmentQuery {
  const page = parseInteger(params.get("page"), 1, 10_000, 1);
  const pageSize = parseInteger(params.get("pageSize"), 1, 100, 20);
  const status = params.get("status") ?? "all";
  if (!["all", "active", "revoked"].includes(status)) {
    throw new BadgeAssignmentError("INVALID_ASSIGNMENT_QUERY");
  }
  const source = params.get("source");
  if (source && !assignmentSources.includes(source as typeof assignmentSources[number])) {
    throw new BadgeAssignmentError("INVALID_ASSIGNMENT_QUERY");
  }
  const sort = params.get("sort") ?? "assigned_desc";
  if (!["assigned_desc", "assigned_asc", "updated_desc"].includes(sort)) {
    throw new BadgeAssignmentError("INVALID_ASSIGNMENT_QUERY");
  }
  const userId = optionalUuid(params.get("userId"));
  const badgeDefinitionId = optionalUuid(params.get("badgeId"));
  const from = optionalDate(params.get("from"));
  const to = optionalDate(params.get("to"));
  if (from && to && from > to) throw new BadgeAssignmentError("INVALID_ASSIGNMENT_QUERY");
  return {
    page,
    pageSize,
    status: status as BadgeAssignmentQuery["status"],
    sort: sort as BadgeAssignmentQuery["sort"],
    ...(source ? { source: source as BadgeAssignmentQuery["source"] } : {}),
    ...(userId ? { userId } : {}),
    ...(badgeDefinitionId ? { badgeDefinitionId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {})
  };
}

function parseAssign(value: unknown) {
  const input = asObject(value);
  assertAllowedKeys(input, ["userId", "badgeDefinitionId", "reason"]);
  return {
    userId: parseUuid(input.userId, "INVALID_USER_ID"),
    badgeDefinitionId: parseUuid(input.badgeDefinitionId, "INVALID_BADGE_ID"),
    reason: normalizeReason(input.reason)
  };
}
function parseReason(value: unknown) {
  const input = asObject(value);
  assertAllowedKeys(input, ["reason"]);
  return normalizeReason(input.reason);
}
function normalizeReason(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new BadgeAssignmentError("INVALID_REASON");
  const reason = value.trim();
  if (!reason || reason.length > 500 || /<[^>]*>/.test(reason)) {
    throw new BadgeAssignmentError("INVALID_REASON");
  }
  return reason;
}
function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadgeAssignmentError("INVALID_REQUEST");
  }
  return value as Record<string, unknown>;
}
function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new BadgeAssignmentError("INVALID_REQUEST");
  }
}
function parseUuid(value: unknown, code: string) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadgeAssignmentError(code);
  }
  return value.toLowerCase();
}
function optionalUuid(value: string | null) {
  return value ? parseUuid(value, "INVALID_ASSIGNMENT_QUERY") : undefined;
}
function optionalDate(value: string | null) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new BadgeAssignmentError("INVALID_ASSIGNMENT_QUERY");
  return new Date(timestamp).toISOString();
}
function parseInteger(value: string | null, min: number, max: number, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new BadgeAssignmentError("INVALID_ASSIGNMENT_QUERY");
  }
  return parsed;
}
