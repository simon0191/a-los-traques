# RFC 0002: Tournament Mode

## Status
Proposed

## Context
Provide a structured, competitive local experience for players by organizing matches into automated brackets of 8 or 16 fighters.

## Proposed Changes

### 1. New Scenes
- `TournamentSetupScene`: Selection of tournament size (8 or 16 characters).
- `BracketScene`: Visual representation of the tournament tree, handling match progression and AI simulations.

### 2. Tournament Logic
- **Bracket Generation**: Shuffles available fighters and assigns them to matches. The player is always placed in the P1 slot of their matches to maintain consistent control schemes.
- **AI Match Simulation**: Matches not involving the player are automatically simulated with a random winner, advancing the tournament locally.
- **Match Advancement**: Winners move to the next round. If the player wins, they face the winner of the adjacent match.

### 3. Scene Integration
- `SelectScene`: Modified to handle `tournament` mode, allowing the player to pick their fighter before generating the bracket.
- `PreFightScene` & `FightScene`: Updated to pass tournament state through the combat loop.
- `VictoryScene`: Updated to record the match result in the tournament state and provide a "CONTINUAR" button to return to the bracket.

## Implementation Details
- Tournament state is passed as an object `{ size, rounds, complete }`.
- `rounds` is an array of match arrays, where each match is `{ p1, p2, winner }`.
- Player character name is highlighted in RED in the bracket view for clarity.
- AI winners are highlighted in GREEN.

## Alternatives Considered
- **Full simulation**: Simulating every match (even AI) visually, but this was rejected as too slow for a single-player experience.
- **Persistent Storage**: Saving tournament progress across sessions. Deferred for future Phase.
