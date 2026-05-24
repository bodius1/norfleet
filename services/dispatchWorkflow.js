const OUTCOMES = ["confirmed_failure", "fixed_early", "false_alarm", "not_enough_evidence"];

function createDispatchWorkflow(repo) {
  function getStates() {
    return repo.getDispatchStates ? repo.getDispatchStates() : {};
  }

  function getFeedback() {
    return repo.getDispatchFeedback ? repo.getDispatchFeedback() : [];
  }

  function findDispatchMeta(dispatchId) {
    const states = getStates();
    return states[dispatchId] || { dispatchId, status: "new" };
  }

  function updateStatus(dispatchId, status, patch = {}) {
    const states = { ...getStates() };
    const prev = states[dispatchId] || { dispatchId, status: "new" };
    states[dispatchId] = {
      ...prev,
      ...patch,
      dispatchId,
      status,
      lastUpdatedAt: new Date().toISOString()
    };
    repo.setDispatchStates(states);
    repo.addDispatchAudit?.({
      id: `AUD-${Date.now()}`,
      dispatchId,
      action: status,
      patch,
      createdAt: new Date().toISOString()
    });
    return states[dispatchId];
  }

  function acknowledge(dispatchId, payload = {}) {
    return updateStatus(dispatchId, "acknowledged", {
      acknowledgedBy: payload.technicianId || payload.acknowledgedBy || "technician"
    });
  }

  function defer(dispatchId, payload = {}) {
    return updateStatus(dispatchId, "deferred", {
      deferReason: payload.reason || "Deferred to next shift",
      acknowledgedBy: payload.technicianId || payload.acknowledgedBy
    });
  }

  function resolve(dispatchId, payload = {}) {
    return updateStatus(dispatchId, "resolved", {
      workOrderId: payload.workOrderId || `WO-${Date.now()}`,
      acknowledgedBy: payload.technicianId || payload.acknowledgedBy
    });
  }

  function falseAlarm(dispatchId, payload = {}) {
    return updateStatus(dispatchId, "false_alarm", {
      acknowledgedBy: payload.technicianId || payload.acknowledgedBy
    });
  }

  function recordFeedback(dispatchId, payload, recordPlatformFeedback) {
    const outcome = payload.outcome;
    if (!OUTCOMES.includes(outcome)) {
      throw new Error(`outcome must be one of: ${OUTCOMES.join(", ")}`);
    }
    const record = {
      id: `DFB-${Date.now()}`,
      dispatchId,
      robotId: payload.robotId,
      failureMode: payload.failureMode,
      predictionId: payload.predictionId,
      outcome,
      actualCause: payload.actualCause || "",
      actionTaken: payload.actionTaken || "",
      fixWorked: Boolean(payload.fixWorked),
      repairMinutes: payload.repairMinutes,
      partsUsed: payload.partsUsed || [],
      notes: payload.notes || "",
      technicianId: payload.technicianId || "technician",
      createdAt: new Date().toISOString()
    };
    repo.addDispatchFeedback(record);

    const calibrationOutcome =
      outcome === "false_alarm"
        ? "false-alarm"
        : outcome === "confirmed_failure"
          ? "confirmed-failure"
          : outcome === "fixed_early"
            ? "fixed-early"
            : null;

    if (calibrationOutcome && payload.failureMode && recordPlatformFeedback) {
      recordPlatformFeedback({
        actionId: dispatchId,
        predictionId: payload.predictionId,
        failureMode: payload.failureMode,
        outcome: calibrationOutcome,
        technicianFeedback: payload.notes || payload.actionTaken || "",
        fixWorked: payload.fixWorked !== false
      });
    }

    if (outcome === "false_alarm") {
      updateStatus(dispatchId, "false_alarm", { acknowledgedBy: payload.technicianId });
    } else if (outcome === "confirmed_failure" || outcome === "fixed_early") {
      updateStatus(dispatchId, "resolved", { acknowledgedBy: payload.technicianId });
    }

    return record;
  }

  return {
    getStates,
    getFeedback,
    findDispatchMeta,
    acknowledge,
    defer,
    resolve,
    falseAlarm,
    recordFeedback,
    OUTCOMES
  };
}

module.exports = { createDispatchWorkflow, OUTCOMES };
