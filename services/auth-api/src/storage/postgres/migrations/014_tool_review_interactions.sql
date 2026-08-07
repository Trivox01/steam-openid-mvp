INSERT INTO permissions (id, key, description, category) VALUES
 ('permission-tools-vote-review-helpful','tools.vote_review_helpful','vote tool reviews as helpful','tools'),
 ('permission-tools-reply-to-review','tools.reply_to_review','reply to tool reviews','tools')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT role.id, permission.id FROM roles role CROSS JOIN permissions permission
WHERE permission.key='tools.vote_review_helpful'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT role.id, permission.id FROM roles role CROSS JOIN permissions permission
WHERE permission.key='tools.reply_to_review'
  AND role.id IN ('role-owner','role-administrator','role-developer')
ON CONFLICT DO NOTHING;

CREATE TABLE tool_review_helpful_votes (
  review_id uuid NOT NULL REFERENCES tool_reviews(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, user_id)
);

CREATE INDEX tool_review_helpful_votes_user_idx ON tool_review_helpful_votes(user_id);

CREATE TABLE tool_review_developer_replies (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL UNIQUE REFERENCES tool_reviews(id) ON DELETE RESTRICT,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX tool_review_developer_replies_status_idx ON tool_review_developer_replies(review_id, status);