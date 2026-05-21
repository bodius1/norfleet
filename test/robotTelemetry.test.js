const test = require("node:test");
const assert = require("node:assert/strict");
const { detectKpiAnomaliesForFleet } = require("../anomalyDetector");
const { createMockTelemetryAdapter } = require("../adapters/robotTelemetry");

test("mockTelemetryAdapter supplies fleet history for anomaly detection", () => {
  const store = {
    findFleet: (id) => (id === "F-001" ? { id: "F-001", robotIds: ["R-001"], kpis: ["Uptime"] } : null),
    getRobots: () => [{ id: "R-001", status: "active" }],
    getFleetHistory: () => ({
      Uptime: [95, 95.2, 95.1, 94.9, 94.8, 80]
    })
  };
  const adapter = createMockTelemetryAdapter(store);
  const telemetry = adapter.fetchTelemetry("F-001");
  assert.equal(telemetry.fleetId, "F-001");
  assert.ok(Array.isArray(telemetry.robots));

  const anomalies = detectKpiAnomaliesForFleet("F-001", { Uptime: { min: 92, maxDeltaPct: 5 } }, adapter);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].kpi, "Uptime");
});
