import { TOOL_BADGE_COLORS, TOOL_BADGE_ICONS, ToolError, type ToolBadgeMutation, type ToolCategoryMutation, type ToolListQuery, type ToolMutation, type ToolTrustKind } from "./contracts.ts";
import type { ToolRepository } from "./toolRepository.ts";
import type { ToolBadgeRepository } from "./toolBadgeRepository.ts";
import type { ToolCategoryRepository } from "./toolCategoryRepository.ts";
import { normalizeSafeExternalUrl } from "./safeExternalUrl.ts";
import type { BadgeAssetStorage } from "../badges/badgeAssetStorage.ts";
import type { BadgeRepository } from "../badges/badgeRepository.ts";
import { removeUnusedBadgeAsset } from "../badges/badgeAssetLifecycle.ts";
import type { ToolAnalyticsService } from "./toolAnalyticsService.ts";

const ANALYTICS_SORTS = new Set(["popular", "trending", "most_downloaded", "recommended"]);

export class ToolService {
  readonly repository: ToolRepository;
  readonly badges: ToolBadgeRepository;
  readonly categories: ToolCategoryRepository;
  private readonly assets?: BadgeRepository;
  private readonly assetStorage?: BadgeAssetStorage;
  private readonly analytics?: ToolAnalyticsService;
  constructor(repository: ToolRepository, badges: ToolBadgeRepository, categories: ToolCategoryRepository, assets?: BadgeRepository, assetStorage?: BadgeAssetStorage, analytics?: ToolAnalyticsService) {
    this.repository = repository; this.badges = badges; this.categories = categories;
    this.assets = assets; this.assetStorage = assetStorage;
    this.analytics = analytics;
  }
  async list(query: ToolListQuery) {
    if (!this.analytics || !ANALYTICS_SORTS.has(query.sort)) return this.repository.list(query);
    const all = await this.repository.list({ ...query, sort: "newest", page: 1, pageSize: 10_000 });
    const ranked = await this.analytics.rank(all.items.map((item) => item.id), query.sort as "popular" | "trending" | "most_downloaded" | "recommended");
    const rankedIds = ranked.map((entry) => entry.id);
    const byId = new Map(all.items.map((item) => [item.id, item] as const));
    const pageIdStart = (query.page - 1) * query.pageSize;
    const pageIds = rankedIds.slice(pageIdStart, pageIdStart + query.pageSize);
    return {
      total: rankedIds.length,
      items: pageIds.map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item)),
      page: query.page,
      pageSize: query.pageSize
    };
  }
  getBySlug(slug: string, publicOnly = true) { return this.repository.getBySlug(slug, publicOnly); }
  async create(value: unknown, actor: string) { return this.repository.create(await this.parseTool(value), actor); }
  async update(id: string, value: unknown, actor: string) {
    const current = await this.repository.get(id); if (!current) throw new ToolError("TOOL_NOT_FOUND");
    if (current.archivedAt) throw new ToolError("TOOL_ARCHIVED");
    const updated = await this.repository.update(id, await this.parseTool(value), actor);
    if (this.assets && this.assetStorage) {
      for (const oldId of [current.iconAssetId, current.coverAssetId]) {
        if (oldId && oldId !== updated.iconAssetId && oldId !== updated.coverAssetId) {
          await removeUnusedBadgeAsset(this.assets, this.assetStorage, oldId, actor, "icon_replaced");
        }
      }
    }
    return updated;
  }
  archive(id: string, actor: string) { return this.repository.setArchived(id, true, actor); }
  reactivate(id: string, actor: string) { return this.repository.setArchived(id, false, actor); }
  private async parseTool(value: unknown): Promise<ToolMutation> {
    if (!record(value)) throw new ToolError("INVALID_TOOL");
    const slug = text(value.slug, 64); if (!slugPattern.test(slug)) throw new ToolError("INVALID_TOOL");
    const download = normalizeSafeExternalUrl(text(value.externalDownloadUrl, 2048));
    const website = optionalText(value.officialWebsiteUrl, 2048);
    const normalizedWebsite = website ? normalizeSafeExternalUrl(website).url : undefined;
    const iconAssetId = optionalUuid(value.iconAssetId); const coverAssetId = optionalUuid(value.coverAssetId);
    if (this.assets) for (const assetId of [iconAssetId, coverAssetId]) { const asset = assetId ? await this.assets.getAsset(assetId) : undefined; if (assetId && (!asset || asset.deletedAt)) throw new ToolError("TOOL_ASSET_NOT_FOUND"); }
    const categoryId = optionalUuid(value.categoryId); const badgeIds = uuidArray(value.badgeIds, 16);
    if (categoryId) { const category = await this.categories.get(categoryId); if (!category || category.archivedAt || !category.isActive) throw new ToolError("TOOL_REFERENCE_ARCHIVED"); }
    for (const badgeId of badgeIds) { const badge = await this.badges.get(badgeId); if (!badge || badge.archivedAt || !badge.isActive) throw new ToolError("TOOL_REFERENCE_ARCHIVED"); }
    return { name:text(value.name,100), slug, shortDescription:text(value.shortDescription,220), fullDescription:text(value.fullDescription,5000), version:text(value.version,40), developerName:text(value.developerName,100), externalDownloadUrl:download.url, downloadTrust:enumValue(value.downloadTrust,["official","external","community"] as const), ...(normalizedWebsite?{officialWebsiteUrl:normalizedWebsite}:{}), ...(iconAssetId?{iconAssetId}:{}), ...(coverAssetId?{coverAssetId}:{}), ...(categoryId?{categoryId}:{}), badgeIds, isFeatured:boolean(value.isFeatured), isActive:boolean(value.isActive), ...(date(value.publishedAt)?{publishedAt:date(value.publishedAt)}:{}) };
  }
}

