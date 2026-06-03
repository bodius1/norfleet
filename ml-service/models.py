"""Model wrappers: calibrated XGBoost classifier + LSTM TTF regressor."""

from __future__ import annotations

import json
import pickle
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
from sklearn.calibration import CalibratedClassifierCV
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBClassifier

from features import health_index_sequence_for_lstm, top_signals_from_window
from paths import (
    BEARING_CLASSIFIER_PATH,
    BEARING_META_PATH,
    BATTERY_CLASSIFIER_PATH,
    BATTERY_META_PATH,
    CLASSIFIER_META_PATH,
    CLASSIFIER_PATH,
    DATA_DIR,
    FEEDBACK_PATH,
    LSTM_TTF_PATH,
    MODEL_DIR,
    PICK_DRIFT_CLASSIFIER_PATH,
    PICK_DRIFT_META_PATH,
    RETRAIN_STATE_PATH,
)

FAILURE_MODES = (
    "bearing_wear",
    "battery_degradation",
    "motor_creep",
    "pick_drift",
    "healthy",
)

OUTCOME_TO_LABEL = {
    "confirmed_failure": "failure",
    "confirmed-failure": "failure",
    "false_alarm": "healthy",
    "false-alarm": "healthy",
    "fixed_early": "failure",
    "fixed-early": "failure",
}

