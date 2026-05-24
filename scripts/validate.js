#!/usr/bin/env node
/**
 * Backtest harness — scores predictor on simulated life-runs with known failure times.
 */
const { createSimulator, ROBOT_SIGNALS } = require("../telemetry/simulator");
const { createTimeSeriesStore } = require("../store/timeSeriesStore");
const { extractFeatures, inferFailureMode } = require("../predictor/features");
const { predict, isPredictionFired } = require("../predictor/failurePredictor");
const { DEFAULT_CALIBRATION } = require("../predictor/calibration");

const CLI_DEFAULTS = {
  failureRuns: 20,
  healthyRuns: 12,
  maxTicks: 280,
  thresholdSweep: true,
  quiet: false
};

const TEST_DEFAULTS = {
  failureRuns: 25,
  healthyRuns: 25,
  maxTicks: 280,
  thresholdSweep: false,
  quiet: true,
  seed: 20260524,
  maxRuntimeMs: 300000
};

const THRESHOLD_LEVELS = [0.35, 0.4, 0.45, 0.5, 0.55];
const FAILURE_MODES = ["bearing_wear", "battery_degradation", "motor_creep", "pick_drift"];
const FAILURE_MODE_MODEL = {
  bearing_wear: "LocusBot",
  battery_degradation: "Stretch",
  motor_creep: "LocusBot",
  pick_drift: "Chuck"
};
const DIAG_SIGNALS = [
  "vibrationRms",
  "bearingTempC",
  "motorCurrentA",
  "batteryVoltage",
  "batteryCapacityPct",
  "cycleTimeMs",
  "trafficDelayMs",
  "pickActuatorDriftMm",
  "pickAccuracyPct"
];
const MAX_RUNTIME_MS = 120000;

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** In-memory repo — validation must not write norfleet.json on every telemetry point. */
function createValidationRepository() {
  const telemetry = [];
  return {
    backend: "memory",
    initSchema: () => {},
    save: () => {},
    clearAll: () => {
      telemetry.length = 0;
    },
    writeTelemetry: (robotId, signal, ts, value) => {
      telemetry.push({ robotId, signal, ts, value: Number(value) });
    },
    queryTelemetry: (robotId, signal, fromTs, toTs) => {
      return telemetry
        .filter(
          (row) =>
            row.robotId === robotId &&
            row.signal === signal &&
            row.ts >= fromTs &&
            row.ts <= toTs
        )
        .sort((a, b) => a.ts - b.ts)
        .map((row) => ({ ts: row.ts, value: row.value }));
    },
    queryTelemetryMulti: () => []
  };
}

function signalDeltasFromFeatures(features) {
  const deltas = {};
  DIAG_SIGNALS.forEach((signal) => {
    const row = features?.perSignal?.[signal];
    deltas[signal] = row ? Number((row.delta ?? 0).toFixed(4)) : null;
  });
  return deltas;
}

function snapshotFromPred(pred, tick, ts) {
  if (!pred) return {};
  return {
    firstPredictionTick: tick,
    firstPredictionTimeMs: ts,
    estimatedTimeToFailureHours: pred.estimatedTimeToFailureHours,
    failureProbability: pred.failureProbability,
    confidence: pred.confidence,
    alert: pred.alert,
    healthIndex: pred.healthIndex,
    slope: pred.slope,
    modeEvidence: pred.modeEvidence,
    contributingSignals: pred.contributingSignals,
    reason: pred.reason
  };
}

