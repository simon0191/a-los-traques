---
title: "Designing an agent team to suggest blog posts about an agent-team-built game"
date: "TBD"
summary: "Five Claude subagents triage 21 RFCs, 97 merged PRs, and a year of session transcripts into a deduped backlog of blog-post candidates — the post you're reading was suggested by the system it describes."
audience: "en-tech"
status: "draft"
---

This post was suggested by the agent team it describes.

The repo has 21 RFCs in `docs/rfcs/`, 97 merged PRs, and a few hundred Claude
Code session transcripts. The blog has one post — a welcome message. Manually
trawling that history for article-worthy stories never happened, because of
course it didn't. So we built a small team of subagents to do the triage:
three parallel miners scan PRs, RFCs, and transcripts, an editor merges and
dedupes the candidates against a JSON backlog, and a drafter expands one
chosen entry into a draft Markdown post.

The first end-to-end run produced 39 raw candidates that deduped to 31 backlog
entries. One of them was this post. The drafter is what you're reading.

A few things turned out to matter that I didn't predict from the spec, so the
rest of this is the dirty version: the part where the design met reality and
adjusted.

## The premise

The constraint that drove every architectural choice: **manual triage doesn't
happen**. If the system requires me to remember to run a script on Sundays, or
to scroll through PR titles when I have ten minutes, it will produce zero blog
posts forever. Same as the existing zero.

So the system has to be cheap to invoke (`/blog-mine`), incremental (only
scans material newer than a stored cursor), and durable (writes a backlog
file I can read on a phone). The output isn't a draft — it's a list of
*candidates* the user can browse, reject, or greenlight. Drafting only
happens on demand, one entry at a time, via `/blog-expand <id>`. The expensive
work is gated behind an explicit user action.

The other constraint: **PR descriptions can lie**. They're written before the
PR merges; they get edited mid-review; they sometimes describe an
intermediate version of the code. The miners can hint at what's interesting,
but the drafter has to verify against actual source code before it ships
anything. More on that below — it caught real bugs in the smoke test.

## Five agents, two slash commands

The shape settled at five named agents:

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

Three things justify three parallel miners instead of one general-purpose one:

**1. Each source has its own access pattern.** The PR miner shells out to `gh
pr list` and `gh pr view`. The RFC miner does `cat docs/rfcs/*.md`. The
transcript miner walks `~/.claude-personal/projects/*a-los-traques*` and
`~/.claude/projects/*a-los-traques*` (I sometimes use the company install by
accident), reads JSONL files in chunks, and tries to join sessions to PRs by
matching the worktree slug against PR head branch names. None of those
pipelines look like each other.

**2. Each source needs different judgment.** PRs get filtered by interestingness
heuristics ("rollback netcode" yes, "lint fix" no). RFCs get classified as
*lift-and-edit* (already a near-complete narrative), *pair-with-PR* (design
doc that needs the implementation reality), or *too-dry* (skip). Transcripts
look for AI-dev meta-stories: prompts that worked vs didn't, multi-agent
designs, hard agent debugging. Trying to encode all that into one prompt
would mean the agent context-switches mid-response.

**3. Parallelism is free here.** The three miners have no shared state. They
read different files, return different candidate arrays. The editor merges
them after. Three Agent dispatches in one message, three responses in roughly
the time of the slowest one.

Why a separate editor at all? **To keep judgment separate from mutation.** The
miners produce candidates. The editor decides which are new, which merge into
existing entries, which are duplicates of rejected ones. Then a deterministic
CLI applies the merge plan to the JSON file. The agent never edits the
backlog directly. If the agent's dedup judgment is wrong, the worst case is
duplicate entries — never corrupted JSON, never a lost user-set
`status: rejected`, never a wrong cursor.

## The mechanical-vs-LLM split

The interesting line in this design is between what the LLM does and what a
plain Node script does.

LLM does:
- Reads source material (PR bodies, RFC text, transcript chunks)
- Judges interestingness against a list of themes
- Picks a title and audience tag
- Decides whether a candidate is new, a merge, or a skip vs the existing backlog
- Writes the eventual draft prose

A 167-line Node CLI does:
- Loads and validates the backlog JSON (`scripts/blog-backlog/backlog.js`)
- Generates stable ids from title + supporting refs
  (`scripts/blog-backlog/id.js`)
