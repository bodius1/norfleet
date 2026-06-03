const { describe, it } = require("node:test");
const assert = require("node:assert");
const H = require("../webappDispatchHelpers");

function sampleDispatch(overrides = {}) {
  return {
    dispatchId: "disp-F-001-R-002-bearing_wear",
    priority: "critical",
    robot: { robotId: "R-002", robotName: "Aisle Runner 12", zone: "B" },
    prediction: {
      failureMode: "bearing_wear",
      estimatedTimeToFailureHours: 0.08,
      alert: true
    },
    evidence: {
      signals: [
        { name: "vibrationRms", direction: "rising", reason: "above baseline", latest: 1.2 },
        { name: "bearingTempC", direction: "rising", reason: "temperature rising", latest: 48 }
      ]
    },
    workflow: { status: "new" },
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

describe("webapp dispatch helpers", () => {
  it("maps dispatch status chips to readable labels", () => {
    assert.equal(H.getDispatchStatusLabel("new"), "New");
    assert.equal(H.getDispatchStatusLabel("acknowledged"), "Acknowledged");
    assert.equal(H.getDispatchStatusLabel("deferred"), "Deferred");
    assert.equal(H.getDispatchStatusLabel("work_order_created"), "Work order open");
    assert.equal(H.getDispatchStatusLabel("resolved"), "Resolved");
    assert.equal(H.getDispatchStatusLabel("false_alarm"), "False alarm");
  });

  it("counts work_order_created dispatches in the active queue", () => {
    const report = {
      dispatches: [
        sampleDispatch({ workflow: { status: "new" } }),
        sampleDispatch({ dispatchId: "disp-2", workflow: { status: "work_order_created" } }),
        sampleDispatch({ dispatchId: "disp-3", workflow: { status: "resolved" } })
      ]
    };
    assert.equal(H.getActiveQueueCount(report), 2);
  });

  it("offers create work order only for new or acknowledged dispatches", () => {
    assert.equal(H.getDispatchPrimaryAction(sampleDispatch()).type, "create_work_order");
    assert.equal(
      H.getDispatchPrimaryAction(sampleDispatch({ workflow: { status: "acknowledged" } })).type,
      "create_work_order"
    );
    assert.equal(
      H.getDispatchPrimaryAction(
        sampleDispatch({ workflow: { status: "work_order_created", workOrderId: "WO-001" } })
      ).type,
      "work_order_open"
    );
    assert.equal(H.getDispatchPrimaryAction(sampleDispatch({ workflow: { status: "deferred" } })).type, "none");
  });

  it("shows work order open label when a work order exists", () => {
    const action = H.getDispatchPrimaryAction(
      sampleDispatch({ workflow: { status: "work_order_created", workOrderId: "WO-R-002-001" } })
    );
    assert.match(action.label, /Work order open: WO-R-002-001/);
    assert.equal(action.secondaryLabel, "Open work order");
  });

  it("buildEvidenceRows never emits undefined, null, or NaN", () => {
    const rows = H.buildEvidenceRows(
      sampleDispatch({
        evidence: {
          signals: [
            { name: "vibrationRms", direction: "rising", reason: "trend up", latest: null },
            { name: undefined, direction: null, reason: undefined, latest: NaN }
          ]
        }
      })
    );
    assert.equal(jsonHasBadValues(rows), false);
    assert.ok(rows.length >= 1);
  });

  it("returns SOP empty state when no refs exist", () => {
    const rows = H.buildSopRows(sampleDispatch(), {});
    assert.deepEqual(rows, []);
  });

  it("buildSnapshotSummary handles null snapshot safely", () => {
    assert.equal(H.buildSnapshotSummary(null), "Telemetry snapshot not available.");
    assert.equal(
      H.buildSnapshotSummary({
        healthIndex: 0.66,
        failureProbability: 0.08,
        failureMode: "bearing_wear"
      }),
      "At dispatch — HI 0.66 | Prob 8% | Mode bearing_wear"
    );
  });

  it("formats compact TTF without showing 0.0 hours for tiny values", () => {
    assert.equal(H.formatCompactTtf(0.05), "imminent");
    assert.equal(H.formatCompactTtf(null), "Not available");
  });

  it("gates demo tools for localhost-demo site ids", () => {
    assert.equal(H.shouldShowDemoTools({ siteId: "localhost-demo" }), true);
    assert.equal(H.shouldShowDemoTools("prod-site-001"), false);
  });

  it("builds trust copy without AI hype language", () => {
    const reason = H.formatTrustReason(sampleDispatch());
    assert.match(reason, /Predicted bearing wear/i);
    assert.doesNotMatch(reason, /\bAI\b/i);
  });

  it("uses the empty queue copy for technicians", () => {
    assert.match(H.getEmptyQueueCopy(), /No actionable robot failures/i);
  });

  it("indexes work orders by dispatch id", () => {
    const lookup = H.indexWorkOrdersByDispatch([
      { workOrderId: "WO-1", dispatchId: "disp-a" },
      { workOrderId: "WO-2", dispatchId: "disp-b" }
    ]);
    assert.equal(lookup["disp-a"].workOrderId, "WO-1");
    assert.equal(lookup["disp-b"].workOrderId, "WO-2");
    assert.deepEqual(H.indexWorkOrdersByDispatch(null), {});
  });

  it("sanitizes bad display values", () => {
    assert.equal(H.sanitizeDisplayValue(undefined), "Not available");
    assert.equal(H.sanitizeDisplayValue(NaN), "Not available");
    assert.equal(H.sanitizeDisplayValue("[object Object]"), "Not available");
  });
});
