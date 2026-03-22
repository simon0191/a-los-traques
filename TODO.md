# TODO

## Network condition simulation with Toxiproxy

The E2E testing framework (`docs/e2e-testing.md`) currently tests determinism under ideal local network conditions. To catch bugs that only appear on real mobile networks, we need to simulate degraded connections.

**Idea**: Run [Toxiproxy](https://github.com/Shopify/toxiproxy) between the browsers and the PartyKit server to inject network failures at the TCP level.

### What Toxiproxy enables

- **Latency**: Add fixed or jittered delay (e.g., 80ms +/- 20ms to simulate mobile)
- **Packet loss**: Drop a percentage of traffic (e.g., 2-5% to simulate cellular)
- **Burst loss**: Drop all traffic for N ms (simulates brief signal loss)
- **Bandwidth limiting**: Throttle throughput to simulate slow connections
- **Disconnection**: Kill the connection mid-fight and verify graceful reconnection

### How it would work

1. Start Toxiproxy between browsers and PartyKit (`localhost:1999` → proxy → `localhost:2000`)
2. Configure upstream proxy in the game via `?partyHost=localhost:2000`
3. Playwright tests use Toxiproxy's API to add/remove "toxics" mid-fight
4. Verify: match still completes, resync recovers from desyncs, reconnection works within grace period

### Test scenarios

- **Good WiFi**: 30ms latency, 0.5% loss
- **Mobile cellular**: 80ms latency +/- 30ms jitter, 2% loss
- **Bad connection**: 150ms latency, 5% loss, occasional 500ms burst loss
- **Reconnection**: Kill connection for 5s mid-fight, verify grace period recovery
- **Asymmetric**: P1 on good connection, P2 on bad — tests one-sided rollback pressure

### Why not Playwright's route() API

Playwright can intercept HTTP requests but not WebSocket frames or WebRTC DataChannels. Toxiproxy operates at the TCP level, affecting all traffic including WebSocket connections after the upgrade handshake.
