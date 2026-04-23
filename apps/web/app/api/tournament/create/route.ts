import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import {
  SQL_ABANDON_ORPHAN_SESSIONS,
  SQL_CHECK_COLLISION,
  SQL_CHECK_EXISTING_SESSION,
  SQL_INSERT_SESSION,
  SQL_JOIN_HOST,
  SQL_UPDATE_SESSION_SIZE,
} from '@/lib/queries/tournament';

type Body = { size?: number | string; allowUpdate?: boolean };

export const POST = withAuth(async (req: NextRequest, { userId, db }) => {
  const body = (await req.json().catch(() => ({}))) as Body;
  const bracketSize = Number.parseInt(String(body.size ?? ''), 10) || 8;
  const allowUpdate = Boolean(body.allowUpdate);

  try {
    if (allowUpdate) {
      const existingRes = await db.query(SQL_CHECK_EXISTING_SESSION, [userId, 'open']);
      if (existingRes.rows.length > 0) {
        const tourneyId = existingRes.rows[0].id;
        const matchesPlayed = Number.parseInt(existingRes.rows[0].matches_played, 10) || 0;

        if (matchesPlayed > 0) {
          return NextResponse.json(
            { error: 'Cannot update tournament size after matches have started' },
            { status: 403 },
          );
        }

        await db.query(SQL_UPDATE_SESSION_SIZE, [bracketSize, tourneyId]);
        return NextResponse.json({ tourneyId });
      }
    }

    let tourneyId: string | undefined;
    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      tourneyId = crypto.randomBytes(3).toString('hex').toLowerCase();
      const collisionCheck = await db.query(SQL_CHECK_COLLISION, [tourneyId]);
      if (collisionCheck.rows.length === 0) break;
      attempts++;
      if (attempts === maxAttempts) {
        return NextResponse.json(
          { error: 'Failed to generate unique tournament ID' },
          { status: 500 },
        );
      }
    }

    await db.query(SQL_ABANDON_ORPHAN_SESSIONS, [userId]);
    await db.query(SQL_INSERT_SESSION, [tourneyId, userId, bracketSize]);
    await db.query(SQL_JOIN_HOST, [tourneyId, userId]);

    return NextResponse.json({ tourneyId }, { status: 201 });
  } catch (err) {
    console.error('Error creating tournament session:', err);
    throw err;
  }
});
