import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthorizationError } from "../authorization/contracts.ts";
import type { AuthorizationService } from "../authorization/authorizationService.ts";
import type { SessionTokenService } from "../authorization/sessionTokenService.ts";
import { ToolError } from "../tools/contracts.ts";
import { parseToolBadge, parseToolCategory, parseToolQuery, type ToolService } from "../tools/toolService.ts";
import type { BadgeRepository } from "../badges/badgeRepository.ts";
import { BadgeAssetNotFoundError, validateBadgeAsset, type BadgeAssetStorage } from "../badges/badgeAssetStorage.ts";
import { persistBadgeAsset } from "../badges/badgeAssetLifecycle.ts";
import type { ToolRatingService } from "../tools/toolRatingService.ts";
import { parseReviewQuery, parseReportQuery, parseAdminReviewQuery } from "../tools/toolReviewService.ts";
import type { ToolReviewModerationService, ToolReviewService } from "../tools/toolReviewService.ts";
import { PollingRateLimitError, type PollingRateLimiter } from "../security/pollingRateLimiter.ts";

type Deps = { tools: ToolService; ratings:ToolRatingService; ratingRateLimiter:PollingRateLimiter; authorization: AuthorizationService; sessions: SessionTokenService; assets: BadgeRepository; toolAssets: { icon: BadgeAssetStorage; cover: BadgeAssetStorage; routed: BadgeAssetStorage }; reviews: ToolReviewService; moderation: ToolReviewModerationService; reviewRateLimiter: PollingRateLimiter; reportRateLimiter: PollingRateLimiter };
export function isToolPath(path: string) { return path === "/api/tools" || /^\/api\/tools\/[a-z0-9-]+$/.test(path) || /^\/api\/tools\/[0-9a-f-]+\/(rating-summary|my-rating)$/i.test(path) || /^\/api\/tools\/[0-9a-f-]+\/(reviews|my-review)$/i.test(path) || /^\/api\/tools\/[0-9a-f-]+\/reviews\/[0-9a-f-]+\/report$/i.test(path) || /^\/api\/tool-assets\/[0-9a-f-]+\/content$/i.test(path) || path.startsWith("/api/admin/tools") || path.startsWith("/api/admin/tool-assets") || path.startsWith("/api/admin/tool-badges") || path.startsWith("/api/admin/tool-categories") || path.startsWith("/api/admin/tool-reviews") || path.startsWith("/api/admin/tool-review-reports"); }

