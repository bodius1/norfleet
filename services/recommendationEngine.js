"use strict";

const TEMPLATES = {
  bearing_wear: {
    likelyCause: "Bearing wear from vibration and heat buildup",
    recommendedActions: [
      "Inspect and lubricate bearings",
      "Check wheel alignment and track for flat spots",
      "Replace bearing assembly if vibrationRms remains elevated after lubrication"
    ],
    signalsToInspect: ["vibrationRms", "bearingTempC"],
    safetyNote: "Lock out / tag out before bearing service. Allow bearing to cool before handling."
  },
  battery_degradation: {
    likelyCause: "Battery cell capacity fade or charging system fault",
    recommendedActions: [
      "Run a full charge cycle and measure discharge capacity",
      "Inspect charging contacts for corrosion or wear",
      "Replace battery pack if capacity falls below 70% of rated spec"
    ],
    signalsToInspect: ["batteryVoltage", "batteryCapacityPct"],
    safetyNote: "Wear insulated gloves when handling battery pack. Do not short-circuit terminals."
  },
  motor_creep: {
    likelyCause: "Motor encoder drift or drive circuit degradation",
    recommendedActions: [
      "Recalibrate encoder zero-point baseline",
      "Inspect motor drive belt and pulleys for wear",
      "Check drivetrain for debris or binding before recalibration"
    ],
    signalsToInspect: ["motorCurrentA", "cycleTimeMs"],
    safetyNote: "Disable drive power and confirm zero motion before accessing drivetrain."
  },
  pick_drift: {
    likelyCause: "End-effector calibration drift or vision system offset",
    recommendedActions: [
      "Run pick accuracy calibration routine from maintenance menu",
      "Clean camera lenses and verify mount torque",
      "Re-seat gripper and confirm torque to manufacturer spec"
    ],
    signalsToInspect: ["cycleTimeMs", "trafficDelayMs"],
    safetyNote: "Engage E-stop before any gripper or camera mount work."
  }
};

const URGENCY_MAP = {
  Critical: "immediate",
  High: "urgent",
  Medium: "scheduled",
  Low: "monitor"
};

function buildRecommendation({ robotId, failureMode, severity, probability, ttfHours, topSignals }) {
  const template = TEMPLATES[failureMode] || TEMPLATES.bearing_wear;
  const urgency = URGENCY_MAP[severity] || "monitor";

  const extraSignals = Array.isArray(topSignals)
    ? topSignals
        .map((s) => (typeof s === "string" ? s : s?.signal))
        .filter(Boolean)
        .filter((s) => !template.signalsToInspect.includes(s))
    : [];

  return {
    robotId,
    failureMode,
    urgency,
    likelyCause: template.likelyCause,
    recommendedActions: template.recommendedActions,
    signalsToInspect: [...template.signalsToInspect, ...extraSignals],
    safetyNote: template.safetyNote,
    meta: {
      severity: severity || null,
      probability: probability != null ? Number(probability) : null,
      ttfHours: ttfHours != null ? Number(ttfHours) : null
    }
  };
}

module.exports = { buildRecommendation };
