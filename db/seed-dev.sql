-- Dev seed data: test profiles for local multiplayer testing (bun run dev:mp)
-- UUIDs match the pre-seeded users in scripts/dev-auth.js
INSERT INTO profiles (id, nickname, wins, losses, is_admin) VALUES
  ('11111111-0000-0000-0000-000000000001', 'DevP1', 0, 0, true),
  ('22222222-0000-0000-0000-000000000002', 'DevP2', 0, 0, false)
ON CONFLICT (id) DO NOTHING;
