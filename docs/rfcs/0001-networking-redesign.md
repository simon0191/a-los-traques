# RFC 0001: Networking Redesign

**Status:** Draft
**Date:** 2026-03-22
**Author:** Architecture Team

---

## Summary

Multiplayer in A Los Traques is broken. Testing on real phones shows: timers 3-4 seconds apart, one phone declares a winner while the other continues playing, and fighters keep moving after the match has ended on one side.

Root cause analysis reveals bugs in **both** layers:

1. **Simulation/Rollback bugs** — Round-ending events (`timeUp`, `handleKO`) fire during rollback re-simulation and on predicted (unconfirmed) inputs, corrupting game state and causing divergence between peers.
2. **Transport bugs** — No TURN server means WebRTC fails behind symmetric NAT (every mobile carrier, most corporate WiFi). The 759-line `NetworkManager` monolith makes every fix a cross-cutting change.

This RFC proposes a full networking rewrite that fixes the simulation determinism bugs, adds Cloudflare TURN for reliable connectivity, decomposes the network layer into focused modules, and introduces a headless testing harness to prevent regressions.

---

## Goals and Non-Goals

### Goals

- **Fix multiplayer so both phones see the same game** — timer sync, round results agree, fighters stop when a round ends
- **Reliable P2P connectivity** — work across mobile carriers, corporate WiFi, symmetric NATs via TURN fallback
- **Rollback-safe round events** — KO/timeup detection must never corrupt simulation state during rollback re-simulation
- **Testable networking** — headless dual-simulation harness that can verify determinism and rollback correctness without a browser
- **Clean module boundaries** — replace the NetworkManager monolith with focused, independently testable modules
- **Connection quality visibility** — players know their connection quality before starting a match

### Non-Goals

- **Rust/Wasm rollback engine** — the current JS rollback math is sound; bugs are in event handling and transport, not in the rollback algorithm
- **Server-authoritative simulation** — P2P with rollback is correct for 1v1 fighting games (lowest latency)
- **Ranked matchmaking** — this is a friends game; room codes are sufficient
- **Anti-cheat** — friends-only context; peers can inspect/modify local state
- **Voice chat or video** — out of scope; game uses text shouts from spectators

---

## Requirements and Constraints

| Requirement | Detail |
|------------|--------|
| Platform | iPhone 15 Safari landscape (primary), Chrome/Firefox desktop (secondary) |
| Resolution | 480x270 internal, 60fps fixed timestep |
| Players | Exactly 2 per match + spectators |
| Perceived latency | < 100ms ("feels local") via input prediction |
| Transport | WebRTC DataChannel (unreliable/unordered) primary, WebSocket relay fallback |
| NAT traversal | Must work behind symmetric NAT (mobile carriers) |
| Reconnection | 20-second grace period for dropped connections |
| Language | All UI text in Spanish |
| Stack | Phaser 3, Vite, Bun, PartyKit (Cloudflare Workers) |
| Determinism | Fixed-point integer math (FP_SCALE=1000), frame-based timers, no floating-point in simulation path |

---

## Proposed Architecture

### High-Level Overview

```mermaid
flowchart LR
    subgraph Client["Browser Client"]
        GL[Game Loop<br/>FightScene]
        RM[RollbackManager]
        SS[SimulationStep]
        GS[GameState<br/>save/restore]
        IS[InputSync]
        TM[TransportManager]
        SC[SignalingClient]
        CM[ConnectionMonitor]
        SR[SpectatorRelay]
    end

    subgraph Server["PartyKit Server"]
        RS[Room State Machine]
        SIG[Signaling Relay]
        TURN_EP[TURN Credential<br/>Endpoint]
    end

    subgraph CF["Cloudflare"]
        TURN[Cloudflare TURN<br/>Relay Service]
    end

    GL -->|local input| RM
    RM -->|simulate frame| SS
    RM -->|save/restore| GS
    RM -->|send/receive inputs| IS
    IS -->|route packets| TM
    TM -->|P2P DataChannel| TM
    TM -->|WebSocket fallback| SC
    SC <-->|signaling + relay| SIG
    TM -.->|TURN relay| TURN
    SC -->|fetch credentials| TURN_EP
    TURN_EP -->|generate| TURN
    CM -->|monitor quality| TM
    CM -->|monitor quality| SC
    SR -->|spectator data| SC
```

### Rollback + Round Event Flow

This is the critical fix. The current system fires `timeUp()`/`handleKO()` during rollback re-simulation, corrupting state. The new design **defers** round events and only fires them on confirmed inputs.

