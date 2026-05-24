#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { createPlatform } = require("../services/norfleetPlatform");
const { ROBOT_SIGNALS } = require("../telemetry/simulator");

function baselineForKpi(kpi) {
  return 50 + Math.random() * 10;
}

const out = [];
function log(line) {
  out.push(line);
  console.log(line);
}

const platform = createPlatform();
platform.repo.clearAll?.();
platform.seedExampleFleet(baselineForKpi);
platform.seedDemoScenario();

const robotId = "R-002";
const robot = platform.repo.getRobots().find((r) => r.id === robotId);
const signals = ROBOT_SIGNALS[robot.model];
const ts = platform.simulator.getSimTimeMs();

log(`Robot ${robotId} model=${robot.model}`);
log(`Expected signals: ${signals.join(", ")}`);

const counts = platform.timeSeries.countBySignal(robotId, signals);
log("Hot buffer counts after seedDemoScenario:");
signals.forEach((s) => log(`  ${s}: ${counts[s]}`));

const window = platform.timeSeries.window(robotId, signals, 3600000, ts);
log("Window lengths:");
signals.forEach((s) => log(`  ${s}: ${(window[s] || []).length}`));

// Sample latest reading keys from simulator
platform.simulator.registerRobot("R-DIAG", robot.model);
const reading = platform.simulator.tick().find((r) => r.robotId === "R-DIAG");
log(`Simulator reading keys: ${Object.keys(reading.signals).join(", ")}`);

const payload = platform.getRobotHealthPayload(robotId);
log("\nHealth payload:");
log(JSON.stringify(payload, null, 2));

// Run tests
const { spawnSync } = require("child_process");
const test = spawnSync(process.execPath, ["--test", "test t"], {
  cwd: path.join(__dirname, ".."),
  encoding: "utf8",
  timeout: 120000,
  shell: false
});
// fix test path
const test2 = spawnSync(process.execPath, ["--test", "test"], {
  cwd: path.join(__dirname, ".."),
  encoding: "utf8",
  timeout: 120000
});
log("\n=== npm test ===");
log(test2.stdout?.toString() || "");
log(test2.stderr?.toString() || "");
log(`exit: ${test2.status}`);

fs.writeFileSync(path.join(__dirname, "..", "phase0-diagnose.txt"), out.join("\n"));
