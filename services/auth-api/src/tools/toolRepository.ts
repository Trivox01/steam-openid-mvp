import { randomUUID } from "node:crypto";
import { ToolError, type ToolDefinition, type ToolListQuery, type ToolMutation } from "./contracts.ts";
import { InMemoryToolBadgeRepository, type ToolBadgeRepository } from "./toolBadgeRepository.ts";
import { InMemoryToolCategoryRepository, type ToolCategoryRepository } from "./toolCategoryRepository.ts";

export interface ToolRepository {
  validateSchema(): Promise<void>;
  list(query: ToolListQuery): Promise<{items:ToolDefinition[];total:number}>;
  get(id:string):Promise<ToolDefinition|undefined>;
  getBySlug(slug:string,publicOnly:boolean):Promise<ToolDefinition|undefined>;
  create(input:ToolMutation,actor:string):Promise<ToolDefinition>;
  update(id:string,input:ToolMutation,actor:string):Promise<ToolDefinition>;
  setArchived(id:string,archived:boolean,actor:string):Promise<ToolDefinition>;
}

export class InMemoryToolRepository implements ToolRepository {
  readonly tools=new Map<string,ToolDefinition>();
  readonly auditEvents:Array<{action:string;targetId:string;metadata:Record<string,unknown>}>=[];
  private readonly badges:ToolBadgeRepository; private readonly categories:ToolCategoryRepository;
  constructor(badges:ToolBadgeRepository,categories:ToolCategoryRepository){this.badges=badges;this.categories=categories;if(badges instanceof InMemoryToolBadgeRepository)badges.setUsageProbe(id=>[...this.tools.values()].some(tool=>!tool.archivedAt&&tool.badges.some(badge=>badge.id===id)));if(categories instanceof InMemoryToolCategoryRepository)categories.setUsageProbe(id=>[...this.tools.values()].some(tool=>!tool.archivedAt&&tool.category?.id===id));}
  async validateSchema(){}
  async list(query:ToolListQuery){let items=[...this.tools.values()].filter(x=>{
    if(query.activeOnly&&(!x.isActive||x.archivedAt||!x.publishedAt))return false;
    if(!query.includeArchived&&x.archivedAt)return false;
    if(query.search&&!`${x.name} ${x.shortDescription} ${x.developerName}`.toLowerCase().includes(query.search.toLowerCase()))return false;
    if(query.category&&x.category?.slug!==query.category)return false;
    if(query.badge&&!x.badges.some(b=>b.slug===query.badge))return false;
    if(query.featured!==undefined&&x.isFeatured!==query.featured)return false;return true;});
    items.sort((a,b)=>query.sort==="name"?a.name.localeCompare(b.name):Date.parse(query.sort==="updated"?b.updatedAt:b.publishedAt??b.createdAt)-Date.parse(query.sort==="updated"?a.updatedAt:a.publishedAt??a.createdAt));
    return {total:items.length,items:items.slice((query.page-1)*query.pageSize,query.page*query.pageSize)};
  }
  async get(id:string){return this.tools.get(id);}
  async getBySlug(slug:string,publicOnly:boolean){return [...this.tools.values()].find(x=>x.slug===slug&&(!publicOnly||(x.isActive&&!x.archivedAt&&Boolean(x.publishedAt))));}
  async create(input:ToolMutation,actor:string){if([...this.tools.values()].some(x=>x.slug===input.slug))throw new ToolError("TOOL_SLUG_CONFLICT");const now=new Date().toISOString();const tool=await this.materialize({id:randomUUID(),...input,createdAt:now,updatedAt:now});this.tools.set(tool.id,tool);this.audit("tool.created",tool.id,actor);return tool;}
  async update(id:string,input:ToolMutation,actor:string){const current=this.tools.get(id);if(!current)throw new ToolError("TOOL_NOT_FOUND");if([...this.tools.values()].some(x=>x.id!==id&&x.slug===input.slug))throw new ToolError("TOOL_SLUG_CONFLICT");const next=await this.materialize({...current,...input,updatedAt:new Date().toISOString()});this.tools.set(id,next);this.audit("tool.updated",id,actor);return next;}
  async setArchived(id:string,archived:boolean,actor:string){const current=this.tools.get(id);if(!current)throw new ToolError("TOOL_NOT_FOUND");const now=new Date().toISOString();const next={...current,isActive:!archived,archivedAt:archived?now:undefined,updatedAt:now};this.tools.set(id,next);this.audit(archived?"tool.archived":"tool.reactivated",id,actor);return next;}
  private async materialize(input:ToolMutation&{id:string;createdAt:string;updatedAt:string}){const category=input.categoryId?await this.categories.get(input.categoryId):undefined;const badges=(await Promise.all(input.badgeIds.map(id=>this.badges.get(id)))).filter(x=>x!==undefined);return {id:input.id,name:input.name,slug:input.slug,shortDescription:input.shortDescription,fullDescription:input.fullDescription,version:input.version,developerName:input.developerName,externalDownloadUrl:input.externalDownloadUrl,downloadDomain:new URL(input.externalDownloadUrl).hostname,downloadTrust:input.downloadTrust,...(input.officialWebsiteUrl?{officialWebsiteUrl:input.officialWebsiteUrl}:{}),...(input.iconUrl?{iconUrl:input.iconUrl}:{}),...(input.coverUrl?{coverUrl:input.coverUrl}:{}),...(category?{category}:{}),badges,isFeatured:input.isFeatured,isActive:input.isActive,...(input.publishedAt?{publishedAt:input.publishedAt}:{}),createdAt:input.createdAt,updatedAt:input.updatedAt};}
  private audit(action:string,targetId:string,actor:string){this.auditEvents.push({action,targetId,metadata:{actorUserId:actor}});}
}
