# Room State Machine

The server (`party/server.js`) tracks an explicit `roomState` that determines how disconnections are handled. Clients never track room state — they react to server messages that trigger scene transitions.

## States

| State | Meaning |
|-------|---------|
| `waiting` | 0–1 players connected, no opponent yet |
| `selecting` | Both players connected, choosing fighters |
| `fighting` | Both players readied up, fight in progress |
| `reconnecting` | A player's socket dropped, grace period running |

## Transitions

```mermaid
stateDiagram-v2
    [*] --> waiting
    waiting --> selecting : 2nd player connects
    selecting --> fighting : both send ready
    selecting --> reconnecting : ws close
    fighting --> reconnecting : ws close
    fighting --> selecting : leave message
    reconnecting --> fighting : rejoin (was fighting)
    reconnecting --> selecting : rejoin (was selecting)
    reconnecting --> waiting : grace expires
    selecting --> waiting : player leaves room
```

## Grace Period Behavior

When a player's WebSocket closes, the server saves `_stateBeforeGrace` (the state before the drop) and enters `reconnecting`. A 20-second grace timer starts.

```mermaid
flowchart TD
    A[Socket closes] --> B[Save _stateBeforeGrace]
    B --> C[roomState = reconnecting]
    C --> D{Player rejoins within 20s?}
    D -- Yes --> E[Restore roomState from _stateBeforeGrace]
    D -- No --> F{_stateBeforeGrace?}
    F -- fighting --> G["Send return_to_select to remaining player"]
    F -- selecting --> H["Send disconnect to remaining player"]
    G --> I[roomState = waiting]
    H --> I
```

### Why two different messages?

- **`return_to_select`**: Grace expired during a fight. The room is still viable — the remaining player transitions back to `SelectScene` while keeping their `NetworkManager` connection alive. A new opponent can join and both re-select fighters.
- **`disconnect`**: Grace expired during fighter select. The remaining player goes to `TitleScene` and the `NetworkManager` is destroyed.

## Server Message Routing

```mermaid
flowchart TD
    Msg["Incoming message"] --> Type{Message type?}

    Type -- "ready" --> Ready["Validate roomState=selecting\nStore fighterId\nRelay opponent_ready\nIf both ready → start"]
    Type -- "input" --> Input{"spectatorOnly?"}
    Input -- No --> Relay["Relay to opponent\n+ broadcast to spectators"]
    Input -- Yes --> SpecOnly["Skip opponent relay\nBroadcast to spectators only"]
    Type -- "webrtc_offer\nwebrtc_answer\nwebrtc_ice" --> Signaling["Relay to opponent only\n(not spectators)"]
    Type -- "sync\nround_event" --> HostOnly{"From slot 0?"}
    HostOnly -- Yes --> RelayHost["Relay to opponent\n+ spectators"]
    HostOnly -- No --> Drop["Drop (non-host)"]
    Type -- "ping" --> Pong["Echo pong to sender"]
    Type -- "rematch" --> Rematch["Relay to opponent only"]
    Type -- "leave" --> Leave["Reset ready state\nRelay to opponent"]
    Type -- "rejoin" --> Rejoin["Reclaim slot\nCancel grace timer"]
```

## Client Handling

The client's current Phaser scene is its implicit state. It reacts to server messages:

| Message | SelectScene | FightScene |
|---------|------------|------------|
| `opponent_joined` | Init WebRTC negotiation | — |
| `opponent_reconnecting` | — | Show "RECONECTANDO..." overlay |
| `opponent_reconnected` | — | Hide overlay, resume, re-init WebRTC |
| `disconnect` | Go to TitleScene | Show "DESCONECTADO" (frozen) |
| `return_to_select` | — | Show "DESCONECTADO" for 2s, fade to SelectScene |
| `webrtc_offer/answer/ice` | Forward to WebRTCTransport | Forward to WebRTCTransport |
