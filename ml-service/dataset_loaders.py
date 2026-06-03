"""Dataset loaders for Norfleet ml-service training."""

from __future__ import annotations

import ast
import os
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy.io import loadmat

from features import extract_signal_features, kurtosis, rms, trend_slope
from paths import (
    BATTERY_CHE2023,
    BATTERY_NASA_2007,
    BATTERY_NASA_RAND,
    FEMTO_ROOT,
    LSTM_SEQUENCES_PATH,
    NIST_UR5_ROOT,
)

FEMTO_SNAPSHOT_SEC = 5.0
EOL_CAPACITY_RATIO = 0.70


def hi_from_rms_series(rms_values: np.ndarray) -> np.ndarray:
    """Map RMS trend to HI in [0,1]: healthy≈1.0, failing≈0.0 (matches features.js stress inversion)."""
    if rms_values.size == 0:
        return np.array([], dtype=float)
    baseline = float(np.percentile(rms_values[: max(3, rms_values.size // 10)], 50))
    peak = float(np.max(rms_values))
    span = max(peak - baseline, 1e-6)
    stress = np.clip((rms_values - baseline) / span, 0.0, 1.0)
    return np.clip(1.0 - stress, 0.0, 1.0)


def _snapshot_rms_from_csv(csv_path: Path) -> float:
    df = pd.read_csv(csv_path, header=None)
    numeric = df.select_dtypes(include=[np.number])
    if numeric.empty:
        for col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        numeric = df.select_dtypes(include=[np.number])
    if numeric.empty:
        values = df.values.astype(float).ravel()
    else:
        values = numeric.values.astype(float).ravel()
    values = values[np.isfinite(values)]
    if values.size == 0:
        return 0.0
    return float(rms(values))


def load_femto_runs(femto_root: Path = FEMTO_ROOT) -> list[dict[str, Any]]:
    """
    Load FEMTO run-to-failure experiments.
    Each run: sorted snapshot CSVs -> RMS per 5s window -> HI sequence + total duration hours.
    """
    csv_files = []
    if femto_root.exists():
        for split in ("Training_set", "Test_set", "training_set", "test_set"):
            split_dir = femto_root / split
            if split_dir.exists():
                csv_files.extend(sorted(split_dir.rglob("*.csv")))
        if not csv_files:
            csv_files = sorted(femto_root.rglob("*.csv"))

    runs: list[dict[str, Any]] = []
    if csv_files:
        by_run: dict[str, list[Path]] = {}
        for path in csv_files:
            run_id = path.parent.name if path.parent != femto_root else path.stem
            by_run.setdefault(run_id, []).append(path)
        for run_id, paths in by_run.items():
            paths = sorted(paths, key=lambda p: p.name)
            rms_vals = np.array([_snapshot_rms_from_csv(p) for p in paths], dtype=float)
            if rms_vals.size < 8:
                continue
            hi = hi_from_rms_series(rms_vals)
            duration_h = len(paths) * FEMTO_SNAPSHOT_SEC / 3600.0
            runs.append({"run_id": run_id, "hi": hi, "duration_hours": duration_h})
        return runs

    # Synthetic RTF when FEMTO tree not present (dev/CI)
    print(f"WARNING: No FEMTO CSVs under {femto_root}; generating synthetic bearing RTF runs.")
    for idx in range(6):
        n = 120
        t = np.linspace(0, 1, n)
        rms_vals = 0.35 + 2.5 * (t**2.2) + 0.05 * np.random.default_rng(idx).normal(size=n)
        runs.append(
            {
                "run_id": f"synthetic_bearing_{idx}",
                "hi": hi_from_rms_series(rms_vals),
                "duration_hours": n * FEMTO_SNAPSHOT_SEC / 3600.0,
            }
        )
    return runs


def build_lstm_samples_from_runs(
    runs: list[dict[str, Any]],
    window_length: int = 10,
) -> tuple[np.ndarray, np.ndarray]:
    """Sliding windows on HI -> target = remaining hours to end of run."""
    seqs: list[np.ndarray] = []
    targets: list[float] = []
    for run in runs:
        hi = run["hi"]
        if hi.size < window_length + 2:
            continue
        total_h = float(run["duration_hours"])
        step_h = total_h / max(len(hi) - 1, 1)
        for end in range(window_length, len(hi)):
            window = hi[end - window_length : end]
            remaining = (len(hi) - 1 - end) * step_h
            seqs.append(window.reshape(window_length, 1))
            targets.append(max(0.05, remaining))
    if not seqs:
        return np.empty((0, window_length, 1)), np.array([])
    return np.stack(seqs, axis=0), np.array(targets, dtype=float)


def load_lstm_sequences_npz(path: Path = LSTM_SEQUENCES_PATH) -> tuple[np.ndarray, np.ndarray]:
    if not path.exists():
        return np.empty((0, 10, 1)), np.array([])
    data = np.load(path, allow_pickle=True)
    return data["sequences"], data["targets"]


def _battery_window_from_cycle(
    capacity_pct: float,
    voltage: float,
    temp_c: float,
    cap_history: list[float],
    volt_history: list[float],
) -> dict[str, list[dict[str, float]]]:
    n = max(len(cap_history), 5)
    cap_trend = np.linspace(cap_history[0] if cap_history else capacity_pct, capacity_pct, n)
    volt_trend = np.linspace(volt_history[0] if volt_history else voltage, voltage, n)
    temp = 30.0 + (100.0 - capacity_pct) * 0.15 + temp_c * 0.01
    temp_trend = np.linspace(30.0, temp, n)
    return {
        "batteryCapacityPct": [{"ts": i * 1000, "value": float(v)} for i, v in enumerate(cap_trend)],
        "batteryVoltage": [{"ts": i * 1000, "value": float(v)} for i, v in enumerate(volt_trend)],
        "bearingTempC": [{"ts": i * 1000, "value": float(v)} for i, v in enumerate(temp_trend)],
    }


def _extract_nasa_2007_cycles(battery_dir: Path) -> list[dict[str, Any]]:
    cycles: list[dict[str, Any]] = []
    mat_files = sorted(battery_dir.glob("*.mat")) if battery_dir.exists() else []
    for mat_path in mat_files:
        try:
            mat = loadmat(mat_path, struct_as_record=False, squeeze_me=True)
        except Exception:
            continue
        cycle = mat.get("cycle") if hasattr(mat, "get") else None
        if cycle is None:
            continue
        try:
            cycle_arr = np.atleast_1d(cycle)
        except Exception:
            continue
        for c in cycle_arr:
            try:
                cap = float(np.squeeze(getattr(c, "capacity", 0)))
                volt = float(np.mean(np.squeeze(getattr(c, "voltage", [48.0]))))
                temp = float(np.mean(np.squeeze(getattr(c, "temperature", [25.0]))))
                if np.isfinite(cap) and cap > 0:
                    cycles.append({"capacity": cap, "voltage": volt, "temp": temp})
            except Exception:
                continue
    return cycles


def _extract_che2023_cycles(che_dir: Path) -> list[dict[str, Any]]:
    cycles: list[dict[str, Any]] = []
    if not che_dir.exists():
        return cycles
    mat_files = sorted(che_dir.rglob("*.mat"))
    for mat_path in mat_files:
        try:
            mat = loadmat(mat_path)
        except Exception:
            continue
        for key, val in mat.items():
            if key.startswith("__"):
                continue
            arr = np.asarray(val)
            if arr.size < 10:
                continue
            flat = arr.ravel()
            flat = flat[np.isfinite(flat)]
            if flat.size < 10:
                continue
            # Treat as capacity curve samples
            for i, cap in enumerate(flat[: min(500, flat.size)]):
                if cap <= 0:
                    continue
                cycles.append({"capacity": float(cap), "voltage": 48.0 - i * 0.01, "temp": 25.0})
    return cycles


def _synthetic_battery_cycles(n: int = 200, seed: int = 0) -> list[dict[str, Any]]:
    rng = np.random.default_rng(seed)
    caps = np.linspace(100.0, 55.0, n) + rng.normal(0, 0.5, n)
    return [
        {"capacity": float(c), "voltage": 48.0 - (100 - c) * 0.05, "temp": 25.0 + (100 - c) * 0.1}
        for c in caps
    ]


def load_battery_combined_samples() -> tuple[list[dict], list[str]]:
    """Merge NASA 2007, NASA randomized, CHE2023 into Norfleet battery windows + labels."""
    all_cycles: list[dict[str, Any]] = []
    all_cycles.extend(_extract_nasa_2007_cycles(BATTERY_NASA_2007))
    all_cycles.extend(_extract_nasa_2007_cycles(BATTERY_NASA_RAND))
    all_cycles.extend(_extract_che2023_cycles(BATTERY_CHE2023))

    if len(all_cycles) < 20:
        print("WARNING: Battery MAT files sparse/missing; augmenting with synthetic degradation cycles.")
        all_cycles.extend(_synthetic_battery_cycles(240))

    if not all_cycles:
        all_cycles = _synthetic_battery_cycles(240)

    initial = float(np.max([c["capacity"] for c in all_cycles[:10]]))
    windows: list[dict] = []
    labels: list[str] = []
    cap_hist: list[float] = []
    volt_hist: list[float] = []

    for c in all_cycles:
        cap_pct = 100.0 * c["capacity"] / max(initial, 1e-6)
        cap_hist.append(cap_pct)
        volt_hist.append(c["voltage"])
        label = "battery_degradation" if cap_pct < EOL_CAPACITY_RATIO * 100 else "healthy"
        if len(cap_hist) >= 3:
            windows.append(_battery_window_from_cycle(cap_pct, c["voltage"], c["temp"], cap_hist, volt_hist))
            labels.append(label)

    return windows, labels


def build_battery_feature_matrix() -> tuple[np.ndarray, np.ndarray, list[str]]:
    windows, labels = load_battery_combined_samples()
    rows = []
    feature_order: list[str] | None = None
    for window, label in zip(windows, labels):
        flat: dict[str, float] = {}
        for signal, points in window.items():
            flat.update(extract_signal_features(signal, points))
        cap_pts = window.get("batteryCapacityPct", [])
        volt_pts = window.get("batteryVoltage", [])
        cap_vals = np.array([p["value"] for p in cap_pts], dtype=float)
        volt_vals = np.array([p["value"] for p in volt_pts], dtype=float)
        flat["batteryCapacityPct__fade_rate"] = float(-trend_slope(cap_vals)) if cap_vals.size else 0.0
        flat["batteryVoltage__drop_rate"] = float(-trend_slope(volt_vals)) if volt_vals.size else 0.0
        if feature_order is None:
            feature_order = sorted(flat.keys())
        rows.append([flat.get(k, 0.0) for k in feature_order])
    assert feature_order is not None
    return np.array(rows, dtype=float), np.array(labels), feature_order


def _parse_nist_tuple_line(line: str) -> Any:
    line = line.strip().lstrip("\ufeff")
    if not line or line.startswith("#"):
        return None
    try:
        return ast.literal_eval(line)
    except (SyntaxError, ValueError):
        return None


def _read_nist_ur5_text(csv_path: Path) -> str:
    raw = csv_path.read_bytes()
    if raw.startswith(b"\xff\xfe"):
        return raw.decode("utf-16-le")
    if raw.startswith(b"\xfe\xff"):
        return raw.decode("utf-16-be")
    return raw.decode("utf-8-sig")


def _print_nist_ur5_format_diagnostic(sample: Path) -> None:
    """Print format probes for one NIST UR5 file (set NIST_UR5_DIAG=1 to enable)."""
    print(f"NIST UR5 diagnostic file: {sample}")
    raw = sample.read_bytes()
    print("first 5 lines as bytes:")
    for i, line in enumerate(raw.splitlines()[:5]):
        print(f"  [{i}] {line[:160]!r}")
    attempts = [
        ("tab utf-16", {"sep": "\t", "encoding": "utf-16", "skiprows": 0}),
        ("comma utf-8", {"sep": ",", "encoding": "utf-8", "skiprows": 0}),
        ("python sep", {"sep": None, "engine": "python", "encoding": "utf-8", "skiprows": 0}),
        ("comma utf-8-sig", {"sep": ",", "encoding": "utf-8-sig", "skiprows": 0}),
    ]
    for label, kwargs in attempts:
        try:
            df = pd.read_csv(sample, **kwargs)
            print(f"  {label}: OK columns={list(df.columns)} shape={df.shape}")
        except Exception as exc:
            print(f"  {label}: FAIL {type(exc).__name__}: {exc}")
    literal_rows = _load_nist_ur5_rows_literal(_read_nist_ur5_text(sample).splitlines())
    print(f"  tuple-literal parser: {len(literal_rows)} rows")


def _rows_from_nist_dataframe(df: pd.DataFrame) -> list[dict[str, float]]:
    numeric = df.apply(pd.to_numeric, errors="coerce").dropna(how="all")
    rows: list[dict[str, float]] = []
    for _, series in numeric.iterrows():
        vals = series.to_numpy(dtype=float)
        vals = vals[np.isfinite(vals)]
        if vals.size < 6:
            continue
        ref = vals[1:4] if vals.size >= 7 else vals[0:3]
        act = vals[4:7] if vals.size >= 7 else vals[3:6]
        err = act - ref
        tcp_dev = float(np.linalg.norm(err[:3]))
        current = float(np.mean(np.abs(vals[7:13]))) if vals.size >= 13 else 0.0
        temp = float(np.mean(vals[12:18])) if vals.size >= 18 else 32.0
        velocity = float(np.mean(np.abs(vals[10:16]))) if vals.size >= 16 else 0.0
        rows.append(
            {
                "tcp_dev": tcp_dev,
                "current": current,
                "temp": temp,
                "velocity": velocity,
            }
        )
    return rows


def _load_nist_ur5_rows_tabular(csv_path: Path) -> list[dict[str, float]]:
    attempts = [
        {"sep": "\t", "encoding": "utf-16"},
        {"sep": "\t", "encoding": "utf-16-le"},
        {"sep": "\t", "encoding": "utf-8-sig"},
        {"sep": ",", "encoding": "utf-8-sig"},
        {"sep": ",", "encoding": "utf-8"},
        {"sep": None, "engine": "python", "encoding": "utf-8-sig"},
    ]
    for kwargs in attempts:
        try:
            df = pd.read_csv(csv_path, skiprows=0, **kwargs)
            if df.shape[0] < 10 or df.shape[1] < 4:
                continue
            rows = _rows_from_nist_dataframe(df)
            if rows:
                return rows
        except Exception:
            continue
    return []


def _load_nist_ur5_rows_literal(lines: list[str]) -> list[dict[str, float]]:
    rows: list[dict[str, float]] = []
    for line in lines:
        parsed = _parse_nist_tuple_line(line)
        if not isinstance(parsed, tuple):
            continue
        row = _nist_row_from_parsed(parsed)
        if row is not None:
            rows.append(row)
    return rows


NIST_WINDOW_ROWS = 500
NIST_WINDOW_STEP = 250


def _nist_row_from_parsed(parsed: tuple) -> dict[str, float] | None:
    if len(parsed) < 3:
        return None
    ref = parsed[1] if len(parsed) > 1 else None
    act = parsed[2] if len(parsed) > 2 else None
    if not (
        isinstance(ref, (tuple, list))
        and isinstance(act, (tuple, list))
        and len(ref) >= 3
        and len(act) >= 3
    ):
        return None
    err = [float(act[i]) - float(ref[i]) for i in range(3)]
    tcp_dev = float(np.linalg.norm(err))
    current = 0.0
    for idx in (6, 9):
        if len(parsed) > idx and isinstance(parsed[idx], tuple):
            vals = [float(v) for v in parsed[idx] if isinstance(v, (int, float))]
            if vals:
                current = float(np.mean(np.abs(vals)))
                break
    temp = 32.0
    if len(parsed) > 12 and isinstance(parsed[12], tuple):
        vals = [float(v) for v in parsed[12] if isinstance(v, (int, float))]
        if vals:
            temp = float(np.mean(vals))
    velocity = 0.0
    if len(parsed) > 10 and isinstance(parsed[10], tuple):
        vals = [float(v) for v in parsed[10] if isinstance(v, (int, float))]
        if vals:
            velocity = float(np.mean(np.abs(vals)))
    return {"tcp_dev": tcp_dev, "current": current, "temp": temp, "velocity": velocity}


def _load_nist_ur5_rows(csv_path: Path) -> list[dict[str, float]]:
    if csv_path.suffix.lower() != ".csv":
        return []
    lines = _read_nist_ur5_text(csv_path).splitlines()
    rows = _load_nist_ur5_rows_literal(lines)
    if rows:
        return rows
    return _load_nist_ur5_rows_tabular(csv_path)


def _nist_window_from_segment(segment: list[dict[str, float]]) -> dict[str, list[dict[str, float]]]:
    tcp = np.array([r["tcp_dev"] for r in segment], dtype=float)
    cur = np.array([r["current"] for r in segment], dtype=float)
    temp = np.array([r["temp"] for r in segment], dtype=float)
    vel = np.array([r["velocity"] for r in segment], dtype=float)
    step_ms = 8

    def pts(values: np.ndarray) -> list[dict[str, float]]:
        return [{"ts": i * step_ms, "value": float(v)} for i, v in enumerate(values)]

    return {
        "pickAccuracyPct": pts(np.maximum(70.0, 100.0 - tcp * 0.5)),
        "pickActuatorDriftMm": pts(tcp * 0.02),
        "motorCurrentA": pts(cur),
        "bearingTempC": pts(temp),
        "cycleTimeMs": pts(4200.0 + vel * 100.0),
    }


def load_nist_ur5_header_hints(root: Path = NIST_UR5_ROOT) -> dict[str, str]:
    hints: dict[str, str] = {}
    for pattern in ("*.xls", "*.xlsx", "*.XLS", "*.XLSX"):
        for path in sorted(root.glob(pattern)):
            try:
                df = pd.read_excel(path, header=None)
                for _, row in df.iterrows():
                    text = " ".join(str(v) for v in row.values if pd.notna(v)).lower()
                    if "tcp" in text or "position" in text:
                        hints["tcp"] = text
                    if "current" in text:
                        hints["current"] = text
                    if "temperature" in text:
                        hints["temperature"] = text
            except Exception:
                continue
    return hints


def load_nist_ur5_samples(root: Path = NIST_UR5_ROOT) -> tuple[list[dict], list[str], list[bool]]:
    csv_files = sorted(p for p in root.glob("*.csv") if p.suffix.lower() == ".csv")
    if not csv_files:
        raise FileNotFoundError(f"No NIST UR5 CSV files in {root}")

    if os.environ.get("NIST_UR5_DIAG"):
        _print_nist_ur5_format_diagnostic(csv_files[0])

    load_nist_ur5_header_hints(root)
    file_stats: list[dict[str, Any]] = []
    for path in csv_files:
        row_series = _load_nist_ur5_rows(path)
        if not row_series:
            continue
        mean_dev = float(np.mean([r["tcp_dev"] for r in row_series]))
        file_stats.append(
            {
                "path": path,
                "rows": row_series,
                "mean_tcp_dev": mean_dev,
                "cold_start": "coldstart" in path.name.lower(),
            }
        )

    if not file_stats:
        _print_nist_ur5_format_diagnostic(csv_files[0])
        raise ValueError(f"No parseable rows in NIST UR5 CSV files under {root}")

    ranked = sorted(file_stats, key=lambda f: f["mean_tcp_dev"])
    half = len(ranked) // 2
    label_by_path = {
        stat["path"]: ("healthy" if idx < half else "pick_drift")
        for idx, stat in enumerate(ranked)
    }

    windows: list[dict] = []
    labels: list[str] = []
    cold_flags: list[bool] = []

    for stat in file_stats:
        file_label = label_by_path[stat["path"]]
        rows = stat["rows"]
        if len(rows) < NIST_WINDOW_ROWS:
            continue
        for start in range(0, len(rows) - NIST_WINDOW_ROWS + 1, NIST_WINDOW_STEP):
            segment = rows[start : start + NIST_WINDOW_ROWS]
            window = _nist_window_from_segment(segment)
            window["cold_start_flag"] = [
                {"ts": 0, "value": 1.0 if stat["cold_start"] else 0.0}
            ]
            windows.append(window)
            labels.append(file_label)
            cold_flags.append(bool(stat["cold_start"]))

    if not windows:
        raise ValueError(f"No sliding windows extracted from NIST UR5 CSV files under {root}")

    return windows, labels, cold_flags


def build_pick_drift_feature_matrix() -> tuple[np.ndarray, np.ndarray, list[str]]:
    windows, labels, _ = load_nist_ur5_samples()
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