class LstmTtfNet(nn.Module):
    """2-layer LSTM regressor for HI sequence -> TTF hours."""

    def __init__(self, hidden_size: int = 64, num_layers: int = 2, dropout: float = 0.2) -> None:
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=1,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Linear(hidden_size, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        out = self.dropout(out[:, -1, :])
        return self.fc(out).squeeze(-1)


class LstmTtfModel:
    """Sequence-based time-to-failure regression on Health Index windows."""

    def __init__(self, weights_path: Path = LSTM_TTF_PATH, window_length: int = 10) -> None:
        self.weights_path = weights_path
        self.window_length = window_length
        self.model = LstmTtfNet()
        self.is_trained = False
        self._load()

    def _load(self) -> None:
        if not self.weights_path.exists():
            return
        try:
            checkpoint = torch.load(self.weights_path, map_location="cpu", weights_only=False)
            state_dict = checkpoint.get("state_dict") if isinstance(checkpoint, dict) else checkpoint
            self.model.load_state_dict(state_dict)
            if isinstance(checkpoint, dict):
                self.window_length = int(checkpoint.get("window_length", self.window_length))
            self.model.eval()
            self.is_trained = True
        except Exception:
            self.is_trained = False

    def fit(self, sequences: np.ndarray, ttf_hours: np.ndarray) -> None:
        """Train LSTM on HI sequences [N, window_length, 1] and TTF targets."""
        if sequences.size == 0 or ttf_hours.size == 0:
            return
        x = torch.from_numpy(sequences.astype(np.float32))
        y = torch.from_numpy(ttf_hours.astype(np.float32))
        optimizer = torch.optim.Adam(self.model.parameters(), lr=1e-3)
        loss_fn = nn.MSELoss()
        self.model.train()
        for _ in range(40):
            optimizer.zero_grad()
            pred = self.model(x)
            loss = loss_fn(pred, y)
            loss.backward()
            optimizer.step()
        self.model.eval()
        self.is_trained = True
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        torch.save(
            {"state_dict": self.model.state_dict(), "window_length": self.window_length},
            self.weights_path,
        )

    def predict_ttf(self, hi_sequence: np.ndarray) -> float | None:
        if not self.is_trained or hi_sequence.size < self.window_length:
            return None
        seq = hi_sequence[-self.window_length :].astype(np.float32)
        x = torch.from_numpy(seq).reshape(1, self.window_length, 1)
        with torch.no_grad():
            pred = float(self.model(x).item())
        if not np.isfinite(pred) or pred <= 0:
            return None
        return pred


def _load_classifier_bundle(path: Path, meta_path: Path) -> tuple[CalibratedClassifierCV | None, list[str], list[str]]:
    if not path.exists():
        return None, [], []
    with path.open("rb") as fh:
        payload = pickle.load(fh)
    feature_order = payload.get("feature_order", [])
    class_names: list[str] = []
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        feature_order = meta.get("feature_order", feature_order)
        class_names = [str(c) for c in meta.get("classes", [])]
    classifier = payload.get("classifier")
    if not class_names and classifier is not None:
        class_names = [str(c) for c in classifier.classes_]
    return classifier, feature_order, class_names


def _signal_stress_rank(flat_features: dict[str, float], candidates: tuple[str, ...]) -> float:
    return max(flat_features.get(f"{s}__stress", 0.0) for s in candidates)


def _bearing_signals_dominant(flat_features: dict[str, float]) -> bool:
    bearing = _signal_stress_rank(flat_features, ("vibrationRms", "bearingTempC"))
    battery = _signal_stress_rank(flat_features, ("batteryCapacityPct", "batteryVoltage"))
    pick = _signal_stress_rank(flat_features, ("pickAccuracyPct", "pickActuatorDriftMm"))
    motor = flat_features.get("motorCurrentA__stress", 0.0)
    ranked = sorted(
        [
            ("bearing", bearing),
            ("battery", battery),
            ("pick", pick),
            ("motor", motor),
        ],
        key=lambda row: row[1],
        reverse=True,
    )
    return ranked[0][0] == "bearing" and bearing > 0.05


def _battery_signals_dominant(flat_features: dict[str, float]) -> bool:
    battery = _signal_stress_rank(flat_features, ("batteryCapacityPct", "batteryVoltage"))
    bearing = _signal_stress_rank(flat_features, ("vibrationRms", "bearingTempC"))
    pick = _signal_stress_rank(flat_features, ("pickAccuracyPct", "pickActuatorDriftMm"))
    ranked = sorted(
        [("battery", battery), ("bearing", bearing), ("pick", pick)],
        key=lambda row: row[1],
        reverse=True,
    )
    return ranked[0][0] == "battery" and battery > 0.05


def _pick_signals_dominant(flat_features: dict[str, float]) -> bool:
    pick = _signal_stress_rank(flat_features, ("pickAccuracyPct", "pickActuatorDriftMm"))
    battery = _signal_stress_rank(flat_features, ("batteryCapacityPct", "batteryVoltage"))
    bearing = _signal_stress_rank(flat_features, ("vibrationRms", "bearingTempC"))
    ranked = sorted(
        [("pick", pick), ("battery", battery), ("bearing", bearing)],
        key=lambda row: row[1],
        reverse=True,
    )
    return ranked[0][0] == "pick" and pick > 0.05


class NorfleetPredictor:
    def __init__(self) -> None:
        self.label_encoder = LabelEncoder()
        self.label_encoder.fit(list(FAILURE_MODES))
        self.classifier: CalibratedClassifierCV | None = None
        self.feature_order: list[str] = []
        self.bearing_classifier: CalibratedClassifierCV | None = None
        self.bearing_feature_order: list[str] = []
        self.battery_classifier: CalibratedClassifierCV | None = None
        self.battery_feature_order: list[str] = []
        self.pick_drift_classifier: CalibratedClassifierCV | None = None
        self.pick_drift_feature_order: list[str] = []
        self.class_names: list[str] = []
        self.bearing_class_names: list[str] = []
        self.battery_class_names: list[str] = []
        self.pick_drift_class_names: list[str] = []
        self.model_version = "heuristic-v0"
        self.lstm = LstmTtfModel()
        self._load()

    def _load(self) -> None:
        self.classifier, self.feature_order, self.class_names = _load_classifier_bundle(
            CLASSIFIER_PATH, CLASSIFIER_META_PATH
        )
        self.bearing_classifier, self.bearing_feature_order, self.bearing_class_names = (
            _load_classifier_bundle(BEARING_CLASSIFIER_PATH, BEARING_META_PATH)
        )
        self.battery_classifier, self.battery_feature_order, self.battery_class_names = (
            _load_classifier_bundle(BATTERY_CLASSIFIER_PATH, BATTERY_META_PATH)
        )
        self.pick_drift_classifier, self.pick_drift_feature_order, self.pick_drift_class_names = (
            _load_classifier_bundle(PICK_DRIFT_CLASSIFIER_PATH, PICK_DRIFT_META_PATH)
        )
        trained = [
            self.classifier is not None,
            self.bearing_classifier is not None,
            self.battery_classifier is not None,
            self.pick_drift_classifier is not None,
            self.lstm.is_trained,
        ]
        self.model_version = "heuristic-v0"
        if any(trained):
            self.model_version = "norfleet-ml-v1"
        if RETRAIN_STATE_PATH.exists():
            state = json.loads(RETRAIN_STATE_PATH.read_text(encoding="utf-8"))
            self.model_version = state.get("model_version", self.model_version)

    @property
    def is_ready(self) -> bool:
        return self.classifier is not None and bool(self.feature_order)

    @property
    def bearing_ready(self) -> bool:
        return self.bearing_classifier is not None and bool(self.bearing_feature_order)

    @property
    def battery_ready(self) -> bool:
        return self.battery_classifier is not None and bool(self.battery_feature_order)

    @property
    def pick_drift_ready(self) -> bool:
        return self.pick_drift_classifier is not None and bool(self.pick_drift_feature_order)

    def _active_classifier(
        self, flat_features: dict[str, float]
    ) -> tuple[CalibratedClassifierCV | None, list[str], list[str], str]:
        if _pick_signals_dominant(flat_features) and self.pick_drift_ready:
            return (
                self.pick_drift_classifier,
                self.pick_drift_feature_order,
                self.pick_drift_class_names,
                "xgboost-pick+calibrated",
            )
        if _battery_signals_dominant(flat_features) and self.battery_ready:
            return (
                self.battery_classifier,
                self.battery_feature_order,
                self.battery_class_names,
                "xgboost-battery+calibrated",
            )
        if _bearing_signals_dominant(flat_features) and self.bearing_ready:
            return (
                self.bearing_classifier,
                self.bearing_feature_order,
                self.bearing_class_names,
                "xgboost-bearing+calibrated",
            )
        if self.is_ready:
            return self.classifier, self.feature_order, self.class_names, "xgboost+calibrated"
        return None, sorted(flat_features.keys()), [], "heuristic"

    def build_vector(self, flat_features: dict[str, float], feature_order: list[str]) -> np.ndarray:
        if not feature_order:
            keys = sorted(flat_features.keys())
            return np.array([flat_features.get(k, 0.0) for k in keys], dtype=float)
        return np.array([flat_features.get(k, 0.0) for k in feature_order], dtype=float)

    def predict_ttf_hours(
        self,
        signal_window: dict[str, list[dict[str, Any]]],
    ) -> float | None:
        hi_seq = health_index_sequence_for_lstm(signal_window, min_length=self.lstm.window_length)
        if hi_seq.size == 0:
            return None
        return self.lstm.predict_ttf(hi_seq)

    def predict(
        self,
        flat_features: dict[str, float],
        signal_window: dict[str, list[dict[str, Any]]],
        health_index: float,
    ) -> dict[str, Any]:
        classifier, order, class_names, model_tag = self._active_classifier(flat_features)

        if classifier is not None and order and class_names:
            vector = self.build_vector(flat_features, order).reshape(1, -1)
            proba = classifier.predict_proba(vector)[0]
            best_idx = int(np.argmax(proba))
            failure_mode = str(class_names[best_idx])
            probability = float(proba[best_idx])
            confidence = float(
                max(proba) - np.partition(proba, -2)[-2] if proba.size > 1 else proba[0]
            )
        else:
            failure_mode, probability, confidence = self._heuristic_predict(flat_features, health_index)
            model_tag = "heuristic"

        ttf_hours = self.predict_ttf_hours(signal_window)

        top_signals = top_signals_from_window(signal_window)
        alert = failure_mode != "healthy" and probability >= 0.55 and health_index < 0.9

        return {
            "failure_mode": failure_mode if failure_mode != "healthy" else "bearing_wear",
            "probability": round(float(probability), 4),
            "confidence": round(float(max(0.15, min(0.95, confidence))), 4),
            "ttf_hours": round(float(ttf_hours), 2) if ttf_hours is not None else None,
            "health_index": round(float(health_index), 4),
            "top_signals": top_signals,
            "alert": bool(alert),
            "model": model_tag if model_tag != "heuristic" else self.model_version,
        }

    @staticmethod
    def _heuristic_predict(flat_features: dict[str, float], health_index: float) -> tuple[str, float, float]:
        scores = {
            "bearing_wear": flat_features.get("vibrationRms__stress", 0.0)
            + flat_features.get("bearingTempC__stress", 0.0),
            "battery_degradation": flat_features.get("batteryCapacityPct__stress", 0.0)
            + flat_features.get("batteryVoltage__stress", 0.0),
            "motor_creep": flat_features.get("motorCurrentA__stress", 0.0),
            "pick_drift": flat_features.get("pickActuatorDriftMm__stress", 0.0)
            + flat_features.get("pickAccuracyPct__stress", 0.0),
        }
        failure_mode = max(scores, key=scores.get)
        probability = float(min(0.99, max(0.08, scores[failure_mode] * 0.65 + (1.0 - health_index) * 0.35)))
        if health_index >= 0.9 and scores[failure_mode] < 0.15:
            return "healthy", 0.08, 0.35
        confidence = float(min(0.9, 0.35 + scores[failure_mode] * 0.4))
        return failure_mode, probability, confidence


def train_classifier(
    X: np.ndarray,
    y: np.ndarray,
    feature_order: list[str],
    classifier_path: Path = CLASSIFIER_PATH,
    meta_path: Path = CLASSIFIER_META_PATH,
) -> CalibratedClassifierCV:
    label_encoder = LabelEncoder()
    y_encoded = label_encoder.fit_transform(y)
    num_class = len(label_encoder.classes_)
    if num_class < 2:
        num_class = 2
    base = XGBClassifier(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.08,
        subsample=0.9,
        colsample_bytree=0.9,
        objective="multi:softprob",
        eval_metric="mlogloss",
        num_class=num_class,
        random_state=42,
    )
    cv_folds = 2 if len(y_encoded) < 50 else 3
    calibrated = CalibratedClassifierCV(base, method="sigmoid", cv=cv_folds)
    calibrated.fit(X, y_encoded)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    with classifier_path.open("wb") as fh:
        pickle.dump({"classifier": calibrated, "feature_order": feature_order}, fh)
    meta_path.write_text(
        json.dumps(
            {"feature_order": feature_order, "classes": [str(c) for c in label_encoder.classes_]},
            indent=2,
        ),
        encoding="utf-8",
    )
    return calibrated


def _load_retrain_state() -> dict[str, Any]:
    if not RETRAIN_STATE_PATH.exists():
        return {"last_retrain_line_count": 0, "model_version": "xgboost-v1"}
    return json.loads(RETRAIN_STATE_PATH.read_text(encoding="utf-8"))


def _save_retrain_state(state: dict[str, Any]) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    RETRAIN_STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _feedback_line_count() -> int:
    if not FEEDBACK_PATH.exists():
        return 0
    return sum(1 for _ in FEEDBACK_PATH.open("r", encoding="utf-8"))


def append_feedback_records(records: list[dict[str, Any]]) -> int:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    with FEEDBACK_PATH.open("a", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record) + "\n")
    return len(records)


