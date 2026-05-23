/**
 * Norfleet platform bootstrap: persistence, telemetry, prediction pipeline.
 */
const { createRepository } = require("../store/persistence");
const { createTimeSeriesStore } = require("../store/timeSeriesStore");
const { getSessionSettings } = require("../config/settings");
const { createSimulator, ROBOT_SIGNALS } = require("../telemetry/simulator");
const { createTelemetryAdapter } = require("../adapters/robotTelemetry");
const { extractFeatures, inferFailureMode } = require("../predictor/features");
const { predict } = require("../predictor/failurePredictor");
const { loadCalibration, applyOutcome } = require("../predictor/calibration");
const { createAgentDefinitions } = require("../toolExecutor");
const crypto = require("crypto");

const LOOKBACK_MS = 3600000;
const PREDICTION_INTERVAL_MS = 5000;
let predictionCounter = 0;

function createPlatform() {
  const repo = createRepository();
  repo.initSchema();
  const timeSeries = createTimeSeriesStore(repo);
  const simulator = createSimulator();
  const adapter = createTelemetryAdapter(
    { telemetryAdapter: getSessionSettings().data.telemetryAdapter },
    { simulator }
  );
  let calibration = loadCalibration(repo);
  let latestPredictions = new Map();
  let predictionTimer = null;

  function applyDemoScenarioFromRepo() {
    const scenario = repo.getDemoScenario?.();
    if (!scenario?.injected?.length) return;
    scenario.injected.forEach((inj) => {
      simulator.injectFailure(inj.robotId, inj.mode, {
        progress: inj.progress ?? 0.55,
        leadTimeMs: inj.leadTimeMs || 16 * 3600000
      });
    });
  }

  function hydrateFromRepo() {
    if (!repo.getRobots().length) return false;
    repo.getRobots().forEach((r) => simulator.registerRobot(r.id, r.model));
    applyDemoScenarioFromRepo();
    return true;
  }

  function seedExampleFleet(baselineForKpi) {
    if (hydrateFromRepo()) {
      repo.getRobots().forEach((r) => simulator.registerRobot(r.id, r.model));
      return;
    }
    const demoRobots = [
      { id: "R-001", name: "Induction Alpha", model: "Stretch", warehouseZone: "A", taskProfile: "Multi-SKU pick", status: "active" },
      { id: "R-002", name: "Aisle Runner 12", model: "LocusBot", warehouseZone: "B", taskProfile: "Transport relay", status: "active" },
      { id: "R-003", name: "Sort Cell 3", model: "Chuck", warehouseZone: "C", taskProfile: "Sortation", status: "idle" },
      { id: "R-004", name: "Outbound Cart", model: "CartConnect", warehouseZone: "D", taskProfile: "Cart-to-station", status: "charging" }
    ];
    demoRobots.forEach((r) => {
      repo.addRobot({ ...r });
      simulator.registerRobot(r.id, r.model);
    });
    const modelToKpis = {
      Stretch: ["Throughput", "Cycle Time", "Uptime", "Battery Health"],
      LocusBot: ["Throughput", "Pick Accuracy", "Traffic Delay", "Battery Health"],
      Chuck: ["Pick Accuracy", "Error Rate", "Cycle Time", "Uptime"],
      CartConnect: ["Travel Time", "Task Completion", "Uptime", "Battery Health"]
    };
    const kpis = Array.from(new Set(demoRobots.flatMap((r) => modelToKpis[r.model] || ["Throughput", "Uptime"])));
    repo.addFleet({
      id: "F-001",
      name: "Example — Sort Center East Wing",
      robotIds: demoRobots.map((r) => r.id),
      kpis,
      createdAt: new Date().toISOString(),
      isExample: true
    });
    const history = repo.getFleetHistory();
    history["F-001"] = history["F-001"] || {};
    kpis.forEach((kpi) => {
      if (!history["F-001"][kpi]) {
        history["F-001"][kpi] = Array.from({ length: 20 }, () => baselineForKpi(kpi));
      }
    });
    repo.setFleetHistory(history);
    if (!repo.getAgentRuntime().length) repo.setAgentRuntime(createAgentDefinitions());
  }

  function seedDemoScenario() {
    const injected = [{ robotId: "R-002", mode: "bearing_wear", progress: 0.58, leadTimeMs: 16 * 3600000 }];
    repo.setDemoScenario({ injected });
    applyDemoScenarioFromRepo();
    for (let i = 0; i < 80; i += 1) {
      simulator.tick().forEach((r) => onTelemetryReading(r));
    }
  }

  function onTelemetryReading(reading) {
    timeSeries.write(reading);
    updateKpiHistoryFromReading(reading);
  }

  function updateKpiHistoryFromReading(reading) {
    const fleets = repo.getFleets();
    const fleet = fleets.find((f) => f.robotIds.includes(reading.robotId));
    if (!fleet) return;
    const history = repo.getFleetHistory();
    if (!history[fleet.id]) history[fleet.id] = {};
    const map = {
      vibrationRms: "Error Rate",
      batteryCapacityPct: "Battery Health",
      cycleTimeMs: "Cycle Time",
      pickAccuracyPct: "Pick Accuracy",
      travelTimeMs: "Travel Time"
    };
    Object.entries(map).forEach(([sig, kpi]) => {
      if (reading.signals[sig] !== undefined) {
        if (!history[fleet.id][kpi]) history[fleet.id][kpi] = [];
        const arr = history[fleet.id][kpi];
        arr.push(Number(reading.signals[sig].toFixed(2)));
        if (arr.length > 30) arr.shift();
      }
    });
    repo.setFleetHistory(history);
  }

  function runPredictionForRobot(robotId, nowTs) {
    const robot = repo.getRobots().find((r) => r.id === robotId);
    if (!robot) return null;
    const signals = ROBOT_SIGNALS[robot.model] || ROBOT_SIGNALS.Stretch;
    const signalWindow = timeSeries.window(robotId, signals, LOOKBACK_MS, nowTs);
    const features = extractFeatures(robotId, signalWindow, nowTs);
    features.failureMode = inferFailureMode(features);
    const result = predict(features, calibration);
    result.id = `P-${++predictionCounter}`;
    result.ts = nowTs;
    result.robotName = robot.name;
    latestPredictions.set(robotId, result);
    if (result.alert) {
      const existing = repo.getPredictions().filter((p) => p.robotId === robotId && p.status === "open");
      if (!existing.length) repo.addPrediction({ ...result, status: "open" });
    }
    return result;
  }

  function runAllPredictions(nowTs = simulator.getSimTimeMs()) {
    repo.getRobots().forEach((r) => runPredictionForRobot(r.id, nowTs));
  }

  function start() {
    adapter.subscribe(onTelemetryReading);
    if (predictionTimer) clearInterval(predictionTimer);
    predictionTimer = setInterval(() => runAllPredictions(), PREDICTION_INTERVAL_MS);
    runAllPredictions();
  }

  function setReplaySpeed(speed) {
    if (adapter.setReplaySpeed) adapter.setReplaySpeed(speed);
  }

  function recordFeedback(payload) {
    const fb = {
      id: `FB-${Date.now()}`,
      ...payload,
      createdAt: new Date().toISOString()
    };
    repo.addFeedback(fb);
    if (payload.outcome && payload.failureMode) {
      calibration = applyOutcome(calibration, payload.failureMode, payload.outcome);
      repo.setCalibration(calibration);
    }
    if (payload.predictionId) {
      repo.updatePrediction(payload.predictionId, { status: "resolved", outcome: payload.outcome });
    }
    return fb;
  }

  function getAgentRuntimeConfig() {
    return repo.getAgentRuntime();
  }

  function setAgentRuntimeConfig(cfg) {
    repo.setAgentRuntime(cfg);
  }

  function buildDeterministicDispatch(prediction) {
    const signals = (prediction.contributingSignals || [])
      .map((s) => `${s.signal} (weight ${s.weight})`)
      .join(", ");
    return {
      id: `act-${prediction.id}`,
      title: `${prediction.failureMode.replace(/_/g, " ")} — ${prediction.robotId}`,
      detail: `Predicted failure in ~${prediction.estimatedTimeToFailureHours}h (p=${(prediction.failureProbability * 100).toFixed(0)}%, confidence ${(prediction.confidence * 100).toFixed(0)}%). Top signals: ${signals}`,
      severity: prediction.failureProbability > 0.75 ? "High" : "Medium",
      predictionId: prediction.id,
      failureMode: prediction.failureMode,
      estimatedTimeToFailureHours: prediction.estimatedTimeToFailureHours,
      confidence: prediction.confidence,
      robotId: prediction.robotId,
      kind: "dispatch",
      buttonLabel: "Apply to Agent Builder",
      requiresHumanApproval: true,
      selfFix: true,
      source: "Prediction Engine"
    };
  }

  return {
    repo,
    timeSeries,
    simulator,
    adapter,
    seedExampleFleet,
    seedDemoScenario,
    start,
    setReplaySpeed,
    runAllPredictions,
    runPredictionForRobot,
    getLatestPrediction: (robotId) => latestPredictions.get(robotId),
    getAllLatestPredictions: () => Array.from(latestPredictions.values()),
    getCalibration: () => ({ ...calibration }),
    recordFeedback,
    getAgentRuntimeConfig,
    setAgentRuntimeConfig,
    buildDeterministicDispatch,
    LOOKBACK_MS
  };
}

const instructionCache = new Map();

function cacheKey(parts) {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function getCachedInstruction(key) {
  return instructionCache.get(key) || null;
}

function setCachedInstruction(key, val) {
  instructionCache.set(key, val);
}

module.exports = {
  createPlatform,
  cacheKey,
  getCachedInstruction,
  setCachedInstruction
};
