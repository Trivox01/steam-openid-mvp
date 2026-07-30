import { randomUUID } from "node:crypto";
import type {
  BadgeAsset,
  BadgeDefinition,
  BadgeListQuery,
  BadgeMutation
} from "./contracts.ts";
import type { PublicBadgeAsset } from "../publicBadges/contracts.ts";

export interface BadgeRepository {
  validateSchema(): Promise<void>;
  list(query: BadgeListQuery): Promise<{ items: BadgeDefinition[]; total: number }>;
  get(id: string): Promise<BadgeDefinition | undefined>;
  create(input: BadgeMutation, actorUserId: string): Promise<BadgeDefinition>;
  update(id: string, input: BadgeMutation, actorUserId: string, changedFields: string[]): Promise<BadgeDefinition | undefined>;
  archive(id: string, actorUserId: string): Promise<BadgeDefinition | undefined>;
  saveAsset(input: Omit<BadgeAsset, "id" | "createdAt"> & { storageKey: string }, actorUserId: string): Promise<BadgeAsset>;
  getAsset(id: string): Promise<(BadgeAsset & { storageKey: string; deletedAt?: string }) | undefined>;
  deleteUnusedAsset(id: string, actorUserId: string): Promise<string | undefined>;
  listAvailableAssets(limit: number): Promise<Array<BadgeAsset & { storageKey: string }>>;
  enqueueAssetCleanup(input: {
    storageKey: string;
    assetId?: string;
    reason: "metadata_rollback" | "icon_replaced" | "asset_deleted";
  }): Promise<void>;
  getPublicAssetByBadgeSlug(slug: string, now: string): Promise<PublicBadgeAsset | undefined>;
}

export class InMemoryBadgeRepository implements BadgeRepository {
  readonly badges = new Map<string, BadgeDefinition>();
  readonly assets = new Map<string, BadgeAsset & { storageKey: string; deletedAt?: string }>();
  readonly auditEvents: Array<{ action: string; targetId: string; metadata: Record<string, unknown> }> = [];
  readonly cleanupJobs: Array<{
    storageKey: string;
    assetId?: string;
    reason: "metadata_rollback" | "icon_replaced" | "asset_deleted";
  }> = [];

  async validateSchema() {}
  async list(query: BadgeListQuery) {
    let items = [...this.badges.values()].filter((badge) => {
      if (query.search && !`${badge.displayName} ${badge.slug}`.toLowerCase().includes(query.search.toLowerCase())) return false;
      if (query.category && badge.category !== query.category) return false;
      if (query.rarity && badge.rarity !== query.rarity) return false;
      if (query.status === "archived" && !badge.archivedAt) return false;
      if (query.status === "active" && (!badge.isActive || badge.archivedAt)) return false;
      if (query.status === "inactive" && (badge.isActive || badge.archivedAt)) return false;
      return true;
    });
    items = sortBadges(items, query.sort);
    return {
      total: items.length,
      items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
    };
  }
  async get(id: string) { return this.badges.get(id); }
  async create(input: BadgeMutation, actorUserId: string) {
    if ([...this.badges.values()].some((badge) => badge.slug === input.slug)) throw new Error("badge_slug_conflict");
    const now = new Date().toISOString();
    const badge = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    this.badges.set(badge.id, badge);
    this.auditEvents.push({ action: "badge.created", targetId: badge.id, metadata: { actorUserId, category: badge.category, rarity: badge.rarity } });
    return badge;
  }
  async update(id: string, input: BadgeMutation, actorUserId: string, changedFields: string[]) {
    const current = this.badges.get(id);
    if (!current || current.archivedAt) return undefined;
    if ([...this.badges.values()].some((badge) => badge.id !== id && badge.slug === input.slug)) throw new Error("badge_slug_conflict");
    const next = { ...current, ...input, updatedAt: new Date().toISOString() };
    this.badges.set(id, next);
    this.auditEvents.push({ action: current.isActive || !next.isActive ? "badge.updated" : "badge.reactivated", targetId: id, metadata: { actorUserId, changedFields: changedFields.join(",") } });
    if (changedFields.includes("iconAssetId")) {
      this.auditEvents.push({ action: "badge.icon_replaced", targetId: id, metadata: { actorUserId } });
    }
    return next;
  }
  async archive(id: string, actorUserId: string) {
    const current = this.badges.get(id);
    if (!current || current.archivedAt) return undefined;
    const now = new Date().toISOString();
    const next = { ...current, isActive: false, archivedAt: now, updatedAt: now };
    this.badges.set(id, next);
    this.auditEvents.push({ action: "badge.archived", targetId: id, metadata: { actorUserId } });
    return next;
  }
  async saveAsset(input: Omit<BadgeAsset, "id" | "createdAt"> & { storageKey: string }, actorUserId: string) {
    const asset = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.assets.set(asset.id, asset);
    this.auditEvents.push({ action: "badge.icon_uploaded", targetId: asset.id, metadata: { actorUserId, contentType: asset.contentType, byteSize: asset.byteSize } });
    return asset;
  }
  async getAsset(id: string) { return this.assets.get(id); }
  async deleteUnusedAsset(id: string, actorUserId: string) {
    const asset = this.assets.get(id);
    if (!asset || asset.deletedAt) return undefined;
    if ([...this.badges.values()].some((badge) => badge.iconAssetId === id)) {
      throw new Error("badge_asset_in_use");
    }
    asset.deletedAt = new Date().toISOString();
    this.auditEvents.push({
      action: "badge.asset_deleted",
      targetId: id,
      metadata: { actorUserId }
    });
    return asset.storageKey;
  }
  async listAvailableAssets(limit: number) {
    return [...this.assets.values()].filter((asset) => !asset.deletedAt).slice(0, limit);
  }
  async enqueueAssetCleanup(input: {
    storageKey: string;
    assetId?: string;
    reason: "metadata_rollback" | "icon_replaced" | "asset_deleted";
  }) {
    if (this.cleanupJobs.some((job) => job.storageKey === input.storageKey)) return;
    this.cleanupJobs.push({ ...input });
    this.auditEvents.push({
      action: "badge.asset_cleanup_pending",
      targetId: input.assetId ?? "orphan",
      metadata: { reason: input.reason }
    });
  }
  async getPublicAssetByBadgeSlug(slug: string, now: string) {
    const badge = [...this.badges.values()].find((item) =>
      item.slug === slug && item.isActive && item.isVisible && !item.archivedAt &&
      (!item.startsAt || item.startsAt <= now) &&
      (!item.endsAt || item.endsAt > now)
    );
    if (!badge?.iconAssetId) return undefined;
    const asset = this.assets.get(badge.iconAssetId);
    if (!asset || asset.deletedAt) return undefined;
    return { storageKey: asset.storageKey, contentType: asset.contentType };
  }
}

function sortBadges(items: BadgeDefinition[], sort: BadgeListQuery["sort"]) {
  return [...items].sort((left, right) => {
    if (sort === "name_asc") return left.displayName.localeCompare(right.displayName);
    if (sort === "priority_desc") return right.priority - left.priority;
    const delta = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
    return sort === "updated_asc" ? delta : -delta;
  });
}
