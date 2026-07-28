CREATE TABLE users (
  id uuid PRIMARY KEY,
  steam_id64 char(17) NOT NULL UNIQUE CHECK (steam_id64 ~ '^[0-9]{17}$'),
  authenticated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text NOT NULL,
  priority integer NOT NULL CHECK (priority >= 0),
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  description text NOT NULL,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_id text NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  permission_id text NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  assigned_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX user_roles_active_unique
  ON user_roles(user_id, role_id) WHERE revoked_at IS NULL;
CREATE INDEX user_roles_active_user_idx
  ON user_roles(user_id) WHERE revoked_at IS NULL;

CREATE TABLE user_permission_overrides (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  effect text NOT NULL CHECK (effect IN ('allow', 'deny')),
  assigned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX user_permission_overrides_active_unique
  ON user_permission_overrides(user_id, permission_id)
  WHERE revoked_at IS NULL;
CREATE INDEX user_permission_overrides_active_user_idx
  ON user_permission_overrides(user_id) WHERE revoked_at IS NULL;

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash char(64),
  user_agent_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_created_at_idx ON audit_events(created_at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events(actor_user_id, created_at DESC);

INSERT INTO roles (id, slug, display_name, description, priority, is_system) VALUES
  ('role-owner', 'owner', 'Owner', 'Service owner.', 100, true),
  ('role-administrator', 'administrator', 'Administrator', 'Administrative operator.', 80, true),
  ('role-developer', 'developer', 'Developer', 'Product developer.', 60, true),
  ('role-moderator', 'moderator', 'Moderator', 'Community moderator.', 40, true),
  ('role-assistant', 'assistant', 'Assistant', 'Limited support operator.', 20, true);

INSERT INTO permissions (id, key, description, category) VALUES
  ('permission-admin-access', 'admin.access', 'admin access', 'admin'),
  ('permission-users-view', 'users.view', 'users view', 'users'),
  ('permission-users-manage', 'users.manage', 'users manage', 'users'),
  ('permission-roles-view', 'roles.view', 'roles view', 'roles'),
  ('permission-roles-assign', 'roles.assign', 'roles assign', 'roles'),
  ('permission-roles-manage-permissions', 'roles.manage_permissions', 'roles manage permissions', 'roles'),
  ('permission-badges-view', 'badges.view', 'badges view', 'badges'),
  ('permission-badges-create', 'badges.create', 'badges create', 'badges'),
  ('permission-badges-edit', 'badges.edit', 'badges edit', 'badges'),
  ('permission-badges-delete', 'badges.delete', 'badges delete', 'badges'),
  ('permission-badges-assign', 'badges.assign', 'badges assign', 'badges'),
  ('permission-badges-revoke', 'badges.revoke', 'badges revoke', 'badges'),
  ('permission-assets-upload', 'assets.upload', 'assets upload', 'assets'),
  ('permission-assets-delete', 'assets.delete', 'assets delete', 'assets'),
  ('permission-settings-view', 'settings.view', 'settings view', 'settings'),
  ('permission-settings-edit', 'settings.edit', 'settings edit', 'settings'),
  ('permission-audit-view', 'audit.view', 'audit view', 'audit'),
  ('permission-developer-tools', 'developer.tools', 'developer tools', 'developer');

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role-owner', id FROM permissions;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role-administrator', id FROM permissions
WHERE key <> 'developer.tools';

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role-developer', id FROM permissions
WHERE key IN (
  'admin.access', 'users.view', 'roles.view', 'badges.view', 'badges.create',
  'badges.edit', 'assets.upload', 'settings.view', 'audit.view', 'developer.tools'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role-moderator', id FROM permissions
WHERE key IN (
  'admin.access', 'users.view', 'badges.view', 'badges.assign',
  'badges.revoke', 'audit.view'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role-assistant', id FROM permissions
WHERE key IN ('admin.access', 'users.view', 'badges.view', 'settings.view');