function runLifeCycle(sim, ts, robotId, model, mode, calibration, inject, maxTicks) {
  sim.registerRobot(robotId, model);
  if (inject) {
    sim.injectFailure(robotId, mode, { progress: 0.22, leadTimeMs: 14 * 3600000 });
  }

  let predictionFired = false;
  let fireTs = null;
  let fireSnapshot = null;
  let lastFailureMode = inject ? mode : null;
  let lastPred = null;
  let lastFeatures = null;

  for (let step = 0; step < maxTicks; step += 1) {
    sim.tick().forEach((r) => ts.write(r));
    const now = sim.getSimTimeMs();
    const signals = ROBOT_SIGNALS[model];
    const features = extractFeatures(robotId, ts.window(robotId, signals, 4 * 3600000, now), now);
    const failureMode = inject ? mode : inferFailureMode(features);
    features.failureMode = failureMode;
    lastFailureMode = failureMode;
    const pred = predict(features, calibration);
    lastPred = pred;
    lastFeatures = features;
    if (!predictionFired && isPredictionFired(pred, calibration, failureMode)) {
      predictionFired = true;
      fireTs = now;
      fireSnapshot = snapshotFromPred(pred, step, now);
    }
  }

  const truth = sim.getScenarioTruth(robotId);
  const runType = inject ? "failure" : "healthy";
  const actualPositive = Boolean(inject && truth?.trueFailureTimeMs != null);

  let bucket = null;
  if (actualPositive) {
    if (
      predictionFired &&
      fireTs != null &&
      truth?.trueFailureTimeMs != null &&
      fireTs < truth.trueFailureTimeMs
    ) {
      bucket = "TP";
    } else {
      bucket = "FN";
    }
  } else if (predictionFired) {
    bucket = "FP";
  } else {
    bucket = "TN";
  }

  return {
    runType,
    robotId,
    scenarioFailureMode: inject ? mode : null,
    inferredFailureMode: lastFailureMode,
    actualPositive,
    predictedPositive: predictionFired,
    fireTs,
    trueFailureTimeMs: truth?.trueFailureTimeMs ?? null,
    bucket,
    finalHealthIndex: lastPred?.healthIndex ?? null,
    finalHealthDrop: lastPred?.healthDrop ?? null,
    finalSlope: lastPred?.slope ?? null,
    finalEstimatedTimeToFailureHours: lastPred?.estimatedTimeToFailureHours ?? null,
    finalFailureProbability: lastPred?.failureProbability ?? null,
    finalConfidence: lastPred?.confidence ?? null,
    finalAlert: lastPred?.alert ?? false,
    finalModeEvidence: lastPred?.modeEvidence ?? false,
    finalReason: lastPred?.reason ?? null,
    finalContributingSignals: lastPred?.contributingSignals ?? [],
    signalDeltas: signalDeltasFromFeatures(lastFeatures),
    ...(fireSnapshot || {
      firstPredictionTick: null,
      firstPredictionTimeMs: null,
      estimatedTimeToFailureHours: null,
      failureProbability: null,
      confidence: null,
      alert: false,
      healthIndex: null,
      slope: null,
      modeEvidence: false,
      contributingSignals: [],
      reason: null
    })
  };
}

function deriveSimSeed(baseSeed, runIndex, inject) {
  if (baseSeed == null || baseSeed === undefined) return undefined;
  return (Number(baseSeed) + runIndex * 1009 + (inject ? 17 : 91)) >>> 0;
}

function runIsolatedLifeCycle(robotId, model, mode, calibration, inject, maxTicks, seed, runIndex) {
  const sim = createSimulator({
    tickIntervalMs: 60000,
    seed: deriveSimSeed(seed, runIndex, inject)
  });
  const repo = createValidationRepository();
  const ts = createTimeSeriesStore(repo);
  try {
    return runLifeCycle(sim, ts, robotId, model, mode, calibration, inject, maxTicks);
  } finally {
    if (sim.stop) sim.stop();
  }
}

function runBacktest(calibration = DEFAULT_CALIBRATION, options = {}) {
  return runValidation({ ...options, calibration, quiet: true });
}

function modelForFailureMode(mode) {
  return FAILURE_MODE_MODEL[mode] || "LocusBot";
}

