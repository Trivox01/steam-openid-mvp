ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_status_check;
ALTER TABLE users ADD CONSTRAINT users_account_status_check
  CHECK (account_status IN ('active', 'suspended', 'disabled'));

INSERT INTO permissions (id, key, description, category)
VALUES (
  'permission-users-change-status',
  'users.change_status',
  'users change status',
  'users'
);

INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('role-owner', 'permission-users-change-status'),
  ('role-administrator', 'permission-users-change-status');
