const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createJsonRepository } = require("../store/persistence");
const { createDispatchWorkflow } = require("../services/dispatchWorkflow");
const { createDispatchRegistry } = require("../services/dispatchRegistry");
const { buildTechnicianDispatchReport } = require("../services/technicianDispatchReport");
const { createWorkOrderService, captureSnapshot, assessSnapshotOutcome } = require("../services/workOrders");
const { cloneCalibration, DEFAULT_CALIBRATION, applyOutcome } = require("../predictor/calibration");

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

const STABLE_DISPATCH_ID = "disp-R-002-bearing_wear";

function samplePrediction(overrides = {}) {
  return {
    id: "P-10",
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
      { signal: "vibrationRms", latest: 1.2, slope: 0.01, direction: "rising", reason: "vibration above baseline" }
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

function buildReport(repo, dispatchWorkflow, predictions, predictionId = "P-10") {
  const registry = createDispatchRegistry(repo);
  const preds = predictions || [samplePrediction({ id: predictionId })];
  const report = buildTechnicianDispatchReport({
    predictions: preds,
    robots: [{ id: "R-002", name: "Aisle Runner 12", model: "LocusBot", warehouseZone: "B", status: "active" }],
    dispatchStates: dispatchWorkflow.getStates(),
    fleetId: "fleet-default"
  });
  return registry.enrichReportDispatches(report, () => samplePrediction({ id: predictionId }));
}

function isolatedCtx() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "norfleet-wo-"));
  const jsonPath = path.join(dir, "norfleet.json");
  const repo = createJsonRepository({ jsonPath });
  const dispatchWorkflow = createDispatchWorkflow(repo);
  const registry = createDispatchRegistry(repo);
  let cal = cloneCalibration(DEFAULT_CALIBRATION);
  let livePrediction = samplePrediction();
  let currentPredictionId = "P-10";

  function buildFreshReport() {
    return buildReport(repo, dispatchWorkflow, [livePrediction], currentPredictionId);
  }

  const workOrders = createWorkOrderService(repo, {
    getDispatchById: (dispatchId) => {
      const persisted = registry.get(dispatchId);
      if (persisted && registry.canCreateWorkOrder(persisted)) {
        return registry.refreshPredictionFields(persisted, livePrediction);
      }
      return registry.resolveForWorkOrder(dispatchId, buildFreshReport);
    },
    getLivePredictionForRobot: () => livePrediction,
    markDispatchWorkOrderCreated: (dispatchId, payload) => {
      dispatchWorkflow.markWorkOrderCreated(dispatchId, payload);
      const dispatch = registry.get(dispatchId);
      if (dispatch) {
        registry.upsert({
          ...dispatch,
          workflow: {
            ...dispatch.workflow,
            status: "work_order_created",
            workOrderId: payload.workOrderId,
            lastUpdatedAt: new Date().toISOString()
          }
        });
      }
    },
    recordDispatchFeedback: (dispatchId, payload) =>
      dispatchWorkflow.recordFeedback(dispatchId, payload, (fb) => {
        cal = applyOutcome(cal, fb.failureMode, fb.outcome);
        repo.addFeedback(fb);
      })
  });

  return {
    dir,
    jsonPath,
    repo,
    dispatchWorkflow,
    registry,
    workOrders,
    setLivePrediction: (p) => { livePrediction = p; },
    setPredictionId: (id) => { currentPredictionId = id; },
    buildFreshReport,
    getCal: () => cal
  };
}

