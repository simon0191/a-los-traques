---
name: code-review
description: Write a thorough code review for a pull request in the A Los Traques repository. Use this skill whenever the user asks to review a PR, review changes, review a branch, give feedback on code, check a diff, or audit a change for issues — even if they don't say "review" explicitly (e.g. "take a look at PR #123", "what do you think of this diff?", "is this ready to merge?", "go over my changes"). The review follows the project's established format (severity-tiered issues, summary table, code suggestions) and enforces this repo's architectural guardrails around simulation determinism, rollback netcode, and the Phaser/simulation boundary.
---

# Code Review

Write a structured, high-signal code review for a pull request in this repo. The goal is a review the author can act on: concrete issues ordered by severity, each with a clear explanation of *why* it matters and a suggested fix when useful.

This skill has two halves:

1. **Workflow** — how to gather context, read the diff, and assemble the review (this file).
2. **Project-specific rules** — the architectural guardrails and recurring review themes for this codebase (see `references/`).

Read the reference files only when the diff touches the relevant area. For a small CSS tweak, you don't need the netcode rules.

## Workflow

### 1. Gather the diff and context

If the user gave a PR number, fetch everything you need in one go:

```bash
# Metadata, description, files changed
gh pr view <N> --json title,body,author,state,headRefName,baseRefName,files,additions,deletions,commits
gh pr diff <N>

# Any existing comments/reviews (so you don't repeat them)
gh api repos/{owner}/{repo}/pulls/<N>/comments
gh api repos/{owner}/{repo}/pulls/<N>/reviews
```

If the user points at a branch or uncommitted changes, use `git diff <base>...HEAD` or `git diff` instead.

Before writing anything, make sure you understand:

- **What is this PR trying to do?** Read the description. If it references an issue or RFC, skim that too.
- **What files changed, and what layers do they touch?** Simulation, scenes, network, API, party server, tests, docs? This tells you which reference files to pull in.
- **Is there prior review history?** If this is round 2+, note which items were flagged before and check whether they were addressed.

Don't review a diff you haven't read end-to-end. For non-trivial PRs, also open key unchanged files to understand how the change fits in — reviews in this repo consistently catch bugs by tracing data flow across files the diff didn't touch (scene chains, network message paths, state machine transitions).

### 2. Pick the right reference files

Read these only when relevant:

- **`references/architecture-guardrails.md`** — Simulation purity, fixed-point determinism, event-driven presentation, network layer boundaries. Pull in whenever the PR touches `src/simulation/`, `src/entities/Fighter.js`, `src/systems/net/`, `src/systems/CombatSystem.js`, `party/server.js`, or rollback/checksum logic.
- **`references/review-checklist.md`** — The full per-area checklist (API, scenes, tests, CI, docs). Pull in for larger PRs or when you want a reminder of what to check in an area you don't review often.
- **`references/review-template.md`** — The exact output format with a worked example. Pull in when you're about to write the review and want to double-check the structure.

### 3. Form a mental model, then read the diff with intent

For each changed file, ask:

- Does this change do what the PR says it does?
- What are the *edge cases* at the boundaries — scene transitions, network races, optimistic-vs-authoritative state, what happens when a message is lost or arrives late, what happens during rollback re-simulation?
- Is existing behavior preserved for paths the PR didn't mean to change? (Regression prevention is one of the most common things flagged in this repo.)
- Does the change scope match the PR description, or did it grow sideways into unrelated refactors?
- **Is there test coverage for the new/changed behavior?** See the next subsection — this is one of the core checks on every PR.

Trace data flow. If a bug fix touches `onMatchOver` in one place, search for other callers — that's how the "same bug still present in the main path" comments get caught.

#### Test coverage — what to actually check

This repo has a clear testing contract: **pure logic must have tests**. The reason the simulation layer is strictly pure (no Phaser, no wall clock, no I/O) is precisely so it can be unit-tested in isolation — that's why rollback netcode is viable at all. A PR that adds pure logic without tests is regressing the project's strongest quality lever.

When reading the diff, classify each changed/added function:

- **Pure logic that must have tests.** Anything under `src/simulation/`, `src/systems/combat-math.js`, `src/systems/FixedPoint.js`, `src/systems/InputBuffer.js`, `src/systems/MatchStateMachine.js`, `src/systems/ReconnectionManager.js`, `src/entities/combat-block.js`. Also: the pure parts of `src/services/TournamentManager.js` (bracket logic, seeding), pure helpers in `src/systems/net/` like `InputSync` input buffering, and anything in `party/server.js` that's state-machine logic rather than PartyKit glue. API handlers in `api/` always get tests (with mocked `db` + `jose`). If you can't think of a reason the function couldn't be unit-tested, it's pure.
- **Hard-to-test layers.** Phaser scenes, sprite wrappers (`Fighter.js`), audio/VFX bridges, WebRTC transport code. These rarely get unit tests and that's fine — don't flag missing tests here.
- **Bug fixes.** A bug fix that doesn't add a regression test is a yellow flag even in hard-to-test layers — if the bug can be reproduced in the pure layer, there should be a test that would have caught it. The recent `VictoryScene` stats test (commit `ac38c45`) is the pattern: the scene itself is Phaser, but the stat computation was extracted to a pure function and tested.

