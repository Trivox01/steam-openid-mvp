import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tools as enTools } from "../src/locales/en/tools.ts";
import { tools as arTools } from "../src/locales/ar/tools.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const types = read("../src/features/tools/types.ts");
const client = read("../src/features/tools/ToolClient.ts");
const form = read("../src/features/tools/ReviewForm.tsx");
const list = read("../src/features/tools/ReviewList.tsx");
const modal = read("../src/features/tools/ReportReviewModal.tsx");
const details = read("../src/pages/ToolDetailsPage.tsx");
const devPage = read("../src/pages/DeveloperCenterPage.tsx");
const moderation = read("../src/features/developer-center/tools/ReviewModerationPanel.tsx");
const reports = read("../src/features/developer-center/tools/ReviewReportsPanel.tsx");
const replyModal = read("../src/features/developer-center/tools/ReplyReviewModal.tsx");
const css = read("../src/styles/index.css");
const nexusCss = read("../src/styles/nexus-system-v2.css");
const routes = read("../services/auth-api/src/routes/tools.ts");
const permissions = read("../services/auth-api/src/authorization/permissions.ts");
const helpRepo = read("../services/auth-api/src/tools/toolReviewHelpfulRepository.ts");
const replyRepo = read("../services/auth-api/src/tools/toolReviewDeveloperReplyRepository.ts");

