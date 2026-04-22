import path from 'node:path';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadOverlayJson, saveOverlayJson } from '@/lib/overlay-export';

// Admin runs out of `apps/admin/`, so the repo root is two levels up.
const REPO_ROOT = path.resolve(process.cwd(), '..', '..');

export async function GET(req: NextRequest) {
  const relPath = req.nextUrl.searchParams.get('path');
  if (!relPath) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }
  try {
    const result = await loadOverlayJson(relPath, { repoRoot: REPO_ROOT });
    if (typeof result.body === 'string') {
      return new Response(result.body, {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return NextResponse.json({ error: String((err as Error).message ?? err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  try {
    const result = await saveOverlayJson(body as { path?: unknown; json?: unknown }, {
      repoRoot: REPO_ROOT,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, path: result.path });
  } catch (err) {
    return NextResponse.json({ error: String((err as Error).message ?? err) }, { status: 500 });
  }
}
