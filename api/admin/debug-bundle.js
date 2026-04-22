import { storage } from '@alostraques/api-core/storage';
import { withAdmin } from '../_lib/handler.js';

export default withAdmin(async (req, res, { userId, db }) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fightId, slot, round } = req.query || {};

  if (!fightId || slot === undefined || round === undefined) {
    return res.status(400).json({ error: 'Missing required query params: fightId, slot, round' });
  }

  const content = await storage.downloadBundle(fightId, slot, round);
  if (!content) {
    return res.status(404).json({ error: 'Bundle not found' });
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="debug-${fightId}-p${slot}-r${round}.json"`,
  );
  return res.status(200).send(content);
});
