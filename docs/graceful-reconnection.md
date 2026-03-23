# Graceful Reconnection

20-second grace period absorbs brief network drops on mobile Safari. Covers both the client-side `ReconnectionManager` state machine and the server-side room state that determines what happens when the grace period expires.

## ReconnectionManager State Machine (Client)

Pure state machine with no Phaser or WebSocket dependencies. FightScene wires socket events to it and reacts to its callbacks.

```mermaid
stateDiagram-v2
    [*] --> connected
    connected --> reconnecting : ws close / opponent drop
    reconnecting --> connected : rejoin + opponent_reconnected
    reconnecting --> disconnected : grace expires (20s)

    note right of reconnecting
        fires: onPause
    end note
    note right of connected
        fires: onResume (on re-entry)
    end note
    note right of disconnected
        fires: onDisconnect
    end note
```

## Successful Reconnection (< 20s)

```mermaid
sequenceDiagram
    participant A as Player A
    participant S as Server
    participant B as Player B

    A-xS: ws close (network drop)
    S->>B: opponent_reconnecting
    Note over S: start 20s timer<br/>roomState = reconnecting<br/>_stateBeforeGrace saved
    Note over B: Frames 0-7: rollback predicts
    Note over B: Frame 8+: PAUSED<br/>RECONECTANDO...<br/>with countdown
    Note over A: sim frozen

    A->>S: ws open (PartySocket auto-reconnect)
    A->>S: { type: 'rejoin', slot: N }
    S->>B: opponent_reconnected
    Note over S: cancel 20s timer<br/>roomState restored
    Note over B: RESUME gameplay
```

## Grace Period Expiry

When the timer runs out, the server checks what state the room was in *before* the drop:

```mermaid
flowchart TD
    A[Socket closes] --> B["Save _stateBeforeGrace\nroomState = reconnecting"]
    B --> C{Player rejoins within 20s?}
    C -- Yes --> D["Restore roomState\nfrom _stateBeforeGrace"]
    C -- No --> E{_stateBeforeGrace?}
    E -- fighting --> F["Send return_to_select\nto remaining player"]
    E -- selecting --> G["Send disconnect\nto remaining player"]
    F --> H["roomState = waiting\nClear fightInfo, reset ready flags"]
    G --> H
```

- **`return_to_select`**: Room is still viable. Remaining player sees "DESCONECTADO" for 2s, then fades to `SelectScene` with `NetworkManager` kept alive. A new opponent can join.
- **`disconnect`**: Remaining player goes to `TitleScene`, `NetworkManager` destroyed.

## Server Room State Machine

See [room-state-machine.md](room-state-machine.md) for the full `roomState` transition diagram and client message handling table.

## Module Responsibilities

```mermaid
flowchart TD
    RM["ReconnectionManager\n\nPure state machine\ntick() + callbacks\nno dependencies"]
    SRV["party/server.js\n\nGrace timer per slot\nrejoin message handler\nSlot reservation\nroomState tracking"]
    NM["NetworkManager\n\nSocket open/close hooks\nopponent_reconnecting\nreturn_to_select\nsendRejoin(slot)"]
    FS["FightScene\n\nWires NM socket events to RM callbacks\nPauses sim, shows overlay, resumes on reconnect\nreturn_to_select → fade to SelectScene\nupdate() calls rm.tick() each frame"]

    SRV -- "messages" --> NM
    NM -- "socket events" --> FS
    FS -- "onPause/Resume" --> RM
    RM -- "callbacks" --> FS
```

## WebRTC Re-negotiation on Reconnect

When a player reconnects after a network drop, the WebRTC DataChannel is destroyed and re-negotiated. The two peers follow different paths:

- **Staying peer** (never disconnected): Receives `opponent_reconnected` from server → calls `initWebRTC()` immediately (their signaling is already stable).
- **Reconnecting peer**: Sends `rejoin` → receives `rejoin_ack` from server → flushes queued `initWebRTC()`. The WebRTC init is deferred via `queueWebRTCInit()` until `rejoin_ack` confirms the signaling channel is stable, preventing lost WebRTC signaling messages during WebSocket flapping.

```mermaid
flowchart TD
    Drop["Network drop"] --> DCClose["WebRTC DC closes\n_webrtcReady = false"]
    DCClose --> WSClose["WebSocket closes"]
    WSClose --> Grace["20s grace period"]
    Grace --> Reconn["PartySocket reconnects"]
    Reconn --> Queue["queueWebRTCInit()"]
    Queue --> Rejoin["sendRejoin(slot)"]
    Rejoin --> Ack["rejoin_ack received"]
    Ack --> ReInit["flushPendingWebRTCInit()\nNew WebRTC negotiation"]
    ReInit --> Success{"P2P succeeds?"}
    Success -- Yes --> P2P["Resume with P2P inputs"]
    Success -- No --> WS["Continue with WS relay\n(same as pre-WebRTC behavior)"]
```

During the grace period, if WebRTC was active before the drop, both peers fall back to WebSocket. Inputs can still flow via WS during the reconnection window (the pause overlay is driven by the ReconnectionManager, not the transport layer).

## Connection Loss Detection

Three mechanisms detect connection loss:

1. **WebRTC DataChannel close (fastest, <1s)**: The DataChannel `onclose` fires almost immediately when the peer's network drops. This triggers `_webrtcReady = false` and falls back to WebSocket, but does not by itself trigger the reconnection overlay — that's driven by the WebSocket layer.
2. **Pong timeout (active, ~9s)**: NetworkManager sends pings every 3s and tracks `_lastPongTime`. If no pong arrives for >6s (PONG_TIMEOUT_MS), it synthetically triggers `_onSocketClose()` to enter the reconnection flow. This fires ~9s after WiFi drops (2 missed pongs + next interval tick).
3. **WebSocket close (passive, 30s+)**: The browser eventually fires the `close` event. On mobile Safari this can take 30+ seconds.

The `ReconnectionManager.handleConnectionLost()` is re-entrant: if already in `reconnecting` state, it resets the grace timer without re-firing `onPause`. This handles simultaneous disconnects where both peers drop at the same time — the grace period restarts from the latest event.

## Transport Degradation

When the WebRTC DataChannel closes but the WebSocket stays open (asymmetric drop), gameplay continues via WS relay without pausing. `TransportManager` emits `transportDegraded` to update the HUD transport indicator to "WS" in yellow immediately. When the DataChannel is re-established, `transportRestored` fires and the HUD reverts on the next cycle.

## Key Files

| File | Role |
|------|------|
| `ReconnectionManager.js` | Pure state machine: connected → reconnecting → connected/disconnected |
| `party/server.js` | Grace timer, slot reservation, `roomState` + `_stateBeforeGrace`, `return_to_select` vs `disconnect` |
| `NetworkFacade.js` | Socket lifecycle hooks, `opponent_reconnecting`/`opponent_reconnected`/`return_to_select` handlers, `sendRejoin()`, `queueWebRTCInit()`, `rejoin_ack` → flush WebRTC init |
| `TransportManager.js` | WebRTC lifecycle, `queueWebRTCInit`/`flushPendingWebRTCInit`, `transportDegraded`/`transportRestored` events |
| `WebRTCTransport.js` | DataChannel transport — destroyed on disconnect, re-negotiated after reconnect |
| `FightScene.js` | Integration: wires NM events → RM, shows overlay, handles `return_to_select` transition to SelectScene |
