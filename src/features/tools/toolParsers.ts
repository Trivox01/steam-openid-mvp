import type {
  NexusTool, ReviewHelpfulState, ToolBadge, ToolCategory, ToolFavoriteEntry,
  ToolRatingSummary, ToolReviewDeveloperReply, ToolReviewPage, ToolReviewView
} from "./types";
import {
  expectArrayOf, expectBoolean, expectCollection, expectNullableNumber, expectNumber,
  expectOneOf, expectPage, expectRecord, expectString, isRecord, optionalBoolean,
  optionalString, type Parser
} from "../../services/validation/parse.ts";

/**
 * Runtime parsers for the tool endpoints the interface actually reads.
 *
 * Required versus optional follows what the UI does with each field, not what the
 * type declaration happens to allow. `NexusTool.badges` is required because
 * `ToolDetailsPage` spreads and sorts it unconditionally; `category` is optional
 * because every read already branches on its absence.
 *
 * Unknown fields are preserved: each parser returns the validated payload object
 * so a new backend field flows through untouched instead of being dropped.
 */

const TRUST_KINDS = ["official", "external", "community"] as const;
const BADGE_COLORS = ["purple", "blue", "green", "amber", "neutral"] as const;
const REVIEW_STATUSES = ["active", "hidden", "removed"] as const;

export const parseToolBadge: Parser<ToolBadge> = (value, path = "badge") => {
  const record = expectRecord(value, path);
  expectString(record.id, `${path}.id`);
  expectString(record.name, `${path}.name`);
  expectString(record.slug, `${path}.slug`);
  expectOneOf(record.color, `${path}.color`, BADGE_COLORS);
  expectString(record.iconKey, `${path}.iconKey`);
  expectNumber(record.displayOrder, `${path}.displayOrder`);
  expectBoolean(record.isActive, `${path}.isActive`);
  return record as unknown as ToolBadge;
};

export const parseToolCategory: Parser<ToolCategory> = (value, path = "category") => {
  const record = expectRecord(value, path);
  expectString(record.id, `${path}.id`);
  expectString(record.name, `${path}.name`);
  expectString(record.slug, `${path}.slug`);
  optionalString(record.description, `${path}.description`);
  expectNumber(record.displayOrder, `${path}.displayOrder`);
  expectBoolean(record.isActive, `${path}.isActive`);
  return record as unknown as ToolCategory;
};

export const parseRatingSummary: Parser<ToolRatingSummary> = (value, path = "ratingSummary") => {
  const record = expectRecord(value, path);
  expectNullableNumber(record.average, `${path}.average`);
  expectNumber(record.total, `${path}.total`);
  const distribution = expectRecord(record.distribution, `${path}.distribution`);
  // The star histogram indexes all five buckets directly, so a partial
  // distribution would render NaN bars rather than fail loudly.
  for (const star of ["1", "2", "3", "4", "5"] as const) {
    expectNumber(distribution[star], `${path}.distribution.${star}`);
  }
  return record as unknown as ToolRatingSummary;
};

export const parseTool: Parser<NexusTool> = (value, path = "tool") => {
  const record = expectRecord(value, path);
  expectString(record.id, `${path}.id`);
  expectString(record.name, `${path}.name`);
  expectString(record.slug, `${path}.slug`);
  expectString(record.shortDescription, `${path}.shortDescription`);
  expectString(record.fullDescription, `${path}.fullDescription`);
  expectString(record.version, `${path}.version`);
  expectString(record.developerName, `${path}.developerName`);
  expectString(record.externalDownloadUrl, `${path}.externalDownloadUrl`);
  expectString(record.downloadDomain, `${path}.downloadDomain`);
  expectOneOf(record.downloadTrust, `${path}.downloadTrust`, TRUST_KINDS);
  optionalString(record.officialWebsiteUrl, `${path}.officialWebsiteUrl`);
  optionalString(record.iconUrl, `${path}.iconUrl`);
  optionalString(record.coverUrl, `${path}.coverUrl`);
  expectBoolean(record.isFeatured, `${path}.isFeatured`);
  expectBoolean(record.isActive, `${path}.isActive`);
  expectString(record.createdAt, `${path}.createdAt`);
  expectString(record.updatedAt, `${path}.updatedAt`);
  expectArrayOf(record.badges, `${path}.badges`, parseToolBadge);
  if (record.category !== undefined && record.category !== null) {
    parseToolCategory(record.category, `${path}.category`);
  }
  if (record.ratingSummary !== undefined && record.ratingSummary !== null) {
    parseRatingSummary(record.ratingSummary, `${path}.ratingSummary`);
  }
  return record as unknown as NexusTool;
};

const parseDeveloperReply: Parser<ToolReviewDeveloperReply> = (value, path) => {
  const record = expectRecord(value, path);
  expectString(record.body, `${path}.body`);
  expectString(record.createdAt, `${path}.createdAt`);
  expectString(record.updatedAt, `${path}.updatedAt`);
  expectBoolean(record.edited, `${path}.edited`);
  return record as unknown as ToolReviewDeveloperReply;
};

