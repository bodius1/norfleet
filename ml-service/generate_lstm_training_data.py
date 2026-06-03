"""
Generate synthetic run-to-failure Health Index sequences for LSTM TTF training.

Usage:
  python generate_lstm_training_data.py --mode motor_creep
  python generate_lstm_training_data.py --mode bearing_wear
"""

from __future__ import annotations

import argparse

import numpy as np

from dataset_loaders import hi_from_rms_series
from paths import LSTM_SEQUENCES_PATH


def _motor_creep_run(run_id: int, length: int = 140) -> dict:
    t = np.linspace(0, 1, length)
    current = 4.2 + 3.8 * (t**1.8) + 0.08 * np.random.default_rng(run_id).normal(size=length)
    hi = hi_from_rms_series(current)
    duration_h = length * 30.0 / 3600.0
    return {"run_id": f"motor_creep_{run_id}", "hi": hi, "duration_hours": duration_h}


def _bearing_run(run_id: int, length: int = 120) -> dict:
    t = np.linspace(0, 1, length)
    rms_vals = 0.35 + 2.2 * (t**2.0) + 0.04 * np.random.default_rng(run_id + 100).normal(size=length)
    hi = hi_from_rms_series(rms_vals)
    duration_h = length * 5.0 / 3600.0
    return {"run_id": f"synthetic_bearing_{run_id}", "hi": hi, "duration_hours": duration_h}


def generate_runs(mode: str, count: int = 8) -> list[dict]:
    if mode == "motor_creep":
        return [_motor_creep_run(i) for i in range(count)]
    return [_bearing_run(i) for i in range(count)]


def save_sequences(runs: list[dict], out_path=LSTM_SEQUENCES_PATH, window_length: int = 10) -> int:
    from dataset_loaders import build_lstm_samples_from_runs

    seqs, targets = build_lstm_samples_from_runs(runs, window_length=window_length)
    if seqs.size == 0:
        return 0
    if out_path.exists():
        prev = np.load(out_path, allow_pickle=True)
        prev_seqs, prev_targets = prev["sequences"], prev["targets"]
        seqs = np.concatenate([prev_seqs, seqs], axis=0)
        targets = np.concatenate([prev_targets, targets], axis=0)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(out_path, sequences=seqs, targets=targets)
    return int(seqs.shape[0])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        choices=["motor_creep", "bearing_wear"],
        default="motor_creep",
        help="Degradation profile for synthetic RTF runs",
    )
    parser.add_argument("--count", type=int, default=8)
    args = parser.parse_args()
    runs = generate_runs(args.mode, args.count)
    n = save_sequences(runs)
    print(f"Saved {n} LSTM windows to {LSTM_SEQUENCES_PATH} (mode={args.mode})")


if __name__ == "__main__":
    main()
