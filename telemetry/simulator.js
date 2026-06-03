/**
 * Realistic warehouse-robot telemetry simulator with injectable failure modes.
 * Internal true failure times are NEVER exposed to the predictor — only via getValidationSnapshot().
 */
const ROBOT_SIGNALS = {
  Stretch: ["vibrationRms", "motorCurrentA", "bearingTempC", "batteryVoltage", "batteryCapacityPct", "cycleTimeMs"],
  LocusBot: ["vibrationRms", "motorCurrentA", "bearingTempC", "batteryVoltage", "batteryCapacityPct", "cycleTimeMs", "trafficDelayMs"],
  Chuck: ["vibrationRms", "motorCurrentA", "bearingTempC", "pickAccuracyPct", "pickActuatorDriftMm", "cycleTimeMs"],
  CartConnect: ["vibrationRms", "motorCurrentA", "batteryVoltage", "batteryCapacityPct", "travelTimeMs", "dockAlignmentMm"]
};

const BASELINES = {
  vibrationRms: 0.35,
  motorCurrentA: 4.2,
  bearingTempC: 42,
  batteryVoltage: 48.2,
  batteryCapacityPct: 92,
  cycleTimeMs: 4200,
  trafficDelayMs: 1800,
  pickAccuracyPct: 98.2,
  pickActuatorDriftMm: 0.4,
  travelTimeMs: 6200,
  dockAlignmentMm: 1.2
};

const FAILURE_LIMITS = {
  bearing_wear: { signal: "vibrationRms", limit: 2.8 },
  battery_degradation: { signal: "batteryCapacityPct", limit: 55, direction: "below" },
  motor_creep: { signal: "motorCurrentA", limit: 9.5 },
  pick_drift: { signal: "pickActuatorDriftMm", limit: 4.5 }
};

const FAILURE_MODES = Object.keys(FAILURE_LIMITS);

