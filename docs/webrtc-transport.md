# WebRTC P2P Transport

WebRTC DataChannels provide direct peer-to-peer communication for game inputs, eliminating the server round-trip. The existing GGPO-style rollback system already handles packet loss and out-of-order delivery, making unreliable DataChannels a natural fit.

## Architecture

```mermaid
flowchart LR
    subgraph P1["Player 1 (Browser)"]
        NM1["NetworkManager"] --> WRT1["WebRTCTransport"]
        NM1 --> WS1["WebSocket"]
    end

    subgraph Server["PartyKit Server"]
        Sig["Signaling Relay\nwebrtc_offer/answer/ice"]
        Spec["Spectator Relay\nspectatorOnly inputs"]
    end

    subgraph P2["Player 2 (Browser)"]
        WRT2["WebRTCTransport"] --> NM2["NetworkManager"]
        WS2["WebSocket"] --> NM2
    end

    WRT1 -. "DataChannel\n(P2P, UDP-like)" .-> WRT2
    WS1 -- "signaling + spectatorOnly" --> Sig
    Sig -- "signaling" --> WS2
    Spec -- "inputs" --> Spectators
```

## Transport Negotiation Timeline

```mermaid
sequenceDiagram
    participant P1 as P1 (Offerer)
    participant S as Server
    participant P2 as P2 (Answerer)

    Note over P1,P2: Both connect via WebSocket
    S->>P1: assign (slot 0)
    S->>P2: assign (slot 1)
    S->>P1: opponent_joined
    S->>P2: opponent_joined

    Note over P1: _initWebRTC()<br/>isOfferer = true

    P1->>P1: createDataChannel("inputs")<br/>ordered: false, maxRetransmits: 0
    P1->>P1: createOffer()
    P1->>S: webrtc_offer (SDP)
    S->>P2: webrtc_offer (SDP)

    Note over P2: _initWebRTC()<br/>handleSignal(offer)

    P2->>P2: setRemoteDescription(offer)
    P2->>P2: createAnswer()
    P2->>S: webrtc_answer (SDP)
    S->>P1: webrtc_answer (SDP)
    P1->>P1: setRemoteDescription(answer)

    par ICE Candidates
        P1->>S: webrtc_ice
        S->>P2: webrtc_ice
    and
        P2->>S: webrtc_ice
        S->>P1: webrtc_ice
    end

    Note over P1,P2: DataChannel opens (P2P established)

    rect rgb(200, 255, 200)
        Note over P1,P2: Game inputs flow P2P<br/>spectatorOnly copies via WS
    end
```

## WebRTCTransport State Machine

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> signaling : startOffer() / handleSignal(offer)
    signaling --> connecting : DataChannel setup
    connecting --> open : DC.onopen
    open --> closed : DC.onclose / PC disconnected
    signaling --> failed : 5s timeout
    connecting --> failed : 5s timeout / PC failed
    failed --> [*]
    closed --> [*]

    note right of open
        P2P active
        _webrtcReady = true
    end note
    note right of failed
        Silent fallback to WS
        _webrtc = null
    end note
```

## Dual-Send Input Flow

When WebRTC is active, `sendInput()` sends each input twice via different paths:

```mermaid
flowchart TD
    SI["sendInput(frame, state)"] --> Check{_webrtcReady?}

    Check -- Yes --> P2P["WebRTC DataChannel\n→ opponent (P2P)"]
    Check -- Yes --> WS_Spec["WebSocket + spectatorOnly flag\n→ server → spectators only"]
    Check -- No --> WS_Full["WebSocket (no flag)\n→ server → opponent + spectators"]

    subgraph Receiving Side
        P2P --> DC_Recv["DC.onmessage\n→ remoteInputBuffer"]
        WS_Spec --> Srv_Spec["Server skips opponent\n→ broadcastToSpectators"]
        WS_Full --> Srv_Full["Server relays to opponent\n+ broadcastToSpectators"]
    end
```

WebSocket `input` messages are always accepted regardless of local DataChannel state. This prevents input loss during asymmetric reconnection (where one peer has DataChannel open but the other is still sending via WebSocket). No duplication risk: when a peer sends via DataChannel, its WebSocket copy uses `spectatorOnly` so the server won't forward it to the opponent.

## Fallback Scenarios

```mermaid
flowchart TD
    Start["_initWebRTC()"] --> STUN{"STUN succeeds?"}
    STUN -- Yes --> DC{"DataChannel opens\nwithin 5s?"}
    STUN -- No --> Timeout["5s timeout → onFailed"]
    DC -- Yes --> P2P["P2P active ✓"]
    DC -- No --> Timeout

    Timeout --> Fallback["_webrtcReady = false\n_webrtc = null\nWebSocket relay (transparent)"]

    P2P --> MidDrop{"DC drops mid-fight?"}
    MidDrop -- Yes --> WSFallback["onClose → _transportMode = 'websocket'\nNext sendInput uses WS"]
    MidDrop -- No --> Continue["Continue P2P"]
```

| Scenario | What Happens | User Impact |
|----------|-------------|-------------|
| Symmetric NAT (mobile carrier) | STUN fails → 5s timeout → WS fallback | None — same as before WebRTC |
| Corporate firewall blocks UDP | Same as above | None |
| WebRTC opens then drops mid-fight | `onClose` → fall back to WS | Brief latency increase, no disruption |
| Browser lacks WebRTC API | `typeof RTCPeerConnection === 'undefined'` → skip init | None |
| Both WS and WebRTC drop | Existing ReconnectionManager handles it (20s grace) | Pause overlay |

## Reconnection

```mermaid
sequenceDiagram
    participant P1 as P1
    participant S as Server
    participant P2 as P2

    Note over P1: WiFi drops
    Note over P1: WebRTC DC closes
    Note over P1: WebSocket closes

    S->>P2: opponent_reconnecting
    Note over P2: Pause overlay

    P1->>S: ws reconnect (PartySocket)
    P1->>S: rejoin
    S->>P2: opponent_reconnected

    Note over P2: _initWebRTC() again
    Note over P1: _initWebRTC() on opponent_reconnected

    P1->>S: webrtc_offer (new negotiation)
    S->>P2: webrtc_offer
    P2->>S: webrtc_answer
    S->>P1: webrtc_answer

    alt P2P succeeds
        Note over P1,P2: DataChannel reopens
    else P2P fails
        Note over P1,P2: Stay on WebSocket relay
    end
```

## Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| DataChannel `ordered` | `false` | Rollback handles reordering |
| DataChannel `maxRetransmits` | `0` | Rollback handles loss; retransmits add latency |
| STUN server | `stun:stun.l.google.com:19302` | Free, widely available |
| Connection timeout | 5000ms | Enough for STUN + ICE; fails fast for blocked UDP |
| Offerer | Always P1 (slot 0) | Deterministic role assignment |

## Key Files

| File | Role |
|------|------|
| `src/systems/WebRTCTransport.js` | RTCPeerConnection + DataChannel state machine |
| `src/systems/NetworkManager.js` | Dual transport orchestration, signaling relay, fallback |
| `party/server.js` | Signaling message relay (`webrtc_offer/answer/ice`), `spectatorOnly` input filter |
| `src/scenes/FightScene.js` | Transport indicator (P2P/WS) in bottom-left corner |
