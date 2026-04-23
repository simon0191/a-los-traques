import type { PoolClient } from 'pg';

export function queryLeaderboard(db: PoolClient) {
  return db.query(`
    SELECT
      id,
      COALESCE(nickname, 'Anónimo') AS nickname,
      wins,
      losses,
      COALESCE(tournament_wins, 0) as tournament_wins,
      ROUND(wins::numeric / NULLIF(wins + losses, 0) * 100) AS win_rate
    FROM profiles
    WHERE wins > 0 OR tournament_wins > 0
    ORDER BY
      tournament_wins DESC,
      wins DESC,
      (wins::numeric / NULLIF(wins + losses, 0)) DESC NULLS LAST
    LIMIT 10;
  `);
}
