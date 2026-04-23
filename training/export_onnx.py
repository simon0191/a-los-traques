"""
Export a trained DQN checkpoint to ONNX with optional int8 quantization.

Usage:
  python training/export_onnx.py --checkpoint checkpoints/final.pt --output simon.onnx
  python training/export_onnx.py --checkpoint checkpoints/final.pt --output simon.onnx --quantize
"""

import argparse
import os

import numpy as np
import onnx
import torch

from dqn import DuelingDQN


def export(
    checkpoint_path: str,
    output_path: str,
    obs_dim: int = 47,
    n_actions: int = 72,
    hidden: int = 128,
    quantize: bool = False,
):
    # Load model
    model = DuelingDQN(obs_dim, n_actions, hidden)
    model.load_state_dict(torch.load(checkpoint_path, map_location="cpu", weights_only=True))
    model.eval()

    # Export to ONNX
    dummy = torch.randn(1, obs_dim)
    tmp_path = output_path if not quantize else output_path + ".tmp.onnx"

    torch.onnx.export(
        model,
        dummy,
        tmp_path,
        input_names=["obs"],
        output_names=["q_values"],
        dynamic_axes={"obs": {0: "batch"}, "q_values": {0: "batch"}},
        opset_version=17,
    )

    if quantize:
        from onnxruntime.quantization import quantize_dynamic, QuantType

        quantize_dynamic(
            tmp_path,
            output_path,
            weight_type=QuantType.QUInt8,
        )
        os.remove(tmp_path)
        print(f"Quantized model: {output_path}")
    else:
        print(f"Model: {output_path}")

    # Report size
    size_kb = os.path.getsize(output_path) / 1024
    print(f"Size: {size_kb:.1f} KB")

    # Verify with numpy
    onnx_model = onnx.load(output_path)
    onnx.checker.check_model(onnx_model)

    import onnxruntime as ort

    sess = ort.InferenceSession(output_path)
    test_obs = np.random.randn(1, obs_dim).astype(np.float32)
    q_values = sess.run(None, {"obs": test_obs})[0]
    print(f"Test inference: Q-values shape={q_values.shape}, range=[{q_values.min():.3f}, {q_values.max():.3f}]")
    print(f"Best action: {q_values.argmax()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export DQN to ONNX")
    parser.add_argument("--checkpoint", required=True, help="Path to .pt checkpoint")
    parser.add_argument("--output", required=True, help="Output .onnx path")
    parser.add_argument("--quantize", action="store_true", help="Apply int8 quantization")
    parser.add_argument("--obs-dim", type=int, default=47)
    parser.add_argument("--n-actions", type=int, default=72)
    parser.add_argument("--hidden", type=int, default=128)
    args = parser.parse_args()

    export(
        checkpoint_path=args.checkpoint,
        output_path=args.output,
        obs_dim=args.obs_dim,
        n_actions=args.n_actions,
        hidden=args.hidden,
        quantize=args.quantize,
    )
