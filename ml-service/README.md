# Norfleet ML Service

FastAPI inference service for robot failure prediction.

## Run

```bash
cd ml-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Train classifiers

### AI4I 2020 (default)

```bash
kaggle datasets download -d stephenlupo/predictive-maintenance-dataset -p data/raw --unzip
python train.py --dataset ai4i --csv data/raw/ai4i2020.csv
```

Saves `data/norfleet_xgb_classifier.pkl` and caches the original matrix for incremental retraining.

### NASA IMS bearing

Place IMS bearing CSV files under `data/raw/bearing/`, then:

```bash
python train.py --dataset nasa_bearing --bearing-dir data/raw/bearing
```

Saves `data/norfleet_xgb_bearing.pkl`. Used when `vibrationRms` or `bearingTempC` are the dominant stressed signals.

### FEMTO bearing (LSTM TTF)

Place FEMTO CSVs under `data/raw/bearing/femto/Training_set` and `Test_set`, then:

```bash
python train.py --dataset femto
```

Builds HI sequences from 5-second snapshot RMS, combines with `data/lstm_sequences.npz` if present, and saves `data/norfleet_lstm_ttf.pt`. Reports validation MAE in hours.

### Battery combined (NASA 2007 + randomized + CHE2023)

```bash
python train.py --dataset battery_combined
```

Saves `data/norfleet_xgb_battery.pkl`. End-of-life labeled at 70% of initial capacity. Routed when `batteryCapacityPct` or `batteryVoltage` dominate.

### NIST UR5 pick drift

Place 18 CSV files and header XLS/XLSX under `data/raw/pick_drift/nist_ur5/`, then:

```bash
python train.py --dataset nist_ur5
```

Saves `data/norfleet_xgb_pick_drift.pkl`. TCP pose deviation magnitude labels files by median threshold; cold-start runs are flagged, not a separate failure mode.

### LSTM TTF (motor creep + sequences)

```bash
python generate_lstm_training_data.py --mode motor_creep
python train.py --dataset lstm_sequences
```

### Train everything

```bash
python run_all_training.py
```

## API

### `POST /predict`

Norfleet telemetry window:

```json
{
  "robot_id": "R-002",
  "now_ts": 1710000000000,
  "signal_window": {
    "vibrationRms": [{"ts": 1710000000000, "value": 0.42}],
    "bearingTempC": [{"ts": 1710000000000, "value": 44.1}]
  }
}
```

Returns `failure_mode`, `probability`, `confidence`, `ttf_hours` (LSTM or null), `health_index`, `top_signals`.

### `POST /retrain`

Technician feedback for incremental XGBoost retraining on the general classifier.

### `GET /health`

Reports `classifier_ready`, `bearing_classifier_ready`, `battery_classifier_ready`, `pick_drift_classifier_ready`, `lstm_ttf_ready`, and `model_version`.

## Node integration

`ML_SERVICE_URL` (default `http://localhost:8000`). Node falls back to `predictor/failurePredictor.js` when the service is unavailable.
