/**
 * Forward-looking failure predictor (NOT reactive detection — see anomalyDetector.js).
 * Whiteboard method: HI trend extrapolation + crossing probability.
 */
const {
  linearSlope,
  rollingStats,
  buildModeHealthIndexSeries,
  isMotorCurrentAnomalous,
  FAILURE_THRESHOLD,
  MIN_HI_POINTS,
  signalStress
} = require("./features");

const MIN_DECLINE_SLOPE = 0.00025;
const MIN_HEALTH_DROP = 0.02;
const MIN_CONFIDENCE = 0.35;
const MIN_MODE_STRESS = 0.05;
const RECENT_TREND_POINTS = 5;
const HEALTHY_HI_FLOOR = 0.9;
const HI_NOISE_SLOPE = 0.0005;

const MODE_SIGNAL_PRIORITY = {
  bearing_wear: ["vibrationRms", "bearingTempC", "motorCurrentA"],
  battery_degradation: ["batteryCapacityPct", "batteryVoltage"],
  motor_creep: ["motorCurrentA"],
  pick_drift: ["pickActuatorDriftMm", "pickAccuracyPct", "cycleTimeMs"]
};

const MODE_EVIDENCE_SIGNALS = {
  bearing_wear: ["vibrationRms", "bearingTempC"],
  battery_degradation: ["batteryCapacityPct", "batteryVoltage"],
  motor_creep: ["motorCurrentA"],
  pick_drift: ["pickActuatorDriftMm", "pickAccuracyPct", "cycleTimeMs"]
};

/** Minimum harmful delta (window first→latest) per signal for mode evidence. */
const MODE_DELTA_FLOORS = {
  bearing_wear: { vibrationRms: 0.015, bearingTempC: 0.4, motorCurrentA: 0.06 },
  battery_degradation: { batteryCapacityPct: -0.8, batteryVoltage: -0.15, cycleTimeMs: 12 },
  motor_creep: { motorCurrentA: 0.08, bearingTempC: 0.3 },
  pick_drift: { pickActuatorDriftMm: 0.04, pickAccuracyPct: -0.12, cycleTimeMs: 12 }
};

const HI_WEIGHTS_ABS = {
  vibrationRms: 0.22,
  motorCurrentA: 0.32,
  bearingTempC: 0.18,
  batteryCapacityPct: 0.2,
  batteryVoltage: 0.12,
  pickAccuracyPct: 0.18,
  pickActuatorDriftMm: 0.2,
  cycleTimeMs: 0.12
};

function motorCreepSignalEvidence(perSignal) {
  return isMotorCurrentAnomalous(perSignal.motorCurrentA);
}

function pickPrimaryEvidence(perSignal) {
  return (
    signalEvidenceOk("pickActuatorDriftMm", "pick_drift", perSignal.pickActuatorDriftMm, perSignal, true) ||
    signalEvidenceOk("pickAccuracyPct", "pick_drift", perSignal.pickAccuracyPct, perSignal, true)
  );
}

function cycleTimeCorroborated(failureMode, perSignal) {
  if (failureMode === "motor_creep") return isMotorCurrentAnomalous(perSignal?.motorCurrentA);
  if (failureMode === "pick_drift") return pickPrimaryEvidence(perSignal);
  return false;
}

function harmfulDelta(signal, failureMode, delta) {
  const floors = MODE_DELTA_FLOORS[failureMode] || {};
  const floor = floors[signal];
  if (floor == null) return false;
  if (failureMode === "battery_degradation") {
    if (signal === "batteryCapacityPct" || signal === "batteryVoltage") return delta <= floor;
    if (signal === "cycleTimeMs") return delta >= floor;
  }
  if (failureMode === "bearing_wear") {
    return delta >= floor;
  }
  if (failureMode === "motor_creep") {
    return delta >= floor;
  }
  if (failureMode === "pick_drift") {
    if (signal === "pickAccuracyPct") return delta <= floor;
    return delta >= floor;
  }
  return false;
}