def _label_from_feedback(record: dict[str, Any]) -> str:
    outcome = str(record.get("outcome", "")).lower().replace("-", "_")
    mapped = OUTCOME_TO_LABEL.get(outcome.replace("-", "_"), "")
    if mapped == "healthy":
        return "healthy"
    return str(record.get("failure_mode") or "bearing_wear")


def _load_feedback_matrix(
    feature_order: list[str],
) -> tuple[np.ndarray, np.ndarray]:
    if not FEEDBACK_PATH.exists():
        return np.empty((0, len(feature_order))), np.array([])

    rows: list[list[float]] = []
    labels: list[str] = []
    with FEEDBACK_PATH.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            features = record.get("features") or {}
            rows.append([float(features.get(k, 0.0)) for k in feature_order])
            labels.append(_label_from_feedback(record))
    if not rows:
        return np.empty((0, len(feature_order))), np.array([])
    return np.array(rows, dtype=float), np.array(labels)


def _load_original_training_matrix() -> tuple[np.ndarray, np.ndarray, list[str]] | None:
    if not CLASSIFIER_PATH.exists():
        return None
    bundle = pickle.load(CLASSIFIER_PATH.open("rb"))
    feature_order = bundle.get("feature_order", [])
    from paths import ORIGINAL_TRAINING_CACHE

    training_cache = ORIGINAL_TRAINING_CACHE
    if training_cache.exists():
        data = np.load(training_cache, allow_pickle=True)
        return data["X"], data["y"], list(data["feature_order"])
    return None


