/**
 * Client for the Norfleet Python ML service (FastAPI POST /predict).
 * Falls back to null so callers can use the JS statistical predictor.
 */
const DEFAULT_ML_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
const DEFAULT_TIMEOUT_MS = Number(process.env.ML_SERVICE_TIMEOUT_MS) || 1500;

function mapTopSignals(topSignals) {
  return (topSignals || []).map((s) => ({
    signal: s.signal || s.name,
    name: s.name || s.signal,
    latest: s.latest,
    slope: s.slope ?? 0,
    delta: s.delta ?? 0,
    direction: s.direction || "flat",
    reason: s.reason || `${s.name || s.signal} monitored`,
    weight: s.weight ?? s.contribution ?? 0,
    contribution: s.contribution ?? s.weight ?? 0
  }));
}

function mapMlResponseToPrediction(ml, robotId, failureModeHint) {
  if (!ml || !ml.failure_mode) return null;
  const failureMode = ml.failure_mode === "healthy" ? failureModeHint || "bearing_wear" : ml.failure_mode;
  const probability = Number(ml.probability);
  const confidence = Number(ml.confidence);
  const healthIndex = Number(ml.health_index);
  const ttf =
    ml.ttf_hours === null || ml.ttf_hours === undefined ? null : Number(ml.ttf_hours);
  const contributingSignals = mapTopSignals(ml.top_signals);

  return {
    robotId,
    failureMode,
    failureProbability: Number.isFinite(probability) ? probability : 0.08,
    estimatedTimeToFailureHours: Number.isFinite(ttf) ? ttf : null,
    confidence: Number.isFinite(confidence) ? confidence : 0.35,
    healthIndex: Number.isFinite(healthIndex) ? Math.max(0, Math.min(1, healthIndex)) : 1,
    contributingSignals,
    alert: Boolean(ml.alert),
    insufficientData: false,
    modeEvidence: contributingSignals.length > 0,
    reason: ml.model ? `ml-service (${ml.model})` : "ml-service",
    slope: contributingSignals[0]?.slope ?? 0,
    healthDrop: 0
  };
}

function buildPredictPayload(robotId, computed, robotModel) {
  const { features, nowTs } = computed;
  const signalWindow = features.signalWindow || {};
  const payload = {
    robot_id: robotId,
    model: robotModel || null,
    now_ts: nowTs,
    window_ms: 3600000,
    signal_window: {}
  };
  Object.entries(signalWindow).forEach(([signal, points]) => {
    payload.signal_window[signal] = (points || []).map((p) => ({
      ts: p.ts,
      value: p.value
    }));
  });
  return payload;
}

function buildFlatFeaturesFromComputed(computed) {
  const perSignal = computed?.features?.perSignal || {};
  const flat = {};
  Object.entries(perSignal).forEach(([signal, data]) => {
    flat[`${signal}__latest`] = data.latest ?? 0;
    flat[`${signal}__rms`] = data.mean ?? data.latest ?? 0;
    flat[`${signal}__kurtosis`] = 0;
    flat[`${signal}__slope`] = data.slope ?? 0;
    flat[`${signal}__stress`] = data.stress ?? 0;
    if (signal === "vibrationRms" || signal === "bearingTempC") {
      flat[`${signal}__dominant_freq`] = 0;
    }
    if (signal === "batteryCapacityPct" || signal === "batteryVoltage") {
      flat[`${signal}__degradation_rate`] = data.slope != null ? -data.slope : 0;
    }
  });
  return flat;
}

function mapFeedbackOutcomeForMl(outcome) {
  const normalized = String(outcome || "").toLowerCase();
  if (normalized === "false-alarm" || normalized === "false_alarm") return "false_alarm";
  if (normalized === "fixed-early" || normalized === "fixed_early") return "fixed_early";
  return "confirmed_failure";
}

async function submitFeedbackForRetrain(platform, payload, options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_ML_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!platform?.computeRobotFeatures) return null;

  let robotId = payload.robotId || null;
  if (!robotId && payload.predictionId) {
    const fromRepo = platform.repo?.getPredictions?.().find((p) => p.id === payload.predictionId);
    robotId = fromRepo?.robotId || null;
    if (!robotId && platform.getAllLatestPredictions) {
      const live = platform.getAllLatestPredictions().find((p) => p.id === payload.predictionId);
      robotId = live?.robotId || null;
    }
  }
  if (!robotId) return null;

  const computed = platform.computeRobotFeatures(robotId);
  if (!computed?.features) return null;

  const features = buildFlatFeaturesFromComputed(computed);
  const failureMode = payload.failureMode || computed.features.failureMode || "bearing_wear";
  const outcome = mapFeedbackOutcomeForMl(payload.outcome);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/retrain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        records: [{ robot_id: robotId, features, failure_mode: failureMode, outcome }]
      }),
      signal: controller.signal
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function predictWithMlService(computed, options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_ML_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!computed?.features) return null;

  const { robot, features } = computed;
  const payload = buildPredictPayload(robot.id, computed, robot.model);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!res.ok) return null;
    const ml = await res.json();
    return mapMlResponseToPrediction(ml, robot.id, features.failureMode);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_ML_URL,
  predictWithMlService,
  submitFeedbackForRetrain,
  mapMlResponseToPrediction,
  buildPredictPayload,
  buildFlatFeaturesFromComputed
};