What to flag, and at what severity:

- **Critical** — PR claims a behavior in the description (including bug fixes) but the corresponding test doesn't exist. This is a recurring finding in past reviews and should be called out directly.
- **Critical** — PR adds non-trivial pure logic (a new combat mechanic, state machine transition, SQL query builder, tournament algorithm) with zero tests. Pure logic without tests tends to rot silently because no one notices when it breaks.
- **Moderate** — Tests exist but assert on implementation details rather than behavior (classic example flagged previously: `expect(sql).toContain('ORDER BY created_at DESC')`). Suggest a refactor that tests the contract, not the mechanics.
- **Moderate** — Tests exist but don't cover the interesting branches (e.g. new function has a test for the happy path but none of the `if` branches from the diff are exercised). Mention which branches need coverage.
- **Moderate** — E2E multiplayer flow changed (`src/systems/net/*`, rollback logic, `party/server.js` state transitions) without updating `tests/e2e/` or `tests/party/`. These are the tests that catch desyncs and reconnection regressions.
- **Minor** — Missing test for a small refactor of already-tested code, or missing test for pure logic that's trivially obvious from reading.

If the author claims "tests pass," trust but verify — running `bun run test:run` locally against their branch is cheap, and CI signal alone doesn't tell you whether the new tests test the right thing.

### 4. Categorize issues by severity

Use four tiers. Being honest about severity is what makes the review actionable — a wall of "Critical" items loses signal fast.

- **Critical** — bugs, regressions, security issues, data loss, determinism breaks, anything that would make the PR unsafe to merge as-is. Include: missing code paths, race conditions, state machine invariant violations, missing JWT checks, Phaser imports leaking into simulation, non-deterministic code in the sim path, **new pure logic shipped without tests, or tests claimed in the PR description that don't actually exist in the diff**.
- **Moderate** — architectural smells, dependency direction issues, brittle test assertions (asserting on implementation like SQL substrings instead of behavior), incomplete test coverage of new branches, copy-pasted logic that should be shared, scope creep. Things the author should probably address before merge but aren't safety issues.
- **Minor** — naming, small dead code, unreachable branches, leftover debug logs, minor duplication, missing docstrings on non-obvious logic.
- **Nits** — truly optional: phrasing, formatting (beyond what Biome catches), suggestions that are "your call".

If everything is Critical, you're using the tiers wrong. If nothing is Critical, say so explicitly — "no blockers" is useful information.

### 5. Write the review

Follow the structure in `references/review-template.md`. Key elements:

1. **Opening line** acknowledging what the PR does well (one sentence — don't pad).
2. **Severity-tiered sections** (`### Critical`, `### Moderate`, `### Minor`, `### Nits`). Omit empty tiers.
3. **Each issue**: file + line reference, short title, 1-3 sentence explanation of the problem and *why* it matters, and a concrete suggestion or code snippet when useful.
4. **Summary table** at the end for PRs with 3+ issues, tracking status across rounds if this is a follow-up review.
5. **Approval signal**: end with "LGTM" / "Ship it" if approving, "Changes requested" if not, or "Approved with nits" if only nits remain.

Use file:line references (`src/scenes/FightScene.js:342`) so the author can jump straight there.

### 6. Self-review before posting

Before finishing, re-read your own review with fresh eyes and ask:

- **Is each issue actually a problem?** It's easy to flag things that *look* wrong but are fine once you understand the context. If you're unsure, lower the severity or frame it as a question ("is there a reason X?") rather than a demand.
- **Does severity match impact?** A style nit marked Critical trains the author to ignore severity labels.
- **Would the author know *why* this matters?** "Explain the why" — a review that says "use Logger" is weaker than "use Logger here because `console.log` doesn't make it into the debug bundle, so this log won't help when debugging desyncs in the field."
- **Did you flag anything that's out of scope for the PR?** Out-of-scope observations are fine but mark them as such ("out of scope, but...") so the author isn't pressured to address them here.

### 7. Delivery

Post the review as a PR comment if the user asked you to (`gh pr review <N> --comment --body-file <path>` or `gh pr review <N> --request-changes ...` / `--approve`), or return it for the user to edit and post themselves. Default to returning it unless the user said to post directly — review comments are visible to collaborators and shouldn't be sent without explicit intent.

## Tone

Direct but collaborative. The reviews that work best in this repo are ones where the author feels informed rather than scolded. A few phrases that tend to land well:

- "Not blocking but worth considering…" (for moderates/minors)
- "Your call, but I'd lean toward X because…" (for design choices)
- "This was flagged in the previous review and not addressed" (for repeat issues — be firm)
- "Happy to pair on this if it's thorny" (for complex fixes)

Avoid:

- Vague gripes without a suggested direction ("this is confusing").
- Demanding stylistic preferences as if they were bugs.
- Wall-of-text explanations for minor issues. Save the long explanations for the Critical items.

## When the PR is small

Don't over-review. A 10-line bug fix might need a two-sentence review: "Fix looks right, matches the flow in `onRoundEnd`. No other call sites affected. LGTM." Matching the review depth to the change size is part of writing a good review.
