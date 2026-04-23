import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';

type CreateFightBody = {
  fightId?: string;
  roomId?: string;
  p1Fighter?: string;
  p2Fighter?: string;
  stageId?: string;
};

type PatchFightBody = {
  fightId?: string;
  registerP2?: boolean;
  winnerSlot?: number;
  roundsP1?: number;
  roundsP2?: number;
};

export const POST = withAuth(async (req: NextRequest, { userId, db }) => {
  const body = (await req.json().catch(() => ({}))) as CreateFightBody;
  const { fightId, roomId, p1Fighter, p2Fighter, stageId } = body;

  if (!fightId || !roomId || !p1Fighter || !p2Fighter || !stageId) {
    return NextResponse.json(
      { error: 'Missing required fields: fightId, roomId, p1Fighter, p2Fighter, stageId' },
      { status: 400 },
    );
  }

  try {
    await db.query(
      `INSERT INTO fights (id, room_id, p1_user_id, p1_fighter, p2_fighter, stage_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [fightId, roomId, userId, p1Fighter, p2Fighter, stageId],
    );
    return NextResponse.json({ id: fightId }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Fight already exists' }, { status: 409 });
    }
    throw err;
  }
});

export const PATCH = withAuth(async (req: NextRequest, { userId, db }) => {
  const body = (await req.json().catch(() => ({}))) as PatchFightBody;
  const { fightId, registerP2, winnerSlot, roundsP1, roundsP2 } = body;

  if (!fightId) {
    return NextResponse.json({ error: 'Missing required field: fightId' }, { status: 400 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (registerP2) {
    sets.push(`p2_user_id = $${paramIndex++}`);
    values.push(userId);
  }
  if (winnerSlot !== undefined) {
    sets.push(`winner_slot = $${paramIndex++}`);
    values.push(winnerSlot);
    sets.push(`ended_at = NOW()`);
  }
  if (roundsP1 !== undefined) {
    sets.push(`rounds_p1 = $${paramIndex++}`);
    values.push(roundsP1);
  }
  if (roundsP2 !== undefined) {
    sets.push(`rounds_p2 = $${paramIndex++}`);
    values.push(roundsP2);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  values.push(fightId);
  const result = await db.query(
    `UPDATE fights SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING id`,
    values,
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'Fight not found' }, { status: 404 });
  }
  return NextResponse.json({ id: fightId });
});
