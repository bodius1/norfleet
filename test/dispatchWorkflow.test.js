const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createJsonRepository } = require("../store/persistence");
const { createDispatchWorkflow } = require("../services/dispatchWorkflow");
const { applyOutcome, DEFAULT_CALIBRATION, cloneCalibration } = require("../predictor/calibration");

function isolatedRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "norfleet-dispatch-"));
  const jsonPath = path.join(dir, "norfleet.json");
  return { repo: createJsonRepository({ jsonPath }), dir, jsonPath };
}

describe("dispatch workflow", () => {
  let ctx = null;

  beforeEach(() => {
    ctx = isolatedRepo();
  });

  afterEach(() => {
    if (ctx?.dir && fs.existsSync(ctx.dir)) fs.rmSync(ctx.dir, { recursive: true, force: true });
    ctx = null;
  });

  it("acknowledge changes status", () => {
    const wf = createDispatchWorkflow(ctx.repo);
    const state = wf.acknowledge("disp-R-002-P-1", { technicianId: "tech-1" });
    assert.equal(state.status, "acknowledged");
    assert.equal(wf.getStates()["disp-R-002-P-1"].status, "acknowledged");
  });

  it("defer changes status", () => {
    const wf = createDispatchWorkflow(ctx.repo);
    const state = wf.defer("disp-R-002-P-1", { reason: "Next shift" });
    assert.equal(state.status, "deferred");
  });

  it("resolve persists workflow state", () => {
    const wf = createDispatchWorkflow(ctx.repo);
    wf.resolve("disp-R-002-P-1", { workOrderId: "WO-99" });
    const reloaded = createJsonRepository({ jsonPath: ctx.jsonPath });
    const wf2 = createDispatchWorkflow(reloaded);
    assert.equal(wf2.getStates()["disp-R-002-P-1"].status, "resolved");
    assert.equal(wf2.getStates()["disp-R-002-P-1"].workOrderId, "WO-99");
  });

  it("false alarm persists feedback and triggers calibration hook", () => {
    const wf = createDispatchWorkflow(ctx.repo);
    let cal = cloneCalibration(DEFAULT_CALIBRATION);
    const record = wf.recordFeedback(
      "disp-R-002-P-1",
      {
        outcome: "false_alarm",
        robotId: "R-002",
        failureMode: "bearing_wear",
        predictionId: "P-1",
        notes: "No wear found"
      },
      (payload) => {
        cal = applyOutcome(cal, payload.failureMode, payload.outcome);
        ctx.repo.addFeedback(payload);
      }
    );
    assert.equal(record.outcome, "false_alarm");
    assert.equal(wf.getStates()["disp-R-002-P-1"].status, "false_alarm");
    const reloaded = createJsonRepository({ jsonPath: ctx.jsonPath });
    assert.equal(reloaded.getDispatchFeedback().length, 1);
    assert.ok(cal.bearing_wear.minProbability > DEFAULT_CALIBRATION.bearing_wear.minProbability);
  });

  it("feedback survives repository reload", () => {
    const wf = createDispatchWorkflow(ctx.repo);
    wf.recordFeedback(
      "disp-R-002-P-1",
      {
        outcome: "confirmed_failure",
        robotId: "R-002",
        failureMode: "bearing_wear",
        actionTaken: "Replaced bearing",
        repairMinutes: 40
      },
      () => {}
    );
    const reloaded = createJsonRepository({ jsonPath: ctx.jsonPath });
    assert.equal(reloaded.getDispatchFeedback().length, 1);
    assert.equal(reloaded.getDispatchFeedback()[0].actionTaken, "Replaced bearing");
  });
});
