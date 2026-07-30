import type { AuthorizationRepository } from "../authorization/authorizationRepository.ts";
import type { BadgeAssignmentRepository } from "../badgeAssignments/badgeAssignmentRepository.ts";
import type { UserDetails, UserQuery, UserSummary } from "./contracts.ts";

export interface UserRepository {
  validateSchema(): Promise<void>;
  list(query: UserQuery): Promise<{ items: UserSummary[]; total: number }>;
  get(id: string): Promise<UserDetails | undefined>;
  count(): Promise<number>;
}

export class InMemoryUserRepository implements UserRepository {
  private readonly authorization: AuthorizationRepository;
  private readonly assignments: BadgeAssignmentRepository;
  constructor(
    authorization: AuthorizationRepository,
    assignments: BadgeAssignmentRepository
  ) {
    this.authorization = authorization;
    this.assignments = assignments;
  }
  async validateSchema() {}
  async list(query: UserQuery) {
    const search = query.search?.toLowerCase();
    let items = await Promise.all(
      [...(this.authorization as { users?: Map<string, { id: string; steamId64: string }> }).users?.values() ?? []]
        .map((user) => this.toSummary(user))
    );
    items = items.filter((item) =>
      !search ||
      item.id.toLowerCase().includes(search) ||
      item.displayName?.toLowerCase().includes(search) ||
      item.steamNickname?.toLowerCase().includes(search) ||
      (this.authorization as { users?: Map<string, { id: string; steamId64: string }> })
        .users?.get(item.id)?.steamId64.includes(search)
    );
    items.sort(userComparator(query.sort));
    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return { items: items.slice(start, start + query.pageSize), total };
  }
  async get(id: string) {
    const user = await this.authorization.findUserById(id);
    if (!user) return undefined;
    const summary = await this.toSummary(user);
    const roles = await this.authorization.getUserRoles(id);
    const candidates = await this.assignments.listPublicBadges(id, new Date().toISOString());
    return {
      ...summary,
      steamId64: user.steamId64,
      roles: roles.map(({ slug, displayName }) => ({ slug, displayName })),
      badges: candidates.map(({ badge }) => badge)
    };
  }
  async count() {
    return (this.authorization as { users?: Map<string, unknown> }).users?.size ?? 0;
  }
  private async toSummary(user: { id: string }): Promise<UserSummary> {
    const assignments = await this.assignments.list({
      page: 1, pageSize: 100, status: "active", userId: user.id,
      sort: "assigned_desc"
    });
    const roles = await this.authorization.getUserRoles(user.id);
    return {
      id: user.id,
      displayName: `User ${user.id.slice(0, 8)}`,
      createdAt: new Date(0).toISOString(),
      lastLoginAt: new Date(0).toISOString(),
      status: "active" as const,
      badgeCount: assignments.total,
      roleCount: roles.length
    };
  }
}

function userComparator(sort: UserQuery["sort"]) {
  return (left: UserSummary, right: UserSummary) => {
    if (sort === "name_asc") {
      return (left.displayName ?? "").localeCompare(right.displayName ?? "");
    }
    if (sort === "badges_desc") return right.badgeCount - left.badgeCount;
    const field = sort === "last_login_desc" ? "lastLoginAt" : "createdAt";
    const delta = Date.parse(left[field]) - Date.parse(right[field]);
    return sort === "created_asc" ? delta : -delta;
  };
}
