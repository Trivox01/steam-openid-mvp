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
  "developer.tools"
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
