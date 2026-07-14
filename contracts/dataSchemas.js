/**
 * Shared schema definitions for core data types.
 * Pairs with contracts/runtimeShapes.js (agent/prediction UI shapes).
 *
 * Loaded in Node (require) and browser (<script>) — keep field names in sync
 * with: adapters/robotTelemetry.js, predictor/failurePredictor.js,
 * anomalyDetector.js, services/technicianDispatchReport.js,
 * services/dispatchWorkflow.js.
 */
(function (root) {

  // ---------------------------------------------------------------------------
  // Enumerations
  // ---------------------------------------------------------------------------

  const FAILURE_MODES = Object.freeze([
    "bearing_wear",
    "battery_degradation",
    "motor_creep",
    "pick_drift"
  ]);

  const FEEDBACK_OUTCOMES = Object.freeze([
    "confirmed_failure",
    "fixed_early",
    "false_alarm",
    "not_enough_evidence"
  ]);

  const ALERT_SEVERITIES = Object.freeze(["High", "Medium", "Low"]);

  const WORK_ORDER_STATUSES = Object.freeze([
    "open",
    "assigned",
    "in_progress",
    "on_hold",
    "resolved",
    "false_alarm",
    "cancelled"
  ]);

  // ---------------------------------------------------------------------------
  // TelemetrySample
  // Shape: { robotId, ts, signals, model? }
  // Source: adapters/robotTelemetry.js normalizeCanonical()
  // ---------------------------------------------------------------------------

  function normalizeTelemetrySample(raw) {
    if (!raw || typeof raw !== "object") return null;
    return {
      robotId: String(raw.robotId || ""),
      ts: typeof raw.ts === "number" ? raw.ts : Date.now(),
      signals:
        raw.signals && typeof raw.signals === "object" && !Array.isArray(raw.signals)
          ? { ...raw.signals }
          : {},
      model: raw.model || null
    };
  }

  // ---------------------------------------------------------------------------
  // ContributingSignal (nested in PredictionResult)
  // Shape: { signal, weight, contribution, slope, delta, latest, direction, reason }
  // Source: predictor/failurePredictor.js buildContributingSignals()
  // ---------------------------------------------------------------------------

  function normalizeContributingSignal(raw) {
    if (!raw || typeof raw !== "object") return null;
    return {
      signal: String(raw.signal || ""),
      weight: Number.isFinite(raw.weight) ? raw.weight : 0,
      contribution: Number.isFinite(raw.contribution) ? raw.contribution : 0,
      slope: Number.isFinite(raw.slope) ? raw.slope : 0,
      delta: Number.isFinite(raw.delta) ? raw.delta : 0,
      latest: Number.isFinite(raw.latest) ? raw.latest : 0,
      direction: raw.direction || "flat",
      reason: raw.reason || ""
    };
  }

  // ---------------------------------------------------------------------------
  // PredictionResult
  // Shape: { id?, robotId, robotName?, ts?, failureMode, failureProbability,
  //          estimatedTimeToFailureHours, confidence, healthIndex,
  //          contributingSignals, alert, slope, healthDrop,
  //          insufficientData, modeEvidence, reason, status? }
  // Source: predictor/failurePredictor.js predict()
  //         contracts/runtimeShapes.js normalizePrediction()
  // ---------------------------------------------------------------------------

  function normalizePredictionResult(raw) {
    if (!raw || typeof raw !== "object") return null;
    const ttf = raw.estimatedTimeToFailureHours;
    return {
      id: raw.id || null,
      robotId: String(raw.robotId || ""),
      robotName: raw.robotName || raw.robotId || null,
      ts: typeof raw.ts === "number" ? raw.ts : null,
      failureMode: FAILURE_MODES.includes(raw.failureMode) ? raw.failureMode : "bearing_wear",
      failureProbability: Number.isFinite(raw.failureProbability) ? raw.failureProbability : 0.05,
      estimatedTimeToFailureHours: ttf !== undefined && ttf !== null ? ttf : null,
      confidence: Number.isFinite(raw.confidence) ? raw.confidence : 0.2,
      healthIndex: Number.isFinite(raw.healthIndex) ? Math.max(0, Math.min(1, raw.healthIndex)) : 1,
      contributingSignals: Array.isArray(raw.contributingSignals)
        ? raw.contributingSignals.map(normalizeContributingSignal).filter(Boolean)
        : [],
      alert: Boolean(raw.alert),
      slope: Number.isFinite(raw.slope) ? raw.slope : 0,
      healthDrop: Number.isFinite(raw.healthDrop) ? raw.healthDrop : 0,
      insufficientData: Boolean(raw.insufficientData),
      modeEvidence: Boolean(raw.modeEvidence),
      reason: raw.reason || null,
      status: raw.status || null,
      predictionSource: raw.predictionSource === "ml" ? "ml" : "rule"
    };
  }

  // ---------------------------------------------------------------------------
  // AlertEvent
  // Shape: { kpi, latest, baseline, deltaPct, severity }
  // Source: anomalyDetector.js detectKpiAnomalies()
  // ---------------------------------------------------------------------------

  function normalizeAlertEvent(raw) {
    if (!raw || typeof raw !== "object") return null;
    return {
      kpi: String(raw.kpi || ""),
      latest: Number.isFinite(raw.latest) ? raw.latest : 0,
      baseline: Number.isFinite(raw.baseline) ? raw.baseline : 0,
      deltaPct: Number.isFinite(raw.deltaPct) ? raw.deltaPct : 0,
      severity: ALERT_SEVERITIES.includes(raw.severity) ? raw.severity : "Low"
    };
  }

  // ---------------------------------------------------------------------------
  // MaintenanceRecommendation
  // Shape: { summary, steps, requiredParts, estimatedRepairMinutes,
  //          lockoutRequired, approvalRequired }
  // Source: services/repairPlans.js, services/technicianDispatchReport.js
  //         buildDispatchItem() recommendedAction
  // ---------------------------------------------------------------------------

  function normalizeMaintenanceRecommendation(raw) {
    if (!raw || typeof raw !== "object") return null;
    return {
      summary: String(raw.summary || ""),
      steps: Array.isArray(raw.steps) ? raw.steps.map(String) : [],
      requiredParts: Array.isArray(raw.requiredParts) ? raw.requiredParts.map(String) : [],
      estimatedRepairMinutes: Number.isFinite(raw.estimatedRepairMinutes)
        ? raw.estimatedRepairMinutes
        : null,
      lockoutRequired: Boolean(raw.lockoutRequired),
      approvalRequired: Boolean(raw.approvalRequired)
    };
  }

  // ---------------------------------------------------------------------------
  // TechnicianFeedback
  // Shape: { id?, dispatchId, robotId?, failureMode?, predictionId?,
  //          outcome, actualCause, actionTaken, fixWorked,
  //          repairMinutes?, partsUsed, notes, technicianId?, createdAt? }
  // Source: services/dispatchWorkflow.js recordFeedback()
  // ---------------------------------------------------------------------------

  function normalizeTechnicianFeedback(raw) {
    if (!raw || typeof raw !== "object") return null;
    const repairMin = Number(raw.repairMinutes);
    return {
      id: raw.id || null,
      dispatchId: String(raw.dispatchId || ""),
      robotId: raw.robotId || null,
      failureMode: raw.failureMode || null,
      predictionId: raw.predictionId || null,
      outcome: FEEDBACK_OUTCOMES.includes(raw.outcome) ? raw.outcome : null,
      actualCause: raw.actualCause || "",
      actionTaken: raw.actionTaken || "",
      fixWorked: Boolean(raw.fixWorked),
      repairMinutes: Number.isFinite(repairMin) ? repairMin : null,
      partsUsed: Array.isArray(raw.partsUsed) ? raw.partsUsed.map(String) : [],
      notes: raw.notes || "",
      technicianId: raw.technicianId || null,
      createdAt: raw.createdAt || null
    };
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------

  const api = {
    FAILURE_MODES,
    FEEDBACK_OUTCOMES,
    ALERT_SEVERITIES,
    WORK_ORDER_STATUSES,
    normalizeTelemetrySample,
    normalizeContributingSignal,
    normalizePredictionResult,
    normalizeAlertEvent,
    normalizeMaintenanceRecommendation,
    normalizeTechnicianFeedback
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.DataSchemas = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
