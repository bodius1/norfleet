/**
 * TelemetryAdapter contract — swap simulated vs vendor via config/settings.
 *
 * connect(config) -> Promise<void>
 * disconnect() -> Promise<void>
 * subscribe(onReading) -> unsubscribe fn
 * normalize(rawVendorPayload) -> canonical { robotId, ts, signals }
 */
const { createSimulator, ROBOT_SIGNALS } = require("../telemetry/simulator");

function normalizeCanonical(reading) {
  return {
    robotId: reading.robotId,
    ts: reading.ts,
    signals: { ...reading.signals },
    model: reading.model
  };
}

function createSimulatedTelemetryAdapter(simulator) {
  let unsubscribe = null;
  return {
    name: "simulated",
    async connect() {},
    async disconnect() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      } else {
        simulator.stop();
      }
    },
    subscribe(onReading) {
      simulator.start((r) => onReading(normalizeCanonical(r)));
      unsubscribe = () => {
        simulator.stop();
        unsubscribe = null;
      };
      return unsubscribe;
    },
    normalize: normalizeCanonical,
    setReplaySpeed: (s) => simulator.setReplaySpeed(s),
    getReplaySpeed: () => simulator.getReplaySpeed(),
    getSimulator: () => simulator
  };
}

function createTelemetryAdapter(config, deps = {}) {
  const mode = config?.telemetryAdapter || config?.dataMode || "simulated";
  if (mode === "vendor") {
    const { createVendorTelemetryAdapter } = require("./vendorTelemetry");
    return createVendorTelemetryAdapter(config);
  }
  const simulator = deps.simulator || createSimulator();
  return createSimulatedTelemetryAdapter(simulator);
}

/** @deprecated use createTelemetryAdapter */
function createMockTelemetryAdapter(runtimeStore) {
  return {
    fetchTelemetry(fleetId) {
      const fleet = runtimeStore.findFleet(fleetId);
      if (!fleet) return { fleetId, kpiHistory: {}, robots: [], series: {} };
      const robots = runtimeStore.getRobots().filter((r) => fleet.robotIds.includes(r.id));
      return {
        fleetId,
        kpiHistory: runtimeStore.getFleetHistory(fleetId) || {},
        robots,
        series: runtimeStore.getFleetHistory(fleetId) || {}
      };
    }
  };
}

module.exports = {
  createTelemetryAdapter,
  createSimulatedTelemetryAdapter,
  createMockTelemetryAdapter,
  normalizeCanonical,
  ROBOT_SIGNALS
};
