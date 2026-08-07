import type { PermissionKey } from "./permissions.ts";

export const rolePresets = [
  { slug: "owner", displayName: "Owner", description: "Service owner.", priority: 100 },
  { slug: "administrator", displayName: "Administrator", description: "Administrative operator.", priority: 80 },
  { slug: "developer", displayName: "Developer", description: "Product developer.", priority: 60 },
  { slug: "moderator", displayName: "Moderator", description: "Community moderator.", priority: 40 },
  { slug: "assistant", displayName: "Assistant", description: "Limited support operator.", priority: 20 }
] as const;

export type SystemRoleSlug = typeof rolePresets[number]["slug"];

export const defaultRolePermissions: Readonly<Record<SystemRoleSlug, readonly PermissionKey[]>> = {
  owner: [
    "admin.access", "users.view", "users.change_status", "users.manage", "roles.view", "roles.assign",
    "roles.manage_permissions", "badges.view", "badges.create", "badges.edit",
    "badges.delete", "badges.view_assignments", "badges.assign", "badges.revoke", "assets.upload",
    "assets.delete", "settings.view", "settings.edit", "audit.view",
    "developer.tools", "tools.view", "tools.manage", "tools.rate", "tools.view_ratings", "tool_badges.manage", "tool_categories.manage"
  ],
  administrator: [
    "admin.access", "users.view", "users.change_status", "users.manage", "roles.view", "roles.assign",
    "roles.manage_permissions", "badges.view", "badges.create", "badges.edit",
    "badges.delete", "badges.view_assignments", "badges.assign", "badges.revoke", "assets.upload",
    "assets.delete", "settings.view", "settings.edit", "audit.view",
    "tools.view", "tools.manage", "tools.rate", "tools.view_ratings", "tool_badges.manage", "tool_categories.manage"
  ],
  developer: [
    "admin.access", "users.view", "roles.view", "badges.view", "badges.create",
    "badges.edit", "assets.upload", "settings.view", "audit.view",
    "developer.tools", "tools.view", "tools.manage", "tools.rate", "tools.view_ratings", "tool_badges.manage", "tool_categories.manage"
  ],
  moderator: [
    "admin.access", "users.view", "badges.view", "badges.view_assignments", "badges.assign",
    "badges.revoke", "audit.view", "tools.view", "tools.rate", "tools.view_ratings"
  ],
  assistant: ["admin.access", "users.view", "badges.view", "settings.view", "tools.view", "tools.rate", "tools.view_ratings"]
};
