import {
  UserManagementError,
  type UserQuery,
  type UserSort,
  type UserStatus
} from "./contracts.ts";
import type { UserRepository } from "./userRepository.ts";
import type { AuthorizationRepository } from "../authorization/authorizationRepository.ts";

export class UserService {
  readonly repository: UserRepository;
  private readonly audit?: AuthorizationRepository;
  constructor(repository: UserRepository, audit?: AuthorizationRepository) {
    this.repository = repository;
    this.audit = audit;
  }
  list(query: UserQuery) { return this.repository.list(query); }
  get(id: string) { return this.repository.get(parseUuid(id)); }
  count() { return this.repository.count(); }
  async changeStatus(
    actorId: string,
    userId: string,
    input: unknown
  ) {
    const id = parseUuid(userId);
    const parsed = parseStatusInput(input);
    const existing = await this.repository.get(id);
    if (!existing) throw new UserManagementError("USER_NOT_FOUND");
    if (existing.status === parsed.status) {
      throw new UserManagementError("USER_STATUS_UNCHANGED");
    }
    await this.repository.changeStatus(id, parsed.status);
    // Suspending or disabling an account must not leave already-issued bearer
    // tokens usable, so the session generation is advanced as part of the same
    // administrative action. Reactivating does not revoke anything.
    if (parsed.status !== "active") {
      await this.audit?.revokeSessions(id);
    }
    await this.audit?.writeAuditEvent({
      actorUserId: actorId,
      action: "user.status_changed",
      targetType: "user",
      targetId: id,
      metadata: {
        previousStatus: existing.status,
        newStatus: parsed.status,
        ...(parsed.reason ? { reason: parsed.reason } : {})
      }
    });
    return this.repository.get(id);
  }
}

export function parseUserQuery(params: URLSearchParams): UserQuery {
  const page = integer(params.get("page"), 1, 10_000, 1);
  const pageSize = integer(params.get("pageSize"), 1, 50, 20);
  const search = params.get("search")?.trim();
  if (search && search.length > 80) throw new UserManagementError("INVALID_USER_QUERY");
  const status = params.get("status");
  if (status && !isUserStatus(status)) throw new UserManagementError("INVALID_USER_QUERY");
  const sort = params.get("sort") ?? "created_desc";
  if (!["created_desc", "created_asc", "last_login_desc", "name_asc", "badges_desc"].includes(sort)) {
    throw new UserManagementError("INVALID_USER_QUERY");
  }
  return {
    page, pageSize, sort: sort as UserSort,
    ...(search ? { search } : {}),
    ...(status ? { status: status as UserStatus } : {})
  };
}

function parseStatusInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserManagementError("INVALID_USER_STATUS");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "status" && key !== "reason") ||
      !isUserStatus(record.status)) {
    throw new UserManagementError("INVALID_USER_STATUS");
  }
  if (record.reason !== undefined &&
      (typeof record.reason !== "string" ||
       !record.reason.trim() ||
       record.reason.trim().length > 500)) {
    throw new UserManagementError("INVALID_STATUS_REASON");
  }
  return {
    status: record.status,
    ...(typeof record.reason === "string"
      ? { reason: record.reason.trim() }
      : {})
  };
}

function isUserStatus(value: unknown): value is UserStatus {
  return value === "active" || value === "suspended" || value === "disabled";
}

function parseUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new UserManagementError("INVALID_USER_ID");
  }
  return value.toLowerCase();
}
function integer(value: string | null, min: number, max: number, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new UserManagementError("INVALID_USER_QUERY");
  }
  return parsed;
}