```mermaid
sequenceDiagram
    participant GL as Game Loop
    participant RM as RollbackManager
    participant SIM as SimulationStep
    participant CS as CombatSystem

    Note over GL,CS: Per-frame advance (60fps)

    GL->>RM: advance(localInput)
    RM->>RM: Store local input at frame+delay
    RM->>RM: Send input to peer via InputSync
    RM->>RM: Drain confirmed remote inputs

    alt Misprediction detected
        Note over RM,CS: ROLLBACK (muteEffects=true)
        RM->>SIM: restoreGameState(snapshot)
        loop Re-simulate frames
            RM->>SIM: simulateFrame(muteEffects=true)
            SIM->>CS: tickTimer(muteEffects=true)
            Note over CS: Timer ticks but timeUp() is SUPPRESSED
            SIM->>CS: checkHit(muteEffects=true)
            Note over CS: Hit resolves but handleKO() is SUPPRESSED
        end
    end

    Note over RM,CS: CURRENT FRAME (normal advance)
    RM->>SIM: simulateFrame(muteEffects=false)
    SIM->>CS: tickTimer(muteEffects=false)
    SIM->>CS: checkHit(muteEffects=false)

    alt P1 (host) detects KO/timeup
        CS-->>GL: Return roundEvent = {type, winner}
        Note over GL: P1 fires side effects + sends to P2
    end
    alt P2 (guest) detects KO/timeup locally
        Note over CS: suppressRoundEvents=true
        Note over GL: P2 IGNORES local detection,<br/>waits for P1's network message
    end
```

### Module Decomposition

The 759-line `NetworkManager` is replaced by 5 focused modules:

```mermaid
flowchart TB
    subgraph net["src/systems/net/"]
        SC[SignalingClient<br/>~150 lines<br/>WebSocket lifecycle,<br/>room messages]
        TM[TransportManager<br/>~200 lines<br/>WebRTC + WS routing,<br/>TURN credentials]
        IS[InputSync<br/>~120 lines<br/>Frame-indexed input<br/>send/receive/drain]
        CM[ConnectionMonitor<br/>~100 lines<br/>RTT, ping/pong,<br/>quality assessment]
        SR[SpectatorRelay<br/>~80 lines<br/>Spectator buffers,<br/>sync, shout, potion]
    end

    NF[NetworkFacade<br/>~50 lines<br/>Composes all modules,<br/>exposes same public API]

    SC --> TM
    SC --> NF
    TM --> NF
    IS --> NF
    CM --> NF
    SR --> NF

    IS --> TM
    CM --> TM
    CM --> SC
    SR --> SC
```

---

## Technology Choices

| Component | Current | Proposed | Rationale |
|-----------|---------|----------|-----------|
| Rollback core | `RollbackManager.js` (JS) | Same (JS), with deferred round events | Architecture is sound; bugs are in event handling, not rollback math. GGRS/Wasm adds complexity without solving the actual problem. |
| TURN server | None (STUN only) | **Cloudflare Realtime TURN** | 1,000 GB/month free tier. Anycast routing to nearest edge. $0.05/GB after free tier. |
| STUN servers | `stun:stun.l.google.com:19302` (single) | Google STUN x2 + Cloudflare STUN | Redundancy. Multiple servers reduce single-point-of-failure risk. |
| Signaling/relay | PartyKit | **PartyKit** (keep) | Already deployed, works well. Built on Cloudflare Workers. Add `onRequest` for TURN credential endpoint. |
| Transport | `WebRTCTransport.js` + `NetworkManager.js` | `TransportManager.js` + `SignalingClient.js` | Clean separation of concerns. TURN credentials as constructor parameter. Transport-agnostic `send()` API. |
| Input sync | Embedded in `NetworkManager` | `InputSync.js` (extracted) | Independently testable. Clear API: `sendInput()`, `drainConfirmedInputs()`. |
| Monitoring | Ping/pong in `NetworkManager` | `ConnectionMonitor.js` (extracted) | Pre-match quality probing. Mid-match degradation detection. RTT on DataChannel (not just WebSocket). |
| Infra provisioning | Manual | **Terraform** (Cloudflare provider) | DNS, Workers config. TURN Key ID via Cloudflare dashboard/API (no Terraform resource exists for TURN yet). |
| Testing | Unit tests (Vitest) | + **Headless dual-simulation harness** | `NetworkSimulator` mock transport connecting two RollbackManagers. Configurable latency/loss/jitter. |

### Cloudflare TURN Integration

```
┌─────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  Client A    │     │  PartyKit Server │     │  Cloudflare TURN   │
│  (browser)   │     │  (onRequest)     │     │  Credential API    │
└──────┬───────┘     └────────┬─────────┘     └─────────┬──────────┘
       │  GET /turn-creds     │                         │
       │─────────────────────>│  POST generate-ice-     │
       │                      │  servers (ttl=86400)    │
       │                      │────────────────────────>│
       │                      │                         │
       │                      │  { iceServers: [...] }  │
       │                      │<────────────────────────│
       │  { iceServers }      │                         │
       │<─────────────────────│                         │
       │                      │                         │
       │  new RTCPeerConnection({ iceServers })         │
       │                                                │
```

