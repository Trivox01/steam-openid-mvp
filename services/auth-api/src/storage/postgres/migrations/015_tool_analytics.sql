INSERT INTO permissions (id, key, description, category) VALUES
 ('permission-tools-favorite','tools.favorite','favorite tools','tools'),
 ('permission-tools-view-public-stats','tools.view_public_stats','view public tool statistics','tools'),
 ('permission-tools-view-analytics','tools.view_analytics','view tool analytics','tools')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT role.id, permission.id FROM roles role CROSS JOIN permissions permission
WHERE permission.key IN ('tools.favorite','tools.view_public_stats')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT role.id, permission.id FROM roles role CROSS JOIN permissions permission
WHERE permission.key='tools.view_analytics'
  AND role.id IN ('role-owner','role-administrator','role-developer')
ON CONFLICT DO NOTHING;

CREATE TABLE tool_favorites (
  tool_id uuid NOT NULL REFERENCES tool_definitions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tool_id, user_id)
);

CREATE INDEX tool_favorites_user_created_idx ON tool_favorites(user_id, created_at DESC);

CREATE TABLE tool_events (
  id uuid PRIMARY KEY,
  tool_id uuid NOT NULL REFERENCES tool_definitions(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('view','download_click')),
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_events_tool_kind_created_idx ON tool_events(tool_id, event_type, created_at);
CREATE INDEX tool_events_user_idx ON tool_events(user_id);