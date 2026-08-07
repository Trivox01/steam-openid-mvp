INSERT INTO permissions (id, key, description, category) VALUES
 ('permission-tools-rate','tools.rate','rate tools','tools'),
 ('permission-tools-view-ratings','tools.view_ratings','view tool ratings','tools')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT role.id, permission.id FROM roles role CROSS JOIN permissions permission
WHERE permission.key IN ('tools.rate','tools.view_ratings')
ON CONFLICT DO NOTHING;

CREATE TABLE tool_ratings (
 id uuid PRIMARY KEY,
 tool_id uuid NOT NULL REFERENCES tool_definitions(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tool_id,user_id)
);

CREATE INDEX tool_ratings_tool_summary_idx ON tool_ratings(tool_id,rating);
CREATE INDEX tool_ratings_user_idx ON tool_ratings(user_id);