**TURN Key ID** is created once via Cloudflare dashboard and stored as a PartyKit environment variable (`CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`). No Terraform resource exists for Cloudflare TURN yet — the key is provisioned manually.

**Terraform** manages: Cloudflare DNS records, Workers/PartyKit deployment configuration, environment variable bindings.

---

## Core API and Data Model

### SimulationStep — Rollback-Safe Round Events

The key change: `simulateFrame()` returns a round event descriptor instead of firing side effects directly. Side effects are deferred to the caller.

```javascript
// NEW: simulateFrame returns optional round event (no side effects)
/**
 * @returns {{ type: 'ko'|'timeup', winnerIndex: number } | null}
 */
export function simulateFrame(p1, p2, combat, p1Input, p2Input, { muteEffects = false } = {}) {
  p1.update();
  p2.update();
  applyInputToFighter(p1, decodeInput(p1Input));
  applyInputToFighter(p2, decodeInput(p2Input));
  combat.resolveBodyCollision(p1, p2);
  p1.faceOpponent(p2);
  p2.faceOpponent(p1);

  let roundEvent = null;
  if (combat.roundActive) {
    // checkHit returns KO info instead of calling handleKO()
    const p1Hit = combat.checkHit(p1, p2, { muteEffects });
    const p2Hit = combat.checkHit(p2, p1, { muteEffects });
    if (p1Hit?.ko) roundEvent = { type: 'ko', winnerIndex: 0 };
    else if (p2Hit?.ko) roundEvent = { type: 'ko', winnerIndex: 1 };

    // tickTimer returns timeup info instead of calling timeUp()
    const timerResult = combat.tickTimer({ muteEffects });
    if (timerResult?.timeup) {
      roundEvent = { type: 'timeup', winnerIndex: p1.hp >= p2.hp ? 0 : 1 };
    }
  }

  p1.syncSprite();
  p2.syncSprite();
  return roundEvent;
}
```

### RollbackManager — Deferred Event Handling

```javascript
// In RollbackManager.advance():

// During rollback re-simulation: IGNORE round events
for (let f = rollbackFrame; f < this.currentFrame; f++) {
  simulateFrame(p1, p2, combat, p1Input, p2Input, { muteEffects: true });
  // Return value (round event) is intentionally discarded
}

// During current frame: CAPTURE round event
const roundEvent = simulateFrame(p1, p2, combat, p1Input, p2Input);
// Return to caller (FightScene) for deferred handling
return { roundEvent };
```

### FightScene — P1 Authority for Round Events

```javascript
// P1 (host): fires side effects and sends to P2
const { roundEvent } = rollbackManager.advance(localInput, this, p1, p2, combat);
if (roundEvent && this.isHost) {
  combat.handleRoundEnd(roundEvent);  // Fire audio, camera, UI
  networkManager.sendRoundEvent(roundEvent);
}

// P2 (guest): waits for P1's network message
// combat.suppressRoundEvents = true (set in _setupOnlineMode)
networkManager.onRoundEvent((event) => {
  if (!this.isHost) {
    combat.handleRoundEnd(event);  // Fire audio, camera, UI
  }
});
```

### NetworkFacade — Composed Public API

The `NetworkFacade` composes all 5 modules and exposes the same API that `FightScene`, `LobbyScene`, and `SelectScene` currently use. This allows incremental migration.

```javascript
export class NetworkFacade {
  constructor(roomId, host, options) {
    this.signaling = new SignalingClient(roomId, host);
    this.transport = new TransportManager(this.signaling);
    this.inputSync = new InputSync(this.transport);
    this.monitor = new ConnectionMonitor(this.signaling, this.transport);
    this.spectator = options.spectator ? new SpectatorRelay(this.signaling) : null;
  }

  // Same public API as current NetworkManager:
  sendInput(frame, inputState, history) { return this.inputSync.sendInput(frame, inputState, history); }
  drainConfirmedInputs() { return this.inputSync.drainConfirmedInputs(); }
  sendChecksum(frame, hash) { return this.inputSync.sendChecksum(frame, hash); }
  sendReady(fighterId) { return this.signaling.sendReady(fighterId); }
  onAssign(cb) { return this.signaling.on('assign', cb); }
  onOpponentJoined(cb) { return this.signaling.on('opponent_joined', cb); }
  getPlayerSlot() { return this.signaling.playerSlot; }
  get rtt() { return this.monitor.rtt; }
  // ... etc
}
```

### InputSync — Clean Input Pipeline

