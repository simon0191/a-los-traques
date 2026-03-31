# Skill: Analyze Multiplayer Debug Bundle

Analyze a v2 debug bundle from a real multiplayer match. Extracts telemetry, detects rollback asymmetry, desync, resync behavior, frame drift, and KO divergence. Reports findings with concrete numbers and a health assessment.

## Usage

`/analyze-debug-bundle <path>` — e.g., `/analyze-debug-bundle debug-round-1.json`

Accepts a single `.json` file (v2 debug bundle produced by DebugBundleExporter via `?debug=1` or the "Exportar Todo" button).

## Bundle Structure

```
{
  version: 2,
  source: "debug",
  local: {                              // Collecting peer's data
    config: { p1FighterId, p2FighterId, stageId },
    confirmedInputs: [{ frame, p1, p2 }],
    p1: {                               // FightRecorder data
      playerSlot, inputs, checksums, roundEvents, networkEvents,
      finalState, finalStateHash, totalFrames,
      rollbackCount, maxRollbackFrames, desyncCount
    },
    p2: null,                           // Only populated for spectators
    diagnostics: {
      telemetry: {                      // MatchTelemetry — the authoritative stats
        matchId, matchDurationMs, transportMode, transportChanges,
        rollbackCount, maxRollbackDepth, desyncCount, resyncCount,
        rttSamples: [], rttMin, rttMax, rttAvg,
        disconnectionCount, reconnectionCount
      },
      logBuffer: [],                    // Logger ring buffer (256 entries max)
      matchState: { transitions, finalState },
      environment: { ... }
    }
  },
  remote: { ... }                       // Opponent's data (same structure)
}
```

**Important**: `diagnostics.telemetry` is the authoritative source for stats (rollbackCount, desyncCount, resyncCount). The `p1` FightRecorder data may differ — it records from that peer's local perspective only.

## Analysis Steps

### Step 1: Extract Key Metrics

Use a Python script to extract data from both peers. Always read from `diagnostics.telemetry` for stats.

```python
python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
for peer in ['local', 'remote']:
    p = d[peer]
    t = p['diagnostics']['telemetry']
    rec = p['p1']  # FightRecorder data
    print(f'=== {peer} ({p[\"sessionId\"]}) ===')
    print(f'  Fighter: {p[\"config\"][\"p1FighterId\"]} vs {p[\"config\"][\"p2FighterId\"]}')
    print(f'  Telemetry:')
    for k in ['rollbackCount','maxRollbackDepth','desyncCount','resyncCount',
              'rttAvg','rttMin','rttMax','transportMode','disconnectionCount']:
        print(f'    {k}: {t.get(k, \"N/A\")}')
    print(f'  RTT samples: {t.get(\"rttSamples\", [])}')
    print(f'  FightRecorder:')
    print(f'    totalFrames: {rec[\"totalFrames\"]}')
    print(f'    roundEvents: {rec[\"roundEvents\"]}')
    print(f'    networkEvents (count): {len(rec[\"networkEvents\"])}')
    print(f'  Confirmed inputs: {len(p[\"confirmedInputs\"])} entries')
    print()
" <path>
```

### Step 2: Build Summary Table

Present a comparison table:

| Metric | P1 (local) | P2 (remote) | Assessment |
|--------|-----------|-------------|------------|
| rollbackCount | | | Symmetric? (>10x ratio is bad) |
| maxRollbackDepth | | | Within maxRollbackFrames? |
| desyncCount | | | >0 means divergence detected |
| resyncCount | | | >0 means recovery happened |
| totalFrames | | | Drift = difference |
| RTT avg/max | | | Asymmetric? Spikes? |
| transportMode | | | websocket = relay (slower) |
| KO frames | | | Match? Same winner? |

### Step 3: Diagnose Issues

Check each of these in order:

#### 3a. RTT Measurement
- **rttSamples empty** → ConnectionMonitor not started (see RFC 0006). Check NetworkFacade `onSocketOpen` callback.
- **Highly asymmetric** (>3x ratio) → one peer on bad network. Rollback asymmetry is expected.
- **Spikes >200ms** → jitter causing deep rollbacks. Check if maxRollbackDepth is near the prune boundary.

#### 3b. Rollback Health
- **Both peers rollback** → healthy. The system is correcting predictions.
- **One peer 0, other >100** → one-directional rollback (RFC 0006 bug). Check if inputDelay dropped to 1.
- **maxRollbackDepth > maxRollbackFrames** → predictions surviving beyond the window. Check prune logic.

#### 3c. Desync Detection
- **desyncCount=0 on both despite frame drift or KO mismatch** → desync detection broken. Check if `_checksumSafeOffset` is correct for the speed setting (RFC 0007).
- **desyncCount>0, resyncCount=0** → desync detected but resync not firing. Check `_onDesync` handler, WebSocket message delivery, `applyResync` version guard.
- **desyncCount>0, resyncCount>0** → healthy. System detecting and recovering from divergence.

#### 3d. Round Events
- **Same winner, same frame** → perfect sync.
- **Same winner, different frame (1-16 apart)** → minor drift, correctable by resync.
- **Different winner** → severe divergence. One peer's simulation saw completely different combat outcomes.
- **Missing round events on one peer** → the peer's local simulation diverged so much it never reached KO. Check if the network round event was received (P2 relies on P1's authoritative message).

#### 3e. Frame Drift
- **<10 frames** → normal for different devices/refresh rates.
- **10-50 frames** → moderate. Resync should correct it.
- **>100 frames** → severe. Indicates prolonged divergence without correction.

#### 3f. Confirmed Inputs
Compare first and last entries between peers. Check:
- Are both peers seeing each other's inputs? (p1 and p2 columns both non-zero)
- Do the entries align? (same frame numbers, same values)
- Is one peer's input always 0? → that peer's inputs aren't reaching the other

### Step 4: Check Log Buffer

Search the 256-entry log buffer for relevant events:

```python
python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
for peer in ['local', 'remote']:
    lb = d[peer]['diagnostics'].get('logBuffer', [])
    for entry in lb:
        msg = str(entry)
        if any(k in msg.lower() for k in ['desync','resync','error','warn','reject']):
            print(f'{peer}: {entry}')
" <path>
```

### Step 5: Report

Present findings as:

1. **Health summary** — one line: "Healthy", "Degraded (rollback asymmetry)", "Broken (undetected desync)", etc.
2. **Metrics table** — from Step 2
3. **Issues found** — bullet list with evidence
4. **Root cause** — if identifiable, reference the RFC or code path
5. **Recommendation** — what to fix or investigate next

## Common Patterns

| Pattern | Diagnosis | Reference |
|---------|-----------|-----------|
| P1: 0 rollbacks, P2: 200+, RTT empty | ConnectionMonitor never started | RFC 0006 |
| desyncCount=0 despite KO mismatch | Checksum offset uses peer-local maxRollbackFrames | RFC 0007 |
| desyncCount>0, resyncCount>0, game continued | Healthy — desync detected and corrected | Expected |
| resyncCount=0 despite desyncCount>0 | Resync messages lost or rejected | Check WebSocket relay, snapshot version |
| maxRollbackDepth > 13 | E2E overclocked mode (speed=2), check checksumSafeOffset | RFC 0007 |
| Confirmed inputs show p2=0 on P1's side | P1 never received/corrected P2's inputs | RFC 0006 |
| RTT spikes >200ms, rollback clusters | Network jitter, expected on mobile | Informational |
