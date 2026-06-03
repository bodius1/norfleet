const {
  safeNumber,
  safeText,
  sanitizeForJson,
  failureModeLabel,
  isFinitePositiveNumber,
  formatTimeToFailureWithin
} = require("../utils/dispatchFormat");
const { getRepairPlan, pickEvidenceSignals, mapEvidenceSignal } = require("./repairPlans");
const { buildStableDispatchId } = require("./dispatchRegistry");

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function modeCalibration(calibration, failureMode) {
  const mode = failureMode || "bearing_wear";
  const c = calibration?.[mode] || {};
  return {
    minProbability: c.minProbability ?? 0.4,
    minConfidence: c.minConfidence ?? 0.35
  };
}

function isStableReason(reason) {
  const r = String(reason || "").toLowerCase();
  return r === "health trend stable" || r === "health within normal band";
}

function isActionablePrediction(pred, calibration = {}) {
  if (!pred || pred.insufficientData) return false;
  if (!pred.alert) return false;
  if (!isFinitePositiveNumber(pred.estimatedTimeToFailureHours)) return false;
  if (isStableReason(pred.reason)) return false;

  const { minProbability, minConfidence } = modeCalibration(calibration, pred.failureMode);
  const prob = safeNumber(pred.failureProbability, 0);
  const conf = safeNumber(pred.confidence, 0);
  if (prob < minProbability) return false;
  if (conf < minConfidence) return false;
  return true;
}

function computePriority(pred, calibration = {}) {
  if (!pred?.alert || !isFinitePositiveNumber(pred.estimatedTimeToFailureHours)) return "low";
  const ttf = Number(pred.estimatedTimeToFailureHours);
  const { minConfidence } = modeCalibration(calibration, pred.failureMode);
  const conf = safeNumber(pred.confidence, 0);
  if (ttf <= 8 && conf >= minConfidence) return "critical";
  if (ttf <= 24) return "high";
  if (ttf <= 48) return "medium";
  return "low";
}

