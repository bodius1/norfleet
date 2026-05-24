#!/usr/bin/env node
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const chunks = [];
let failed = false;

function run(label, cmd, args) {
  chunks.push(`\n${"=".repeat(60)}\n${label}\n${"=".repeat(60)}\n`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    shell: true,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 50 * 1024 * 1024
  });
  chunks.push(r.stdout || "");
  chunks.push(r.stderr || "");
  chunks.push(`\nEXIT: ${r.status ?? "null"}\n`);
  if (r.status !== 0) failed = true;
}

for (let i = 1; i <= 3; i += 1) {
  run(`=== RUN ${i} ===`, "npm", ["test"]);
}

const outPath = path.join(root, "_triple-test.txt");
fs.writeFileSync(outPath, chunks.join(""), "utf8");
console.log(chunks.join(""));
console.log(`\nWrote ${outPath}`);
process.exit(failed ? 1 : 0);
