/**
 * Forward-looking failure predictor (NOT reactive detection — see anomalyDetector.js).
 * Whiteboard method: HI trend extrapolation + crossing probability.
 */
const { linearSlope, rollingStats, FAILURE_THRESHOLD } = require("./features");

function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

const HI_WEIGHTS_ABS = {
  vibrationRms: 0.22,
  motorCurrentA: 0.15,
  bearingTempC: 0.18,
  batteryCapacityPct: 0.2,
  batteryVoltage: 0.12,
  pickAccuracyPct: 0.18,
  pickActuatorDriftMm: 0.2
};

function predict(features, calibration = {}) {
  const { robotId, healthIndex, hiSeries, perSignal } = features;
  const failureMode = features.failureMode || "bearing_wear";
  const cal = calibration[failureMode] || { alertThreshold: FAILURE_THRESHOLD, minProbability: 0.55 };

  const threshold = cal.alertThreshold ?? FAILURE_THRESHOLD;
  const horizonHours = cal.horizonHours ?? 48;

  if (!hiSeries || hiSeries.length < 5) {
    return {
      robotId,
      failureMode,
      failureProbability: 0.05,
      estimatedTimeToFailureHours: null,
      confidence: 0.2,
      healthIndex,
      contributingSignals: [],
      alert: false
    };
  }

  const slope = linearSlope(hiSeries);
  const stats = rollingStats(hiSeries);
  const residualStd = Math.max(0.02, stats.variance);

  let estimatedTimeToFailureHours = null;
  if (slope < -1e-6) {
    const stepsToThreshold = (healthIndex - threshold) / Math.abs(slope);
    const msPerStep =
      hiSeries.length > 1
        ? (hiSeries[hiSeries.length - 1].ts - hiSeries[0].ts) / (hiSeries.length - 1)
        : 60000;
    estimatedTimeToFailureHours = Math.max(0, (stepsToThreshold * msPerStep) / 3600000);
  } else if (healthIndex <= threshold) {
    estimatedTimeToFailureHours = 0;
  }

  const stepsInHorizon = (horizonHours * 3600000) / Math.max(60000, (hiSeries.at(-1).ts - hiSeries[0].ts) / hiSeries.length);
  const projectedDrop = slope * stepsInHorizon;
  const failureProbability = Math.max(
    0.01,
    Math.min(0.99, 1 - normalCdf((threshold - (healthIndex + projectedDrop)) / residualStd))
  );

  const fitResiduals = hiSeries.map((p, i) => {
    const predicted = healthIndex + slope * (i - hiSeries.length + 1);
    return p.value - predicted;
  });
  const ssRes = fitResiduals.reduce((a, r) => a + r * r, 0);
  const meanY = hiSeries.reduce((a, p) => a + p.value, 0) / hiSeries.length;
  const ssTot = hiSeries.reduce((a, p) => a + (p.value - meanY) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const confidence = Math.max(0.15, Math.min(0.95, 0.35 + r2 * 0.55));

  const contributingSignals = Object.entries(perSignal)
    .map(([signal, data]) => ({
      signal,
      weight: Number((Math.abs(data.slope) * (HI_WEIGHTS_ABS[signal] || 0.1)).toFixed(4)),
      slope: Number(data.slope.toFixed(6)),
      latest: Number(data.latest.toFixed(4))
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);

  const alertByProb = failureProbability >= (cal.minProbability ?? 0.42);
  const alertByHi =
    healthIndex <= threshold && slope < -0.001 && estimatedTimeToFailureHours !== null;
  const alert =
    (alertByProb || alertByHi) &&
    estimatedTimeToFailureHours !== null &&
    estimatedTimeToFailureHours <= horizonHours;

  return {
    robotId,
    failureMode,
    failureProbability: Number(failureProbability.toFixed(4)),
    estimatedTimeToFailureHours:
      estimatedTimeToFailureHours !== null ? Number(estimatedTimeToFailureHours.toFixed(2)) : null,
    confidence: Number(confidence.toFixed(4)),
    healthIndex: Number(healthIndex.toFixed(4)),
    contributingSignals,
    alert,
    slope: Number(slope.toFixed(6))
  };
}

module.exports = { predict, normalCdf, FAILURE_THRESHOLD };
