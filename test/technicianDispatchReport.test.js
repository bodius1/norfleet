const { describe, it } = require("node:test");
const assert = require("node:assert");
const { formatHours, formatTimeToFailureWithin } = require("../utils/dispatchFormat");
const {
  buildTechnicianDispatchReport,
  computePriority,
  sortDispatches,
  isActionablePrediction
} = require("../services/technicianDispatchReport");

function samplePrediction(overrides = {}) {
  return {
    id: "P-002",
    robotId: "R-002",
    robotName: "Aisle Runner 12",
    failureMode: "bearing_wear",
    failureProbability: 0.75,
    estimatedTimeToFailureHours: 5.2,
    confidence: 0.72,
    healthIndex: 0.8,
    alert: true,
    insufficientData: false,
    reason: "health index declining",
    contributingSignals: [
      { signal: "vibrationRms", latest: 1.2, slope: 0.01, delta: 0.5, direction: "rising", reason: "vibration above baseline" },
      { signal: "bearingTempC", latest: 48, slope: 0.02, delta: 4, direction: "rising", reason: "bearing temperature rising" }
    ],
    ...overrides
  };
}

function stablePrediction(robotId, overrides = {}) {
  return {
    id: `P-${robotId}`,
    robotId,
    failureMode: "battery_degradation",
    failureProbability: 0.08,
    estimatedTimeToFailureHours: null,
    confidence: 0.15,
    healthIndex: 0.95,
    alert: false,
    insufficientData: false,
    reason: "health trend stable",
    ...overrides
  };
}

function jsonHasBadValues(obj) {
  const walk = (v) => {
    if (v === null || v === undefined) return true;
    if (typeof v === "number" && !Number.isFinite(v)) return true;
    if (typeof v === "string" && (v === "NaN" || v === "undefined" || v === "[object Object]")) return true;
    if (Array.isArray(v)) return v.some(walk);
    if (typeof v === "object") return Object.values(v).some(walk);
    return false;
  };
  return walk(obj);
}