assert.match(types, /ToolReviewView/);
assert.match(types, /ToolReviewPage/);
assert.match(types, /ToolReviewAdminView/);
assert.match(types, /ToolReviewReportView/);
assert.match(types, /ToolReviewReason/);
assert.match(types, /ToolReviewDeveloperReply/);
assert.match(types, /helpfulCount/);
assert.match(types, /currentUserHelpful/);
assert.match(types, /developerReply/);
assert.match(client, /reviews\(toolId: string, params: URLSearchParams, signal\?: AbortSignal\)/);
assert.match(client, /myReview\(toolId: string\)/);
assert.match(client, /saveReview\(toolId: string, draft/);
assert.match(client, /removeReview\(toolId: string\)/);
assert.match(client, /reportReview\(toolId: string/);
assert.match(client, /adminReviews\(/);
assert.match(client, /moderateReview\(id: string/);
assert.match(client, /adminReports\(/);
assert.match(client, /resolveReport\(id: string\)/);
assert.match(client, /dismissReport\(id: string\)/);
assert.match(client, /setReviewHelpful\(/);
assert.match(client, /saveDeveloperReply\(/);
assert.match(client, /removeDeveloperReply\(/);

assert.match(form, /aria-modal="true"/);
assert.match(form, /event\.key === "Escape"/);
assert.match(form, /event\.key === "Tab"/);
assert.match(form, /aria-busy/);
assert.match(form, /aria-invalid/);
assert.match(form, /maxLength/);
assert.match(form, /noValidate/);
assert.match(form, /busy\) return/);
assert.match(form, /\b100\b/);
assert.match(form, /\b2500\b/);
assert.match(list, /ProfileAvatar/);
assert.match(list, /Flag/);
assert.match(list, /review\.report/);
assert.match(list, /ThumbsUp/);
assert.match(list, /review\.helpfulMark/);
assert.match(list, /review\.helpfulCount/);
assert.match(list, /review\.developer/);
assert.match(list, /aria-pressed/);
assert.match(list, /review\.developerReply/);
assert.match(modal, /aria-modal="true"/);
assert.match(modal, /Escape/);
assert.match(modal, /disabled=\{busy \|\| !reason\}/);
assert.doesNotMatch(form + list + modal + details, /dangerouslySetInnerHTML|SteamID64|steamId64/i);

assert.match(details, /ReviewForm/);
assert.match(details, /ReviewList/);
assert.match(details, /ReportReviewModal/);
assert.match(details, /review\.signInRequired/);
assert.match(details, /aria-labelledby="reviews-title"/);
assert.match(details, /window\.confirm/);
assert.match(details, /toggleHelpful/);
assert.match(details, /busyHelpfulId/);
assert.match(details, /tool-details__reviews \$\{hasReviews \? "" : "is-empty"\}/);
assert.match(details, /\{hasReviews && <div className="tool-reviews-toolbar">/);

assert.match(replyModal, /aria-modal="true"/);
assert.match(replyModal, /Escape/);
assert.match(replyModal, /Tab/);
assert.match(replyModal, /aria-busy/);
assert.match(replyModal, /maxLength/);
assert.match(replyModal, /saveDeveloperReply\(/);
assert.match(replyModal, /removeDeveloperReply\(/);
assert.match(replyModal, /review\.replySave/);
assert.match(replyModal, /review\.replyRemove/);
assert.doesNotMatch(form + list + modal + details + replyModal, /dangerouslySetInnerHTML|SteamID64|steamId64/i);

assert.match(devPage, /tools\.moderate_reviews/);
assert.match(devPage, /tools\.reply_to_review/);
assert.match(devPage, /ReviewModerationPanel/);
assert.match(devPage, /ReviewReportsPanel/);
assert.match(devPage, /toolReviewReports/);
assert.match(moderation, /moderateReview\(/);
assert.match(moderation, /params\.set\("reported", "true"\)/);
assert.match(moderation, /window\.confirm/);
assert.match(moderation, /ReplyReviewModal/);
assert.match(moderation, /review\.replyEdit/);
assert.match(reports, /resolveReport\(/);
assert.match(reports, /dismissReport\(/);
assert.match(reports, /review\.reason\./);
assert.doesNotMatch(reports, /steamId64|SteamID64/i);

assert.match(helpRepo, /ToolReviewHelpfulRepository/);
assert.match(helpRepo, /add\(/);
assert.match(helpRepo, /remove\(/);
assert.match(helpRepo, /has\(/);
assert.match(helpRepo, /counts\(/);
assert.match(helpRepo, /flags\(/);
assert.match(replyRepo, /ToolReviewDeveloperReplyRepository/);
assert.match(replyRepo, /upsert\(/);
assert.match(replyRepo, /getByReview\(/);
assert.match(replyRepo, /listForReviews\(/);
assert.match(replyRepo, /remove\(/);
assert.match(replyRepo, /REPLY_LIMITS/);

assert.match(css, /\.review-card/);
assert.match(css, /\.review-form/);
assert.match(css, /\.report-modal/);
assert.match(css, /\.review-pagination/);
assert.match(css, /\.segmented/);
assert.match(css, /\.review-admin-row/);
assert.match(css, /\.report-card/);
assert.match(css, /\.review-helpful/);
assert.match(css, /\.review-reply/);
assert.match(css, /\.reply-modal/);
assert.match(css, /prefers-reduced-motion:reduce/);
assert.match(nexusCss, /\.tool-details__reviews\.is-empty/);
assert.match(routes, /\/api\/admin\/tool-reviews/);
assert.match(routes, /tools\.moderate_reviews/);
assert.match(routes, /\/api\/admin\/tool-review-reports/);
assert.match(permissions, /tools\.moderate_reviews/);
assert.match(permissions, /tools\.vote_review_helpful/);
assert.match(permissions, /tools\.reply_to_review/);
assert.match(routes, /tools\.vote_review_helpful/);
assert.match(routes, /tools\.reply_to_review/);
assert.deepEqual(Object.keys(enTools).sort(), Object.keys(arTools).sort());

const required = [
  "review.title", "review.writeTitle", "review.editTitle", "review.titleLabel", "review.bodyLabel",
  "review.characterCount", "review.plainTextNote", "review.saveChanges", "review.publish",
  "review.discardChanges", "review.titleTooLong", "review.bodyTooLong", "review.bodyRequired",
  "review.yourReview", "review.edit", "review.delete", "review.deleteConfirm", "review.writePrompt",
  "review.write", "review.signInRequired", "review.saved", "review.removed", "review.saveFailed",
  "review.sortLabel", "review.sortNewest", "review.sortHighest", "review.sortLowest", "review.empty",
  "review.loadFailed", "review.pagination", "review.previous", "review.next", "review.pageOf",
  "review.edited", "review.report", "review.reportTitle", "review.reportBody", "review.reportReason",
  "review.reason.spam", "review.reason.harassment", "review.reason.unsafe_link",
  "review.reason.misleading", "review.reason.inappropriate", "review.reason.other",
  "review.reportDetails", "review.reportDetailsOptional", "review.reportSubmit", "review.reportFailed",
  "review.reported", "review.helpfulMark", "review.helpfulMarked", "review.helpfulCount",
  "review.helpfulFailed", "review.developer", "review.reply", "review.replyEdit",
  "review.replyNewTitle", "review.replyEditTitle", "review.replySave", "review.replyRemove",
  "review.replyRemoveConfirm", "review.replyUpdated", "review.replySaveFailed",
  "developer.section.toolReviews", "developer.section.toolReviewReports",
  "developer.toolReviews.error", "developer.toolReviews.filterLabel", "developer.toolReviews.filter.all",
  "developer.toolReviews.filter.active", "developer.toolReviews.filter.hidden",
  "developer.toolReviews.filter.removed", "developer.toolReviews.filter.reported",
  "developer.toolReviews.openReports", "developer.toolReviews.empty", "developer.toolReviews.tool",
  "developer.toolReviews.author", "developer.toolReviews.status", "developer.toolReviews.reports",
  "developer.toolReviews.created", "developer.toolReviews.status.active",
  "developer.toolReviews.status.hidden", "developer.toolReviews.status.removed",
  "developer.toolReviews.hide", "developer.toolReviews.restore", "developer.toolReviews.remove",
  "developer.toolReviews.confirm.hide", "developer.toolReviews.confirm.restore", "developer.toolReviews.confirm.remove",
  "developer.toolReviews.reasonRemoved", "developer.toolReports.back", "developer.toolReports.filterLabel",
  "developer.toolReports.filter.open", "developer.toolReports.filter.resolved",
  "developer.toolReports.filter.dismissed", "developer.toolReports.empty", "developer.toolReports.reason",
  "developer.toolReports.status.open", "developer.toolReports.status.resolved",
  "developer.toolReports.status.dismissed", "developer.toolReports.dismiss", "developer.toolReports.resolve"
];
for (const key of required) {
  assert.equal(typeof enTools[key], "string", `missing en key ${key}`);
  assert.equal(typeof arTools[key], "string", `missing ar key ${key}`);
}
assert.equal(enTools["review.writeTitle"], "Write a review");
assert.equal(arTools["review.writeTitle"], "اكتب مراجعة");
assert.equal(enTools["review.saveFailed"], "Couldn't save your review");
assert.equal(arTools["review.saveFailed"], "تعذر حفظ مراجعتك");
assert.match(enTools["review.pageOf"], /\{\{page\}\}/);
assert.match(arTools["review.pageOf"], /\{\{page\}\}/);
assert.match(enTools["review.characterCount"], /\{\{current\}\}/);
assert.match(arTools["review.characterCount"], /\{\{current\}\}/);

console.log("Nexus Tool Reviews UX, i18n, styles, and backend wiring validation passed.");
