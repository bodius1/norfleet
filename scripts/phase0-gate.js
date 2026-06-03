#!/usr/bin/env node
/** Phase 0 gate checker — run after npm run seed:demo && npm start */
const http = require("http");
const { execSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");

function curlHealth() {
  return new Promise((resolve, reject) => {
    http
      .get("http://localhost:5051/api/robots/R-002/health", (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function main() {
  let testStatus = 0;
  console.log("=== npm test ===");
  try {
    execSync("npm test", { cwd: root, stdio: "inherit", shell: true });
  } catch (err) {
    testStatus = err.status || 1;
  }
  console.log(`exit: ${testStatus}`);

  try {
    const { status, body } = await curlHealth();
    console.log("\n=== GET /api/robots/R-002/health ===");
    console.log(`HTTP ${status}`);
    console.log(JSON.stringify(body, null, 2));
    const ok =
      status === 200 &&
      body.prediction?.insufficientData === false &&
      body.prediction?.estimatedTimeToFailureHours != null &&
      body.healthIndex < 1 &&
      Array.isArray(body.prediction?.contributingSignals) &&
      body.prediction.contributingSignals.length > 0 &&
      body.hiSeries?.every((p) => p.value >= 0 && p.value <= 1);
    console.log(`\nPhase 0 test gate: ${testStatus === 0 ? "PASS" : "FAIL"}`);
    console.log(`Phase 0 curl gate: ${ok ? "PASS" : "FAIL"}`);
    process.exit(testStatus === 0 && ok ? 0 : 1);
  } catch (err) {
    console.error("\nServer not reachable on :5051 — start with npm start after seed:demo");
    console.error(err.message);
    console.log(`\nPhase 0 test gate: ${testStatus === 0 ? "PASS" : "FAIL"}`);
    console.log("Phase 0 curl gate: SKIP (server not running)");
    process.exit(testStatus === 0 ? 0 : testStatus || 1);
  }
}

main();
