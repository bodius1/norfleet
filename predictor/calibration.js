/**
 * Feedback-driven recalibration — adjusts alert thresholds per failure mode.
 */
const DEFAULT_CALIBRATION = {
  bearing_wear: { alertThreshold: 0.4, minProbability: 0.4, minConfidence: 0.35, horizonHours: 48, falseAlarms: 0, confirmed: 0 },
  battery_degradation: { alertThreshold: 0.4, minProbability: 0.4, minConfidence: 0.35, horizonHours: 48, falseAlarms: 0, confirmed: 0 },
  motor_creep: { alertThreshold: 0.4, minProbability: 0.4, minConfidence: 0.35, horizonHours: 48, falseAlarms: 0, confirmed: 0 },
  pick_drift: { alertThreshold: 0.4, minProbability: 0.4, minConfidence: 0.35, horizonHours: 48, falseAlarms: 0, confirmed: 0 }
};

function cloneCalibration(source = {}) {
  const cal = {};
  const modes = new Set([...Object.keys(DEFAULT_CALIBRATION), ...Object.keys(source || {})]);
  modes.forEach((mode) => {
    cal[mode] = { ...(DEFAULT_CALIBRATION[mode] || {}), ...(source[mode] || {}) };
  });
  return cal;
}

function loadCalibration(repo) {
  const stored = repo.getCalibration() || {};
  return cloneCalibration(stored);
}

function applyOutcome(calibration, failureMode, outcome) {
  const cal = cloneCalibration(calibration);
  const mode = failureMode || "bearing_wear";
  if (!cal[mode]) cal[mode] = { ...DEFAULT_CALIBRATION.bearing_wear };

  if (outcome === "false-alarm") {
    cal[mode].falseAlarms = (cal[mode].falseAlarms || 0) + 1;
    cal[mode].alertThreshold = Math.max(0.2, cal[mode].alertThreshold - 0.04);
    cal[mode].minProbability = Math.min(0.85, (cal[mode].minProbability || 0.55) + 0.05);
  } else if (outcome === "confirmed-failure" || outcome === "fixed-early") {
    cal[mode].confirmed = (cal[mode].confirmed || 0) + 1;
    cal[mode].alertThreshold = Math.min(0.45, cal[mode].alertThreshold + 0.01);
  }
  return cal;
}

function getFalseAlarmRate(calibration) {
  let fa = 0;
  let total = 0;
  Object.values(calibration).forEach((c) => {
    fa += c.falseAlarms || 0;
    total += (c.falseAlarms || 0) + (c.confirmed || 0);
  });
  return total ? fa / total : 0;
}

module.exports = {
  DEFAULT_CALIBRATION,
  cloneCalibration,
  loadCalibration,
  applyOutcome,
  getFalseAlarmRate
};