```javascript
export class InputSync {
  constructor(transport) {
    this.transport = transport;
    this.remoteInputBuffer = new Map();  // frame → encodedInput
    this.lastRemoteInput = 0;
  }

  sendInput(frame, inputState, history) {
    const msg = { type: 'input', frame, state: inputState, history };
    this.transport.send(msg);
  }

  drainConfirmedInputs() {
    const entries = [...this.remoteInputBuffer.entries()];
    this.remoteInputBuffer.clear();
    return entries;
  }

  handleRemoteInput(frame, inputState, history) {
    this.remoteInputBuffer.set(frame, inputState);
    // Backfill gaps from redundant history
    for (const [hf, hs] of history) {
      if (!this.remoteInputBuffer.has(hf)) {
        this.remoteInputBuffer.set(hf, hs);
      }
    }
  }
}
```

### TransportManager — Dual Transport with TURN

```javascript
export class TransportManager {
  constructor(signalingClient) {
    this.signaling = signalingClient;
    this.pc = null;           // RTCPeerConnection
    this.dc = null;           // RTCDataChannel
    this.iceServers = null;   // Fetched from server
    this.state = 'idle';      // idle | connecting | webrtc | websocket
  }

  async fetchTurnCredentials() {
    // Called on opponent_joined, before WebRTC negotiation
    const creds = await this.signaling.fetchTurnCredentials();
    this.iceServers = creds.iceServers;
  }

  async connect(isOfferer) {
    await this.fetchTurnCredentials();
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    // ... DataChannel setup, offer/answer exchange via signaling
  }

  send(data) {
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify(data));
      return 'webrtc';
    }
    this.signaling.send(data);
    return 'websocket';
  }

  getConnectionInfo() {
    return {
      type: this.state,        // 'webrtc' | 'websocket'
      iceType: this._iceType,  // 'host' | 'srflx' | 'relay'
      rtt: this._dcRtt,
    };
  }
}
```

### ConnectionMonitor — Pre-Match Quality Probing

```javascript
export class ConnectionMonitor {
  constructor(signaling, transport) {
    this.signaling = signaling;
    this.transport = transport;
    this.rtt = 0;
    this.jitter = 0;
  }

  /**
   * Run pre-match quality assessment (call during character select).
   * Sends 10 pings over 2 seconds, measures RTT distribution.
   * @returns {{ avgRtt, maxRtt, jitter, iceType, quality: 'good'|'fair'|'poor' }}
   */
  async assessQuality() {
    const samples = [];
    for (let i = 0; i < 10; i++) {
      const rtt = await this._pingOnce();
      samples.push(rtt);
      await new Promise(r => setTimeout(r, 200));
    }
    const avgRtt = samples.reduce((a, b) => a + b, 0) / samples.length;
    const maxRtt = Math.max(...samples);
    const jitter = this._calculateJitter(samples);
    const iceType = this.transport.getConnectionInfo().iceType;

    let quality = 'good';
    if (avgRtt > 150 || iceType === 'relay') quality = 'fair';
    if (avgRtt > 250 || this.transport.state === 'websocket') quality = 'poor';

    return { avgRtt, maxRtt, jitter, iceType, quality };
  }
}
```

---

## Implementation Plan

### Phase 1: Fix Simulation Determinism (Critical Path)

**Goal:** Both peers see the same game state. Timer synchronized. Rounds end at the same time on both phones.

**Description:**
- Make `tickTimer()` accept `{ muteEffects }` — suppress `timeUp()` during rollback re-simulation
- Make `checkHit()` return KO info instead of calling `handleKO()` directly during simulation
- `simulateFrame()` returns optional round event descriptor instead of firing side effects
- `RollbackManager.advance()` captures round event from current frame, discards during re-simulation
- P2 sets `combat.suppressRoundEvents = true` in `_setupOnlineMode()`
- P1 sends round events to P2 via network; P2 waits for P1's message before firing UI

**Deliverables:**
- Modified `CombatSystem.js` — `tickTimer({ muteEffects })`, `checkHit()` returns KO info
- Modified `SimulationStep.js` — returns round event, passes `muteEffects` to all combat methods
- Modified `RollbackManager.js` — deferred round event handling
- Modified `FightScene.js` — P1 authority, P2 `suppressRoundEvents = true`, deferred event wiring
- New `tests/systems/rollback-round-events.test.js` — regression tests for all 3 root cause bugs

**Risks:**
- Changing `simulateFrame()` return value affects all callers (local mode, spectator mode). Mitigate: local mode ignores return value and handles events via existing `CombatSystem` callbacks.

**Estimated effort:** 2-3 days

---

### Phase 2A: Headless Testing Harness (Parallelizable with 2B)

**Goal:** Automated tests that catch desync, timer drift, and rollback corruption without needing a browser.

