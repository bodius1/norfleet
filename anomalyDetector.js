/**
 * Pure KPI anomaly analysis. No I/O, no tool calls.
 * Telemetry may be a plain kpiHistory map or { kpiHistory } from a telemetry adapter.
 */

function detectKpiAnomalies(telemetryOrHistory = {}, thresholds = {}) {
  const kpiHistory = telemetryOrHistory?.kpiHistory ?? telemetryOrHistory ?? {};
  const out = [];
  Object.entries(kpiHistory).forEach(([kpi, series]) => {
    if (!Array.isArray(series) || series.length < 5) return;
    const latest = Number(series[series.length - 1]);
    const prev = series.slice(-6, -1);
    const mean = prev.reduce((a, b) => a + Number(b), 0) / prev.length;
    const deltaPct = mean ? ((latest - mean) / mean) * 100 : 0;
    const t = thresholds[kpi] || {};

    const lowBreach = typeof t.min === "number" && latest < t.min;
    const highBreach = typeof t.max === "number" && latest > t.max;
    const spike = Math.abs(deltaPct) > (t.maxDeltaPct ?? 12);
    if (!lowBreach && !highBreach && !spike) return;

    out.push({
      kpi,
      latest: Number(latest.toFixed(2)),
      baseline: Number(mean.toFixed(2)),
      deltaPct: Number(deltaPct.toFixed(2)),
      severity: Math.abs(deltaPct) > 20 ? "High" : Math.abs(deltaPct) > 12 ? "Medium" : "Low"
    });
  });
  return out;
}

function detectKpiAnomaliesForFleet(fleetId, thresholds, telemetryAdapter) {
  const telemetry = telemetryAdapter.fetchTelemetry(fleetId);
  return detectKpiAnomalies(telemetry, thresholds);
}

module.exports = {
  detectKpiAnomalies,
  detectKpiAnomaliesForFleet
};
