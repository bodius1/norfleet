"use strict";

function computeSeverity(pred, calibration) {
  const mode = pred.failureMode || "bearing_wear";
  const cal = (calibration || {})[mode] || {};
  const minConf = cal.minConfidence ?? 0.35;
  const ttf = pred.estimatedTimeToFailureHours;
  if (ttf == null || !Number.isFinite(ttf)) return "Low";
  const conf = pred.confidence ?? 0;
  if (ttf <= 8 && conf >= minConf) return "Critical";
  if (ttf <= 24) return "High";
  if (ttf <= 48) return "Medium";
  return "Low";
}

function createAlertEngine(repo) {
  function hasOpenAlert(robotId, failureMode) {
    const open = repo.getAlertEvents({ robotId, failureMode, status: "open" });
    if (open.length > 0) return true;
    const acked = repo.getAlertEvents({ robotId, failureMode, status: "acknowledged" });
    return acked.length > 0;
  }

  function fire(pred, calibration) {
    if (!pred || !pred.robotId || !pred.failureMode) return null;
    if (hasOpenAlert(pred.robotId, pred.failureMode)) return null;
    const severity = computeSeverity(pred, calibration);
    const row = {
      kpi: "prediction_alert",
      latest: pred.failureProbability ?? 0,
      baseline: 0,
      deltaPct: 0,
      severity,
      createdAt: new Date().toISOString(),
      robotId: pred.robotId,
      failureMode: pred.failureMode,
      predictionId: pred.id || null,
      status: "open",
      ttfHours: pred.estimatedTimeToFailureHours ?? null,
      probability: pred.failureProbability ?? null,
      confidence: pred.confidence ?? null
    };
    return repo.addAlertEvent(row);
  }

  function acknowledge(id, acknowledgedBy) {
    repo.updateAlertEvent(id, {
      status: "acknowledged",
      acknowledgedBy: acknowledgedBy || null,
      acknowledgedAt: new Date().toISOString()
    });
  }

  function resolve(id) {
    repo.updateAlertEvent(id, {
      status: "resolved",
      resolvedAt: new Date().toISOString()
    });
  }

  function list(filter) {
    return repo.getAlertEvents(filter || {});
  }

  return { fire, acknowledge, resolve, list, computeSeverity };
}

module.exports = { createAlertEngine, computeSeverity };