export function parseToolQuery(params: URLSearchParams, admin = false): ToolListQuery {
  const page=integer(params.get("page"),1,100000), pageSize=integer(params.get("pageSize"),20,50);
  const search=params.get("search")?.trim(); if (search && search.length>100) throw new ToolError("INVALID_TOOL_QUERY");
  const sort=enumValue(params.get("sort")??"newest",["newest","updated","name","popular","trending","most_downloaded","recommended"] as const);
  const featured=params.get("featured")==null?undefined:params.get("featured")==="true";
  return {page,pageSize,sort,activeOnly:!admin,includeArchived:admin&&params.get("archived")==="true",...(search?{search}:{}),...(params.get("category")?{category:params.get("category")!}:{}),...(params.get("badge")?{badge:params.get("badge")!}:{}),...(featured===undefined?{}:{featured})};
}
export function parseToolBadge(value:unknown):ToolBadgeMutation { if(!record(value))throw new ToolError("INVALID_TOOL"); return {name:text(value.name,60),slug:slug(value.slug),color:enumValue(value.color,TOOL_BADGE_COLORS),iconKey:enumValue(value.iconKey,TOOL_BADGE_ICONS),displayOrder:integerValue(value.displayOrder,0,10000),isActive:boolean(value.isActive)}; }
export function parseToolCategory(value:unknown):ToolCategoryMutation { if(!record(value))throw new ToolError("INVALID_TOOL"); return {name:text(value.name,80),slug:slug(value.slug),...(optionalText(value.description,300)?{description:optionalText(value.description,300)}:{}),displayOrder:integerValue(value.displayOrder,0,10000),isActive:boolean(value.isActive)}; }
const slugPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function slug(v:unknown){const x=text(v,64);if(!slugPattern.test(x))throw new ToolError("INVALID_TOOL");return x;}
function record(v:unknown):v is Record<string,unknown>{return typeof v==="object"&&v!==null&&!Array.isArray(v);}
function text(v:unknown,max:number){if(typeof v!=="string"||!v.trim()||v.trim().length>max)throw new ToolError("INVALID_TOOL");return v.trim();}
function optionalText(v:unknown,max:number){if(v==null||v==="")return undefined;if(typeof v!=="string"||v.trim().length>max)throw new ToolError("INVALID_TOOL");return v.trim();}
function boolean(v:unknown){if(typeof v!=="boolean")throw new ToolError("INVALID_TOOL");return v;}
function enumValue<T extends string>(v:unknown,all:readonly T[]){if(typeof v!=="string"||!all.includes(v as T))throw new ToolError("INVALID_TOOL");return v as T;}
function integer(v:string|null,f:number,m:number){if(v==null)return f;return integerValue(Number(v),1,m);}
function integerValue(v:unknown,min:number,max:number){if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)throw new ToolError("INVALID_TOOL_QUERY");return Number(v);}
function optionalUuid(v:unknown){if(v==null||v==="")return undefined;if(typeof v!=="string"||!uuid.test(v))throw new ToolError("INVALID_TOOL");return v;}
function uuidArray(v:unknown,max:number){if(!Array.isArray(v)||v.length>max||v.some(x=>typeof x!=="string"||!uuid.test(x)))throw new ToolError("INVALID_TOOL");return [...new Set(v as string[])];}
function date(v:unknown){if(v==null||v==="")return undefined;if(typeof v!=="string"||!Number.isFinite(Date.parse(v)))throw new ToolError("INVALID_TOOL");return new Date(v).toISOString();}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
