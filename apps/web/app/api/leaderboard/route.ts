import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { queryLeaderboard } from '@/lib/queries/leaderboard';

export const GET = withAuth(async (_req, { db }) => {
  const result = await queryLeaderboard(db);
  return NextResponse.json(result.rows);
});