function harmfulTrend(signal, failureMode, data) {
  const slope = data.slope;
  const minSlope =
    signal === "cycleTimeMs"
      ? 0.015
      : signal === "vibrationRms"
        ? 0.00008
        : signal === "bearingTempC"
          ? 0.001
          : signal === "batteryCapacityPct"
            ? -0.00008
            : signal === "batteryVoltage"
              ? -0.00008
              : signal === "pickAccuracyPct"
                ? -0.00008
                : 0.0005;
  if (failureMode === "bearing_wear") {
    if (signal === "vibrationRms" || signal === "bearingTempC" || signal === "motorCurrentA") return slope > minSlope;
    return false;
  }
  if (failureMode === "battery_degradation") {
    if (signal === "batteryCapacityPct" || signal === "batteryVoltage") return slope < minSlope;
    if (signal === "cycleTimeMs" || signal === "trafficDelayMs") return slope > Math.abs(minSlope);
  }
  if (failureMode === "motor_creep") {
    if (signal === "motorCurrentA" || signal === "bearingTempC") return slope > minSlope;
    if (signal === "cycleTimeMs") return slope > 0.015;
  }
  if (failureMode === "pick_drift") {
    if (signal === "pickActuatorDriftMm") return slope > minSlope;
    if (signal === "pickAccuracyPct") return slope < minSlope;
    if (signal === "cycleTimeMs") return slope > 0.015;
  }
  return false;
}

function signalEvidenceOk(signal, failureMode, data, perSignal = null, skipCycleGate = false) {
  if (!data) return false;
  if (signal === "cycleTimeMs" && !skipCycleGate && !cycleTimeCorroborated(failureMode, perSignal)) {
    return false;
  }
  const stress = data.stress ?? signalStress(signal, data.latest);
  const deltaOk = harmfulDelta(signal, failureMode, data.delta ?? 0);
  const trendOk = harmfulTrend(signal, failureMode, data);
  if (!deltaOk && !trendOk) return false;
  return stress >= MIN_MODE_STRESS || deltaOk;
}

function hasModeEvidence(failureMode, perSignal) {
  if (failureMode === "motor_creep") return motorCreepSignalEvidence(perSignal);
  const signals = MODE_EVIDENCE_SIGNALS[failureMode] || [];
  return signals.some((signal) => signalEvidenceOk(signal, failureMode, perSignal[signal], perSignal));
}

function healthDropOverWindow(hiSeries) {
  if (!hiSeries || hiSeries.length < 2) return 0;
  return hiSeries[0].value - hiSeries[hiSeries.length - 1].value;
}

function sustainedDecline(hiSeries, minDrop = MIN_HEALTH_DROP) {
  const drop = healthDropOverWindow(hiSeries);
  if (drop >= minDrop) return true;
  if (hiSeries.length < RECENT_TREND_POINTS) return false;
  const recent = hiSeries.slice(-RECENT_TREND_POINTS);
  const recentDrop = recent[0].value - recent[recent.length - 1].value;
  return recentDrop >= minDrop * 0.75 && linearSlope(recent) < -MIN_DECLINE_SLOPE;
}

function modeDeclineActive(failureMode, features) {
  const { signalWindow, perSignal } = features;
  if (!signalWindow) return false;
  const modeHi = buildModeHealthIndexSeries(signalWindow, failureMode, perSignal);
  if (modeHi.length < MIN_HI_POINTS) return false;
  const modeHealth = modeHi[modeHi.length - 1].value;
  if (modeHealth >= HEALTHY_HI_FLOOR) return false;
  const modeSlope = linearSlope(modeHi);
  if (modeSlope >= -HI_NOISE_SLOPE) return false;
  const modeDrop = healthDropOverWindow(modeHi);
  const evidenceOk =
    failureMode === "motor_creep"
      ? motorCreepSignalEvidence(perSignal)
      : hasModeEvidence(failureMode, perSignal);
  if (!evidenceOk) return false;
  if (failureMode === "motor_creep") {
    return (
      modeSlope < -MIN_DECLINE_SLOPE * 0.35 &&
      (modeDrop >= MIN_HEALTH_DROP * 0.2 || sustainedDecline(modeHi, MIN_HEALTH_DROP * 0.2))
    );
  }
  return (
    modeSlope < -MIN_DECLINE_SLOPE * 0.4 &&
    (modeDrop >= MIN_HEALTH_DROP * 0.3 || sustainedDecline(modeHi, MIN_HEALTH_DROP * 0.3))
  );
}

