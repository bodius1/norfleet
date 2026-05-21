function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function validateAnalyzeKpisInput(body) {
  const b = body || {};
  if (!isObject(b.kpiHistory)) return { ok: false, error: "kpiHistory object is required" };
  if (b.robots !== undefined && !Array.isArray(b.robots)) return { ok: false, error: "robots must be an array" };
  return { ok: true };
}

function validateTechnicianReportInput(body) {
  const b = body || {};
  if (b.anomalies !== undefined && !Array.isArray(b.anomalies)) return { ok: false, error: "anomalies must be an array" };
  if (b.activeAgents !== undefined && !Array.isArray(b.activeAgents)) return { ok: false, error: "activeAgents must be an array" };
  return { ok: true };
}

function validateRecommendUpdatesInput(body) {
  const b = body || {};
  if (b.kpiAnomalies !== undefined && !Array.isArray(b.kpiAnomalies)) return { ok: false, error: "kpiAnomalies must be an array" };
  return { ok: true };
}

function validateRootCauseInput(body) {
  const b = body || {};
  if (!b.robotId || typeof b.robotId !== "string") return { ok: false, error: "robotId is required" };
  if (!isObject(b.kpiAnomaly)) return { ok: false, error: "kpiAnomaly object is required" };
  return { ok: true };
}

function validateFeedbackInput(body) {
  const b = body || {};
  if (!b.actionId) return { ok: false, error: "actionId is required" };
  if (typeof b.fixWorked !== "boolean") return { ok: false, error: "fixWorked must be boolean" };
  return { ok: true };
}

module.exports = {
  validateAnalyzeKpisInput,
  validateTechnicianReportInput,
  validateRecommendUpdatesInput,
  validateRootCauseInput,
  validateFeedbackInput
};
