# Rollback Netcode Architecture

GGPO-style input prediction + rollback for online fighting. Both peers run identical deterministic simulations with zero perceived input lag.

## Overview

```mermaid
flowchart TB
    subgraph P1["P1 (slot 0) — Peer"]
        P1In[Local Input] --> P1Enc[encodeInput]
        P1Sim["simulateFrame()\nFP integer math"]
    end

    subgraph Server["PartyKit Server (relay)"]
        Relay["Pure relay — no game logic\nRoutes: input, sync, round_event,\nchecksum, resync, ping/pong\nBroadcasts to spectators"]
    end

    subgraph P2["P2 (slot 1) — Peer"]
        P2In[Local Input] --> P2Enc[encodeInput]
        P2Sim["simulateFrame()\nIdentical FP integer math"]
    end

    P1Enc -. "input + history (WebRTC P2P)" .-> P2Sim
    P2Enc -. "input + history (WebRTC P2P)" .-> P1Sim
    P1Enc -- "spectatorOnly input + history (WS)" --> Server
    P2Enc -- "spectatorOnly input + history (WS)" --> Server

    subgraph Spectators
        Spec["Receive P1 sync snapshots\nNo rollback — passive display"]
    end

    Server --> Spectators
```

> **Transport:** Game inputs use WebRTC DataChannels (P2P, unreliable/unordered) when available, with automatic fallback to WebSocket relay via the PartyKit server. The rollback system handles packet loss natively. See [webrtc-transport.md](webrtc-transport.md) for full details.

## Transport Layer

```mermaid
flowchart LR
    NM["NetworkManager\nsendInput()"] --> Check{WebRTC open?}
    Check -- Yes --> DC["DataChannel (P2P)\n→ opponent direct"]
    Check -- Yes --> WS_S["WebSocket + spectatorOnly\n→ server → spectators"]
    Check -- No --> WS_F["WebSocket (fallback)\n→ server → opponent + spectators"]
```

The rollback system is transport-agnostic — `RollbackManager` reads from `remoteInputBuffer` regardless of whether inputs arrived via DataChannel or WebSocket. This means:
- **No code changes** in RollbackManager, GameState, SimulationStep, or InputBuffer
- **Packet loss** on the unreliable DataChannel is handled the same as late TCP delivery — prediction + rollback
- **Mid-fight transport switch** (P2P drops → WS fallback) is invisible to the simulation layer

## Peer-Equal Model

Both peers are equal in the simulation. There is no host/guest distinction for gameplay — both independently detect KO, timeup, round transitions, and match over. Deterministic fixed-point math guarantees bit-for-bit agreement.

P1 has additional **non-gameplay** responsibilities:
- Sends sync snapshots to spectators (every 3 frames)
- Sends `round_event` messages for spectators (3x with 200ms spacing)
- Handles potion requests from spectators
- Sends authoritative resync snapshots on desync detection

## Simulation Step

Each frame, `simulateFrame()` runs these steps in order using fixed-point integer math (no floats):

1. `fighter.update()` — FP gravity, cooldown frame timers
2. `applyInput()` — FP velocities, attack triggers
3. `resolveBodyCollision()` — FP coordinate push-back
4. `faceOpponent()` — simX comparison
5. `checkHit()` — `fpRectsOverlap()` hitbox detection
6. `tickTimer()` — frame-counted (60 frames = 1 second)
7. `syncSprite()` — render positions from sim state

## RollbackManager.advance() — Per Frame

```mermaid
flowchart TD
    A["1. Store local input at\nframe + inputDelay"] --> B["2. Send input + 2 frames\nof history to network"]
    B --> C["3. Drain confirmed\nremote inputs"]
    C --> D{4. Misprediction?}
    D -- Yes --> E["5. Restore snapshot\nRe-simulate with\nmuteEffects=true"]
    E --> F["6. Predict remote input"]
    D -- No --> F["6. Predict remote input\n(repeat movement,\nzero attacks)"]
    F --> G["7. Save snapshot via\ncaptureGameState"]
    G --> H["8. Simulate frame\ncurrentFrame++"]
    H --> I["9. Prune old snapshots\nbeyond rollback window"]
    I --> J{"10. Frame %\n30 == 0?"}
    J -- Yes --> K["Send checksum\nvia hashGameState"]
    J -- No --> L{"11. Frame %\n180 == 0?"}
    K --> L
    L -- Yes --> M["Recalculate\ninputDelay from RTT"]
    L -- No --> N[Done]
    M --> N
```

## Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| `inputDelay` | 3 frames (`ONLINE_INPUT_DELAY`), adaptive 1-5 | Local input buffering, adjusts to RTT every 180 frames |
| `maxRollbackFrames` | 7 (~117ms), scales with `inputDelay` | `max(7, inputDelay * 2 + 1)` |
| `FIXED_DELTA` | 16.667ms (60fps) | Deterministic timestep |
| Input encoding | 9 bits | `l, r, u, d, lp, hp, lk, hk, sp` packed as integer |
| `FP_SCALE` | 1000x | Integer math for determinism |
| Input redundancy | 2 frames | Each packet includes last 2 inputs as backup |
| Checksum interval | 30 frames (~0.5s) | XOR-rotate hash over 16 game state fields |
| Adaptive delay interval | 180 frames (~3s) | RTT-based delay recalculation |
| Resync cooldown | 60 frames (~1s) | Min time between resync attempts |

