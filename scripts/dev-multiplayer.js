/**
 * Single-command orchestrator for local multiplayer development.
 *
 * Starts: PGLite (in-process) + fake auth + Vite + Vercel Dev + PartyKit
 * Usage:  bun run dev:mp
 *
 * Test accounts: p1@test.local / p2@test.local (password: password)
 */

import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { concurrently } from 'concurrently';

const JWT_SECRET = 'dev-jwt-secret-at-least-32-characters-long!!';

// 1. Set env vars — inherited by all child processes.
//    process.env takes precedence over .env files in both Vite and Vercel Dev.
process.env.VITE_SUPABASE_URL = 'http://localhost:54321';
process.env.VITE_SUPABASE_ANON_KEY = 'dev-anon-key';
process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
process.env.DATABASE_URL = 'postgres://127.0.0.1:5432/postgres';
if (process.platform === 'win32') {
  process.env.PG_FRESH_CLIENT = '1';
}

// 2. Start PGLite in-process
const db = await PGlite.create('.pglite');
const dbServer = new PGLiteSocketServer({ db, port: 5432, host: '127.0.0.1' });
await dbServer.start();
console.log('[db] PGLite running on localhost:5432');

// 3. Run migrations
const migrationsDir = path.resolve('db/migrations');
const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of migrationFiles) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
  // Extract the -- migrate:up section (everything before -- migrate:down)
  const upSection = sql.split('-- migrate:down')[0].replace('-- migrate:up', '').trim();
  try {
    await db.exec(upSection);
    console.log(`[db] Migration applied: ${file}`);
  } catch (e) {
    // Ignore "already exists" errors for idempotent re-runs
    if (e.message?.includes('already exists')) {
      console.log(`[db] Migration skipped (already applied): ${file}`);
    } else {
      throw e;
    }
  }
}

// 4. Run seed data
const seedFile = path.resolve('db/seed-dev.sql');
if (fs.existsSync(seedFile)) {
  await db.exec(fs.readFileSync(seedFile, 'utf-8'));
  console.log('[db] Seed data applied (DevP1, DevP2)');
}

// 5. Start remaining services
console.log('\n[dev:mp] Starting services...\n');

const { result } = concurrently(
  [
    { command: 'node scripts/dev-auth.js', name: 'auth', prefixColor: 'magenta' },
    { command: 'bunx vite', name: 'vite', prefixColor: 'green' },
    { command: 'bunx vercel dev --yes', name: 'api', prefixColor: 'yellow' },
    { command: 'bunx partykit dev', name: 'party', prefixColor: 'cyan' },
  ],
  {
    prefix: 'name',
    padPrefix: true,
    killOthers: ['failure'],
  },
);

result.catch((err) => {
  if (Array.isArray(err)) {
    console.error('\n[dev:mp] One or more services failed:');
    for (const fail of err) {
      if (fail.command) {
        console.error(`  - ${fail.command.name} (exit code ${fail.exitCode})`);
      }
    }
  } else {
    console.error('\n[dev:mp] Unexpected error:', err);
  }
  process.exit(1);
});