def save_original_training_cache(X: np.ndarray, y: np.ndarray, feature_order: list[str]) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    from paths import ORIGINAL_TRAINING_CACHE

    np.savez(ORIGINAL_TRAINING_CACHE, X=X, y=y, feature_order=np.array(feature_order))


def maybe_incremental_retrain() -> dict[str, Any]:
    state = _load_retrain_state()
    total_lines = _feedback_line_count()
    new_samples = total_lines - int(state.get("last_retrain_line_count", 0))

    if new_samples < 50:
        return {
            "retrained": False,
            "new_samples": new_samples,
            "model_version": state.get("model_version", "xgboost-v1"),
        }

    if not CLASSIFIER_PATH.exists():
        return {
            "retrained": False,
            "new_samples": new_samples,
            "model_version": state.get("model_version", "xgboost-v1"),
        }

    bundle = pickle.load(CLASSIFIER_PATH.open("rb"))
    feature_order: list[str] = bundle.get("feature_order", [])
    original = _load_original_training_matrix()
    parts_X: list[np.ndarray] = []
    parts_y: list[np.ndarray] = []

    if original is not None:
        X0, y0, order0 = original
        if list(order0) == feature_order:
            parts_X.append(X0)
            parts_y.append(y0)

    X_fb, y_fb = _load_feedback_matrix(feature_order)
    if X_fb.size:
        parts_X.append(X_fb)
        parts_y.append(y_fb)

    if not parts_X:
        return {
            "retrained": False,
            "new_samples": new_samples,
            "model_version": state.get("model_version", "xgboost-v1"),
        }

    X = np.vstack(parts_X)
    y = np.concatenate(parts_y)
    train_classifier(X, y, feature_order)

    version = f"xgboost-v{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    state["last_retrain_line_count"] = total_lines
    state["model_version"] = version
    _save_retrain_state(state)

    return {"retrained": True, "new_samples": new_samples, "model_version": version}
