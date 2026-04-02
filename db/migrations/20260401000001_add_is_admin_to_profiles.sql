-- migrate:up
ALTER TABLE profiles ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;

-- migrate:down
ALTER TABLE profiles DROP COLUMN IF EXISTS is_admin;
