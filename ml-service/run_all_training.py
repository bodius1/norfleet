"""Train all Norfleet ML artifacts (with synthetic fallbacks when raw data is missing)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

from paths import RAW_DIR

ROOT = Path(__file__).resolve().parent


def _ensure_two_classes(X: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if np.unique(y).size >= 2:
        return X, y
    only = str(y[0])
    alt = "healthy" if only != "healthy" else "bearing_wear"
    n = max(20, len(y) // 2)
    X_alt = X[:n].copy()
    if alt == "healthy":
        X_alt *= 0.7
    else:
        X_alt *= 1.4
    y_alt = np.array([alt] * n, dtype=y.dtype)
    return np.vstack([X, X_alt]), np.concatenate([y, y_alt])


def _bootstrap_bearing_window(healthy: bool) -> dict[str, list[dict[str, float]]]:
    if healthy:
        vib = np.linspace(0.18, 0.32, 5)
        temp = np.linspace(40.0, 42.5, 5)
        capacity = np.linspace(96.0, 94.5, 5)
    else:
        vib = np.linspace(1.4, 2.6, 5)
        temp = np.linspace(58.0, 68.0, 5)
        capacity = np.linspace(78.0, 72.0, 5)
    return {
        "vibrationRms": [{"ts": i * 1000, "value": float(v)} for i, v in enumerate(vib)],
        "bearingTempC": [{"ts": i * 1000, "value": float(t)} for i, t in enumerate(temp)],
        "batteryCapacityPct": [{"ts": i * 1000, "value": float(c)} for i, c in enumerate(capacity)],
    }


def _run(args: list[str]) -> None:
    cmd = [sys.executable, str(ROOT / "train.py"), *args]
    print(">", " ".join(cmd))
    subprocess.run(cmd, check=True, cwd=str(ROOT))


def _bootstrap_ai4i_if_needed() -> None:
    csv = RAW_DIR / "ai4i2020.csv"
    if csv.exists():
        _run(["--dataset", "ai4i", "--csv", str(csv)])
        return
    print("WARNING: ai4i2020.csv missing; training minimal synthetic general classifier.")
    from train import build_feature_matrix_from_windows, label_ai4i_row, row_to_signal_window
    from models import CLASSIFIER_META_PATH, CLASSIFIER_PATH, save_original_training_cache, train_classifier
    import pandas as pd

    rows = []
    for target, failure in [(0, "RNF"), (1, "TWF"), (1, "PWF"), (1, "OWF"), (1, "RNF")]:
        for i in range(40):
            rows.append(
                {
                    "Target": target,
                    "Failure Type": failure,
                    "Rotational speed [rpm]": 1500 + i * 5 * target,
                    "Torque [Nm]": 40 + i * 0.2 * target,
                    "Process temperature [K]": 310 + i * 0.5 * target,
                    "Tool wear [min]": i * 2 * target,
                }
            )
    df = pd.DataFrame(rows)
    windows = [row_to_signal_window(r) for _, r in df.iterrows()]
    labels = [label_ai4i_row(r) for _, r in df.iterrows()]
    X, y, order = build_feature_matrix_from_windows(windows, labels)
    X, y = _ensure_two_classes(X, y)
    save_original_training_cache(X, y, order)
    train_classifier(X, y, order, CLASSIFIER_PATH, CLASSIFIER_META_PATH)
    print("Saved bootstrap general classifier.")


def main() -> None:
    _bootstrap_ai4i_if_needed()
    bearing_dir = RAW_DIR / "bearing"
    if bearing_dir.exists() and list(bearing_dir.glob("*.csv")):
        _run(["--dataset", "nasa_bearing", "--bearing-dir", str(bearing_dir)])
    else:
        print("WARNING: No IMS bearing CSVs; training bootstrap bearing classifier from synthetic vibration.")
        from train import build_feature_matrix_from_windows
        from models import BEARING_CLASSIFIER_PATH, BEARING_META_PATH, train_classifier

        windows, labels = [], []
        for _ in range(40):
            windows.append(_bootstrap_bearing_window(healthy=True))
            labels.append("healthy")
        for _ in range(40):
            windows.append(_bootstrap_bearing_window(healthy=False))
            labels.append("bearing_wear")
        X, y, order = build_feature_matrix_from_windows(windows, labels)
        X, y = _ensure_two_classes(X, y)
        train_classifier(X, y, order, BEARING_CLASSIFIER_PATH, BEARING_META_PATH)

    _run(["--dataset", "battery_combined"])
    _run(["--dataset", "nist_ur5"])
    _run(["--dataset", "femto"])

    gen = [sys.executable, str(ROOT / "generate_lstm_training_data.py"), "--mode", "motor_creep"]
    subprocess.run(gen, check=True, cwd=str(ROOT))
    _run(["--dataset", "lstm_sequences"])

    from models import _save_retrain_state

    _save_retrain_state({"last_retrain_line_count": 0, "model_version": "norfleet-ml-v1"})
    print("All training complete. model_version=norfleet-ml-v1")


if __name__ == "__main__":
    main()
