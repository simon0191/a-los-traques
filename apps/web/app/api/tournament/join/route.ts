import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';

type Body = { tourneyId?: string };

export const POST = withAuth(async (req: NextRequest, { userId, db }) => {
  const body = (await req.json().catch(() => ({}))) as Body;
  const tourneyId = body.tourneyId;
  if (!tourneyId) {
    return NextResponse.json({ error: 'Missing tourneyId' }, { status: 400 });
  }

  try {
    const sessionRes = await db.query('SELECT status FROM active_sessions WHERE id = $1', [
      tourneyId.toLowerCase(),
    ]);

    if (sessionRes.rows.length === 0) {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }
    if (sessionRes.rows[0].status !== 'open') {
      return NextResponse.json({ error: 'Tournament is already completed' }, { status: 403 });
    }

    await db.query(
      `INSERT INTO session_participants (session_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [tourneyId.toLowerCase(), userId],
    );
    return NextResponse.json({ status: 'joined', tourneyId: tourneyId.toLowerCase() });
  } catch (err) {
    console.error('Error joining tournament session:', err);
    throw err;
  }
});
