import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { ToolRepository } from "../../tools/toolRepository.ts";
import type { ToolBadgeRepository } from "../../tools/toolBadgeRepository.ts";
import type { ToolCategoryRepository } from "../../tools/toolCategoryRepository.ts";
import { ToolError, type ToolBadgeMutation, type ToolCategoryMutation, type ToolListQuery, type ToolMutation } from "../../tools/contracts.ts";

export class PostgresToolRepositories implements ToolRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  async validateSchema() {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('tool_definitions','tool_badges','tool_categories','tool_badge_assignments')"
    );
    if (Number(result.rows[0]?.count) !== 4) throw new Error("tool_schema_invalid");
  }
  async list(query: ToolListQuery) {
    const values: unknown[] = [], clauses: string[] = [];
    const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (query.activeOnly) clauses.push("t.is_active=true AND t.archived_at IS NULL AND t.published_at IS NOT NULL");
    else if (!query.includeArchived) clauses.push("t.archived_at IS NULL");
    if (query.search) clauses.push(`(t.name ILIKE ${add(`%${query.search}%`)} OR t.short_description ILIKE $${values.length} OR t.developer_name ILIKE $${values.length})`);
    if (query.category) clauses.push(`cat.slug=${add(query.category)}`);
    if (query.badge) clauses.push(`EXISTS(SELECT 1 FROM tool_badge_assignments ax JOIN tool_badges bx ON bx.id=ax.badge_id WHERE ax.tool_id=t.id AND bx.slug=${add(query.badge)})`);
    if (query.featured !== undefined) clauses.push(`t.is_featured=${add(query.featured)}`);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const count = await this.pool.query<{ count: string }>(`SELECT count(DISTINCT t.id) FROM tool_definitions t LEFT JOIN tool_categories cat ON cat.id=t.category_id ${where}`, values);
    const order = query.sort === "name" ? "t.name ASC" : query.sort === "updated" ? "t.updated_at DESC" : "COALESCE(t.published_at,t.created_at) DESC";
    const limit = add(query.pageSize), offset = add((query.page - 1) * query.pageSize);
    const rows = await this.pool.query(`SELECT ${TOOL_COLUMNS} FROM tool_definitions t LEFT JOIN tool_categories cat ON cat.id=t.category_id ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, values);
    return { total: Number(count.rows[0]?.count ?? 0), items: await Promise.all(rows.rows.map((row) => this.mapTool(row))) };
  }
  async get(id: string) {
    const result = await this.pool.query(`SELECT ${TOOL_COLUMNS} FROM tool_definitions t LEFT JOIN tool_categories cat ON cat.id=t.category_id WHERE t.id=$1`, [id]);
    return result.rows[0] ? this.mapTool(result.rows[0]) : undefined;
  }
  async getBySlug(slug: string, publicOnly: boolean) {
    const result = await this.pool.query(`SELECT ${TOOL_COLUMNS} FROM tool_definitions t LEFT JOIN tool_categories cat ON cat.id=t.category_id WHERE t.slug=$1 ${publicOnly ? "AND t.is_active=true AND t.archived_at IS NULL AND t.published_at IS NOT NULL" : ""}`, [slug]);
    return result.rows[0] ? this.mapTool(result.rows[0]) : undefined;
  }
  create(input: ToolMutation, actor: string) { return this.saveTool(undefined, input, actor, "tool.created"); }
  update(id: string, input: ToolMutation, actor: string) { return this.saveTool(id, input, actor, "tool.updated"); }
  setArchived(id: string, archived: boolean, actor: string) {
    return this.transaction(async (client) => {
      const result = await client.query(`UPDATE tool_definitions SET archived_at=${archived ? "now()" : "NULL"},is_active=${archived ? "false" : "true"},updated_at=now(),updated_by_user_id=$2 WHERE id=$1 RETURNING id`, [id, actor]);
      if (!result.rowCount) throw new ToolError("TOOL_NOT_FOUND");
      await audit(client, actor, `tool.${archived ? "archived" : "reactivated"}`, "tool", id);
      return this.get(id).then((value) => value!);
    });
  }
  async listBadges(includeArchived: boolean) {
    const result = await this.pool.query(`SELECT ${BADGE_COLUMNS} FROM tool_badges b ${includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY display_order,name`);
    return result.rows.map(mapBadge);
  }
  async getBadge(id: string) { const result = await this.pool.query(`SELECT ${BADGE_COLUMNS} FROM tool_badges b WHERE id=$1`, [id]); return result.rows[0] ? mapBadge(result.rows[0]) : undefined; }
  saveBadge(id: string | undefined, input: ToolBadgeMutation, actor: string) {
    const key = id ?? randomUUID(), action = id ? "tool_badge.updated" : "tool_badge.created";
    return this.transaction(async (client) => {
      await client.query(`INSERT INTO tool_badges(id,name,slug,color,icon_key,display_order,is_active) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=$2,slug=$3,color=$4,icon_key=$5,display_order=$6,is_active=$7,updated_at=now()`, [key, input.name, input.slug, input.color, input.iconKey, input.displayOrder, input.isActive]);
      await audit(client, actor, action, "tool_badge", key); return this.getBadge(key).then((value) => value!);
    });
  }
  archiveBadge(id: string, archived: boolean, actor: string) { return this.archiveMetadata("tool_badges", "badge_id", "tool_badge", id, archived, actor).then(() => this.getBadge(id).then((value) => value!)); }
  async listCategories(includeArchived: boolean) { const result = await this.pool.query(`SELECT ${CATEGORY_COLUMNS} FROM tool_categories ${includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY display_order,name`); return result.rows.map(mapCategory); }
  async getCategory(id: string) { const result = await this.pool.query(`SELECT ${CATEGORY_COLUMNS} FROM tool_categories WHERE id=$1`, [id]); return result.rows[0] ? mapCategory(result.rows[0]) : undefined; }
  saveCategory(id: string | undefined, input: ToolCategoryMutation, actor: string) {
    const key=id??randomUUID(), action=id?"tool_category.updated":"tool_category.created";
    return this.transaction(async(client)=>{await client.query(`INSERT INTO tool_categories(id,name,slug,description,display_order,is_active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=$2,slug=$3,description=$4,display_order=$5,is_active=$6,updated_at=now()`,[key,input.name,input.slug,input.description??null,input.displayOrder,input.isActive]);await audit(client,actor,action,"tool_category",key);return this.getCategory(key).then(value=>value!);});
  }
  archiveCategory(id:string,archived:boolean,actor:string){return this.archiveMetadata("tool_categories","category_id","tool_category",id,archived,actor).then(()=>this.getCategory(id).then(value=>value!));}
  private async archiveMetadata(table:"tool_badges"|"tool_categories",reference:"badge_id"|"category_id",type:string,id:string,archived:boolean,actor:string){return this.transaction(async client=>{if(archived){const sql=reference==="badge_id"?"SELECT 1 FROM tool_badge_assignments WHERE badge_id=$1 LIMIT 1":"SELECT 1 FROM tool_definitions WHERE category_id=$1 AND archived_at IS NULL LIMIT 1";if((await client.query(sql,[id])).rowCount)throw new ToolError("TOOL_METADATA_IN_USE");}const result=await client.query(`UPDATE ${table} SET archived_at=${archived?"now()":"NULL"},is_active=${archived?"false":"true"},updated_at=now() WHERE id=$1`,[id]);if(!result.rowCount)throw new ToolError(reference==="badge_id"?"TOOL_BADGE_NOT_FOUND":"TOOL_CATEGORY_NOT_FOUND");await audit(client,actor,`${type}.${archived?"archived":"reactivated"}`,type,id);});}
  private saveTool(id:string|undefined,input:ToolMutation,actor:string,action:string){return this.transaction(async client=>{const key=id??randomUUID();await client.query(`INSERT INTO tool_definitions(id,name,slug,short_description,full_description,version,developer_name,external_download_url,download_trust,official_website_url,icon_url,cover_url,category_id,is_featured,is_active,published_at,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) ON CONFLICT(id) DO UPDATE SET name=$2,slug=$3,short_description=$4,full_description=$5,version=$6,developer_name=$7,external_download_url=$8,download_trust=$9,official_website_url=$10,icon_url=$11,cover_url=$12,category_id=$13,is_featured=$14,is_active=$15,published_at=$16,updated_by_user_id=$17,updated_at=now()`,[key,input.name,input.slug,input.shortDescription,input.fullDescription,input.version,input.developerName,input.externalDownloadUrl,input.downloadTrust,input.officialWebsiteUrl??null,input.iconUrl??null,input.coverUrl??null,input.categoryId??null,input.isFeatured,input.isActive,input.publishedAt??null,actor]);await client.query("DELETE FROM tool_badge_assignments WHERE tool_id=$1",[key]);for(const [order,badge]of input.badgeIds.entries())await client.query("INSERT INTO tool_badge_assignments(tool_id,badge_id,display_order) VALUES($1,$2,$3)",[key,badge,order]);await audit(client,actor,action,"tool",key);return this.get(key).then(value=>value!);});}
  private async mapTool(row:QueryResultRow){const badgeResult=await this.pool.query(`SELECT ${BADGE_COLUMNS} FROM tool_badges b JOIN tool_badge_assignments a ON a.badge_id=b.id WHERE a.tool_id=$1 ORDER BY a.display_order,b.display_order`,[row.id]);return{id:String(row.id),name:String(row.name),slug:String(row.slug),shortDescription:String(row.short_description),fullDescription:String(row.full_description),version:String(row.version),developerName:String(row.developer_name),externalDownloadUrl:String(row.external_download_url),downloadDomain:new URL(String(row.external_download_url)).hostname,downloadTrust:row.download_trust,...(row.official_website_url?{officialWebsiteUrl:String(row.official_website_url)}:{}),...(row.icon_url?{iconUrl:String(row.icon_url)}:{}),...(row.cover_url?{coverUrl:String(row.cover_url)}:{}),...(row.category_id?{category:mapJoinedCategory(row)}:{}),badges:badgeResult.rows.map(mapBadge),isFeatured:Boolean(row.is_featured),isActive:Boolean(row.is_active),...(row.archived_at?{archivedAt:iso(row.archived_at)}:{}),...(row.published_at?{publishedAt:iso(row.published_at)}:{}),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};}
  private async transaction<T>(operation:(client:PoolClient)=>Promise<T>){const client=await this.pool.connect();try{await client.query("BEGIN");const value=await operation(client);await client.query("COMMIT");return value;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
}
export class PostgresToolBadgeRepository implements ToolBadgeRepository { private readonly root:PostgresToolRepositories;constructor(root:PostgresToolRepositories){this.root=root;}list(all:boolean){return this.root.listBadges(all);}get(id:string){return this.root.getBadge(id);}create(value:ToolBadgeMutation,actor:string){return this.root.saveBadge(undefined,value,actor);}update(id:string,value:ToolBadgeMutation,actor:string){return this.root.saveBadge(id,value,actor);}setArchived(id:string,value:boolean,actor:string){return this.root.archiveBadge(id,value,actor);} }
export class PostgresToolCategoryRepository implements ToolCategoryRepository { private readonly root:PostgresToolRepositories;constructor(root:PostgresToolRepositories){this.root=root;}list(all:boolean){return this.root.listCategories(all);}get(id:string){return this.root.getCategory(id);}create(value:ToolCategoryMutation,actor:string){return this.root.saveCategory(undefined,value,actor);}update(id:string,value:ToolCategoryMutation,actor:string){return this.root.saveCategory(id,value,actor);}setArchived(id:string,value:boolean,actor:string){return this.root.archiveCategory(id,value,actor);} }
const TOOL_COLUMNS="t.id,t.name,t.slug,t.short_description,t.full_description,t.version,t.developer_name,t.external_download_url,t.download_trust,t.official_website_url,t.icon_url,t.cover_url,t.category_id,t.is_featured,t.is_active,t.published_at,t.archived_at,t.created_at,t.updated_at,cat.name category_name,cat.slug category_slug,cat.description category_description,cat.display_order category_display_order,cat.is_active category_is_active,cat.archived_at category_archived_at,cat.created_at category_created_at,cat.updated_at category_updated_at";
const BADGE_COLUMNS="b.id,b.name,b.slug,b.color,b.icon_key,b.display_order,b.is_active,b.archived_at,b.created_at,b.updated_at",CATEGORY_COLUMNS="id,name,slug,description,display_order,is_active,archived_at,created_at,updated_at";
function mapBadge(row:QueryResultRow){return{id:String(row.id),name:String(row.name),slug:String(row.slug),color:row.color,iconKey:row.icon_key,displayOrder:Number(row.display_order),isActive:Boolean(row.is_active),...(row.archived_at?{archivedAt:iso(row.archived_at)}:{}),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};}
function mapCategory(row:QueryResultRow){return{id:String(row.id),name:String(row.name),slug:String(row.slug),...(row.description?{description:String(row.description)}:{}),displayOrder:Number(row.display_order),isActive:Boolean(row.is_active),...(row.archived_at?{archivedAt:iso(row.archived_at)}:{}),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};}
function mapJoinedCategory(row:QueryResultRow){return{id:String(row.category_id),name:String(row.category_name),slug:String(row.category_slug),...(row.category_description?{description:String(row.category_description)}:{}),displayOrder:Number(row.category_display_order),isActive:Boolean(row.category_is_active),...(row.category_archived_at?{archivedAt:iso(row.category_archived_at)}:{}),createdAt:iso(row.category_created_at),updatedAt:iso(row.category_updated_at)};}
function iso(value:unknown){return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
function audit(client:PoolClient,actor:string,action:string,type:string,id:string){return client.query("INSERT INTO audit_events(actor_user_id,action,target_type,target_id,metadata_json) VALUES($1,$2,$3,$4,'{}')",[actor,action,type,id]).then(()=>undefined);}
