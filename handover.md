# Pose Template Pipeline — Handover

## What this is

Stick figure pose templates that give Gemini precise spatial guidance when generating fighter sprite frames. Instead of relying on vague text like "throwing a quick jab punch, frame 2 of 4", each frame gets a 128x128 stick figure image showing the exact target pose with color-coded limbs.

## Current state

**Working end-to-end for 2 animations** (idle, heavy_kick). Tested with chicha — pose quality improvement is significant, especially for complex poses like roundhouse kicks.

**Remaining: 11 animations need templates generated** (walk, light_punch, heavy_punch, light_kick, special, block, hurt, knockdown, victory, defeat, jump). The pose coordinate data for all 13 animations already exists in the generation script — just needs to be run.

## Files

| File | Purpose |
|---|---|
| `scripts/generate-pose-templates.js` | Generates stick figure PNGs from joint coordinates via ImageMagick draw commands. Contains all 47 frame definitions for 13 animations. |
| `scripts/asset-pipeline/pipelines/fighter.js` | Modified to load pose templates and pass them as reference images to Gemini with a color-key prompt. Falls back gracefully if no template exists. |
| `assets/pose-templates/{anim}/frame{N}.png` | Generated 128x128 stick figure PNGs. Currently only `idle/` (4 frames) and `heavy_kick/` (5 frames). |
| `assets/pose-templates/legend.json` | Color mapping for limbs, read by fighter.js at generation time. |
| `assets/manifests/fighter_chicha_test.json` | Test manifest (idle + heavy_kick only). Can be deleted. |
| `assets/manifests/fighter_alv_test.json` | Test manifest. Can be deleted. |

## How it works

### Template generation
Each frame is defined as joint coordinates (head, shoulders, elbows, hands, hips, knees, feet) in a 128x128 space. Limbs are color-coded:

- **Dark gray** (#222222) = head + torso
- **Blue** (#0066FF) = back arm (further from viewer)
- **Red** (#FF0000) = front arm (closer to viewer)
- **Green** (#00AA00) = back leg (further from viewer)
- **Orange** (#FF8800) = front leg (closer to viewer)

ImageMagick renders these directly to PNG — no external server or ML model needed.

### Pipeline integration
In `fighter.js`, before generating each frame:
1. Check if `assets/pose-templates/{animName}/frame{N}.png` exists
2. If yes, prepend it to the reference images list (first position = highest priority)
3. Add a prompt section explaining the color key and instructing Gemini to match the pose
4. If no template exists, behavior is unchanged (no breaking change)

## To complete

### 1. Generate remaining templates
```bash
node scripts/generate-pose-templates.js walk light_punch heavy_punch light_kick special block hurt knockdown victory defeat jump
```
This is instant (ImageMagick draw, no ML). All joint coordinates are already defined.

### 2. Visual QA of templates
Review the generated PNGs to verify poses look correct. If a pose needs adjustment, edit the coordinate arrays in `scripts/generate-pose-templates.js` under the relevant animation name and re-run for just that animation:
```bash
node scripts/generate-pose-templates.js light_punch
```

### 3. Full fighter generation test
Run a full fighter (all 13 animations) with templates to verify end-to-end:
```bash
GEMINI_API_KEY=... node scripts/asset-pipeline/cli.js fighter assets/manifests/fighter_chicha.json
```

### 4. Commit and PR
Once verified, commit:
- `scripts/generate-pose-templates.js`
- `scripts/asset-pipeline/pipelines/fighter.js`
- `assets/pose-templates/` (all generated frames + legend.json)

Delete before committing:
- `assets/manifests/fighter_alv_test.json`
- `assets/manifests/fighter_chicha_test.json`
- `assets/_raw/fighters/chicha_pose_test/` (test output)

## Known considerations

- **Gemini output is 768x1344**, templates are 128x128. Despite the size mismatch, Gemini picks up the pose guidance well in testing. Upscaling templates before passing to Gemini could potentially improve results further.
- **Frame coordinate tuning**: Some animations may need coordinate adjustments after seeing the generated output. The idle and heavy_kick poses were validated; others are first-pass estimates.
- **Graceful fallback**: If a template doesn't exist for a frame, the pipeline runs exactly as before. You can generate templates incrementally.
