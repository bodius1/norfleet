const path = require("path");
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 5050;

app.use(cors());
app.use(express.json());

const indexHtml = path.join(__dirname, "robotics_kpi_platform.html");
app.get("/", (_req, res) => {
  res.sendFile(indexHtml);
});

app.use(
  express.static(path.join(__dirname), {
    index: false
  })
);

const robots = [];
const fleets = [];
const fleetHistory = {};

function nextRobotId() {
  let max = 0;
  for (const r of robots) {
    const m = /^R-(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `R-${String(max + 1).padStart(3, "0")}`;
}

function nextFleetId() {
  let max = 0;
  for (const f of fleets) {
    const m = /^F-(\d+)$/.exec(f.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `F-${String(max + 1).padStart(3, "0")}`;
}

const modelToKpis = {
  Stretch: ["Throughput", "Cycle Time", "Uptime", "Battery Health"],
  LocusBot: ["Throughput", "Pick Accuracy", "Traffic Delay", "Battery Health"],
  Chuck: ["Pick Accuracy", "Error Rate", "Cycle Time", "Uptime"],
  CartConnect: ["Travel Time", "Task Completion", "Uptime", "Battery Health"]
};

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function ensureHistory(fleetId, kpis) {
  if (!fleetHistory[fleetId]) {
    fleetHistory[fleetId] = {};
  }
  kpis.forEach((kpi) => {
    if (!fleetHistory[fleetId][kpi]) {
      fleetHistory[fleetId][kpi] = Array.from({ length: 20 }, () => baselineForKpi(kpi));
    }
  });
}

/** Demo robots + fleet so the MVP shows KPI tags and live charts on first load */
function seedExampleFleet() {
  const demoRobots = [
    { id: "R-001", name: "Induction Alpha", model: "Stretch", warehouseZone: "A", taskProfile: "Multi-SKU pick", status: "active" },
    { id: "R-002", name: "Aisle Runner 12", model: "LocusBot", warehouseZone: "B", taskProfile: "Transport relay", status: "active" },
    { id: "R-003", name: "Sort Cell 3", model: "Chuck", warehouseZone: "C", taskProfile: "Sortation", status: "idle" },
    { id: "R-004", name: "Outbound Cart", model: "CartConnect", warehouseZone: "D", taskProfile: "Cart-to-station", status: "charging" }
  ];
  demoRobots.forEach((r) => robots.push({ ...r }));

  const kpis = Array.from(
    new Set(demoRobots.flatMap((r) => modelToKpis[r.model] || ["Throughput", "Uptime"]))
  );
  const demoFleet = {
    id: "F-001",
    name: "Example — Sort Center East Wing",
    robotIds: demoRobots.map((r) => r.id),
    kpis,
    createdAt: new Date().toISOString(),
    isExample: true
  };
  fleets.push(demoFleet);
  ensureHistory(demoFleet.id, demoFleet.kpis);
}

seedExampleFleet();

function baselineForKpi(kpi) {
  if (kpi === "Throughput") return randomBetween(450, 750);
  if (kpi === "Cycle Time") return randomBetween(3.8, 5.6);
  if (kpi === "Uptime") return randomBetween(93, 99.2);
  if (kpi === "Battery Health") return randomBetween(70, 98);
  if (kpi === "Pick Accuracy") return randomBetween(96.8, 99.8);
  if (kpi === "Traffic Delay") return randomBetween(1.2, 3.6);
  if (kpi === "Error Rate") return randomBetween(0.3, 2.1);
  if (kpi === "Travel Time") return randomBetween(4.2, 8.1);
  if (kpi === "Task Completion") return randomBetween(90, 99);
  return randomBetween(1, 10);
}

function jitterValue(kpi, value) {
  const delta = kpi === "Cycle Time" || kpi === "Traffic Delay" || kpi === "Error Rate" || kpi === "Travel Time" ? 0.08 : 0.03;
  return Math.max(0.05, value * (1 + (Math.random() * 2 - 1) * delta));
}

function summarizeFleet(fleet) {
  const assigned = robots.filter((r) => fleet.robotIds.includes(r.id));
  const active = assigned.filter((r) => r.status === "active").length;
  const idle = assigned.filter((r) => r.status === "idle").length;
  const charging = assigned.filter((r) => r.status === "charging").length;
  return { total: assigned.length, active, idle, charging };
}

async function aiDetectKpis(fleet, assignedRobots) {
  const defaults = Array.from(new Set(assignedRobots.flatMap((r) => modelToKpis[r.model] || ["Throughput", "Uptime"])));
  if (!process.env.OPENAI_API_KEY) return defaults;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = `Given this fleet: ${JSON.stringify(assignedRobots.map((r) => ({ model: r.model, taskProfile: r.taskProfile })))} return 4 to 6 KPI names as a JSON array of strings for warehouse robotics monitoring.`;
  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an industrial robotics KPI expert. Output JSON only." },
        { role: "user", content: prompt }
      ]
    });
    const content = resp.choices[0]?.message?.content || "[]";
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length) return parsed.slice(0, 6);
    return defaults;
  } catch {
    return defaults;
  }
}

