"""
Train Norfleet ML models (XGBoost classifiers + LSTM TTF).

Usage:
  python train.py --dataset ai4i --csv data/raw/ai4i2020.csv
  python train.py --dataset nasa_bearing --bearing-dir data/raw/bearing
  python train.py --dataset femto
  python train.py --dataset battery_combined
  python train.py --dataset nist_ur5
  python train.py --dataset lstm_sequences
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

from dataset_loaders import (
    build_battery_feature_matrix,
    build_pick_drift_feature_matrix,
)
from features import extract_signal_features, kurtosis, rms
from lstm_train import train_lstm_ttf
from models import (
    BEARING_CLASSIFIER_PATH,
    BEARING_META_PATH,
    BATTERY_CLASSIFIER_PATH,
    BATTERY_META_PATH,
    CLASSIFIER_PATH,
    CLASSIFIER_META_PATH,
    PICK_DRIFT_CLASSIFIER_PATH,
    PICK_DRIFT_META_PATH,
    save_original_training_cache,
    train_classifier,
)
from paths import RAW_DIR

FAILURE_TYPE_MAP = {
    "TWF": "bearing_wear",
    "HDF": "bearing_wear",
    "PWF": "battery_degradation",
    "OWF": "motor_creep",
    "RNF": "pick_drift",
}


def kelvin_to_celsius(k: float) -> float:
    return float(k - 273.15)


def row_to_signal_window(row: pd.Series) -> dict[str, list[dict[str, float]]]:
    window: dict[str, list[dict[str, float]]] = {}
    rpm = float(row.get("Rotational speed [rpm]", 1500.0))
    torque = float(row.get("Torque [Nm]", 40.0))
    proc_k = float(row.get("Process temperature [K]", 310.0))
    wear = float(row.get("Tool wear [min]", 0.0))

    vibration = max(0.05, rpm / 6000.0 + (0.4 if row.get("Target", 0) else 0.0))
    motor_current = max(0.5, torque / 10.0)
    bearing_temp = kelvin_to_celsius(proc_k)
    battery_capacity = max(40.0, 100.0 - wear * 0.08 - (5.0 if row.get("Target", 0) else 0.0))
    drift = max(0.0, wear * 0.01)

    base_values = {
        "vibrationRms": vibration,
        "motorCurrentA": motor_current,
        "bearingTempC": bearing_temp,
        "batteryCapacityPct": battery_capacity,
        "pickActuatorDriftMm": drift,
    }

    for signal, latest in base_values.items():
        trend = np.linspace(latest * 0.92, latest, 5)
        window[signal] = [{"ts": i * 1000, "value": float(v)} for i, v in enumerate(trend)]
    return window


def label_ai4i_row(row: pd.Series) -> str:
    if int(row.get("Target", 0)) == 0:
        return "healthy"
    failure_type = str(row.get("Failure Type", "RNF"))
    return FAILURE_TYPE_MAP.get(failure_type, "bearing_wear")


def build_feature_matrix_from_windows(
    windows: list[dict[str, list[dict[str, float]]]],
    labels: list[str],
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    rows = []
    feature_order: list[str] | None = None
    for window, label in zip(windows, labels):
        flat: dict[str, float] = {}
        for signal, points in window.items():
            flat.update(extract_signal_features(signal, points))
        if feature_order is None:
            feature_order = sorted(flat.keys())
        rows.append([flat.get(k, 0.0) for k in feature_order])
    assert feature_order is not None
    return np.array(rows, dtype=float), np.array(labels), feature_order


def build_ai4i_matrix(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, list[str]]:
    windows = [row_to_signal_window(row) for _, row in df.iterrows()]
    labels = [label_ai4i_row(row) for _, row in df.iterrows()]
    return build_feature_matrix_from_windows(windows, labels)


def _bearing_window_from_values(values: np.ndarray, idx: int, window_size: int = 5) -> dict[str, list[dict[str, float]]]:
    segment = values[max(0, idx - window_size + 1) : idx + 1]
    vib_rms = float(rms(segment))
    vib_kurt = float(kurtosis(segment))
    bearing_temp = 42.0 + vib_rms * 12.0 + vib_kurt * 0.5
    trend = np.linspace(segment[0], segment[-1], len(segment))
    return {
        "vibrationRms": [{"ts": i * 1000, "value": float(v)} for i, v in enumerate(trend)],
        "bearingTempC": [{"ts": i * 1000, "value": float(bearing_temp * (0.98 + 0.02 * i))} for i in range(len(trend))],
    }


def load_nasa_bearing_runs(bearing_dir: Path) -> tuple[list[dict], list[str]]:
    if not bearing_dir.exists():
        raise FileNotFoundError(
            f"NASA bearing directory not found at {bearing_dir}. "
            "Place IMS bearing CSV files under data/raw/bearing/."
        )

    csv_files = sorted(bearing_dir.glob("*.csv"))
    if not csv_files:
        raise FileNotFoundError(f"No CSV files found in {bearing_dir}")

    windows: list[dict] = []
    labels: list[str] = []

    for csv_path in csv_files:
        df = pd.read_csv(csv_path)
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        if not len(numeric_cols):
            continue
        for col in numeric_cols:
            values = df[col].dropna().to_numpy(dtype=float)
            if values.size < 20:
                continue
            failure_start = int(values.size * 0.9)
            for idx in range(4, values.size):
                windows.append(_bearing_window_from_values(values, idx))
                labels.append("bearing_wear" if idx >= failure_start else "healthy")

    if not windows:
        raise ValueError(f"Could not extract bearing windows from CSV files in {bearing_dir}")

    return windows, labels


def build_nasa_bearing_matrix(bearing_dir: Path) -> tuple[np.ndarray, np.ndarray, list[str]]:
    windows, labels = load_nasa_bearing_runs(bearing_dir)
    return build_feature_matrix_from_windows(windows, labels)


def load_ai4i(csv_path: Path) -> pd.DataFrame:
    if not csv_path.exists():
        raise FileNotFoundError(
            f"Dataset not found at {csv_path}. Download with:\n"
            "  kaggle datasets download -d stephenlupo/predictive-maintenance-dataset -p data/raw --unzip"
        )
    return pd.read_csv(csv_path)


def _train_and_report(
    X: np.ndarray,
    y: np.ndarray,
    feature_order: list[str],
    out_path: Path,
    meta_path: Path,
    label: str,
) -> float:
    counts = Counter(y.tolist())
    print(f"{label} class balance: {dict(counts)}")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    calibrated = train_classifier(X_train, y_train, feature_order, out_path, meta_path)
    le_score = LabelEncoder().fit(y)
    y_test_encoded = le_score.transform(y_test)
    score = calibrated.score(X_test, y_test_encoded)
    print(f"{label} calibrated XGBoost hold-out accuracy: {score:.3f}")
    print(f"Saved classifier to {out_path}")
    return float(score)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train Norfleet ML models")
    parser.add_argument(
        "--dataset",
        choices=[
            "ai4i",
            "nasa_bearing",
            "femto",
            "battery_combined",
            "nist_ur5",
            "lstm_sequences",
        ],
        default="ai4i",
        help="Training dataset source",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=RAW_DIR / "ai4i2020.csv",
        help="Path to AI4I 2020 CSV (ai4i dataset)",
    )
    parser.add_argument(
        "--bearing-dir",
        type=Path,
        default=RAW_DIR / "bearing",
        help="Directory of NASA IMS bearing CSV files (nasa_bearing dataset)",
    )
    args = parser.parse_args()

    if args.dataset == "femto":
        metrics = train_lstm_ttf()
        print(
            f"FEMTO+LSTM combined training: {metrics['samples']} windows, "
            f"validation MAE: {metrics['val_mae_hours']:.3f} hours"
        )
        return

    if args.dataset == "lstm_sequences":
        metrics = train_lstm_ttf()
        print(f"LSTM TTF validation MAE: {metrics['val_mae_hours']:.3f} hours")
        return

    if args.dataset == "battery_combined":
        X, y, feature_order = build_battery_feature_matrix()
        _train_and_report(
            X, y, feature_order, BATTERY_CLASSIFIER_PATH, BATTERY_META_PATH, "Battery combined"
        )
        return

    if args.dataset == "nist_ur5":
        X, y, feature_order = build_pick_drift_feature_matrix()
        _train_and_report(
            X, y, feature_order, PICK_DRIFT_CLASSIFIER_PATH, PICK_DRIFT_META_PATH, "NIST UR5 pick drift"
        )
        return

    if args.dataset == "nasa_bearing":
        X, y, feature_order = build_nasa_bearing_matrix(args.bearing_dir)
        _train_and_report(
            X, y, feature_order, BEARING_CLASSIFIER_PATH, BEARING_META_PATH, "NASA bearing"
        )
        return

    df = load_ai4i(args.csv)
    X, y, feature_order = build_ai4i_matrix(df)
    save_original_training_cache(X, y, feature_order)
    _train_and_report(X, y, feature_order, CLASSIFIER_PATH, CLASSIFIER_META_PATH, "AI4I 2020")


if __name__ == "__main__":
    main()
