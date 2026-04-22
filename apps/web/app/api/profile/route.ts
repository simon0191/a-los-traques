import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';

export const GET = withAuth(
  async (_req, { userId, db }) => {
    const result = await db.query(
      'SELECT id, nickname, wins, losses, tournament_wins FROM profiles WHERE id = $1',
      [userId],
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  },
  { maxRetries: 0 },
);

export const POST = withAuth(
  async (req: NextRequest, { userId, db }) => {
    const body = await req.json().catch(() => ({}));
    const nickname = (body as { nickname?: string }).nickname;
    const result = await db.query(
      `INSERT INTO profiles (id, nickname)
       VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING
       RETURNING *;`,
      [userId, nickname || `user-${userId.slice(0, 4)}`],
    );
    if (result.rows.length === 0) {
      const current = await db.query('SELECT * FROM profiles WHERE id = $1', [userId]);
      return NextResponse.json(current.rows[0]);
    }
    return NextResponse.json(result.rows[0], { status: 201 });
  },
  { maxRetries: 0 },
);
