const { describe, it } = require("node:test");
const assert = require("node:assert");
const { createTelemetryAdapter, normalizeCanonical } = require("../adapters/robotTelemetry");
const { createSimulator } = require("../telemetry/simulator");

describe("TelemetryAdapter", () => {
  it("normalizes canonical readings", () => {
    const n = normalizeCanonical({ robotId: "R-1", ts: 1, signals: { vibrationRms: 0.5 }, model: "Stretch" });
    assert.equal(n.robotId, "R-1");
    assert.equal(n.signals.vibrationRms, 0.5);
  });

  it("simulated adapter emits readings on subscribe", () => {
    const sim = createSimulator({ tickIntervalMs: 100 });
    const adapter = createTelemetryAdapter({ telemetryAdapter: "simulated" }, { simulator: sim });
    sim.registerRobot("R-1", "Stretch");
    const readings = [];
    adapter.subscribe((r) => readings.push(r));
    sim.tick();
    assert.ok(readings.length >= 1);
    adapter.disconnect();
  });
});
