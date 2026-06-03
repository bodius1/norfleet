"""Train and evaluate LstmTtfNet on combined HI sequence datasets."""

from __future__ import annotations

import numpy as np
from sklearn.model_selection import train_test_split

from dataset_loaders import (
    build_lstm_samples_from_runs,
    load_femto_runs,
    load_lstm_sequences_npz,
)
from models import LstmTtfModel
from paths import LSTM_SEQUENCES_PATH, LSTM_TTF_PATH


def collect_lstm_training_data(window_length: int = 10) -> tuple[np.ndarray, np.ndarray]:
    runs = load_femto_runs()
    seqs, targets = build_lstm_samples_from_runs(runs, window_length=window_length)
    extra_seqs, extra_targets = load_lstm_sequences_npz(LSTM_SEQUENCES_PATH)
    if extra_seqs.size:
        seqs = np.concatenate([seqs, extra_seqs], axis=0) if seqs.size else extra_seqs
        targets = np.concatenate([targets, extra_targets], axis=0) if targets.size else extra_targets
    return seqs, targets


def train_lstm_ttf(window_length: int = 10) -> dict[str, float | int]:
    seqs, targets = collect_lstm_training_data(window_length=window_length)
    if seqs.size == 0:
        raise ValueError("No LSTM training sequences available.")

    X_train, X_test, y_train, y_test = train_test_split(
        seqs, targets, test_size=0.2, random_state=42
    )
    model = LstmTtfModel(weights_path=LSTM_TTF_PATH, window_length=window_length)
    model.fit(X_train, y_train)

    preds = []
    model.model.eval()
    import torch

    with torch.no_grad():
        for i in range(X_test.shape[0]):
            x = torch.from_numpy(X_test[i : i + 1].astype(np.float32))
            preds.append(float(model.model(x).item()))
    mae = float(np.mean(np.abs(np.array(preds) - y_test)))
    return {
        "samples": int(seqs.shape[0]),
        "val_mae_hours": mae,
        "train_samples": int(X_train.shape[0]),
        "test_samples": int(X_test.shape[0]),
    }