## Input Redundancy

Each input packet includes the last 2 frames of local input history so a single lost WebSocket message doesn't drop an attack.

```mermaid
sequenceDiagram
    participant P1
    participant Server
    participant P2

    Note over P1: Frame 5: press heavy punch
    P1->>Server: input(frame=7, state=hp, history=[[6,idle],[5,hp]])
    Note over Server: Relay entire message
    Server->>P2: input(frame=7, state=hp, history=[[6,idle],[5,hp]])

    Note over P2: Frame 6 was missing!
    Note over P2: Fill gap from history[0]
    Note over P2: Frame 5 already confirmed
    Note over P2: Skip history[1] (no overwrite)
```

The receiver fills gaps in `remoteInputBuffer` from `history` entries without overwriting already-confirmed data.

## Adaptive Input Delay

Input delay is recalculated every 180 frames (~3s) based on smoothed RTT:

```mermaid
flowchart LR
    RTT["Measure RTT\nvia ping/pong"] --> OWF["oneWayFrames =\nceil(RTT / 2 / 16.667)"]
    OWF --> OPT["optimal =\nclamp(oneWayFrames + 1, 1, 5)"]
    OPT --> INC{"optimal >\ncurrent?"}
    INC -- Yes --> UP["Increase by 1\n(gradual)"]
    INC -- No --> DOWN["Set to optimal\n(immediate)"]
    UP --> MRF["maxRollbackFrames =\nmax(7, delay * 2 + 1)"]
    DOWN --> MRF
```

| RTT | One-way frames | Optimal delay | Max rollback |
|-----|---------------|---------------|-------------|
| 0-16ms (LAN) | 0-1 | 1-2 frames | 7 |
| 50ms | 2 | 3 frames | 7 |
| 100ms | 3 | 4 frames | 9 |
| 150ms+ | 5+ | 5 frames | 11 |

## Desync Detection & Recovery

Both peers exchange state checksums every 30 frames. On mismatch, P1 sends an authoritative state snapshot to resync P2.

### Detection

`hashGameState()` computes an XOR-rotate hash over 16 key integer fields:

```
p1: simX, simY, hp, special, stamina, attackCooldown, hurtTimer
p2: simX, simY, hp, special, stamina, attackCooldown, hurtTimer
combat: timer, roundNumber
```

### Recovery Flow

```mermaid
sequenceDiagram
    participant P1
    participant Server
    participant P2

    Note over P1,P2: Frame 30: both compute checksums

    P1->>Server: checksum(frame=29, hash=A)
    P2->>Server: checksum(frame=29, hash=B)
    Server->>P2: checksum(frame=29, hash=A)
    Server->>P1: checksum(frame=29, hash=B)

    Note over P1: A ≠ B → desync detected!
    Note over P2: B ≠ A → desync detected!

    P1->>Server: resync(snapshot={frame, p1, p2, combat})
    Server->>P2: resync(snapshot)

    Note over P2: applyResync():<br/>1. restoreGameState(snapshot)<br/>2. Reset frame counter<br/>3. Clear all histories<br/>4. Save new baseline snapshot<br/>5. Clear DESYNC warning

    P2->>Server: resync_request(frame=29)
    Note over Server: P2's request arrives after<br/>P1 already sent resync.<br/>P1 sends another (harmless).
    Server->>P1: resync_request
    P1->>Server: resync(snapshot)
    Server->>P2: resync(snapshot)
    Note over P2: Second applyResync:<br/>newer frame replaces state
```

### Resync State Machine (P2)

```mermaid
stateDiagram-v2
    [*] --> synced
    synced --> desync_detected : checksum mismatch
    desync_detected --> resync_pending : send resync_request
    desync_detected --> synced : receive resync from P1
    resync_pending --> synced : receive resync from P1
    resync_pending --> resync_pending : cooldown not elapsed
    synced --> synced : checksum match
```

### Server Relay Rules

| Message | From | Relayed to | Spectators |
|---------|------|-----------|------------|
| `checksum` | Either peer | Other peer | No |
| `resync_request` | Either peer | Other peer | No |
| `resync` | Slot 0 only | Other peer | No |
| `resync` | Slot 1 | **Dropped** | No |

## Key Files

| File | Role |
|------|------|
| `FixedPoint.js` | FP constants + helpers, `ONLINE_INPUT_DELAY` |
| `GameState.js` | Snapshot/restore, `hashGameState()` for checksums |
| `InputBuffer.js` | 9-bit input encoding/decoding |
| `SimulationStep.js` | Single-frame deterministic advance |
| `RollbackManager.js` | Orchestration: predict, rollback, re-simulate, checksum, adaptive delay, resync |
| `WebRTCTransport.js` | P2P DataChannel transport (unreliable/unordered) |
| `NetworkManager.js` | Dual transport: WebRTC primary, WebSocket fallback; send/receive input, checksum, resync |
| `Fighter.js` | FP physics + frame-based timers |
| `CombatSystem.js` | FP collision + hit detection |
| `FightScene.js` | Integration: wires rollback + desync + resync + HUD |
| `party/server.js` | Relay: routes messages between peers, enforces resync authority |
