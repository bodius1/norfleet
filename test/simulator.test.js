const { describe, it } = require("node:test");
const assert = require("node:assert");
const { createSimulator } = require("../telemetry/simulator");

describe("telemetry simulator", () => {
  it("emits monotonic-ish degradation for bearing_wear", () => {
    const sim = createSimulator({ tickIntervalMs: 60000 });
    sim.registerRobot("R-1", "LocusBot");
    sim.injectFailure("R-1", "bearing_wear", { progress: 0.3, leadTimeMs: 8 * 3600000 });
    const vib = [];
    for (let i = 0; i < 40; i += 1) {
      const r = sim.tick()[0];
      vib.push(r.signals.vibrationRms);
    }
    assert.ok(vib[vib.length - 1] > vib[0]);
    const snap = sim.getValidationSnapshot()[0];
    assert.equal(snap.failureMode, "bearing_wear");
    assert.ok(snap.trueFailureTimeMs);
  });

  it("does not expose true RUL through readings", () => {
    const sim = createSimulator();
    sim.registerRobot("R-1", "Chuck");
    sim.injectFailure("R-1", "pick_drift", { progress: 0.4, leadTimeMs: 10 * 3600000 });
    const reading = sim.tick()[0];
    assert.ok(!("trueFailureTimeMs" in reading));
    assert.ok(!("trueRUL" in reading));
  });
});
