#!/usr/bin/env bun
/**
 * Fighter Balance Simulation CLI
 *
 * Usage:
 *   bun run balance                            # Full matrix, 100 fights/matchup
 *   bun run balance -- --fights=50             # Fewer fights (faster)
 *   bun run balance -- --difficulty=medium      # Different AI level
 *   bun run balance -- --p1=simon --p2=jeka    # Single matchup deep-dive
 *   bun run balance -- --output=./my-report    # Custom output path
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runFullMatrix, runMatchup } from './match-runner.js';
import { generateJsonReport, generateMarkdownReport } from './report.js';

function parseArgs(argv) {
  const args = {
    fights: 100,
    difficulty: 'hard',
    p1: null,
    p2: null,
    output: './balance-report',
  };

  for (const arg of argv.slice(2)) {
    const [key, val] = arg.replace(/^--/, '').split('=');
    switch (key) {
      case 'fights':
        args.fights = Number.parseInt(val, 10);
        break;
      case 'difficulty':
        args.difficulty = val;
        break;
      case 'p1':
        args.p1 = val;
        break;
      case 'p2':
        args.p2 = val;
        break;
      case 'output':
        args.output = val;
        break;
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv);

  // Single matchup mode
  if (args.p1 && args.p2) {
    console.log(`Running ${args.fights} fights: ${args.p1} vs ${args.p2} (${args.difficulty})`);
    const start = performance.now();
    const result = runMatchup(args.p1, args.p2, args.fights, args.difficulty);
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);

    console.log(`\nResults (${elapsed}s):`);
    console.log(
      `  ${args.p1} wins: ${result.p1Wins}/${result.totalFights} (${(result.p1WinRate * 100).toFixed(1)}%)`,
    );
    console.log(
      `  ${args.p2} wins: ${result.p2Wins}/${result.totalFights} (${((1 - result.p1WinRate) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Avg damage: ${args.p1}=${result.avgP1DamageDealt.toFixed(1)}, ${args.p2}=${result.avgP2DamageDealt.toFixed(1)}`,
    );
    console.log(`  Avg fight duration: ${result.avgTotalFrames.toFixed(0)} frames`);
    return;
  }

  // Full matrix mode
  console.log(
    `Running full balance simulation: ${args.fights} fights/matchup, ${args.difficulty} difficulty`,
  );
  console.log(`Total fights: ${(16 * 16 * args.fights).toLocaleString()}`);
  console.log('');

  const start = performance.now();
  let lastPct = -1;

  const data = runFullMatrix({
    fightsPerMatchup: args.fights,
    difficulty: args.difficulty,
    onProgress: (completed, total) => {
      const pct = Math.floor((completed / total) * 100);
      if (pct > lastPct) {
        lastPct = pct;
        process.stderr.write(`\rProgress: ${pct}% (${completed}/${total} matchups)`);
      }
    },
  });

  const elapsed = ((performance.now() - start) / 1000).toFixed(2);
  process.stderr.write(`\rProgress: 100% — done in ${elapsed}s\n`);

  // Generate reports
  const jsonReport = generateJsonReport(data);
  const mdReport = generateMarkdownReport(data);

  const jsonPath = resolve(`${args.output}.json`);
  const mdPath = resolve(`${args.output}.md`);

  writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
  writeFileSync(mdPath, mdReport);

  console.log(`\nReports written:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  Markdown: ${mdPath}`);

  // Print summary
  console.log(`\nTier List:`);
  for (const [tier, members] of Object.entries(jsonReport.tierList)) {
    if (members.length === 0) continue;
    const names = members.map((m) => `${m.name} (${(m.winRate * 100).toFixed(1)}%)`).join(', ');
    console.log(`  ${tier}: ${names}`);
  }
}

main();
