const { getRepairPlan, pickEvidenceSignals, mapEvidenceSignal } = require("./repairPlans");
const { getSopRefsForFailureMode } = require("./sopEvidence");
const {
  safeNumber,
  safeText,
  sanitizeForJson,
  isFinitePositiveNumber
} = require("../utils/dispatchFormat");

function normalizeContributingSignals(prediction, dispatchEvidence = []) {
  if (Array.isArray(prediction?.contributingSignals) && prediction.contributingSignals.length) {
    return prediction.contributingSignals;
  }
  return (dispatchEvidence || []).map((s) => ({
    signal: s.name || s.signal,
    latest: s.latest,
    slope: s.slope,
    delta: s.delta,
    direction: s.direction,
    reason: s.reason
  }));
}
const WORK_ORDER_STATUSES = ["open", "assigned", "in_progress", "on_hold", "resolved", "false_alarm", "cancelled"];
const RESOLVE_OUTCOMES = ["confirmed_failure", "fixed_early", "false_alarm", "not_enough_evidence"];

// TODO: ServiceNow — push work order create/update/resolve via REST table API.
// TODO: MaintainX — sync WO status and technician assignment through vendor webhook.
// TODO: UpKeep — export before/after snapshots as PM checklist completion records.
// TODO: SAP PM — map failureMode to notification type and equipment functional location.
// TODO: WMS — pause/resume robot task queue on WO create/resolve.

function captureSnapshot(prediction, contributingSignals = []) {
  const topSignals = pickEvidenceSignals(prediction?.failureMode, contributingSignals || [])
    .map(mapEvidenceSignal)
    .filter(Boolean)
    .slice(0, 4)
    .map((s) =>
      sanitizeForJson({
        name: s.name,
        latest: safeNumber(s.latest, undefined),
        direction: safeText(s.direction, "flat"),
        reason: safeText(s.reason, "Signal monitored")
      })
    );

  const ttf = isFinitePositiveNumber(prediction?.estimatedTimeToFailureHours)
    ? Number(prediction.estimatedTimeToFailureHours)
    : undefined;

  return sanitizeForJson({
    capturedAt: new Date().toISOString(),
    healthIndex: safeNumber(prediction?.healthIndex, undefined),
    failureProbability: safeNumber(prediction?.failureProbability, undefined),
    estimatedTimeToFailureHours: ttf,
    confidence: safeNumber(prediction?.confidence, undefined),
    failureMode: safeText(prediction?.failureMode, "unknown"),
    topSignals
  });
}

function assessSnapshotOutcome(beforeSnapshot, afterSnapshot) {
  if (!beforeSnapshot || !afterSnapshot) {
    return {
      improved: false,
      monitoringStillNeeded: true,
      reason: "Insufficient before/after telemetry — continued monitoring recommended."
    };
  }

  const hiBefore = safeNumber(beforeSnapshot.healthIndex, null);
  const hiAfter = safeNumber(afterSnapshot.healthIndex, null);
  const probBefore = safeNumber(beforeSnapshot.failureProbability, null);
  const probAfter = safeNumber(afterSnapshot.failureProbability, null);

  let improved = false;
  if (hiBefore != null && hiAfter != null && hiAfter > hiBefore + 0.02) improved = true;
  if (probBefore != null && probAfter != null && probAfter < probBefore - 0.05) improved = true;

  if (!improved) {
    return {
      improved: false,
      monitoringStillNeeded: true,
      reason: "Telemetry has not improved after repair — continued monitoring recommended."
    };
  }

  return {
    improved: true,
    monitoringStillNeeded: false,
    reason: "Telemetry shows improvement after repair."
  };
}