**Description:**
- Create `NetworkSimulator` mock transport with configurable: latency (ms), jitter (ms), packet loss (%), reordering probability, burst loss length
- Create `HeadlessFight` test utility that wires two `RollbackManager` instances + `SimulationStep` + `CombatSystem` via `NetworkSimulator`
- Uses mock fighters from existing `tests/systems/determinism.test.js` pattern (pure FP simulation, no Phaser)
- Scripted input sequences drive both sides
- Assertions: bit-exact state at every confirmed frame, timer values match, round events agree

**Deliverables:**
- `tests/harness/NetworkSimulator.js` — configurable mock transport
- `tests/harness/HeadlessFight.js` — dual-simulation test utility
- `tests/harness/MockFighter.js` — pure simulation fighter (extracted from `determinism.test.js`)
- `tests/integration/dual-sim-determinism.test.js` — determinism under various network conditions
- `tests/integration/dual-sim-round-events.test.js` — round event correctness under rollback

**Test scenarios:**
| Scenario | Latency | Loss | Expected |
|----------|---------|------|----------|
| Perfect LAN | 0ms | 0% | Bit-exact, no rollbacks |
| Good WiFi | 30ms | 0% | Bit-exact at confirmation, rollbacks converge |
| Mobile cellular | 80ms, 20ms jitter | 2% | State converges within rollback window |
| Bad connection | 150ms, 50ms jitter | 10% | State converges, adaptive delay increases |
| Burst loss | 50ms | 5 consecutive frames lost | Recovers via input redundancy |
| Timer edge case | 50ms | timed to hit timer=0 during rollback | Timer identical on both sides |
| KO during rollback | 50ms | timed to cause KO misprediction | Round event only fires on confirmed state |

**Risks:**
- Mock fighters may diverge from real Fighter.js behavior over time. Mitigate: share constants from `FixedPoint.js`, add snapshot comparison tests against real fighters in Playwright layer.

**Estimated effort:** 3-4 days

---

### Phase 2B: Transport Layer + TURN (Parallelizable with 2A)

**Goal:** Reliable P2P connectivity across all network types. Clean module boundaries.

**Description:**

**2B.1: Cloudflare TURN integration**
- Create Cloudflare TURN key via dashboard, store as PartyKit env vars (`CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`)
- Add `onRequest` handler to `party/server.js` to generate TURN credentials (REST call to `rtc.live.cloudflare.com`)
- Client fetches credentials on `opponent_joined`, before WebRTC negotiation
- ICE server list: Google STUN x2 + Cloudflare STUN + Cloudflare TURN (UDP + TCP)

**2B.2: Module decomposition**
- Extract `SignalingClient.js` from NetworkManager (WebSocket lifecycle, room messages, event emitter)
- Extract `TransportManager.js` from NetworkManager + WebRTCTransport (WebRTC setup, TURN creds, transport routing)
- Extract `InputSync.js` from NetworkManager (input buffer, send/receive, drain, checksum/resync relay)
- Extract `ConnectionMonitor.js` from NetworkManager (ping/pong, RTT, pong timeout, quality assessment)
- Extract `SpectatorRelay.js` from NetworkManager (spectator buffers, sync, shout, potion)
- Create `NetworkFacade.js` that composes all 5 and exposes the same public API

**2B.3: Terraform configuration**
- Terraform config for Cloudflare DNS, PartyKit/Workers environment variables
- TURN key ID as a Terraform variable (provisioned manually, referenced in config)

**Deliverables:**
- `src/systems/net/SignalingClient.js`
- `src/systems/net/TransportManager.js`
- `src/systems/net/InputSync.js`
- `src/systems/net/ConnectionMonitor.js`
- `src/systems/net/SpectatorRelay.js`
- `src/systems/net/NetworkFacade.js`
- Modified `party/server.js` — `onRequest` for TURN credential endpoint
- `infra/main.tf` — Terraform configuration
- `tests/systems/net/signaling-client.test.js`
- `tests/systems/net/transport-manager.test.js`
- `tests/systems/net/input-sync.test.js`
- Delete: `src/systems/NetworkManager.js`, `src/systems/WebRTCTransport.js`

**Risks:**
- Decomposition may introduce subtle message ordering bugs. Mitigate: `NetworkFacade` exposes identical API, existing tests run against facade.
- Cloudflare TURN credential API may have latency. Mitigate: fetch eagerly on `opponent_joined` (during character select), cache for 5 minutes.

**Estimated effort:** 4-5 days

---

### Phase 3: Integration + Connection Quality (Depends on 2A + 2B)

**Goal:** Wire fixed simulation to new transport. Pre-match quality indicator.