export async function handleTools(req: IncomingMessage, res: ServerResponse, url: URL, deps: Deps) {
  if (!isToolPath(url.pathname)) return false;
  let actor: string | undefined;
  try {
    if (url.pathname === "/api/tools" && req.method === "GET") { const query = parseToolQuery(url.searchParams),result=await deps.tools.list(query),summaries=await deps.ratings.summaries(result.items.map(x=>x.id));return json(res, 200, { ...result,items:result.items.map(x=>({...x,ratingSummary:summaries[x.id]})), page: query.page, pageSize: query.pageSize }); }
    const rating= url.pathname.match(/^\/api\/tools\/([0-9a-f-]+)\/(rating-summary|my-rating)$/i);
    if(rating?.[2]==="rating-summary"&&req.method==="GET")return json(res,200,await deps.ratings.summary(rating[1]));
    const publicTool = url.pathname.match(/^\/api\/tools\/([a-z0-9-]+)$/);
    if (publicTool && req.method === "GET") { const tool = await deps.tools.getBySlug(publicTool[1]); if (!tool) throw new ToolError("TOOL_NOT_FOUND"); return json(res, 200, {...tool,ratingSummary:await deps.ratings.summary(tool.id)}); }
    const content = url.pathname.match(/^\/api\/tool-assets\/([0-9a-f-]+)\/content$/i);
    if (content && req.method === "GET") {
      const asset = await deps.assets.getAsset(content[1]); if (!asset || asset.deletedAt) return empty(res, 404);
      try { const bytes = await deps.toolAssets.routed.read(asset.storageKey); res.writeHead(200, { "content-type": asset.contentType, "content-length": bytes.length, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" }); res.end(bytes); return true; }
      catch (error) { if (error instanceof BadgeAssetNotFoundError) return empty(res, 404); throw error; }
    }
    const reviewList = url.pathname.match(/^\/api\/tools\/([0-9a-f-]+)\/reviews$/i);
    if (reviewList && req.method === "GET") return json(res, 200, await deps.reviews.list(reviewList[1], parseReviewQuery(url.searchParams)));
    const user = await deps.sessions.authenticateBearer(typeof req.headers.authorization === "string" ? req.headers.authorization : undefined); actor = user.id;
    if(rating?.[2]==="my-rating"){
      await deps.authorization.requirePermission(actor,"tools.rate");
      if(req.method==="GET")return json(res,200,{rating:await deps.ratings.mine(rating[1],actor)});
      if(req.method==="PUT"||req.method==="DELETE"){
        try{deps.ratingRateLimiter.assertAllowed(`tool-rating:${actor}`);}catch(error){await deps.ratings.repository.audit("tool.rating_denied",actor,rating[1]).catch(()=>{});throw error;}
        if(req.method==="PUT")return json(res,200,await deps.ratings.save(rating[1],actor,await body(req)));
        await deps.ratings.remove(rating[1],actor);return empty(res,204);
      }
    }
    const myReview = url.pathname.match(/^\/api\/tools\/([0-9a-f-]+)\/my-review$/i);
    if(myReview){
      await deps.authorization.requirePermission(actor,"tools.view_reviews");
      if(req.method==="GET")return json(res,200,{review:(await deps.reviews.mine(myReview[1],actor))??null});
      if(req.method==="PUT"||req.method==="DELETE"){
        await deps.authorization.requirePermission(actor,"tools.write_review");
        try{deps.reviewRateLimiter.assertAllowed(`tool-review:${actor}`);}catch(error){await deps.reviews.repository.audit("tool.review_denied",actor,myReview[1]).catch(()=>{});throw error;}
        if(req.method==="PUT")return json(res,200,await deps.reviews.save(myReview[1],actor,await body(req)));
        await deps.reviews.remove(myReview[1],actor);return empty(res,204);
      }
    }
    const reviewReport = url.pathname.match(/^\/api\/tools\/([0-9a-f-]+)\/reviews\/([0-9a-f-]+)\/report$/i);
    if(reviewReport&&req.method==="POST"){
      await deps.authorization.requirePermission(actor,"tools.report_review");
      try{deps.reportRateLimiter.assertAllowed(`tool-report:${actor}`);}catch(error){await deps.reviews.reports.audit("tool.review_denied",actor).catch(()=>{});throw error;}
      const {report}=await deps.reviews.report(reviewReport[2],actor,await body(req));
      return json(res,201,{report});
    }
    const upload = url.pathname.match(/^\/api\/admin\/tool-assets\/(icon|cover)$/);
    if (upload && req.method === "POST") { await deps.authorization.requirePermission(actor, "tools.manage"); const bytes = await binary(req, 2 * 1024 * 1024); const declared = typeof req.headers["content-type"] === "string" ? req.headers["content-type"].split(";")[0] : undefined; const asset = validateBadgeAsset(bytes, declared); return json(res, 201, await persistBadgeAsset(deps.assets, deps.toolAssets[upload[1] as "icon" | "cover"], asset, actor)); }
    if (url.pathname === "/api/admin/tool-assets/missing" && req.method === "GET") { await deps.authorization.requirePermission(actor, "tools.manage"); const candidates = (await deps.assets.listAvailableAssets(500)).filter(asset => asset.storageKey.includes("/tools/") || asset.storageKey.startsWith("tools/")); const missing: Array<{ id: string }> = []; for (const asset of candidates) if (!await deps.toolAssets.routed.exists(asset.storageKey)) missing.push({ id: asset.id }); return json(res, 200, { items: missing }); }
    if (url.pathname === "/api/admin/tools" && req.method === "GET") { await deps.authorization.requirePermission(actor, "tools.manage"); const query = parseToolQuery(url.searchParams, true),result=await deps.tools.list(query); await deps.authorization.requirePermission(actor, "tools.view_ratings"); const summaries=await deps.ratings.summaries(result.items.map(x=>x.id)); return json(res, 200, { ...result,items:result.items.map(x=>({...x,ratingSummary:summaries[x.id]})), page: query.page, pageSize: query.pageSize }); }
    if (url.pathname === "/api/admin/tools" && req.method === "POST") { await deps.authorization.requirePermission(actor, "tools.manage"); return json(res, 201, await deps.tools.create(await body(req), actor)); }
    const tool = url.pathname.match(/^\/api\/admin\/tools\/([0-9a-f-]+)(?:\/(archive|reactivate))?$/i);
    if (tool) { await deps.authorization.requirePermission(actor, "tools.manage"); if (req.method === "PATCH" && !tool[2]) return json(res, 200, await deps.tools.update(tool[1], await body(req), actor)); if (req.method === "POST" && tool[2]) return json(res, 200, tool[2] === "archive" ? await deps.tools.archive(tool[1], actor) : await deps.tools.reactivate(tool[1], actor)); }
    if (url.pathname === "/api/admin/tool-badges" && req.method === "GET") { await deps.authorization.requirePermission(actor, "tool_badges.manage"); return json(res, 200, { items: await deps.tools.badges.list(url.searchParams.get("archived") === "true") }); }
    if (url.pathname === "/api/admin/tool-badges" && req.method === "POST") { await deps.authorization.requirePermission(actor, "tool_badges.manage"); return json(res, 201, await deps.tools.badges.create(parseToolBadge(await body(req)), actor)); }
    const badge = url.pathname.match(/^\/api\/admin\/tool-badges\/([0-9a-f-]+)(?:\/(archive|reactivate))?$/i);
    if (badge) { await deps.authorization.requirePermission(actor, "tool_badges.manage"); if (req.method === "PATCH" && !badge[2]) return json(res, 200, await deps.tools.badges.update(badge[1], parseToolBadge(await body(req)), actor)); if (req.method === "POST" && badge[2]) return json(res, 200, await deps.tools.badges.setArchived(badge[1], badge[2] === "archive", actor)); }
    if (url.pathname === "/api/admin/tool-categories" && req.method === "GET") { await deps.authorization.requirePermission(actor, "tool_categories.manage"); return json(res, 200, { items: await deps.tools.categories.list(url.searchParams.get("archived") === "true") }); }
    if (url.pathname === "/api/admin/tool-categories" && req.method === "POST") { await deps.authorization.requirePermission(actor, "tool_categories.manage"); return json(res, 201, await deps.tools.categories.create(parseToolCategory(await body(req)), actor)); }
    const category = url.pathname.match(/^\/api\/admin\/tool-categories\/([0-9a-f-]+)(?:\/(archive|reactivate))?$/i);
    if (category) { await deps.authorization.requirePermission(actor, "tool_categories.manage"); if (req.method === "PATCH" && !category[2]) return json(res, 200, await deps.tools.categories.update(category[1], parseToolCategory(await body(req)), actor)); if (req.method === "POST" && category[2]) return json(res, 200, await deps.tools.categories.setArchived(category[1], category[2] === "archive", actor)); }
    if (url.pathname === "/api/admin/tool-review-reports" && req.method === "GET") { await deps.authorization.requirePermission(actor, "tools.moderate_reviews"); return json(res, 200, await deps.moderation.listReports(parseReportQuery(url.searchParams))); }
    if (url.pathname === "/api/admin/tool-reviews" && req.method === "GET") { await deps.authorization.requirePermission(actor, "tools.moderate_reviews"); return json(res, 200, await deps.moderation.listReviews(parseAdminReviewQuery(url.searchParams))); }
    const adminReport = url.pathname.match(/^\/api\/admin\/tool-review-reports\/([0-9a-f-]+)\/(resolve|dismiss)$/i);
    if (adminReport && req.method === "POST") { await deps.authorization.requirePermission(actor, "tools.moderate_reviews"); return json(res, 200, adminReport[2] === "resolve" ? await deps.moderation.resolveReport(adminReport[1], actor) : await deps.moderation.dismissReport(adminReport[1], actor)); }
    const adminReview = url.pathname.match(/^\/api\/admin\/tool-reviews\/([0-9a-f-]+)\/(hide|restore|remove)$/i);
    if (adminReview && req.method === "POST") { await deps.authorization.requirePermission(actor, "tools.moderate_reviews"); if (adminReview[2] === "hide") return json(res, 200, await deps.moderation.hideReview(adminReview[1], actor, await body(req))); if (adminReview[2] === "restore") return json(res, 200, await deps.moderation.restoreReview(adminReview[1], actor)); return json(res, 200, await deps.moderation.removeReview(adminReview[1], actor, await body(req))); }
    return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    if (error instanceof AuthorizationError && actor) await deps.authorization.repository.writeAuditEvent({ actorUserId: actor, action: "tool.action_denied", targetType: "tool", metadata: { path: url.pathname, method: req.method ?? "UNKNOWN" } }).catch(() => {});
    const raw = error instanceof ToolError || error instanceof AuthorizationError ? error.code : error instanceof PollingRateLimitError ? "RATING_RATE_LIMITED" : error instanceof Error && error.message.includes("slug") ? "TOOL_SLUG_CONFLICT" : error instanceof Error && error.name === "BadgeError" ? error.message : "TOOL_OPERATION_FAILED";
    const protectedPath=/\/api\/tools\/[0-9a-f-]+\/(rating-summary|my-rating|reviews|my-review)(\/|$)/i.test(url.pathname)||/\/report$/i.test(url.pathname)||url.pathname.startsWith("/api/admin/tool-reviews")||url.pathname.startsWith("/api/admin/tool-review-reports");const code=protectedPath&&raw==="AUTHENTICATION_REQUIRED"?"UNAUTHENTICATED":protectedPath&&raw==="PERMISSION_DENIED"?"FORBIDDEN":raw;
    const status = code === "UNAUTHENTICATED"||code === "AUTHENTICATION_REQUIRED" ? 401 : code === "FORBIDDEN"||code === "PERMISSION_DENIED"||code === "REVIEW_SELF_REPORT_DENIED" ? 403 : code === "RATING_RATE_LIMITED"?429:code.endsWith("NOT_FOUND") ? 404 : code.includes("CONFLICT") || code === "TOOL_METADATA_IN_USE" || code === "REVIEW_ALREADY_REPORTED" ? 409 : code === "TOOL_OPERATION_FAILED" ? 500 : 400;
    if(error instanceof PollingRateLimitError)res.setHeader("retry-after",String(Math.max(1,Math.ceil(error.retryAfterMs/1000))));return json(res, status, { error: code });
  }
}
async function body(req: IncomingMessage) { const bytes = await binary(req, 128 * 1024); try { return JSON.parse(bytes.toString("utf8")); } catch { throw new ToolError("INVALID_JSON"); } }
async function binary(req: IncomingMessage, max: number) { const chunks: Buffer[] = []; let length = 0; for await (const chunk of req) { length += chunk.length; if (length > max) throw new ToolError("INVALID_TOOL"); chunks.push(chunk); } return Buffer.concat(chunks); }
function empty(res: ServerResponse, status: number) { res.writeHead(status, { "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(); return true; }
function json(res: ServerResponse, status: number, payload: object) { const value = JSON.stringify(payload); res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": status === 200 ? "public, max-age=60, stale-while-revalidate=120" : "no-store", "x-content-type-options": "nosniff", "content-length": Buffer.byteLength(value) }); res.end(value); return true; }