- Applies a merge plan to the backlog (`scripts/blog-backlog/dedup.js`)
- Bumps cursors so the next run is incremental
- Refuses to write malformed entries

This split matters because the deterministic stuff is testable. The CLI has 27
unit tests covering load/save round-trips, schema validation, id stability
(same inputs → same id, regardless of supporting-ref order), and merge-plan
application (does a merge preserve user-set `status` and `notes`? does it
dedupe supporting refs by key?). When the agent's dedup judgment turns out to
be off, those tests still pass because they're testing the mutation layer,
not the judgment layer. The agent can be wrong without corrupting the file.

The id rule is small but load-bearing. The id is
`<kebab-slug-of-title>-<4-char-hash-of-supporting-refs>` — a SHA1 of sorted
ref keys, sliced to four hex chars. From `scripts/blog-backlog/id.js`:

```js
export function makeId(title, supporting) {
  const slug = slugify(title);
  const refs = supporting.map(refKey).sort().join('|');
  const hash = createHash('sha1').update(refs).digest('hex').slice(0, 4);
  return `${slug}-${hash}`;
}
```

The sort matters: if a re-run produces the same logical entry but lists its
refs in a different order, the id should still be stable. Otherwise dedup
fails and the backlog grows duplicates forever.

## The bug the design did not see coming

The first time `/blog-mine` ran, it failed three times in a row. The error
text:

```
Agent type 'pr-miner' not found.
Available agents: claude-code-guide, Explore, general-purpose, Plan,
                  statusline-setup, superpowers:code-reviewer
```

`pr-miner` was sitting right there in `.claude/agents/pr-miner.md`. The
plan called for the orchestrator to dispatch via `subagent_type: "pr-miner"`.
Same for `rfc-miner` and `transcript-miner`. None of them registered.

The reason: custom subagent types in `.claude/agents/<name>.md` only get
loaded into the agent registry at session start. We had created those files
in the same session that was now trying to use them. They wouldn't be
available until the next session — which is too late, because the slash
command has to work *now*.

The fix was a one-paragraph change in the skill markdown:

> Read each file and inline its full body as the prompt for a `general-purpose`
> Agent dispatch — that way the skill works in any Claude Code session
> (custom subagent_types only auto-register at session start; this dispatches
> via the always-available `general-purpose` agent).

Now `/blog-mine` reads `.claude/agents/pr-miner.md` from disk, drops the body
into the prompt for a `general-purpose` Agent dispatch, and gets the same
behavior. The agent file is still the canonical source of truth for the
miner's prompt — but the dispatch mechanism is whatever's actually available
right now.

This is the kind of thing you can't write into a spec because you don't know
about it until you trip on it. The shape of the system didn't have to change
— five agents, two skills, three parallel miners, all the same. The
*implementation detail* of how a slash command refers to an agent had to
change, in three files, after the design met reality.

## The drafter caught real bugs

The first smoke run also produced two drafts to validate both voice paths.
One was an `en-tech` post about the fighter balance simulation. The other
was an `es-friends` post about graceful reconnection. The miners produced
plausible-looking hooks for both. The drafter's job was to verify them against
actual source code before writing anything.

The reconnection hook said:

> Cuando el celular pierde señal en plena pelea, el rollback aguanta los
> primeros 117ms en silencio (8 frames de input prediction). [...] el
> server reserva tu slot 5 segundos.

Three numbers in that sentence; two of them were wrong. The drafter opened
`apps/party/server.js`:

```js
const GRACE_PERIOD_MS = 20000;
```

20 seconds, not 5. And `packages/game/src/scenes/FightScene.js`:

```js
maxRollbackFrames: 7 * speed,
```

7 frames, not 8. The hook had been written from PR #22's description without
checking whether the constants had drifted in the year and a half since merge.
They had.

The balance-sim hook said the project has 16 fighters. `packages/game/src/data/fighters.json`
has 17 — one was added after the original rebalance. The drafter caught that
too and adjusted the title to be honest about it: *Tier-listing 16 fighters
with 28,900 AI-vs-AI fights in 18 seconds*, with the body explaining the
17×17 matrix and noting that Motauakiller is the post-rebalance addition.

This is the part of the design I was most nervous about — agents confidently
asserting fake numbers — and the part that worked best in practice. The
discipline is one bullet in the drafter's prompt:

