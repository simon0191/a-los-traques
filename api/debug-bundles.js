import { withAuth } from './_lib/handler.js';
import { BUNDLE_TTL_DAYS, storage } from './_lib/storage.js';

export default withAuth(async (req, res, { userId, db }) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fightId, slot, round, bundle } = req.body;

  if (!fightId || slot === undefined || round === undefined || !bundle) {
    return res.status(400).json({
      error: 'Missing required fields: fightId, slot, round, bundle',
    });
  }

  // Validate fightId exists
  const fightResult = await db.query('SELECT id FROM fights WHERE id = $1', [fightId]);
  if (fightResult.rows.length === 0) {
    return res.status(404).json({ error: 'Fight not found' });
  }

  // Upload bundle to storage
  const jsonString = typeof bundle === 'string' ? bundle : JSON.stringify(bundle);
  await storage.uploadBundle(fightId, slot, round, jsonString);

  // Update fight record
  await db.query(
    `UPDATE fights
     SET has_debug_bundle = TRUE,
         debug_bundle_expires_at = COALESCE(debug_bundle_expires_at, NOW() + INTERVAL '${BUNDLE_TTL_DAYS} days')
     WHERE id = $1`,
    [fightId],
  );

  return res.status(201).json({ ok: true });
});
