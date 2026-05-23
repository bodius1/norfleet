#!/usr/bin/env node
/**
 * Backtest harness — scores predictor on simulated life-runs with known failure times.
 */
const { createSimulator } = require("../telemetry/simulator");
const { createTimeSeriesStore } = require("../store/timeSeriesStore");
const { createJsonRepository } = require("../store/persistence");
const { extractFeatures, inferFailureMode } = require("../predictor/features");
const { predict } = require("../predictor/failurePredictor");
const { DEFAULT_CALIBRATION, applyOutcome } = require("../predictor/calibration");
const { ROBOT_SIGNALS } = require("../telemetry/simulator");

const N_FAILURE_RUNS = 20;
const N_HEALTHY_RUNS = 12;
const STEPS = 280;

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function runLifeCycle(sim, ts, robotId, model, mode, calibration, inject) {
  sim.registerRobot(robotId, model);
  if (inject) {
    sim.injectFailure(robotId, mode, { progress: 0.22, leadTimeMs: 14 * 3600000 });
  }

  let alerted = false;
  let alertTs = null;

  for (let step = 0; step < STEPS; step += 1) {
    sim.tick().forEach((r) => ts.write(r));
    const now = sim.getSimTimeMs();
    const signals = ROBOT_SIGNALS[model];
    const features = extractFeatures(robotId, ts.window(robotId, signals, 4 * 3600000, now), now);
    if (inject) features.failureMode = mode;
    else features.failureMode = inferFailureMode(features);
    const pred = predict(features, calibration);
    if (pred.alert && !alerted) {
      alerted = true;
      alertTs = now;
    }
  }

  const snap = sim.getValidationSnapshot().find((x) => x.robotId === robotId);
  return { alerted, alertTs, failed: Boolean(snap?.failed), trueFailureTimeMs: snap?.trueFailureTimeMs };
}

function runBacktest(calibration = DEFAULT_CALIBRATION) {
  const repo = createJsonRepository();
  repo.clearAll();
  const ts = createTimeSeriesStore(repo);
  const sim = createSimulator({ tickIntervalMs: 60000 });

  let tp = 0;
  let fn = 0;
  let fp = 0;
  let tn = 0;
  const leadTimes = [];
  const thresholdRows = [0.35, 0.4, 0.45, 0.5, 0.55].map((t) => ({ threshold: t, tp: 0, fp: 0 }));

  const modes = ["bearing_wear", "battery_degradation", "motor_creep", "pick_drift"];
  for (let run = 0; run < N_FAILURE_RUNS; run += 1) {
    const robotId = `R-F${run}`;
    const mode = modes[run % 4];
    const model = run % 2 ? "LocusBot" : "Chuck";
    const result = runLifeCycle(sim, ts, robotId, model, mode, calibration, true);
    if (result.alerted && result.failed) {
      tp += 1;
      if (result.alertTs && result.trueFailureTimeMs) {
        leadTimes.push((result.trueFailureTimeMs - result.alertTs) / 3600000);
      }
    } else if (!result.alerted && result.failed) fn += 1;
    else if (result.alerted && !result.failed) fp += 1;
    else tn += 1;
  }

  for (let run = 0; run < N_HEALTHY_RUNS; run += 1) {
    const robotId = `R-H${run}`;
    const model = run % 2 ? "Stretch" : "CartConnect";
    const result = runLifeCycle(sim, ts, robotId, model, null, calibration, false);
    if (result.alerted) fp += 1;
    else tn += 1;
  }

  thresholdRows.forEach((row) => {
    for (let run = 0; run < N_FAILURE_RUNS; run += 1) {
      const robotId = `R-T${run}`;
      const mode = modes[run % 4];
      const model = run % 2 ? "LocusBot" : "Chuck";
      const sim2 = createSimulator({ tickIntervalMs: 60000 });
      const ts2 = createTimeSeriesStore(repo);
      sim2.registerRobot(robotId, model);
      sim2.injectFailure(robotId, mode, { progress: 0.22, leadTimeMs: 14 * 3600000 });
      let alerted = false;
      const cal = { ...calibration, [mode]: { ...calibration[mode], minProbability: row.threshold } };
      for (let step = 0; step < STEPS; step += 1) {
        sim2.tick().forEach((r) => ts2.write(r));
        const now = sim2.getSimTimeMs();
        const features = extractFeatures(robotId, ts2.window(robotId, ROBOT_SIGNALS[model], 4 * 3600000, now), now);
        features.failureMode = mode;
        if (predict(features, cal).alert) alerted = true;
      }
      const failed = sim2.getValidationSnapshot().find((x) => x.robotId === robotId)?.failed;
      if (alerted && failed) row.tp += 1;
      if (alerted && !failed) row.fp += 1;
    }
  });

  const recall = tp / Math.max(1, tp + fn);
  const falseAlarmRate = fp / Math.max(1, fp + tn);
  const medLead = median(leadTimes);

  return { tp, fn, fp, tn, recall, falseAlarmRate, medianLeadHours: medLead, leadTimes, thresholdRows };
}

function printReport(r) {
  console.log("\n=== Norfleet Predictive Validation Report ===\n");
  console.log(`Failure runs: ${N_FAILURE_RUNS} · Healthy runs: ${N_HEALTHY_RUNS}`);
  console.log(`Recall:              ${(r.recall * 100).toFixed(1)}% (target >= 80%)`);
  console.log(`False-alarm rate:    ${(r.falseAlarmRate * 100).toFixed(1)}% (target <= 20%)`);
  console.log(`Median lead time:    ${r.medianLeadHours.toFixed(1)}h (target >= 8h)`);
  console.log(`TP=${r.tp} FN=${r.fn} FP=${r.fp} TN=${r.tn}`);
  console.log("\nPrecision/recall vs minProbability threshold:");
  r.thresholdRows.forEach((row) => {
    const prec = row.tp / Math.max(1, row.tp + row.fp);
    const rec = row.tp / N_FAILURE_RUNS;
    console.log(`  p>=${row.threshold.toFixed(2)}  recall=${(rec * 100).toFixed(0)}%  precision=${(prec * 100).toFixed(0)}%`);
  });
  console.log("");
}

if (require.main === module) {
  const r = runBacktest();
  printReport(r);
  if (r.recall < 0.8 || r.falseAlarmRate > 0.2 || r.medianLeadHours < 8) {
    process.exit(1);
  }
}

module.exports = { runBacktest, printReport, median, N_FAILURE_RUNS, N_HEALTHY_RUNS };
