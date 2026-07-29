INSERT INTO permissions (id, key, description, category)
VALUES (
  'permission-badges-view-assignments',
  'badges.view_assignments',
  'badges view assignments',
  'badges'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT role_id, 'permission-badges-view-assignments'
FROM (VALUES
  ('role-owner'),
  ('role-administrator'),
  ('role-moderator')
) AS grants(role_id);

CREATE TABLE badge_assignments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  badge_definition_id uuid NOT NULL
    REFERENCES badge_definitions(id) ON DELETE RESTRICT,
  assigned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL,
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revoke_reason text CHECK (
    revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 1 AND 500
  ),
  assignment_reason text CHECK (
    assignment_reason IS NULL OR char_length(assignment_reason) BETWEEN 1 AND 500
  ),
  source text NOT NULL CHECK (
    source IN ('manual', 'automatic', 'system', 'migration')
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 4096
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (revoked_at IS NULL AND revoked_by_user_id IS NULL AND revoke_reason IS NULL)
    OR
    (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
  ),
  CHECK (revoked_at IS NULL OR revoked_at >= assigned_at)
);

CREATE UNIQUE INDEX badge_assignments_active_unique
  ON badge_assignments(user_id, badge_definition_id)
  WHERE revoked_at IS NULL;
CREATE INDEX badge_assignments_user_idx
  ON badge_assignments(user_id, assigned_at DESC);
CREATE INDEX badge_assignments_badge_idx
  ON badge_assignments(badge_definition_id, assigned_at DESC);
CREATE INDEX badge_assignments_status_idx
  ON badge_assignments(revoked_at, assigned_at DESC);