export const parseReview: Parser<ToolReviewView> = (value, path = "review") => {
  const record = expectRecord(value, path);
  expectString(record.id, `${path}.id`);
  expectString(record.toolId, `${path}.toolId`);
  expectString(record.userId, `${path}.userId`);
  optionalString(record.title, `${path}.title`);
  expectString(record.body, `${path}.body`);
  expectOneOf(record.status, `${path}.status`, REVIEW_STATUSES);
  expectString(record.createdAt, `${path}.createdAt`);
  expectString(record.updatedAt, `${path}.updatedAt`);
  expectBoolean(record.edited, `${path}.edited`);
  expectString(record.displayName, `${path}.displayName`);
  optionalString(record.avatarUrl, `${path}.avatarUrl`);
  expectNullableNumber(record.rating, `${path}.rating`);
  expectNumber(record.helpfulCount, `${path}.helpfulCount`);
  optionalBoolean(record.currentUserHelpful, `${path}.currentUserHelpful`);
  if (record.developerReply !== undefined && record.developerReply !== null) {
    parseDeveloperReply(record.developerReply, `${path}.developerReply`);
  }
  return record as unknown as ToolReviewView;
};

export const parseReviewPage: Parser<ToolReviewPage> = (value, path = "reviews") =>
  expectPage(value, path, parseReview) as ToolReviewPage;

export const parseToolPage: Parser<{
  items: NexusTool[]; total: number; page: number; pageSize: number;
}> = (value, path = "tools") => expectPage(value, path, parseTool);

export const parseCategoryCollection: Parser<{ items: ToolCategory[]; total: number }> =
  (value, path = "categories") => expectCollection(value, path, parseToolCategory);

export const parseBadgeCollection: Parser<{ items: ToolBadge[]; total: number }> =
  (value, path = "badges") => expectCollection(value, path, parseToolBadge);

export const parseFavoriteEntry: Parser<ToolFavoriteEntry> = (value, path = "favorite") => {
  const record = expectRecord(value, path);
  expectString(record.toolId, `${path}.toolId`);
  expectNumber(record.createdAtMs, `${path}.createdAtMs`);
  const stats = expectRecord(record.stats, `${path}.stats`);
  expectNumber(stats.views, `${path}.stats.views`);
  expectNumber(stats.downloadClicks, `${path}.stats.downloadClicks`);
  expectNumber(stats.favorites, `${path}.stats.favorites`);
  parseTool(record.tool, `${path}.tool`);
  return record as unknown as ToolFavoriteEntry;
};

export const parseFavoritePage: Parser<{
  items: ToolFavoriteEntry[]; total: number; page: number; pageSize: number;
}> = (value, path = "favorites") => expectPage(value, path, parseFavoriteEntry);

export const parseFavoriteState: Parser<{ isFavorite: boolean; favoritesCount: number }> =
  (value, path = "favorite") => {
    const record = expectRecord(value, path);
    return {
      isFavorite: expectBoolean(record.isFavorite, `${path}.isFavorite`),
      favoritesCount: expectNumber(record.favoritesCount, `${path}.favoritesCount`)
    };
  };

export const parseFavoriteStatus: Parser<{ isFavorite: boolean }> = (value, path = "favoriteStatus") => ({
  isFavorite: expectBoolean(expectRecord(value, path).isFavorite, `${path}.isFavorite`)
});

export const parseMyRating: Parser<{ rating: number | null }> = (value, path = "myRating") => ({
  rating: expectNullableNumber(expectRecord(value, path).rating, `${path}.rating`)
});

/** The mutation reply always carries the stored value, so null is malformed here. */
export const parseSavedRating: Parser<{ rating: number }> = (value, path = "savedRating") => ({
  rating: expectNumber(expectRecord(value, path).rating, `${path}.rating`)
});

export const parseMyReview: Parser<{ review: ToolReviewView | null }> = (value, path = "myReview") => {
  const record = expectRecord(value, path);
  if (record.review === null || record.review === undefined) return { review: null };
  return { review: parseReview(record.review, `${path}.review`) };
};

export const parseHelpfulState: Parser<ReviewHelpfulState> = (value, path = "helpful") => {
  const record = expectRecord(value, path);
  return {
    helpfulCount: expectNumber(record.helpfulCount, `${path}.helpfulCount`),
    currentUserHelpful: expectBoolean(record.currentUserHelpful, `${path}.currentUserHelpful`)
  };
};

/** Reports are opaque to the UI, which only needs to know one came back. */
export const parseReportAcknowledgement: Parser<{ report: unknown }> = (value, path = "report") => {
  const record = expectRecord(value, path);
  if (!isRecord(record.report)) expectRecord(record.report, `${path}.report`);
  return { report: record.report };
};