**Description:**
- Replace `NetworkManager` imports with `NetworkFacade` in all scenes (FightScene, LobbyScene, SelectScene, PreFightScene, VictoryScene)
- Wire `ConnectionMonitor.assessQuality()` during character select
- Show connection quality indicator in SelectScene UI:
  - Green dot: P2P direct (`host`/`srflx`), RTT < 80ms — "Buena conexion"
  - Yellow dot: TURN relay or RTT 80-150ms — "Conexion aceptable"
  - Red dot: WebSocket fallback or RTT > 150ms — "Conexion lenta"
- Players can always proceed regardless of quality (friends game, not ranked)
- Exchange `connection_quality` message via server so both peers see the indicator

**Deliverables:**
- Updated scene imports (FightScene, LobbyScene, SelectScene, etc.)
- Connection quality UI in SelectScene
- New `connection_quality` message type in `party/server.js`
- End-to-end test: two headless simulations through `NetworkFacade`

**Risks:**
- UI changes in SelectScene may conflict with ongoing work. Mitigate: quality indicator is a small overlay, minimal scene changes.

**Estimated effort:** 2 days

---

### Phase 4: Hardened Reconnection (Depends on Phase 3)

**Goal:** Fix race conditions in reconnection flow.

**Description:**
- `TransportManager` handles WebRTC renegotiation as a proper state machine (not `_initWebRTC()` called from multiple code paths)
- On reconnect: `SignalingClient` reconnects WebSocket → sends `rejoin` → waits for server confirmation → `TransportManager` renegotiates WebRTC
- Sequential, not concurrent: WebSocket must be stable before WebRTC renegotiation starts
- `ReconnectionManager` (already solid) receives events from `SignalingClient` and `TransportManager` through clean callbacks
- Add reconnection integration test in headless harness: simulate WebSocket drop, reconnect, verify state convergence

**Deliverables:**
- `TransportManager` reconnection state machine
- `SignalingClient` rejoin flow (sequential)
- `tests/integration/reconnection.test.js`

**Risks:**
- WebRTC renegotiation on Safari has known quirks (ICE restart behavior). Mitigate: on reconnect failure, fall back to WebSocket relay rather than retrying indefinitely.

**Estimated effort:** 2 days

---

### Phase 5: Binary Input Protocol (Optional)

**Goal:** Reduce per-packet overhead on DataChannel.

**Description:**
Currently inputs are JSON-encoded (~100 bytes per packet):
```json
{"type":"input","frame":1234,"state":{"left":true,"right":false,...},"history":[[1233,42],[1232,0]]}
```

Replace with binary encoding on DataChannel (keep JSON on WebSocket for debuggability):
- 1 byte: message type (0x01 = input)
- 2 bytes: frame number (uint16, wraps at 65535 = ~18 minutes at 60fps)
- 2 bytes: encoded input (uint16, only 9 bits used)
- N * 4 bytes: history entries (uint16 frame + uint16 input each)
- Total: ~13 bytes vs ~100 bytes

**Why optional:** At 60fps, even JSON is only ~6KB/s, well within any connection. But smaller packets reduce DataChannel per-packet overhead and are more resilient to congestion.

**Deliverables:**
- `src/systems/net/BinaryCodec.js` — encode/decode binary input packets
- `tests/systems/net/binary-codec.test.js`
- Updated `TransportManager.send()` to use binary on DataChannel

**Risks:**
- Binary debugging is harder. Mitigate: keep JSON on WebSocket path, add hex dump logging for binary path.

**Estimated effort:** 0.5 days

---

## Phase Dependency Diagram

```mermaid
flowchart TB
    P1[Phase 1<br/>Fix Simulation Determinism<br/>2-3 days]
    P2A[Phase 2A<br/>Headless Testing Harness<br/>3-4 days]
    P2B[Phase 2B<br/>Transport + TURN + Modules<br/>4-5 days]
    P3[Phase 3<br/>Integration + Quality UI<br/>2 days]
    P4[Phase 4<br/>Hardened Reconnection<br/>2 days]
    P5[Phase 5<br/>Binary Protocol<br/>0.5 days]

    P1 --> P2A
    P1 --> P2B
    P2A --> P3
    P2B --> P3
    P3 --> P4
    P4 --> P5

    style P2A fill:#e1f5fe
    style P2B fill:#e1f5fe
    style P5 fill:#fff3e0
```

**Phase 2A and 2B run in parallel** (blue). Phase 5 is optional (orange).

**Total estimated effort:** 13-16 days (sequential), ~10-12 days (with parallelism).

---

## Migration and Rollout Strategy

### Incremental Migration via NetworkFacade

The `NetworkFacade` pattern allows zero-disruption migration:

1. **Phase 1** modifies existing files in-place (SimulationStep, CombatSystem, RollbackManager, FightScene). No module boundary changes.

