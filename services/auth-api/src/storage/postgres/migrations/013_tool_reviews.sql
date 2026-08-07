INSERT INTO permissions (id, key, description, category) VALUES
 ('permission-tools-view-reviews','tools.view_reviews','view tool reviews','tools'),
 ('permission-tools-write-review','tools.write_review','write tool reviews','tools'),
 ('permission-tools-report-review','tools.report_review','report tool reviews','tools'),
 ('permission-tools-moderate-reviews','tools.moderate_reviews','moderate tool reviews','tools')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT role.id, permission.id FROM roles role CROSS JOIN permissions permission
WHERE permission.key IN ('tools.view_reviews','tools.write_review','tools.report_review')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT role.id, permission.id FROM roles role CROSS JOIN permissions permission
WHERE permission.key='tools.moderate_reviews'
  AND role.id IN ('role-owner','role-administrator','role-developer','role-moderator')
ON CONFLICT DO NOTHING;

CREATE TABLE tool_reviews (
  id uuid PRIMARY KEY,
  tool_id uuid NOT NULL REFERENCES tool_definitions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 100),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden','removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  moderated_at timestamptz,
  moderated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  moderation_reason text CHECK (moderation_reason IS NULL OR char_length(moderation_reason) <= 500),
  UNIQUE(tool_id,user_id)
);

CREATE INDEX tool_reviews_tool_status_created_idx ON tool_reviews(tool_id,status,created_at DESC);
CREATE INDEX tool_reviews_user_idx ON tool_reviews(user_id);

CREATE TABLE tool_review_reports (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES tool_reviews(id) ON DELETE RESTRICT,
  reporter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason IN ('spam','harassment','unsafe_link','misleading','inappropriate','other')),
  details text CHECK (details IS NULL OR char_length(details) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE(review_id, reporter_user_id)
);

CREATE INDEX tool_review_reports_status_created_idx ON tool_review_reports(status, created_at DESC);
CREATE INDEX tool_review_reports_review_idx ON tool_review_reports(review_id);
