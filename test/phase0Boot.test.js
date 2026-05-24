const { describe, it, after } = require("node:test");
const assert = require("node:assert");
const { createPlatform } = require("../services/norfleetPlatform");
const { ROBOT_SIGNALS } = require("../telemetry/simulator");

function baselineForKpi() {
  return 50 + Math.random() * 10;
}

describe("phase 0 boot health", () => {
  let bootPlatform = null;

  after(() => {
    if (bootPlatform) {
      bootPlatform.stop();
      bootPlatform = null;
    }
  });

  it("R-002 signal window is populated after demo seed", () => {
    const platform = createPlatform();
    platform.repo.clearAll();
    platform.seedExampleFleet(baselineForKpi);
    platform.seedDemoScenario();

    const robot = platform.repo.getRobots().find((r) => r.id === "R-002");
    const signals = ROBOT_SIGNALS[robot.model];
    const counts = platform.timeSeries.countBySignal("R-002", signals);
    signals.forEach((signal) => {
      assert.ok(counts[signal] > 0, `${signal} hot buffer empty`);
    });

    const computed = platform.computeRobotFeatures("R-002");
    signals.forEach((signal) => {
      assert.ok(computed.signalWindow[signal]?.length > 0, `${signal} window empty`);
    });
  });

  it("R-002 health payload has finite TTF and normalized HI series", () => {
    const platform = createPlatform();
    platform.repo.clearAll();
    platform.seedExampleFleet(baselineForKpi);
    platform.seedDemoScenario();

    const health = platform.getRobotHealthPayload("R-002");
    assert.ok(health);
    assert.equal(health.prediction.insufficientData, false, health.prediction.reason);
    assert.ok(health.prediction.estimatedTimeToFailureHours != null);
    assert.ok(health.healthIndex < 1);
    assert.ok(health.prediction.contributingSignals.length > 0);
    assert.ok(health.hiSeries.length >= 5);
    health.hiSeries.forEach((p) => {
      assert.ok(p.value >= 0 && p.value <= 1, `HI out of range: ${p.value}`);
    });
  });

  it("start() repopulates telemetry after reset (server boot path)", () => {
    bootPlatform = createPlatform();
    bootPlatform.repo.clearAll();
    bootPlatform.seedExampleFleet(baselineForKpi);
    bootPlatform.start();

    const health = bootPlatform.getRobotHealthPayload("R-002");
    assert.ok(health);
    assert.equal(health.prediction.insufficientData, false, health.prediction.reason);
    assert.ok(health.prediction.contributingSignals.length > 0);
    assert.ok(health.hiSeries.every((p) => p.value >= 0 && p.value <= 1));

    bootPlatform.stop();
    bootPlatform = null;
  });
});
