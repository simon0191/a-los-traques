// Admin-app Next.js Route Handler adapter. Same auth core as apps/web, but
// wrapped separately because the two apps deploy independently and the admin
// one should stay deletable/replaceable without touching the player API.
import { AuthError, resolveUserId } from '@alostraques/api-core';
import { createClient, getPool } from '@alostraques/db';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';

export type DbHandle = PoolClient;

export type AuthContext = {
  userId: string;
  db: DbHandle;
};

export type AuthedHandler = (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: unknown,
) => Promise<Response> | Response;

export type AuthOptions = {
  maxRetries?: number;
  retryDelay?: number;
};

async function acquireConnection({
  maxRetries,
  retryDelay,
  useFreshClient,
}: {
  maxRetries: number;
  retryDelay: number;
  useFreshClient: boolean;
}): Promise<{ db: DbHandle; cleanup: () => Promise<void> }> {
  let attempts = 0;
  let lastErr: unknown;
  while (attempts <= maxRetries) {
    try {
      if (useFreshClient) {
        const client = createClient();
        await client.connect();
        return {
          db: client as unknown as DbHandle,
          cleanup: async () => {
            await (client as unknown as { end: () => Promise<void> }).end().catch(() => {});
          },
        };
      }
      const pool = getPool();
      const leased = await pool.connect();
      return {
        db: leased,
        cleanup: async () => {
          leased.release();
        },
      };
    } catch (err) {
      lastErr = err;
      attempts++;
      if (attempts > maxRetries) break;
      await new Promise((r) => setTimeout(r, retryDelay));
    }
  }
  throw lastErr;
}

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export function withAuth(handler: AuthedHandler, options: AuthOptions = {}) {
  const { maxRetries = 3, retryDelay = 1000 } = options;

  return async (req: NextRequest, routeCtx?: unknown): Promise<Response> => {
    const isProd = process.env.NODE_ENV === 'production';
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    const projectId = process.env.SUPABASE_PROJECT_ID;

    let userId: string;
    try {
      userId = (await resolveUserId({
        authHeader: req.headers.get('authorization') ?? undefined,
        devUserId: req.headers.get('x-dev-user-id') ?? undefined,
        isProd,
        jwtSecret,
        projectId,
      })) as string;
    } catch (err) {
      if (err instanceof AuthError) {
        const body: Record<string, unknown> = { error: err.message };
        if (err.cause && err.cause instanceof Error) body.message = err.cause.message;
        return NextResponse.json(body, { status: err.status });
      }
      throw err;
    }

    const useFreshClient = process.env.PG_FRESH_CLIENT === '1';
    let lease: Awaited<ReturnType<typeof acquireConnection>> | undefined;
    try {
      lease = await acquireConnection({ maxRetries, retryDelay, useFreshClient });
    } catch (err) {
      const body: Record<string, unknown> = {
        error: 'Internal Server Error: Database connection failed',
      };
      if (!isProd && err instanceof Error) body.details = err.message;
      return NextResponse.json(body, { status: 500 });
    }

    try {
      return await handler(req, { userId, db: lease.db }, routeCtx);
    } catch (err) {
      console.error('Admin Route Error:', err);
      const body: Record<string, unknown> = { error: 'Internal Server Error' };
      if (!isProd && err instanceof Error) body.message = err.message;
      return NextResponse.json(body, { status: 500 });
    } finally {
      await lease.cleanup();
    }
  };
}

export function withAdmin(handler: AuthedHandler, options: AuthOptions = {}) {
  return withAuth(async (req, ctx, routeCtx) => {
    const res = await ctx.db.query('SELECT is_admin FROM profiles WHERE id = $1', [ctx.userId]);
    if (res.rows.length === 0 || !res.rows[0].is_admin) {
      return jsonError(403, 'Forbidden: Admin access required');
    }
    return handler(req, ctx, routeCtx);
  }, options);
}
