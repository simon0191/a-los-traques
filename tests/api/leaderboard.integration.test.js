import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The exact query from api/leaderboard.js
const LEADERBOARD_QUERY = `
  SELECT
    COALESCE(nickname, 'Anónimo') AS nickname,
    wins,
    losses,
    ROUND(wins::numeric / (wins + losses) * 100) AS win_rate
  FROM profiles
  WHERE wins > 0
  ORDER BY
    wins DESC,
    (wins::numeric / (wins + losses)) DESC
  LIMIT 10;
`;

function uuid(n) {
  return `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
}

describe('Leaderboard SQL (integration)', () => {
  let db;

  beforeAll(async () => {
    db = await PGlite.create();

    // Run migrations in order
    const migrationsDir = path.resolve('db/migrations');
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      const upSection = sql.split('-- migrate:down')[0].replace('-- migrate:up', '').trim();
      await db.exec(upSection);
    }
  });

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    await db.exec('DELETE FROM profiles');
  });

  it('orders by wins DESC, then win rate DESC as tiebreaker', async () => {
    // Two players with same wins but different win rates
    await db.exec(`
      INSERT INTO profiles (id, nickname, wins, losses) VALUES
        ('${uuid(1)}', 'high_rate', 10, 2),
        ('${uuid(2)}', 'low_rate',  10, 8);
    `);

    const result = await db.query(LEADERBOARD_QUERY);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].nickname).toBe('high_rate');
    expect(result.rows[1].nickname).toBe('low_rate');
  });

  it('returns Anónimo for null nicknames via COALESCE', async () => {
    await db.exec(`
      INSERT INTO profiles (id, nickname, wins, losses) VALUES
        ('${uuid(1)}', NULL, 5, 3);
    `);

    const result = await db.query(LEADERBOARD_QUERY);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].nickname).toBe('Anónimo');
  });

  it('excludes players with 0 wins', async () => {
    await db.exec(`
      INSERT INTO profiles (id, nickname, wins, losses) VALUES
        ('${uuid(1)}', 'winner',   5, 2),
        ('${uuid(2)}', 'newbie',   0, 0),
        ('${uuid(3)}', 'loser',    0, 10);
    `);

    const result = await db.query(LEADERBOARD_QUERY);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].nickname).toBe('winner');
  });

  it('limits results to 10 rows', async () => {
    const inserts = Array.from({ length: 15 }, (_, i) => {
      const id = uuid(i + 1);
      return `('${id}', 'player_${i + 1}', ${15 - i}, 1)`;
    });
    await db.exec(`INSERT INTO profiles (id, nickname, wins, losses) VALUES ${inserts.join(',')};`);

    const result = await db.query(LEADERBOARD_QUERY);

    expect(result.rows).toHaveLength(10);
  });

  it('calculates win_rate correctly without division by zero', async () => {
    await db.exec(`
      INSERT INTO profiles (id, nickname, wins, losses) VALUES
        ('${uuid(1)}', 'perfect', 10, 0),
        ('${uuid(2)}', 'mixed',    7, 3);
    `);

    const result = await db.query(LEADERBOARD_QUERY);

    expect(result.rows).toHaveLength(2);
    // 10 / (10+0) * 100 = 100
    expect(Number(result.rows[0].win_rate)).toBe(100);
    // 7 / (7+3) * 100 = 70
    expect(Number(result.rows[1].win_rate)).toBe(70);
  });

  it('returns empty array when no players have wins', async () => {
    await db.exec(`
      INSERT INTO profiles (id, nickname, wins, losses) VALUES
        ('${uuid(1)}', 'newbie1', 0, 0),
        ('${uuid(2)}', 'newbie2', 0, 5);
    `);

    const result = await db.query(LEADERBOARD_QUERY);

    expect(result.rows).toHaveLength(0);
  });
});