> Verify claims against source code, not PR descriptions. PR descriptions can
> be wrong or out of date. If a claim in the hook is contradicted by the code,
> prefer the code and adjust the post.

Combined with `Read` access to the actual source files, that turned out to be
enough. The drafter didn't ship any of the wrong numbers. It opened the
relevant constants files, found the truth, and quietly rewrote the prose.

## Three subagents in parallel from one message

The other thing the shape of the design forced into the open: when you
dispatch parallel agents, you do it in *one* message with multiple tool
calls, not three sequential messages. The blog-mine skill spells this out:

> Use a single message with three Agent tool calls (independent calls go in
> one message — see "## Using your tools" in the system prompt).

If you dispatch them sequentially the parallelism is gone — the orchestrator
waits for the first miner to return before starting the second. Three
sequential dispatches turn what should be a one-minute run into three minutes
of wall time, all of it serialized for no reason.

The other failure mode is dispatching three agents in three messages and then
trying to coordinate their output in a fourth. By the time you do that the
context has all three responses inlined; you've used context budget for
nothing. One message, three calls, one response with three tool results, then
the editor reads them. Clean.

## What the first run produced

After the registration fix, end-to-end:

- 39 raw candidates from the three miners (pr-miner returned the most;
  transcript-miner returned the fewest because most sessions are noise)
- 31 backlog entries after dedup
- 29 `en-tech`, 2 `es-friends`
- Cursor advanced to PR #151, RFC `0019-nextjs-monorepo-restructure.md`,
  transcript timestamp `2026-05-01T20:01:51Z`
- Two validation drafts: one tech-English (1550 words, target 1200–2500),
  one Spanish-friends (573 words, target 300–600)

The full backlog lives at `docs/blog-backlog.json`. It's checked in so it
survives machine swaps and so I can browse it on a phone. Each entry has
fields the user can edit: `status` (`proposed`, `greenlit`, `rejected`,
`drafted`, `published`), `notes` (free-form steering for the drafter), and
`audience`. The Editor agent respects `status: rejected` permanently — it
won't re-suggest the idea on future runs even if a new PR makes the
material come up again.

## What I'd do differently

A few things bug me about the current shape that I'm leaving for v2:

**Concurrency is a file-level lock.** If two `/blog-mine` runs happen at the
same time (different sessions, different worktrees), the second one blows up
on the lockfile. Fine for a one-user system, would not survive a team.

**The transcript miner is the loudest.** It reads everything from two
directories and produces a lot of weak signal. About 80% of the candidates
it generates get deduped or skipped. I could narrow its prompt further but
the failure modes there are hard to predict because every session is
different.

**Audience selection is heuristic.** The miners pick `en-tech`, `es-friends`,
or `both` based on whether the topic is project-internal or generalizable.
The user can flip it, but the right answer for some entries is genuinely
both, and that requires two `/blog-expand` runs because v1 only writes one
draft per invocation. Fine. Not a blocker.

**No background scheduling.** I'd like a Sunday-morning cron that runs
`/blog-mine` and writes a one-line summary to a file I can glance at. That's
maybe an hour of work and would change the surface area of the system from
"a thing I invoke" to "a thing that runs on its own and saves up findings."

## Sources

- [../docs/superpowers/specs/2026-05-01-blog-article-agent-team-design.md](../docs/superpowers/specs/2026-05-01-blog-article-agent-team-design.md)
- [../docs/superpowers/plans/2026-05-01-blog-article-agent-team.md](../docs/superpowers/plans/2026-05-01-blog-article-agent-team.md)
- [#152 — feat(blog-mine): five-agent blog backlog miner + drafter](https://github.com/simon0191/a-los-traques/pull/152)
- Transcript: `~/.claude-personal/projects/-Users-simon-personal-a-los-traques--claude-worktrees-blogs/8e2285b4-d498-4b5e-929d-80c46f72ab6a.jsonl`
- [scripts/blog-backlog/id.js](../scripts/blog-backlog/id.js)
- [scripts/blog-backlog/dedup.js](../scripts/blog-backlog/dedup.js)
- [.claude/skills/blog-mine/SKILL.md](../.claude/skills/blog-mine/SKILL.md)
- [.claude/agents/blog-drafter.md](../.claude/agents/blog-drafter.md)