2. **Phase 2B** creates new modules in `src/systems/net/` and a `NetworkFacade` that exposes the exact same public API as the current `NetworkManager`. Scenes continue to import and use the same interface.

3. **Phase 3** swaps imports from `NetworkManager` to `NetworkFacade`. This is a mechanical find-and-replace with no behavioral changes.

4. Once all scenes use `NetworkFacade`, delete `src/systems/NetworkManager.js` and `src/systems/WebRTCTransport.js`.

### Rollout Steps

1. **Local testing:** Fix simulation bugs (Phase 1), run headless harness (Phase 2A), verify determinism
2. **Staging:** Deploy TURN-enabled PartyKit server, test on two iPhones over cellular
3. **Canary:** Enable for a subset of rooms (e.g., rooms starting with "test-")
4. **Full rollout:** Remove canary gate, update docs

### Backward Compatibility

- The PartyKit server changes are additive (new `onRequest` endpoint, new `connection_quality` message type). Old clients continue to work — they just won't use TURN or quality probing.
- The `NetworkFacade` exposes the same API. No scene changes required during Phase 2B.

---

## Testing Strategy

### Layer 1: Headless Dual-Simulation Harness (Phase 2A)

Two `RollbackManager` instances connected via a `NetworkSimulator` mock transport. Uses real `SimulationStep`, `GameState`, `InputBuffer`, `CombatSystem` with mock fighters (existing pattern from `tests/systems/determinism.test.js`).

`NetworkSimulator` is configurable:
- **Latency**: one-way delay in ms (applied per-packet)
- **Jitter**: random variation added to latency (uniform distribution)
- **Packet loss**: probability of dropping a packet (0-1)
- **Reordering**: probability of delivering packets out of order
- **Burst loss**: consecutive frames dropped (simulates WiFi handoff)

```javascript
const sim = new NetworkSimulator({
  latencyMs: 80,
  jitterMs: 20,
  packetLossRate: 0.02,
  burstLossFrames: 0,
});

const fight = new HeadlessFight(sim, {
  p1Inputs: generateInputSequence(600),  // 10 seconds
  p2Inputs: generateInputSequence(600),
});

const result = fight.run();
expect(result.p1FinalState).toEqual(result.p2FinalState);
expect(result.p1Timer).toBe(result.p2Timer);
expect(result.p1RoundEvents).toEqual(result.p2RoundEvents);
```

### Layer 2: Targeted Rollback Regression Tests

```javascript
// Test: timeUp during rollback re-simulation must NOT fire side effects
test('timer reaching 0 during rollback does not corrupt state', () => {
  // Set timer to 1 second remaining (60 frames)
  // Run 59 frames normally
  // Inject a misprediction at frame 55 that triggers rollback
  // During re-simulation frames 55-59, timer hits 0
  // Assert: roundActive is still true after rollback completes
  // Assert: timeUp() was NOT called during re-simulation
});

// Test: KO on predicted input + rollback
test('KO on predicted input is rolled back correctly', () => {
  // Set defender HP to 1
  // Predict an attack that would KO
  // Confirmed input shows the attack was blocked
  // Assert: defender HP is not 0, round continues
  // Assert: handleKO() was NOT called
});
```

### Layer 3: Transport Unit Tests

- Mock `RTCPeerConnection` and `RTCDataChannel` for `TransportManager` tests
- Mock `PartySocket` for `SignalingClient` tests
- Test TURN credential fetching (mock HTTP response)
- Test ICE candidate type reporting
- Test transport fallback (DataChannel close → WebSocket)

### Layer 4: Playwright E2E (CI-optional, Slow)

- Two `browser.newContext()` instances connecting to local PartyKit server (`bun run party:dev`)
- Scripted inputs via `page.evaluate(() => window.game.inputManager.injectInput({...}))`
- Assert both tabs show same timer, HP, and round result after 30 seconds of play
- Run as a separate CI job (not blocking, takes ~2 minutes)

---

## Open Questions and Alternatives

### Open Questions

| # | Question | Impact | Current Leaning |
|---|----------|--------|-----------------|
| 1 | Should P2 also detect round events locally (with delay tolerance) as a backup, or purely wait for P1's message? | If P1 disconnects mid-round-event, P2 might hang. | P2 detects locally with a 30-frame delay as a fallback. If P1's message hasn't arrived within 30 frames of local detection, P2 fires locally. |
| 2 | Should the binary protocol (Phase 5) be prioritized? | Smaller packets are more resilient to congestion on constrained mobile connections. | Keep optional. JSON at 6KB/s is fine for DataChannel. Revisit if testing shows packet loss issues at scale. |
| 3 | Should we add a TURN-only mode for debugging? | Useful for testing TURN path specifically. | Yes — add a `?forceTurn=1` URL parameter that sets `iceTransportPolicy: 'relay'` on RTCPeerConnection. |
| 4 | Should spectator sync use the rollback system or stay as P1-broadcasted snapshots? | Current approach (P1 broadcasts every 3 frames) is simple and works. Rollback for spectators adds complexity. | Keep current approach. Spectators don't need frame-perfect accuracy. |
| 5 | How should we handle TURN credential expiry during very long sessions? | TURN credentials have max 48h TTL. Matches are typically < 10 minutes. | No action needed. If a match somehow lasts > 48h, TURN fallback stops working but WebSocket relay continues. |