function modeHealthSnapshot(features, failureMode) {
  if (!features?.signalWindow) {
    return { modeHi: [], modeHealth: features?.healthIndex ?? 1, modeSlope: 0, modeDrop: 0 };
  }
  const modeHi = buildModeHealthIndexSeries(features.signalWindow, failureMode, features.perSignal);
  return {
    modeHi,
    modeHealth: modeHi.length ? modeHi[modeHi.length - 1].value : features.healthIndex,
    modeSlope: modeHi.length >= MIN_HI_POINTS ? linearSlope(modeHi) : 0,
    modeDrop: healthDropOverWindow(modeHi)
  };
}

function stableHealthyResponse(
  robotId,
  failureMode,
  healthIndex,
  confidence,
  contributingSignals,
  slope,
  healthDrop,
  modeEvidence,
  reason
) {
  return {
    robotId,
    failureMode,
    failureProbability: 0.08,
    estimatedTimeToFailureHours: null,
    confidence: Number(confidence.toFixed(4)),
    healthIndex: Number(healthIndex.toFixed(4)),
    contributingSignals,
    alert: false,
    slope: Number(slope.toFixed(6)),
    healthDrop: Number(healthDrop.toFixed(4)),
    insufficientData: false,
    modeEvidence,
    reason
  };
}

function signalReason(signal, failureMode, data) {
  const stress = data.stress ?? signalStress(signal, data.latest);
  if (failureMode === "bearing_wear") {
    if (signal === "vibrationRms" && (data.slope > 0 || stress > 0.1)) return "vibration above baseline";
    if (signal === "bearingTempC" && data.slope > 0) return "bearing temperature rising";
    if (signal === "motorCurrentA" && data.slope > 0) return "motor current rising";
  }
  if (failureMode === "battery_degradation") {
    if (signal === "batteryCapacityPct" && data.slope < 0) return "battery capacity falling";
    if (signal === "batteryVoltage" && data.slope < 0) return "battery voltage sagging";
    if (signal === "cycleTimeMs" && data.slope > 0) return "cycle time worsening under load";
  }
  if (failureMode === "motor_creep") {
    if (signal === "motorCurrentA" && data.slope > 0) return "motor current creeping up";
    if (signal === "cycleTimeMs" && data.slope > 0) return "cycle time increasing";
  }
  if (failureMode === "pick_drift") {
    if (signal === "pickActuatorDriftMm" && data.slope > 0) return "pick actuator drift increasing";
    if (signal === "pickAccuracyPct" && data.slope < 0) return "pick accuracy declining";
    if (signal === "cycleTimeMs" && data.slope > 0) return "cycle time increasing from pick drift";
  }
  if (stress > 0.25) return `${signal} abnormal vs baseline`;
  return `${signal} monitored`;
}

function buildContributingSignals(perSignal, failureMode) {
  const priority = MODE_SIGNAL_PRIORITY[failureMode] || [];
  return Object.entries(perSignal)
    .map(([signal, data]) => {
      const stress = data.stress ?? signalStress(signal, data.latest);
      const harmful =
        (harmfulTrend(signal, failureMode, data) || harmfulDelta(signal, failureMode, data.delta ?? 0)) &&
        (signal !== "cycleTimeMs" || cycleTimeCorroborated(failureMode, perSignal));
      const direction = data.slope > 1e-5 ? "rising" : data.slope < -1e-5 ? "falling" : "flat";
      const baseWeight = HI_WEIGHTS_ABS[signal] || 0.08;
      const contribution = Number(
        (harmful ? stress * baseWeight * (1 + Math.min(1, Math.abs(data.slope) * 20)) : stress * baseWeight * 0.15).toFixed(
          4
        )
      );
      return {
        signal,
        weight: contribution,
        contribution,
        slope: Number(data.slope.toFixed(6)),
        delta: Number((data.delta ?? 0).toFixed(4)),
        latest: Number(data.latest.toFixed(4)),
        direction,
        reason: signalReason(signal, failureMode, data)
      };
    })
    .filter((row) => {
      const evidenceSignals = MODE_EVIDENCE_SIGNALS[failureMode];
      if (!evidenceSignals) return row.contribution > 0;
      if (evidenceSignals.includes(row.signal)) return true;
      return row.contribution > 0.02;
    })
    .sort((a, b) => {
      const pa = priority.indexOf(a.signal);
      const pb = priority.indexOf(b.signal);
      if (pa !== -1 && pb !== -1) return pa - pb || b.contribution - a.contribution;
      if (pa !== -1) return -1;
      if (pb !== -1) return 1;
      return b.contribution - a.contribution;
    })
    .slice(0, 4);
}

