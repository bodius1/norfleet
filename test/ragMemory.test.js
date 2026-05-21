const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { retrieveRelevantContext, captureRepairOutcome } = require("../ragMemory");

test("retrieveRelevantContext returns ranked chunks", () => {
  const results = retrieveRelevantContext("charging dock alignment", "", "", 2);
  assert.ok(Array.isArray(results));
  assert.ok(results.length <= 2);
});

test("captureRepairOutcome writes under knowledge/maintenance_notes", () => {
  const out = captureRepairOutcome({
    actionId: "act-test",
    technicianFeedback: "replaced gripper",
    fixWorked: true,
    beforeAfter: { "Pick Accuracy": [90, 95] }
  });
  assert.equal(out.saved, true);
  const fullPath = path.join(__dirname, "..", "knowledge", out.path);
  assert.ok(fs.existsSync(fullPath));
  fs.unlinkSync(fullPath);
});
