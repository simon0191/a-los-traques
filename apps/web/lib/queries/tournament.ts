// Shared SQL for tournament endpoints. The original Vercel handlers exported
// these constants for tests; keeping them in a lib/ module so the route files
// stay free of the Next.js Route-export restrictions.

export const SQL_CHECK_EXISTING_SESSION =
  'SELECT id, matches_played FROM active_sessions WHERE host_user_id = $1 AND status = $2';
export const SQL_UPDATE_SESSION_SIZE = 'UPDATE active_sessions SET size = $1 WHERE id = $2';
export const SQL_CHECK_COLLISION = 'SELECT 1 FROM active_sessions WHERE id = $1';
export const SQL_ABANDON_ORPHAN_SESSIONS =
  "UPDATE active_sessions SET status = 'abandoned' WHERE host_user_id = $1 AND status = 'open'";
export const SQL_INSERT_SESSION = `
  INSERT INTO active_sessions (id, host_user_id, status, size)
  VALUES ($1, $2, 'open', $3)
`;
export const SQL_JOIN_HOST = `
  INSERT INTO session_participants (session_id, user_id)
  VALUES ($1, $2)
  ON CONFLICT DO NOTHING
`;

export const SQL_INSERT_MATCH_LEDGER = `
  INSERT INTO tournament_matches (session_id, round_index, match_index, winner_id, loser_id)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (session_id, round_index, match_index) DO NOTHING
  RETURNING 1
`;

export const SQL_UPDATE_WINNER_STATS =
  'UPDATE profiles SET wins = wins + 1, updated_at = now() WHERE id = $1';
export const SQL_UPDATE_LOSER_STATS =
  'UPDATE profiles SET losses = losses + 1, updated_at = now() WHERE id = $1';
export const SQL_INCREMENT_MATCHES_PLAYED =
  'UPDATE active_sessions SET matches_played = matches_played + 1 WHERE id = $1';
export const SQL_CROWN_CHAMPION =
  'UPDATE profiles SET tournament_wins = tournament_wins + 1, updated_at = now() WHERE id = $1';
export const SQL_COMPLETE_SESSION = "UPDATE active_sessions SET status = 'completed' WHERE id = $1";
