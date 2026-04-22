import { storage } from '@alostraques/api-core/storage';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/auth/middleware';

export const GET = withAdmin(async (req: NextRequest) => {
  const params = req.nextUrl.searchParams;
  const fightId = params.get('fightId');
  const slot = params.get('slot');
  const round = params.get('round');

  if (!fightId || slot === null || round === null) {
    return NextResponse.json(
      { error: 'Missing required query params: fightId, slot, round' },
      { status: 400 },
    );
  }

  const content = await storage.downloadBundle(fightId, slot, round);
  if (!content) {
    return NextResponse.json({ error: 'Bundle not found' }, { status: 404 });
  }

  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="debug-${fightId}-p${slot}-r${round}.json"`,
    },
  });
});
