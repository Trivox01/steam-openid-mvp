import {
  BadgeError,
  badgeCategories,
  badgeGrantModes,
  badgeRarities,
  type BadgeListQuery,
  type BadgeMutation
} from "./contracts.ts";
import type { BadgeRepository } from "./badgeRepository.ts";

export class BadgeService {
  readonly repository: BadgeRepository;

  constructor(repository: BadgeRepository) {
    this.repository = repository;
  }

  list(query: BadgeListQuery) { return this.repository.list(query); }
  get(id: string) { return this.repository.get(id); }

  create(value: unknown, actorUserId: string) {
    return this.repository.create(parseBadgeMutation(value), actorUserId);
  }

  async update(id: string, value: unknown, actorUserId: string) {
    const current = await this.repository.get(id);
    if (!current) throw new BadgeError("BADGE_NOT_FOUND");
    if (current.archivedAt) throw new BadgeError("BADGE_ARCHIVED");
    const input = parseBadgeMutation(value);
    const changedFields = Object.keys(input).filter((key) =>
      current[key as keyof typeof current] !== input[key as keyof BadgeMutation]
    );
    const updated = await this.repository.update(id, input, actorUserId, changedFields);
    if (!updated) throw new BadgeError("BADGE_NOT_FOUND");
    return updated;
  }

  async archive(id: string, actorUserId: string) {
    const archived = await this.repository.archive(id, actorUserId);
    if (!archived) throw new BadgeError("BADGE_NOT_FOUND");
    return archived;
  }
}

export function parseBadgeListQuery(searchParams: URLSearchParams): BadgeListQuery {
  const page = positiveInteger(searchParams.get("page"), 1, 100000);
  const pageSize = positiveInteger(searchParams.get("pageSize"), 20, 100);
  const category = optionalEnum(searchParams.get("category"), badgeCategories);
  const rarity = optionalEnum(searchParams.get("rarity"), badgeRarities);
  const status = optionalEnum(searchParams.get("status"), ["active", "inactive", "archived"] as const);
  const sort = optionalEnum(searchParams.get("sort"), ["updated_desc", "updated_asc", "priority_desc", "name_asc"] as const) ?? "updated_desc";
  const search = searchParams.get("search")?.trim();
  if (search && search.length > 80) throw new BadgeError("INVALID_BADGE_QUERY");
  return { page, pageSize, sort, ...(search ? { search } : {}), ...(category ? { category } : {}), ...(rarity ? { rarity } : {}), ...(status ? { status } : {}) };
}

export function parseBadgeMutation(value: unknown): BadgeMutation {
  if (!isRecord(value)) throw new BadgeError("INVALID_BADGE");
  const slug = requiredString(value.slug, 64);
  const displayName = requiredString(value.displayName, 80);
  const description = optionalString(value.description, 500) ?? "";
  const category = requiredEnum(value.category, badgeCategories);
  const rarity = requiredEnum(value.rarity, badgeRarities);
  const grantMode = requiredEnum(value.grantMode, badgeGrantModes);
  const iconAssetId = optionalUuid(value.iconAssetId);
  const priority = requiredInteger(value.priority, 0, 10000);
  const isActive = requiredBoolean(value.isActive);
  const isVisible = requiredBoolean(value.isVisible);
  const startsAt = optionalDate(value.startsAt);
  const endsAt = optionalDate(value.endsAt);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new BadgeError("INVALID_BADGE_SLUG");
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw new BadgeError("INVALID_BADGE_DATES");
  return { slug, displayName, description, category, rarity, grantMode, priority, isActive, isVisible, ...(iconAssetId ? { iconAssetId } : {}), ...(startsAt ? { startsAt } : {}), ...(endsAt ? { endsAt } : {}) };
}

function positiveInteger(value: string | null, fallback: number, max: number) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new BadgeError("INVALID_BADGE_QUERY");
  return parsed;
}
function requiredString(value: unknown, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new BadgeError("INVALID_BADGE");
  return value.trim();
}
function optionalString(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length > max) throw new BadgeError("INVALID_BADGE");
  return value.trim();
}
function requiredInteger(value: unknown, min: number, max: number) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new BadgeError("INVALID_BADGE");
  return Number(value);
}
function requiredBoolean(value: unknown) {
  if (typeof value !== "boolean") throw new BadgeError("INVALID_BADGE");
  return value;
}
function requiredEnum<T extends string>(value: unknown, values: readonly T[]) {
  if (typeof value !== "string" || !values.includes(value as T)) throw new BadgeError("INVALID_BADGE");
  return value as T;
}
function optionalEnum<T extends string>(value: string | null, values: readonly T[]) {
  return value === null || value === "" ? undefined : requiredEnum(value, values);
}
function optionalDate(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new BadgeError("INVALID_BADGE_DATES");
  return new Date(value).toISOString();
}
function optionalUuid(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadgeError("INVALID_BADGE");
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
