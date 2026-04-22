import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';

export const POST = withAuth(
  async (req: NextRequest, { userId, db }) => {
    const body = await req.json().catch(() => ({}));
    const isWin = Boolean((body as { isWin?: boolean }).isWin);
    const col = isWin ? 'wins' : 'losses';
    const result = await db.query(
      `UPDATE profiles
       SET ${col} = ${col} + 1, updated_at = now()
       WHERE id = $1
       RETURNING wins, losses;`,
      [userId],
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  },
  { maxRetries: 0 },
);