describe("work orders", () => {
  let ctx = null;

  beforeEach(() => {
    ctx = isolatedCtx();
  });

  afterEach(() => {
    if (ctx?.dir && fs.existsSync(ctx.dir)) fs.rmSync(ctx.dir, { recursive: true, force: true });
    ctx = null;
  });

  it("work order can be created from dispatch ID returned by report", () => {
    const report = ctx.buildFreshReport();
    assert.equal(report.dispatches.length, 1);
    const dispatchId = report.dispatches[0].dispatchId;
    assert.equal(dispatchId, STABLE_DISPATCH_ID);
    assert.ok(!dispatchId.includes("P-"));

    const created = ctx.workOrders.createWorkOrderFromDispatch(dispatchId, { technicianId: "tech-1" });
    assert.equal(created.reusedExisting, false);
    assert.ok(created.workOrder.workOrderId.startsWith("WO-"));
    assert.equal(created.workOrder.dispatchId, STABLE_DISPATCH_ID);
    assert.equal(jsonHasBadValues(created.workOrder), false);
  });

  it("dispatch ID is stable across report regeneration when predictionId changes", () => {
    const report1 = ctx.buildFreshReport();
    ctx.setPredictionId("P-99");
    ctx.setLivePrediction(samplePrediction({ id: "P-99", estimatedTimeToFailureHours: 4.8 }));
    const report2 = ctx.buildFreshReport();
    assert.equal(report1.dispatches[0].dispatchId, STABLE_DISPATCH_ID);
    assert.equal(report2.dispatches[0].dispatchId, STABLE_DISPATCH_ID);
    assert.notEqual(report1.dispatches[0].prediction.predictionId, report2.dispatches[0].prediction.predictionId);
  });

  it("work-order creation succeeds after report regeneration", () => {
    const report = ctx.buildFreshReport();
    const dispatchId = report.dispatches[0].dispatchId;
    ctx.setPredictionId("P-55");
    ctx.setLivePrediction(samplePrediction({ id: "P-55", estimatedTimeToFailureHours: 0.01 }));
    const created = ctx.workOrders.createWorkOrderFromDispatch(dispatchId);
    assert.equal(created.reusedExisting, false);
    assert.equal(created.workOrder.dispatchId, STABLE_DISPATCH_ID);
  });

  it("creates work order from dispatch with beforeSnapshot", () => {
    const report = ctx.buildFreshReport();
    const { workOrder, reusedExisting } = ctx.workOrders.createWorkOrderFromDispatch(report.dispatches[0].dispatchId, {
      technicianId: "tech-1"
    });
    assert.equal(reusedExisting, false);
    assert.ok(workOrder.beforeSnapshot);
    assert.equal(workOrder.beforeSnapshot.healthIndex, 0.8);
    assert.equal(workOrder.beforeSnapshot.estimatedTimeToFailureHours, 5.2);
  });

  it("duplicate POST returns existing work order with reusedExisting true", () => {
    const report = ctx.buildFreshReport();
    const dispatchId = report.dispatches[0].dispatchId;
    const first = ctx.workOrders.createWorkOrderFromDispatch(dispatchId);
    ctx.setPredictionId("P-77");
    const second = ctx.workOrders.createWorkOrderFromDispatch(dispatchId);
    assert.equal(first.reusedExisting, false);
    assert.equal(second.reusedExisting, true);
    assert.equal(second.workOrder.workOrderId, first.workOrder.workOrderId);
    assert.equal(ctx.workOrders.listWorkOrders().length, 1);
  });

  it("marks dispatch status work_order_created and persists workflow.workOrderId in report", () => {
    const report = ctx.buildFreshReport();
    const dispatchId = report.dispatches[0].dispatchId;
    const { workOrder } = ctx.workOrders.createWorkOrderFromDispatch(dispatchId);
    const state = ctx.dispatchWorkflow.getStates()[dispatchId];
    assert.equal(state.status, "work_order_created");
    assert.equal(state.workOrderId, workOrder.workOrderId);

    const report2 = ctx.buildFreshReport();
    const dispatch = report2.dispatches.find((d) => d.dispatchId === dispatchId);
    assert.ok(dispatch);
    assert.equal(dispatch.workflow.workOrderId, workOrder.workOrderId);
  });

  it("persists work orders across repository reload", () => {
    const report = ctx.buildFreshReport();
    ctx.workOrders.createWorkOrderFromDispatch(report.dispatches[0].dispatchId);
    const reloaded = createJsonRepository({ jsonPath: ctx.jsonPath });
    assert.equal(reloaded.getWorkOrders().length, 1);
    assert.equal(Object.keys(reloaded.getActiveDispatches()).length, 1);
  });

  it("updates status and writes audit trail", () => {
    const report = ctx.buildFreshReport();
    const { workOrder } = ctx.workOrders.createWorkOrderFromDispatch(report.dispatches[0].dispatchId);
    const updated = ctx.workOrders.updateWorkOrderStatus(workOrder.workOrderId, {
      status: "in_progress",
      assignedTechnicianId: "tech-42"
    });
    assert.equal(updated.status, "in_progress");
    assert.ok(ctx.repo.getWorkOrderAudit().length >= 2);
  });

  it("resolve stores afterSnapshot and monitoring note when telemetry unchanged", () => {
    const report = ctx.buildFreshReport();
    const { workOrder } = ctx.workOrders.createWorkOrderFromDispatch(report.dispatches[0].dispatchId);
    const result = ctx.workOrders.resolveWorkOrder(workOrder.workOrderId, {
      outcome: "confirmed_failure",
      actionTaken: "Replaced bearing",
      repairMinutes: 45
    });
    assert.ok(result.afterSnapshot);
    assert.equal(result.outcomeAssessment.monitoringStillNeeded, true);
    assert.equal(jsonHasBadValues(result.workOrder), false);
  });

  it("false_alarm resolve routes through feedback and calibration path", () => {
    const report = ctx.buildFreshReport();
    const { workOrder } = ctx.workOrders.createWorkOrderFromDispatch(report.dispatches[0].dispatchId);
    const beforeCal = ctx.getCal().bearing_wear.minProbability;
    ctx.workOrders.resolveWorkOrder(workOrder.workOrderId, { outcome: "false_alarm", notes: "No wear found" });
    assert.ok(ctx.getCal().bearing_wear.minProbability > beforeCal);
  });

  it("stable robots still do not create dispatches", () => {
    const report = buildTechnicianDispatchReport({
      predictions: [stablePrediction("R-001"), stablePrediction("R-003")],
      robots: [
        { id: "R-001", name: "Induction Alpha", model: "Stretch", warehouseZone: "A", status: "active" },
        { id: "R-003", name: "Sort Cell 3", model: "Chuck", warehouseZone: "C", status: "idle" }
      ]
    });
    assert.equal(report.dispatches.length, 0);
  });

  it("resolved dispatches are not shown as new active dispatches", () => {
    const report = ctx.buildFreshReport();
    const dispatchId = report.dispatches[0].dispatchId;
    ctx.dispatchWorkflow.resolve(dispatchId, { workOrderId: "WO-closed" });
    ctx.registry.upsert({
      ...report.dispatches[0],
      workflow: { status: "resolved", workOrderId: "WO-closed", lastUpdatedAt: new Date().toISOString() }
    });
    const report2 = ctx.buildFreshReport();
    assert.equal(report2.dispatches.find((d) => d.dispatchId === dispatchId), undefined);
  });

  it("captureSnapshot omits null TTF instead of coercing to zero", () => {
    const snap = captureSnapshot(
      { failureMode: "battery_degradation", failureProbability: 0.08, confidence: 0.15, healthIndex: 0.95, estimatedTimeToFailureHours: null },
      []
    );
    assert.equal(snap.estimatedTimeToFailureHours, undefined);
  });

  it("assessSnapshotOutcome does not fake improvement", () => {
    const assessment = assessSnapshotOutcome(
      { healthIndex: 0.8, failureProbability: 0.75 },
      { healthIndex: 0.79, failureProbability: 0.74 }
    );
    assert.equal(assessment.monitoringStillNeeded, true);
  });

  it("rejects work order creation for missing dispatch", () => {
    assert.throws(() => ctx.workOrders.createWorkOrderFromDispatch("disp-missing"), /not found/i);
  });
});
