const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const chunks = [];
let failed = false;

for (let i = 1; i <= 3; i += 1) {
  chunks.push(`\n${"=".repeat(60)}\n=== RUN ${i} ===\n${"=".repeat(60)}\n`);
  const r = spawnSync(process.execPath, ["--test", "test"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    timeout: 600000
  });
  chunks.push(r.stdout || "");
  chunks.push(r.stderr || "");
  chunks.push(`\nEXIT: ${r.status ?? "null"}\n`);
  if (r.status !== 0) failed = true;
}

fs.writeFileSync(path.join(root, "_triple-test.txt"), chunks.join(""), "utf8");
process.exit(failed ? 1 : 0);