function createSeededRng(seed) {
  if (seed == null || seed === undefined) return () => Math.random();
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createSimulator(options = {}) {
  const robots = new Map();
  let simTimeMs = options.startTimeMs || Date.now() - 3600000;
  let replaySpeed = 1;
  let tickIntervalMs = options.tickIntervalMs || 2000;
  let intervalHandle = null;
  let onReading = null;
  const rng = createSeededRng(options.seed);

  function noise(scale = 1) {
    return (rng() - 0.5) * 2 * scale;
  }

  function registerRobot(robotId, model, failureInjection = null) {
    const signals = ROBOT_SIGNALS[model] || ROBOT_SIGNALS.Stretch;
    const state = {
      robotId,
      model,
      signals,
      failureInjection: failureInjection ? { ...failureInjection } : null,
      trueFailureTimeMs: failureInjection?.trueFailureTimeMs || null,
      failed: false
    };
    if (failureInjection?.mode && failureInjection?.trueFailureTimeMs) {
      state.failureInjection = {
        mode: failureInjection.mode,
        startMs: failureInjection.startMs || simTimeMs - 7200000,
        trueFailureTimeMs: failureInjection.trueFailureTimeMs
      };
      state.trueFailureTimeMs = failureInjection.trueFailureTimeMs;
    }
    robots.set(robotId, state);
    return state;
  }

  function degradationFactor(state, signal) {
    if (!state.failureInjection) return 0;
    const { mode, startMs, trueFailureTimeMs } = state.failureInjection;
    const limitDef = FAILURE_LIMITS[mode];
    if (!limitDef) return 0;
    let t = Math.max(0, Math.min(1, (simTimeMs - startMs) / Math.max(1, trueFailureTimeMs - startMs)));
    if (state.failed || simTimeMs >= trueFailureTimeMs) t = 1;
    const exp = Math.pow(t, 1.8);
    if (mode === "bearing_wear") {
      if (signal === "vibrationRms") return exp * 2.2;
      if (signal === "bearingTempC") return exp * 18;
      if (signal === "motorCurrentA") return exp * 0.35;
    }
    if (mode === "battery_degradation") {
      if (signal === "batteryCapacityPct") return exp * 38;
      if (signal === "batteryVoltage") return exp * 4.5;
      if (signal === "cycleTimeMs") return exp * 420;
      if (signal === "trafficDelayMs") return exp * 360;
    }
    if (mode === "motor_creep") {
      if (signal === "motorCurrentA") return exp * 4.8;
      if (signal === "cycleTimeMs") return exp * 850;
      if (signal === "bearingTempC") return exp * 4;
    }
    if (mode === "pick_drift") {
      if (signal === "pickActuatorDriftMm") return exp * 3.8;
      if (signal === "pickAccuracyPct") return exp * 6;
      if (signal === "cycleTimeMs") return exp * 900;
    }
    return 0;
  }

  function emitReading(robotId) {
    const state = robots.get(robotId);
    if (!state) return null;
    const signals = {};
    state.signals.forEach((sig) => {
      let base = BASELINES[sig] ?? 1;
      const deg = degradationFactor(state, sig);
      if (sig === "batteryCapacityPct" || sig === "pickAccuracyPct") {
        signals[sig] = Math.max(0, base - deg + noise(base * 0.008));
      } else if (sig === "batteryVoltage") {
        signals[sig] = Math.max(40, base - deg + noise(0.15));
      } else {
        signals[sig] = Math.max(0.01, base + deg + noise(base * 0.04));
      }
    });

    if (state.failureInjection && !state.failed) {
      const lim = FAILURE_LIMITS[state.failureInjection.mode];
      const val = signals[lim.signal];
      const crossed =
        lim.direction === "below" ? val <= lim.limit : val >= lim.limit;
      if (crossed || simTimeMs >= state.trueFailureTimeMs) {
        state.failed = true;
      }
    }

    return {
      robotId,
      ts: simTimeMs,
      signals,
      model: state.model
    };
  }

  function tick() {
    const readings = [];
    robots.forEach((_, robotId) => {
      const r = emitReading(robotId);
      if (r) readings.push(r);
    });
    simTimeMs += tickIntervalMs * replaySpeed;
    if (onReading) readings.forEach((r) => onReading(r));
    return readings;
  }

  function start(callback) {
    onReading = callback;
    if (intervalHandle) return;
    intervalHandle = setInterval(tick, tickIntervalMs);
  }

  function stop() {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = null;
  }

  function setReplaySpeed(speed) {
    replaySpeed = Math.max(1, Math.min(360, Number(speed) || 1));
    if (intervalHandle && onReading) {
      clearInterval(intervalHandle);
      intervalHandle = setInterval(tick, Math.max(100, Math.floor(tickIntervalMs / replaySpeed)));
    }
  }

  function getReplaySpeed() {
    return replaySpeed;
  }

  function getSimTimeMs() {
    return simTimeMs;
  }

  function advanceMs(ms) {
    simTimeMs += ms;
  }

  /** Validation harness ONLY — never call from predictor path */
  function getValidationSnapshot() {
    const out = [];
    robots.forEach((state) => {
      out.push({
        robotId: state.robotId,
        failureMode: state.failureInjection?.mode || null,
        trueFailureTimeMs: state.trueFailureTimeMs,
        failed: state.failed,
        simTimeMs
      });
    });
    return out;
  }

  /** Validation-only ground truth for a single robot */
  function getScenarioTruth(robotId) {
    const state = robots.get(robotId);
    if (!state) return null;
    return {
      robotId: state.robotId,
      failureMode: state.failureInjection?.mode || null,
      trueFailureTimeMs: state.trueFailureTimeMs,
      failed: state.failed,
      simTimeMs
    };
  }

  function injectFailure(robotId, mode, opts = {}) {
    const state = robots.get(robotId);
    if (!state || !FAILURE_MODES.includes(mode)) return false;
    const leadMs = opts.leadTimeMs || 14 * 3600000;
    const progress = Math.max(0, Math.min(0.85, opts.progress ?? 0.55));
    const trueFailureTimeMs = opts.trueFailureTimeMs || simTimeMs + leadMs * (1 - progress);
    const startMs = simTimeMs - leadMs * progress;
    state.failureInjection = { mode, startMs, trueFailureTimeMs };
    state.trueFailureTimeMs = trueFailureTimeMs;
    state.failed = false;
    return true;
  }

  return {
    registerRobot,
    tick,
    start,
    stop,
    setReplaySpeed,
    getReplaySpeed,
    getSimTimeMs,
    advanceMs,
    getValidationSnapshot,
    getScenarioTruth,
    injectFailure,
    FAILURE_MODES,
    FAILURE_LIMITS,
    ROBOT_SIGNALS
  };
}

module.exports = {
  createSimulator,
  ROBOT_SIGNALS,
  BASELINES,
  FAILURE_LIMITS,
  FAILURE_MODES
};
