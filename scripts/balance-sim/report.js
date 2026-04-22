/**
 * Report generator — produces JSON and markdown balance reports
 * from simulation matrix results.
 */

import fightersData from '../../apps/game-vite/src/data/fighters.json' with { type: 'json' };

const TIER_THRESHOLDS = [
  { tier: 'S', min: 0.57 },
  { tier: 'A', min: 0.53 },
  { tier: 'B', min: 0.47 },
  { tier: 'C', min: 0.43 },
  { tier: 'D', min: 0 },
];

/**
 * Assign tier based on overall win rate.
 */
function getTier(winRate) {
  for (const { tier, min } of TIER_THRESHOLDS) {
    if (winRate >= min) return tier;
  }
  return 'D';
}

/**
 * Build a tier list from fighter stats.
 */
function buildTierList(fighters) {
  const tiers = { S: [], A: [], B: [], C: [], D: [] };
  const sorted = Object.entries(fighters).sort((a, b) => b[1].winRate - a[1].winRate);
  for (const [id, stats] of sorted) {
    const tier = getTier(stats.winRate);
    tiers[tier].push({ id, name: stats.name, winRate: stats.winRate });
  }
  return tiers;
}

/**
 * Find matchups with extreme win rates.
 */
function findOutliers(matrix, threshold = 0.7) {
  const outliers = [];
  const fighterIds = Object.keys(matrix);
  for (const p1Id of fighterIds) {
    for (const p2Id of fighterIds) {
      if (p1Id === p2Id) continue;
      const m = matrix[p1Id][p2Id];
      if (m.p1WinRate >= threshold) {
        outliers.push({
          p1Id,
          p2Id,
          p1Name: fightersData.find((f) => f.id === p1Id)?.name || p1Id,
          p2Name: fightersData.find((f) => f.id === p2Id)?.name || p2Id,
          winRate: m.p1WinRate,
        });
      }
    }
  }
  return outliers.sort((a, b) => b.winRate - a.winRate);
}

/**
 * Generate the full JSON report.
 */
export function generateJsonReport({ matrix, fighters, meta }) {
  const tierList = buildTierList(fighters);
  return { meta, matrix, fighters, tierList };
}

/**
 * Generate a human-readable markdown report.
 */
export function generateMarkdownReport({ matrix, fighters, meta }) {
  const tierList = buildTierList(fighters);
  const outliers = findOutliers(matrix);
  const fighterIds = Object.keys(matrix);
  const lines = [];

  lines.push('# Balance Report');
  lines.push('');
  lines.push(`- **Date**: ${meta.timestamp}`);
  lines.push(`- **Fights per matchup**: ${meta.fightsPerMatchup}`);
  lines.push(`- **AI difficulty**: ${meta.difficulty}`);
  lines.push(`- **Total fights**: ${meta.totalFights.toLocaleString()}`);
  lines.push('');

  // Tier list
  lines.push('## Tier List');
  lines.push('');
  const tierLabels = {
    S: 'S (>57%)',
    A: 'A (53-57%)',
    B: 'B (47-53%)',
    C: 'C (43-47%)',
    D: 'D (<43%)',
  };
  for (const [tier, label] of Object.entries(tierLabels)) {
    const members = tierList[tier];
    if (members.length === 0) continue;
    const names = members.map((m) => `${m.name} (${pct(m.winRate)})`).join(', ');
    lines.push(`- **${label}**: ${names}`);
  }
  lines.push('');

  // Per-fighter stats table
  lines.push('## Fighter Stats');
  lines.push('');
  lines.push('| Fighter | Win Rate | Avg Dmg | Avg Hits | Avg Specials | KO Rate |');
  lines.push('|---------|----------|---------|----------|--------------|---------|');
  const sorted = Object.entries(fighters).sort((a, b) => b[1].winRate - a[1].winRate);
  for (const [, stats] of sorted) {
    lines.push(
      `| ${stats.name} | ${pct(stats.winRate)} | ${stats.avgDamagePerMatch.toFixed(1)} | ${stats.avgHitsPerMatch.toFixed(1)} | ${stats.avgSpecialsPerMatch.toFixed(1)} | ${pct(stats.koWinRate)} |`,
    );
  }
  lines.push('');

  // Win rate heatmap
  lines.push('## Matchup Matrix (P1 win rate)');
  lines.push('');
  const names = fighterIds.map((id) => fightersData.find((f) => f.id === id)?.name || id);
  const shortNames = names.map((n) => n.slice(0, 4));
  lines.push(`| | ${shortNames.join(' | ')} |`);
  lines.push(`|---|${shortNames.map(() => '---').join('|')}|`);
  for (let i = 0; i < fighterIds.length; i++) {
    const cells = fighterIds.map((p2Id) => {
      if (fighterIds[i] === p2Id) return ' -- ';
      const wr = matrix[fighterIds[i]][p2Id].p1WinRate;
      return pct(wr);
    });
    lines.push(`| ${shortNames[i]} | ${cells.join(' | ')} |`);
  }
  lines.push('');

  // Outliers
  if (outliers.length > 0) {
    lines.push('## Outlier Matchups (>70% win rate)');
    lines.push('');
    lines.push('| Winner | Loser | Win Rate |');
    lines.push('|--------|-------|----------|');
    for (const o of outliers) {
      lines.push(`| ${o.p1Name} | ${o.p2Name} | ${pct(o.winRate)} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}
