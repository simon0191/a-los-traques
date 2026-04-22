import { BUNDLE_TTL_DAYS, storage } from '@alostraques/api-core/storage';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';

type UploadBody = {
  fightId?: string;
  slot?: number;
  round?: number;
  bundle?: unknown;
};

export const POST = withAuth(async (req: NextRequest, { db }) => {
  const body = (await req.json().catch(() => ({}))) as UploadBody;
  const { fightId, slot, round, bundle } = body;

  if (!fightId || slot === undefined || round === undefined || !bundle) {
    return NextResponse.json(
      { error: 'Missing required fields: fightId, slot, round, bundle' },
      { status: 400 },
    );
  }

  const fightResult = await db.query('SELECT id FROM fights WHERE id = $1', [fightId]);
  if (fightResult.rows.length === 0) {
    return NextResponse.json({ error: 'Fight not found' }, { status: 404 });
  }

  const jsonString = typeof bundle === 'string' ? bundle : JSON.stringify(bundle);
  await storage.uploadBundle(fightId, slot, round, jsonString);

  await db.query(
    `UPDATE fights
     SET has_debug_bundle = TRUE,
         debug_bundle_expires_at = COALESCE(debug_bundle_expires_at, NOW() + INTERVAL '${BUNDLE_TTL_DAYS} days')
     WHERE id = $1`,
    [fightId],
  );

  return NextResponse.json({ ok: true }, { status: 201 });
});
