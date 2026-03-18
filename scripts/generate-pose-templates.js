#!/usr/bin/env node
/**
 * Generate stick figure pose templates as SVG → PNG for the asset pipeline.
 * Each frame is defined by joint coordinates, rendered as SVG, then converted to PNG.
 *
 * Usage: node scripts/generate-pose-templates.js [animation1 animation2 ...]
 * If no animations specified, generates all.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_DIR = path.join(__dirname, "..", "assets", "pose-templates");
const SIZE = 128;
const RENDER_SIZE = 512; // Render SVG at 4x, then downscale for crisp lines

// Limb color mapping — each body part gets a unique color
// This mapping is exported as a legend alongside the templates
const LIMB_COLORS = {
  head:      "#222222", // dark gray (head circle + neck)
  torso:     "#222222", // dark gray (spine)
  arm_back:  "#0066FF", // blue (back/left arm — further from viewer)
  arm_front: "#FF0000", // red (front/right arm — closer to viewer)
  leg_back:  "#00AA00", // green (back/left leg)
  leg_front: "#FF8800", // orange (front/right leg)
};

// Human-readable legend for the prompt
const LIMB_LEGEND = [
  "dark gray = head + torso",
  "blue = back arm (left, further from viewer)",
  "red = front arm (right, closer to viewer)",
  "green = back leg (left, further from viewer)",
  "orange = front leg (right, closer to viewer)",
].join(", ");

// Build an ImageMagick draw command from joint coordinates
function buildDrawCommand(pose) {
  const {
    head, torso_top, torso_bottom,
    shoulder_l, elbow_l, hand_l, shoulder_r, elbow_r, hand_r,
    hip_l, knee_l, foot_l, hip_r, knee_r, foot_r
  } = pose;

  const sw = 3;
  const draws = [];
  const C = LIMB_COLORS;

  // Torso (dark gray)
  draws.push(`stroke '${C.torso}' stroke-width ${sw} fill none stroke-linecap round stroke-linejoin round`);
  draws.push(`line ${torso_top[0]},${torso_top[1]} ${torso_bottom[0]},${torso_bottom[1]}`);

  // Neck (dark gray)
  draws.push(`line ${head[0]},${head[1] + head[2]} ${torso_top[0]},${torso_top[1]}`);

  // Back arm — blue
  draws.push(`stroke '${C.arm_back}' stroke-width ${sw} fill none`);
  draws.push(`line ${shoulder_l[0]},${shoulder_l[1]} ${elbow_l[0]},${elbow_l[1]}`);
  draws.push(`line ${elbow_l[0]},${elbow_l[1]} ${hand_l[0]},${hand_l[1]}`);

  // Front arm — red
  draws.push(`stroke '${C.arm_front}' stroke-width ${sw} fill none`);
  draws.push(`line ${shoulder_r[0]},${shoulder_r[1]} ${elbow_r[0]},${elbow_r[1]}`);
  draws.push(`line ${elbow_r[0]},${elbow_r[1]} ${hand_r[0]},${hand_r[1]}`);

  // Back leg — green
  draws.push(`stroke '${C.leg_back}' stroke-width ${sw} fill none`);
  draws.push(`line ${hip_l[0]},${hip_l[1]} ${knee_l[0]},${knee_l[1]}`);
  draws.push(`line ${knee_l[0]},${knee_l[1]} ${foot_l[0]},${foot_l[1]}`);

  // Front leg — orange
  draws.push(`stroke '${C.leg_front}' stroke-width ${sw} fill none`);
  draws.push(`line ${hip_r[0]},${hip_r[1]} ${knee_r[0]},${knee_r[1]}`);
  draws.push(`line ${knee_r[0]},${knee_r[1]} ${foot_r[0]},${foot_r[1]}`);

  // Head circle (dark gray outline, white fill — drawn last on top)
  draws.push(`fill white stroke '${C.head}' stroke-width ${sw}`);
  draws.push(`circle ${head[0]},${head[1]} ${head[0] + head[2]},${head[1]}`);

  // Joint dots at hands and feet (matching limb colors)
  draws.push(`fill '${C.arm_back}' stroke none`);
  draws.push(`circle ${hand_l[0]},${hand_l[1]} ${hand_l[0] + 2},${hand_l[1]}`);
  draws.push(`fill '${C.arm_front}' stroke none`);
  draws.push(`circle ${hand_r[0]},${hand_r[1]} ${hand_r[0] + 2},${hand_r[1]}`);
  draws.push(`fill '${C.leg_back}' stroke none`);
  draws.push(`circle ${foot_l[0]},${foot_l[1]} ${foot_l[0] + 2},${foot_l[1]}`);
  draws.push(`fill '${C.leg_front}' stroke none`);
  draws.push(`circle ${foot_r[0]},${foot_r[1]} ${foot_r[0] + 2},${foot_r[1]}`);

  return draws.join(" ");
}

// Character faces RIGHT. In side view:
// - "front" limbs (closer to viewer/right) are the RIGHT arm and RIGHT leg
// - "back" limbs (further) are LEFT arm and LEFT leg
// - The figure walks/attacks toward the RIGHT

// ============================================================
// ANIMATION POSE DATA
// ============================================================

const ANIMATIONS = {
  idle: [
    // Frame 1: Fighting stance, weight centered
    {
      head: [58, 22, 10],
      torso_top: [58, 35], torso_bottom: [55, 65],
      shoulder_l: [52, 37], elbow_l: [45, 48], hand_l: [50, 38], // back arm, guard at chin
      shoulder_r: [64, 37], elbow_r: [72, 48], hand_r: [68, 38], // front arm, guard at chin
      hip_l: [50, 65], knee_l: [40, 85], foot_l: [35, 108],       // back leg, straight
      hip_r: [60, 65], knee_r: [72, 82], foot_r: [78, 108],       // front leg, bent
    },
    // Frame 2: Slight crouch, dip lower
    {
      head: [58, 25, 10],
      torso_top: [58, 38], torso_bottom: [55, 68],
      shoulder_l: [52, 40], elbow_l: [45, 51], hand_l: [50, 41],
      shoulder_r: [64, 40], elbow_r: [72, 51], hand_r: [68, 41],
      hip_l: [50, 68], knee_l: [40, 88], foot_l: [35, 108],
      hip_r: [60, 68], knee_r: [72, 85], foot_r: [78, 108],
    },
    // Frame 3: Back to neutral (same as frame 1)
    {
      head: [58, 22, 10],
      torso_top: [58, 35], torso_bottom: [55, 65],
      shoulder_l: [52, 37], elbow_l: [45, 48], hand_l: [50, 38],
      shoulder_r: [64, 37], elbow_r: [72, 48], hand_r: [68, 38],
      hip_l: [50, 65], knee_l: [40, 85], foot_l: [35, 108],
      hip_r: [60, 65], knee_r: [72, 82], foot_r: [78, 108],
    },
    // Frame 4: Weight shift back slightly
    {
      head: [56, 23, 10],
      torso_top: [56, 36], torso_bottom: [53, 66],
      shoulder_l: [50, 38], elbow_l: [43, 49], hand_l: [48, 39],
      shoulder_r: [62, 38], elbow_r: [70, 49], hand_r: [66, 39],
      hip_l: [48, 66], knee_l: [38, 84], foot_l: [35, 108],
      hip_r: [58, 66], knee_r: [70, 84], foot_r: [78, 108],
    },
  ],

  walk: [
    // Frame 1: Right leg forward, left back
    {
      head: [60, 22, 10],
      torso_top: [60, 35], torso_bottom: [58, 65],
      shoulder_l: [54, 37], elbow_l: [48, 48], hand_l: [52, 38],
      shoulder_r: [66, 37], elbow_r: [74, 48], hand_r: [70, 38],
      hip_l: [53, 65], knee_l: [38, 82], foot_l: [30, 108],
      hip_r: [63, 65], knee_r: [78, 82], foot_r: [88, 108],
    },
    // Frame 2: Feet passing, body high
    {
      head: [60, 20, 10],
      torso_top: [60, 33], torso_bottom: [58, 63],
      shoulder_l: [54, 35], elbow_l: [48, 46], hand_l: [52, 36],
      shoulder_r: [66, 35], elbow_r: [74, 46], hand_r: [70, 36],
      hip_l: [53, 63], knee_l: [55, 82], foot_l: [52, 108],
      hip_r: [63, 63], knee_r: [65, 82], foot_r: [62, 108],
    },
    // Frame 3: Left leg forward, right back
    {
      head: [60, 22, 10],
      torso_top: [60, 35], torso_bottom: [58, 65],
      shoulder_l: [54, 37], elbow_l: [48, 48], hand_l: [52, 38],
      shoulder_r: [66, 37], elbow_r: [74, 48], hand_r: [70, 38],
      hip_l: [53, 65], knee_l: [68, 82], foot_l: [80, 108],
      hip_r: [63, 65], knee_r: [48, 82], foot_r: [38, 108],
    },
    // Frame 4: Feet passing again
    {
      head: [60, 20, 10],
      torso_top: [60, 33], torso_bottom: [58, 63],
      shoulder_l: [54, 35], elbow_l: [48, 46], hand_l: [52, 36],
      shoulder_r: [66, 35], elbow_r: [74, 46], hand_r: [70, 36],
      hip_l: [53, 63], knee_l: [56, 82], foot_l: [58, 108],
      hip_r: [63, 63], knee_r: [64, 82], foot_r: [60, 108],
    },
  ],

  light_punch: [
    // Frame 1: Coiling, arm chambered
    {
      head: [55, 22, 10],
      torso_top: [55, 35], torso_bottom: [52, 65],
      shoulder_l: [49, 37], elbow_l: [42, 48], hand_l: [46, 38],
      shoulder_r: [61, 37], elbow_r: [68, 45], hand_r: [62, 38], // guard
      hip_l: [47, 65], knee_l: [38, 85], foot_l: [33, 108],
      hip_r: [57, 65], knee_r: [70, 82], foot_r: [78, 108],
    },
    // Frame 2: Arm extending
    {
      head: [58, 22, 10],
      torso_top: [58, 35], torso_bottom: [55, 65],
      shoulder_l: [52, 37], elbow_l: [60, 40], hand_l: [75, 38], // punching arm extending
      shoulder_r: [64, 37], elbow_r: [68, 48], hand_r: [64, 40],
      hip_l: [50, 65], knee_l: [40, 85], foot_l: [35, 108],
      hip_r: [60, 65], knee_r: [72, 82], foot_r: [78, 108],
    },
    // Frame 3: Full extension
    {
      head: [60, 22, 10],
      torso_top: [60, 35], torso_bottom: [57, 65],
      shoulder_l: [54, 37], elbow_l: [72, 37], hand_l: [95, 37], // fully extended
      shoulder_r: [66, 37], elbow_r: [62, 50], hand_r: [58, 42],
      hip_l: [52, 65], knee_l: [42, 85], foot_l: [35, 108],
      hip_r: [62, 65], knee_r: [74, 82], foot_r: [80, 108],
    },
    // Frame 4: Retracting
    {
      head: [58, 22, 10],
      torso_top: [58, 35], torso_bottom: [55, 65],
      shoulder_l: [52, 37], elbow_l: [55, 46], hand_l: [52, 38],
      shoulder_r: [64, 37], elbow_r: [70, 48], hand_r: [66, 38],
      hip_l: [50, 65], knee_l: [40, 85], foot_l: [35, 108],
      hip_r: [60, 65], knee_r: [72, 82], foot_r: [78, 108],
    },
  ],

  heavy_punch: [
    // Frame 1: Wind up, torso rotated away
    {
      head: [52, 22, 10],
      torso_top: [52, 35], torso_bottom: [50, 65],
      shoulder_l: [46, 37], elbow_l: [55, 37], hand_l: [68, 37], // lead arm forward guard
      shoulder_r: [58, 37], elbow_r: [50, 50], hand_r: [45, 55], // rear arm pulled back
      hip_l: [45, 65], knee_l: [35, 85], foot_l: [30, 108],
      hip_r: [55, 65], knee_r: [68, 82], foot_r: [75, 108],
    },
    // Frame 2: Torso rotating, rear arm extending
    {
      head: [56, 22, 10],
      torso_top: [56, 35], torso_bottom: [53, 65],
      shoulder_l: [50, 37], elbow_l: [48, 48], hand_l: [52, 40],
      shoulder_r: [62, 37], elbow_r: [72, 40], hand_r: [78, 38], // extending
      hip_l: [48, 65], knee_l: [38, 85], foot_l: [32, 108],
      hip_r: [58, 65], knee_r: [70, 82], foot_r: [78, 108],
    },
    // Frame 3: Mid punch
    {
      head: [60, 22, 10],
      torso_top: [60, 35], torso_bottom: [57, 65],
      shoulder_l: [54, 37], elbow_l: [50, 50], hand_l: [48, 45],
      shoulder_r: [66, 37], elbow_r: [80, 37], hand_r: [90, 37], // nearly extended
      hip_l: [52, 65], knee_l: [42, 85], foot_l: [35, 108],
      hip_r: [62, 65], knee_r: [74, 82], foot_r: [80, 108],
    },
    // Frame 4: Full impact, lunged forward
    {
      head: [64, 22, 10],
      torso_top: [64, 35], torso_bottom: [60, 65],
      shoulder_l: [58, 37], elbow_l: [52, 52], hand_l: [48, 55], // pulled back to hip
      shoulder_r: [70, 37], elbow_r: [88, 37], hand_r: [100, 37], // max extension
      hip_l: [55, 65], knee_l: [42, 85], foot_l: [32, 108],
      hip_r: [65, 65], knee_r: [78, 80], foot_r: [85, 108],
    },
    // Frame 5: Recovery
    {
      head: [58, 22, 10],
      torso_top: [58, 35], torso_bottom: [55, 65],
      shoulder_l: [52, 37], elbow_l: [48, 48], hand_l: [52, 38],
      shoulder_r: [64, 37], elbow_r: [74, 44], hand_r: [70, 38],
      hip_l: [50, 65], knee_l: [40, 85], foot_l: [35, 108],
      hip_r: [60, 65], knee_r: [72, 82], foot_r: [78, 108],
    },
  ],

  light_kick: [
    // Frame 1: Knee chamber
    {
      head: [52, 22, 10],
      torso_top: [52, 35], torso_bottom: [50, 65],
      shoulder_l: [46, 37], elbow_l: [40, 48], hand_l: [44, 38],
      shoulder_r: [58, 37], elbow_r: [66, 48], hand_r: [62, 38],
      hip_l: [45, 65], knee_l: [35, 82], foot_l: [30, 108], // support leg
      hip_r: [55, 65], knee_r: [68, 58], foot_r: [62, 68],  // kicking leg chambered
    },
    // Frame 2: Leg extending forward low
    {
      head: [50, 22, 10],
      torso_top: [50, 35], torso_bottom: [48, 65],
      shoulder_l: [44, 37], elbow_l: [38, 48], hand_l: [42, 38],
      shoulder_r: [56, 37], elbow_r: [64, 48], hand_r: [60, 38],
      hip_l: [43, 65], knee_l: [33, 82], foot_l: [28, 108],
      hip_r: [53, 65], knee_r: [72, 65], foot_r: [88, 72],  // extending
    },
    // Frame 3: Full extension at knee height
    {
      head: [48, 22, 10],
      torso_top: [48, 35], torso_bottom: [46, 65],
      shoulder_l: [42, 37], elbow_l: [36, 48], hand_l: [40, 38],
      shoulder_r: [54, 37], elbow_r: [62, 48], hand_r: [58, 38],
      hip_l: [41, 65], knee_l: [32, 82], foot_l: [28, 108],
      hip_r: [51, 65], knee_r: [75, 62], foot_r: [98, 68],  // fully extended
    },
    // Frame 4: Retracting
    {
      head: [52, 22, 10],
      torso_top: [52, 35], torso_bottom: [50, 65],
      shoulder_l: [46, 37], elbow_l: [40, 48], hand_l: [44, 38],
      shoulder_r: [58, 37], elbow_r: [66, 48], hand_r: [62, 38],
      hip_l: [45, 65], knee_l: [35, 82], foot_l: [30, 108],
      hip_r: [55, 65], knee_r: [68, 70], foot_r: [72, 85],  // retracting
    },
  ],

  heavy_kick: [
    // Frame 1: Chamber - knee raised high
    {
      head: [48, 22, 10],
      torso_top: [48, 35], torso_bottom: [46, 65],
      shoulder_l: [42, 37], elbow_l: [36, 48], hand_l: [40, 38],
      shoulder_r: [54, 37], elbow_r: [62, 48], hand_r: [58, 38],
      hip_l: [41, 65], knee_l: [32, 82], foot_l: [28, 108], // support
      hip_r: [51, 65], knee_r: [65, 48], foot_r: [58, 58],  // high chamber
    },
    // Frame 2: Leg sweeping up in arc
    {
      head: [46, 22, 10],
      torso_top: [46, 35], torso_bottom: [44, 65],
      shoulder_l: [40, 37], elbow_l: [30, 45], hand_l: [25, 50], // arm out for balance
      shoulder_r: [52, 37], elbow_r: [60, 48], hand_r: [56, 40],
      hip_l: [39, 65], knee_l: [30, 84], foot_l: [26, 108],
      hip_r: [49, 65], knee_r: [72, 45], foot_r: [85, 50],  // sweeping up
    },
    // Frame 3: Near full extension, leg at shoulder height
    {
      head: [44, 24, 10],
      torso_top: [44, 37], torso_bottom: [42, 67],
      shoulder_l: [38, 39], elbow_l: [28, 46], hand_l: [22, 52],
      shoulder_r: [50, 39], elbow_r: [56, 50], hand_r: [52, 42],
      hip_l: [37, 67], knee_l: [28, 86], foot_l: [24, 108],
      hip_r: [47, 67], knee_r: [75, 38], foot_r: [95, 35],  // high kick
    },
    // Frame 4: Full extension - leg horizontal at head height
    {
      head: [42, 26, 10],
      torso_top: [42, 39], torso_bottom: [40, 69],
      shoulder_l: [36, 41], elbow_l: [26, 48], hand_l: [20, 55],
      shoulder_r: [48, 41], elbow_r: [54, 52], hand_r: [50, 44],
      hip_l: [35, 69], knee_l: [27, 88], foot_l: [24, 108],
      hip_r: [45, 69], knee_r: [72, 30], foot_r: [100, 26], // max height
    },
    // Frame 5: Recovery - leg coming back down
    {
      head: [48, 22, 10],
      torso_top: [48, 35], torso_bottom: [46, 65],
      shoulder_l: [42, 37], elbow_l: [36, 48], hand_l: [40, 38],
      shoulder_r: [54, 37], elbow_r: [62, 48], hand_r: [58, 38],
      hip_l: [41, 65], knee_l: [32, 82], foot_l: [28, 108],
      hip_r: [51, 65], knee_r: [68, 60], foot_r: [78, 78],  // coming down
    },
  ],

  special: [
    // Frame 1: Deep stance, hands cupped at hip
    {
      head: [55, 26, 10],
      torso_top: [55, 39], torso_bottom: [53, 69],
      shoulder_l: [49, 41], elbow_l: [44, 55], hand_l: [50, 62],
      shoulder_r: [61, 41], elbow_r: [66, 55], hand_r: [55, 62], // hands together at hip
      hip_l: [48, 69], knee_l: [35, 85], foot_l: [28, 108],
      hip_r: [58, 69], knee_r: [72, 85], foot_r: [82, 108],
    },
    // Frame 2: Maximum coil
    {
      head: [52, 28, 10],
      torso_top: [52, 41], torso_bottom: [50, 71],
      shoulder_l: [46, 43], elbow_l: [40, 58], hand_l: [46, 65],
      shoulder_r: [58, 43], elbow_r: [62, 58], hand_r: [50, 65], // pulled back further
      hip_l: [45, 71], knee_l: [33, 88], foot_l: [26, 108],
      hip_r: [55, 71], knee_r: [70, 88], foot_r: [80, 108],
    },
    // Frame 3: Thrusting forward
    {
      head: [58, 24, 10],
      torso_top: [58, 37], torso_bottom: [55, 67],
      shoulder_l: [52, 39], elbow_l: [62, 38], hand_l: [75, 40],
      shoulder_r: [64, 39], elbow_r: [74, 38], hand_r: [80, 40], // thrusting
      hip_l: [50, 67], knee_l: [40, 85], foot_l: [32, 108],
      hip_r: [60, 67], knee_r: [72, 85], foot_r: [80, 108],
    },
    // Frame 4: Full release, arms extended
    {
      head: [62, 22, 10],
      torso_top: [62, 35], torso_bottom: [58, 65],
      shoulder_l: [56, 37], elbow_l: [72, 35], hand_l: [92, 36],
      shoulder_r: [68, 37], elbow_r: [84, 35], hand_r: [98, 36], // max extension
      hip_l: [53, 65], knee_l: [42, 82], foot_l: [30, 108],
      hip_r: [63, 65], knee_r: [76, 80], foot_r: [84, 108],
    },
    // Frame 5: Follow through
    {
      head: [60, 23, 10],
      torso_top: [60, 36], torso_bottom: [57, 66],
      shoulder_l: [54, 38], elbow_l: [68, 37], hand_l: [82, 40],
      shoulder_r: [66, 38], elbow_r: [78, 37], hand_r: [88, 40],
      hip_l: [52, 66], knee_l: [42, 84], foot_l: [33, 108],
      hip_r: [62, 66], knee_r: [74, 82], foot_r: [82, 108],
    },
  ],

  block: [
    // Frame 1: Arms crossed protecting face
    {
      head: [55, 22, 10],
      torso_top: [55, 35], torso_bottom: [52, 65],
      shoulder_l: [49, 37], elbow_l: [44, 28], hand_l: [52, 20], // forearm up across face
      shoulder_r: [61, 37], elbow_r: [66, 28], hand_r: [58, 20], // forearm up across face
      hip_l: [47, 65], knee_l: [38, 85], foot_l: [33, 108],
      hip_r: [57, 65], knee_r: [70, 82], foot_r: [78, 108],
    },
    // Frame 2: Absorbing hit, pushed back
    {
      head: [52, 24, 10],
      torso_top: [52, 37], torso_bottom: [50, 68],
      shoulder_l: [46, 39], elbow_l: [41, 30], hand_l: [49, 22],
      shoulder_r: [58, 39], elbow_r: [63, 30], hand_r: [55, 22],
      hip_l: [45, 68], knee_l: [35, 88], foot_l: [30, 108],
      hip_r: [55, 68], knee_r: [68, 86], foot_r: [76, 108],
    },
  ],

  hurt: [
    // Frame 1: Impact, head snapping back
    {
      head: [50, 20, 10],
      torso_top: [52, 34], torso_bottom: [55, 65],
      shoulder_l: [46, 36], elbow_l: [38, 30], hand_l: [42, 22], // arms flung
      shoulder_r: [58, 36], elbow_r: [66, 30], hand_r: [72, 24],
      hip_l: [50, 65], knee_l: [40, 84], foot_l: [35, 108],
      hip_r: [60, 65], knee_r: [68, 84], foot_r: [72, 108],
    },
    // Frame 2: Recoiling, body bent back
    {
      head: [45, 22, 10],
      torso_top: [48, 36], torso_bottom: [55, 68],
      shoulder_l: [42, 38], elbow_l: [34, 28], hand_l: [30, 22],
      shoulder_r: [54, 38], elbow_r: [62, 28], hand_r: [68, 22],
      hip_l: [50, 68], knee_l: [42, 86], foot_l: [38, 108],
      hip_r: [60, 68], knee_r: [66, 86], foot_r: [70, 108],
    },
    // Frame 3: Recovering
    {
      head: [52, 24, 10],
      torso_top: [53, 37], torso_bottom: [54, 67],
      shoulder_l: [47, 39], elbow_l: [42, 48], hand_l: [46, 42],
      shoulder_r: [59, 39], elbow_r: [66, 48], hand_r: [62, 42],
      hip_l: [49, 67], knee_l: [40, 86], foot_l: [36, 108],
      hip_r: [59, 67], knee_r: [68, 84], foot_r: [74, 108],
    },
  ],

  knockdown: [
    // Frame 1: Staggering backward
    {
      head: [48, 20, 10],
      torso_top: [50, 34], torso_bottom: [55, 66],
      shoulder_l: [44, 36], elbow_l: [36, 28], hand_l: [32, 22],
      shoulder_r: [56, 36], elbow_r: [64, 28], hand_r: [70, 22],
      hip_l: [50, 66], knee_l: [42, 85], foot_l: [40, 108],
      hip_r: [60, 66], knee_r: [65, 85], foot_r: [68, 108],
    },
    // Frame 2: Body at 45 degrees, feet leaving ground
    {
      head: [42, 28, 10],
      torso_top: [46, 40], torso_bottom: [58, 65],
      shoulder_l: [40, 42], elbow_l: [32, 34], hand_l: [28, 28],
      shoulder_r: [52, 42], elbow_r: [58, 34], hand_r: [62, 28],
      hip_l: [53, 65], knee_l: [48, 80], foot_l: [50, 98],
      hip_r: [63, 65], knee_r: [68, 78], foot_r: [72, 95],
    },
    // Frame 3: Nearly horizontal
    {
      head: [32, 42, 10],
      torso_top: [40, 48], torso_bottom: [62, 60],
      shoulder_l: [36, 50], elbow_l: [28, 42], hand_l: [24, 36],
      shoulder_r: [44, 50], elbow_r: [40, 42], hand_r: [38, 36],
      hip_l: [58, 60], knee_l: [56, 72], foot_l: [50, 85],
      hip_r: [66, 60], knee_r: [70, 72], foot_r: [68, 85],
    },
    // Frame 4: Flat on ground
    {
      head: [25, 88, 10],
      torso_top: [38, 90], torso_bottom: [62, 92],
      shoulder_l: [36, 86], elbow_l: [28, 80], hand_l: [22, 78],
      shoulder_r: [40, 94], elbow_r: [34, 100], hand_r: [28, 102],
      hip_l: [60, 88], knee_l: [74, 84], foot_l: [88, 86],
      hip_r: [64, 96], knee_r: [78, 98], foot_r: [90, 100],
    },
  ],

  victory: [
    // Frame 1: Standing tall, arms starting to rise
    {
      head: [58, 18, 10],
      torso_top: [58, 31], torso_bottom: [58, 65],
      shoulder_l: [52, 33], elbow_l: [46, 42], hand_l: [44, 50],
      shoulder_r: [64, 33], elbow_r: [70, 42], hand_r: [72, 50],
      hip_l: [53, 65], knee_l: [48, 85], foot_l: [45, 108],
      hip_r: [63, 65], knee_r: [68, 85], foot_r: [72, 108],
    },
    // Frame 2: One fist pumping up
    {
      head: [58, 18, 10],
      torso_top: [58, 31], torso_bottom: [58, 65],
      shoulder_l: [52, 33], elbow_l: [46, 38], hand_l: [44, 45],
      shoulder_r: [64, 33], elbow_r: [72, 22], hand_r: [76, 14], // fist pumping
      hip_l: [53, 65], knee_l: [48, 85], foot_l: [45, 108],
      hip_r: [63, 65], knee_r: [68, 85], foot_r: [72, 108],
    },
    // Frame 3: Both fists high, V shape
    {
      head: [58, 18, 10],
      torso_top: [58, 31], torso_bottom: [58, 65],
      shoulder_l: [52, 33], elbow_l: [42, 22], hand_l: [34, 10], // V left
      shoulder_r: [64, 33], elbow_r: [74, 22], hand_r: [82, 10], // V right
      hip_l: [53, 65], knee_l: [44, 85], foot_l: [38, 108],
      hip_r: [63, 65], knee_r: [72, 85], foot_r: [78, 108],
    },
    // Frame 4: Victory pose held
    {
      head: [58, 16, 10],
      torso_top: [58, 29], torso_bottom: [58, 63],
      shoulder_l: [52, 31], elbow_l: [40, 20], hand_l: [32, 8],
      shoulder_r: [64, 31], elbow_r: [76, 20], hand_r: [84, 8],
      hip_l: [53, 63], knee_l: [44, 84], foot_l: [38, 108],
      hip_r: [63, 63], knee_r: [74, 84], foot_r: [80, 108],
    },
  ],

  defeat: [
    // Frame 1: Exhausted, hands on knees
    {
      head: [62, 38, 10],
      torso_top: [58, 42], torso_bottom: [55, 68],
      shoulder_l: [54, 44], elbow_l: [48, 55], hand_l: [42, 72],
      shoulder_r: [62, 44], elbow_r: [68, 55], hand_r: [72, 72],
      hip_l: [50, 68], knee_l: [42, 85], foot_l: [38, 108],
      hip_r: [60, 68], knee_r: [70, 85], foot_r: [75, 108],
    },
    // Frame 2: Dropping to one knee
    {
      head: [58, 42, 10],
      torso_top: [56, 50], torso_bottom: [54, 72],
      shoulder_l: [52, 52], elbow_l: [46, 62], hand_l: [44, 72],
      shoulder_r: [60, 52], elbow_r: [66, 62], hand_r: [68, 72],
      hip_l: [50, 72], knee_l: [40, 88], foot_l: [35, 108],
      hip_r: [58, 72], knee_r: [65, 95], foot_r: [60, 100], // knee on ground
    },
    // Frame 3: Both knees down, head bowed
    {
      head: [56, 50, 10],
      torso_top: [55, 58], torso_bottom: [54, 78],
      shoulder_l: [51, 60], elbow_l: [46, 72], hand_l: [44, 82],
      shoulder_r: [59, 60], elbow_r: [64, 72], hand_r: [66, 82],
      hip_l: [50, 78], knee_l: [42, 96], foot_l: [48, 105],
      hip_r: [58, 78], knee_r: [64, 96], foot_r: [70, 105],
    },
  ],

  jump: [
    // Frame 1: Crouch before jump
    {
      head: [58, 38, 10],
      torso_top: [58, 51], torso_bottom: [56, 75],
      shoulder_l: [52, 53], elbow_l: [44, 60], hand_l: [40, 68],
      shoulder_r: [64, 53], elbow_r: [72, 60], hand_r: [76, 68],
      hip_l: [51, 75], knee_l: [40, 90], foot_l: [42, 108],
      hip_r: [61, 75], knee_r: [72, 90], foot_r: [70, 108],
    },
    // Frame 2: Apex, tucked
    {
      head: [58, 14, 10],
      torso_top: [58, 27], torso_bottom: [56, 50],
      shoulder_l: [52, 29], elbow_l: [44, 22], hand_l: [40, 16],
      shoulder_r: [64, 29], elbow_r: [72, 22], hand_r: [76, 16],
      hip_l: [51, 50], knee_l: [42, 42], foot_l: [38, 54],  // tucked
      hip_r: [61, 50], knee_r: [70, 42], foot_r: [74, 54],
    },
    // Frame 3: Descending, legs extending
    {
      head: [58, 22, 10],
      torso_top: [58, 35], torso_bottom: [56, 58],
      shoulder_l: [52, 37], elbow_l: [46, 44], hand_l: [42, 40],
      shoulder_r: [64, 37], elbow_r: [70, 44], hand_r: [74, 40],
      hip_l: [51, 58], knee_l: [42, 72], foot_l: [38, 88],
      hip_r: [61, 58], knee_r: [70, 72], foot_r: [74, 88],
    },
  ],
};

function main() {
  const args = process.argv.slice(2);
  const animsToGenerate = args.length > 0
    ? args.filter(a => ANIMATIONS[a])
    : Object.keys(ANIMATIONS);

  if (args.length > 0) {
    const unknown = args.filter(a => !ANIMATIONS[a]);
    if (unknown.length) console.warn(`Unknown animations: ${unknown.join(", ")}`);
  }

  const totalFrames = animsToGenerate.reduce((s, a) => s + ANIMATIONS[a].length, 0);
  console.log(`Generating ${totalFrames} frames across ${animsToGenerate.length} animations`);

  let frameCount = 0;

  for (const animName of animsToGenerate) {
    const frames = ANIMATIONS[animName];
    const animDir = path.join(BASE_DIR, animName);
    fs.mkdirSync(animDir, { recursive: true });

    console.log(`\n${animName} (${frames.length} frames)`);

    for (let i = 0; i < frames.length; i++) {
      frameCount++;
      const pngPath = path.join(animDir, `frame${i + 1}.png`);

      const drawCmd = buildDrawCommand(frames[i]);
      execSync(`magick -size ${SIZE}x${SIZE} xc:white -draw '${drawCmd}' "${pngPath}"`);
      console.log(`  [${frameCount}/${totalFrames}] frame${i + 1} -> ${pngPath}`);
    }
  }

  // Write color legend for the pipeline to reference
  const legendPath = path.join(BASE_DIR, "legend.json");
  fs.writeFileSync(legendPath, JSON.stringify({
    colors: LIMB_COLORS,
    description: LIMB_LEGEND,
  }, null, 2));
  console.log(`\nLegend: ${legendPath}`);

  console.log(`Done! Generated ${frameCount} frames to ${BASE_DIR}`);
}

// Export for use by fighter pipeline
export { LIMB_COLORS, LIMB_LEGEND };

main();
