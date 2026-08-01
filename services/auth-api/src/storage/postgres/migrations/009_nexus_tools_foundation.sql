INSERT INTO permissions (id, key, description, category) VALUES
 ('permission-tools-view','tools.view','tools view','tools'),
 ('permission-tools-manage','tools.manage','tools manage','tools'),
 ('permission-tool-badges-manage','tool_badges.manage','tool badges manage','tools'),
 ('permission-tool-categories-manage','tool_categories.manage','tool categories manage','tools')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT role.id, permission.id FROM roles role CROSS JOIN permissions permission
WHERE role.slug IN ('owner','administrator','developer')
AND permission.key IN ('tools.view','tools.manage','tool_badges.manage','tool_categories.manage')
ON CONFLICT DO NOTHING;

CREATE TABLE tool_badges (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 60),
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
 color text NOT NULL CHECK(color IN ('purple','blue','green','amber','neutral')),
 icon_key text NOT NULL CHECK(icon_key IN ('badge-check','shield-check','sparkles','code-2','gift','zap','refresh-cw')),
 display_order integer NOT NULL DEFAULT 0 CHECK(display_order BETWEEN 0 AND 10000),
 is_active boolean NOT NULL DEFAULT true, archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tool_categories (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 80),
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
 description text CHECK(description IS NULL OR char_length(description)<=300),
 display_order integer NOT NULL DEFAULT 0 CHECK(display_order BETWEEN 0 AND 10000),
 is_active boolean NOT NULL DEFAULT true, archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tool_definitions (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 100),
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
 short_description text NOT NULL CHECK(char_length(short_description) BETWEEN 1 AND 220),
 full_description text NOT NULL CHECK(char_length(full_description) BETWEEN 1 AND 5000),
 version text NOT NULL CHECK(char_length(version) BETWEEN 1 AND 40),
 developer_name text NOT NULL CHECK(char_length(developer_name) BETWEEN 1 AND 100),
 external_download_url text NOT NULL CHECK(external_download_url ~ '^https://'),
 download_trust text NOT NULL CHECK(download_trust IN ('official','external','community')),
 official_website_url text CHECK(official_website_url IS NULL OR official_website_url ~ '^https://'),
 icon_url text CHECK(icon_url IS NULL OR icon_url ~ '^https://'), cover_url text CHECK(cover_url IS NULL OR cover_url ~ '^https://'),
 category_id uuid REFERENCES tool_categories(id) ON DELETE RESTRICT,
 is_featured boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
 published_at timestamptz, archived_at timestamptz,
 created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tool_badge_assignments (
 tool_id uuid NOT NULL REFERENCES tool_definitions(id) ON DELETE CASCADE,
 badge_id uuid NOT NULL REFERENCES tool_badges(id) ON DELETE RESTRICT,
 display_order integer NOT NULL DEFAULT 0 CHECK(display_order BETWEEN 0 AND 10000),
 PRIMARY KEY(tool_id,badge_id)
);
CREATE INDEX tool_definitions_public_idx ON tool_definitions(is_featured,published_at DESC) WHERE is_active=true AND archived_at IS NULL;
CREATE INDEX tool_definitions_category_idx ON tool_definitions(category_id) WHERE archived_at IS NULL;
CREATE INDEX tool_badge_assignments_badge_idx ON tool_badge_assignments(badge_id,tool_id);
CREATE INDEX tool_categories_order_idx ON tool_categories(display_order,name) WHERE archived_at IS NULL;
CREATE INDEX tool_badges_order_idx ON tool_badges(display_order,name) WHERE archived_at IS NULL;
