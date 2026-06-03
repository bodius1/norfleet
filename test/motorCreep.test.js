const { describe, it } = require("node:test");
const assert = require("node:assert");
const { createSimulator, ROBOT_SIGNALS } = require("../telemetry/simulator");
const { createTimeSeriesStore } = require("../store/timeSeriesStore");
const { createJsonRepository } = require("../store/persistence");
const { extractFeatures } = require("../predictor/features");
const { predict, isPredictionFired } = require("../predictor/failurePredictor");
const { DEFAULT_CALIBRATION } = require("../predictor/calibration");

function deriveSimSeed(baseSeed, runIndex) {
  return (Number(baseSeed) + runIndex * 1009 + 17) >>> 0;
}

describe("motor_creep detection", () => {
  it("fires alert on injected motor_creep validation scenario", () => {
    const seed = deriveSimSeed(20260524, 2);
    const repo = createJsonRepository();
    repo.clearAll();
    const ts = createTimeSeriesStore(repo);
    const sim = createSimulator({ tickIntervalMs: 60000, seed });
    const robotId = "R-F2";
    const mode = "motor_creep";
    sim.registerRobot(robotId, "LocusBot");
    sim.injectFailure(robotId, mode, { progress: 0.22, leadTimeMs: 14 * 3600000 });

    let last = null;
    let fired = false;
    for (let step = 0; step < 280; step += 1) {
      sim.tick().forEach((r) => ts.write(r));
      const now = sim.getSimTimeMs();
      const features = extractFeatures(
        robotId,
        ts.window(robotId, ROBOT_SIGNALS.LocusBot, 4 * 3600000, now),
        now
      );
      features.failureMode = mode;
      const pred = predict(features, DEFAULT_CALIBRATION);
      last = pred;
      if (!fired && isPredictionFired(pred, DEFAULT_CALIBRATION, mode)) fired = true;
    }

    assert.ok(last.modeEvidence, `expected modeEvidence, reason=${last.reason}`);
    assert.ok(last.healthIndex <= 0.95, `HI should drop under stress, got ${last.healthIndex}`);
    assert.ok(fired, `prediction should fire before failure; reason=${last.reason}`);
    repo.clearAll();
  });
});