function isPredictionFired(pred, calibration = {}, failureMode = pred?.failureMode) {
  if (!pred || pred.insufficientData) return false;
  if (pred.estimatedTimeToFailureHours == null || !Number.isFinite(pred.estimatedTimeToFailureHours)) return false;
  const cal = calibration[failureMode] || {};
  const minP = cal.minProbability ?? 0.55;
  const horizonHours = cal.horizonHours ?? 48;
  const minConf = cal.minConfidence ?? MIN_CONFIDENCE;
  if (pred.failureProbability < minP) return false;
  if (pred.confidence < minConf) return false;
  if (pred.estimatedTimeToFailureHours > horizonHours) return false;
  if (!pred.modeEvidence) return false;
  return pred.alert === true;
}

function predict(features, calibration = {}) {
  const { robotId, healthIndex, hiSeries, perSignal } = features;
  const failureMode = features.failureMode || "bearing_wear";
  const cal = calibration[failureMode] || {
    alertThreshold: FAILURE_THRESHOLD,
    minProbability: 0.55,
    horizonHours: 48,
    minConfidence: MIN_CONFIDENCE
  };

  const threshold = cal.alertThreshold ?? FAILURE_THRESHOLD;
  const horizonHours = cal.horizonHours ?? 48;
  const minProbability = cal.minProbability ?? 0.55;
  const minConfidence = cal.minConfidence ?? MIN_CONFIDENCE;

  if (!hiSeries || hiSeries.length < MIN_HI_POINTS) {
    const diagReason = features.diagnostic?.reason;
    return {
      robotId,
      failureMode,
      failureProbability: 0.05,
      estimatedTimeToFailureHours: null,
      confidence: 0.2,
      healthIndex: Math.max(0, Math.min(1, healthIndex)),
      contributingSignals: [],
      alert: false,
      insufficientData: true,
      modeEvidence: false,
      reason:
        diagReason ||
        `need at least ${MIN_HI_POINTS} health index points, have ${hiSeries?.length ?? 0}`
    };
  }

  const slope = linearSlope(hiSeries);
  const fitResiduals = hiSeries.map((p, i) => {
    const predicted = healthIndex + slope * (i - hiSeries.length + 1);
    return p.value - predicted;
  });
  const ssRes = fitResiduals.reduce((a, r) => a + r * r, 0);
  const meanY = hiSeries.reduce((a, p) => a + p.value, 0) / hiSeries.length;
  const ssTot = hiSeries.reduce((a, p) => a + (p.value - meanY) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const confidence = Math.max(0.15, Math.min(0.95, 0.35 + r2 * 0.55));
  const contributingSignals = buildContributingSignals(perSignal, failureMode);
  const modeEvidence = hasModeEvidence(failureMode, perSignal);
  const { modeHi, modeHealth, modeSlope, modeDrop } = modeHealthSnapshot(features, failureMode);
  const healthDrop = healthDropOverWindow(hiSeries);
  const modeDeclining = modeDeclineActive(failureMode, features);
  const compositeDeclining =
    slope <= -HI_NOISE_SLOPE && slope < -MIN_DECLINE_SLOPE && sustainedDecline(hiSeries);
  const useModeHealth =
    failureMode === "motor_creep" ? motorCreepSignalEvidence(perSignal) : modeEvidence;
  const meaningfulDecline = compositeDeclining || modeDeclining;
  const gateHealth = useModeHealth ? Math.min(healthIndex, modeHealth) : healthIndex;
  const gateSlope = useModeHealth && modeDeclining ? Math.min(slope, modeSlope) : slope;

  if (gateSlope > HI_NOISE_SLOPE) {
    return stableHealthyResponse(
      robotId,
      failureMode,
      healthIndex,
      confidence,
      contributingSignals,
      slope,
      healthDrop,
      modeEvidence,
      "health trend improving"
    );
  }

  if (gateHealth >= HEALTHY_HI_FLOOR && gateSlope >= -HI_NOISE_SLOPE) {
    return stableHealthyResponse(
      robotId,
      failureMode,
      healthIndex,
      confidence,
      contributingSignals,
      slope,
      healthDrop,
      modeEvidence,
      Math.abs(gateSlope) < HI_NOISE_SLOPE ? "health trend stable" : "health within normal band"
    );
  }

  if (!meaningfulDecline && gateHealth > threshold) {
    return stableHealthyResponse(
      robotId,
      failureMode,
      healthIndex,
      confidence,
      contributingSignals,
      slope,
      healthDrop,
      modeEvidence,
      Math.abs(slope) < HI_NOISE_SLOPE ? "health trend stable" : "health trend not declining"
    );
  }

  if (!modeEvidence) {
    return {
      robotId,
      failureMode,
      failureProbability: 0.1,
      estimatedTimeToFailureHours: null,
      confidence: Number(confidence.toFixed(4)),
      healthIndex: Number(healthIndex.toFixed(4)),
      contributingSignals,
      alert: false,
      slope: Number(slope.toFixed(6)),
      healthDrop: Number(healthDrop.toFixed(4)),
      insufficientData: false,
      modeEvidence: false,
      reason: "insufficient mode-specific evidence"
    };
  }

  const trendSeries = modeDeclining && modeHi.length ? modeHi : hiSeries;
  const trendSlope = linearSlope(trendSeries);
  const trendHealth = trendSeries.length ? trendSeries[trendSeries.length - 1].value : healthIndex;
  const alertHealth = useModeHealth ? Math.min(healthIndex, modeHealth) : healthIndex;

  let estimatedTimeToFailureHours = null;
  if (meaningfulDecline && trendSlope <= -HI_NOISE_SLOPE) {
    const stepsToThreshold = (trendHealth - threshold) / Math.abs(trendSlope);
    const msPerStep =
      trendSeries.length > 1
        ? (trendSeries[trendSeries.length - 1].ts - trendSeries[0].ts) / (trendSeries.length - 1)
        : 60000;
    estimatedTimeToFailureHours = Math.max(0, (stepsToThreshold * msPerStep) / 3600000);
  } else if (healthIndex <= threshold || trendHealth <= threshold) {
    estimatedTimeToFailureHours = 0;
  }

  let failureProbability = 0.1;
  if (alertHealth >= HEALTHY_HI_FLOOR) {
    failureProbability = 0.08;
  } else if (estimatedTimeToFailureHours !== null && Number.isFinite(estimatedTimeToFailureHours)) {
    if (estimatedTimeToFailureHours <= horizonHours) {
      failureProbability = Math.max(
        0.15,
        Math.min(0.99, 1 - estimatedTimeToFailureHours / Math.max(0.5, horizonHours))
      );
      if (healthIndex <= threshold || trendHealth <= threshold) {
        failureProbability = Math.min(0.99, failureProbability + 0.15);
      }
    } else {
      failureProbability = Math.max(0.08, Math.min(0.35, 0.12 + Math.abs(trendSlope) * 8));
    }
  } else {
    failureProbability = 0.08;
  }

  if (estimatedTimeToFailureHours === null) {
    failureProbability = Math.min(failureProbability, 0.12);
  }

  const alert =
    alertHealth < HEALTHY_HI_FLOOR &&
    meaningfulDecline &&
    trendSlope <= -HI_NOISE_SLOPE &&
    estimatedTimeToFailureHours !== null &&
    Number.isFinite(estimatedTimeToFailureHours) &&
    estimatedTimeToFailureHours <= horizonHours &&
    failureProbability >= minProbability &&
    confidence >= minConfidence &&
    modeEvidence;

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
    slope: Number(slope.toFixed(6)),
    healthDrop: Number(healthDrop.toFixed(4)),
    insufficientData: false,
    modeEvidence,
    reason: meaningfulDecline ? "health index declining" : "health index below threshold"
  };
}

function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

module.exports = {
  predict,
  isPredictionFired,
  normalCdf,
  FAILURE_THRESHOLD,
  buildContributingSignals,
  hasModeEvidence,
  motorCreepSignalEvidence,
  MIN_DECLINE_SLOPE,
  MIN_HEALTH_DROP,
  MIN_CONFIDENCE,
  HEALTHY_HI_FLOOR,
  HI_NOISE_SLOPE,
  MODE_EVIDENCE_SIGNALS
};