function sortDispatches(a, b) {
  const pa = PRIORITY_ORDER[a.priority] ?? 9;
  const pb = PRIORITY_ORDER[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  const ttfA = safeNumber(a.prediction?.estimatedTimeToFailureHours, 9999);
  const ttfB = safeNumber(b.prediction?.estimatedTimeToFailureHours, 9999);
  if (ttfA !== ttfB) return ttfA - ttfB;
  const confA = safeNumber(a.prediction?.confidence, 0);
  const confB = safeNumber(b.prediction?.confidence, 0);
  if (confB !== confA) return confB - confA;
  return safeNumber(b.prediction?.failureProbability, 0) - safeNumber(a.prediction?.failureProbability, 0);
}

function robotMeta(robotId, robots) {
  const robot = (robots || []).find((r) => r.id === robotId) || {};
  return {
    robotId: safeText(robotId, "Unknown"),
    robotName: safeText(robot.name, robotId),
    vendor: safeText(robot.vendor || inferVendor(robot.model), "Not available"),
    model: safeText(robot.model, "Not available"),
    zone: safeText(robot.warehouseZone, "Not available"),
    status: safeText(robot.status, "unknown")
  };
}

function inferVendor(model) {
  const m = String(model || "").toLowerCase();
  if (m.includes("stretch") || m.includes("locus") || m.includes("chuck")) return "Locus Robotics";
  if (m.includes("cart")) return "6 River Systems";
  return "Warehouse robotics";
}

function operationalImpact(pred, priority) {
  const ttf = isFinitePositiveNumber(pred.estimatedTimeToFailureHours)
    ? Number(pred.estimatedTimeToFailureHours)
    : null;
  const mode = failureModeLabel(pred.failureMode);
  const withinPhrase = ttf != null ? formatTimeToFailureWithin(ttf) : null;
  const summary =
    withinPhrase != null
      ? `${mode} predicted ${withinPhrase} — route robot to maintenance before failure.`
      : `${mode} requires attention — review telemetry and confirm failure mode.`;
  const impact = {
    summary,
    safeToDeferUntilShiftChange: priority === "low" || priority === "medium",
    throughputCriticality: priority === "critical" ? "high" : priority === "high" ? "medium" : "low"
  };
  if (ttf != null) impact.estimatedDowntimeHoursIfFailed = ttf;
  return impact;
}

function buildDispatchItem(pred, robots, workflowStates, calibration, fleetId) {
  const priority = computePriority(pred, calibration);
  const plan = getRepairPlan(pred.failureMode, pred.confidence);
  const dispatchId = buildStableDispatchId(pred.robotId, pred.failureMode, fleetId);
  const wf = workflowStates?.[dispatchId] || {};
  const evidenceRows = pickEvidenceSignals(pred.failureMode, pred.contributingSignals || [])
    .map(mapEvidenceSignal)
    .filter(Boolean);

  const ttf = isFinitePositiveNumber(pred.estimatedTimeToFailureHours)
    ? Number(pred.estimatedTimeToFailureHours)
    : undefined;

  return sanitizeForJson({
    dispatchId,
    priority,
    actionType: "technician_dispatch",
    robot: robotMeta(pred.robotId, robots),
    prediction: {
      failureMode: safeText(pred.failureMode, "unknown"),
      failureProbability: safeNumber(pred.failureProbability, 0),
      estimatedTimeToFailureHours: ttf,
      confidence: safeNumber(pred.confidence, 0),
      healthIndex: safeNumber(pred.healthIndex, 1),
      alert: Boolean(pred.alert),
      reason: safeText(pred.reason, "Health index declining"),
      predictionId: pred.id
    },
    operationalImpact: operationalImpact(pred, priority),
    evidence: {
      signals: evidenceRows,
      manualRefs: [],
      similarCases: []
    },
    recommendedAction: {
      summary: plan.summary,
      steps: plan.steps,
      requiredParts: plan.requiredParts,
      estimatedRepairMinutes: plan.estimatedRepairMinutes,
      lockoutRequired: plan.lockoutRequired,
      approvalRequired: plan.approvalRequired
    },
    workflow: sanitizeForJson({
      status: safeText(wf.status, "new"),
      acknowledgedBy: wf.acknowledgedBy,
      workOrderId: wf.workOrderId,
      deferReason: wf.deferReason,
      deferredUntil: wf.deferredUntil,
      lastUpdatedAt: wf.lastUpdatedAt
    })
  });
}

function buildAdminUpdates(agents, anomalies) {
  const updates = [];
  (agents || []).forEach((agent, idx) => {
    const failures = safeText(agent.encounteredFailures || agent.failures, "");
    if (!failures || failures === "—" || failures.toLowerCase().includes("none")) return;
    updates.push(
      sanitizeForJson({
        updateId: `admin-${agent.id || idx}`,
        actionType: "automation_update",
        title: `Review ${safeText(agent.name, agent.id)} workflow thresholds`,
        summary: `Agent "${safeText(agent.name, agent.id)}" reported: ${failures}. Consider threshold or routing rule updates — not a floor repair task.`,
        agentId: agent.id,
        severity: "medium",
        requiresHumanApproval: true
      })
    );
  });
  if (!updates.length && Array.isArray(anomalies) && anomalies.length) {
    updates.push(
      sanitizeForJson({
        updateId: "admin-kpi-threshold",
        actionType: "automation_update",
        title: "Review KPI anomaly thresholds",
        summary: `${anomalies.length} KPI anomaly pattern(s) detected. Consider updating monitor thresholds or agent triggers — separate from robot repair dispatch.`,
        severity: "low",
        requiresHumanApproval: true
      })
    );
  }
  return updates;
}

function buildFeedbackQueue(dispatches, feedback) {
  const resolved = dispatches.filter((d) => ["resolved", "acknowledged", "in_progress"].includes(d.workflow?.status));
  const feedbackIds = new Set((feedback || []).map((f) => f.dispatchId));
  return resolved
    .filter((d) => !feedbackIds.has(d.dispatchId))
    .map((d) =>
      sanitizeForJson({
        dispatchId: d.dispatchId,
        robotId: d.robot?.robotId,
        failureMode: d.prediction?.failureMode,
        status: d.workflow?.status,
        prompt: "Record repair outcome to improve future predictions."
      })
    );
}

function buildTechnicianDispatchReport({
  predictions = [],
  robots = [],
  anomalies = [],
  agents = [],
  feedback = [],
  dispatchStates = {},
  modelInfo = {},
  now = new Date().toISOString(),
  fleetId = "fleet-default",
  siteId = "site-default"
}) {
  const calibration = modelInfo.calibration || {};
  const actionable = (predictions || []).filter((p) => isActionablePrediction(p, calibration));
  const monitoringCount = (predictions || []).filter(
    (p) => p && !p.insufficientData && !isActionablePrediction(p, calibration)
  ).length;

  const dispatches = actionable
    .map((pred) => buildDispatchItem(pred, robots, dispatchStates, calibration, fleetId))
    .sort(sortDispatches);

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  dispatches.forEach((d) => {
    if (counts[d.priority] != null) counts[d.priority] += 1;
  });

  let earliestFailureRobotId;
  let earliestFailureHours;
  dispatches.forEach((d) => {
    const ttf = d.prediction?.estimatedTimeToFailureHours;
    if (!isFinitePositiveNumber(ttf)) return;
    const hours = Number(ttf);
    if (earliestFailureHours == null || hours < earliestFailureHours) {
      earliestFailureHours = hours;
      earliestFailureRobotId = d.robot?.robotId;
    }
  });

  const adminUpdates = buildAdminUpdates(agents, anomalies);
  const feedbackQueue = buildFeedbackQueue(dispatches, feedback);

  const report = sanitizeForJson({
    reportId: `TDR-${Date.now()}`,
    generatedAt: now,
    fleetId: safeText(fleetId, "fleet-default"),
    siteId: safeText(siteId, "site-default"),
    summary: {
      criticalCount: counts.critical,
      highCount: counts.high,
      mediumCount: counts.medium,
      lowCount: counts.low,
      earliestFailureRobotId,
      earliestFailureHours,
      estimatedDowntimeRiskHours: dispatches.reduce(
        (sum, d) => sum + (isFinitePositiveNumber(d.prediction?.estimatedTimeToFailureHours) ? Number(d.prediction.estimatedTimeToFailureHours) : 0),
        0
      ),
      technicianDispatchCount: dispatches.length,
      automationUpdateCount: adminUpdates.length,
      approvalRequiredCount: dispatches.filter((d) => d.recommendedAction?.approvalRequired).length
    },
    dispatches,
    adminUpdates,
    feedbackQueue,
    modelInfo: {
      provider: safeText(modelInfo.provider, "deterministic"),
      model: safeText(modelInfo.model, "norfleet-predictor"),
      version: safeText(modelInfo.version, "phase-1"),
      monitoringCount,
      ...sanitizeForJson(modelInfo)
    }
  });

  if (!dispatches.length) {
    report.emptyState =
      "No predicted failures ready. Run telemetry analysis or check Fleet Health.";
  }

  if (report.summary && report.summary.earliestFailureRobotId === undefined) {
    delete report.summary.earliestFailureRobotId;
  }
  if (report.summary && !isFinitePositiveNumber(report.summary.earliestFailureHours)) {
    delete report.summary.earliestFailureHours;
  }

  return report;
}

module.exports = {
  buildTechnicianDispatchReport,
  isActionablePrediction,
  computePriority,
  sortDispatches,
  modeCalibration,
  isStableReason,
  buildStableDispatchId
};
