"""Shared paths for ml-service data and model artifacts."""

from pathlib import Path

ML_ROOT = Path(__file__).resolve().parent
DATA_DIR = ML_ROOT / "data"
MODEL_DIR = DATA_DIR  # artifact directory for trained weights
RAW_DIR = DATA_DIR / "raw"

FEMTO_ROOT = RAW_DIR / "bearing" / "femto"
BATTERY_NASA_2007 = RAW_DIR / "battery" / "nasa_2007"
BATTERY_NASA_RAND = RAW_DIR / "battery" / "nasa_randomized"
BATTERY_CHE2023 = RAW_DIR / "battery" / "che2023"
NIST_UR5_ROOT = RAW_DIR / "pick_drift" / "nist_ur5"

LSTM_SEQUENCES_PATH = DATA_DIR / "lstm_sequences.npz"
LSTM_TTF_PATH = DATA_DIR / "norfleet_lstm_ttf.pt"

CLASSIFIER_PATH = DATA_DIR / "norfleet_xgb_classifier.pkl"
CLASSIFIER_META_PATH = DATA_DIR / "norfleet_xgb_classifier.meta.json"
BEARING_CLASSIFIER_PATH = DATA_DIR / "norfleet_xgb_bearing.pkl"
BEARING_META_PATH = DATA_DIR / "norfleet_xgb_bearing.meta.json"
BATTERY_CLASSIFIER_PATH = DATA_DIR / "norfleet_xgb_battery.pkl"
BATTERY_META_PATH = DATA_DIR / "norfleet_xgb_battery.meta.json"
PICK_DRIFT_CLASSIFIER_PATH = DATA_DIR / "norfleet_xgb_pick_drift.pkl"
PICK_DRIFT_META_PATH = DATA_DIR / "norfleet_xgb_pick_drift.meta.json"

FEEDBACK_PATH = DATA_DIR / "feedback_training_data.jsonl"
RETRAIN_STATE_PATH = DATA_DIR / "retrain_state.json"
ORIGINAL_TRAINING_CACHE = DATA_DIR / "original_training_cache.npz"
