const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateAnalyzeKpisInput,
  validateRootCauseInput,
  validateFeedbackInput,
  validateReplayInput
} = require("../validation");

test("validateAnalyzeKpisInput requires kpiHistory object", () => {
  assert.equal(validateAnalyzeKpisInput({}).ok, false);
  assert.equal(validateAnalyzeKpisInput({ kpiHistory: {} }).ok, true);
});

test("validateRootCauseInput enforces required fields", () => {
  assert.equal(validateRootCauseInput({}).ok, false);
  assert.equal(validateRootCauseInput({ robotId: "R-001", kpiAnomaly: { kpi: "Travel Time" } }).ok, true);
});

test("validateFeedbackInput accepts outcome without fixWorked", () => {
  assert.equal(validateFeedbackInput({ actionId: "a1", outcome: "false-alarm" }).ok, true);
  assert.equal(validateFeedbackInput({ actionId: "a1", fixWorked: true }).ok, true);
});

test("validateReplayInput bounds speed", () => {
  assert.equal(validateReplayInput({ speed: 60 }).ok, true);
  assert.equal(validateReplayInput({ speed: 500 }).ok, false);
});
