# Asset Generation Plan

This document explains step by step how to replace the placeholders (colored rectangles) with real assets: fighter sprites, portraits, stage backgrounds, and UI elements.

---

## Prerequisites

1. **Gemini API Key** — Get one at https://aistudio.google.com/apikey
2. **ImageMagick 7** — The `magick` command must be available in PATH
3. **Node.js** (already installed if you're running the project)
4. **`@google/genai` dependency** — Install with `npm install @google/genai`

```bash
# Verify ImageMagick
magick --version

# Set the API key
export GEMINI_API_KEY="your-key-here"
```

---

## 1. Friend Photos (Optional but Recommended)

The photos are used as **reference images** so Gemini generates sprites and portraits that look like each friend. Without photos, the pipeline uses only the descriptions from `fighters.json`.

### What photos you need

- **14 photos**, one per fighter
- **Format:** JPG or PNG
- **Content:** Face/bust shot, well-lit, simple background
- **No need** for transparent backgrounds — the pipeline uses them only as visual reference

### Where to put them

```
assets/photos/
  simon.jpg
  jeka.jpg
  chicha.jpg
  cata.jpg
  carito.jpg
  mao.jpg
  peks.jpg
  lini.jpg
  alv.jpg
  sun.jpg
  gartner.jpg
  richi.jpg
  cami.jpg
  migue.jpg
```

### The 14 fighter IDs

| # | ID | Name | Subtitle |
|---|-----|------|----------|
| 1 | `simon` | Simo | El Asesino del Perreo |
| 2 | `jeka` | Jecat | La Gluten Killer |
| 3 | `chicha` | Chicha | El Demoledor |
| 4 | `cata` | Cata | La Fantastica |
| 5 | `carito` | Carito | La Bruja del Guaro |
| 6 | `mao` | Mao | El Sapoperro |
| 7 | `peks` | Peks | La Que Sabe |
| 8 | `lini` | LinaPcmn | La Elfa |
| 9 | `alv` | Alv | The Grandson |
| 10 | `sun` | Sun | La Millonaria Faquera |
| 11 | `gartner` | Panchito | El Palido |
| 12 | `richi` | Ric | El Errante |
| 13 | `cami` | Camilo | El Quemon |
| 14 | `migue` | Migue | El Capi Tripaseca |

---

## 2. Asset Pipeline — How It Works

The pipeline lives in `scripts/asset-pipeline/` and has 4 sub-pipelines:

| Pipeline | Input | Output | What it does |
|----------|-------|--------|--------------|
| `fighter` | Config JSON with description | Horizontal strip PNGs per animation | Generates frames with Gemini, removes green background, crops, scales to 128x128, assembles into strips |
| `portrait` | Config JSON with description | Single portrait PNG | Generates portrait with Gemini, scales to 128x128 |
| `stage` | Config JSON with prompt | Single background PNG | Generates background with Gemini, scales to 480x270 |
| `ui` | Config JSON with prompt | Single UI element PNG | Generates element, removes green background, crops, scales |

### Base command

```bash
node scripts/asset-pipeline/cli.js <type> <config.json> [options]
```

**Options:**
- `--skip-generate` — Skip generation and only process existing raw files
- `--delay N` — Milliseconds between API calls (default: 3000)
- `--retries N` — Attempts per image (default: 3)
- `--ref PATH` — Additional reference image for visual consistency

---

## 3. Generate Fighter Sprites

Each fighter needs sprite sheets for 13 animations. The pipeline generates individual 128x128px frames with transparent backgrounds and assembles them into horizontal strip PNGs.

### Animations and frames

| Animation | Frames | Description |
|-----------|--------|-------------|
| `idle` | 4 | Fighting stance |
| `walk` | 4 | Walking |
| `light_punch` | 4 | Quick punch |
| `heavy_punch` | 5 | Strong punch |
| `light_kick` | 4 | Quick kick |
| `heavy_kick` | 5 | Strong kick |
| `special` | 5 | Special attack |
| `block` | 2 | Blocking |
| `hurt` | 3 | Taking a hit |
| `knockdown` | 4 | Falling down KO'd |
| `victory` | 4 | Victory pose |
| `defeat` | 3 | Defeat pose |
| `jump` | 3 | Jumping |

**Total per fighter:** 50 frames = 50 Gemini API calls

### Create a config JSON per fighter

Create file `assets/manifests/fighter_simon.json`:

```json
{
  "output": "assets/fighters/simon/",
  "description": "Muay Thai fighter engulfed in green flames. Muscular build with traditional Muay Thai shorts and hand wraps, both fists ablaze with emerald fire. Dark skin, shaved head with a green bandana, black combat tape on shins. Fighting stance with raised knee, radiating intense heat.",
  "animations": ["idle", "walk", "light_punch", "heavy_punch", "light_kick", "heavy_kick", "special", "block", "hurt", "knockdown", "victory", "defeat", "jump"],
  "referenceImages": ["assets/photos/simon.jpg"]
}
```

The `description` is already in `fighters.json` for each fighter — copy it as-is.

### Run

```bash
# One fighter (with reference photo)
node scripts/asset-pipeline/cli.js fighter assets/manifests/fighter_simon.json
```

### Expected output

```
assets/fighters/simon/
  idle.png          (512x128 — 4 frames of 128x128)
  walk.png          (512x128)
  light_punch.png   (512x128)
  heavy_punch.png   (640x128 — 5 frames)
  light_kick.png    (512x128)
  heavy_kick.png    (640x128)
  special.png       (640x128)
  block.png         (256x128 — 2 frames)
  hurt.png          (384x128 — 3 frames)
  knockdown.png     (512x128)
  victory.png       (512x128)
  defeat.png        (384x128)
  jump.png          (384x128)
```

Intermediate files go to `assets/_raw/fighters/simon/`.

### Repeat for all 14 fighters

Each fighter's description is in `src/data/fighters.json` in the `description` field. Create a manifest JSON for each one, changing `output`, `description`, and `referenceImages`.

**Time estimate:** ~50 frames x 14 fighters = 700 API calls. With 3s delay between calls and rate limiting, estimate about 1.5–2.5 hours for all fighters if run sequentially.

---

## 4. Generate Portraits

Portraits are used in SelectScene (50x50 on screen, but generated at 128x128 for quality) and in PreFightScene / VictoryScene (90x100 and 80x80 on screen).

### Config JSON per fighter

Create `assets/manifests/portrait_simon.json`:

```json
{
  "output": "assets/portraits/simon.png",
  "prompt": "Muay Thai fighter engulfed in green flames. Muscular build with traditional Muay Thai shorts and hand wraps, both fists ablaze with emerald fire. Dark skin, shaved head with a green bandana.",
  "width": 128,
  "height": 128,
  "referenceImages": ["assets/photos/simon.jpg"]
}
```

### Run

```bash
node scripts/asset-pipeline/cli.js portrait assets/manifests/portrait_simon.json
```

### Output

```
assets/portraits/simon.png   (128x128 PNG)
```

**Total:** 14 portraits, 1 API call each.

---

## 5. Generate Stage Backgrounds

The 5 stages each need a 480x270px background (the game's internal resolution).

### The 5 stages

| ID | Name | Description |
|----|------|-------------|
| `dojo` | El Dojo | Traditional dojo with wooden floor and paper walls |
| `street` | La Calle | Night street with neon signs and rain |
| `temple` | El Templo | Ancient temple with fire braziers |
| `beach` | La Playa | Sunset beach with waves and palm trees |
| `rooftop` | La Azotea | City rooftop at night with skyline |

### Config JSON per stage

Create `assets/manifests/stage_dojo.json`:

```json
{
  "output": "assets/stages/dojo.png",
  "prompt": "Traditional Japanese dojo interior, wooden floor, paper sliding walls, hanging lanterns, fighting arena, wide landscape format, no characters present"
}
```

Create one for each stage with a detailed description:

- **dojo:** `"Traditional Japanese dojo interior, wooden floor, paper sliding walls, hanging lanterns, fighting arena, wide landscape"`
- **street:** `"Dark urban street at night, neon signs in Spanish, wet pavement reflecting lights, graffiti walls, rain, wide landscape"`
- **temple:** `"Ancient stone temple interior, fire braziers on columns, carved walls, dramatic lighting, wide landscape"`
- **beach:** `"Tropical beach at sunset, palm trees, crashing waves, orange sky, wooden boardwalk fighting area, wide landscape"`
- **rooftop:** `"City rooftop at night, skyline with lights in background, concrete floor, water tower, antenna, wide landscape"`

### Run

```bash
node scripts/asset-pipeline/cli.js stage assets/manifests/stage_dojo.json
node scripts/asset-pipeline/cli.js stage assets/manifests/stage_street.json
node scripts/asset-pipeline/cli.js stage assets/manifests/stage_temple.json
node scripts/asset-pipeline/cli.js stage assets/manifests/stage_beach.json
node scripts/asset-pipeline/cli.js stage assets/manifests/stage_rooftop.json
```

### Output

```
assets/stages/
  dojo.png      (480x270)
  street.png    (480x270)
  temple.png    (480x270)
  beach.png     (480x270)
  rooftop.png   (480x270)
```

**Total:** 5 backgrounds, 1 API call each.

---

## 6. Generate UI Elements (Optional)

Decorative elements to improve the interface: title logo, health bar frame, portrait frame, etc.

### Example: Title logo

Create `assets/manifests/ui_logo.json`:

```json
{
  "output": "assets/ui/logo.png",
  "prompt": "Fighting game logo text 'A LOS TRAQUES' in bold aggressive style, metallic gold and red, dramatic angle",
  "width": 320,
  "height": 80,
  "removeBackground": true
}
```

### Example: Health bar frame

```json
{
  "output": "assets/ui/hp_frame.png",
  "prompt": "Fighting game health bar frame, metallic silver border, ornate corners, horizontal rectangle",
  "width": 160,
  "height": 16,
  "removeBackground": true
}
```

### Run

```bash
node scripts/asset-pipeline/cli.js ui assets/manifests/ui_logo.json
node scripts/asset-pipeline/cli.js ui assets/manifests/ui_hp_frame.json
```

---

## 7. Integrate Assets into the Game

Currently the game uses placeholders generated programmatically in `BootScene.js`. To use real assets, code changes are needed.

### Current textures (placeholders)

| Key | Where generated | Where used | Replacement |
|-----|----------------|------------|-------------|
| `fighter_p1` | BootScene (40x80 rect) | FightScene -> Fighter entity | Per-fighter sprite sheet |
| `fighter_p2` | BootScene (40x80 rect) | FightScene -> Fighter entity | Per-fighter sprite sheet |
| `hp_bar_bg` | BootScene (150x12) | Not used (HUD uses rectangles) | Optional: UI texture |
| `hp_bar_fill` | BootScene (150x12) | Not used | Optional |
| `hp_bar_fill_p2` | BootScene (150x12) | Not used | Optional |
| `special_bar_bg` | BootScene (100x8) | Not used | Optional |
| `special_bar_fill` | BootScene (100x8) | Not used | Optional |

### Code changes needed

These are the files that need modification (do NOT make these changes now — this plan is just the guide):

1. **`src/scenes/BootScene.js`** — Load (preload) real textures for sprites, portraits, and backgrounds instead of generating placeholders. Use `this.load.spritesheet()` for fighter strips and `this.load.image()` for portraits and backgrounds.

2. **`src/scenes/FightScene.js`** — In `create()`, pass the correct texture key (e.g., `fighter_simon_idle`) based on the selected fighter instead of `fighter_p1`/`fighter_p2`. In `_createBackground()`, use the selected stage texture instead of colored rectangles.

3. **`src/entities/Fighter.js`** — Add animations with `this.sprite.anims.create()` for each state (idle, walk, attack, etc.) using the sprite sheets. Change states to play the corresponding animation.

4. **`src/scenes/SelectScene.js`** — Replace the color rectangles in the grid (`this.add.rectangle(...)`) with portrait images (`this.add.image(x, y, 'portrait_simon')`). Same for the P1/P2 preview areas.

5. **`src/scenes/PreFightScene.js`** — Replace portrait rectangles with real images.

6. **`src/scenes/VictoryScene.js`** — Replace the winner's portrait rectangle with the real image.

---

## 8. Summary of All Required Assets

### Required (to replace placeholders)

| Asset | Count | Dimensions | Format | Destination |
|-------|-------|------------|--------|-------------|
| Sprite sheets (per animation, per fighter) | 14 x 13 = 182 | Variable (N x 128) | PNG with alpha | `assets/fighters/{id}/` |
| Portraits | 14 | 128x128 | PNG | `assets/portraits/{id}.png` |
| Stage backgrounds | 5 | 480x270 | PNG | `assets/stages/{id}.png` |

### Optional (improve aesthetics)

| Asset | Count | Dimensions | Format | Destination |
|-------|-------|------------|--------|-------------|
| Title logo | 1 | 320x80 | PNG with alpha | `assets/ui/logo.png` |
| Health bar frame | 1 | 160x16 | PNG with alpha | `assets/ui/hp_frame.png` |
| Special bar frame | 1 | 100x10 | PNG with alpha | `assets/ui/sp_frame.png` |
| Portrait frame | 1 | 128x128 | PNG with alpha | `assets/ui/portrait_frame.png` |
| Title background | 1 | 480x270 | PNG | `assets/ui/title_bg.png` |

### Reference photos (input)

| Asset | Count | Format | Destination |
|-------|-------|--------|-------------|
| Friend photos | 14 | JPG/PNG | `assets/photos/{id}.jpg` |

---

## 9. Recommended Execution Order

1. Put the 14 photos in `assets/photos/`
2. Create the 14 fighter manifests in `assets/manifests/`
3. Generate ONE fighter first as a test:
   ```bash
   node scripts/asset-pipeline/cli.js fighter assets/manifests/fighter_simon.json
   ```
4. Review the generated sprites in `assets/fighters/simon/` — if they don't look right, adjust the description or parameters
5. Generate the portraits (fast, 1 call each):
   ```bash
   for id in simon jeka chicha cata carito mao peks lini alv sun gartner richi cami migue; do
     node scripts/asset-pipeline/cli.js portrait assets/manifests/portrait_${id}.json
   done
   ```
6. Generate the 5 stage backgrounds
7. Generate the remaining fighters
8. Generate UI elements (optional)
9. Modify the code to load and use the real assets

---

## 10. Cost and Time Estimates

| Type | API Calls | Estimated Time |
|------|-----------|----------------|
| Sprites (14 fighters x 50 frames) | 700 | 1.5–2.5 hours |
| Portraits (14) | 14 | 4 minutes |
| Stages (5) | 5 | 2 minutes |
| UI (5 elements) | 5 | 2 minutes |
| **Total** | **~724** | **~2.5 hours** |

Gemini's API has rate limits — the pipeline handles retries and delays automatically. If you're on the free tier, it may take longer due to rate limiting.