function createWorkOrderService(repo, options = {}) {
  const {
    getDispatchById,
    getLivePredictionForRobot,
    markDispatchWorkOrderCreated,
    recordDispatchFeedback
  } = options;

  function getWorkOrdersStore() {
    return repo.getWorkOrders ? repo.getWorkOrders() : [];
  }

  function saveWorkOrder(workOrder) {
    const rows = getWorkOrdersStore();
    const idx = rows.findIndex((w) => w.workOrderId === workOrder.workOrderId);
    if (idx >= 0) rows[idx] = workOrder;
    else rows.push(workOrder);
    repo.setWorkOrders(rows);
    return workOrder;
  }

  function addAudit(entry) {
    repo.addWorkOrderAudit?.({
      id: `WOA-${Date.now()}`,
      createdAt: new Date().toISOString(),
      ...entry
    });
  }

  function findByDispatchId(dispatchId) {
    return getWorkOrdersStore().find((w) => w.dispatchId === dispatchId) || null;
  }

  function getWorkOrder(workOrderId) {
    const wo = getWorkOrdersStore().find((w) => w.workOrderId === workOrderId) || null;
    return wo ? sanitizeForJson({ ...wo }) : null;
  }

  function listWorkOrders(filter = {}) {
    let rows = getWorkOrdersStore();
    if (filter.status) rows = rows.filter((w) => w.status === filter.status);
    if (filter.robotId) rows = rows.filter((w) => w.robotId === filter.robotId);
    if (filter.dispatchId) rows = rows.filter((w) => w.dispatchId === filter.dispatchId);
    return rows.map((w) => sanitizeForJson({ ...w }));
  }

  function createWorkOrderFromDispatch(dispatchId, payload = {}) {
    const dispatch = getDispatchById?.(dispatchId);
    if (!dispatch) {
      throw new Error(`Dispatch not found or not actionable: ${dispatchId}`);
    }

    if (dispatch.workflow?.workOrderId && !payload.force) {
      const linked = getWorkOrder(dispatch.workflow.workOrderId) || findByDispatchId(dispatchId);
      if (linked) {
        return { workOrder: linked, reusedExisting: true };
      }
    }

    const existing = findByDispatchId(dispatchId);
    if (existing && !payload.force) {
      return { workOrder: existing, reusedExisting: true };
    }

    const robotId = dispatch.robot?.robotId || dispatch.robotId;
    const failureMode = dispatch.prediction?.failureMode;
    const plan = getRepairPlan(failureMode, dispatch.prediction?.confidence);
    const livePrediction = getLivePredictionForRobot?.(robotId) || dispatch.prediction;
    const signals = normalizeContributingSignals(livePrediction, dispatch.evidence?.signals);
    const beforeSnapshot = captureSnapshot(livePrediction, signals);

    const now = new Date().toISOString();
    const workOrderId = payload.workOrderId || `WO-${Date.now()}`;
    const workOrder = sanitizeForJson({
      workOrderId,
      dispatchId,
      robotId: safeText(robotId, "Unknown"),
      robotName: safeText(dispatch.robot?.robotName, robotId),
      zone: safeText(dispatch.robot?.zone, "Not available"),
      failureMode: safeText(failureMode, "unknown"),
      priority: safeText(dispatch.priority, "medium"),
      status: "open",
      createdAt: now,
      updatedAt: now,
      createdBy: safeText(payload.createdBy || payload.technicianId, "technician"),
      assignedTechnicianId: payload.assignedTechnicianId || payload.technicianId || undefined,
      summary: safeText(plan.summary, "Review telemetry and repair as needed."),
      recommendedSteps: plan.steps || [],
      evidenceSignals: (dispatch.evidence?.signals || []).slice(0, 4),
      sopRefs: getSopRefsForFailureMode(failureMode),
      beforeSnapshot,
      afterSnapshot: undefined,
      feedbackId: undefined
    });

    saveWorkOrder(workOrder);
    addAudit({ workOrderId, action: "created", dispatchId, patch: { status: "open" } });
    markDispatchWorkOrderCreated?.(dispatchId, { workOrderId, technicianId: payload.technicianId });

    return { workOrder, reusedExisting: false };
  }

  function updateWorkOrderStatus(workOrderId, payload = {}) {
    const wo = getWorkOrder(workOrderId);
    if (!wo) throw new Error(`Work order not found: ${workOrderId}`);

    const status = payload.status;
    if (!status || !WORK_ORDER_STATUSES.includes(status)) {
      throw new Error(`status must be one of: ${WORK_ORDER_STATUSES.join(", ")}`);
    }

    const updated = sanitizeForJson({
      ...wo,
      status,
      updatedAt: new Date().toISOString(),
      assignedTechnicianId:
        payload.assignedTechnicianId != null
          ? payload.assignedTechnicianId
          : payload.technicianId != null
            ? payload.technicianId
            : wo.assignedTechnicianId
    });

    saveWorkOrder(updated);
    addAudit({ workOrderId, action: "status_update", patch: { status, assignedTechnicianId: updated.assignedTechnicianId } });
    return updated;
  }

  function resolveWorkOrder(workOrderId, payload = {}) {
    const wo = getWorkOrder(workOrderId);
    if (!wo) throw new Error(`Work order not found: ${workOrderId}`);

    const outcome = payload.outcome || "confirmed_failure";
    if (!RESOLVE_OUTCOMES.includes(outcome)) {
      throw new Error(`outcome must be one of: ${RESOLVE_OUTCOMES.join(", ")}`);
    }

    const livePrediction = getLivePredictionForRobot?.(wo.robotId);
    const signals = normalizeContributingSignals(livePrediction, []);
    const afterSnapshot = captureSnapshot(livePrediction || {}, signals);
    const outcomeAssessment = assessSnapshotOutcome(wo.beforeSnapshot, afterSnapshot);

    let feedbackRecord = null;
    if (recordDispatchFeedback) {
      feedbackRecord = recordDispatchFeedback(wo.dispatchId, {
        outcome,
        robotId: wo.robotId,
        failureMode: wo.failureMode,
        predictionId: payload.predictionId,
        actionTaken: payload.actionTaken,
        actualCause: payload.actualCause,
        notes: payload.notes,
        repairMinutes: payload.repairMinutes,
        technicianId: payload.technicianId || wo.assignedTechnicianId || "technician"
      });
    }

    const finalStatus = outcome === "false_alarm" ? "false_alarm" : "resolved";
    const updated = sanitizeForJson({
      ...wo,
      status: finalStatus,
      updatedAt: new Date().toISOString(),
      afterSnapshot,
      feedbackId: feedbackRecord?.id,
      resolution: {
        outcome,
        monitoringStillNeeded: outcomeAssessment.monitoringStillNeeded,
        improvementObserved: outcomeAssessment.improved,
        reason: outcomeAssessment.reason
      }
    });

    saveWorkOrder(updated);
    addAudit({
      workOrderId,
      action: "resolved",
      patch: { status: finalStatus, outcome, monitoringStillNeeded: outcomeAssessment.monitoringStillNeeded }
    });

    return { workOrder: updated, afterSnapshot, outcomeAssessment, feedback: feedbackRecord };
  }

  return {
    WORK_ORDER_STATUSES,
    RESOLVE_OUTCOMES,
    captureSnapshot,
    assessSnapshotOutcome,
    createWorkOrderFromDispatch,
    getWorkOrder,
    listWorkOrders,
    updateWorkOrderStatus,
    resolveWorkOrder,
    findByDispatchId
  };
}

module.exports = {
  WORK_ORDER_STATUSES,
  RESOLVE_OUTCOMES,
  captureSnapshot,
  assessSnapshotOutcome,
  createWorkOrderService
};
