#!/usr/bin/env node
/**
 * Demo seed: healthy fleet + R-002 mid bearing degradation.
 */
const path = require("path");
const { createPlatform } = require("../services/norfleetPlatform");
const { DATA_DIR } = require("../store/persistence");
const fs = require("fs");

function baselineForKpi(kpi) {
  const r = (a, b) => a + Math.random() * (b - a);
  if (kpi === "Throughput") return r(450, 750);
  if (kpi === "Cycle Time") return r(3.8, 5.6);
  if (kpi === "Uptime") return r(93, 99.2);
  if (kpi === "Battery Health") return r(70, 98);
  if (kpi === "Pick Accuracy") return r(96.8, 99.8);
  if (kpi === "Traffic Delay") return r(1.2, 3.6);
  if (kpi === "Error Rate") return r(0.3, 2.1);
  if (kpi === "Travel Time") return r(4.2, 8.1);
  if (kpi === "Task Completion") return r(90, 99);
  return r(1, 10);
}

const platform = createPlatform();
if (fs.existsSync(DATA_DIR)) {
  platform.repo.clearAll();
}
platform.seedExampleFleet(baselineForKpi);
platform.seedDemoScenario();
platform.runAllPredictions();
console.log("Demo scenario seeded. R-002 bearing_wear ~58% progress.");
console.log("Start server: npm start");
console.log("Open Fleet Health view and use Fast-Forward (60x) for live demo arc.");
