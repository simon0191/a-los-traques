/**
 * Generate a reproducibility bundle from two fight logs.
 * Contains everything needed to replay and debug a fight.
 *
 * @param {object} logP1 - Fight log from P1
 * @param {object} logP2 - Fight log from P2
 * @param {{ p1: string, p2: string }} urls - URLs used for each player
 * @returns {object} Bundle object (caller should JSON.stringify)
 */
export function generateBundle(logP1, logP2, urls) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    config: {
      p1FighterId: logP1.fighterId,
      p2FighterId: logP2.fighterId,
      stageId: logP1.stageId,
      seed: logP1.config?.seed ?? null,
      speed: logP1.config?.speed ?? 1,
      aiDifficulty: logP1.config?.aiDifficulty ?? 'medium',
    },
    // Confirmed input pairs from P1's rollback system (both peers simulate identically)
    confirmedInputs: logP1.confirmedInputs || [],
    p1: extractPlayerData(logP1),
    p2: extractPlayerData(logP2),
    urls,
  };
}

function extractPlayerData(log) {
  return {
    playerSlot: log.playerSlot,
    inputs: log.inputs,
    checksums: log.checksums,
    roundEvents: log.roundEvents,
    networkEvents: log.networkEvents,
    finalState: log.finalState,
    finalStateHash: log.finalStateHash,
    totalFrames: log.totalFrames,
    rollbackCount: log.rollbackCount,
    maxRollbackFrames: log.maxRollbackFrames,
    desyncCount: log.desyncCount,
  };
}
