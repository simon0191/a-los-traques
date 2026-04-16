---
name: generate-poses
description: Extract per-frame pose keypoints (head, hands, feet + orientations) from a fighter's sprite animations in the A Los Traques repo. Use this skill whenever the user wants to generate, regenerate, or refresh pose data for a fighter — including phrases like "generate poses for X", "run pose estimation", "extract keypoints", "rebuild poses.json", "add hat anchor points", or any request to enrich an existing fighter's animations with body-part positions. Also trigger when the user adds a new fighter sprite set and wants attachment anchors for runtime effects. The pipeline runs MediaPipe on every animation frame and writes a consolidated `poses.json` alongside the sprite strips.
---

# Generate Pose Keypoints

End-to-end pipeline for extracting per-frame pose keypoints from a fighter's sprite animations. Writes one `poses.json` per fighter, colocated with the sprite strips, describing head/hand/foot positions plus derived orientation angles. Consumed at runtime to attach visual elements (hats, weapons, effects) to body parts with correct rotation.

## When to use

Run this after a fighter's sprites have been fully generated and had their facing direction corrected via `/generate-fighter`. Don't run it before Phase 4 of that skill — the post-hoc `-flop` fixes will swap `left*` and `right*` keypoints across animations and invalidate every derived angle.

## Prerequisites

- `assets/manifests/poses_{id}.json` exists. If not, copy `poses_simon.json` and change `output` + `fighter`.
- All 13 animation PNG strips exist at `public/assets/fighters/{id}/{anim}.png`. Check with `ls public/assets/fighters/{id}/`.
- `uv` is on the PATH. First invocation installs MediaPipe + OpenCV into an isolated cache under `scripts/asset-pipeline/pose/.venv`.
- ImageMagick (`magick`) is on the PATH — same dependency as the fighter pipeline.

## Workflow

### 1. Smoke-test with debug previews

Run the pipeline with `--debug` so skeleton overlays are written to `assets/_raw/poses/{id}/{anim}_debug.png`:

```bash
node scripts/asset-pipeline/cli.js poses assets/manifests/poses_{id}.json --debug
```

First run downloads MediaPipe model weights (~30 MB) and can take up to a minute. Subsequent runs complete in ~10s for all 13 animations.

The pipeline prints a per-animation summary at the end. Example:

```
  - simon/idle: 4/4 frames detected
  - simon/block: 1/2 frames detected (review debug strip)
  - simon/knockdown: 2/4 frames detected (review debug strip)
```

Partial detection in `block`, `hurt`, and `knockdown` is expected — the character's pose is ambiguous (arms over face, body horizontal) and the affected frames are stored as `detected: false`.

### 2. Review debug strips

Open the debug strips for three representative animations and show them to the user:

```bash
open assets/_raw/poses/{id}/idle_debug.png
open assets/_raw/poses/{id}/light_punch_debug.png
open assets/_raw/poses/{id}/knockdown_debug.png
```

Ask: "Does the skeleton track the character's actual body — head on head, wrists on wrists?"

- If yes, proceed.
- If the skeleton is consistently mirrored (left/right swapped) across a whole animation, that usually means Phase 4 of `/generate-fighter` wasn't run for that animation. Confirm with the user and re-run the fighter pipeline's facing fixes before regenerating poses.
- If detection is wrong only for specific frames inside `block`/`hurt`/`knockdown`, leave as-is — these are marked `detected: false` and runtime code should skip attachment for those frames.

### 3. Verify JSON output

Confirm the output file exists and has all 13 animations:

```bash
jq '.animations | keys' public/assets/fighters/{id}/poses.json
```

Sanity-check a derived block for a character standing upright and facing right:

```bash
jq '.animations.idle.frames[0].derived' public/assets/fighters/{id}/poses.json
```

Expect `head.roll` near 0 and `torso.angle` near 90. Large deviations on the very first idle frame usually indicate a detection problem worth investigating.

### 4. Commit

Stage the manifest (if new) and the generated JSON:

```bash
git add assets/manifests/poses_{id}.json public/assets/fighters/{id}/poses.json
```

The `assets/_raw/poses/{id}/` directory holds intermediate frame splits and debug previews — it's regeneratable and should not be committed.

## Output shape

One JSON file per fighter, colocated with sprites:

```
public/assets/fighters/{id}/poses.json
```

Top-level fields: `version`, `fighter`, `frameSize` (128), `model`, `generatedAt`, `animations`.

Each animation has `frameCount` and a `frames` array. Each frame has:

- `index`, `detected`, `avgVisibility`
- `keypoints` — 23 named landmarks as `{x, y, v}`. Coordinates are **pixel-space relative to the 128×128 frame**, top-left origin, y down (matches Phaser sprite-child coords).
- `derived` — `head {center, roll, yaw, pitch}`, `torso {center, angle}`, `{left,right}Hand {anchor, angle}`, `{left,right}Foot {anchor, angle}`. Angles are **degrees, counter-clockwise from +x axis**. Phaser rotates clockwise, so renderer code must negate.

When `detected: false`, both `keypoints` and `derived` are `null`.

## Key lessons

- **Run after `/generate-fighter` Phase 4.** Facing fixes (`magick -flop`) happen post-hoc and swap left/right semantics. Run poses before that, and the JSON is wrong.
- **Transparent backgrounds break pose models.** `detect.py` composites each RGBA frame over mid-gray `(128,128,128)` before inference. Never composite over green — some sprites have green flames that would bleed.
- **`static_image_mode=True`** is required so MediaPipe doesn't try to track state across unrelated animations.
- **`model_complexity=2`** (heavy) is more tolerant of limbs at the frame edge (common in `heavy_kick`, `special`). Still <2 minutes total for 800 frames.
- **Cached frame splits** in `assets/_raw/poses/{id}/{anim}/frame_*.png` are reused across runs. Delete the directory to force re-split if a sprite strip changed.
- **`poses.json` is consolidated per fighter** — one file holds all 13 animations. Regenerating a single animation rewrites the whole file.
