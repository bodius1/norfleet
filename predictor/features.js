/**
 * Feature extraction from trailing telemetry windows.
 * Computes per-signal stats and composite Health Index (HI in [0,1], 1=healthy).
 */
const { BASELINES, FAILURE_LIMITS } = require("../telemetry/simulator");

const HI_WEIGHTS = {
  vibrationRms: 0.22,
  motorCurrentA: 0.32,
  bearingTempC: 0.18,
  batteryCapacityPct: 0.2,
  batteryVoltage: 0.12,
  pickAccuracyPct: 0.18,
  pickActuatorDriftMm: 0.2,
  cycleTimeMs: 0.12,
  trafficDelayMs: 0.06,
  travelTimeMs: 0.08,
  dockAlignmentMm: 0.1
};

/** Mode-specific HI weights — amplify primary degradation signals per failure mode. */
const MODE_HI_WEIGHTS = {
  bearing_wear: { vibrationRms: 0.38, bearingTempC: 0.34, motorCurrentA: 0.12 },
  battery_degradation: { batteryCapacityPct: 0.42, batteryVoltage: 0.28, cycleTimeMs: 0.18, trafficDelayMs: 0.12 },
  motor_creep: { motorCurrentA: 0.94, cycleTimeMs: 0.04, bearingTempC: 0.02 },
  pick_drift: { pickActuatorDriftMm: 0.4, pickAccuracyPct: 0.32, cycleTimeMs: 0.22 }
};

const MODE_HI_SIGNALS = {
  bearing_wear: ["vibrationRms", "bearingTempC", "motorCurrentA"],
  battery_degradation: ["batteryCapacityPct", "batteryVoltage", "cycleTimeMs", "trafficDelayMs"],
  motor_creep: ["motorCurrentA", "cycleTimeMs", "bearingTempC"],
  pick_drift: ["pickActuatorDriftMm", "pickAccuracyPct", "cycleTimeMs"]
};

const MIN_HI_POINTS = 5;

const HIGHER_IS_WORSE = new Set([
  "vibrationRms",
  "motorCurrentA",
  "bearingTempC",
  "cycleTimeMs",
  "trafficDelayMs",
  "travelTimeMs",
  "dockAlignmentMm",
  "pickActuatorDriftMm"
]);

const LOWER_IS_WORSE = new Set(["batteryVoltage", "batteryCapacityPct", "pickAccuracyPct"]);

function clampHi(value) {
  return Math.max(0, Math.min(1, Number(value)));
}

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

/** Stress in [0,1]: 0 = at baseline, 1 = severe degradation for this signal. */
function signalStress(signal, value) {
  const base = BASELINES[signal] ?? 1;
  if (signal === "batteryCapacityPct") {
    const limit = FAILURE_LIMITS.battery_degradation?.limit ?? 55;
    return clampHi((base - value) / Math.max(1, base - limit));
  }
  if (signal === "pickAccuracyPct") {
    return clampHi((base - value) / Math.max(1, base - 90));
  }
  if (signal === "batteryVoltage") {
    return clampHi((base - value) / Math.max(0.5, base - 40));
  }
  if (signal === "motorCurrentA") {
    const limit = FAILURE_LIMITS.motor_creep?.limit ?? base + 5;
    return clampHi((value - base) / Math.max(0.35, limit - base));
  }
  if (signal === "cycleTimeMs") {
    return clampHi((value - base) / Math.max(120, base * 0.12));
  }
  const ratio = value / base;
  if (HIGHER_IS_WORSE.has(signal)) {
    const limitDef = Object.values(FAILURE_LIMITS).find((l) => l.signal === signal);
    const span = limitDef ? Math.max(0.01, limitDef.limit - base) : base * 0.5;
    return clampHi((value - base) / span);
  }
  if (LOWER_IS_WORSE.has(signal)) {
    return clampHi((base - value) / Math.max(0.01, base * 0.5));
  }
  return clampHi((ratio - 1) / 1.5);
}

/** Mode-aware stress for mode-specific health index (does not affect composite HI). */
function signalStressForMode(signal, value, failureMode) {
  const base = BASELINES[signal] ?? 1;
  if (failureMode === "motor_creep") {
    if (signal === "motorCurrentA") {
      const limit = FAILURE_LIMITS.motor_creep.limit;
      return clampHi((value - base) / Math.max(0.5, limit - base));
    }
    if (signal === "cycleTimeMs") {
      return clampHi((value - base) / Math.max(100, base * 0.1));
    }
    if (signal === "bearingTempC") {
      return clampHi((value - base) / Math.max(1, base * 0.15));
    }
  }
  return signalStress(signal, value);
}

function normalizeSignal(signal, value) {
  return clampHi(1 - signalStress(signal, value));
}