function printRunDiagnostics(runDiagnostics) {
  if (!runDiagnostics?.length) return;
  console.log("\n--- Per-run validation diagnostics ---");
  console.log(
    "runType  robotId   bucket  mode           pred  TTF(h)  prob    conf    HI     drop    slope    modeEv  reason"
  );
  runDiagnostics.forEach((d) => {
    const mode = d.scenarioFailureMode || d.inferredFailureMode || "-";
    console.log(
      [
        d.runType.padEnd(8),
        d.robotId.padEnd(9),
        d.bucket,
        String(mode).padEnd(14),
        d.predictedPositive ? "Y" : "N",
        (d.estimatedTimeToFailureHours ?? d.finalEstimatedTimeToFailureHours) != null
          ? Number(d.estimatedTimeToFailureHours ?? d.finalEstimatedTimeToFailureHours).toFixed(1)
          : "-",
        (d.failureProbability ?? d.finalFailureProbability) != null
          ? Number(d.failureProbability ?? d.finalFailureProbability).toFixed(2)
          : "-",
        (d.confidence ?? d.finalConfidence) != null
          ? Number(d.confidence ?? d.finalConfidence).toFixed(2)
          : "-",
        (d.healthIndex ?? d.finalHealthIndex) != null
          ? Number(d.healthIndex ?? d.finalHealthIndex).toFixed(3)
          : "-",
        d.finalHealthDrop != null ? Number(d.finalHealthDrop).toFixed(3) : "-",
        (d.slope ?? d.finalSlope) != null ? Number(d.slope ?? d.finalSlope).toFixed(5) : "-",
        (d.modeEvidence ?? d.finalModeEvidence) ? "Y" : "N",
        (d.reason ?? (d.finalReason || "")).slice(0, 36)
      ].join("  ")
    );
  });

  const failures = runDiagnostics.filter((d) => d.runType === "failure");
  if (failures.length) {
    console.log("\nFailure-run signal deltas (final window):");
    failures.forEach((d) => {
      const deltas = Object.entries(d.signalDeltas || {})
        .filter(([, v]) => v != null && Math.abs(v) > 0.0001)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      console.log(
        `  ${d.robotId} [${d.scenarioFailureMode}] ${d.bucket}: ${deltas || "no deltas"} | ${d.finalReason || d.reason || ""}`
      );
      if (d.finalContributingSignals?.length) {
        d.finalContributingSignals.forEach((s) => {
          console.log(`    ${s.signal} delta=${s.delta} contrib=${s.contribution} ${s.reason}`);
        });
      }
    });
  }

  const byMode = {};
  failures.forEach((d) => {
    const m = d.scenarioFailureMode || "unknown";
    if (!byMode[m]) byMode[m] = { TP: 0, FN: 0 };
    byMode[m][d.bucket] = (byMode[m][d.bucket] || 0) + 1;
  });
  if (Object.keys(byMode).length) {
    console.log("\nPer-mode TP/FN:");
    Object.entries(byMode).forEach(([mode, counts]) => {
      console.log(`  ${mode}: TP=${counts.TP || 0} FN=${counts.FN || 0}`);
    });
  }

  const fps = runDiagnostics.filter((d) => d.bucket === "FP");
  if (fps.length) {
    console.log("\nFalse-positive detail:");
    fps.forEach((d) => {
      console.log(`  ${d.robotId}: mode=${d.inferredFailureMode} HI=${d.healthIndex} slope=${d.slope} reason=${d.reason}`);
      if (d.contributingSignals?.length) {
        d.contributingSignals.forEach((s) => {
          console.log(`    ${s.signal} contrib=${s.contribution} dir=${s.direction} reason=${s.reason}`);
        });
      }
    });
  }
  console.log("");
}

function runValidation(options = {}) {
  const started = Date.now();
  const opts = { ...CLI_DEFAULTS, ...options };
  const calibration = opts.calibration ?? DEFAULT_CALIBRATION;
  const failureRuns = opts.failureRuns ?? CLI_DEFAULTS.failureRuns;
  const healthyRuns = opts.healthyRuns ?? CLI_DEFAULTS.healthyRuns;
  const maxTicks = opts.maxTicks ?? CLI_DEFAULTS.maxTicks;
  const seed = opts.seed;
  const maxRuntimeMs = opts.maxRuntimeMs ?? MAX_RUNTIME_MS;

  let tp = 0;
  let fn = 0;
  let fp = 0;
  let tn = 0;
  const leadTimes = [];
  const runDiagnostics = [];
  const thresholdRows = THRESHOLD_LEVELS.map((t) => ({ threshold: t, tp: 0, fp: 0 }));

  for (let run = 0; run < failureRuns; run += 1) {
    if (Date.now() - started > maxRuntimeMs) break;
    const robotId = `R-F${run}`;
    const mode = FAILURE_MODES[run % FAILURE_MODES.length];
    const model = modelForFailureMode(mode);
    const result = runIsolatedLifeCycle(robotId, model, mode, calibration, true, maxTicks, seed, run);
    runDiagnostics.push(result);
    if (result.bucket === "TP") {
      tp += 1;
      if (result.fireTs != null && result.trueFailureTimeMs != null) {
        leadTimes.push((result.trueFailureTimeMs - result.fireTs) / 3600000);
      }
    } else if (result.bucket === "FN") {
      fn += 1;
    }
  }

  for (let run = 0; run < healthyRuns; run += 1) {
    if (Date.now() - started > maxRuntimeMs) break;
    const robotId = `R-H${run}`;
    const model = run % 2 ? "Stretch" : "CartConnect";
    const result = runIsolatedLifeCycle(robotId, model, null, calibration, false, maxTicks, seed, run + 1000);
    runDiagnostics.push(result);
    if (result.bucket === "FP") fp += 1;
    else if (result.bucket === "TN") tn += 1;
  }

  if (opts.thresholdSweep) {
    thresholdRows.forEach((row) => {
        for (let run = 0; run < failureRuns; run += 1) {
          if (Date.now() - started > maxRuntimeMs) return;
          const robotId = `R-T${run}`;
          const mode = FAILURE_MODES[run % FAILURE_MODES.length];
          const model = modelForFailureMode(mode);
          const sim2 = createSimulator({
            tickIntervalMs: 60000,
            seed: deriveSimSeed(seed, run + 2000, true)
          });
        const ts2 = createTimeSeriesStore(createValidationRepository());
        try {
          sim2.registerRobot(robotId, model);
          sim2.injectFailure(robotId, mode, { progress: 0.22, leadTimeMs: 14 * 3600000 });
          let predictionFired = false;
          let fireTs = null;
          const cal = {
            ...calibration,
            [mode]: { ...calibration[mode], minProbability: row.threshold }
          };
          for (let step = 0; step < maxTicks; step += 1) {
            sim2.tick().forEach((r) => ts2.write(r));
            const now = sim2.getSimTimeMs();
            const features = extractFeatures(
              robotId,
              ts2.window(robotId, ROBOT_SIGNALS[model], 4 * 3600000, now),
              now
            );
            features.failureMode = mode;
            const pred = predict(features, cal);
            if (!predictionFired && isPredictionFired(pred, cal, mode)) {
              predictionFired = true;
              fireTs = now;
            }
          }
          const truth = sim2.getScenarioTruth(robotId);
          if (
            predictionFired &&
            fireTs != null &&
            truth?.trueFailureTimeMs != null &&
            fireTs < truth.trueFailureTimeMs
          ) {
            row.tp += 1;
          }
        } finally {
          if (sim2.stop) sim2.stop();
        }
      }
    });
  }

  const recall = tp / Math.max(1, tp + fn);
  const falseAlarmRate = fp / Math.max(1, fp + tn);
  const medLead = median(leadTimes);
  const metricsFailed = recall < 0.8 || falseAlarmRate > 0.2 || medLead < 8;

  const modeBreakdown = {};
  runDiagnostics
    .filter((d) => d.runType === "failure")
    .forEach((d) => {
      const mode = d.scenarioFailureMode || "unknown";
      if (!modeBreakdown[mode]) modeBreakdown[mode] = { TP: 0, FN: 0 };
      modeBreakdown[mode][d.bucket] = (modeBreakdown[mode][d.bucket] || 0) + 1;
    });

  const report = {
    tp,
    fn,
    fp,
    tn,
    recall,
    falseAlarmRate,
    medianLeadHours: medLead,
    medianLeadTimeHours: medLead,
    leadTimes,
    thresholdRows,
    failureRuns,
    healthyRuns,
    maxTicks,
    runDiagnostics,
    modeBreakdown,
    elapsedMs: Date.now() - started
  };

  if (!opts.quiet) {
    printReport(report);
    if (metricsFailed) printRunDiagnostics(runDiagnostics);
  } else if (metricsFailed) {
    printRunDiagnostics(runDiagnostics);
  }

  return report;
}

