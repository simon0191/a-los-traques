# Blog Article Agent Team — Design

**Date:** 2026-05-01
**Status:** Approved by Simon, ready for implementation plan
**Owner:** Simon Soriano

## Problem

A Los Traques is a learning/artistic project between friends with rich source material for technical blog posts: 19 RFCs, ~30+ merged PRs covering rollback netcode, simulation determinism, AI asset generation, RFC-driven workflow, multiplayer debuggability, and more. Today the blog has a single welcome post. Manually trawling history to identify article-worthy stories is slow and easy to skip.

We want a team of Claude agents that mines the repo's history (PRs, RFCs, code) plus Claude Code session transcripts, proposes a backlog of article ideas with supporting refs, and on demand expands a chosen idea into a draft post.

## Goals

- Generate a maintained backlog of candidate article ideas, each with a supporting evidence trail.
- Support both **friends-Spanish** (warm, project-diary) and **tech-English** (concrete, generalizable) audiences, tagged per article.
- Be incremental — re-runs only consider new material, deduplicate against existing entries, respect user feedback (status + notes).
- Keep the heavy work (reading code, verifying claims) for on-demand expansion, not backlog generation.
- Treat source code and commit history as ground truth; PR descriptions are hints, not authoritative.

## Non-Goals

- Auto-publish. Drafts always sit in `_drafts/` until manually moved.
- Auto-translate. `audience: both` produces a single-language draft per run; the other language requires a separate run.
- Image generation for posts.
- Touching live blog files outside `_drafts/`.
- Self-improving prompts, online learning, RLHF.
- GitHub-issue surface for the backlog (may be added later).

## Architecture

Five named Claude agents and two slash commands. The Editor is the only writer of the backlog file.

```
/blog-mine                       /blog-expand <id>
     │                                  │
     ▼                                  ▼
┌─────────────┐                   ┌──────────────┐
│  Editor     │                   │  Drafter     │
│ (orches.)   │                   │  (single)    │
└─────┬───────┘                   └──────┬───────┘
      │ reads cursor                     │
      │ dispatches in parallel:          │ reads supporting refs
      │                                  │ writes _drafts/<slug>.md
      ▼                                  ▼
┌──────────┬──────────┬─────────────┐
│ pr-miner │ rfc-miner│ transcript- │
│          │          │ miner       │
└────┬─────┴────┬─────┴──────┬──────┘
     │          │            │
     └──────────┴────────────┘
                │ candidates → Editor
                ▼
       merge + dedupe → docs/blog-backlog.json
```

### Components

#### `pr-miner` (subagent, parallel)

- **Input:** `since_pr_number`, repo path.
- **Reads:** `gh pr list --state merged --search "merged:>X"` then `gh pr view <n> --json title,body,files,reviewComments` per PR.
- **Judges interestingness against:** rollback/netcode, simulation/determinism, AI asset generation, RFC-driven process, multiplayer debuggability, asset pipeline, gnarly bug stories. Skips routine fixes/lints/format-only PRs.
- **Output:** array of candidate entries (see schema below).

#### `rfc-miner` (subagent, parallel)

- **Input:** `since_rfc_filename`.
- **Reads:** `docs/rfcs/*.md` newer than the cursor (file mtime + filename ordering).
- **Behavior:** Most RFCs are already half-written posts. The miner identifies (a) RFCs that *are* the post (lift-and-edit), (b) RFCs that need pairing with a PR for implementation reality, (c) RFCs too dry to stand alone.
- **Output:** array of candidate entries.

#### `transcript-miner` (subagent, parallel)

- **Input:** `since_transcript_mtime`, both transcript roots:
  - `~/.claude-personal/projects/*a-los-traques*` (primary, `CLAUDE_CONFIG_DIR=~/.claude-personal`)
  - `~/.claude/projects/*a-los-traques*` (occasional accidental use of company install)
- **Reads:** JSONL session files. Streams in chunks (500-line) to stay in token budget; summarises per chunk and synthesises across chunks per session.
- **Joins:** worktree slug → branch name → PR number when possible.
- **Looks for:** AI-dev meta-stories — prompts that worked vs. didn't, multi-agent designs, hard-to-debug agent behaviors, the RFC-driven workflow in action.
- **Output:** candidate entries with `supporting` referencing transcript paths + linked PR/RFC where joinable.

