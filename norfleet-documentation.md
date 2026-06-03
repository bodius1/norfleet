# Norfleet Documentation

Internal reference for product, architecture, and ML status. For quickstart and repo layout, see `README.md`.

## The Python ML Service — Current Status

### What it does technically

The Python ML service (`ml-service/`) now provides the trained predictive layer for Norfleet. The JavaScript statistical predictor still exists as a fallback, but the active ML path now returns calibrated failure predictions, differentiated failure modes, top contributing sensor signals, and live time to failure estimates.

The model inventory is confirmed:

| Model | Status | Notes |
|-------|--------|-------|
| General failure classifier | Ready | Trained from AI4I style industrial failure data with synthetic fallback support |
| Bearing classifier | Ready | Uses bearing vibration and temperature windows; current fallback can train from synthetic bearing windows when IMS data is missing |
| Battery model | Ready | Accuracy: 1.000, but currently synthetic and not production ready |
| Pick drift model | Ready | Accuracy: 0.898 on real data |
| Time to failure estimator | Ready | TTF MAE: 0.014h / 0.249h on synthetic training paths |

The dashboard now shows differentiated failure modes and live TTF estimates instead of blank placeholder values. Predictions can surface modes such as bearing wear, battery degradation, motor creep, and pick drift, with the signals that contributed most to the model output.

### Current performance notes

Pick drift is the strongest production signal right now because it is trained on real data and has measured accuracy of 0.898.

Battery prediction currently reports 1.000 accuracy, but this should be framed carefully because the training path is synthetic. It confirms the pipeline works, not that the battery model is production validated.

TTF currently reports MAE values of 0.014h / 0.249h, but these are synthetic results. Bearing TTF should still be treated as a placeholder until real FEMTO run to failure data is added.

FEMTO real data is still missing. The bearing TTF path can train and produce estimates, but it should not be described as production validated yet.

### Why it matters for the business

The Python ML service moves Norfleet from a rule based monitoring dashboard toward a predictive maintenance system that can explain what is likely to fail, which signals caused the alert, and roughly how much operating time remains.

This matters because warehouse operators do not just need another dashboard. They need alerts that technicians can trust and act on. Differentiated failure modes, calibrated probabilities, top signal explanations, and live TTF estimates make the output operationally useful instead of just visually interesting.

### Caveats to watch out for

Cold start is still the main constraint. Some models are trained with synthetic fallbacks because raw production telemetry is not always available. That is acceptable for an MVP and demo environment, but early customer conversations should be honest about what is real data, what is synthetic, and what still needs pilot validation.

The strongest current validation point is pick drift accuracy at 0.898 on real data. Battery and TTF metrics should be presented as pipeline readiness signals, not production reliability claims.

FEMTO real data remains the biggest missing piece for validating bearing time to failure. Until that data is added, bearing TTF should be framed as synthetic and directional.