function printReport(r) {
  console.log("\n=== Norfleet Predictive Validation Report ===\n");
  console.log(`Failure runs: ${r.failureRuns} · Healthy runs: ${r.healthyRuns} · Ticks/run: ${r.maxTicks}`);
  console.log(`Recall:              ${(r.recall * 100).toFixed(1)}% (target >= 80%)`);
  console.log(`False-alarm rate:    ${(r.falseAlarmRate * 100).toFixed(1)}% (target <= 20%)`);
  console.log(`Median lead time:    ${r.medianLeadHours.toFixed(1)}h (target >= 8h)`);
  console.log(`TP=${r.tp} FN=${r.fn} FP=${r.fp} TN=${r.tn} · ${r.elapsedMs}ms`);
  if (r.thresholdRows?.length && r.thresholdRows.some((row) => row.tp > 0 || row.fp > 0)) {
    console.log("\nPrecision/recall vs minProbability threshold:");
    r.thresholdRows.forEach((row) => {
      const prec = row.tp / Math.max(1, row.tp + row.fp);
      const rec = row.tp / Math.max(1, r.failureRuns);
      console.log(
        `  p>=${row.threshold.toFixed(2)}  recall=${(rec * 100).toFixed(0)}%  precision=${(prec * 100).toFixed(0)}%`
      );
    });
  }
  console.log("");
}

async function runValidationAsync(options = {}) {
  return Promise.resolve().then(() => runValidation(options));
}

if (require.main === module) {
  runValidationAsync()
    .then((r) => {
      if (r.recall < 0.8 || r.falseAlarmRate > 0.2 || r.medianLeadHours < 8) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  runValidation: runValidationAsync,
  runBacktest,
  printReport,
  printRunDiagnostics,
  median,
  modelForFailureMode,
  CLI_DEFAULTS,
  TEST_DEFAULTS,
  FAILURE_MODE_MODEL,
  N_FAILURE_RUNS: CLI_DEFAULTS.failureRuns,
  N_HEALTHY_RUNS: CLI_DEFAULTS.healthyRuns
};
