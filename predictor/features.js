/**
 * Feature extraction from trailing telemetry windows.
 * Computes per-signal stats and composite Health Index (HI in [0,1], 1=healthy).
 */
const { BASELINES, FAILURE_LIMITS } = require("../telemetry/simulator");

const HI_WEIGHTS = {
  vibrationRms: -0.22,
  motorCurrentA: -0.15,
  bearingTempC: -0.18,
  batteryCapacityPct: 0.2,
  batteryVoltage: 0.12,
  pickAccuracyPct: 0.18,
  pickActuatorDriftMm: -0.2,
  cycleTimeMs: -0.08,
  trafficDelayMs: -0.06,
  travelTimeMs: -0.08,
  dockAlignmentMm: -0.1
};

function linearSlope(points) {
  if (!points || points.length < 3) return 0;
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  points.forEach((p, i) => {
    sumX += i;
    sumY += p.value;
    sumXY += i * p.value;
    sumXX += i * i;
  });
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function rollingStats(points) {
  if (!points.length) return { mean: 0, variance: 0 };
  const vals = points.map((p) => p.value);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return { mean, variance: Math.sqrt(variance) };
}

function normalizeSignal(signal, value) {
  const base = BASELINES[signal] ?? 1;
  if (signal === "batteryCapacityPct" || signal === "pickAccuracyPct") {
    return Math.max(0, Math.min(1, value / 100));
  }
  if (signal === "batteryVoltage") {
    return Math.max(0, Math.min(1, (value - 40) / 12));
  }
  const ratio = value / base;
  if (HI_WEIGHTS[signal] < 0) return Math.max(0, Math.min(1, 2 - ratio));
  return Math.max(0, Math.min(1, ratio / 2));
}

function buildHealthIndexSeries(signalWindow) {
  const keys = Object.keys(signalWindow);
  if (!keys.length) return [];
  const len = Math.min(...keys.map((k) => signalWindow[k].length));
  const series = [];
  for (let i = 0; i < len; i += 1) {
    let hi = 0;
    let wSum = 0;
    keys.forEach((signal) => {
      const pt = signalWindow[signal][i];
      if (!pt) return;
      const w = Math.abs(HI_WEIGHTS[signal] || 0.05);
      const n = normalizeSignal(signal, pt.value);
      wSum += w;
      if (HI_WEIGHTS[signal] < 0) hi += (1 - (1 - n)) * w;
      else hi += n * w;
    });
    series.push({
      ts: signalWindow[keys[0]][i].ts,
      value: wSum ? Math.max(0.05, Math.min(1, hi / wSum)) : 0.5
    });
  }
  return series;
}

function extractFeatures(robotId, signalWindow, nowTs) {
  const perSignal = {};
  Object.entries(signalWindow).forEach(([signal, points]) => {
    if (!points.length) return;
    const stats = rollingStats(points);
    perSignal[signal] = {
      latest: points[points.length - 1].value,
      slope: linearSlope(points),
      mean: stats.mean,
      stdDev: stats.variance,
      normalized: normalizeSignal(signal, points[points.length - 1].value)
    };
  });

  const hiSeries = buildHealthIndexSeries(signalWindow);
  const healthIndex = hiSeries.length ? hiSeries[hiSeries.length - 1].value : 1;

  return {
    robotId,
    ts: nowTs,
    healthIndex,
    hiSeries,
    perSignal,
    signals: Object.keys(perSignal)
  };
}

function inferFailureMode(features) {
  const ps = features.perSignal;
  let best = "bearing_wear";
  let bestScore = -Infinity;
  Object.keys(FAILURE_LIMITS).forEach((mode) => {
    const sig = FAILURE_LIMITS[mode].signal;
    if (!ps[sig]) return;
    const slope = ps[sig].slope;
    const score = FAILURE_LIMITS[mode].direction === "below" ? -slope : slope;
    if (score > bestScore) {
      bestScore = score;
      best = mode;
    }
  });
  return best;
}

module.exports = {
  extractFeatures,
  buildHealthIndexSeries,
  linearSlope,
  rollingStats,
  normalizeSignal,
  inferFailureMode,
  HI_WEIGHTS,
  FAILURE_THRESHOLD: 0.35
};
