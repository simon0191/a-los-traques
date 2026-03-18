# Skill: Generate Fighter Assets

End-to-end pipeline for generating a fighter's sprite assets: golden reference, animation frames, manual facing review, and fixes.

## Usage
`/generate-fighter <fighter_id>` — e.g., `/generate-fighter simon`

Requires:
- `assets/manifests/fighter_{id}.json` with description, animations, referenceSheet
- `assets/manifests/reference_{id}.json` with id, description
- `GEMINI_API_KEY` environment variable set
- Optional: `referenceImages` in manifests (photos in `assets/photos/`), but pipeline works without them

## Workflow

### Phase 0: Clean Stale Cache (if regenerating)

If this fighter already has generated assets, clean everything first:
```bash
rm -rf assets/_raw/fighters/{id}
rm -f public/assets/fighters/{id}/*.png
rm -f public/assets/portraits/{id}.png
# If golden reference changed, also delete derivatives (keep {id}_ref.png):
rm -f assets/references/{id}_ref_nobg.png assets/references/{id}_ref_cropped.png assets/references/{id}_ref_padded.png assets/references/{id}_ref_clean.png assets/references/{id}_ref_labeled.png
```
**This is critical** — the pipeline reuses cached frames from `assets/_raw/` and will produce stale output if old files exist.

### Phase 1: Golden Reference

1. Run the reference pipeline:
   ```
   node scripts/asset-pipeline/cli.js reference assets/manifests/reference_{id}.json
   ```
   If a golden reference `{id}_ref.png` already exists and just needs reprocessing (new bg removal, etc.), use `--skip-generate` to skip the Gemini call.
2. Read `assets/references/{id}_ref_clean.png` and show it to the user.
3. Ask the user to confirm: "Does this reference look good? Is the character facing RIGHT?"
4. If the user says no, re-run. If the description mentions green, confirm magenta background is being used (the pipeline auto-detects this).

### Phase 2: Generate Animation Frames

1. Ensure the fighter manifest (`assets/manifests/fighter_{id}.json`) has `"referenceSheet": "assets/references/{id}_ref_padded.png"`.
2. Verify `referenceImages` in the manifest either points to existing files or is removed entirely. Missing files cause silent API failures.
3. Run the fighter pipeline:
   ```
   node scripts/asset-pipeline/cli.js fighter assets/manifests/fighter_{id}.json
   ```
   This takes several minutes (50+ frames with API rate limiting). Run it in the background.
3. Once complete, show the user ALL 13 animation strips for review.

### Phase 3: Facing Review (Human)

1. Show each strip image to the user and ask them to identify which frames face LEFT.
2. Present a table for the user to fill in:
   ```
   | Animation    | Left-facing frames |
   |-------------|-------------------|
   | idle        |                   |
   | walk        |                   |
   | light_punch |                   |
   | heavy_punch |                   |
   | light_kick  |                   |
   | heavy_kick  |                   |
   | special     |                   |
   | block       |                   |
   | hurt        |                   |
   | knockdown   |                   |
   | victory     |                   |
   | defeat      |                   |
   | jump        |                   |
   ```
3. Wait for the user's response before proceeding to fixes.

### Phase 4: Fix Facing

After the user confirms which frames need flipping:

1. For each frame that needs flipping (frame N is 1-indexed, convert to 0-indexed as N-1):
   ```bash
   RAW="assets/_raw/fighters/{id}"
   ANIM="{animation_name}"
   IDX={N-1}

   # Flip the nobg file
   magick "${RAW}/${ANIM}/${ANIM}_${IDX}_nobg.png" -flop "${RAW}/${ANIM}/${ANIM}_${IDX}_nobg.png"

   # Re-process: crop -> pad 1:1 -> resize 128x128
   magick "${RAW}/${ANIM}/${ANIM}_${IDX}_nobg.png" -trim +repage "${RAW}/${ANIM}/${ANIM}_${IDX}_cropped.png"
   dims=$(magick identify -format "%w %h" "${RAW}/${ANIM}/${ANIM}_${IDX}_cropped.png")
   w=$(echo $dims | cut -d' ' -f1); h=$(echo $dims | cut -d' ' -f2)
   if [ $w -gt $h ]; then size=$w; else size=$h; fi
   magick "${RAW}/${ANIM}/${ANIM}_${IDX}_cropped.png" -gravity center -background transparent -extent ${size}x${size} "${RAW}/${ANIM}/${ANIM}_${IDX}_padded.png"
   magick "${RAW}/${ANIM}/${ANIM}_${IDX}_padded.png" -filter point -resize 128x128! "${RAW}/${ANIM}/${ANIM}_${IDX}.png"
   ```

2. Reassemble each affected strip (use correct frame count per animation):
   ```bash
   magick "${RAW}/${ANIM}/${ANIM}_0.png" "${RAW}/${ANIM}/${ANIM}_1.png" ... +append "public/assets/fighters/{id}/${ANIM}.png"
   ```

3. Show the fixed strips to the user for final confirmation.

### Phase 5: Wiring (if first time for this fighter)

If this is a new fighter not yet in the game:

1. Add the fighter ID to `FIGHTERS_WITH_SPRITES` array in `src/scenes/BootScene.js`.
2. Verify `npm run dev` builds without errors.
3. Tell the user to test in the browser.

## Key Lessons

- **Facing direction**: Gemini often ignores "face RIGHT" instructions. The prompt uses `IMPORTANT:` prefix with repeated emphasis. Even so, ~30% of frames may face the wrong way — that's why manual QA in Phase 3 is essential.
- **Green characters**: If the description mentions "green" (flames, clothing, etc.), the pipeline auto-switches to magenta `#FF00FF` background to avoid chroma-key stripping green elements.
- **Reference chain**: The fighter pipeline sends reference images in this order: golden reference sheet → first idle frame (self-reference) → previous frame of same animation (motion continuity). `referenceImages` (photos) are optional and prepended if present.
- **Animation speed**: Attack animations play at a dynamic framerate calculated as `spriteFrames / attackDuration` so the full animation fits within the gameplay cooldown window.
- **Frame counts per animation**: idle(4), walk(4), light_punch(4), heavy_punch(5), light_kick(4), heavy_kick(5), special(5), block(2), hurt(3), knockdown(4), victory(4), defeat(3), jump(3).
- **Stale `_raw` cache**: The pipeline caches intermediate frames in `assets/_raw/fighters/{id}/`. When regenerating, **always delete this directory first** or old frames will be reused, producing output based on the old design.
- **Missing `referenceImages`**: If the manifest references files that don't exist (e.g., photos not checked into the repo), the Gemini API call will fail silently with "fetch failed". Either ensure the files exist or remove the `referenceImages` field.
- **Manifest field names differ**: `reference_{id}.json` and `fighter_{id}.json` use `description` for the character prompt. `portrait_{id}.json` uses `prompt` instead.
- **`referenceSheet` path**: Should point to `assets/references/{id}_ref_padded.png` (the post-processed version with bg removed and padded to 1:1), not the raw `.png` or old `.jpeg`.
