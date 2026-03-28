## :x: E2E Multiplayer Test: FAILED
**deterministic fighters**

### Match
| | Value |
|---|---|
| Room | `DSGC` |
| P1 Fighter | simon |
| P2 Fighter | jeka |
| Stage | input |
| Seed | 42 |
| Speed | 2x |
| AI Difficulty | medium |
| Winner | **simon** |

### Determinism
| Peer | Final State Hash |
|---|---|
| P1 | `2048722145` |
| P2 | `-192686270` |

**Hashes do not match — simulation diverged.**

### Checksums
Shared frames compared: 78, mismatches: 0

### Stats
| Metric | P1 | P2 |
|---|---|---|
| Total frames | 2363 | 2369 |
| Rollbacks | 0 | 87 |
| Max rollback depth | 0 | 5 |
| Desyncs | 0 | 0 |
| Duration | 28.7s | 28.7s |

### Timeline
| Frame | Source | Event |
|---|---|---|
| 840 | P1 | ko — winner: P1 |
| 2160 | P1 | ko — winner: P1 |