function buildHealthIndexSeries(signalWindow, signalKeys = null, options = {}) {
  const keys = (signalKeys || Object.keys(signalWindow)).filter((k) => signalWindow[k]?.length > 0);
  if (!keys.length) return [];

  const weightOverrides = options.weightOverrides || null;
  const failureMode = options.failureMode || null;
  const stressFn = options.useModeStress && failureMode
    ? (signal, value) => signalStressForMode(signal, value, failureMode)
    : signalStress;

  const byTs = new Map();
  keys.forEach((signal) => {
    signalWindow[signal].forEach((pt) => {
      if (!byTs.has(pt.ts)) byTs.set(pt.ts, {});
      byTs.get(pt.ts)[signal] = pt.value;
    });
  });

  const series = Array.from(byTs.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ts, valuesAtTs]) => {
      let degradation = 0;
      let wSum = 0;
      keys.forEach((signal) => {
        if (valuesAtTs[signal] === undefined) return;
        const w = weightOverrides?.[signal] ?? HI_WEIGHTS[signal] ?? 0.05;
        wSum += w;
        degradation += stressFn(signal, valuesAtTs[signal]) * w;
      });
      const healthIndex = wSum ? clampHi(1 - degradation / wSum) : 1;
      return { ts, value: healthIndex };
    });

  return series;
}

function isMotorCurrentAnomalous(data) {
  if (!data) return false;
  return data.delta >= 0.08 && (data.stress >= 0.12 || data.slope > 0.0003);
}

function buildModeHealthIndexSeries(signalWindow, failureMode, perSignal = null) {
  const modeSignals = MODE_HI_SIGNALS[failureMode] || [];
  const weightOverrides = { ...(MODE_HI_WEIGHTS[failureMode] || {}) };
  if (failureMode === "motor_creep" && !isMotorCurrentAnomalous(perSignal?.motorCurrentA)) {
    weightOverrides.cycleTimeMs = 0;
  }
  return buildHealthIndexSeries(signalWindow, modeSignals, {
    weightOverrides,
    failureMode,
    useModeStress: true
  });
}

function signalDelta(points) {
  if (!points || points.length < 2) return 0;
  return points[points.length - 1].value - points[0].value;
}

function diagnoseWindow(signalWindow, hiSeries) {
  const signalCounts = {};
  const missingSignals = [];
  Object.entries(signalWindow).forEach(([signal, points]) => {
    signalCounts[signal] = points.length;
    if (!points.length) missingSignals.push(signal);
  });
  const maxPoints = Math.max(0, ...Object.values(signalCounts));
  let reason = null;
  if (!maxPoints) {
    reason = "window returned no points";
  } else if (missingSignals.length) {
    reason = `missing ${missingSignals.join(", ")}`;
  } else if (hiSeries.length < MIN_HI_POINTS) {
    reason = `need at least ${MIN_HI_POINTS} HI points, got ${hiSeries.length}`;
  }
  return { signalCounts, missingSignals, maxPoints, alignedHiPoints: hiSeries.length, reason };
}

function extractFeatures(robotId, signalWindow, nowTs) {
  const perSignal = {};
  Object.entries(signalWindow).forEach(([signal, points]) => {
    if (!points.length) return;
    const stats = rollingStats(points);
    perSignal[signal] = {
      latest: points[points.length - 1].value,
      first: points[0].value,
      delta: signalDelta(points),
      slope: linearSlope(points),
      mean: stats.mean,
      stdDev: stats.variance,
      normalized: normalizeSignal(signal, points[points.length - 1].value),
      stress: signalStress(signal, points[points.length - 1].value)
    };
  });

  const hiSeries = buildHealthIndexSeries(signalWindow).map((p) => ({
    ts: p.ts,
    value: clampHi(p.value)
  }));
  const healthIndex = hiSeries.length ? hiSeries[hiSeries.length - 1].value : 1;
  const diagnostic = diagnoseWindow(signalWindow, hiSeries);

  return {
    robotId,
    ts: nowTs,
    healthIndex: clampHi(healthIndex),
    hiSeries,
    perSignal,
    signalWindow,
    signals: Object.keys(perSignal),
    diagnostic
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

function resolveFailureMode(features, injectedMode) {
  if (injectedMode) return injectedMode;
  return inferFailureMode(features);
}

module.exports = {
  extractFeatures,
  buildHealthIndexSeries,
  buildModeHealthIndexSeries,
  linearSlope,
  rollingStats,
  normalizeSignal,
  signalStress,
  signalStressForMode,
  signalDelta,
  clampHi,
  inferFailureMode,
  resolveFailureMode,
  isMotorCurrentAnomalous,
  HI_WEIGHTS,
  MODE_HI_WEIGHTS,
  MODE_HI_SIGNALS,
  MIN_HI_POINTS,
  FAILURE_THRESHOLD: 0.35
};