describe("technician dispatch report", () => {
  it("builds dispatches from actionable predictions only", () => {
    const report = buildTechnicianDispatchReport({
      predictions: [
        samplePrediction(),
        samplePrediction({
          robotId: "R-003",
          id: "P-3",
          alert: false,
          estimatedTimeToFailureHours: 40,
          failureProbability: 0.45
        })
      ],
      robots: [
        { id: "R-002", name: "Aisle Runner 12", model: "LocusBot", warehouseZone: "B", status: "active" },
        { id: "R-003", name: "Sort Cell 3", model: "Chuck", warehouseZone: "C", status: "idle" }
      ]
    });
    assert.equal(report.dispatches.length, 1);
    assert.equal(report.dispatches[0].actionType, "technician_dispatch");
    assert.equal(report.dispatches[0].robot.robotId, "R-002");
  });

  it("sorts critical/high before medium/low", () => {
    const critical = { dispatchId: "a", priority: "critical", prediction: { estimatedTimeToFailureHours: 4, confidence: 0.8, failureProbability: 0.9 } };
    const medium = { dispatchId: "b", priority: "medium", prediction: { estimatedTimeToFailureHours: 30, confidence: 0.5, failureProbability: 0.45 } };
    const high = { dispatchId: "c", priority: "high", prediction: { estimatedTimeToFailureHours: 10, confidence: 0.7, failureProbability: 0.7 } };
    const low = { dispatchId: "d", priority: "low", prediction: { estimatedTimeToFailureHours: 100, confidence: 0.3, failureProbability: 0.2 } };
    const sorted = [medium, low, high, critical].sort(sortDispatches);
    assert.equal(sorted[0].priority, "critical");
    assert.equal(sorted[1].priority, "high");
  });

  it("creates bearing_wear technician dispatch for R-002", () => {
    const report = buildTechnicianDispatchReport({
      predictions: [samplePrediction()],
      robots: [{ id: "R-002", name: "Aisle Runner 12", model: "LocusBot", warehouseZone: "B", status: "active" }]
    });
    const d = report.dispatches.find((x) => x.robot.robotId === "R-002");
    assert.ok(d);
    assert.equal(d.prediction.failureMode, "bearing_wear");
    assert.equal(d.actionType, "technician_dispatch");
    assert.ok(d.recommendedAction.steps.length >= 3);
    assert.equal(computePriority(samplePrediction()), "critical");
  });

  it("does not leak undefined/null/NaN into JSON fields", () => {
    const report = buildTechnicianDispatchReport({
      predictions: [samplePrediction({ estimatedTimeToFailureHours: NaN, confidence: undefined })],
      robots: [{ id: "R-002", name: "Aisle Runner 12", model: "LocusBot", warehouseZone: "B", status: "active" }]
    });
    assert.equal(report.dispatches.length, 0);
    assert.equal(jsonHasBadValues(report), false);
    const str = JSON.stringify(report);
    assert.ok(!str.includes("undefined"));
    assert.ok(!str.includes("NaN"));
  });

  it("keeps adminUpdates separate from dispatches", () => {
    const report = buildTechnicianDispatchReport({
      predictions: [samplePrediction()],
      robots: [{ id: "R-002", name: "Aisle Runner 12", model: "LocusBot", warehouseZone: "B", status: "active" }],
      agents: [{ id: "root-cause", name: "Root Cause", encounteredFailures: "3 correlated fault signatures" }]
    });
    assert.ok(report.dispatches.every((d) => d.actionType === "technician_dispatch"));
    assert.ok(report.adminUpdates.every((u) => u.actionType === "automation_update"));
    assert.ok(report.adminUpdates.length >= 1);
  });

  it("returns graceful emptyState when no actionable predictions", () => {
    const report = buildTechnicianDispatchReport({
      predictions: [{ robotId: "R-001", insufficientData: true, failureProbability: 0.05, alert: false }],
      robots: []
    });
    assert.equal(report.dispatches.length, 0);
    assert.ok(report.emptyState);
    assert.equal(report.summary.technicianDispatchCount, 0);
  });

  it("alert:false with TTF:null does not create dispatch", () => {
    const pred = stablePrediction("R-001");
    assert.equal(isActionablePrediction(pred), false);
    const report = buildTechnicianDispatchReport({
      predictions: [pred],
      robots: [{ id: "R-001", name: "Induction Alpha", model: "Stretch", warehouseZone: "A", status: "active" }]
    });
    assert.equal(report.dispatches.length, 0);
  });

  it("health trend stable does not create dispatch", () => {
    const pred = stablePrediction("R-003", {
      alert: true,
      estimatedTimeToFailureHours: 12,
      failureProbability: 0.5,
      confidence: 0.4,
      reason: "health trend stable"
    });
    assert.equal(isActionablePrediction(pred), false);
    const report = buildTechnicianDispatchReport({
      predictions: [pred],
      robots: [{ id: "R-003", name: "Sort Cell 3", model: "Chuck", warehouseZone: "C", status: "idle" }]
    });
    assert.equal(report.dispatches.length, 0);
  });

  it("TTF:null does not become 0 in report JSON", () => {
    const report = buildTechnicianDispatchReport({
      predictions: [
        samplePrediction(),
        stablePrediction("R-001")
      ],
      robots: [
        { id: "R-002", name: "Aisle Runner 12", model: "LocusBot", warehouseZone: "B", status: "active" },
        { id: "R-001", name: "Induction Alpha", model: "Stretch", warehouseZone: "A", status: "active" }
      ]
    });
    const str = JSON.stringify(report);
    assert.ok(!str.includes('"estimatedTimeToFailureHours":0'));
    assert.ok(!str.includes("0.0 hours"));
    report.dispatches.forEach((d) => {
      assert.ok(d.prediction.estimatedTimeToFailureHours > 0);
    });
  });

  it("only R-002 actionable bearing_wear appears when other robots are stable", () => {
    const report = buildTechnicianDispatchReport({
      predictions: [
        stablePrediction("R-001"),
        samplePrediction(),
        stablePrediction("R-003"),
        stablePrediction("R-004", { failureMode: "motor_creep" })
      ],
      robots: [
        { id: "R-001", name: "Induction Alpha", model: "Stretch", warehouseZone: "A", status: "active" },
        { id: "R-002", name: "Aisle Runner 12", model: "LocusBot", warehouseZone: "B", status: "active" },
        { id: "R-003", name: "Sort Cell 3", model: "Chuck", warehouseZone: "C", status: "idle" },
        { id: "R-004", name: "Pack Line 7", model: "Cart", warehouseZone: "D", status: "active" }
      ]
    });
    assert.equal(report.dispatches.length, 1);
    assert.equal(report.dispatches[0].robot.robotId, "R-002");
    assert.equal(report.dispatches[0].prediction.failureMode, "bearing_wear");
    assert.equal(report.modelInfo.monitoringCount, 3);
  });

  it("summary.technicianDispatchCount equals dispatches.length", () => {
    const report = buildTechnicianDispatchReport({
      predictions: [samplePrediction(), stablePrediction("R-001"), stablePrediction("R-003")],
      robots: [
        { id: "R-002", name: "Aisle Runner 12", model: "LocusBot", warehouseZone: "B", status: "active" },
        { id: "R-001", name: "Induction Alpha", model: "Stretch", warehouseZone: "A", status: "active" },
        { id: "R-003", name: "Sort Cell 3", model: "Chuck", warehouseZone: "C", status: "idle" }
      ]
    });
    assert.equal(report.summary.technicianDispatchCount, report.dispatches.length);
  });

  it("earliestFailureRobotId ignores stable and null-TTF robots", () => {
    const report = buildTechnicianDispatchReport({
      predictions: [
        stablePrediction("R-001"),
        samplePrediction({ estimatedTimeToFailureHours: 6.5 }),
        stablePrediction("R-003"),
        stablePrediction("R-004")
      ],
      robots: [
        { id: "R-001", name: "Induction Alpha", model: "Stretch", warehouseZone: "A", status: "active" },
        { id: "R-002", name: "Aisle Runner 12", model: "LocusBot", warehouseZone: "B", status: "active" },
        { id: "R-003", name: "Sort Cell 3", model: "Chuck", warehouseZone: "C", status: "idle" },
        { id: "R-004", name: "Pack Line 7", model: "Cart", warehouseZone: "D", status: "active" }
      ]
    });
    assert.equal(report.summary.earliestFailureRobotId, "R-002");
    assert.equal(report.summary.earliestFailureHours, 6.5);
  });

  it("tiny positive TTF does not render as 0.0 hours in operationalImpact", () => {
    const report = buildTechnicianDispatchReport({
      predictions: [samplePrediction({ estimatedTimeToFailureHours: 0.02 })],
      robots: [{ id: "R-002", name: "Aisle Runner 12", model: "LocusBot", warehouseZone: "B", status: "active" }]
    });
    assert.equal(report.dispatches.length, 1);
    assert.equal(report.dispatches[0].prediction.estimatedTimeToFailureHours, 0.02);
    const summary = report.dispatches[0].operationalImpact.summary;
    assert.ok(!summary.includes("0.0 hours"));
    assert.ok(summary.includes("within ~1 minute"));
  });

  it("tiny positive TTF uses minute phrasing between 0.1h and 1h", () => {
    assert.equal(formatTimeToFailureWithin(0.2), "within ~12 minutes");
    assert.equal(formatHours(0.2), "~12 min");
  });

  it("null TTF stays Not available and does not create dispatch", () => {
    assert.equal(formatHours(null), "Not available");
    assert.equal(formatTimeToFailureWithin(null), null);
    const report = buildTechnicianDispatchReport({
      predictions: [stablePrediction("R-001")],
      robots: [{ id: "R-001", name: "Induction Alpha", model: "Stretch", warehouseZone: "A", status: "active" }]
    });
    assert.equal(report.dispatches.length, 0);
  });
});
