# Norfleet

Predictive maintenance MVP for warehouse robot fleets — telemetry → health index → explainable failure predictions → technician dispatch → feedback-driven calibration.

## Quickstart

```bash
npm install
npm run seed:demo    # scripted demo: R-002 mid bearing degradation
npm start            # http://localhost:5050
npm test
npm run validate     # backtest report + exit code on quality gates
```

Optional: copy `.env.example` to `.env` for LLM keys (technician narrative only). Detection and prediction are 100% local.

## Demo script (~3 minutes)

1. **Seed** — `npm run seed:demo` (clears `data/`, loads fleet, R-002 ~58% through bearing wear).
2. **Start** — `npm start`, open `http://localhost:5050`.
3. **Fleet Health** — open **Fleet Health** tab. See R-002 health index declining; click **Fast-forward sim (60×)** twice if needed until a prediction appears (failure mode, TTF hours, top signals).
4. **Technician Report** — **Generate dispatch report**. Review prediction-linked actions (mode, TTF, confidence). Mark reviewed → **Apply**.
5. **Feedback** — click **False alarm** or **Confirmed** on the action. Note calibration update in Fleet Health footer.
6. **Re-run validate** (optional) — `npm run validate` after several false-alarm feedbacks in a live session shows tighter thresholds.

## Architecture seams

| Layer | Module | Role |
|-------|--------|------|
| Telemetry | `telemetry/simulator.js`, `adapters/robotTelemetry.js`, `adapters/vendorTelemetry.js` | Simulated or vendor adapter → canonical schema |
| Store | `store/timeSeriesStore.js`, `store/persistence.js` | SQLite (JSON fallback) time-series + fleet/predictions/feedback |
| Features | `predictor/features.js` | Health index, slopes, failure-mode hints |
| Predict | `predictor/failurePredictor.js` | Explainable TTF + probability (not reactive detection) |
| Detect | `anomalyDetector.js` | Reactive KPI anomaly layer (separate) |
| Feedback | `predictor/calibration.js` | Per-mode threshold tuning from technician outcomes |
| Platform | `services/norfleetPlatform.js` | Wires adapter → store → predictor → API |

Switch telemetry source: set `NORFLEET_TELEMETRY_ADAPTER=vendor` or Settings → data → `telemetryAdapter: vendor`. Implement `adapters/vendorTelemetry.js` TODO(integration) touchpoints — no predictor rewrite.

## Real vs simulated

| Component | Status |
|-----------|--------|
| Telemetry stream | **Simulated** (realistic failure precursors; swappable via adapter) |
| Health index & prediction | **Real** (transparent math, local, explainable) |
| SQLite / JSON persistence | **Real** (survives restart) |
| Feedback calibration | **Real** (persisted, measurable on `npm run validate`) |
| KPI anomaly detection | **Real** (deterministic rules) |
| Technician repair narrative | **Optional LLM** via `aiProvider.js` (cached; dispatch is deterministic) |
| Validation backtest | **Real** (known failure times from simulator harness only) |

## Key API endpoints

- `GET /api/predictions` — fleet predictions ranked by TTF
- `GET /api/robots/:id/health` — HI + prediction + contributing signals
- `POST /api/sim/replay` — `{ "speed": 60 }` fast-forward simulation
- `POST /api/ai/generate-technician-report` — prediction-driven dispatch (+ optional LLM narrative)
- `POST /api/ai/feedback` — `{ actionId, outcome, predictionId?, failureMode? }`
- `GET/PUT /api/agents/runtime` — server is source of truth for agent builder config

## Quality gates (`npm run validate`)

- Recall ≥ 80%
- False-alarm rate ≤ 20%
- Median lead time ≥ 8 hours before simulated failure

## Security

Do not commit API keys. Use Settings or `.env` locally. Optional `NORFLEET_ADMIN_TOKEN` for admin routes.
