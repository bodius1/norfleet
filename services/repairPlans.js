const { formatSignalName } = require("../utils/dispatchFormat");

const REPAIR_PLANS = {
  bearing_wear: {
    summary: "Inspect drive bearing and wheel module.",
    steps: [
      "Pull robot at next safe routing window.",
      "Lock out robot according to site procedure.",
      "Inspect drive bearing housing and wheel module play.",
      "Check for heat, vibration, wobble, or abnormal noise.",
      "Replace bearing/wheel module if wear is confirmed.",
      "Run a 5-minute recovery route and verify vibration trend stabilizes."
    ],
    evidenceSignals: ["vibrationRms", "bearingTempC", "motorCurrentA"],
    requiredParts: ["Bearing kit", "Wheel module (if needed)"],
    estimatedRepairMinutes: 45,
    lockoutRequired: true,
    approvalRequired: false
  },
  battery_degradation: {
    summary: "Inspect battery health and charging behavior.",
    steps: [
      "Check recent charge cycles and runtime drop.",
      "Inspect charging contacts and battery connection.",
      "Verify voltage under load.",
      "Schedule battery swap if capacity trend is degraded.",
      "Confirm robot completes a normal charge cycle."
    ],
    evidenceSignals: ["batteryCapacityPct", "batteryVoltage"],
    requiredParts: ["Replacement battery module (if swap required)"],
    estimatedRepairMinutes: 35,
    lockoutRequired: true,
    approvalRequired: false
  },
  motor_creep: {
    summary: "Inspect motor current draw and drivetrain resistance.",
    steps: [
      "Pull robot during a safe break window.",
      "Check drive motor temperature and current draw.",
      "Inspect wheel drag, debris, belt tension, and gearbox resistance.",
      "Clear obstruction or schedule motor module service.",
      "Run recovery test and compare motorCurrentA trend."
    ],
    evidenceSignals: ["motorCurrentA", "cycleTimeMs"],
    requiredParts: ["Motor service kit (site-specific)"],
    estimatedRepairMinutes: 40,
    lockoutRequired: true,
    approvalRequired: false
  },
  pick_drift: {
    summary: "Inspect pick actuator calibration and cycle consistency.",
    steps: [
      "Review pick error/cycle trend.",
      "Inspect gripper or actuator alignment.",
      "Recalibrate pick position if drift is confirmed.",
      "Run controlled pick test.",
      "Record whether error rate returns to baseline."
    ],
    evidenceSignals: ["pickActuatorDriftMm", "pickAccuracyPct", "cycleTimeMs"],
    requiredParts: ["Calibration shim kit (if needed)"],
    estimatedRepairMinutes: 30,
    lockoutRequired: false,
    approvalRequired: false
  }
};

const DEFAULT_PLAN = {
  summary: "Review telemetry and monitor.",
  steps: [
    "Review health trend.",
    "Inspect top contributing signals.",
    "Escalate if trend continues."
  ],
  evidenceSignals: [],
  requiredParts: [],
  estimatedRepairMinutes: 20,
  lockoutRequired: false,
  approvalRequired: false
};

function getRepairPlan(failureMode, confidence) {
  const plan = REPAIR_PLANS[failureMode] || DEFAULT_PLAN;
  const approvalRequired =
    failureMode === "bearing_wear" && confidence != null && confidence < 0.5
      ? true
      : Boolean(plan.approvalRequired);
  const lockoutRequired =
    failureMode === "pick_drift" ? Boolean(plan.lockoutRequired) : plan.lockoutRequired;
  return {
    ...plan,
    lockoutRequired,
    approvalRequired
  };
}

function pickEvidenceSignals(failureMode, contributingSignals) {
  const plan = getRepairPlan(failureMode);
  const priority = plan.evidenceSignals.length ? plan.evidenceSignals : (contributingSignals || []).map((s) => s.signal);
  const byName = new Map((contributingSignals || []).map((s) => [s.signal, s]));
  const ordered = [];
  priority.forEach((name) => {
    const row = byName.get(name);
    if (row) ordered.push(row);
  });
  (contributingSignals || []).forEach((row) => {
    if (!ordered.find((x) => x.signal === row.signal)) ordered.push(row);
  });
  return ordered.slice(0, 4);
}

function mapEvidenceSignal(row) {
  if (!row) return null;
  const delta = row.delta ?? 0;
  const first = row.latest != null && delta != null ? row.latest - delta : null;
  const deltaPct =
    first != null && Math.abs(first) > 1e-9 ? ((row.latest - first) / Math.abs(first)) * 100 : null;
  return {
    name: row.signal,
    latest: row.latest,
    slope: row.slope,
    deltaPct: deltaPct != null && Number.isFinite(deltaPct) ? Number(deltaPct.toFixed(2)) : undefined,
    direction: row.direction || (row.slope > 0 ? "rising" : row.slope < 0 ? "falling" : "flat"),
    reason: row.reason || `${formatSignalName(row.signal)} monitored`
  };
}

module.exports = {
  REPAIR_PLANS,
  getRepairPlan,
  pickEvidenceSignals,
  mapEvidenceSignal
};
