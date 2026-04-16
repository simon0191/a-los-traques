/**
 * orientations.js — Derive orientation angles from MediaPipe keypoints.
 *
 * All output angles are in degrees, counter-clockwise from the positive
 * x-axis. Image y-axis is flipped inside each atan2 call so "up" reads as
 * positive. Phaser rotates clockwise, so renderer-side code must negate.
 */

const RAD2DEG = 180 / Math.PI;

function angleDeg(from, to) {
  return Math.atan2(-(to.y - from.y), to.x - from.x) * RAD2DEG;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function visible(kp, minVisibility) {
  return kp != null && typeof kp.v === 'number' && kp.v >= minVisibility;
}

function allVisible(keypoints, names, minVisibility) {
  for (const name of names) {
    if (!visible(keypoints[name], minVisibility)) return false;
  }
  return true;
}

function round1(n) {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? 0 : r;
}

function round3(n) {
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? 0 : r;
}

function roundPoint(p) {
  return { x: round1(p.x), y: round1(p.y) };
}

function deriveHead(kp, minVis) {
  if (!allVisible(kp, ['leftEye', 'rightEye', 'nose'], minVis)) return null;
  const eyeMid = midpoint(kp.leftEye, kp.rightEye);
  const eyeDist = distance(kp.leftEye, kp.rightEye);
  if (eyeDist < 1e-3) return null;

  const roll = angleDeg(kp.leftEye, kp.rightEye);
  const yaw = (kp.nose.x - eyeMid.x) / eyeDist;
  const pitch = (kp.nose.y - eyeMid.y) / eyeDist;

  return {
    center: roundPoint(eyeMid),
    roll: round1(roll),
    yaw: round3(yaw),
    pitch: round3(pitch),
  };
}

function deriveTorso(kp, minVis) {
  if (!allVisible(kp, ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'], minVis)) {
    return null;
  }
  const shoulderMid = midpoint(kp.leftShoulder, kp.rightShoulder);
  const hipMid = midpoint(kp.leftHip, kp.rightHip);
  return {
    center: roundPoint(shoulderMid),
    angle: round1(angleDeg(hipMid, shoulderMid)),
  };
}

function deriveHand(kp, side, minVis) {
  const wristName = `${side}Wrist`;
  const indexName = `${side}Index`;
  const elbowName = `${side}Elbow`;
  if (!visible(kp[wristName], minVis)) return null;

  const wrist = kp[wristName];
  const index = kp[indexName];
  const elbow = kp[elbowName];

  let angle;
  if (visible(index, minVis)) {
    angle = angleDeg(wrist, index);
  } else if (visible(elbow, minVis)) {
    angle = angleDeg(elbow, wrist);
  } else {
    return null;
  }

  return { anchor: roundPoint(wrist), angle: round1(angle) };
}

function deriveFoot(kp, side, minVis) {
  const heelName = `${side}Heel`;
  const footName = `${side}FootIndex`;
  const ankleName = `${side}Ankle`;
  if (!visible(kp[heelName], minVis) && !visible(kp[ankleName], minVis)) return null;

  const heel = kp[heelName];
  const foot = kp[footName];
  const ankle = kp[ankleName];

  let anchor;
  let angle;
  if (visible(heel, minVis) && visible(foot, minVis)) {
    anchor = heel;
    angle = angleDeg(heel, foot);
  } else if (visible(ankle, minVis) && visible(foot, minVis)) {
    anchor = ankle;
    angle = angleDeg(ankle, foot);
  } else {
    return null;
  }

  return { anchor: roundPoint(anchor), angle: round1(angle) };
}

/**
 * Compute derived orientation fields from a keypoints object.
 *
 * @param {Object|null} keypoints - Named keypoints {name: {x, y, v}} or null.
 * @param {number} [minVisibility=0.3] - Minimum visibility to use a keypoint.
 * @returns {Object|null} {head, torso, leftHand, rightHand, leftFoot, rightFoot}
 *   with any field null if input keypoints are missing/low confidence.
 *   Returns null if keypoints is null.
 */
export function computeDerived(keypoints, minVisibility = 0.3) {
  if (!keypoints) return null;
  return {
    head: deriveHead(keypoints, minVisibility),
    torso: deriveTorso(keypoints, minVisibility),
    leftHand: deriveHand(keypoints, 'left', minVisibility),
    rightHand: deriveHand(keypoints, 'right', minVisibility),
    leftFoot: deriveFoot(keypoints, 'left', minVisibility),
    rightFoot: deriveFoot(keypoints, 'right', minVisibility),
  };
}