### Alternatives Considered

**GGRS (Rust/Wasm)**
- Pros: Battle-tested rollback library, handles spectator delay, input delay calculation
- Cons: Wasm bridging overhead (copy 30 state fields across JS/Wasm boundary 60x/sec), Rust toolchain maintenance, Safari Wasm debugging is painful
- Verdict: **Rejected.** The rollback math is 324 lines of JS and works correctly. The bugs are in event handling and transport, not rollback scheduling.

**geckos.io**
- Pros: WebRTC DataChannel library with server-side Node component, handles connection management
- Cons: Designed for client-server topology (not P2P), adds a server hop, unmaintained (last release 2023)
- Verdict: **Rejected.** P2P is correct for 1v1 fighting games. Adding a server hop increases latency.

**Cloudflare Durable Objects (replace PartyKit)**
- Pros: More control, no PartyKit dependency
- Cons: Would reimplement WebSocket management that PartyKit provides for free. PartyKit IS built on Durable Objects.
- Verdict: **Rejected.** PartyKit works and is deployed. The server code is 362 lines and well-understood.

**Client-Server Architecture (server runs simulation)**
- Pros: No desync possible (single source of truth), easier anti-cheat
- Cons: Adds ~50-100ms latency per input (server round-trip), requires beefy server, overkill for friends game
- Verdict: **Rejected.** For a 1v1 fighting game where every frame matters, P2P with rollback is the correct architecture.

**Metered.ca (alternative TURN provider)**
- Pros: Simple REST API, free tier (50 GB/month)
- Cons: Smaller free tier than Cloudflare (50 GB vs 1,000 GB), separate infrastructure from the rest of the stack
- Verdict: **Rejected in favor of Cloudflare TURN.** Same cloud provider as PartyKit, 20x larger free tier.

---

## Appendix: Files Modified/Created

### Modified

| File | Change |
|------|--------|
| `src/systems/CombatSystem.js` | `tickTimer({ muteEffects })`, `checkHit()` returns KO info |
| `src/systems/SimulationStep.js` | Returns round event, passes `muteEffects` to all combat methods |
| `src/systems/RollbackManager.js` | Deferred round event in `advance()`, discard during re-simulation |
| `src/scenes/FightScene.js` | P1 authority wiring, P2 `suppressRoundEvents`, deferred events, quality UI |
| `party/server.js` | `onRequest` TURN credential endpoint, `connection_quality` message |

### Created

| File | Purpose |
|------|---------|
| `src/systems/net/SignalingClient.js` | WebSocket lifecycle, room messages |
| `src/systems/net/TransportManager.js` | WebRTC + WS routing, TURN credentials |
| `src/systems/net/InputSync.js` | Frame-indexed input send/receive/drain |
| `src/systems/net/ConnectionMonitor.js` | RTT, ping/pong, quality assessment |
| `src/systems/net/SpectatorRelay.js` | Spectator buffers, sync, shout, potion |
| `src/systems/net/NetworkFacade.js` | Composes all modules, same public API |
| `infra/main.tf` | Terraform config for Cloudflare DNS + env vars |
| `tests/harness/NetworkSimulator.js` | Mock transport with configurable conditions |
| `tests/harness/HeadlessFight.js` | Dual-simulation test utility |
| `tests/harness/MockFighter.js` | Pure simulation fighter (no Phaser) |
| `tests/integration/dual-sim-determinism.test.js` | Determinism under network conditions |
| `tests/integration/dual-sim-round-events.test.js` | Round event correctness |
| `tests/integration/reconnection.test.js` | Reconnection flow |
| `tests/systems/net/signaling-client.test.js` | SignalingClient unit tests |
| `tests/systems/net/transport-manager.test.js` | TransportManager unit tests |
| `tests/systems/net/input-sync.test.js` | InputSync unit tests |
| `src/systems/net/BinaryCodec.js` | Binary input encoding (Phase 5, optional) |

### Deleted

| File | Reason |
|------|--------|
| `src/systems/NetworkManager.js` | Replaced by `net/` modules + `NetworkFacade` |
| `src/systems/WebRTCTransport.js` | Absorbed into `TransportManager` |
