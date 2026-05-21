const test = require("node:test");
const assert = require("node:assert/strict");
const { detectKpiAnomalies } = require("../anomalyDetector");

test("detectKpiAnomalies flags threshold breaches deterministically", () => {
  const history = {
    "Pick Accuracy": [97, 97.2, 96.8, 96.5, 95.9, 90.4],
    "Travel Time": [5.2, 5.4, 5.3, 5.5, 5.6, 7.2]
  };
  const thresholds = {
    "Pick Accuracy": { min: 92, maxDeltaPct: 8 },
    "Travel Time": { max: 6.5, maxDeltaPct: 10 }
  };
  const out = detectKpiAnomalies(history, thresholds);
  assert.equal(out.length, 2);
  assert.equal(out[0].kpi, "Pick Accuracy");
  assert.equal(out[1].kpi, "Travel Time");
});

test("detectKpiAnomalies accepts adapter-shaped telemetry", () => {
  const telemetry = {
    fleetId: "F-001",
    kpiHistory: {
      Uptime: [95, 95.2, 95.1, 94.9, 94.8, 80]
    }
  };
  const out = detectKpiAnomalies(telemetry, { Uptime: { min: 92, maxDeltaPct: 5 } });
  assert.equal(out.length, 1);
  assert.equal(out[0].kpi, "Uptime");
});
