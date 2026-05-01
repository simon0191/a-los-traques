---
name: blog-mine
description: Run the blog-post backlog miner. Reads the cursor in docs/blog-backlog.json, dispatches pr-miner / rfc-miner / transcript-miner in parallel, runs LLM-judged dedup against existing entries, and writes the updated backlog. Incremental — only scans material since the last run. Use when the user types /blog-mine or asks to "find new blog ideas", "scan PRs for posts", "update the backlog".
---

# /blog-mine

Mine new blog-post ideas from PRs, RFCs, and Claude Code transcripts.

## Workflow

### 1. Bootstrap

```bash
node scripts/blog-backlog/cli.js init
```

(no-op if the backlog already exists).

### 2. Read the current cursor

```bash
node scripts/blog-backlog/cli.js cursor
```

The output is a JSON object like `{"pr": 151, "rfc": "0019-nextjs-monorepo-restructure.md", "transcript": "2026-05-01T16:00:00Z"}`.

### 3. Read the existing backlog (for dedup judgment)

```bash
cat docs/blog-backlog.json
```

You'll need the existing entries' `id`, `title`, `hook`, `supporting`, `status` to judge dedup. Do **not** consider entries with `status: "rejected"` for merging — they're suppressed forever — but **do** consider them for skip-suggestion (don't re-suggest a rejected idea).

### 4. Dispatch the three miners in parallel

The miner agent definitions live in `.claude/agents/{pr-miner,rfc-miner,transcript-miner}.md`. Read each file and inline its full body as the prompt for a `general-purpose` Agent dispatch — that way the skill works in any Claude Code session (custom subagent_types only auto-register at session start; this dispatches via the always-available `general-purpose` agent).

Use a single message with three Agent tool calls (independent calls go in one message — see "## Using your tools" in the system prompt).

```
prBody = Read('.claude/agents/pr-miner.md')
rfcBody = Read('.claude/agents/rfc-miner.md')
transcriptBody = Read('.claude/agents/transcript-miner.md')

Agent({
  subagent_type: "general-purpose",
  prompt: `Inputs:\n- since_pr_number: <N>\n- repo_path: <cwd>\n\n---\n\n${prBody}`
})
Agent({
  subagent_type: "general-purpose",
  prompt: `Inputs:\n- since_rfc_filename: "<F>"\n- repo_path: <cwd>\n\n---\n\n${rfcBody}`
})
Agent({
  subagent_type: "general-purpose",
  prompt: `Inputs:\n- since_transcript_mtime: <T>\n- transcript_roots: ~/.claude-personal/projects, ~/.claude/projects\n\n---\n\n${transcriptBody}`
})
```

Each subagent returns its candidate JSON array + `_cursor` line on stdout (in its final message).

### 5. Parse miner outputs

Each miner's last message ends with a `_cursor` JSON line. Strip it from the candidates array. Aggregate all candidates from all three miners into one list.

### 6. Run LLM-judged dedup against the existing backlog

For each candidate, decide one of:

- **`new`** — no existing entry covers this material.
- **`merge` into `<id>`** — an existing entry covers the same story (semantic overlap on title+hook, OR overlapping `supporting` set, OR clear topical match). Pick the existing entry whose scope subsumes this candidate.
- **`skip`** — exact dup of an existing rejected entry, or this candidate is too thin to add value.

**Mechanical rule (always applies first):** if a candidate's `supporting` set has a PR# or RFC ref already present in any non-rejected entry, default to merge into that entry unless the title/hook clearly indicate a different story.

### 7. Build the merge plan

```json
{
  "new": [<candidate>, ...],
  "merge": [{ "intoId": "<existing-id>", "candidate": <candidate> }, ...],
  "skip": [<candidate>, ...],
  "cursor": {
    "pr": <highest pr scanned>,
    "rfc": "<lexicographically last rfc scanned>",
    "transcript": "<latest transcript mtime scanned>"
  }
}
```

Write to a temp file:

```bash
cat > /tmp/blog-mine-plan.json <<'EOF'
<plan json>
EOF
```

### 8. Apply the plan

```bash
node scripts/blog-backlog/cli.js apply --plan /tmp/blog-mine-plan.json
```

Output is `{"added": N, "merged": M, "skipped": K, "cursor": {...}}`.

### 9. Report

Tell the user:

- N new entries added (list titles).
- M existing entries had refs merged in (list ids + titles).
- K candidates skipped.
- New cursor.
- Suggest: "Review `docs/blog-backlog.json`. Edit `status: greenlit` on ones you want, `status: rejected` on ones you don't, and use `notes:` to steer the drafter. Run `/blog-expand <id>` to draft a post."

## Failure modes

- **A miner returns malformed JSON** → log to the user, skip that miner's output, continue with the others. Do not abort.
- **`gh` not authenticated** → tell the user `gh auth login` is needed for pr-miner.
- **No new material since last cursor** → all three miners return empty arrays. Print "Nothing new since last run." and exit without writing.

## Hard constraints

- Never edit `docs/blog-backlog.json` directly. Always go through `cli.js apply`.
- Never edit the `status` or `notes` fields of existing entries during a merge — those are user-owned.
- Do not call `/blog-expand` automatically. The user picks which ideas to expand.
