import { isUuid as isUuidLoose } from '@alostraques/api-core/validate';

// The JS validate module doesn't carry type-guard info — wrap with a typed
// guard so narrowing works throughout this route.
const isUuid = (v: unknown): v is string => isUuidLoose(v as string);

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import {
  SQL_COMPLETE_SESSION,
  SQL_CROWN_CHAMPION,
  SQL_INCREMENT_MATCHES_PLAYED,
  SQL_INSERT_MATCH_LEDGER,
  SQL_UPDATE_LOSER_STATS,
  SQL_UPDATE_WINNER_STATS,
} from '@/lib/queries/tournament';

type Body = {
  tourneyId?: string;
  winnerId?: string;
  loserId?: string;
  isFinal?: boolean;
  championId?: string;
  roundIndex?: number;
  matchIndex?: number;
};

export const POST = withAuth(async (req: NextRequest, { userId: hostUserId, db }) => {
  const body = (await req.json().catch(() => ({}))) as Body;
  const { tourneyId, winnerId, loserId, isFinal, championId, roundIndex, matchIndex } = body;

  if (!tourneyId) {
    return NextResponse.json({ error: 'Missing required field: tourneyId' }, { status: 400 });
  }
  if (roundIndex === undefined || matchIndex === undefined) {
    return NextResponse.json(
      { error: 'Missing required fields: roundIndex and matchIndex' },
      { status: 400 },
    );
  }
  if (winnerId && loserId && winnerId === loserId) {
    return NextResponse.json(
      { error: 'Winner and loser cannot be the same user' },
      { status: 400 },
    );
  }

  try {
    const tid = tourneyId.toLowerCase();

    const hostCheckRes = await db.query(
      'SELECT status, matches_played, size FROM active_sessions WHERE id = $1 AND host_user_id = $2',
      [tid, hostUserId],
    );

    if (hostCheckRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'Unauthorized: You are not the Host of this tournament' },
        { status: 403 },
      );
    }

    const { status, matches_played, size: bracketSize } = hostCheckRes.rows[0];

    if (status !== 'open') {
      return NextResponse.json({ status: 'ignored', reason: 'Session already completed' });
    }

    const maxMatches = Math.min(bracketSize - 1, 32);
    if (matches_played >= maxMatches) {
      return NextResponse.json({ status: 'ignored', reason: 'Max match limit reached' });
    }

    const checkIds = [winnerId, loserId, championId].filter(isUuid);
    let hasWinnerHandshake = false;
    let hasLoserHandshake = false;
    let hasChampionHandshake = false;

    if (checkIds.length > 0) {
      const handshakeCheckRes = await db.query(
        `SELECT user_id FROM session_participants WHERE session_id = $1`,
        [tid],
      );
      const participatingIds = handshakeCheckRes.rows.map((r: { user_id: string }) => r.user_id);
      hasWinnerHandshake = isUuid(winnerId) && participatingIds.includes(winnerId);
      hasLoserHandshake = isUuid(loserId) && participatingIds.includes(loserId);
      hasChampionHandshake = isUuid(championId) && participatingIds.includes(championId);
    }

    await db.query('BEGIN');

    const insertMatchRes = await db.query(SQL_INSERT_MATCH_LEDGER, [
      tid,
      roundIndex,
      matchIndex,
      isUuid(winnerId) ? winnerId : null,
      isUuid(loserId) ? loserId : null,
    ]);

    if (insertMatchRes.rows.length === 0) {
      await db.query('ROLLBACK');
      return NextResponse.json({ status: 'ignored', reason: 'Match already reported' });
    }

    if (hasWinnerHandshake) {
      await db.query(SQL_UPDATE_WINNER_STATS, [winnerId]);
    }
    if (hasLoserHandshake) {
      await db.query(SQL_UPDATE_LOSER_STATS, [loserId]);
    }
    await db.query(SQL_INCREMENT_MATCHES_PLAYED, [tid]);

    let prestigeAwarded = false;
    if (isFinal) {
      if (hasChampionHandshake) {
        await db.query(SQL_CROWN_CHAMPION, [championId]);
        prestigeAwarded = true;
      }
      await db.query(SQL_COMPLETE_SESSION, [tid]);
    }

    await db.query('COMMIT');

    return NextResponse.json({
      status: 'success',
      updated: { winner: hasWinnerHandshake, loser: hasLoserHandshake },
      completed: !!isFinal,
      prestigeAwarded,
    });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Error reporting tournament match result:', err);
    throw err;
  }
});
