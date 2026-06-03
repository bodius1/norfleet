const { describe, it } = require("node:test");
const assert = require("node:assert");

globalThis.escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

globalThis.state = {
  dispatchUi: {
    syncStatus: "idle",
    lastRefresh: "2026-05-22T12:00:00.000Z",
    cardMessages: {},
    cardErrors: {},
    resolveMessages: {},
    resolveErrors: {},
    expandedResolveId: null
  },
  workOrders: []
};

globalThis.DispatchUI = require("../webappDispatchHelpers");
const { renderDispatchCard, renderWorkOrderCard } = require("../webappDispatch.js");

function sampleDispatch(overrides = {}) {
  return {
    dispatchId: "disp-F-001-R-002-bearing_wear",
    priority: "critical",
    robot: { robotId: "R-002", robotName: "Aisle Runner 12", zone: "B" },
    prediction: {
      failureMode: "bearing_wear",
      estimatedTimeToFailureHours: 5.2,
      alert: true
    },
    evidence: {
      signals: [{ name: "vibrationRms", direction: "rising", reason: "above baseline", latest: 1.2 }]
    },
    workflow: { status: "new" },
    ...overrides
  };
}

describe("webapp dispatch render", () => {
  it("renders create work order CTA for new dispatches", () => {
    const html = renderDispatchCard(sampleDispatch(), {});
    assert.match(html, /Create work order/);
    assert.match(html, /data-create-wo="disp-F-001-R-002-bearing_wear"/);
    assert.doesNotMatch(html, /\bundefined\b/);
    assert.doesNotMatch(html, /\bNaN\b/);
  });

  it("does not render create button for deferred dispatches", () => {
    const html = renderDispatchCard(sampleDispatch({ workflow: { status: "deferred" } }), {});
    assert.doesNotMatch(html, /data-create-wo=/);
  });

  it("renders work order open state when workflow is work_order_created", () => {
    const html = renderDispatchCard(
      sampleDispatch({ workflow: { status: "work_order_created", workOrderId: "WO-R-002-001" } }),
      {}
    );
    assert.match(html, /Work order open: WO-R-002-001/);
    assert.match(html, /Open work order/);
    assert.match(html, /data-open-wo="WO-R-002-001"/);
  });

  it("includes evidence and SOP drawers collapsed by default", () => {
    const html = renderDispatchCard(sampleDispatch(), {});
    assert.match(html, /<details class="td-drawer">\s*<summary>Evidence<\/summary>/);
    assert.match(html, /<details class="td-drawer">\s*<summary>SOP references<\/summary>/);
  });

  it("renders work order cards with snapshot summary and resolve action", () => {
    const html = renderWorkOrderCard({
      workOrderId: "WO-R-002-001",
      robotName: "Aisle Runner 12",
      zone: "B",
      failureMode: "bearing_wear",
      status: "open",
      createdAt: "2026-05-22T11:00:00.000Z",
      beforeSnapshot: { healthIndex: 0.66, failureProbability: 0.08, failureMode: "bearing_wear" },
      recommendedSteps: ["Inspect bearing housing", "Replace bearing if worn"]
    });
    assert.match(html, /At dispatch — HI 0\.66 \| Prob 8% \| Mode bearing_wear/);
    assert.match(html, /Resolve work order/);
    assert.doesNotMatch(html, /\bnull\b/i);
  });

  it("degrades safely when DispatchUI helpers are missing", () => {
    const { createSafeDispatchUiHelpers } = require("../webappDispatch.js");
    const safeH = createSafeDispatchUiHelpers(null);
    assert.equal(typeof safeH.indexWorkOrdersByDispatch, "function");
    assert.equal(typeof safeH.getActiveQueueCount, "function");
    assert.equal(safeH.getActiveQueueCount({ dispatches: [{ workflow: { status: "new" } }] }), 0);
    assert.deepEqual(safeH.indexWorkOrdersByDispatch([{ dispatchId: "d1", workOrderId: "WO-1" }]), {
      d1: { dispatchId: "d1", workOrderId: "WO-1" }
    });
    assert.match(safeH.getEmptyQueueCopy(), /No actionable robot failures/i);
  });
});
