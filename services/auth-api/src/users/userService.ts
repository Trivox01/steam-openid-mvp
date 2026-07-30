import {
  UserManagementError,
  type UserQuery,
  type UserSort,
  type UserStatus
} from "./contracts.ts";
import type { UserRepository } from "./userRepository.ts";

export class UserService {
  readonly repository: UserRepository;
  constructor(repository: UserRepository) {
    this.repository = repository;
  }
  list(query: UserQuery) { return this.repository.list(query); }
  get(id: string) { return this.repository.get(parseUuid(id)); }
  count() { return this.repository.count(); }
}

export function parseUserQuery(params: URLSearchParams): UserQuery {
  const page = integer(params.get("page"), 1, 10_000, 1);
  const pageSize = integer(params.get("pageSize"), 1, 50, 20);
  const search = params.get("search")?.trim();
  if (search && search.length > 80) throw new UserManagementError("INVALID_USER_QUERY");
  const status = params.get("status");
  if (status && status !== "active") throw new UserManagementError("INVALID_USER_QUERY");
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
