"""FastAPI ML inference service for Norfleet robot failure prediction."""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field

from features import estimate_health_index, extract_window_features, top_signals_from_window
from models import (
    NorfleetPredictor,
    append_feedback_records,
    maybe_incremental_retrain,
)

app = FastAPI(title="Norfleet ML Service", version="0.2.0")
predictor = NorfleetPredictor()


def _build_health_payload() -> dict[str, Any]:
    """In-memory readiness only — no disk reload or inference on /health."""
    return {
        "ok": True,
        "classifier_ready": predictor.classifier is not None and bool(predictor.feature_order),
        "bearing_classifier_ready": predictor.bearing_classifier is not None
        and bool(predictor.bearing_feature_order),
        "battery_classifier_ready": predictor.battery_classifier is not None
        and bool(predictor.battery_feature_order),
        "pick_drift_classifier_ready": predictor.pick_drift_classifier is not None
        and bool(predictor.pick_drift_feature_order),
        "lstm_ttf_ready": bool(predictor.lstm.is_trained),
        "model_version": predictor.model_version,
    }


_health_cache: dict[str, Any] = _build_health_payload()


class SignalPoint(BaseModel):
    ts: int | float
    value: float


class PredictRequest(BaseModel):
    """Matches Norfleet telemetry ingest + time-series window shape."""

    robot_id: str = Field(..., description="Robot id, e.g. R-002")
    model: str | None = Field(None, description="Robot model name (LocusBot, Stretch, …)")
    now_ts: int | float | None = None
    window_ms: int = 3_600_000
    signals: dict[str, float] | None = Field(
        None, description="Latest point from POST /api/telemetry/ingest"
    )
    signal_window: dict[str, list[SignalPoint]] = Field(
        default_factory=dict,
        description="Sliding window map: signal -> [{ts, value}, …]",
    )


class TopSignal(BaseModel):
    name: str
    signal: str | None = None
    latest: float
    slope: float | None = None
    direction: str | None = None
    reason: str | None = None


class PredictResponse(BaseModel):
    failure_mode: str
    probability: float
    confidence: float
    ttf_hours: float | None
    health_index: float
    top_signals: list[dict[str, Any]]
    alert: bool
    model: str


class FeedbackRecord(BaseModel):
    robot_id: str
    features: dict[str, float]
    failure_mode: str
    outcome: Literal[
        "confirmed_failure",
        "false_alarm",
        "fixed_early",
        "confirmed-failure",
        "false-alarm",
        "fixed-early",
    ]


class RetrainRequest(BaseModel):
    records: list[FeedbackRecord]


class RetrainResponse(BaseModel):
    retrained: bool
    new_samples: int
    model_version: str


def _merge_latest_point(body: PredictRequest) -> dict[str, list[dict[str, Any]]]:
    window: dict[str, list[dict[str, Any]]] = {
        signal: [p.model_dump() for p in points] for signal, points in body.signal_window.items()
    }
    if body.signals and body.now_ts is not None:
        ts = body.now_ts
        for signal, value in body.signals.items():
            points = window.setdefault(signal, [])
            if not points or points[-1].get("ts") != ts:
                points.append({"ts": ts, "value": float(value)})
    return window


def _xgb_top_signals(
    predictor: NorfleetPredictor,
    flat_features: dict[str, float],
    signal_window: dict[str, list[dict[str, Any]]],
    limit: int = 4,
) -> list[dict[str, Any]]:
    classifier, feature_order, _, _ = predictor._active_classifier(flat_features)
    if classifier is None or not feature_order:
        return []

    try:
        calibrated = classifier.calibrated_classifiers_[0]
        base_est = calibrated.estimator
        importances = np.asarray(base_est.feature_importances_, dtype=float)
    except (AttributeError, IndexError, TypeError):
        return []

    if importances.size != len(feature_order):
        return []

    by_signal: dict[str, float] = {}
    for fname, imp in zip(feature_order, importances):
        signal = fname.split("__", 1)[0] if "__" in fname else fname
        by_signal[signal] = by_signal.get(signal, 0.0) + float(imp)

    ranked = sorted(by_signal.items(), key=lambda row: row[1], reverse=True)[:limit]
    if not ranked:
        return []

    weight_sum = float(sum(imp for _, imp in ranked)) or 1.0
    window_by_name = {s["name"]: s for s in top_signals_from_window(signal_window, limit=limit)}

    top_signals: list[dict[str, Any]] = []
    for name, imp in ranked:
        entry: dict[str, Any] = {
            "name": name,
            "signal": name,
            "weight": round(float(imp) / weight_sum, 4),
        }
        if name in window_by_name:
            w = window_by_name[name]
            entry["latest"] = w.get("latest")
            entry["slope"] = w.get("slope")
            entry["direction"] = w.get("direction")
            entry["reason"] = w.get("reason")
        top_signals.append(entry)
    return top_signals


@app.get("/health")
def health() -> dict[str, Any]:
    return _health_cache


@app.post("/predict", response_model=PredictResponse)
def predict(body: PredictRequest) -> PredictResponse:
    signal_window = _merge_latest_point(body)
    flat = extract_window_features(signal_window)
    health_index = estimate_health_index(signal_window)
    result = predictor.predict(flat, signal_window, health_index)
    xgb_top = _xgb_top_signals(predictor, flat, signal_window)
    if xgb_top:
        result["top_signals"] = xgb_top
    return PredictResponse(**result)


@app.post("/retrain", response_model=RetrainResponse)
def retrain(body: RetrainRequest) -> RetrainResponse:
    payload = [
        {
            "robot_id": record.robot_id,
            "features": record.features,
            "failure_mode": record.failure_mode,
            "outcome": record.outcome,
        }
        for record in body.records
    ]
    append_feedback_records(payload)
    result = maybe_incremental_retrain()
    if result["retrained"]:
        predictor._load()
        global _health_cache
        _health_cache = _build_health_payload()
    return RetrainResponse(**result)

