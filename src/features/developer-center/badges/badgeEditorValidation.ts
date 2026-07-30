import type { BadgeDraft } from "./types";

export const MAX_BADGE_ICON_BYTES = 2 * 1024 * 1024;

export function validateBadgeDraft(draft: BadgeDraft) {
  const errors: Record<string, string> = {};
  if (!draft.displayName.trim() || draft.displayName.trim().length > 80) {
    errors.displayName = "REQUIRED_NAME";
  }
  if (!draft.slug.trim()) errors.slug = "REQUIRED_SLUG";
  else if (
    draft.slug.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug)
  ) errors.slug = "INVALID_BADGE_SLUG";
  if (draft.description.length > 500) errors.description = "DESCRIPTION_TOO_LONG";
  if (
    !Number.isSafeInteger(draft.priority) ||
    draft.priority < 0 || draft.priority > 10000
  ) errors.priority = "INVALID_PRIORITY";
  if (draft.startsAt && !Number.isFinite(Date.parse(draft.startsAt))) {
    errors.startsAt = "INVALID_BADGE_DATES";
  }
  if (draft.endsAt && (
    !Number.isFinite(Date.parse(draft.endsAt)) ||
    Boolean(draft.startsAt && Date.parse(draft.endsAt) <= Date.parse(draft.startsAt))
  )) errors.endsAt = "INVALID_BADGE_DATES";
  return errors;
}

export function validateBadgeIconFile(file: File) {
  if (!["image/png", "image/webp"].includes(file.type)) {
    return "INVALID_ASSET_FORMAT";
  }
  if (file.size <= 0 || file.size > MAX_BADGE_ICON_BYTES) {
    return "INVALID_ASSET_SIZE";
  }
  return "";
}
