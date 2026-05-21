const path = require("path");
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { DEFAULT_MODELS, generateJson } = require("./aiProvider");
const { detectKpiAnomalies } = require("./anomalyDetector");
const { createRuntimeTools, createAgentDefinitions } = require("./toolExecutor");
const {
  config,
  getSettingsSnapshot,
  updateAiSettings,
  updateDataSettings,
  clearStoredKeys,
  resolveProviderAuth,
  requireAdminIfConfigured
} = require("./config/settings");
const runtimeStore = require("./state/runtimeStore");
const {
  validateAnalyzeKpisInput,
  validateTechnicianReportInput,
  validateRecommendUpdatesInput,
  validateRootCauseInput,
  validateFeedbackInput
} = require("./validation");

const app = express();
const PORT = config.env.PORT;

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
app.use("/api/settings", requireAdminIfConfigured);
app.use("/api/tools", requireAdminIfConfigured);

runtimeStore.setActiveAgentsRuntime(createAgentDefinitions());

const runtimeTools = createRuntimeTools({
  robots: runtimeStore.getRobots(),
  fleets: runtimeStore.getFleets(),
  fleetHistory: runtimeStore.getFleetHistoryRef(),
  ticketStore: runtimeStore.getTechnicianTickets(),
  feedbackStore: runtimeStore.getTechnicianFeedbackHistory()
});

const modelToKpis = {
  Stretch: ["Throughput", "Cycle Time", "Uptime", "Battery Health"],
  LocusBot: ["Throughput", "Pick Accuracy", "Traffic Delay", "Battery Health"],
  Chuck: ["Pick Accuracy", "Error Rate", "Cycle Time", "Uptime"],
  CartConnect: ["Travel Time", "Task Completion", "Uptime", "Battery Health"]
};

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

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

/** Demo robots + fleet so the MVP shows KPI tags and live charts on first load */
function seedExampleFleet() {
  const demoRobots = [
    { id: "R-001", name: "Induction Alpha", model: "Stretch", warehouseZone: "A", taskProfile: "Multi-SKU pick", status: "active" },
    { id: "R-002", name: "Aisle Runner 12", model: "LocusBot", warehouseZone: "B", taskProfile: "Transport relay", status: "active" },
    { id: "R-003", name: "Sort Cell 3", model: "Chuck", warehouseZone: "C", taskProfile: "Sortation", status: "idle" },
    { id: "R-004", name: "Outbound Cart", model: "CartConnect", warehouseZone: "D", taskProfile: "Cart-to-station", status: "charging" }
  ];
  demoRobots.forEach((r) => runtimeStore.addRobot({ ...r }));

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
  runtimeStore.addFleet(demoFleet);
  runtimeStore.ensureHistory(demoFleet.id, demoFleet.kpis, baselineForKpi);
}

seedExampleFleet();

function normalizeSeverity(v) {
  const s = String(v || "").toLowerCase();
  if (s === "critical" || s === "high" || s === "medium" || s === "low") return s[0].toUpperCase() + s.slice(1);
  return "Medium";
}

function fallbackAnalyzeKpis(payload, anomalies) {
  const fleetName = payload.activeFleet?.name || "selected fleet";
  return {
    summary: `Detected ${anomalies.length} KPI anomalies in ${fleetName}.`,
    anomalies: anomalies.map((a, i) => ({
      kpi: a.kpi,
      robotId: payload.robots?.[i % Math.max(1, (payload.robots || []).length)]?.id || "R-003",
      zone: payload.robots?.[i % Math.max(1, (payload.robots || []).length)]?.warehouseZone || "Sort Cell 3",
      severity: normalizeSeverity(a.severity),
      likelyCause: `Deviation from baseline (${a.deltaPct}%) likely tied to route, load, or calibration drift.`,
      recommendedAction: `Review ${a.kpi} SOP and queue targeted maintenance for affected cells.`,
      confidence: 0.79
    })),
    recommendations: anomalies.map((a, i) => ({
      id: `auto-rec-${i + 1}`,
      title: `${a.kpi} mitigation`,
      reason: `${a.kpi} changed ${a.deltaPct}% from baseline.`,
      source: "KPI Monitor"
    }))
  };
}

