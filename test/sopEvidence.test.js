const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  getSopRefsForFailureMode,
  listSupportedFailureModes,
  sourceFileExists
} = require("../services/sopEvidence");

describe("sop evidence", () => {
  it("maps bearing_wear to compact bearing/wheel/vibration refs", () => {
    const refs = getSopRefsForFailureMode("bearing_wear");
    assert.ok(refs.length >= 1);
    refs.forEach((ref) => {
      assert.ok(ref.title);
      assert.ok(ref.sourceFile.startsWith("knowledge/"));
      assert.ok(ref.section);
      assert.ok(ref.relevance);
      assert.ok(ref.confidence > 0 && ref.confidence <= 1);
      assert.ok(ref.relevance.length < 200);
    });
    const text = JSON.stringify(refs);
    assert.ok(!text.includes("Charging dock alignment guide:"));
  });

  it("maps battery_degradation to battery and charging refs", () => {
    const refs = getSopRefsForFailureMode("battery_degradation");
    assert.ok(refs.some((r) => r.sourceFile.includes("field-playbook")));
    assert.ok(refs.some((r) => r.sourceFile.includes("charging-dock-alignment")));
  });

  it("maps motor_creep to drivetrain and drag refs", () => {
    const refs = getSopRefsForFailureMode("motor_creep");
    assert.ok(refs.length >= 1);
    assert.ok(refs.some((r) => /wheel|drivetrain|drag|motor/i.test(r.relevance)));
  });

  it("maps pick_drift to pick accuracy refs", () => {
    const refs = getSopRefsForFailureMode("pick_drift");
    assert.ok(refs.some((r) => /pick/i.test(r.title) || /pick/i.test(r.section)));
  });

  it("maps lidar_obstruction to lidar SOP refs", () => {
    const refs = getSopRefsForFailureMode("lidar_obstruction");
    assert.ok(refs.some((r) => r.sourceFile.includes("lidar-obstruction")));
    assert.ok(sourceFileExists("knowledge/sops/lidar-obstruction.txt"));
  });

  it("returns empty array for unknown failure modes", () => {
    const refs = getSopRefsForFailureMode("unknown_mode");
    assert.deepEqual(refs, []);
  });

  it("lists all supported failure modes", () => {
    const modes = listSupportedFailureModes();
    assert.ok(modes.includes("bearing_wear"));
    assert.ok(modes.includes("battery_degradation"));
    assert.ok(modes.includes("motor_creep"));
    assert.ok(modes.includes("pick_drift"));
    assert.ok(modes.includes("lidar_obstruction"));
  });
});
