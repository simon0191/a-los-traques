/**
 * AutoplayController — reads URL params to enable automated game play for E2E testing.
 *
 * URL params:
 *   ?autoplay=1        — enable autoplay mode
 *   ?fighter=simon     — pick specific fighter (default: random)
 *   ?createRoom=1      — create a new room (P1)
 *   ?room=XXXX         — join existing room (P2, already handled by BootScene)
 *   ?aiDifficulty=medium — AI difficulty (default: medium)
 *   ?seed=12345        — deterministic PRNG seed for reproducible AI decisions
 */
export class AutoplayController {
  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.enabled = params.get('autoplay') === '1';
    this.fighterId = params.get('fighter') || null;
    this.createRoom = params.get('createRoom') === '1';
    this.aiDifficulty = params.get('aiDifficulty') || 'medium';
    this.seed = params.has('seed') ? parseInt(params.get('seed'), 10) : null;
  }
}