#### `editor` (orchestrator, invoked by `/blog-mine`)

- Loads `docs/blog-backlog.json` (initialises if absent).
- Dispatches the three miners in parallel via the Agent tool.
- Receives candidate arrays and runs dedup (LLM-judged, not algorithmic):
  - Same `supporting.pr` already present and `status != rejected` → skip.
  - Semantic overlap on title+hook OR overlapping `supporting` set → merge into existing entry (append refs, preserve user-set `status`/`notes`/`rationale`).
- Assigns stable `id` (kebab-case from title + 4-char hash from supporting refs).
- Writes back to JSON, bumps cursors.
- Reports a summary: N new, M merged, K skipped.

#### `drafter` (single agent, invoked by `/blog-expand <id>`)

- Loads the entry. Refuses if `status` ∈ `{rejected, published}`.
- Reads each `supporting` ref via the appropriate tool: `gh pr view --json files`, `git show <commit>`, `Read` for code files, JSONL chunks for transcripts.
- Drafts to `apps/web/content/blog/_drafts/<slug>.md` with frontmatter `title`, `date: TBD`, `summary`, `audience`, `status: draft`.
- Updates the backlog entry: `status: drafted`, `draftPath: "..."`.
- Voice rules baked into the agent prompt per `audience` tag (see Voice Rules below).

## Backlog Schema (`docs/blog-backlog.json`)

```json
{
  "version": 1,
  "cursor": {
    "pr": 151,
    "rfc": "0019-nextjs-monorepo-restructure.md",
    "transcript": "2026-05-01T16:00:00Z"
  },
  "entries": [
    {
      "id": "rollback-resimulation-events-2a3f",
      "title": "Rollback netcode: why we kill audio during resimulation",
      "hook": "GGPO-style rollback re-runs the simulation up to 7 frames per misprediction. Naive code re-fires every hit-spark and KO sound. Here's the event-bus refactor that fixed it.",
      "audience": "en-tech",
      "targetLength": 1800,
      "supporting": [
        {"type": "rfc", "ref": "0001-networking-redesign.md"},
        {"type": "pr", "number": 91},
        {"type": "code", "ref": "packages/sim/src/CombatSim.js"}
      ],
      "status": "proposed",
      "notes": "",
      "rationale": "Concrete bug → architectural fix → generalizable lesson. Strong title.",
      "createdAt": "2026-05-01T16:30:00Z",
      "lastSeenAt": "2026-05-01T16:30:00Z",
      "draftPath": null
    }
  ]
}
```

### Field semantics

- **`cursor.pr`**: highest merged-PR number scanned. Next run scans PRs merged after this.
- **`cursor.rfc`**: lexicographically last RFC filename scanned. Next run scans RFCs alphabetically greater than this.
- **`cursor.transcript`**: ISO timestamp of the newest transcript file mtime scanned. Next run scans transcripts with mtime > this.
- **`id`**: kebab-case slug from title + 4-char hash of supporting refs. Stable across re-runs.
- **`audience`**: one of `es-friends`, `en-tech`, `both`.
- **`targetLength`**: integer word count. Friends posts 300–600, tech posts 1200–2500.
- **`supporting[].type`**: `pr` | `rfc` | `transcript` | `commit` | `code`. Each type has its own ref shape (`number` for PR, filename for RFC/transcript/code, sha for commit). Miners typically emit `pr`/`rfc`/`transcript`; the Drafter adds `commit`/`code` refs as it verifies claims during expansion.
- **`status`**: `proposed | greenlit | rejected | drafted | published`. User-editable; agents respect it.
- **`notes`**: free-form user steering for the Drafter. Empty by default.
- **`rationale`**: agent's one-line justification for proposing this entry.
- **`draftPath`**: relative path under `apps/web/content/blog/_drafts/` once expanded.

## User Surface

### Slash commands

- **`/blog-mine`** — runs the Editor + three miners in parallel. Incremental (since last cursor). Reports summary at end.
- **`/blog-expand <id>`** — runs the Drafter on one entry. Refuses if status is `rejected`/`published`.

### Feedback loop (manual JSON edits)

- Set `status: rejected` to permanently dismiss; the Editor blocks re-suggestion on dedup match.
- Set `status: greenlit` to mark "I want this written"; `/blog-expand` operates on `proposed` or `greenlit`.
- Edit `notes` to steer the next expansion ("lead with the bug, not the architecture", "skip the merge timeline", "pair with PR #97 for the asymmetric variant").

