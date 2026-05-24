const { sanitizeForJson, safeText, safeNumber } = require("../utils/dispatchFormat");

const CLOSED_DISPATCH_STATUSES = new Set(["resolved", "false_alarm", "cancelled"]);
const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function sortDispatches(a, b) {
  const pa = PRIORITY_ORDER[a.priority] ?? 9;
  const pb = PRIORITY_ORDER[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  const ttfA = safeNumber(a.prediction?.estimatedTimeToFailureHours, 9999);
  const ttfB = safeNumber(b.prediction?.estimatedTimeToFailureHours, 9999);
  if (ttfA !== ttfB) return ttfA - ttfB;
  return safeNumber(b.prediction?.failureProbability, 0) - safeNumber(a.prediction?.failureProbability, 0);
}

function buildStableDispatchId(robotId, failureMode, fleetId) {
  const robot = safeText(robotId, "unknown");
  const mode = safeText(failureMode, "unknown");
  if (fleetId && fleetId !== "fleet-default") {
    return `disp-${fleetId}-${robot}-${mode}`;
  }
  return `disp-${robot}-${mode}`;
}

function isClosedDispatch(dispatch) {
  return CLOSED_DISPATCH_STATUSES.has(dispatch?.workflow?.status);
}

function mergeWorkflow(existing = {}, incoming = {}) {
  if (CLOSED_DISPATCH_STATUSES.has(existing.status)) {
    return sanitizeForJson({
      status: incoming.status || "new",
      acknowledgedBy: incoming.acknowledgedBy,
      workOrderId: incoming.workOrderId,
      deferReason: incoming.deferReason,
      deferredUntil: incoming.deferredUntil,
      lastUpdatedAt: incoming.lastUpdatedAt || new Date().toISOString()
    });
  }
  const keepStatus = new Set([
    "acknowledged",
    "deferred",
    "in_progress",
    "work_order_created",
    "resolved",
    "false_alarm",
    "cancelled"
  ]);
  const status =
    keepStatus.has(existing.status) && existing.status !== "new"
      ? existing.status
      : incoming.status || existing.status || "new";

  return sanitizeForJson({
    status,
    acknowledgedBy: existing.acknowledgedBy || incoming.acknowledgedBy,
    workOrderId: existing.workOrderId || incoming.workOrderId,
    deferReason: existing.deferReason || incoming.deferReason,
    deferredUntil: existing.deferredUntil || incoming.deferredUntil,
    lastUpdatedAt: incoming.lastUpdatedAt || existing.lastUpdatedAt
  });
}

function createDispatchRegistry(repo) {
  function getStore() {
    return repo.getActiveDispatches ? repo.getActiveDispatches() : {};
  }

  function saveStore(store) {
    if (repo.setActiveDispatches) repo.setActiveDispatches(store || {});
  }

  function get(dispatchId) {
    const store = getStore();
    return store[dispatchId] ? sanitizeForJson({ ...store[dispatchId] }) : null;
  }

  function upsert(dispatchItem) {
    if (!dispatchItem?.dispatchId) return null;
    const store = { ...getStore() };
    const prev = store[dispatchItem.dispatchId] || {};
    const merged = sanitizeForJson({
      ...prev,
      ...dispatchItem,
      workflow: mergeWorkflow(prev.workflow || {}, dispatchItem.workflow || {}),
      createdAt: prev.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    store[dispatchItem.dispatchId] = merged;
    saveStore(store);
    syncWorkflowState(dispatchItem.dispatchId, merged.workflow);
    return merged;
  }

  function syncWorkflowState(dispatchId, workflow = {}) {
    if (!repo.setDispatchStates || !repo.getDispatchStates) return;
    const states = { ...repo.getDispatchStates() };
    const prev = states[dispatchId] || { dispatchId, status: "new" };
    states[dispatchId] = {
      ...prev,
      dispatchId,
      ...workflow,
      status: workflow.status || prev.status || "new",
      lastUpdatedAt: workflow.lastUpdatedAt || new Date().toISOString()
    };
    repo.setDispatchStates(states);
  }

  function refreshPredictionFields(dispatch, latestPrediction) {
    if (!dispatch || !latestPrediction) return dispatch;
    const ttf =
      latestPrediction.estimatedTimeToFailureHours != null &&
      Number.isFinite(Number(latestPrediction.estimatedTimeToFailureHours)) &&
      Number(latestPrediction.estimatedTimeToFailureHours) > 0
        ? Number(latestPrediction.estimatedTimeToFailureHours)
        : dispatch.prediction?.estimatedTimeToFailureHours;

    return sanitizeForJson({
      ...dispatch,
      prediction: {
        ...dispatch.prediction,
        failureMode: latestPrediction.failureMode || dispatch.prediction?.failureMode,
        failureProbability: latestPrediction.failureProbability ?? dispatch.prediction?.failureProbability,
        estimatedTimeToFailureHours: ttf,
        confidence: latestPrediction.confidence ?? dispatch.prediction?.confidence,
        healthIndex: latestPrediction.healthIndex ?? dispatch.prediction?.healthIndex,
        alert: latestPrediction.alert ?? dispatch.prediction?.alert,
        reason: latestPrediction.reason || dispatch.prediction?.reason,
        predictionId: latestPrediction.id || latestPrediction.predictionId || dispatch.prediction?.predictionId
      },
      updatedAt: new Date().toISOString()
    });
  }

  function enrichReportDispatches(report, getLatestPrediction) {
    const byId = new Map();

    (report.dispatches || []).forEach((item) => {
      const robotId = item.robot?.robotId;
      const refreshed = getLatestPrediction
        ? refreshPredictionFields(item, getLatestPrediction(robotId))
        : item;
      const saved = upsert(refreshed);
      byId.set(saved.dispatchId, saved);
    });

    Object.values(getStore()).forEach((persisted) => {
      if (byId.has(persisted.dispatchId)) return;
      if (isClosedDispatch(persisted)) return;
      if (!persisted.workflow?.workOrderId) return;

      const robotId = persisted.robot?.robotId;
      const refreshed = getLatestPrediction
        ? refreshPredictionFields(persisted, getLatestPrediction(robotId))
        : persisted;
      const saved = upsert(refreshed);
      byId.set(saved.dispatchId, saved);
    });

    report.dispatches = Array.from(byId.values())
      .filter((d) => !isClosedDispatch(d))
      .sort(sortDispatches);

    return report;
  }

  function resolveForWorkOrder(dispatchId, buildFreshReport) {
    const persisted = get(dispatchId);
    if (persisted && !isClosedDispatch(persisted)) {
      return persisted;
    }

    const report = buildFreshReport();
    const fresh = (report.dispatches || []).find((d) => d.dispatchId === dispatchId);
    if (fresh) {
      return upsert(fresh);
    }

    return null;
  }

  function canCreateWorkOrder(dispatch) {
    if (!dispatch) return false;
    if (isClosedDispatch(dispatch)) return false;
    return true;
  }

  return {
    CLOSED_DISPATCH_STATUSES,
    buildStableDispatchId,
    isClosedDispatch,
    mergeWorkflow,
    get,
    upsert,
    enrichReportDispatches,
    resolveForWorkOrder,
    canCreateWorkOrder,
    refreshPredictionFields
  };
}

module.exports = {
  CLOSED_DISPATCH_STATUSES,
  buildStableDispatchId,
  isClosedDispatch,
  createDispatchRegistry
};
