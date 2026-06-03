#!/usr/bin/env node
/**
 * Phase 2 gate runner — writes results to gate-output.txt
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const root = path.join(__dirname, "..");
const out = [];

function log(line) {
  out.push(String(line));
}

function runCmd(label, cmd, args) {
  log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: true, timeout: 300000 });
  if (r.stdout) log(r.stdout);
  if (r.stderr) log(r.stderr);
  log(`exit: ${r.status}`);
  return r.status;
}

function httpJson(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: "localhost",
        port: 5051,
        path: urlPath,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {}
      },
      (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function e2e() {
  log("\n=== E2E curl-equivalent ===");
  try {
    const report = await httpJson("GET", "/api/technician/dispatch-report");
    log("GET /api/technician/dispatch-report");
    log(JSON.stringify(report.body, null, 2));
    const dispatchId = report.body?.dispatches?.[0]?.dispatchId;
    if (!dispatchId) {
      log("ERROR: no actionable dispatch found");
      return 1;
    }
    log(`dispatchId: ${dispatchId}`);

    const create1 = await httpJson("POST", `/api/dispatch/${encodeURIComponent(dispatchId)}/work-order`, {
      technicianId: "tech-gate"
    });
    log("\nPOST /api/dispatch/.../work-order (first)");
    log(JSON.stringify(create1.body, null, 2));

    const list = await httpJson("GET", "/api/work-orders");
    log("\nGET /api/work-orders");
    log(JSON.stringify(list.body, null, 2));

    const workOrderId = create1.body?.workOrder?.workOrderId;
    if (!workOrderId) {
      log("ERROR: no workOrderId from create");
      return 1;
    }

    const resolve = await httpJson("POST", `/api/work-orders/${encodeURIComponent(workOrderId)}/resolve`, {
      outcome: "confirmed_failure",
      actionTaken: "Gate test repair",
      repairMinutes: 30,
      technicianId: "tech-gate"
    });
    log("\nPOST /api/work-orders/.../resolve");
    log(JSON.stringify(resolve.body, null, 2));

    const create2 = await httpJson("POST", `/api/dispatch/${encodeURIComponent(dispatchId)}/work-order`, {
      technicianId: "tech-gate"
    });
    log("\nPOST /api/dispatch/.../work-order (duplicate check)");
    log(JSON.stringify(create2.body, null, 2));
    log(`duplicate flag: ${create2.body?.duplicate}`);

    return 0;
  } catch (err) {
    log(`E2E ERROR: ${err.message}`);
    return 1;
  }
}

async function main() {
  const t1 = runCmd("npm test", "npm", ["test"]);
  const t2 = runCmd("npm run test:stability", "npm", ["run", "test:stability"]);
  const t3 = await e2e();
  log(`\n=== GATE SUMMARY ===\nnpm test exit: ${t1}\nnpm run test:stability exit: ${t2}\ne2e exit: ${t3}`);
  const file = path.join(root, "gate-output.txt");
  fs.writeFileSync(file, out.join("\n"), "utf8");
  console.log(`Wrote ${file}`);
  process.exit(t1 || t2 || t3 ? 1 : 0);
}

main();
