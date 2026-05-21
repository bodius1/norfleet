const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateAnalyzeKpisInput,
  validateRootCauseInput,
  validateFeedbackInput
} = require("../validation");

test("validateAnalyzeKpisInput requires kpiHistory object", () => {
  assert.equal(validateAnalyzeKpisInput({}).ok, false);
  assert.equal(validateAnalyzeKpisInput({ kpiHistory: {} }).ok, true);
});

test("validateRootCauseInput enforces required fields", () => {
  assert.equal(validateRootCauseInput({}).ok, false);
  assert.equal(validateRootCauseInput({ robotId: "R-001", kpiAnomaly: { kpi: "Travel Time" } }).ok, true);
});

test("validateFeedbackInput enforces boolean fixWorked", () => {
  assert.equal(validateFeedbackInput({ actionId: "a1", fixWorked: "yes" }).ok, false);
  assert.equal(validateFeedbackInput({ actionId: "a1", fixWorked: true }).ok, true);
});