## Voice Rules

Encoded in the Drafter agent prompt; selected per `audience` tag.

### `es-friends`

- Warm, casual, project-diary. In-jokes about friends-as-fighters welcome.
- Short paragraphs. First-person plural ("hicimos", "decidimos", "nos rompimos").
- One-shot example pulled from `apps/web/content/blog/welcome.md`.
- Target length: 300–600 words.

### `en-tech`

- Concrete, no-fluff, code over prose. Julia Evans / Dan Luu reference vibe.
- Lead with the bug or the surprising fact, not "in this post we will".
- Short paragraphs, code blocks with file:line refs, no apology paragraphs.
- Target length: 1200–2500 words.

### `both`

- Drafter picks the primary language from the source material (most RFCs are English; transcripts are mixed). The other language is produced by a separate `/blog-expand <id>` run after manually flipping the audience tag (out of scope for v1 automation).

## Defaults & Sources

- **Source scope:** PRs + RFCs + transcripts at backlog-generation time. Code + commit history loaded on demand by the Drafter for verification.
- **Drafts location:** `apps/web/content/blog/_drafts/`. The existing `apps/web/lib/blog.ts` only reads top-level `.md`/`.mdx`, so drafts under `_drafts/` won't ship until manually moved.
- **Backlog file:** `docs/blog-backlog.json`. Committed to repo so friends can browse and dedup state survives machine swaps.

## Error Handling & Edge Cases

- **Miner returns empty / errors** → Editor logs and continues with the others. A single bad miner doesn't kill the run.
- **Backlog file missing** → Editor initialises with `cursor: {pr: 0, rfc: "", transcript: "1970-01-01T00:00:00Z"}` and treats first run as full backfill.
- **Transcript JSONL too large for one read** → transcript-miner reads in 500-line chunks, summarises per chunk, then synthesises across chunks. (Not solving "infinite transcript" — if it's a problem, add a per-session token budget later.)
- **Dedup false negatives** (same idea, different wording) → user sees both, sets one to `rejected` with `notes: "duplicate of <id>"`. Editor learns nothing automatically; the rejected entry just blocks re-suggestion.
- **Drafter on a friends-Spanish post** → voice rules in the agent prompt + one-shot example from `welcome.md`.
- **Concurrent runs** → file-level lock (`docs/blog-backlog.json.lock`); Editor fails loudly if present.
- **`/blog-expand` on missing id** → Drafter errors clearly listing the closest matching ids.
- **`/blog-expand` on already-`drafted` entry** → Drafter offers to overwrite the existing draft after explicit confirmation.

## Testing

- **Backlog schema:** small Vitest suite under `tests/blog-backlog/` validating JSON parses, status enums, supporting-ref shapes.
- **Editor dedup:** unit tests with synthetic candidate arrays + an existing backlog → asserts merge/skip/append behavior. No real agent calls.
- **Miner agents:** prompt-only artifacts, not unit-tested. Validate by eye on first run.
- **Drafter:** not unit-tested. Validate by inspecting the first 2-3 drafts produced.

## Files Created

- `docs/blog-backlog.json` — the backlog (committed).
- `docs/superpowers/specs/2026-05-01-blog-article-agent-team-design.md` — this design doc.
- `.claude/skills/blog-mine/SKILL.md` — slash command + Editor orchestrator instructions.
- `.claude/skills/blog-expand/SKILL.md` — slash command + Drafter invocation instructions.
- `.claude/agents/pr-miner.md` — subagent definition.
- `.claude/agents/rfc-miner.md` — subagent definition.
- `.claude/agents/transcript-miner.md` — subagent definition.
- `.claude/agents/blog-drafter.md` — subagent definition.
- `tests/blog-backlog/schema.test.ts` — schema validation tests.
- `tests/blog-backlog/dedup.test.ts` — Editor dedup behavior tests.

## Open Questions

None at design-approval time. Future iterations may add:

- GitHub-issue surface for greenlit ideas (commenting + reactions for friends).
- Auto-translate from `both` audience.
- `/schedule` integration for weekly background mining.
- A `last-run-summary.md` artifact next to the backlog for at-a-glance reporting.
