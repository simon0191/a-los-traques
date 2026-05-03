#!/bin/bash
# Train all 17 fighters for El Cerebro (RFC 0020 Phase 3).
#
# Two passes per fighter:
#   Pass 1 (Bootstrap): collect data vs rule-based hard_plus, train 500K steps
#   Pass 2 (Self-play): collect data vs the bootstrap model, retrain 1M steps
#
# Usage:
#   bash scripts/cerebro/train-all.sh
#   bash scripts/cerebro/train-all.sh simon jeka   # train only specific fighters
#
# Estimated time: ~15 min per fighter × 17 = ~4-5 hours total
# Run overnight!

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

# Python from training venv
PYTHON="${ROOT_DIR}/training/.venv/bin/python"
if [ ! -f "$PYTHON" ]; then
  echo "ERROR: Python venv not found at ${PYTHON}"
  echo "Run: cd training && ~/.local/bin/uv venv && ~/.local/bin/uv pip install -r requirements.txt"
  exit 1
fi

# All fighters or specific ones from args
if [ $# -gt 0 ]; then
  FIGHTERS="$@"
else
  FIGHTERS="simon jeka chicha cata carito mao peks lini alv sun gartner richi cami migue bozzi angy adil"
fi

EPISODES_BOOTSTRAP=20000
EPISODES_SELFPLAY=10000
STEPS_BOOTSTRAP=500000
STEPS_SELFPLAY=1000000
OUTPUT_DIR="apps/web/public/assets/ai"

mkdir -p "$OUTPUT_DIR"

echo "============================================"
echo "  El Cerebro — Train All Fighters"
echo "============================================"
echo "Fighters: $FIGHTERS"
echo "Bootstrap: ${EPISODES_BOOTSTRAP} episodes, ${STEPS_BOOTSTRAP} steps"
echo "Self-play: ${EPISODES_SELFPLAY} episodes, ${STEPS_SELFPLAY} steps"
echo ""

TOTAL_START=$(date +%s)

for fighter in $FIGHTERS; do
  FIGHTER_START=$(date +%s)
  echo ""
  echo "=========================================="
  echo "  Fighter: $fighter"
  echo "=========================================="

  DATA_DIR="data/cerebro/${fighter}"
  CHECKPOINT_DIR="checkpoints/${fighter}"
  SELFPLAY_DATA_DIR="data/cerebro/${fighter}-selfplay"
  SELFPLAY_CHECKPOINT_DIR="checkpoints/${fighter}-selfplay"

  # --- Pass 1: Bootstrap ---
  echo ""
  echo "--- Pass 1: Bootstrap (vs rule-based hard_plus) ---"

  # Collect bootstrap data (mixed difficulties: 70% hard_plus, 20% medium, 10% easy)
  echo "[1/6] Collecting bootstrap data..."
  rm -rf "$DATA_DIR"
  node scripts/cerebro/collect.js --fighter="$fighter" --episodes=$((EPISODES_BOOTSTRAP * 7 / 10)) --difficulty=hard_plus --out-dir="$DATA_DIR"
  node scripts/cerebro/collect.js --fighter="$fighter" --episodes=$((EPISODES_BOOTSTRAP * 2 / 10)) --difficulty=medium --out-dir="$DATA_DIR"
  node scripts/cerebro/collect.js --fighter="$fighter" --episodes=$((EPISODES_BOOTSTRAP * 1 / 10)) --difficulty=easy --out-dir="$DATA_DIR" --seed=99999

  # Train bootstrap model
  echo "[2/6] Training bootstrap model (${STEPS_BOOTSTRAP} steps)..."
  $PYTHON training/dqn.py --data-dir="$DATA_DIR" --checkpoint-dir="$CHECKPOINT_DIR" --steps=$STEPS_BOOTSTRAP --checkpoint-every=100000

  # Export bootstrap model
  echo "[3/6] Exporting bootstrap ONNX..."
  $PYTHON training/export_onnx.py --checkpoint="${CHECKPOINT_DIR}/final.pt" --output="${CHECKPOINT_DIR}/bootstrap.onnx"

  # --- Pass 2: Self-play ---
  echo ""
  echo "--- Pass 2: Self-play (vs bootstrap model) ---"

  # Collect self-play data
  echo "[4/6] Collecting self-play data..."
  rm -rf "$SELFPLAY_DATA_DIR"
  node scripts/cerebro/collect.js --fighter="$fighter" --episodes=$EPISODES_SELFPLAY --difficulty=hard_plus --opponent-model="${CHECKPOINT_DIR}/bootstrap.onnx" --out-dir="$SELFPLAY_DATA_DIR"

  # Also add some rule-based data to prevent forgetting (20%)
  node scripts/cerebro/collect.js --fighter="$fighter" --episodes=$((EPISODES_SELFPLAY * 2 / 10)) --difficulty=hard_plus --out-dir="$SELFPLAY_DATA_DIR" --seed=77777

  # Train self-play model (resume from bootstrap)
  echo "[5/6] Training self-play model (${STEPS_SELFPLAY} steps)..."
  $PYTHON training/dqn.py --data-dir="$SELFPLAY_DATA_DIR" --checkpoint-dir="$SELFPLAY_CHECKPOINT_DIR" --steps=$STEPS_SELFPLAY --checkpoint-every=200000 --resume="${CHECKPOINT_DIR}/final.pt"

  # Export final model
  echo "[6/6] Exporting final ONNX..."
  $PYTHON training/export_onnx.py --checkpoint="${SELFPLAY_CHECKPOINT_DIR}/final.pt" --output="${OUTPUT_DIR}/${fighter}.onnx"

  FIGHTER_END=$(date +%s)
  FIGHTER_TIME=$((FIGHTER_END - FIGHTER_START))
  echo ""
  echo "  ✅ $fighter done in ${FIGHTER_TIME}s"
  echo "  Model: ${OUTPUT_DIR}/${fighter}.onnx ($(du -h "${OUTPUT_DIR}/${fighter}.onnx" | cut -f1))"
done

TOTAL_END=$(date +%s)
TOTAL_TIME=$((TOTAL_END - TOTAL_START))

echo ""
echo "============================================"
echo "  All fighters trained!"
echo "  Total time: ${TOTAL_TIME}s ($((TOTAL_TIME / 60)) min)"
echo "  Models in: ${OUTPUT_DIR}/"
echo "============================================"
echo ""
echo "Test with: http://localhost:3000/?ai=cerebro"

# Quick evaluation of all models
echo ""
echo "Running quick evaluation..."
for fighter in $FIGHTERS; do
  MODEL="${OUTPUT_DIR}/${fighter}.onnx"
  if [ -f "$MODEL" ]; then
    node scripts/cerebro/evaluate.js --model="$MODEL" --fighter="$fighter" --fights=50 --difficulty=hard_plus 2>/dev/null | grep "hard_plus" || echo "  $fighter: evaluation failed"
  fi
done
