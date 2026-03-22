/**
 * Generate a markdown report from two fight logs.
 * @param {object} logP1 - Fight log from P1
 * @param {object} logP2 - Fight log from P2
 * @param {string} testName - Name of the test
 * @returns {string} Markdown report
 */
export function generateReport(logP1, logP2, testName) {
  const hashMatch = logP1.finalStateHash === logP2.finalStateHash;
  const passed = hashMatch && logP1.desyncCount === 0 && logP2.desyncCount === 0;
  const status = passed ? 'PASSED' : 'FAILED';
  const icon = passed ? ':white_check_mark:' : ':x:';

  const lines = [];
  lines.push(`## ${icon} E2E Multiplayer Test: ${status}`);
  lines.push(`**${testName}**\n`);

  // Match metadata
  lines.push('### Match');
  lines.push(`| | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Room | \`${logP1.roomId}\` |`);
  lines.push(`| P1 Fighter | ${logP1.fighterId} |`);
  lines.push(`| P2 Fighter | ${logP2.fighterId} |`);
  lines.push(`| Stage | ${logP1.stageId || 'random'} |`);
  if (logP1.config?.seed != null) lines.push(`| Seed | ${logP1.config.seed} |`);
  if (logP1.config?.speed > 1) lines.push(`| Speed | ${logP1.config.speed}x |`);
  if (logP1.config?.aiDifficulty) lines.push(`| AI Difficulty | ${logP1.config.aiDifficulty} |`);
  const winner = logP1.result?.winnerId || logP2.result?.winnerId;
  if (winner) lines.push(`| Winner | **${winner}** |`);
  lines.push('');

  // Determinism verdict
  lines.push('### Determinism');
  if (hashMatch) {
    lines.push(`Final state hash: \`${logP1.finalStateHash}\` — **match**`);
  } else {
    lines.push(`| Peer | Final State Hash |`);
    lines.push(`|---|---|`);
    lines.push(`| P1 | \`${logP1.finalStateHash}\` |`);
    lines.push(`| P2 | \`${logP2.finalStateHash}\` |`);
    lines.push(`\n**Hashes do not match — simulation diverged.**`);
  }
  lines.push('');

  // Checksum comparison
  const p1Checksums = new Map(logP1.checksums.map((c) => [c.frame, c.hash]));
  const p2Checksums = new Map(logP2.checksums.map((c) => [c.frame, c.hash]));
  let sharedCount = 0;
  let mismatchCount = 0;
  let firstDivergence = null;
  for (const [frame, hash] of p1Checksums) {
    if (p2Checksums.has(frame)) {
      sharedCount++;
      if (p2Checksums.get(frame) !== hash && !firstDivergence) {
        mismatchCount++;
        firstDivergence = { frame, p1Hash: hash, p2Hash: p2Checksums.get(frame) };
      } else if (p2Checksums.get(frame) !== hash) {
        mismatchCount++;
      }
    }
  }

  lines.push('### Checksums');
  lines.push(`Shared frames compared: ${sharedCount}, mismatches: ${mismatchCount}`);
  if (firstDivergence) {
    lines.push(`\n**First divergence at frame ${firstDivergence.frame}:**`);
    lines.push(`- P1: \`${firstDivergence.p1Hash}\``);
    lines.push(`- P2: \`${firstDivergence.p2Hash}\``);
  }
  lines.push('');

  // Stats table
  lines.push('### Stats');
  lines.push(`| Metric | P1 | P2 |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Total frames | ${logP1.totalFrames} | ${logP2.totalFrames} |`);
  lines.push(`| Rollbacks | ${logP1.rollbackCount} | ${logP2.rollbackCount} |`);
  lines.push(`| Max rollback depth | ${logP1.maxRollbackFrames} | ${logP2.maxRollbackFrames} |`);
  lines.push(`| Desyncs | ${logP1.desyncCount} | ${logP2.desyncCount} |`);
  const p1Duration = logP1.completedAt
    ? `${((logP1.completedAt - logP1.startedAt) / 1000).toFixed(1)}s`
    : 'N/A';
  const p2Duration = logP2.completedAt
    ? `${((logP2.completedAt - logP2.startedAt) / 1000).toFixed(1)}s`
    : 'N/A';
  lines.push(`| Duration | ${p1Duration} | ${p2Duration} |`);
  lines.push('');

  // Event timeline
  const events = [];
  for (const e of logP1.roundEvents || []) {
    events.push({
      frame: e.frame,
      source: 'P1',
      desc: `${e.type} — winner: P${e.winnerIndex + 1}`,
    });
  }
  for (const e of logP2.roundEvents || []) {
    events.push({
      frame: e.frame,
      source: 'P2',
      desc: `${e.type} — winner: P${e.winnerIndex + 1}`,
    });
  }
  for (const e of logP1.networkEvents || []) {
    if (e.type === 'desync') {
      events.push({
        frame: e.frame,
        source: 'P1',
        desc: `desync (local: \`${e.localHash}\`, remote: \`${e.remoteHash}\`)`,
      });
    }
  }
  for (const e of logP2.networkEvents || []) {
    if (e.type === 'desync') {
      events.push({
        frame: e.frame,
        source: 'P2',
        desc: `desync (local: \`${e.localHash}\`, remote: \`${e.remoteHash}\`)`,
      });
    }
  }
  events.sort((a, b) => a.frame - b.frame);

  if (events.length > 0) {
    lines.push('### Timeline');
    lines.push(`| Frame | Source | Event |`);
    lines.push(`|---|---|---|`);
    for (const e of events) {
      lines.push(`| ${e.frame} | ${e.source} | ${e.desc} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
