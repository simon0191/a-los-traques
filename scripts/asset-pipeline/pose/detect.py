"""MediaPipe pose detector for fighter sprite frames.

Reads every `frame_*.png` in --input-dir, composites each RGBA frame over
mid-gray, runs MediaPipe PoseLandmarker (heavy variant), and emits one JSON
array on stdout containing per-frame keypoints in pixel space.

When --debug-dir is provided, also writes a skeleton-overlay PNG per frame.
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"
)
MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_PATH = MODEL_DIR / "pose_landmarker_heavy.task"

# PoseLandmarker indices (same as legacy PoseLandmark enum).
LANDMARK_MAP = {
    "nose": 0,
    "leftEye": 2,
    "rightEye": 5,
    "leftEar": 7,
    "rightEar": 8,
    "leftShoulder": 11,
    "rightShoulder": 12,
    "leftElbow": 13,
    "rightElbow": 14,
    "leftWrist": 15,
    "rightWrist": 16,
    "leftIndex": 19,
    "rightIndex": 20,
    "leftHip": 23,
    "rightHip": 24,
    "leftKnee": 25,
    "rightKnee": 26,
    "leftAnkle": 27,
    "rightAnkle": 28,
    "leftHeel": 29,
    "rightHeel": 30,
    "leftFootIndex": 31,
    "rightFootIndex": 32,
}

# Bone connections for the debug overlay (drawn in image space with OpenCV).
POSE_CONNECTIONS = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),  # arms + shoulders
    (11, 23), (12, 24), (23, 24),                       # torso
    (23, 25), (25, 27), (27, 29), (29, 31), (27, 31),   # left leg
    (24, 26), (26, 28), (28, 30), (30, 32), (28, 32),   # right leg
    (0, 2), (2, 7), (0, 5), (5, 8),                     # face
]

FRAME_RE = re.compile(r"frame_(\d+)\.png$")


def ensure_model() -> Path:
    """Download the PoseLandmarker model if it isn't cached yet."""
    if MODEL_PATH.exists():
        return MODEL_PATH
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Downloading pose model to {MODEL_PATH} ...", file=sys.stderr)
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    return MODEL_PATH


def load_frame_rgb(path: Path) -> np.ndarray:
    """Load a PNG and composite any alpha channel over mid-gray (128,128,128).

    MediaPipe ignores alpha and treats transparent pixels as solid black, which
    produces a hard silhouette edge and confuses the pose model. Compositing
    onto neutral gray gives the character a clean, body-agnostic background.
    """
    img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise RuntimeError(f"Failed to read image: {path}")

    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        bgr = img[:, :, :3].astype(np.float32)
        alpha = (img[:, :, 3:4].astype(np.float32)) / 255.0
        bg = np.full_like(bgr, 128.0)
        composite = bgr * alpha + bg * (1.0 - alpha)
        img = composite.astype(np.uint8)

    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def detect_frame(detector, rgb: np.ndarray) -> tuple[dict | None, float, list | None]:
    """Run pose detection on one RGB frame.

    Returns (keypoints_dict_or_none, avg_visibility, landmarks_list_or_none).
    The landmarks list is the raw 33-element array, returned so callers can
    draw debug overlays without re-running inference.
    """
    h, w = rgb.shape[:2]
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = detector.detect(mp_image)

    if not result.pose_landmarks:
        return None, 0.0, None

    landmarks = result.pose_landmarks[0]

    keypoints = {}
    visibilities = []
    for name, idx in LANDMARK_MAP.items():
        lm = landmarks[idx]
        keypoints[name] = {
            "x": round(lm.x * w, 1),
            "y": round(lm.y * h, 1),
            "v": round(lm.visibility, 3),
        }
        visibilities.append(lm.visibility)

    avg_vis = round(float(np.mean(visibilities)), 3) if visibilities else 0.0
    return keypoints, avg_vis, landmarks


def draw_debug(rgb: np.ndarray, landmarks) -> np.ndarray:
    """Return a BGR image with a skeleton drawn on top of the input frame."""
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR).copy()
    if landmarks is None:
        return bgr

    h, w = bgr.shape[:2]
    pts = []
    for lm in landmarks:
        pts.append((int(lm.x * w), int(lm.y * h), lm.visibility))

    for a, b in POSE_CONNECTIONS:
        if pts[a][2] < 0.3 or pts[b][2] < 0.3:
            continue
        cv2.line(bgr, pts[a][:2], pts[b][:2], (255, 255, 255), 1)

    for name, idx in LANDMARK_MAP.items():
        x, y, v = pts[idx]
        if v < 0.3:
            continue
        cv2.circle(bgr, (x, y), 2, (0, 255, 0), -1)

    return bgr


def list_frames(input_dir: Path) -> list[tuple[int, Path]]:
    """Return [(index, path), ...] sorted by frame index."""
    frames = []
    for p in input_dir.iterdir():
        m = FRAME_RE.match(p.name)
        if m:
            frames.append((int(m.group(1)), p))
    frames.sort(key=lambda t: t[0])
    return frames


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--debug-dir", type=Path, default=None)
    args = parser.parse_args()

    frames = list_frames(args.input_dir)
    if not frames:
        print(f"No frame_*.png found in {args.input_dir}", file=sys.stderr)
        return 1

    if args.debug_dir is not None:
        args.debug_dir.mkdir(parents=True, exist_ok=True)

    model_path = ensure_model()
    options = mp_vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
        running_mode=mp_vision.RunningMode.IMAGE,
        num_poses=1,
        min_pose_detection_confidence=0.3,
        min_pose_presence_confidence=0.3,
        min_tracking_confidence=0.3,
        output_segmentation_masks=False,
    )

    output = []
    with mp_vision.PoseLandmarker.create_from_options(options) as detector:
        for idx, path in frames:
            rgb = load_frame_rgb(path)
            keypoints, avg_vis, landmarks = detect_frame(detector, rgb)

            if keypoints is None:
                output.append({
                    "index": idx,
                    "detected": False,
                    "avgVisibility": 0.0,
                    "keypoints": None,
                })
            else:
                output.append({
                    "index": idx,
                    "detected": True,
                    "avgVisibility": avg_vis,
                    "keypoints": keypoints,
                })

            if args.debug_dir is not None:
                debug_img = draw_debug(rgb, landmarks)
                cv2.imwrite(
                    str(args.debug_dir / f"frame_{idx}_debug.png"), debug_img
                )

    json.dump(output, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
