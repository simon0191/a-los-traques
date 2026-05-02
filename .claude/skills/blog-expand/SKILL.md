---
name: blog-expand
description: Expand a single blog backlog entry into a draft Markdown post under apps/web/content/blog/_drafts/. Reads supporting refs (PRs, RFCs, transcripts, code) to verify claims. Use when the user types /blog-expand <id> or asks to "draft the post about X", "expand backlog entry Y", "write the rollback post".
---

# /blog-expand

Expand one backlog entry into a draft post.

## Workflow

### 1. Resolve the id

The user passes an id as the slash command argument (e.g. `/blog-expand rollback-resimulation-events-2a3f`).

If no id is provided, list `proposed` and `greenlit` entries with their ids and ask the user which to expand.

### 2. Fetch the entry

```bash
node scripts/blog-backlog/cli.js get <id>
```

If the CLI exits non-zero, the id is wrong. Suggest the closest matches by listing `id`s from `cat docs/blog-backlog.json`.

### 3. Refuse on bad status

- `status: rejected` → refuse: "this entry is rejected; flip status to `proposed` if you want to resurrect it."
- `status: published` → refuse.
- `status: drafted` → ask the user explicitly: "draft already exists at `<draftPath>`. Overwrite? (yes/no)"

### 4. Compute draft path

```
apps/web/content/blog/_drafts/<id>.md
```

### 5. Dispatch the drafter subagent

The drafter agent definition lives in `.claude/agents/blog-drafter.md`. Read it and inline its body as the prompt for a `general-purpose` Agent dispatch (custom subagent_types only auto-register at session start; this dispatches via the always-available `general-purpose` agent).

```
drafterBody = Read('.claude/agents/blog-drafter.md')

Agent({
  subagent_type: "general-purpose",
  prompt: `Entry: <full entry JSON>\ndraft_path: apps/web/content/blog/_drafts/<id>.md\n\n---\n\n${drafterBody}`
})
```

The drafter writes the file directly and returns the relative path on stdout.

### 6. Update the backlog

```bash
node scripts/blog-backlog/cli.js update <id> --status drafted --draftPath "apps/web/content/blog/_drafts/<id>.md"
```

### 7. Report to the user

- Path to the draft.
- Word count: `wc -w apps/web/content/blog/_drafts/<id>.md`.
- Reminder: drafts under `_drafts/` are not picked up by `apps/web/lib/blog.ts`. Move the file up one directory and set `date:` (replacing `TBD`) when ready to publish.

## Failure modes

- **Drafter writes nothing** → don't update the backlog. Report the failure.
- **Path collision** with an existing draft → covered by the `drafted` status check above.

## Hard constraints

- Don't move the draft out of `_drafts/`. Publication is a manual step.
- Don't change `audience`, `notes`, `rationale`, or `supporting` on the entry.
- Don't overwrite without explicit consent.