app.get("/api/robots", (_req, res) => res.json(robots));

app.post("/api/robots", (req, res) => {
  const { name, model, warehouseZone, taskProfile } = req.body || {};
  if (!name || !model || !warehouseZone) {
    return res.status(400).json({ error: "name, model, and warehouseZone are required" });
  }
  const id = `R-${String(robots.length + 1).padStart(3, "0")}`;
  const robot = {
    id,
    name,
    model,
    warehouseZone,
    taskProfile: taskProfile || "General Picking",
    status: "active"
  };
  robots.push(robot);
  return res.status(201).json(robot);
});

app.get("/api/fleets", (_req, res) => {
  const expanded = fleets.map((f) => ({ ...f, summary: summarizeFleet(f) }));
  res.json(expanded);
});

app.post("/api/fleets", (req, res) => {
  const { name, robotIds } = req.body || {};
  if (!name || !Array.isArray(robotIds) || robotIds.length === 0) {
    return res.status(400).json({ error: "name and robotIds[] are required" });
  }
  const id = nextFleetId();
  const fleet = { id, name, robotIds, kpis: ["Throughput", "Uptime"], createdAt: new Date().toISOString() };
  fleets.push(fleet);
  ensureHistory(id, fleet.kpis);
  return res.status(201).json(fleet);
});

app.post("/api/fleets/:fleetId/detect-kpis", async (req, res) => {
  const fleet = fleets.find((f) => f.id === req.params.fleetId);
  if (!fleet) return res.status(404).json({ error: "fleet not found" });
  const assignedRobots = robots.filter((r) => fleet.robotIds.includes(r.id));
  const detected = await aiDetectKpis(fleet, assignedRobots);
  fleet.kpis = detected;
  ensureHistory(fleet.id, detected);
  return res.json({ fleetId: fleet.id, kpis: detected });
});

app.get("/api/fleets/:fleetId/metrics", (req, res) => {
  const fleet = fleets.find((f) => f.id === req.params.fleetId);
  if (!fleet) return res.status(404).json({ error: "fleet not found" });
  ensureHistory(fleet.id, fleet.kpis);
  res.json({ fleetId: fleet.id, kpis: fleet.kpis, series: fleetHistory[fleet.id] });
});

app.get("/api/stream", (req, res) => {
  const fleetId = req.query.fleetId;
  const fleet = fleets.find((f) => f.id === fleetId);
  if (!fleet) {
    res.status(400).json({ error: "valid fleetId query parameter required" });
    return;
  }
  ensureHistory(fleet.id, fleet.kpis);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = () => {
    robots.forEach((r) => {
      const roll = Math.random();
      if (roll < 0.75) r.status = "active";
      else if (roll < 0.88) r.status = "idle";
      else r.status = "charging";
    });
    fleet.kpis.forEach((kpi) => {
      const arr = fleetHistory[fleet.id][kpi];
      const next = jitterValue(kpi, arr[arr.length - 1]);
      arr.push(Number(next.toFixed(2)));
      if (arr.length > 30) arr.shift();
    });
    const payload = {
      fleetId: fleet.id,
      summary: summarizeFleet(fleet),
      kpis: fleet.kpis,
      series: fleetHistory[fleet.id]
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send();
  const intv = setInterval(send, 2500);
  req.on("close", () => clearInterval(intv));
});

app.listen(PORT, () => {
  console.log(`Norfleet MVP running at http://localhost:${PORT}`);
});
