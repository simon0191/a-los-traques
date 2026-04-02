import { withAuth } from './_lib/handler.js';

export default withAuth(async (req, res, { userId, db }) => {
  if (req.method === 'POST') {
    const { fightId, roomId, p1Fighter, p2Fighter, stageId } = req.body;

    if (!fightId || !roomId || !p1Fighter || !p2Fighter || !stageId) {
      return res.status(400).json({ error: 'Missing required fields: fightId, roomId, p1Fighter, p2Fighter, stageId' });
    }

    try {
      await db.query(
        `INSERT INTO fights (id, room_id, p1_user_id, p1_fighter, p2_fighter, stage_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [fightId, roomId, userId, p1Fighter, p2Fighter, stageId],
      );
      return res.status(201).json({ id: fightId });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Fight already exists' });
      }
      throw err;
    }
  }

  if (req.method === 'PATCH') {
    const { fightId, p2UserId, winnerSlot, roundsP1, roundsP2 } = req.body;

    if (!fightId) {
      return res.status(400).json({ error: 'Missing required field: fightId' });
    }

    // Build dynamic SET clause
    const sets = [];
    const values = [];
    let paramIndex = 1;

    if (p2UserId !== undefined) {
      sets.push(`p2_user_id = $${paramIndex++}`);
      values.push(p2UserId);
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
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(fightId);
    const result = await db.query(
      `UPDATE fights SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING id`,
      values,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fight not found' });
    }

    return res.status(200).json({ id: fightId });
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
