export const PERMISSION_KEYS = [
  "admin.access",
  "users.view",
  "users.change_status",
  "users.manage",
  "roles.view",
  "roles.assign",
  "roles.manage_permissions",
  "badges.view",
  "badges.create",
  "badges.edit",
  "badges.delete",
  "badges.view_assignments",
  "badges.assign",
  "badges.revoke",
  "assets.upload",
  "assets.delete",
  "settings.view",
  "settings.edit",
  "audit.view",
  "developer.tools",
  "tools.view",
  "tools.manage",
  "tools.rate",
  "tools.view_ratings",
  "tools.view_reviews",
  "tools.write_review",
  "tools.report_review",
  "tools.moderate_reviews",
  "tools.vote_review_helpful",
  "tools.reply_to_review",
  "tools.favorite",
  "tools.view_public_stats",
  "tools.view_analytics",
  "tool_badges.manage",
  "tool_categories.manage"
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

export const permissionRegistry: ReadonlyArray<{
  key: PermissionKey;
  description: string;
  category: string;
}> = PERMISSION_KEYS.map((key) => ({
  key,
  description: describePermission(key),
  category: key.split(".")[0]
}));

const permissionSet = new Set<string>(PERMISSION_KEYS);

export function isPermissionKey(value: string): value is PermissionKey {
  return permissionSet.has(value);
}

function describePermission(key: PermissionKey) {
  return key.replace(".", " ").replaceAll("_", " ");
}