function fallbackTechnicianReport(payload) {
  const anomalies = payload.anomalies || [];
  const actions = anomalies.map((a, i) => ({
    id: `act-${i + 1}`,
    title: `${a.kpi} corrective action`,
    source: "KPI Monitor",
    severity: normalizeSeverity(a.severity),
    affectedRobots: [a.robotId || "R-003"],
    actionType: i % 2 === 0 ? "Agent workflow update" : "Technician task",
    explanation: a.recommendedAction || "Review anomaly context and apply corrective maintenance.",
    buttonLabel: i % 2 === 0 ? "Apply to Agent Builder" : "Send to Technician",
    autoFixEligible: i % 2 === 0,
    requiresHumanApproval: true
  }));
  return {
    reportSummary: {
      totalAnomalies: anomalies.length,
      recommendedActions: actions.length,
      autoFixEligible: actions.filter((x) => x.autoFixEligible).length,
      technicianApprovalRequired: actions.filter((x) => x.requiresHumanApproval).length,
      estimatedDowntimeAvoided: `${Math.max(6, actions.length * 4)}h`
    },
    actions
  };
}

function fallbackAgentUpdates(payload) {
  const anomalies = payload.kpiAnomalies || [];
  const out = [];
  if (anomalies.some((a) => a.kpi === "Pick Accuracy")) {
    out.push({
      type: "create_agent",
      agentName: "Pick Accuracy Monitor Agent",
      reason: "Pick Accuracy repeatedly dropped below threshold.",
      fields: {
        role: "Detect and triage pick-failure clusters",
        triggerCondition: "Pick Accuracy < 92% for 3 windows",
        assignedTask: "Correlate failures with SKU mix and end-effector drift",
        priority: "P1",
        status: "active"
      }
    });
  }
  if (anomalies.some((a) => a.kpi === "Travel Time")) {
    out.push({
      type: "change_threshold",
      agentName: "Root Cause Agent",
      reason: "Travel Time anomaly trend is rising.",
      fields: {
        triggerCondition: ">=2 similar faults in 2h (travel-time tuned)",
        assignedTask: "Prioritize route-delay signal in ranking",
        status: "active"
      }
    });
  }
  return { agentUpdates: out };
}

function fallbackRootCause(payload) {
  return {
    likelyRootCause: "Route congestion with secondary dock alignment drift.",
    confidence: 0.78,
    supportingEvidence: [
      "Traffic Delay and Travel Time both above baseline.",
      "Recent log lines mention retry and queue conditions."
    ],
    recommendedFixes: [
      "Run route decongestion profile in affected zone.",
      "Inspect charging dock alignment for implicated robot."
    ],
    escalationNeeded: true
  };
}

function jitterValue(kpi, value) {
  const delta = kpi === "Cycle Time" || kpi === "Traffic Delay" || kpi === "Error Rate" || kpi === "Travel Time" ? 0.08 : 0.03;
  return Math.max(0.05, value * (1 + (Math.random() * 2 - 1) * delta));
}

function summarizeFleet(fleet) {
  const assigned = runtimeStore.getRobots().filter((r) => fleet.robotIds.includes(r.id));
  const active = assigned.filter((r) => r.status === "active").length;
  const idle = assigned.filter((r) => r.status === "idle").length;
  const charging = assigned.filter((r) => r.status === "charging").length;
  return { total: assigned.length, active, idle, charging };
}

