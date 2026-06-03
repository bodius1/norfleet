"""Feature extraction from Norfleet telemetry sliding windows."""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy import stats
from scipy.fft import rfft, rfftfreq

NORFLEET_SIGNALS = (
    "vibrationRms",
    "motorCurrentA",
    "bearingTempC",
    "batteryVoltage",
    "batteryCapacityPct",
    "cycleTimeMs",
    "pickAccuracyPct",
    "pickActuatorDriftMm",
)

# Mirrors predictor/features.js HI_WEIGHTS for composite health index series.
HI_WEIGHTS = {
    "vibrationRms": 0.22,
    "motorCurrentA": 0.32,
    "bearingTempC": 0.18,
    "batteryCapacityPct": 0.20,
    "batteryVoltage": 0.12,
    "pickAccuracyPct": 0.18,
    "pickActuatorDriftMm": 0.20,
    "cycleTimeMs": 0.12,
    "trafficDelayMs": 0.06,
    "travelTimeMs": 0.08,
    "dockAlignmentMm": 0.10,
}

BASELINES = {
    "vibrationRms": 0.35,
    "motorCurrentA": 4.2,
    "bearingTempC": 42.0,
    "batteryVoltage": 48.2,
    "batteryCapacityPct": 92.0,
    "cycleTimeMs": 4200.0,
    "pickAccuracyPct": 98.2,
    "pickActuatorDriftMm": 0.4,
}


def _series_values(points: list[dict[str, Any]]) -> np.ndarray:
    if not points:
        return np.array([], dtype=float)
    return np.array([float(p.get("value", p.get("v", 0.0))) for p in points], dtype=float)


def rms(values: np.ndarray) -> float:
    if values.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(values))))


def kurtosis(values: np.ndarray) -> float:
    if values.size < 4:
        return 0.0
    return float(stats.kurtosis(values, fisher=True, nan_policy="omit"))


def trend_slope(values: np.ndarray) -> float:
    if values.size < 2:
        return 0.0
    x = np.arange(values.size, dtype=float)
    slope, _ = np.polyfit(x, values, 1)
    return float(slope)


def dominant_frequency(values: np.ndarray, sample_hz: float = 1.0) -> float:
    if values.size < 8:
        return 0.0
    centered = values - np.mean(values)
    spectrum = np.abs(rfft(centered))
    freqs = rfftfreq(centered.size, d=1.0 / max(sample_hz, 1e-6))
    if spectrum.size <= 1:
        return 0.0
    idx = int(np.argmax(spectrum[1:]) + 1)
    return float(freqs[idx])


def degradation_rate(values: np.ndarray) -> float:
    """Negative slope for capacity-style signals (pct/hour proxy)."""
    if values.size < 2:
        return 0.0
    return float(-trend_slope(values))


def signal_stress(signal: str, latest: float) -> float:
    baseline = BASELINES.get(signal, 1.0) or 1.0
    if signal in {"batteryCapacityPct", "batteryVoltage", "pickAccuracyPct"}:
        return float(max(0.0, min(1.0, (baseline - latest) / max(baseline * 0.35, 1e-6))))
    return float(max(0.0, min(1.0, (latest - baseline) / max(baseline * 0.65, 1e-6))))


def extract_signal_features(signal: str, points: list[dict[str, Any]]) -> dict[str, float]:
    values = _series_values(points)
    latest = float(values[-1]) if values.size else 0.0
    out = {
        f"{signal}__latest": latest,
        f"{signal}__rms": rms(values),
        f"{signal}__kurtosis": kurtosis(values),
        f"{signal}__slope": trend_slope(values),
        f"{signal}__stress": signal_stress(signal, latest) if values.size else 0.0,
    }
    if signal in {"vibrationRms", "bearingTempC"}:
        out[f"{signal}__dominant_freq"] = dominant_frequency(values)
    if signal in {"batteryCapacityPct", "batteryVoltage"}:
        out[f"{signal}__degradation_rate"] = degradation_rate(values)
    return out


def extract_window_features(signal_window: dict[str, list[dict[str, Any]]]) -> dict[str, float]:
    """Flatten per-signal features from a Norfleet signal_window map."""
    features: dict[str, float] = {}
    for signal in NORFLEET_SIGNALS:
        points = signal_window.get(signal) or []
        features.update(extract_signal_features(signal, points))
    return features


def estimate_health_index(signal_window: dict[str, list[dict[str, Any]]]) -> float:
    series = build_health_index_series(signal_window)
    if not series:
        return 1.0
    return float(series[-1])


def build_health_index_series(
    signal_window: dict[str, list[dict[str, Any]]],
) -> list[float]:
    """Composite HI series aligned with predictor/features.js buildHealthIndexSeries."""
    keys = [k for k, pts in signal_window.items() if pts]
    if not keys:
        return []

    by_ts: dict[float, dict[str, float]] = {}
    for signal in keys:
        for pt in signal_window[signal]:
            ts = float(pt.get("ts", 0))
            by_ts.setdefault(ts, {})[signal] = float(pt.get("value", 0.0))

    series: list[float] = []
    for ts in sorted(by_ts.keys()):
        values_at_ts = by_ts[ts]
        degradation = 0.0
        w_sum = 0.0
        for signal in keys:
            if signal not in values_at_ts:
                continue
            w = HI_WEIGHTS.get(signal, 0.05)
            w_sum += w
            degradation += signal_stress(signal, values_at_ts[signal]) * w
        hi = 1.0 - degradation / w_sum if w_sum else 1.0
        series.append(float(max(0.0, min(1.0, hi))))
    return series


def health_index_sequence_for_lstm(
    signal_window: dict[str, list[dict[str, Any]]],
    min_length: int = 5,
) -> np.ndarray:
    """Return HI values as [seq_len] float array for LSTM TTF input."""
    series = build_health_index_series(signal_window)
    if len(series) < min_length:
        return np.array([], dtype=float)
    return np.array(series, dtype=float)


def top_signals_from_window(
    signal_window: dict[str, list[dict[str, Any]]], limit: int = 4
) -> list[dict[str, Any]]:
    ranked: list[tuple[float, dict[str, Any]]] = []
    for signal, points in signal_window.items():
        values = _series_values(points)
        if values.size == 0:
            continue
        slope = trend_slope(values)
        latest = float(values[-1])
        direction = "rising" if slope > 1e-5 else "falling" if slope < -1e-5 else "flat"
        stress = signal_stress(signal, latest)
        ranked.append(
            (
                stress,
                {
                    "name": signal,
                    "signal": signal,
                    "latest": round(latest, 4),
                    "slope": round(slope, 6),
                    "direction": direction,
                    "reason": f"{signal} {direction} vs baseline",
                },
            )
        )
    ranked.sort(key=lambda row: row[0], reverse=True)
    return [row[1] for row in ranked[:limit]]


def feature_vector_for_model(signal_window: dict[str, list[dict[str, Any]]]) -> np.ndarray:
    """Ordered vector aligned with train.py FEATURE_ORDER."""
    flat = extract_window_features(signal_window)
    order = sorted(flat.keys())
    return np.array([flat.get(k, 0.0) for k in order], dtype=float), order
