#!/usr/bin/env node

/**
 * cli.js -- Blog backlog CLI for A Los Traques
 *
 * Subcommands: init, cursor, apply, get, update
 * All commands print JSON to stdout; logs go to stderr.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadBacklog, saveBacklog, emptyBacklog } from './backlog.js';
import { applyPlan } from './dedup.js';

const DEFAULT_FILE = path.resolve(process.cwd(), 'docs/blog-backlog.json');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function cmdInit(file) {
  try {
    await fs.access(file);
    process.stderr.write(`backlog: ${file} already exists, no-op\n`);
    return;
  } catch {}
  await fs.mkdir(path.dirname(file), { recursive: true });
  await saveBacklog(file, emptyBacklog());
  process.stderr.write(`backlog: initialised ${file}\n`);
}

async function cmdCursor(file) {
  const b = await loadBacklog(file);
  process.stdout.write(`${JSON.stringify(b.cursor)}\n`);
}

async function cmdApply(file, planPath) {
  const planRaw = await fs.readFile(planPath, 'utf-8');
  const plan = JSON.parse(planRaw);
  const backlog = await loadBacklog(file);
  const summary = applyPlan(backlog, plan, new Date().toISOString());
  await saveBacklog(file, backlog);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

async function cmdGet(file, id) {
  const backlog = await loadBacklog(file);
  const entry = backlog.entries.find((e) => e.id === id);
  if (!entry) {
    process.stderr.write(`backlog: entry "${id}" not found\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

async function cmdUpdate(file, id, flags) {
  const backlog = await loadBacklog(file);
  const entry = backlog.entries.find((e) => e.id === id);
  if (!entry) {
    process.stderr.write(`backlog: entry "${id}" not found\n`);
    process.exit(1);
  }
  if (flags.status !== undefined) entry.status = flags.status;
  if (flags.notes !== undefined) entry.notes = flags.notes;
  if (flags.draftPath !== undefined) entry.draftPath = flags.draftPath;
  await saveBacklog(file, backlog);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const file = path.resolve(flags.file ?? DEFAULT_FILE);

  switch (sub) {
    case 'init':
      return cmdInit(file);
    case 'cursor':
      return cmdCursor(file);
    case 'apply':
      if (!flags.plan) {
        process.stderr.write('apply: --plan PATH is required\n');
        process.exit(2);
      }
      return cmdApply(file, path.resolve(flags.plan));
    case 'get':
      return cmdGet(file, positional[0]);
    case 'update':
      return cmdUpdate(file, positional[0], flags);
    default:
      process.stderr.write('usage: cli.js {init|cursor|apply|get|update} [...]\n');
      process.exit(2);
  }
}

main().catch((err) => {
  process.stderr.write(`backlog: ${err.message}\n`);
  process.exit(1);
});