async function aiDetectKpis(fleet, assignedRobots) {
  const defaults = Array.from(new Set(assignedRobots.flatMap((r) => modelToKpis[r.model] || ["Throughput", "Uptime"])));
  if (!config.env.OPENAI_API_KEY) return defaults;

  const client = new OpenAI({ apiKey: config.env.OPENAI_API_KEY });
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

app.get("/api/settings", (_req, res) => {
  const calls = runtimeStore.getAiSessionCalls();
  const recent = calls[calls.length - 1] || null;
  return res.json({
    settings: getSettingsSnapshot(),
    aiUsage: {
      callsThisSession: calls.length,
      lastCall: recent
    }
  });
});

app.post("/api/settings/ai", (req, res) => {
  updateAiSettings(req.body || {});
  return res.json({ ok: true, settings: getSettingsSnapshot() });
});

app.post("/api/settings/data", (req, res) => {
  updateDataSettings(req.body || {});
  return res.json({ ok: true, settings: getSettingsSnapshot() });
});

app.post("/api/settings/test-connection", async (_req, res) => {
  const auth = resolveProviderAuth();
  if (auth.provider === "mock") {
    return res.json({ status: "Built-in assistant ready", connected: true, provider: "mock" });
  }
  const out = await generateJson({
    provider: auth.provider,
    model: auth.model,
    apiKey: auth.apiKey,
    role: "Connectivity tester",
    task: "Return JSON {\"ok\":true} only.",
    data: {},
    constraints: ["No prose", "Strict JSON"],
    outputSchema: { ok: "boolean" },
    examples: [{ ok: true }],
    schemaFallback: { ok: true }
  });
  runtimeStore.pushAiSessionCall({ endpoint: "settings-test", ...out.meta, status: "ok", timestamp: new Date().toISOString() });
  return res.json({ status: "Connected", connected: true, provider: out.meta.provider, model: out.meta.model, meta: out.meta });
});

app.post("/api/settings/clear-keys", (_req, res) => {
  clearStoredKeys();
  return res.json({ ok: true, settings: getSettingsSnapshot() });
});

app.get("/api/ai/runtime", (_req, res) => {
  const calls = runtimeStore.getAiSessionCalls();
  return res.json({
    agents: runtimeStore.getActiveAgentsRuntime(),
    sessionCalls: calls.length,
    lastCall: calls[calls.length - 1] || null
  });
});

app.post("/api/ai/analyze-kpis", async (req, res) => {
  const payload = req.body || {};
  const valid = validateAnalyzeKpisInput(payload);
  if (!valid.ok) return res.status(400).json({ error: valid.error });
  const thresholds = payload.thresholds || {
    "Pick Accuracy": { min: 92, maxDeltaPct: 8 },
    "Travel Time": { max: 9, maxDeltaPct: 15 },
    "Error Rate": { max: 2.5, maxDeltaPct: 25 },
    "Battery Health": { min: 72, maxDeltaPct: 12 },
    "Traffic Delay": { max: 4.5, maxDeltaPct: 20 },
    Uptime: { min: 92, maxDeltaPct: 8 },
    "Cycle Time": { max: 6.2, maxDeltaPct: 12 }
  };
  const anomalies = detectKpiAnomalies(payload.kpiHistory || {}, thresholds);
  const ragContext = runtimeTools.retrieveMaintenanceKnowledge("kpi anomaly maintenance guidance");
  const fallback = fallbackAnalyzeKpis(payload, anomalies);
  const auth = resolveProviderAuth();
  const out = await generateJson({
    provider: auth.provider,
    model: auth.model,
    apiKey: auth.apiKey,
    role: "Norfleet KPI Anomaly Agent",
    task: "Analyze KPI anomalies and output structured JSON recommendations.",
    data: {
      currentKpiValues: payload.currentKpiValues || {},
      kpiHistory: payload.kpiHistory || {},
      robots: payload.robots || [],
      activeFleet: payload.activeFleet || null,
      activeAgentConfiguration: payload.activeAgentConfiguration || {},
      technicianFeedbackHistory: payload.technicianFeedbackHistory || [],
      deterministicAnomalies: anomalies,
      ragContext
    },
    constraints: [
      "Return valid JSON only.",
      "Reference KPI anomaly source and affected robots.",
      "Do not suggest destructive automation."
    ],
    outputSchema: {
      summary: "string",
      anomalies: [
        {
          kpi: "string",
          robotId: "string",
          zone: "string",
          severity: "High|Medium|Low|Critical",
          likelyCause: "string",
          recommendedAction: "string",
          confidence: "number"
        }
      ],
      recommendations: ["object"]
    },
    examples: [fallback],
    schemaFallback: fallback
  });
  runtimeStore.pushAiSessionCall({ endpoint: "analyze-kpis", ...out.meta, status: "ok", timestamp: new Date().toISOString() });
  return res.json({ ...out.data, metadata: out.meta, deterministicAnomalies: anomalies });
});

app.post("/api/ai/generate-technician-report", async (req, res) => {
  const payload = req.body || {};
  const valid = validateTechnicianReportInput(payload);
  if (!valid.ok) return res.status(400).json({ error: valid.error });
  const fallback = fallbackTechnicianReport(payload);
  const auth = resolveProviderAuth();
  const out = await generateJson({
    provider: auth.provider,
    model: auth.model,
    apiKey: auth.apiKey,
    role: "Norfleet Technician Report Generator",
    task: "Generate AI-generated maintenance actions from anomalies and workflow context.",
    data: {
      anomalies: payload.anomalies || [],
      activeAgents: payload.activeAgents || [],
      robotLogs: payload.robotLogs || [],
      technicianNotes: payload.technicianNotes || runtimeStore.getTechnicianFeedbackHistory(),
      currentWorkflow: payload.currentWorkflow || {}
    },
    constraints: [
      "Valid JSON only.",
      "Include source, severity, action type, and approval flags.",
      "Prefer safe, reviewable actions."
    ],
    outputSchema: {
      reportSummary: {
        totalAnomalies: "number",
        recommendedActions: "number",
        autoFixEligible: "number",
        technicianApprovalRequired: "number",
        estimatedDowntimeAvoided: "string"
      },
      actions: ["object"]
    },
    examples: [fallback],
    schemaFallback: fallback
  });
  runtimeStore.pushAiSessionCall({ endpoint: "generate-technician-report", ...out.meta, status: "ok", timestamp: new Date().toISOString() });
  return res.json({ ...out.data, metadata: out.meta });
});

app.post("/api/ai/recommend-agent-updates", async (req, res) => {
  const payload = req.body || {};
  const valid = validateRecommendUpdatesInput(payload);
  if (!valid.ok) return res.status(400).json({ error: valid.error });
  const fallback = fallbackAgentUpdates(payload);
  const auth = resolveProviderAuth();
  const out = await generateJson({
    provider: auth.provider,
    model: auth.model,
    apiKey: auth.apiKey,
    role: "Norfleet Agent Workflow Update Recommender",
    task: "Recommend safe workflow updates for agentic maintenance operations.",
    data: {
      currentAgentWorkflow: payload.currentAgentWorkflow || {},
      kpiAnomalies: payload.kpiAnomalies || [],
      repeatedFailures: payload.repeatedFailures || [],
      technicianFeedback: payload.technicianFeedback || runtimeStore.getTechnicianFeedbackHistory()
    },
    constraints: ["Valid JSON only.", "No destructive automatic changes."],
    outputSchema: {
      agentUpdates: [
        {
          type: "create_agent|modify_agent|change_threshold",
          agentName: "string",
          reason: "string",
          fields: "object"
        }
      ]
    },
    examples: [fallback],
    schemaFallback: fallback
  });
  runtimeStore.pushAiSessionCall({ endpoint: "recommend-agent-updates", ...out.meta, status: "ok", timestamp: new Date().toISOString() });
  return res.json({ ...out.data, metadata: out.meta });
});

app.post("/api/ai/root-cause", async (req, res) => {
  const payload = req.body || {};
  const valid = validateRootCauseInput(payload);
  if (!valid.ok) return res.status(400).json({ error: valid.error });
  const context = runtimeTools.retrieveMaintenanceKnowledge(
    `${payload.kpiAnomaly?.kpi || "kpi"} root cause ${payload.robotId || ""}`
  );
  const fallback = fallbackRootCause(payload);
  const auth = resolveProviderAuth();
  const out = await generateJson({
    provider: auth.provider,
    model: auth.model,
    apiKey: auth.apiKey,
    role: "Norfleet Root Cause Agent",
    task: "Analyze robot issue and produce root-cause JSON.",
    data: {
      robotId: payload.robotId,
      kpiAnomaly: payload.kpiAnomaly,
      recentLogs: payload.recentLogs || runtimeTools.getRobotLogs(payload.robotId || "R-003"),
      maintenanceHistory: payload.maintenanceHistory || runtimeStore.getTechnicianFeedbackHistory(),
      retrievedContext: context
    },
    constraints: ["Valid JSON only.", "Ground reasons in logs/history/context."],
    outputSchema: {
      likelyRootCause: "string",
      confidence: "number",
      supportingEvidence: ["string"],
      recommendedFixes: ["string"],
      escalationNeeded: "boolean"
    },
    examples: [fallback],
    schemaFallback: fallback
  });
  runtimeStore.pushAiSessionCall({ endpoint: "root-cause", ...out.meta, status: "ok", timestamp: new Date().toISOString() });
  return res.json({ ...out.data, metadata: out.meta });
});

app.post("/api/ai/feedback", (req, res) => {
  const payload = req.body || {};
  const valid = validateFeedbackInput(payload);
  if (!valid.ok) return res.status(400).json({ error: valid.error });
  const saved = runtimeTools.saveTechnicianFeedback({
    actionId: payload.actionId,
    technicianFeedback: payload.technicianFeedback || "",
    fixWorked: Boolean(payload.fixWorked),
    beforeAfter: payload.beforeAfterKpiValues || {}
  });
  return res.json({
    learningUpdate: payload.fixWorked
      ? "Feedback indicates fix success; future recommendations will prioritize this action pattern."
      : "Feedback indicates limited efficacy; future recommendations will de-prioritize this action unless confidence increases.",
    futureRecommendationChange: payload.fixWorked
      ? "Increase confidence for similar action types by +0.04."
      : "Require additional evidence before proposing this action.",
    memorySaved: saved.saved
  });
});

app.post("/api/tools/create-technician-ticket", (req, res) => {
  const ticket = runtimeTools.createTechnicianTicket(req.body || {});
  return res.status(201).json(ticket);
});

app.get("/api/tools/maintenance-knowledge", (req, res) => {
  const q = String(req.query.q || "");
  return res.json({ results: runtimeTools.retrieveMaintenanceKnowledge(q) });
});

app.get("/api/robots", (_req, res) => res.json(runtimeStore.getRobots()));

app.post("/api/robots", (req, res) => {
  const { name, model, warehouseZone, taskProfile } = req.body || {};
  if (!name || !model || !warehouseZone) {
    return res.status(400).json({ error: "name, model, and warehouseZone are required" });
  }
  const id = `R-${String(runtimeStore.getRobots().length + 1).padStart(3, "0")}`;
  const robot = {
    id,
    name,
    model,
    warehouseZone,
    taskProfile: taskProfile || "General Picking",
    status: "active"
  };
  runtimeStore.addRobot(robot);
  return res.status(201).json(robot);
});

app.get("/api/fleets", (_req, res) => {
  const expanded = runtimeStore.getFleets().map((f) => ({ ...f, summary: summarizeFleet(f) }));
  res.json(expanded);
});

app.post("/api/fleets", (req, res) => {
  const { name, robotIds } = req.body || {};
  if (!name || !Array.isArray(robotIds) || robotIds.length === 0) {
    return res.status(400).json({ error: "name and robotIds[] are required" });
  }
  const id = runtimeStore.nextFleetId();
  const fleet = { id, name, robotIds, kpis: ["Throughput", "Uptime"], createdAt: new Date().toISOString() };
  runtimeStore.addFleet(fleet);
  runtimeStore.ensureHistory(id, fleet.kpis, baselineForKpi);
  return res.status(201).json(fleet);
});

app.post("/api/fleets/:fleetId/detect-kpis", async (req, res) => {
  const fleet = runtimeStore.findFleet(req.params.fleetId);
  if (!fleet) return res.status(404).json({ error: "fleet not found" });
  const assignedRobots = runtimeStore.getRobots().filter((r) => fleet.robotIds.includes(r.id));
  const detected = await aiDetectKpis(fleet, assignedRobots);
  runtimeStore.setFleetKpis(fleet.id, detected);
  runtimeStore.ensureHistory(fleet.id, detected, baselineForKpi);
  return res.json({ fleetId: fleet.id, kpis: detected });
});

app.get("/api/fleets/:fleetId/metrics", (req, res) => {
  const fleet = runtimeStore.findFleet(req.params.fleetId);
  if (!fleet) return res.status(404).json({ error: "fleet not found" });
  runtimeStore.ensureHistory(fleet.id, fleet.kpis, baselineForKpi);
  res.json({ fleetId: fleet.id, kpis: fleet.kpis, series: runtimeStore.getFleetHistory(fleet.id) });
});

app.get("/api/stream", (req, res) => {
  const fleetId = req.query.fleetId;
  const fleet = runtimeStore.findFleet(fleetId);
  if (!fleet) {
    res.status(400).json({ error: "valid fleetId query parameter required" });
    return;
  }
  runtimeStore.ensureHistory(fleet.id, fleet.kpis, baselineForKpi);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = () => {
    runtimeStore.updateRobotStatuses((r) => {
      const roll = Math.random();
      if (roll < 0.75) r.status = "active";
      else if (roll < 0.88) r.status = "idle";
      else r.status = "charging";
    });
    fleet.kpis.forEach((kpi) => {
      const arr = runtimeStore.getFleetHistory(fleet.id)[kpi];
      const next = jitterValue(kpi, arr[arr.length - 1]);
      runtimeStore.appendKpiSample(fleet.id, kpi, Number(next.toFixed(2)));
    });
    const payload = {
      fleetId: fleet.id,
      summary: summarizeFleet(fleet),
      kpis: fleet.kpis,
      series: runtimeStore.getFleetHistory(fleet.id)
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
