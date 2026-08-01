export type ToolTrustKind = "official" | "external" | "community";
export type ToolSort = "newest" | "updated" | "name";

export interface ToolBadge {
  id: string; name: string; slug: string; color: ToolBadgeColor; iconKey: ToolBadgeIcon;
  displayOrder: number; isActive: boolean; archivedAt?: string; createdAt: string; updatedAt: string;
}
export interface ToolCategory {
  id: string; name: string; slug: string; description?: string; displayOrder: number;
  isActive: boolean; archivedAt?: string; createdAt: string; updatedAt: string;
}
export interface ToolDefinition {
  id: string; name: string; slug: string; shortDescription: string; fullDescription: string;
  version: string; developerName: string; externalDownloadUrl: string; downloadDomain: string;
  downloadTrust: ToolTrustKind; officialWebsiteUrl?: string; iconUrl?: string; coverUrl?: string;
  iconAssetId?: string; coverAssetId?: string;
  category?: ToolCategory; badges: ToolBadge[]; isFeatured: boolean; isActive: boolean;
  archivedAt?: string; publishedAt?: string; createdAt: string; updatedAt: string;
}
export interface ToolMutation {
  name: string; slug: string; shortDescription: string; fullDescription: string; version: string;
  developerName: string; externalDownloadUrl: string; downloadTrust: ToolTrustKind;
  officialWebsiteUrl?: string; iconAssetId?: string; coverAssetId?: string; categoryId?: string;
  badgeIds: string[]; isFeatured: boolean; isActive: boolean; publishedAt?: string;
}
export interface ToolListQuery {
  page: number; pageSize: number; search?: string; category?: string; badge?: string;
  featured?: boolean; activeOnly: boolean; includeArchived: boolean; sort: ToolSort;
}
export const TOOL_BADGE_COLORS = ["purple", "blue", "green", "amber", "neutral"] as const;
export const TOOL_BADGE_ICONS = ["badge-check", "shield-check", "sparkles", "code-2", "gift", "zap", "refresh-cw"] as const;
export type ToolBadgeColor = typeof TOOL_BADGE_COLORS[number];
export type ToolBadgeIcon = typeof TOOL_BADGE_ICONS[number];
export type ToolBadgeMutation = Omit<ToolBadge, "id" | "archivedAt" | "createdAt" | "updatedAt">;
export type ToolCategoryMutation = Omit<ToolCategory, "id" | "archivedAt" | "createdAt" | "updatedAt">;

export type ToolErrorCode = "INVALID_TOOL" | "INVALID_TOOL_QUERY" | "INVALID_TOOL_URL" |
  "TOOL_NOT_FOUND" | "TOOL_ARCHIVED" | "TOOL_SLUG_CONFLICT" | "TOOL_BADGE_NOT_FOUND" |
  "TOOL_CATEGORY_NOT_FOUND" | "TOOL_REFERENCE_ARCHIVED" | "TOOL_METADATA_IN_USE" | "TOOL_ASSET_NOT_FOUND" | "INVALID_JSON";
export class ToolError extends Error {
  readonly code: ToolErrorCode;
  constructor(code: ToolErrorCode) { super(code); this.code = code; this.name = "ToolError"; }
}
