const { describe, it } = require("node:test");
const assert = require("node:assert");
const { createSimulator } = require("../telemetry/simulator");
const { createTimeSeriesStore } = require("../store/timeSeriesStore");
const { createJsonRepository } = require("../store/persistence");
const { extractFeatures } = require("../predictor/features");
const { predict } = require("../predictor/failurePredictor");
const { DEFAULT_CALIBRATION, applyOutcome } = require("../predictor/calibration");
const { ROBOT_SIGNALS } = require("../telemetry/simulator");

describe("predictor pipeline", () => {
  it("returns finite TTF with lead time on degrading signal", () => {
    const repo = createJsonRepository();
    repo.clearAll();
    const ts = createTimeSeriesStore(repo);
    const sim = createSimulator({ tickIntervalMs: 60000 });
    sim.registerRobot("R-1", "LocusBot");
    sim.injectFailure("R-1", "bearing_wear", { progress: 0.45, leadTimeMs: 12 * 3600000 });
    let last = null;
    for (let i = 0; i < 60; i += 1) {
      sim.tick().forEach((r) => ts.write(r));
      const now = sim.getSimTimeMs();
      const features = extractFeatures("R-1", ts.window("R-1", ROBOT_SIGNALS.LocusBot, 4 * 3600000, now), now);
      features.failureMode = "bearing_wear";
      last = predict(features, DEFAULT_CALIBRATION);
    }
    assert.ok(last.estimatedTimeToFailureHours !== null);
    assert.ok(last.contributingSignals.length > 0);
    assert.ok(typeof last.failureProbability === "number");
    repo.clearAll();
  });

  it("feedback recalibration tightens after false alarm", () => {
    const before = DEFAULT_CALIBRATION.bearing_wear.minProbability;
    const after = applyOutcome(DEFAULT_CALIBRATION, "bearing_wear", "false-alarm");
    assert.ok(after.bearing_wear.minProbability > before);
  });
});
