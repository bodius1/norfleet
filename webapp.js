const state = {
  robots: [],
  fleets: [],
  selectedRobotIds: new Set(),
  selectedFleetId: null,
  enabledKpis: new Set(["Throughput", "Cycle Time"]),
  latestSeries: {},
  charts: {},
  stream: null,
  lastMetricsSnapshot: null,
  agentSubView: "overview",
  selectedAgentId: "pre-shift-monitor",
  agentBuilderConfig: null,
  builderExpanded: false,
  overviewExpanded: false,
  agentDraftByAgent: {},
  dirtyFieldsByAgent: {},
  /** Review checkboxes + applied/sent status for Technician Report actions. */
  technicianReport: {
    reviewed: {},
    actionStatus: {},
    generatedActions: null,
    generatedSummary: null,
    lastAnalysis: null
  },
  technicianFeedbackHistory: [],
  agentChangeLog: [],
  aiUsage: {
    provider: "mock",
    model: "mock-norfleet-v1",
    estimatedTokens: 0,
    costEstimate: "$0.0000",
    callsThisSession: 0,
    lastStatus: "Ready"
  },
  settings: {
    ai: { provider: "mock", model: "mock-norfleet-v1", mockMode: true, hasApiKey: false },
    data: { dataMode: "mock", telemetryAdapter: "simulated", kpiApiBaseUrl: "", robotApiBaseUrl: "", hasKpiApiKey: false }
  },
  predictions: [],
  calibration: null,
  persistenceBackend: "unknown"
};

const SAMPLE_ROBOT_REGISTRY = [
  { id: "R-001", label: "Induction Alpha" },
  { id: "R-002", label: "Aisle Runner 12" },
  { id: "R-003", label: "Sort Cell 3" },
  { id: "R-004", label: "Outbound Cart" }
];

const BUILDER_PERMISSION_META = [
  { key: "readLogs", label: "Read logs" },
  { key: "createTicket", label: "Create technician ticket" },
  { key: "recommendRepair", label: "Recommend repair" },
  { key: "requestApproval", label: "Request human approval" },
  { key: "updateHistory", label: "Update maintenance history" }
];

const BUILDER_AI_SUGGESTIONS = [
  "Add a Charging Dock Agent because R-004 has repeated charging alignment issues.",
  "Increase lidar obstruction sensitivity for R-002 in Zone B.",
  "Add a Route Congestion Agent for repeated traffic delays near Sort Cell 3.",
  "Lower auto-ticket confidence threshold during peak shift windows."
];

/** Preset glyphs for workflow nodes (Agentic AI Builder). */
const WORKFLOW_ICON_OPTIONS = ["⬡", "◆", "▣", "⬢", "↻"];

/** Sample KPI anomaly cards (aligned with KPI Monitor naming). */
const SAMPLE_KPI_ANOMALIES = [
  {
    kpi: "Pick Accuracy",
    anomaly: "Below 92% for 3 consecutive 15m windows",
    target: "R-003 · Sort Cell 3",
    severity: "High",
    cause: "Grip misalignment + SKU mix change on lane B",
    action: "Open pick-accuracy monitor path; verify end-effector calibration"
  },
  {
    kpi: "Travel Time",
    anomaly: "+18% vs 7-day baseline on outbound legs",
    target: "R-002 · Zone A → shipping",
    severity: "Medium",
    cause: "Route congestion and intersection queuing",
    action: "Tune Root Cause Agent travel-time sensitivity; consider route agent"
  },
  {
    kpi: "Error Rate",
    anomaly: "Spike in recoverable fault codes E-2401",
    target: "Fleet · mixed zones",
    severity: "High",
    cause: "Handoff timing between AMR and dock",
    action: "Dispatch targeted inspection; cross-check with traffic delay signal"
  },
  {
    kpi: "Traffic Delay",
    anomaly: "Repeated dwell > 90s near Sort Cell 3",
    target: "R-003 / intersection 12",
    severity: "Medium",
    cause: "Choke point + mixed human/robot traffic",
    action: "Add Route Congestion Agent after health monitor; adjust bid rules"
  },
  {
    kpi: "Battery Health",
    anomaly: "Charging alignment warnings (3× in 48h)",
    target: "R-004 · Outbound Cart",
    severity: "Low",
    cause: "Dock pad wear + approach angle drift",
    action: "Schedule charging dock inspection; log approach vectors"
  }
];

/**
 * Action queue for Technician Report (AI-generated maintenance actions).
 * `kind` drives applyTechnicianAction / createAgentFromRecommendation / updateAgentFromRecommendation.
 */
const TECHNICIAN_REPORT_ACTIONS = [
  {
    id: "rec-pick-accuracy-agent",
    title: "Create Pick Accuracy Monitor Agent",
    detail: "Create new AI agent focused on pick failures; correlate with sort cell and SKU mix.",
    severity: "High",
    source: "KPI Monitor",
    kpiAnomalySource: "Pick Accuracy",
    affectedRobots: "R-003",
    actionType: "Agent workflow update",
    buttonLabel: "Create Agent",
    kind: "create_agent",
    selfFix: true,
    appliedKey: "pick-accuracy-monitor"
  },
  {
    id: "rec-travel-sensitivity",
    title: "Increase Travel Time Sensitivity",
    detail: "Travel Time increased 18% on outbound routes. Tighten Root Cause Agent trigger for travel-time clusters.",
    severity: "Medium",
    source: "KPI Monitor",
    kpiAnomalySource: "Travel Time",
    affectedRobots: "R-002, outbound routes",
    actionType: "Monitoring rule change",
    buttonLabel: "Apply Update",
    kind: "apply_update",
    selfFix: true,
    appliedKey: "root-cause-travel"
  },
  {
    id: "rec-route-congestion",
    title: "Add Route Congestion Agent",
    detail: "Traffic Delay anomalies repeated near Sort Cell 3. Add workflow block after Pre-Shift Monitor.",
    severity: "High",
    source: "AI Agent",
    kpiAnomalySource: "Traffic Delay",
    affectedRobots: "R-003",
    actionType: "Agent workflow update",
    buttonLabel: "Create Agent",
    kind: "create_agent",
    selfFix: true,
    appliedKey: "route-congestion"
  },
  {
    id: "rec-charging-dock",
    title: "Send Charging Dock Inspection",
    detail: "R-004 has repeated charging alignment warnings. Create technician task for dock and approach check.",
    severity: "Low",
    source: "AI Agent",
    kpiAnomalySource: "Battery Health",
    affectedRobots: "R-004",
    actionType: "Technician task",
    buttonLabel: "Send to Technician",
    kind: "technician_task",
    selfFix: false,
    appliedKey: "charging-dock-task"
  },
  {
    id: "rec-peak-autoticket",
    title: "Apply Peak Shift Auto-Ticket Rule",
    detail: "Same faults recurring during peak windows. Lower auto-ticket confidence and tighten Maintenance Planner escalation.",
    severity: "Critical",
    source: "Technician Feedback",
    kpiAnomalySource: "Error Rate",
    affectedRobots: "Fleet-wide",
    actionType: "Maintenance ticket",
    buttonLabel: "Apply to Agent Builder",
    kind: "apply_builder",
    selfFix: true,
    appliedKey: "peak-shift-planner"
  }
];

const byId = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Default chart header (x/y units) + rules for KPIs not in the catalog (e.g. AI-detected names). */
const KPI_CHART_META_DEFAULT = {
  chartHeaderUnits: "interval / value",
  absMin: null,
  absMax: null,
  rollingBad: null,
  rollingPct: 15,
  rollingLen: 8,
  checkVolatility: true
};

/**
 * KPI Monitor: header shows (interval / y-units); anomaly thresholds below.
 * rollingBad: compare latest point to mean of prior `rollingLen` points.
 */
const KPI_CHART_META = {
  Throughput: {
    chartHeaderUnits: "interval / tasks/h",
    rollingBad: "below_avg_pct",
    rollingPct: 15,
    rollingLen: 8,
    absMin: null,
    absMax: null,
    checkVolatility: true
  },
  "Cycle Time": {
    chartHeaderUnits: "interval / min/task",
    rollingBad: "above_avg_pct",
    rollingPct: 15,
    rollingLen: 8,
    absMin: null,
    absMax: null,
    checkVolatility: true
  },
  Uptime: {
    chartHeaderUnits: "interval / %",
    absMin: 95,
    absMax: null,
    rollingBad: null,
    checkVolatility: true
  },
  "Battery Health": {
    chartHeaderUnits: "interval / %",
    absMin: 80,
    absMax: null,
    rollingBad: null,
    checkVolatility: true
  },
  "Pick Accuracy": {
    chartHeaderUnits: "interval / %",
    absMin: 97,
    absMax: null,
    rollingBad: null,
    checkVolatility: true
  },
  "Traffic Delay": {
    chartHeaderUnits: "interval / s",
    rollingBad: "above_avg_pct",
    rollingPct: 20,
    rollingLen: 8,
    absMin: null,
    absMax: null,
    checkVolatility: true
  },
  "Error Rate": {
    chartHeaderUnits: "interval / %",
    absMin: null,
    absMax: 3,
    rollingBad: null,
    checkVolatility: true
  },
  "Travel Time": {
    chartHeaderUnits: "interval / min/trip",
    rollingBad: "above_avg_pct",
    rollingPct: 15,
    rollingLen: 8,
    absMin: null,
    absMax: null,
    checkVolatility: true
  },
  "Task Completion": {
    chartHeaderUnits: "interval / %",
    absMin: 95,
    absMax: null,
    rollingBad: null,
    checkVolatility: true
  }
};

function getKpiChartMeta(kpiName) {
  return KPI_CHART_META[kpiName] || KPI_CHART_META_DEFAULT;
}

function kpiSeriesMean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function kpiSeriesStdev(arr) {
  if (arr.length < 2) return 0;
  const m = kpiSeriesMean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
}

/**
 * Live chart anomaly: absolute range, rolling spike/drop vs recent mean, or elevated short-window volatility.
 */
function detectKpiChartAnomaly(kpiName, values) {
  const nums = (values || []).map(Number).filter((x) => !Number.isNaN(x));
  const meta = getKpiChartMeta(kpiName);
  let outOfRange = false;
  let alert = false;
  let volatile = false;

  if (nums.length === 0) {
    return { outOfRange: false, alert: false, volatile: false, badges: [], anomalous: false };
  }

  const current = nums[nums.length - 1];

  if (meta.absMin != null && current < meta.absMin) outOfRange = true;
  if (meta.absMax != null && current > meta.absMax) outOfRange = true;

  const rw = meta.rollingLen || 8;
  const pct = meta.rollingPct ?? 15;
  if (meta.rollingBad && nums.length >= rw + 1) {
    const past = nums.slice(-rw - 1, -1);
    const rollAvg = kpiSeriesMean(past);
    if (meta.rollingBad === "below_avg_pct" && rollAvg > 0 && current < rollAvg * (1 - pct / 100)) alert = true;
    if (meta.rollingBad === "above_avg_pct" && rollAvg >= 0 && current > rollAvg * (1 + pct / 100)) alert = true;
  }

  if (meta.checkVolatility !== false && nums.length >= 8) {
    const tail = nums.slice(-4);
    const head = nums.slice(0, -4);
    const stTail = kpiSeriesStdev(tail);
    const stHead = kpiSeriesStdev(head);
    const baseline = Math.max(Math.abs(kpiSeriesMean(nums)), 1e-6);
    if (stHead < baseline * 0.015) {
      if (stTail > baseline * 0.04) volatile = true;
    } else if (stTail > 1.65 * stHead && stTail > baseline * 0.012) volatile = true;
  }

  const badges = [];
  if (outOfRange) badges.push("Out of Range");
  if (alert) badges.push("Alert");
  if (volatile) badges.push("Volatile");
  return { outOfRange, alert, volatile, badges, anomalous: badges.length > 0 };
}

function getNavTab(viewId) {
  return document.querySelector(`.nav-tab[data-view="${viewId}"]`);
}

function estimateTokensFromObj(obj) {
  const chars = JSON.stringify(obj || {}).length;
  return Math.ceil(chars / 4);
}

function getSessionAdminToken() {
  try {
    return (localStorage.getItem("norfleet_admin_token") || "").trim();
  } catch {
    return "";
  }
}

/** UI label for provider enum (avoids implying a test double). */
function displayAiProviderName(provider) {
  const p = String(provider || "").toLowerCase();
  return p === "mock" ? "Built-in" : String(provider || "—");
}

/** UI label for model when using built-in path. */
function displayAiModelForUi(provider, model) {
  const p = String(provider || "").toLowerCase();
  const m = String(model || "");
  if (p === "mock" || m === "mock-norfleet-v1") return "Local assistant";
  return m || "—";
}

function dataModeLabel(mode) {
  const m = String(mode || "mock").toLowerCase();
  if (m === "mock") return "Sample / local";
  if (m === "csv") return "Uploaded CSV/logs";
  if (m === "external") return "External API";
  return mode || "—";
}

function aiSettingsStatusLine(mockMode, hasApiKey) {
  if (mockMode) return "Built-in (no provider API key)";
  if (hasApiKey) return "Configured";
  return "No API key";
}

function refreshAdminTokenHint() {
  const hint = byId("st-admin-token-hint");
  if (!hint) return;
  hint.textContent = getSessionAdminToken()
    ? "A token is saved in this browser and sent as x-norfleet-admin-token when the server expects it."
    : "";
}

function saveSessionAdminToken() {
  const input = byId("st-admin-token");
  const v = (input?.value || "").trim();
  if (!v) {
    showToast("⚠", "Paste a token to save, or use Clear to remove the saved token.");
    return;
  }
  localStorage.setItem("norfleet_admin_token", v);
  if (input) input.value = "";
  refreshAdminTokenHint();
  showToast("◇", "Session access token saved in this browser.");
}

function clearSessionAdminToken() {
  localStorage.removeItem("norfleet_admin_token");
  const input = byId("st-admin-token");
  if (input) input.value = "";
  refreshAdminTokenHint();
  showToast("◇", "Session access token removed.");
}

function updateAiUsage(meta, statusText = "OK") {
  if (!meta) return;
  state.aiUsage.provider = meta.provider || state.aiUsage.provider;
  state.aiUsage.model = meta.model || state.aiUsage.model;
  state.aiUsage.estimatedTokens = meta.estimatedTokens ?? state.aiUsage.estimatedTokens;
  state.aiUsage.costEstimate = meta.costEstimate || state.aiUsage.costEstimate;
  state.aiUsage.callsThisSession += 1;
  state.aiUsage.lastStatus = statusText;
}

function detectKpiAnomaliesClient(kpiHistory, thresholds) {
  const out = [];
  Object.entries(kpiHistory || {}).forEach(([kpi, series]) => {
    if (!Array.isArray(series) || series.length < 5) return;
    const latest = Number(series[series.length - 1]);
    const prev = series.slice(-6, -1);
    const mean = prev.reduce((a, b) => a + Number(b), 0) / prev.length;
    const deltaPct = mean ? ((latest - mean) / mean) * 100 : 0;
    const t = thresholds[kpi] || {};
    const lowBreach = typeof t.min === "number" && latest < t.min;
    const highBreach = typeof t.max === "number" && latest > t.max;
    const spike = Math.abs(deltaPct) > (t.maxDeltaPct ?? 12);
    if (!lowBreach && !highBreach && !spike) return;
    out.push({
      kpi,
      latest: Number(latest.toFixed(2)),
      baseline: Number(mean.toFixed(2)),
      deltaPct: Number(deltaPct.toFixed(2)),
      severity: Math.abs(deltaPct) > 20 ? "High" : Math.abs(deltaPct) > 12 ? "Medium" : "Low"
    });
  });
  return out;
}

function getAnomalyThresholds() {
  return {
    "Pick Accuracy": { min: 92, maxDeltaPct: 8 },
    "Travel Time": { max: 9, maxDeltaPct: 15 },
    "Error Rate": { max: 2.5, maxDeltaPct: 20 },
    "Battery Health": { min: 72, maxDeltaPct: 12 },
    "Traffic Delay": { max: 4.5, maxDeltaPct: 20 },
    Uptime: { min: 92, maxDeltaPct: 8 },
    "Cycle Time": { max: 6.2, maxDeltaPct: 12 }
  };
}

function currentFleet() {
  return state.fleets.find((f) => f.id === state.selectedFleetId) || null;
}

function logAgentChange(entry) {
  state.agentChangeLog.unshift({
    timestamp: new Date().toISOString(),
    changedBy: "AI Recommendation",
    ...entry
  });
  if (state.agentChangeLog.length > 20) state.agentChangeLog.pop();
}

function createDefaultAgentBuilderConfig() {
  return {
    workflowOrder: [
      "pre-shift-monitor",
      "root-cause",
      "maintenance-planner",
      "technician-dispatch",
      "feedback-loop"
    ],
    dashboardMetrics: {
      failuresDetected: 7,
      suggestedFixes: 12,
      resolvedIssues: 28
    },
    agents: [
      {
        id: "pre-shift-monitor",
        icon: "⬡",
        stage: "ingress",
        name: "Pre-Shift Monitor",
        role: "Overnight health & telemetry sweep",
        triggerCondition: "Daily 05:30 site local, fleet online",
        assignedTask: "Scanning overnight robot health",
        priorityLevel: "P1",
        escalationRule: "Notify fleet lead if any robot reports critical fault",
        status: "active",
        failures: "None (2 advisory warnings)",
        robots: { "R-001": true, "R-002": true, "R-003": true, "R-004": true },
        permissions: {
          readLogs: true,
          createTicket: false,
          recommendRepair: true,
          requestApproval: false,
          updateHistory: true
        },
        params: {
          failureThreshold: 3,
          checkFrequency: "Every 15 minutes",
          runSchedule: "05:30 site local, Mon–Sat",
          confidenceRequired: 0.82,
          autoCreateTicket: true,
          requireTechnicianApproval: false
        }
      },
      {
        id: "root-cause",
        icon: "◆",
        stage: "analyze",
        name: "Root Cause Agent",
        role: "Failure clustering & hypothesis ranking",
        triggerCondition: "≥3 similar faults within 2h window",
        assignedTask: "Analyzing repeated failures",
        priorityLevel: "P1",
        escalationRule: "Escalate to reliability engineer after 5 hypotheses",
        status: "active",
        failures: "3 correlated fault signatures",
        robots: { "R-001": true, "R-002": true, "R-003": true, "R-004": false },
        permissions: {
          readLogs: true,
          createTicket: true,
          recommendRepair: true,
          requestApproval: true,
          updateHistory: false
        },
        params: {
          failureThreshold: 5,
          checkFrequency: "On incident",
          runSchedule: "24/7 on trigger",
          confidenceRequired: 0.88,
          autoCreateTicket: false,
          requireTechnicianApproval: true
        }
      },
      {
        id: "maintenance-planner",
        icon: "▣",
        stage: "plan",
        name: "Maintenance Planner",
        role: "Checklist & parts intent generation",
        triggerCondition: "Root cause agent publishes ranked hypothesis",
        assignedTask: "Generating repair checklist",
        priorityLevel: "P2",
        escalationRule: "Hand off to dispatch if parts unavailable",
        status: "active",
        failures: "0 blocking",
        robots: { "R-001": true, "R-002": false, "R-003": true, "R-004": true },
        permissions: {
          readLogs: true,
          createTicket: true,
          recommendRepair: true,
          requestApproval: false,
          updateHistory: true
        },
        params: {
          failureThreshold: 2,
          checkFrequency: "Hourly while plan open",
          runSchedule: "Business hours + on-call",
          confidenceRequired: 0.85,
          autoCreateTicket: true,
          requireTechnicianApproval: false
        }
      },
      {
        id: "technician-dispatch",
        icon: "⬢",
        stage: "assign",
        name: "Technician Dispatch",
        role: "Work order routing & SLA watch",
        triggerCondition: "Maintenance plan approved or SLA breach",
        assignedTask: "Waiting for technician assignment",
        priorityLevel: "P2",
        escalationRule: "Page on-call after 30m no pickup",
        status: "idle",
        failures: "—",
        robots: { "R-001": false, "R-002": true, "R-003": true, "R-004": true },
        permissions: {
          readLogs: true,
          createTicket: true,
          recommendRepair: false,
          requestApproval: true,
          updateHistory: true
        },
        params: {
          failureThreshold: 1,
          checkFrequency: "Every 5 minutes",
          runSchedule: "24/7",
          confidenceRequired: 0.75,
          autoCreateTicket: true,
          requireTechnicianApproval: true
        }
      },
      {
        id: "feedback-loop",
        icon: "↻",
        stage: "learn",
        name: "Feedback Loop",
        role: "Post-fix validation & model refresh",
        triggerCondition: "Work order closed with technician notes",
        assignedTask: "Learning from completed fixes",
        priorityLevel: "P3",
        escalationRule: "Queue model retrain weekly",
        status: "active",
        failures: "1 open verification",
        robots: { "R-001": true, "R-002": true, "R-003": true, "R-004": true },
        permissions: {
          readLogs: true,
          createTicket: false,
          recommendRepair: true,
          requestApproval: false,
          updateHistory: true
        },
        params: {
          failureThreshold: 4,
          checkFrequency: "Daily digest",
          runSchedule: "02:00 site local",
          confidenceRequired: 0.9,
          autoCreateTicket: false,
          requireTechnicianApproval: false
        }
      }
    ]
  };
}

function ensureAgentBuilderConfig() {
  if (!state.agentBuilderConfig) {
    state.agentBuilderConfig = createDefaultAgentBuilderConfig();
  }
}

function getAgent(agentId) {
  ensureAgentBuilderConfig();
  return state.agentBuilderConfig.agents.find((a) => a.id === agentId) || null;
}

function getOrCreateDraft(agentId) {
  const agent = getAgent(agentId);
  if (!agent) return null;
  if (!state.agentDraftByAgent[agentId]) {
    state.agentDraftByAgent[agentId] = JSON.parse(JSON.stringify(agent));
  }
  if (!state.dirtyFieldsByAgent[agentId]) {
    state.dirtyFieldsByAgent[agentId] = new Set();
  }
  return state.agentDraftByAgent[agentId];
}

function getDirtySet(agentId) {
  if (!state.dirtyFieldsByAgent[agentId]) state.dirtyFieldsByAgent[agentId] = new Set();
  return state.dirtyFieldsByAgent[agentId];
}

function isDirty(agentId, key) {
  return getDirtySet(agentId).has(key);
}

function setDirty(agentId, key, dirty) {
  const set = getDirtySet(agentId);
  if (dirty) set.add(key);
  else set.delete(key);
}

async function syncAgentRuntimeFromServer() {
  try {
    const rt = await api("/api/agents/runtime");
    if (Array.isArray(rt.agents) && rt.agents.length) {
      state.agentBuilderConfig = { ...createDefaultAgentBuilderConfig(), agents: rt.agents };
    }
    if (rt.calibration) state.calibration = rt.calibration;
  } catch {
    try {
      const legacy = await api("/api/ai/runtime");
      if (Array.isArray(legacy.agents) && legacy.agents.length) {
        state.agentBuilderConfig = { ...createDefaultAgentBuilderConfig(), agents: legacy.agents };
      }
      if (legacy.calibration) state.calibration = legacy.calibration;
      if (legacy.persistenceBackend) state.persistenceBackend = legacy.persistenceBackend;
    } catch {
      ensureAgentBuilderConfig();
    }
  }
}

async function saveAgentRuntimeToServer() {
  if (!state.agentBuilderConfig?.agents) return;
  await api("/api/agents/runtime", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentBuilderConfig: state.agentBuilderConfig.agents })
  });
}

async function refreshPredictions() {
  const res = await api("/api/predictions");
  state.predictions = res.predictions || [];
  state.calibration = res.calibration || state.calibration;
  return state.predictions;
}

function renderPredictionBanner() {
  const el = byId("pred-marker-banner");
  if (!el) return;
  const fleet = currentFleet();
  const preds = (state.predictions || []).filter(
    (p) => p.alert && fleet?.robotIds?.includes(p.robotId)
  );
  if (!preds.length) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  el.innerHTML = preds
    .map(
      (p) =>
        `<strong>${escapeHtml(p.robotId)}</strong> — ${escapeHtml(p.failureMode.replace(/_/g, " "))} · TTF ${escapeHtml(String(p.estimatedTimeToFailureHours))}h · p=${(p.failureProbability * 100).toFixed(0)}%`
    )
    .join(" · ");
}

function miniSparkline(hi) {
  if (!hi?.length) return "";
  const vals = hi.map((p) => p.value ?? p);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const pts = vals
    .map((v, i) => {
      const x = (i / Math.max(1, vals.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");
  return `<svg class="fh-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="#22d3ee" stroke-width="1.5" points="${pts}"/></svg>`;
}

async function renderFleetHealth() {
  const root = byId("fleet-health-root");
  if (!root) return;
  const preds = [...(state.predictions || [])].sort(
    (a, b) => (a.estimatedTimeToFailureHours ?? 999) - (b.estimatedTimeToFailureHours ?? 999)
  );
  const rows = await Promise.all(
    preds.map(async (p) => {
      let hi = [];
      try {
        const health = await api(`/api/robots/${encodeURIComponent(p.robotId)}/health`);
        hi = health.hiSeries || [];
      } catch {
        hi = [];
      }
      const sigs = (p.contributingSignals || [])
        .map((s) => `${s.signal} (${s.weight})`)
        .join(", ");
      const riskClass = (p.failureProbability ?? 0) > 0.7 ? "fh-risk-high" : "fh-risk-med";
      return `<tr>
        <td><strong>${escapeHtml(p.robotId)}</strong><br><span class="muted">${escapeHtml(p.robotName || "")}</span></td>
        <td>${escapeHtml(p.failureMode.replace(/_/g, " "))}</td>
        <td class="${riskClass}">${((p.failureProbability ?? 0) * 100).toFixed(0)}%</td>
        <td>${p.estimatedTimeToFailureHours ?? "—"}h</td>
        <td>${((p.healthIndex ?? 0) * 100).toFixed(0)}%</td>
        <td>${miniSparkline(hi)}</td>
        <td class="fh-signals">${escapeHtml(sigs || "—")}</td>
      </tr>`;
    })
  );
  const cal = state.calibration
    ? Object.entries(state.calibration)
        .map(([m, c]) => `${m}: p≥${c.minProbability} HI≤${c.alertThreshold}`)
        .join(" · ")
    : "Default calibration";
  root.innerHTML = `
    <table class="fh-table">
      <thead><tr>
        <th>Robot</th><th>Failure mode</th><th>Probability</th><th>TTF</th><th>Health index</th><th>HI trend</th><th>Top signals</th>
      </tr></thead>
      <tbody>${rows.length ? rows.join("") : `<tr><td colspan="7" class="muted">No predictions yet — run Fast-forward or wait for telemetry.</td></tr>`}</tbody>
    </table>
    <div class="fh-calibration">Calibration (from feedback): ${escapeHtml(cal)} · persistence: ${escapeHtml(state.persistenceBackend)}</div>
  `;
  const refreshBtn = byId("fh-refresh-btn");
  const replayBtn = byId("fh-replay-btn");
  if (refreshBtn) refreshBtn.onclick = () => refreshFleetHealth().catch((e) => showToast("⚠", e.message));
  if (replayBtn) replayBtn.onclick = () => runSimReplay(60).catch((e) => showToast("⚠", e.message));
}

async function refreshFleetHealth() {
  await refreshPredictions();
  renderPredictionBanner();
  await renderFleetHealth();
}

async function runSimReplay(speed = 60) {
  const status = byId("fh-replay-status");
  if (status) status.textContent = "Replaying…";
  const res = await api("/api/sim/replay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speed })
  });
  await refreshFleetHealth();
  if (status) status.textContent = `Sim advanced (${res.speed}×)`;
  showToast("◉", "Simulation fast-forwarded — check predictions.");
}

async function submitPredictionFeedback(actionId, outcome) {
  const rec = getTechnicianRecommendationById(actionId);
  const payload = {
    actionId,
    predictionId: rec?.predictionId,
    failureMode: rec?.failureMode,
    outcome,
    fixWorked: outcome !== "false-alarm",
    technicianFeedback: `Technician marked ${outcome} for ${rec?.title || actionId}.`
  };
  const res = await api("/api/ai/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  state.calibration = res.calibration || state.calibration;
  state.technicianFeedbackHistory.push({ actionId, outcome, learningUpdate: res.learningUpdate });
  setTechnicianActionStatus(actionId, "completed");
  showToast("◇", res.learningUpdate || "Feedback recorded.");
  await refreshFleetHealth();
  renderTechnicianReport();
}

function switchView(id, tabEl) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
  const view = byId(`view-${id}`);
  if (view) view.classList.add("active");
  if (tabEl) tabEl.classList.add("active");
  if (id === "technician-report") {
    renderTechnicianReport();
    return;
  }
  if (id === "fleet-health") {
    refreshFleetHealth().catch((err) => showToast("⚠", err.message));
    return;
  }
  if (id === "agents") {
    renderAgentsView();
    return;
  }
  if (id === "monitor") {
    if (!state.fleets.length) {
      showToast("⚠", "Create a fleet in Fleet Builder first.");
      return;
    }
    if (!state.selectedFleetId) state.selectedFleetId = state.fleets[0].id;
    syncFleetDropdowns();
    loadMetricsAndStream().catch((err) => showToast("⚠", err.message));
  }
}

function switchAgentSubView(subview) {
  state.agentSubView = subview;
  renderAgentsView();
}

function toggleWorkflowExpand(target) {
  if (target === "builder") state.builderExpanded = !state.builderExpanded;
  if (target === "overview") state.overviewExpanded = !state.overviewExpanded;
  renderAgentsView();
}

function selectAgent(agentId) {
  if (!getAgent(agentId)) return;
  state.selectedAgentId = agentId;
  renderAgentBuilder();
}

function updateAgentConfig(agentId, field, value, shouldRefresh = true) {
  const agent = getAgent(agentId);
  if (!agent) return;
  if (field.startsWith("robots.")) {
    const rid = field.slice(7);
    agent.robots[rid] = value;
  } else if (field.startsWith("permissions.")) {
    const key = field.slice(12);
    agent.permissions[key] = value;
  } else if (field.startsWith("params.")) {
    const key = field.slice(7);
    if (key === "failureThreshold") agent.params[key] = Number(value) || 0;
    else if (key === "confidenceRequired") agent.params[key] = Number(value);
    else if (key === "autoCreateTicket" || key === "requireTechnicianApproval") agent.params[key] = Boolean(value);
    else agent.params[key] = value;
  } else {
    agent[field] = value;
  }
  if (shouldRefresh) refreshAgentsSharedUI();
}

function refreshAgentsSharedUI() {
  ensureAgentBuilderConfig();
  renderOverviewWorkflow();
  renderAgentStatusCardsFromConfig();
  updateAgentMetricsFromConfig();
  syncBuilderWorkflowSelection();
}

let builderConnectorResizeObs = null;
let layoutBuilderConnectorsRaf = null;
let builderConnectorRetries = 0;

function scheduleLayoutBuilderConnectors() {
  if (layoutBuilderConnectorsRaf) cancelAnimationFrame(layoutBuilderConnectorsRaf);
  layoutBuilderConnectorsRaf = requestAnimationFrame(() => {
    layoutBuilderConnectorsRaf = null;
    layoutBuilderConnectors();
  });
}

function ensureBuilderConnectorObserver() {
  const canvas = document.querySelector(".workflow-canvas--builder");
  if (!canvas || builderConnectorResizeObs) return;
  builderConnectorResizeObs = new ResizeObserver(() => scheduleLayoutBuilderConnectors());
  builderConnectorResizeObs.observe(canvas);
}

/** Reusable path: right-center of A to left-center of B; straight if same row left-to-right, else orthogonal elbow. */
function buildWorkflowConnectorPath(sx, sy, ex, ey) {
  const rowTol = 16;
  const dy = Math.abs(sy - ey);
  const straight = dy < rowTol && ex > sx;
  if (straight) {
    return `M ${sx} ${sy} L ${ex} ${ey}`;
  }
  const curve = Math.max(22, Math.min(56, Math.abs(ex - sx) * 0.35));
  const c1x = sx + curve;
  const c2x = ex - curve;
  return `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ey}, ${ex} ${ey}`;
}

function layoutBuilderConnectors() {
  const svg = byId("builder-connectors-svg");
  const canvas = document.querySelector(".workflow-canvas--builder");
  const track = byId("agents-builder-workflow");
  if (!svg || !canvas || !track || state.agentSubView !== "builder") return;

  const nodes = Array.from(track.querySelectorAll(".builder-workflow-node"));
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 2 || h < 2 || nodes.length < 2) return;

  const canvasRect = canvas.getBoundingClientRect();
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <linearGradient id="builder-conn-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1fd9ff"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
    <marker id="builder-flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0 L7,3.5 L0,7 z" fill="rgba(124,58,237,0.9)"/>
    </marker>
    <filter id="builder-conn-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="0" stdDeviation="1.6" flood-color="#00e5ff" flood-opacity="0.45"/>
    </filter>`;
  svg.innerHTML = "";
  svg.appendChild(defs);

  function toLocal(el) {
    const r = el.getBoundingClientRect();
    return {
      left: r.left - canvasRect.left,
      right: r.right - canvasRect.left,
      top: r.top - canvasRect.top,
      bottom: r.bottom - canvasRect.top,
      cy: r.top - canvasRect.top + r.height / 2
    };
  }

  let drawn = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = toLocal(nodes[i]);
    const b = toLocal(nodes[i + 1]);
    const sx = a.right;
    const sy = a.cy;
    const ex = b.left;
    const ey = b.cy;
    const d = buildWorkflowConnectorPath(sx, sy, ex, ey);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "url(#builder-conn-grad)");
    path.setAttribute("stroke-width", "2.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("filter", "url(#builder-conn-glow)");
    path.setAttribute("marker-end", "url(#builder-flow-arrow)");
    svg.appendChild(path);
    drawn += 1;
  }

  const expected = nodes.length - 1;
  if (drawn < expected && builderConnectorRetries < 4) {
    builderConnectorRetries += 1;
    setTimeout(() => scheduleLayoutBuilderConnectors(), 35);
  } else {
    builderConnectorRetries = 0;
  }
}

function renderOverviewWorkflow() {
  renderWorkflowDiagram("agents-overview-workflow", { interactive: false });
}

function renderWorkflowDiagram(wrapId, options = {}) {
  const { interactive = false } = options;
  const wrap = byId(wrapId);
  if (!wrap) return;
  const { workflowOrder } = state.agentBuilderConfig;
  wrap.innerHTML = "";
  workflowOrder.forEach((id, idx) => {
    const ag = getAgent(id);
    if (!ag) return;
    const node = document.createElement("div");
    node.className = interactive
      ? `workflow-node builder-workflow-node${state.selectedAgentId === id ? " selected" : ""}`
      : "workflow-node";
    if (interactive) {
      node.dataset.agentId = id;
      node.setAttribute("role", "button");
      node.tabIndex = 0;
      node.onclick = () => selectAgent(id);
      node.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectAgent(id);
        }
      };
    }
    node.innerHTML = `<div class="workflow-node-icon">${ag.icon}</div><div class="workflow-node-title" ${
      interactive ? `id="builder-wf-title-${id}"` : ""
    }>${escapeHtml(ag.name)}</div><div class="workflow-node-meta">${escapeHtml(ag.stage)}</div>`;
    wrap.appendChild(node);
    if (idx < workflowOrder.length - 1) {
      const c = document.createElement("div");
      c.className = "workflow-connector";
      c.setAttribute("aria-hidden", "true");
      wrap.appendChild(c);
    }
  });
}

function renderBuilderWorkflowTrack() {
  const wrap = byId("agents-builder-workflow");
  if (!wrap) return;
  wrap.classList.remove("workflow-size-large", "workflow-size-medium", "workflow-size-compact");
  renderWorkflowDiagram("agents-builder-workflow", { interactive: true });
}

function syncBuilderWorkflowSelection() {
  if (state.agentSubView !== "builder") return;
  const wrap = byId("agents-builder-workflow");
  if (!wrap) return;
  wrap.querySelectorAll(".builder-workflow-node[data-agent-id]").forEach((btn) => {
    const ag = getAgent(btn.dataset.agentId);
    if (!ag) return;
    const iconEl = btn.querySelector(".workflow-node-icon");
    const titleEl = btn.querySelector(".workflow-node-title");
    const metaEl = btn.querySelector(".workflow-node-meta");
    if (iconEl) iconEl.textContent = ag.icon;
    if (titleEl) titleEl.textContent = ag.name;
    if (metaEl) metaEl.textContent = ag.stage;
  });
  wrap.querySelectorAll(".builder-workflow-node").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.agentId === state.selectedAgentId);
  });
}

function renderAgentStatusCardsFromConfig() {
  const cardsEl = byId("agents-status-cards");
  if (!cardsEl) return;
  const { workflowOrder } = state.agentBuilderConfig;
  const html = workflowOrder
    .map((id) => {
      const a = getAgent(id);
      if (!a) return "";
      return `<div class="agent-card">
        <div class="agent-card-head">
          <div class="agent-card-name">${escapeHtml(a.name)}</div>
          <span class="agent-status-pill ${escapeHtml(a.status)}">${escapeHtml(a.status)}</span>
        </div>
        <div class="agent-field-lbl">Role</div>
        <div class="agent-field-val">${escapeHtml(a.role)}</div>
        <div class="agent-field-lbl">Assigned task</div>
        <div class="agent-field-val">${escapeHtml(a.assignedTask)}</div>
        <div class="agent-field-lbl">Encountered failures</div>
        <div class="agent-field-val">${escapeHtml(a.failures)}</div>
      </div>`;
    })
    .join("");
  cardsEl.innerHTML = html;
}

function updateAgentMetricsFromConfig() {
  const agents = state.agentBuilderConfig.agents;
  const activeCount = agents.filter((a) => a.status === "active").length;
  const dm = state.agentBuilderConfig.dashboardMetrics;
  const mActive = byId("agents-m-active");
  const mFail = byId("agents-m-failures");
  const mFix = byId("agents-m-fixes");
  const mRes = byId("agents-m-resolved");
  if (mActive) mActive.textContent = String(activeCount);
  if (mFail) mFail.textContent = String(dm.failuresDetected);
  if (mFix) mFix.textContent = String(dm.suggestedFixes);
  if (mRes) mRes.textContent = String(dm.resolvedIssues);
}

function getTechnicianActionStatus(actionId) {
  return state.technicianReport.actionStatus[actionId] || "pending";
}

function setTechnicianActionStatus(actionId, status) {
  state.technicianReport.actionStatus[actionId] = status;
}

function getTechnicianRecommendationById(id) {
  const source = getTechnicianActionSourceList();
  return source.find((a) => a.id === id) || null;
}

function insertWorkflowAgentAfter(anchorId, agent) {
  ensureAgentBuilderConfig();
  const cfg = state.agentBuilderConfig;
  if (cfg.agents.some((a) => a.id === agent.id)) return { ok: false, reason: "exists" };
  cfg.agents.push(agent);
  const o = cfg.workflowOrder;
  const i = o.indexOf(anchorId);
  if (i === -1) return { ok: false, reason: "no-anchor" };
  o.splice(i + 1, 0, agent.id);
  invalidateAgentDraft(agent.id);
  return { ok: true };
}

function invalidateAgentDraft(agentId) {
  delete state.agentDraftByAgent[agentId];
  if (state.dirtyFieldsByAgent[agentId]) state.dirtyFieldsByAgent[agentId].clear();
}

function createPickAccuracyMonitorAgent() {
  const agent = {
    id: "pick-accuracy-monitor",
    icon: "▣",
    stage: "quality",
    name: "Pick Accuracy Monitor",
    role: "Pick failure detection & sort-cell correlation",
    triggerCondition: "Pick accuracy < 92% for 3 consecutive 15m windows (KPI Monitor)",
    assignedTask: "Correlating pick errors with R-003 / Sort Cell 3",
    priorityLevel: "P1",
    escalationRule: "Page pick lead if accuracy < 88% for 1h",
    status: "active",
    failures: "Anomaly: below-threshold window (3×)",
    robots: { "R-001": true, "R-002": true, "R-003": true, "R-004": false },
    permissions: {
      readLogs: true,
      createTicket: true,
      recommendRepair: true,
      requestApproval: false,
      updateHistory: true
    },
    params: {
      failureThreshold: 2,
      checkFrequency: "Every 5 minutes",
      runSchedule: "24/7 on trigger",
      confidenceRequired: 0.9,
      autoCreateTicket: true,
      requireTechnicianApproval: false
    }
  };
  return insertWorkflowAgentAfter("pre-shift-monitor", agent);
}

function createRouteCongestionAgent() {
  ensureAgentBuilderConfig();
  const anchor = state.agentBuilderConfig.workflowOrder.includes("pick-accuracy-monitor")
    ? "pick-accuracy-monitor"
    : "pre-shift-monitor";
  const agent = {
    id: "route-congestion",
    icon: "⬢",
    stage: "route",
    name: "Route Congestion Agent",
    role: "Traffic delay clustering & lane pressure",
    triggerCondition: "Traffic Delay dwell > 90s near Sort Cell 3 (repeated)",
    assignedTask: "Reroute suggestions and intersection de-bottlenecking",
    priorityLevel: "P2",
    escalationRule: "Notify floor lead if congestion index > 0.7 for 20m",
    status: "active",
    failures: "3 traffic delay clusters (48h)",
    robots: { "R-001": true, "R-002": true, "R-003": true, "R-004": true },
    permissions: {
      readLogs: true,
      createTicket: true,
      recommendRepair: true,
      requestApproval: true,
      updateHistory: true
    },
    params: {
      failureThreshold: 3,
      checkFrequency: "On traffic-delay spike",
      runSchedule: "24/7",
      confidenceRequired: 0.82,
      autoCreateTicket: false,
      requireTechnicianApproval: false
    }
  };
  return insertWorkflowAgentAfter(anchor, agent);
}

function applyTravelTimeSensitivityUpdate() {
  const root = getAgent("root-cause");
  if (!root) return false;
  const next = Math.max(2, (root.params.failureThreshold || 5) - 1);
  updateAgentConfig("root-cause", "params.failureThreshold", next, false);
  updateAgentConfig(
    "root-cause",
    "triggerCondition",
    `≥${next} similar faults within 2h window (travel-time sensitivity tuned)`,
    false
  );
  updateAgentConfig("root-cause", "assignedTask", "Analyzing repeated failures · travel-time aware", false);
  invalidateAgentDraft("root-cause");
  return true;
}

function applyPeakShiftPlannerUpdate() {
  const mp = getAgent("maintenance-planner");
  if (!mp) return false;
  updateAgentConfig(
    "maintenance-planner",
    "escalationRule",
    "Peak window: auto-ticket confidence 0.78; page on-call after 20m for recurring faults",
    false
  );
  updateAgentConfig("maintenance-planner", "params.confidenceRequired", 0.78, false);
  updateAgentConfig("maintenance-planner", "params.autoCreateTicket", true, false);
  invalidateAgentDraft("maintenance-planner");
  return true;
}

function afterTechnicianReportMutation() {
  refreshAgentsSharedUI();
  if (state.agentSubView === "builder") renderAgentBuilder();
  if (byId("view-technician-report")?.classList.contains("active")) renderTechnicianReport();
  scheduleLayoutBuilderConnectors();
}

function applyTechnicianAction(actionId) {
  const rec = getTechnicianRecommendationById(actionId);
  if (!rec) return;
  if (getTechnicianActionStatus(rec.id) !== "pending") {
    showToast("◇", "This action was already completed.");
    return;
  }

  if (rec.kind === "technician_task") {
    setTechnicianActionStatus(rec.id, "sent");
    showToast("◇", "Sent to technician · charging dock inspection queued for R-004.");
    logAgentChange({
      changeType: "Technician ticket",
      changedBy: "User",
      reason: rec.detail || rec.title,
      before: "Pending",
      after: "Sent"
    });
    afterTechnicianReportMutation();
    return;
  }

  let ok = false;
  let msg = "";
  if (rec.id === "rec-pick-accuracy-agent") {
    const r = createPickAccuracyMonitorAgent();
    ok = r.ok;
    msg = ok ? "Pick Accuracy Monitor Agent added to the workflow." : "Agent already in workflow.";
  } else if (rec.id === "rec-route-congestion") {
    const r = createRouteCongestionAgent();
    ok = r.ok;
    msg = ok ? "Route Congestion Agent added to the workflow." : "Agent already in workflow.";
  } else if (rec.id === "rec-travel-sensitivity") {
    ok = applyTravelTimeSensitivityUpdate();
    msg = ok ? "Root Cause Agent sensitivity updated for travel-time anomalies." : "Could not update agent.";
  } else if (rec.id === "rec-peak-autoticket") {
    ok = applyPeakShiftPlannerUpdate();
    msg = ok ? "Peak-shift auto-ticket rules applied in Maintenance Planner." : "Could not update agent.";
  } else if (rec.kind === "create_agent") {
    const syntheticId = `custom-${String(rec.title || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const agent = {
      id: syntheticId,
      icon: "⬡",
      stage: "custom",
      name: rec.title || "AI Created Agent",
      role: rec.actionType || "Agent workflow update",
      triggerCondition: rec.detail || "Based on AI recommendation",
      assignedTask: rec.detail || "Generated by AI",
      priorityLevel: "P2",
      escalationRule: "User review required",
      status: "active",
      failures: "—",
      robots: { "R-001": true, "R-002": true, "R-003": true, "R-004": true },
      permissions: { readLogs: true, createTicket: true, recommendRepair: true, requestApproval: true, updateHistory: true },
      params: {
        failureThreshold: 3,
        checkFrequency: "On anomaly",
        runSchedule: "24/7",
        confidenceRequired: 0.8,
        autoCreateTicket: false,
        requireTechnicianApproval: true
      }
    };
    const ins = insertWorkflowAgentAfter("pre-shift-monitor", agent);
    ok = ins.ok;
    msg = ok ? `${agent.name} created from AI recommendation.` : "Agent already exists.";
  } else if (rec.kind === "apply_update" || rec.kind === "apply_builder") {
    ok = applyTravelTimeSensitivityUpdate();
    msg = ok ? "Applied update to Root Cause Agent thresholds." : "Could not apply update.";
  }

  if (!ok) {
    showToast("⚠", msg || "Action could not be applied.");
    return;
  }

  setTechnicianActionStatus(rec.id, "applied");
  ensureAgentBuilderConfig();
  state.agentBuilderConfig.dashboardMetrics.suggestedFixes += 1;
  logAgentChange({
    changeType: rec.kind === "create_agent" ? "Create agent" : "Modify agent",
    changedBy: "AI Recommendation",
    reason: rec.detail || rec.title,
    before: "Pending",
    after: "Applied"
  });
  saveAgentRuntimeToServer().catch(() => {});
  showToast("◇", msg);
  afterTechnicianReportMutation();
}

function createAgentFromRecommendation(actionId) {
  const rec = getTechnicianRecommendationById(actionId);
  if (!rec || rec.kind !== "create_agent") return;
  applyTechnicianAction(actionId);
}

function updateAgentFromRecommendation(actionId) {
  const rec = getTechnicianRecommendationById(actionId);
  if (!rec || (rec.kind !== "apply_update" && rec.kind !== "apply_builder")) return;
  applyTechnicianAction(actionId);
}

function setTechnicianReviewed(actionId, checked) {
  state.technicianReport.reviewed[actionId] = checked;
}

async function saveTechnicianFeedbackFlow() {
  const source = getTechnicianActionSourceList();
  const applied = source.filter((x) => {
    const s = getTechnicianActionStatus(x.id);
    return s === "applied" || s === "sent";
  });
  if (!applied.length) {
    showToast("◇", "Apply or send at least one action before feedback.");
    return;
  }
  const target = applied[0];
  const payload = {
    actionId: target.id,
    technicianFeedback: `Technician reviewed ${target.title}.`,
    fixWorked: true,
    beforeAfterKpiValues: {
      before: state.technicianReport.lastAnalysis?.anomalies?.[0] || null,
      after: { note: "pending live validation" }
    }
  };
  const res = await api("/api/ai/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  state.technicianFeedbackHistory.push({
    actionId: payload.actionId,
    feedback: payload.technicianFeedback,
    fixWorked: payload.fixWorked,
    learningUpdate: res.learningUpdate
  });
  setTechnicianActionStatus(target.id, "completed");
  showToast("◇", "Technician feedback saved to memory.");
  renderTechnicianReport();
}

function trSeverityClass(sev) {
  const s = String(sev || "").toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  return "low";
}

function computeTechnicianReportSummary() {
  if (state.technicianReport.generatedSummary) {
    const gs = state.technicianReport.generatedSummary;
    return {
      totalAnomalies: gs.totalAnomalies ?? 0,
      recommendedActions: gs.recommendedActions ?? 0,
      selfFixEligible: gs.autoFixEligible ?? 0,
      techApproval: gs.technicianApprovalRequired ?? 0,
      downtimeAvoided: gs.estimatedDowntimeAvoided || "0h"
    };
  }
  const actions = state.technicianReport.generatedActions || TECHNICIAN_REPORT_ACTIONS;
  const pending = actions.filter((a) => getTechnicianActionStatus(a.id) === "pending").length;
  const applied = actions.filter((a) => {
    const st = getTechnicianActionStatus(a.id);
    return st === "applied" || st === "sent";
  }).length;
  const selfFixEligible = actions.filter((a) => a.selfFix && getTechnicianActionStatus(a.id) === "pending").length;
  const techApproval = actions.filter(
    (a) => a.kind === "technician_task" && getTechnicianActionStatus(a.id) === "pending"
  ).length;
  const downtimeAvoided = `${28 + applied * 6}h`;
  return {
    totalAnomalies: SAMPLE_KPI_ANOMALIES.length,
    recommendedActions: pending,
    selfFixEligible,
    techApproval,
    downtimeAvoided
  };
}

function getTechnicianActionSourceList() {
  return state.technicianReport.generatedActions || TECHNICIAN_REPORT_ACTIONS;
}

async function analyzeKpiAnomaliesWithAI() {
  const fleet = currentFleet();
  if (!fleet || !state.lastMetricsSnapshot?.series) {
    showToast("⚠", "Run KPI Monitor first to gather KPI history.");
    return null;
  }
  const payload = {
    currentKpiValues: Object.fromEntries(
      Object.entries(state.lastMetricsSnapshot.series).map(([k, arr]) => [k, arr[arr.length - 1]])
    ),
    kpiHistory: state.lastMetricsSnapshot.series,
    robots: state.robots,
    activeFleet: fleet,
    activeAgentConfiguration: state.agentBuilderConfig,
    technicianFeedbackHistory: state.technicianFeedbackHistory,
    thresholds: getAnomalyThresholds()
  };
  const res = await api("/api/ai/analyze-kpis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  state.technicianReport.lastAnalysis = res;
  if (Array.isArray(res.anomalies) && res.anomalies.length) {
    updateAiUsage(res.metadata, "Analyze KPI Anomalies");
  } else {
    updateAiUsage({ provider: "mock", model: "mock-norfleet-v1", estimatedTokens: estimateTokensFromObj(payload), costEstimate: "$0.0000" }, "Analyze KPI Anomalies");
  }
  return res;
}

async function generateAiTechnicianReport() {
  const payload = {
    anomalies: state.technicianReport.lastAnalysis?.anomalies || []
  };
  const res = await api("/api/ai/generate-technician-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  state.predictions = res.predictions || state.predictions;
  state.technicianReport.generatedSummary = res.reportSummary || null;
  state.technicianReport.generatedActions = Array.isArray(res.actions)
    ? res.actions.map((a, idx) => ({
        id: a.id || `ai-action-${idx + 1}`,
        title: a.title || "AI recommendation",
        detail: a.explanation || a.reason || "No explanation provided.",
        severity: a.severity || "Medium",
        source: a.source || "Prediction Engine",
        kpiAnomalySource: a.failureMode || "Predictive",
        affectedRobots: Array.isArray(a.affectedRobots) ? a.affectedRobots.join(", ") : String(a.affectedRobots || "Fleet-wide"),
        actionType: a.actionType || "Predictive dispatch",
        buttonLabel: a.buttonLabel || "Apply to Agent Builder",
        predictionId: a.predictionId,
        failureMode: a.failureMode,
        estimatedTimeToFailureHours: a.estimatedTimeToFailureHours,
        confidence: a.confidence,
        kind:
          String(a.buttonLabel || "").toLowerCase().includes("technician")
            ? "technician_task"
            : String(a.buttonLabel || "").toLowerCase().includes("create")
              ? "create_agent"
              : "apply_update",
        selfFix: Boolean(a.autoFixEligible),
        requiresHumanApproval: Boolean(a.requiresHumanApproval)
      }))
    : null;
  updateAiUsage(res.metadata, "Generate AI Report");
  renderTechnicianReport();
  showToast("◇", "Predictive dispatch actions ready.");
}

async function recommendAgentUpdatesWithAI() {
  const anomalies = state.technicianReport.lastAnalysis?.anomalies || [];
  const payload = {
    currentAgentWorkflow: state.agentBuilderConfig,
    kpiAnomalies: anomalies,
    repeatedFailures: state.agentBuilderConfig?.agents?.map((a) => ({ id: a.id, failures: a.failures })) || [],
    technicianFeedback: state.technicianFeedbackHistory
  };
  const res = await api("/api/ai/recommend-agent-updates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  updateAiUsage(res.metadata, "Recommend Agent Updates");
  const updates = res.agentUpdates || [];
  if (!updates.length) {
    showToast("◇", "No additional updates suggested.");
    return;
  }
  updates.forEach((u, idx) => {
    const id = `ai-update-${idx + 1}`;
    if (!state.technicianReport.actionStatus[id]) state.technicianReport.actionStatus[id] = "pending";
  });
  showToast("◇", `${updates.length} agent workflow updates recommended.`);
}

function formatActionStatusLabel(st) {
  if (st === "sent") return "Sent";
  if (st === "applied") return "Applied";
  if (st === "completed") return "Completed";
  return "";
}

function renderTechnicianReport() {
  const root = byId("technician-report-root");
  if (!root) return;
  const sum = computeTechnicianReportSummary();
  const actionSource = getTechnicianActionSourceList();
  const anomaliesSource =
    state.technicianReport.lastAnalysis?.anomalies?.map((a) => ({
      kpi: a.kpi,
      anomaly: `${a.kpi} anomaly`,
      target: `${a.robotId || "R-003"} · ${a.zone || "unknown zone"}`,
      severity: a.severity,
      cause: a.likelyCause || "See analysis details",
      action: a.recommendedAction || "Review and approve recommendation"
    })) || SAMPLE_KPI_ANOMALIES;

  const downtimeDisplay = String(sum.downtimeAvoided || "0h").replace(/^~/, "");
  const summaryHtml = `
    <div class="tr-summary-grid">
      <div class="tr-summary-stat">
        <div class="val">${sum.totalAnomalies}</div>
        <div class="lbl">${sum.recommendedActions} recommended actions</div>
      </div>
      <div class="tr-summary-stat">
        <div class="val">${sum.selfFixEligible} · ${sum.techApproval}</div>
        <div class="lbl">Self-fix · needs approval</div>
      </div>
      <div class="tr-summary-stat">
        <div class="val">~${escapeHtml(downtimeDisplay)}</div>
        <div class="lbl">Est. downtime avoided</div>
      </div>
    </div>`;

  const devMetaHtml = `Provider: ${escapeHtml(displayAiProviderName(state.aiUsage.provider))} · Model: ${escapeHtml(displayAiModelForUi(state.aiUsage.provider, state.aiUsage.model))} · Estimated tokens: ${escapeHtml(String(state.aiUsage.estimatedTokens))} · Estimated cost: ${escapeHtml(state.aiUsage.costEstimate)} · Calls this session: ${escapeHtml(String(state.aiUsage.callsThisSession))} · Last status: ${escapeHtml(state.aiUsage.lastStatus)}`;

  const anomalyCards = anomaliesSource.map(
    (a) => `
    <div class="tr-anomaly-card">
      <div class="tr-anomaly-head">
        <span class="tr-anomaly-kpi">${escapeHtml(a.kpi)}</span>
        <span class="severity-badge ${trSeverityClass(a.severity)}">${escapeHtml(a.severity)}</span>
      </div>
      <p class="tr-anomaly-desc">${escapeHtml(a.anomaly)}</p>
      <span class="tr-anomaly-meta">${escapeHtml(a.target)}</span>
      <p class="tr-anomaly-action">${escapeHtml(a.action)}</p>
      <p class="tr-anomaly-cause">Likely cause: ${escapeHtml(a.cause)}</p>
    </div>`
  ).join("");

  const recRows = actionSource.map((rec) => {
    const st = getTechnicianActionStatus(rec.id);
    const done = st !== "pending";
    const reviewed = state.technicianReport.reviewed[rec.id];
    const statusLabel = done
      ? formatActionStatusLabel(st)
      : reviewed
        ? rec.requiresHumanApproval
          ? "Needs approval"
          : "Reviewed"
        : "Draft";
    const statusHtml = `<span class="tr-status-pill">${escapeHtml(statusLabel)}</span>`;
    const predMeta =
      rec.failureMode && rec.estimatedTimeToFailureHours != null
        ? `<span class="tr-source-pill">${escapeHtml(rec.failureMode.replace(/_/g, " "))} · TTF ${rec.estimatedTimeToFailureHours}h · conf ${((rec.confidence ?? 0) * 100).toFixed(0)}%</span>`
        : "";
    const outcomeBtns =
      (st === "applied" || st === "sent") && st !== "completed"
        ? `<div class="tr-outcome-btns">
            <button type="button" class="tr-btn-ghost" data-tr-outcome="${escapeHtml(rec.id)}" data-outcome="confirmed-failure">Confirmed</button>
            <button type="button" class="tr-btn-ghost" data-tr-outcome="${escapeHtml(rec.id)}" data-outcome="false-alarm">False alarm</button>
            <button type="button" class="tr-btn-ghost" data-tr-outcome="${escapeHtml(rec.id)}" data-outcome="fixed-early">Fixed early</button>
          </div>`
        : "";
    const primaryDisabled = done || !reviewed ? "disabled" : "";
    const rowClass = done ? "tr-rec-row applied" : "tr-rec-row";
    return `
    <div class="${rowClass}" data-tr-id="${escapeHtml(rec.id)}">
      <input type="checkbox" class="nf-checkbox" data-tr-review="1" ${reviewed ? "checked" : ""} aria-label="Mark reviewed" />
      <div class="tr-rec-body">
        <h4>${escapeHtml(rec.title)}</h4>
        <p>${escapeHtml(rec.detail)}</p>
        <div class="tr-rec-meta">
          <span class="severity-badge ${trSeverityClass(rec.severity)}">${escapeHtml(rec.severity)}</span>
          <span class="tr-source-pill">${escapeHtml(rec.source)}</span>
          <span class="tr-action-type">${escapeHtml(rec.actionType)}</span>
          <span>KPI anomaly source: ${escapeHtml(rec.kpiAnomalySource)}</span>
          <span>Affected: ${escapeHtml(rec.affectedRobots)}</span>
          ${predMeta}
          ${statusHtml}
        </div>
        ${outcomeBtns}
      </div>
      <div class="tr-rec-actions">
        <button type="button" class="tr-action-btn" data-tr-action="${escapeHtml(rec.id)}" ${primaryDisabled}>
          ${escapeHtml(rec.buttonLabel)}
        </button>
      </div>
    </div>`;
  }).join("");

  const selfFix = actionSource.filter((r) => r.selfFix);
  const selfFixCards = selfFix
    .map((rec) => {
      const st = getTechnicianActionStatus(rec.id);
      const done = st !== "pending";
      const reviewed = state.technicianReport.reviewed[rec.id];
      return `
      <div class="tr-selffix-card">
        <p><strong>${escapeHtml(rec.title)}</strong> — ${escapeHtml(rec.detail)}</p>
        <button type="button" class="tr-action-btn" data-tr-action="${escapeHtml(rec.id)}" ${done || !reviewed ? "disabled" : ""}>
          ${escapeHtml(rec.buttonLabel)}
        </button>
      </div>`;
    })
    .join("");

  root.innerHTML = `
    <header class="tr-intro">
      <h2>Technician Report</h2>
      <p class="muted">Turn KPI anomalies into reviewable repair actions and agent workflow updates. Generate a report, approve items, then apply or send to the floor.</p>
    </header>

    <section class="tr-block" aria-labelledby="tr-summary-h">
      <div class="tr-block-head">
        <h3 class="tr-section-title" id="tr-summary-h">Report summary</h3>
      </div>
      <div class="tr-toolbar">
        <button type="button" class="tr-btn-primary" id="tr-generate-btn">Generate dispatch report</button>
        <div class="tr-toolbar-secondary" role="group" aria-label="Report workflow steps">
          <button type="button" class="tr-btn-ghost" id="tr-replay-btn">Fast-forward (60×)</button>
          <button type="button" class="tr-btn-ghost" id="tr-analyze-btn">Analyze KPIs</button>
          <button type="button" class="tr-btn-ghost" id="tr-recommend-btn">Recommend updates</button>
          <button type="button" class="tr-btn-ghost" id="tr-apply-selected-btn">Apply selected</button>
          <button type="button" class="tr-btn-ghost" id="tr-save-feedback-btn">Save feedback</button>
        </div>
      </div>
      ${summaryHtml}
      <details class="tr-dev-details">
        <summary>Developer / model info</summary>
        <p class="tr-dev-meta">${devMetaHtml}</p>
      </details>
    </section>

    <section class="tr-block" aria-labelledby="tr-kpi-h">
      <div class="tr-block-head">
        <h3 class="tr-section-title" id="tr-kpi-h">KPI anomaly insights</h3>
        <button type="button" class="tr-link-btn" id="tr-open-kpi-monitor">KPI Monitor →</button>
      </div>
      <div class="tr-kpi-anomaly-grid">${anomalyCards}</div>
    </section>

    <section class="tr-block" aria-labelledby="tr-rec-h">
      <h3 class="tr-section-title" id="tr-rec-h">Action recommendations</h3>
      <p class="muted" style="margin:8px 0 12px;font-size:12px">Mark reviewed, then apply or send each action.</p>
      <div class="tr-rec-list">${recRows}</div>
    </section>

    <section class="tr-block" aria-labelledby="tr-sf-h">
      <h3 class="tr-section-title" id="tr-sf-h">Self-fix suggestions</h3>
      <p class="muted" style="margin:8px 0 12px;font-size:12px">Eligible items sync to Agentic AI Builder when applied.</p>
      <div class="tr-selffix-grid">${selfFixCards}</div>
    </section>
  `;

  root.querySelectorAll(".tr-rec-row [data-tr-review]").forEach((cb) => {
    const row = cb.closest(".tr-rec-row");
    const id = row?.dataset.trId;
    if (!id) return;
    cb.onchange = () => {
      setTechnicianReviewed(id, cb.checked);
      const isDone = getTechnicianActionStatus(id) !== "pending";
      const shouldDisable = isDone || !cb.checked;
      root.querySelectorAll(`[data-tr-action="${id}"]`).forEach((btn) => {
        btn.disabled = shouldDisable;
      });
    };
  });

  root.querySelectorAll("[data-tr-outcome]").forEach((btn) => {
    btn.onclick = () => submitPredictionFeedback(btn.dataset.trOutcome, btn.dataset.outcome).catch((e) => showToast("⚠", e.message));
  });

  root.querySelectorAll("[data-tr-action]").forEach((btn) => {
    btn.onclick = () => applyTechnicianAction(btn.dataset.trAction);
  });

  const kpiLink = byId("tr-open-kpi-monitor");
  if (kpiLink) {
    kpiLink.onclick = () => switchView("monitor", getNavTab("monitor"));
  }

  byId("tr-generate-btn").onclick = () => generateAiTechnicianReport().catch((e) => showToast("⚠", e.message));
  const trReplay = byId("tr-replay-btn");
  if (trReplay) trReplay.onclick = () => runSimReplay(60).catch((e) => showToast("⚠", e.message));
  byId("tr-analyze-btn").onclick = () =>
    analyzeKpiAnomaliesWithAI()
      .then(() => {
        renderTechnicianReport();
        showToast("◇", "KPI anomalies analyzed.");
      })
      .catch((e) => showToast("⚠", e.message));
  byId("tr-recommend-btn").onclick = () => recommendAgentUpdatesWithAI().catch((e) => showToast("⚠", e.message));
  byId("tr-apply-selected-btn").onclick = () => {
    const source = getTechnicianActionSourceList();
    const pendingReviewed = source.filter((x) => state.technicianReport.reviewed[x.id] && getTechnicianActionStatus(x.id) === "pending");
    if (!pendingReviewed.length) {
      showToast("◇", "No reviewed actions selected.");
      return;
    }
    pendingReviewed.forEach((x) => applyTechnicianAction(x.id));
  };
  byId("tr-save-feedback-btn").onclick = () => saveTechnicianFeedbackFlow().catch((e) => showToast("⚠", e.message));
}

function applySavedField(agentId, saveKey) {
  const draft = getOrCreateDraft(agentId);
  if (!draft) return;
  const applySimple = (field) => updateAgentConfig(agentId, field, draft[field], false);
  const applyParam = (key) => updateAgentConfig(agentId, `params.${key}`, draft.params[key], false);

  if (saveKey === "agentConfigPanel") {
    ["icon", "stage", "name", "role", "triggerCondition", "assignedTask", "priorityLevel", "status", "escalationRule"].forEach((field) =>
      applySimple(field)
    );
  } else if (saveKey === "permissionScopePanel") {
    draft.robots = { ...draft.robots };
    Object.entries(draft.robots).forEach(([rid, enabled]) => updateAgentConfig(agentId, `robots.${rid}`, Boolean(enabled), false));
    draft.permissions = { ...draft.permissions };
    Object.entries(draft.permissions).forEach(([perm, enabled]) =>
      updateAgentConfig(agentId, `permissions.${perm}`, Boolean(enabled), false)
    );
  } else if (saveKey === "taskParamsPanel") {
    ["failureThreshold", "checkFrequency", "runSchedule", "confidenceRequired", "autoCreateTicket", "requireTechnicianApproval"].forEach(
      (key) => applyParam(key)
    );
  } else if (saveKey === "name") applySimple("name");
  else if (saveKey === "role") applySimple("role");
  else if (saveKey === "triggerCondition") applySimple("triggerCondition");
  else if (saveKey === "assignedTask") applySimple("assignedTask");
  else if (saveKey === "priorityLevel") applySimple("priorityLevel");
  else if (saveKey === "status") applySimple("status");
  else if (saveKey === "escalationRule") applySimple("escalationRule");
  else if (saveKey === "robotsScope") {
    draft.robots = { ...draft.robots };
    Object.entries(draft.robots).forEach(([rid, enabled]) => updateAgentConfig(agentId, `robots.${rid}`, Boolean(enabled), false));
  } else if (saveKey === "permissionsScope") {
    draft.permissions = { ...draft.permissions };
    Object.entries(draft.permissions).forEach(([perm, enabled]) =>
      updateAgentConfig(agentId, `permissions.${perm}`, Boolean(enabled), false)
    );
  } else if (saveKey === "params.failureThreshold") applyParam("failureThreshold");
  else if (saveKey === "params.checkFrequency") applyParam("checkFrequency");
  else if (saveKey === "params.runSchedule") applyParam("runSchedule");
  else if (saveKey === "params.confidenceRequired") applyParam("confidenceRequired");
  else if (saveKey === "params.autoCreateTicket") applyParam("autoCreateTicket");
  else if (saveKey === "params.requireTechnicianApproval") applyParam("requireTechnicianApproval");

  setDirty(agentId, saveKey, false);
  refreshAgentsSharedUI();
}

function refreshBuilderSaveButtons(agentId) {
  const root = byId("agents-subview-builder");
  if (!root) return;
  root.querySelectorAll(".save-field-btn[data-save-key]").forEach((btn) => {
    const key = btn.dataset.saveKey;
    const dirty = isDirty(agentId, key);
    btn.textContent = dirty ? "Save" : "Saved";
    btn.disabled = !dirty;
    btn.classList.toggle("saved", !dirty);
  });
}

function renderAgentBuilder() {
  ensureAgentBuilderConfig();
  const agentId = state.selectedAgentId;
  const draft = getOrCreateDraft(agentId);
  if (!draft) return;

  renderBuilderWorkflowTrack();

  const saveButtonHtml = (key) =>
    `<button type="button" class="save-field-btn ${isDirty(agentId, key) ? "" : "saved"}" data-save-key="${key}" ${
      isDirty(agentId, key) ? "" : "disabled"
    }>${isDirty(agentId, key) ? "Save" : "Saved"}</button>`;

  const fields = byId("builder-agent-config-fields");
  if (fields) {
    const iconSelectValue = WORKFLOW_ICON_OPTIONS.includes(draft.icon) ? draft.icon : WORKFLOW_ICON_OPTIONS[0];
    const iconOptionsHtml = WORKFLOW_ICON_OPTIONS.map(
      (ic) => `<option value="${escapeHtml(ic)}" ${iconSelectValue === ic ? "selected" : ""}>${escapeHtml(ic)}</option>`
    ).join("");
    fields.innerHTML = `<div class="builder-form-grid">
      <div><label class="field-lbl">Workflow icon</label>
          <select id="bcf-icon">${iconOptionsHtml}</select>
        </div>
      <div><label class="field-lbl">Stage label</label><input type="text" id="bcf-stage" value="${escapeHtml(draft.stage)}" /></div>
      <div><label class="field-lbl">Agent name</label><input type="text" id="bcf-name" value="${escapeHtml(draft.name)}" /></div>
      <div><label class="field-lbl">Role</label><input type="text" id="bcf-role" value="${escapeHtml(draft.role)}" /></div>
      <div><label class="field-lbl">Trigger condition</label><input type="text" id="bcf-trigger" value="${escapeHtml(draft.triggerCondition)}" /></div>
      <div><label class="field-lbl">Assigned task</label><input type="text" id="bcf-task" value="${escapeHtml(draft.assignedTask)}" /></div>
      <div><label class="field-lbl">Priority level</label><input type="text" id="bcf-priority" value="${escapeHtml(draft.priorityLevel)}" /></div>
      <div><label class="field-lbl">Status</label>
          <select id="bcf-status">
            <option value="active" ${draft.status === "active" ? "selected" : ""}>active</option>
            <option value="idle" ${draft.status === "idle" ? "selected" : ""}>idle</option>
          </select>
        </div>
      <div><label class="field-lbl">Escalation rule</label><input type="text" id="bcf-escalation" value="${escapeHtml(draft.escalationRule)}" /></div>
    </div>`;

    const markConfigDirty = () => {
      setDirty(agentId, "agentConfigPanel", true);
      refreshBuilderSaveButtons(agentId);
    };
    byId("bcf-icon").addEventListener("change", (e) => {
      draft.icon = e.target.value;
      markConfigDirty();
    });
    byId("bcf-stage").addEventListener("input", (e) => {
      draft.stage = e.target.value;
      markConfigDirty();
    });
    byId("bcf-name").addEventListener("input", (e) => {
      draft.name = e.target.value;
      markConfigDirty();
    });
    byId("bcf-role").addEventListener("input", (e) => {
      draft.role = e.target.value;
      markConfigDirty();
    });
    byId("bcf-trigger").addEventListener("input", (e) => {
      draft.triggerCondition = e.target.value;
      markConfigDirty();
    });
    byId("bcf-task").addEventListener("input", (e) => {
      draft.assignedTask = e.target.value;
      markConfigDirty();
    });
    byId("bcf-priority").addEventListener("input", (e) => {
      draft.priorityLevel = e.target.value;
      markConfigDirty();
    });
    byId("bcf-escalation").addEventListener("input", (e) => {
      draft.escalationRule = e.target.value;
      markConfigDirty();
    });
    byId("bcf-status").addEventListener("change", (e) => {
      draft.status = e.target.value;
      markConfigDirty();
    });
  }

  const robotsEl = byId("builder-robot-permissions");
  if (robotsEl) {
    robotsEl.innerHTML = `<div class="field-lbl" style="margin-bottom:8px">Robots &amp; fleets scope</div>
      <div class="builder-checkbox-grid">${SAMPLE_ROBOT_REGISTRY.map((r) => {
        const checked = draft.robots[r.id];
        return `<label class="builder-check-row nf-check-row"><span>${escapeHtml(r.id)} ${escapeHtml(r.label)}</span><input class="nf-checkbox" type="checkbox" data-robot-id="${r.id}" ${checked ? "checked" : ""} /></label>`;
      }).join("")}</div>
      <div class="field-lbl" style="margin:14px 0 8px">Permissions</div>
      <div class="builder-checkbox-grid">${BUILDER_PERMISSION_META.map(
        (meta) =>
          `<label class="builder-check-row nf-check-row"><span>${escapeHtml(meta.label)}</span><input class="nf-checkbox" type="checkbox" data-perm-key="${meta.key}" ${draft.permissions[meta.key] ? "checked" : ""} /></label>`
      ).join("")}</div>`;
    robotsEl.querySelectorAll("[data-robot-id]").forEach((inp) => {
      inp.addEventListener("change", () => {
        draft.robots[inp.dataset.robotId] = inp.checked;
        setDirty(agentId, "permissionScopePanel", true);
        refreshBuilderSaveButtons(agentId);
      });
    });
    robotsEl.querySelectorAll("[data-perm-key]").forEach((inp) => {
      inp.addEventListener("change", () => {
        draft.permissions[inp.dataset.permKey] = inp.checked;
        setDirty(agentId, "permissionScopePanel", true);
        refreshBuilderSaveButtons(agentId);
      });
    });
  }

  const p = draft.params;
  const confOpts = [0.7, 0.75, 0.8, 0.82, 0.85, 0.88, 0.9, 0.95];
  const paramsEl = byId("builder-task-params");
  if (paramsEl) {
    paramsEl.innerHTML = `<div class="builder-form-grid">
      <div><label class="field-lbl">Failure threshold</label><input type="number" id="bcf-ft" min="0" step="1" value="${p.failureThreshold}" /></div>
      <div><label class="field-lbl">Check frequency</label><input type="text" id="bcf-freq" value="${escapeHtml(p.checkFrequency)}" /></div>
      <div><label class="field-lbl">Run schedule</label><input type="text" id="bcf-sched" value="${escapeHtml(p.runSchedule)}" /></div>
      <div><label class="field-lbl">Confidence required before action</label>
        <select id="bcf-conf">${confOpts.map((v) => `<option value="${v}" ${Math.abs(p.confidenceRequired - v) < 0.001 ? "selected" : ""}>${v}</option>`).join("")}</select>
      </div>
      <label class="builder-check-row nf-check-row"><span>Auto-create ticket</span><input class="nf-checkbox" type="checkbox" id="bcf-autotix" ${p.autoCreateTicket ? "checked" : ""} /></label>
      <label class="builder-check-row nf-check-row"><span>Require technician approval</span><input class="nf-checkbox" type="checkbox" id="bcf-appr" ${p.requireTechnicianApproval ? "checked" : ""} /></label>
    </div>`;

    byId("bcf-ft").addEventListener("input", (e) => {
      draft.params.failureThreshold = Number(e.target.value) || 0;
      setDirty(agentId, "taskParamsPanel", true);
      refreshBuilderSaveButtons(agentId);
    });
    byId("bcf-freq").addEventListener("input", (e) => {
      draft.params.checkFrequency = e.target.value;
      setDirty(agentId, "taskParamsPanel", true);
      refreshBuilderSaveButtons(agentId);
    });
    byId("bcf-sched").addEventListener("input", (e) => {
      draft.params.runSchedule = e.target.value;
      setDirty(agentId, "taskParamsPanel", true);
      refreshBuilderSaveButtons(agentId);
    });
    byId("bcf-conf").addEventListener("change", (e) => {
      draft.params.confidenceRequired = Number(e.target.value);
      setDirty(agentId, "taskParamsPanel", true);
      refreshBuilderSaveButtons(agentId);
    });
    byId("bcf-autotix").addEventListener("change", (e) => {
      draft.params.autoCreateTicket = e.target.checked;
      setDirty(agentId, "taskParamsPanel", true);
      refreshBuilderSaveButtons(agentId);
    });
    byId("bcf-appr").addEventListener("change", (e) => {
      draft.params.requireTechnicianApproval = e.target.checked;
      setDirty(agentId, "taskParamsPanel", true);
      refreshBuilderSaveButtons(agentId);
    });
  }

  const builderRoot = byId("agents-subview-builder");
  if (builderRoot && builderRoot.dataset.nfSaveDelegation !== "1") {
    builderRoot.dataset.nfSaveDelegation = "1";
    builderRoot.addEventListener("click", (e) => {
      const btn = e.target.closest(".save-field-btn[data-save-key]");
      if (!btn || btn.disabled) return;
      const aid = state.selectedAgentId;
      applySavedField(aid, btn.dataset.saveKey);
      refreshBuilderSaveButtons(aid);
    });
  }
  refreshBuilderSaveButtons(agentId);

  const sug = byId("builder-suggestions-list");
  if (sug && sug.dataset.rendered !== "1") {
    sug.innerHTML = BUILDER_AI_SUGGESTIONS.map((s) => `<li class="builder-suggestion-row">${escapeHtml(s)}</li>`).join("");
    sug.dataset.rendered = "1";
  }
}

function renderAgentsView() {
  ensureAgentBuilderConfig();

  document.querySelectorAll(".agents-subtab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.agentsSub === state.agentSubView);
  });
  byId("agents-subview-overview")?.classList.toggle("active", state.agentSubView === "overview");
  byId("agents-subview-builder")?.classList.toggle("active", state.agentSubView === "builder");

  const overviewPanel = byId("overview-workflow-panel");
  if (overviewPanel) overviewPanel.classList.toggle("expanded", state.overviewExpanded);
  const overviewBtn = byId("overview-expand-btn");
  if (overviewBtn) overviewBtn.textContent = state.overviewExpanded ? "Collapse" : "Expand";

  const builderPanel = byId("builder-workflow-panel");
  if (builderPanel) builderPanel.classList.toggle("expanded", state.builderExpanded);
  const builderBtn = byId("builder-expand-btn");
  if (builderBtn) builderBtn.textContent = state.builderExpanded ? "Collapse" : "Expand";

  refreshAgentsSharedUI();

  if (state.agentSubView === "builder") {
    renderAgentBuilder();
  }
}

function showToast(icon, msg) {
  const t = byId("toast");
  if (!t) return;
  byId("toast-icon").textContent = icon;
  byId("toast-msg").textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}

function updateClock() {
  const el = byId("live-clock");
  if (el) el.textContent = new Date().toLocaleTimeString("en-US", { hour12: false }) + " UTC";
}

function updateChips(summary) {
  const a = byId("chip-active");
  const i = byId("chip-idle");
  const c = byId("chip-charging");
  if (a) a.textContent = `${summary.active} Active`;
  if (i) i.textContent = `${summary.idle} Idle`;
  if (c) c.textContent = `${summary.charging} Charging`;
}

async function api(url, options = {}) {
  const token = getSessionAdminToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("x-norfleet-admin-token", token);
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function openSettingsModal() {
  const modal = byId("settings-modal");
  if (!modal) return;
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
}

function closeSettingsModal() {
  const modal = byId("settings-modal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

function providerDefaultModel(provider) {
  const p = String(provider || "mock").toLowerCase();
  if (p === "openai") return "gpt-4o-mini";
  if (p === "anthropic") return "claude-3-5-sonnet-latest";
  if (p === "gemini") return "gemini-1.5-pro";
  return "mock-norfleet-v1";
}

async function loadSettingsIntoUi() {
  const data = await api("/api/settings");
  state.settings = data.settings || state.settings;
  if (data.aiUsage?.lastCall) updateAiUsage(data.aiUsage.lastCall, "Loaded");
  byId("st-ai-provider").value = state.settings.ai.provider || "mock";
  byId("st-ai-model").value = state.settings.ai.model || providerDefaultModel(state.settings.ai.provider);
  byId("st-ai-key").value = "";
  byId("st-ai-mock").checked = Boolean(state.settings.ai.mockMode);
  byId("st-kpi-key").value = "";
  byId("st-kpi-base").value = state.settings.data.kpiApiBaseUrl || "";
  byId("st-robot-base").value = state.settings.data.robotApiBaseUrl || "";
  byId("st-data-mode").value = state.settings.data.dataMode || "mock";
  byId("st-ai-status").textContent = `Status: ${aiSettingsStatusLine(
    Boolean(state.settings.ai.mockMode),
    Boolean(state.settings.ai.hasApiKey)
  )}`;
  byId("st-data-status").textContent = `Status: ${dataModeLabel(state.settings.data.dataMode)}`;
  const adminInput = byId("st-admin-token");
  if (adminInput) adminInput.value = "";
  refreshAdminTokenHint();
}

async function saveAiSettings() {
  const provider = byId("st-ai-provider").value;
  const model = byId("st-ai-model").value.trim() || providerDefaultModel(provider);
  const apiKey = byId("st-ai-key").value.trim();
  const mockMode = byId("st-ai-mock").checked || provider === "mock";
  await api("/api/settings/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, model, apiKey, mockMode })
  });
  localStorage.setItem("norfleet_ai_provider", provider);
  localStorage.setItem("norfleet_ai_model", model);
  localStorage.setItem("norfleet_ai_mock", String(mockMode));
  byId("st-ai-status").textContent = `Status: ${mockMode ? aiSettingsStatusLine(true, false) : apiKey ? "Configured" : "Saved (no key)"}`;
  showToast("◇", "AI settings saved.");
}

async function saveDataSettings() {
  const payload = {
    kpiApiKey: byId("st-kpi-key").value.trim(),
    kpiApiBaseUrl: byId("st-kpi-base").value.trim(),
    robotApiBaseUrl: byId("st-robot-base").value.trim(),
    dataMode: byId("st-data-mode").value
  };
  await api("/api/settings/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  localStorage.setItem("norfleet_data_mode", payload.dataMode);
  byId("st-data-status").textContent = `Status: ${dataModeLabel(payload.dataMode)}`;
  showToast("◇", "Data source settings saved.");
}

async function testAiConnection() {
  const data = await api("/api/settings/test-connection", { method: "POST" });
  byId("st-ai-status").textContent = `Status: ${data.status} (${displayAiProviderName(data.provider)})`;
  if (data.meta) updateAiUsage(data.meta, "Test connection");
  showToast("◇", data.status);
}

async function clearSettingsKeys() {
  await api("/api/settings/clear-keys", { method: "POST" });
  byId("st-ai-key").value = "";
  byId("st-kpi-key").value = "";
  byId("st-ai-status").textContent = "Status: Keys cleared";
  showToast("◇", "Stored keys cleared.");
}

function syncFleetDropdowns() {
  const a = byId("fleet-select");
  const b = byId("fleet-select-monitor");
  if (!a || !b) return;
  const validIds = new Set(state.fleets.map((f) => f.id));
  if (state.selectedFleetId && !validIds.has(state.selectedFleetId)) {
    state.selectedFleetId = state.fleets[0]?.id ?? null;
  }
  [a, b].forEach((sel) => {
    sel.innerHTML = "";
    state.fleets.forEach((fleet) => {
      const option = document.createElement("option");
      option.value = fleet.id;
      option.textContent = `${fleet.name} (${fleet.summary?.total ?? 0} robots)`;
      sel.appendChild(option);
    });
    if (state.selectedFleetId) sel.value = state.selectedFleetId;
  });
  a.onchange = (e) => {
    state.selectedFleetId = e.target.value;
    b.value = state.selectedFleetId;
  };
  b.onchange = (e) => {
    state.selectedFleetId = e.target.value;
    a.value = state.selectedFleetId;
    loadMetricsAndStream().catch((err) => showToast("⚠", err.message));
  };
}

function renderRobots() {
  const robotsList = byId("robots-list");
  const selector = byId("fleet-robot-select");
  if (!robotsList || !selector) return;
  robotsList.innerHTML = "";
  selector.innerHTML = "";

  if (state.robots.length === 0) {
    robotsList.innerHTML = '<div class="list-item muted">No robots yet. Add one above.</div>';
    selector.innerHTML = '<div class="list-item muted">Add robots to assign them to a fleet.</div>';
    return;
  }

  state.robots.forEach((robot) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `<span>${robot.id} · ${robot.name} · ${robot.model} <span style="color:var(--text3)">Z${robot.warehouseZone}</span></span><span style="color:var(--accent3)">${robot.status}</span>`;
    robotsList.appendChild(row);

    const wrap = document.createElement("label");
    wrap.className = "list-item fleet-select-row";
    const checked = state.selectedRobotIds.has(robot.id);
    wrap.innerHTML = `<span>${robot.id} · ${robot.name}</span><input class="nf-checkbox" type="checkbox" ${checked ? "checked" : ""} />`;
    wrap.querySelector("input").onchange = (e) => {
      if (e.target.checked) state.selectedRobotIds.add(robot.id);
      else state.selectedRobotIds.delete(robot.id);
    };
    selector.appendChild(wrap);
  });
}

function renderFleets() {
  syncFleetDropdowns();
  if (state.fleets.length && !state.selectedFleetId) {
    state.selectedFleetId = state.fleets[0].id;
    syncFleetDropdowns();
  }
}

function renderKpis(kpis) {
  const kpiList = byId("kpi-list");
  if (!kpiList) return;
  kpiList.innerHTML = "";
  if (!kpis || kpis.length === 0) {
    kpiList.innerHTML = '<span class="muted">No KPIs yet — run AI detection for the selected fleet.</span>';
    clearCharts();
    renderChartsEmptyState();
    return;
  }
  const series = state.latestSeries || {};
  kpis.forEach((kpi) => {
    const tag = document.createElement("button");
    tag.type = "button";
    tag.dataset.kpi = kpi;
    const det = detectKpiChartAnomaly(kpi, series[kpi]);
    const anom = det.anomalous;
    tag.className = `kpi-tag ${state.enabledKpis.has(kpi) ? "active" : "disabled"}${anom ? " kpi-tag--anomaly" : ""}`;
    const badges =
      det.badges.length > 0
        ? `<span class="kpi-tag-badges">${det.badges.map((b) => `<span class="kpi-mini-badge">${escapeHtml(b)}</span>`).join("")}</span>`
        : "";
    tag.innerHTML = `<span class="kpi-tag-name">${escapeHtml(kpi)}</span>${badges}`;
    tag.onclick = () => toggleKpi(kpi);
    kpiList.appendChild(tag);
  });
}

function chartColorsForDetection(detection) {
  return detection.anomalous
    ? { line: "#f87171", fill: "rgba(248,113,113,0.12)" }
    : { line: "#00e5ff", fill: "rgba(0,229,255,0.08)" };
}

let norfleetCrosshairPluginRegistered = false;

function withAlphaCssColor(color, alpha) {
  const s = String(color || "#00e5ff").trim();
  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
  if (s.startsWith("#") && s.length === 7) {
    const r = parseInt(s.slice(1, 3), 16);
    const g = parseInt(s.slice(3, 5), 16);
    const b = parseInt(s.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return s;
}

function formatKpiCrosshairYValue(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  if (Math.abs(n - Math.round(n)) < 1e-9 && Math.abs(n) < 1e12) return String(Math.round(n));
  if (Math.abs(n) >= 100) return n.toFixed(1);
  if (Math.abs(n) >= 10) return n.toFixed(2);
  return n.toFixed(3);
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const norfleetCrosshairPlugin = {
  id: "norfleetCrosshair",
  afterInit(chart) {
    chart.$crosshair = null;
    const canvas = chart.canvas;
    const ac = new AbortController();
    const { signal } = ac;

    let raf = null;
    let lastEvent = null;
    const applyFromEvent = (e) => {
      const items = chart.getElementsAtEventForMode(e, "index", { intersect: false }, false);
      if (!items.length) {
        if (chart.$crosshair) {
          chart.$crosshair = null;
          chart.update("none");
        }
        return;
      }
      const el = items[0];
      const { x, y } = el.element.getProps(["x", "y"], true);
      const raw = chart.data.datasets[0].data[el.index];
      const next = { x, y, value: raw, index: el.index };
      const prev = chart.$crosshair;
      if (prev && prev.index === next.index && prev.value === next.value) return;
      chart.$crosshair = next;
      chart.update("none");
    };

    const onMove = (e) => {
      lastEvent = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const ev = lastEvent;
        lastEvent = null;
        if (ev) applyFromEvent(ev);
      });
    };
    const onLeave = () => {
      lastEvent = null;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      if (chart.$crosshair) {
        chart.$crosshair = null;
        chart.update("none");
      }
    };

    canvas.addEventListener("mousemove", onMove, { signal });
    canvas.addEventListener("mouseleave", onLeave, { signal });
    chart.$crosshairCleanup = () => ac.abort();
  },
  destroy(chart) {
    if (typeof chart.$crosshairCleanup === "function") chart.$crosshairCleanup();
  },
  afterDraw(chart) {
    const hit = chart.$crosshair;
    if (!hit) return;
    const { ctx, chartArea } = chart;
    const color = chart.data.datasets[0].borderColor || "#00e5ff";
    const dim = withAlphaCssColor(color, 0.55);
    const text = formatKpiCrosshairYValue(hit.value);
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = dim;
    ctx.lineWidth = 1;
    ctx.moveTo(hit.x, chartArea.top);
    ctx.lineTo(hit.x, chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(15,23,42,0.92)";
    ctx.lineWidth = 2;
    ctx.arc(hit.x, hit.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = "600 12px ui-monospace, 'Cascadia Code', 'Segoe UI Mono', monospace";
    const padX = 10;
    const padY = 6;
    const metrics = ctx.measureText(text);
    const boxW = metrics.width + padX * 2;
    const boxH = 24;
    let bx = hit.x + 12;
    let by = hit.y - boxH / 2;
    bx = Math.min(Math.max(bx, chartArea.left + 2), chartArea.right - boxW - 2);
    by = Math.min(Math.max(by, chartArea.top + 2), chartArea.bottom - boxH - 2);
    ctx.fillStyle = "rgba(15,23,42,0.94)";
    ctx.strokeStyle = withAlphaCssColor(color, 0.45);
    ctx.lineWidth = 1;
    roundRectPath(ctx, bx, by, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e2e8f0";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(text, bx + padX, by + boxH / 2);
    ctx.restore();
  }
};

function registerNorfleetCrosshairPlugin() {
  if (norfleetCrosshairPluginRegistered || !window.Chart) return;
  Chart.register(norfleetCrosshairPlugin);
  norfleetCrosshairPluginRegistered = true;
}

function chartJsOptionsForKpi() {
  const axisFontFamily = "ui-monospace, 'Cascadia Code', 'Segoe UI Mono', monospace";
  const tickFont = { size: 11, family: axisFontFamily };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false, axis: "x" },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false }
    },
    layout: {
      padding: { left: 0, right: 4, top: 2, bottom: 2 }
    },
    scales: {
      x: {
        display: true,
        offset: true,
        ticks: {
          color: "#94a3b8",
          maxTicksLimit: 9,
          font: tickFont,
          padding: 4,
          autoSkip: true,
          autoSkipPadding: 10,
          maxRotation: 0,
          minRotation: 0
        },
        grid: { color: "rgba(255,255,255,0.05)" }
      },
      y: {
        display: true,
        offset: true,
        ticks: {
          color: "#94a3b8",
          font: tickFont,
          padding: 6,
          maxTicksLimit: 9,
          mirror: false
        },
        grid: { color: "rgba(255,255,255,0.05)" }
      }
    }
  };
}

function upsertChart(kpi, values) {
  const chartsWrap = byId("charts");
  if (!chartsWrap || !window.Chart) return;
  registerNorfleetCrosshairPlugin();
  const safeId = kpi.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
  const numericValues = (values || []).map(Number);
  const detection = detectKpiChartAnomaly(kpi, numericValues);
  const colors = chartColorsForDetection(detection);
  const badgeHtml = detection.badges.map((b) => `<span class="chart-badge">${escapeHtml(b)}</span>`).join("");
  const unitPair = escapeHtml(getKpiChartMeta(kpi).chartHeaderUnits);

  if (!state.charts[kpi]) {
    const card = document.createElement("div");
    card.className = `chart-card${detection.anomalous ? " chart-card--anomaly" : ""}`;
    card.innerHTML = `<div class="chart-card-head">
      <div class="chart-title-block">
        <div class="chart-title">${escapeHtml(kpi)} <span class="chart-unit-pair">(${unitPair})</span></div>
      </div>
      <div class="chart-badges">${badgeHtml}</div>
    </div><div class="chart-canvas-wrap"><canvas id="chart-${safeId}"></canvas></div>`;
    chartsWrap.appendChild(card);
    const canvas = card.querySelector("canvas");
    state.charts[kpi] = new Chart(canvas, {
      type: "line",
      data: {
        labels: numericValues.map((_, idx) => idx + 1),
        datasets: [
          {
            label: kpi,
            data: numericValues,
            borderColor: colors.line,
            backgroundColor: colors.fill,
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3
          }
        ]
      },
      options: chartJsOptionsForKpi()
    });
  } else {
    const chart = state.charts[kpi];
    chart.data.labels = numericValues.map((_, idx) => idx + 1);
    chart.data.datasets[0].data = numericValues;
    chart.data.datasets[0].borderColor = colors.line;
    chart.data.datasets[0].backgroundColor = colors.fill;
    chart.update();
    const card = chart.canvas.closest(".chart-card");
    if (card) {
      card.classList.toggle("chart-card--anomaly", detection.anomalous);
      const badgesEl = card.querySelector(".chart-badges");
      if (badgesEl) badgesEl.innerHTML = badgeHtml;
    }
  }
}

function syncCharts(series) {
  state.latestSeries = series || {};
  renderEnabledCharts();
}

function clearCharts() {
  Object.values(state.charts).forEach((chart) => chart.destroy());
  state.charts = {};
  const chartsWrap = byId("charts");
  if (chartsWrap) chartsWrap.innerHTML = "";
}

function renderChartsEmptyState() {
  const chartsWrap = byId("charts");
  if (!chartsWrap) return;
  chartsWrap.innerHTML =
    '<div class="chart-card" style="grid-column: 1 / -1; display:flex; align-items:center; justify-content:center;"><div class="chart-title" style="margin:0; text-transform:none; letter-spacing:0; color: var(--text2);">Select KPIs above to display live charts.</div></div>';
}

function renderEnabledCharts() {
  const series = state.latestSeries || {};
  const enabledEntries = Object.entries(series).filter(([kpi]) => state.enabledKpis.has(kpi));

  clearCharts();

  if (enabledEntries.length === 0) {
    renderChartsEmptyState();
    return;
  }

  enabledEntries.forEach(([kpi, values]) => upsertChart(kpi, values));
}

function toggleKpi(kpi) {
  if (state.enabledKpis.has(kpi)) state.enabledKpis.delete(kpi);
  else state.enabledKpis.add(kpi);

  const currentKpis = byId("kpi-list")
    ? Array.from(byId("kpi-list").querySelectorAll(".kpi-tag")).map((el) => el.dataset.kpi)
    : [];
  renderKpis(currentKpis);
  renderEnabledCharts();
}

function updateSummary(summary) {
  if (!summary) return;
  const total = byId("sum-total");
  const active = byId("sum-active");
  const idle = byId("sum-idle");
  const charging = byId("sum-charging");
  if (total) total.textContent = summary.total;
  if (active) active.textContent = summary.active;
  if (idle) idle.textContent = summary.idle;
  if (charging) charging.textContent = summary.charging;
  updateChips(summary);
}

async function loadInitial() {
  state.robots = await api("/api/robots");
  state.fleets = await api("/api/fleets");
  await syncAgentRuntimeFromServer();
  await refreshPredictions().catch(() => {});
  renderRobots();
  renderFleets();
}

async function addRobot() {
  const name = byId("robot-name").value.trim();
  const model = byId("robot-model").value;
  const warehouseZone = byId("robot-zone").value.trim();
  const taskProfile = byId("robot-task").value.trim();
  if (!name || !warehouseZone) {
    showToast("⬡", "Name and zone are required.");
    return;
  }
  try {
    await api("/api/robots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, model, warehouseZone, taskProfile })
    });
    byId("robot-name").value = "";
    byId("robot-zone").value = "";
    byId("robot-task").value = "";
    state.robots = await api("/api/robots");
    renderRobots();
    showToast("⬡", "Robot added.");
  } catch (err) {
    showToast("⚠", err.message);
  }
}

async function createFleet() {
  const name = byId("fleet-name").value.trim();
  if (!name || state.selectedRobotIds.size === 0) {
    showToast("◈", "Fleet name and at least one robot are required.");
    return;
  }
  try {
    await api("/api/fleets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, robotIds: Array.from(state.selectedRobotIds) })
    });
    byId("fleet-name").value = "";
    state.selectedRobotIds.clear();
    state.fleets = await api("/api/fleets");
    state.selectedFleetId = state.fleets[state.fleets.length - 1]?.id || null;
    renderFleets();
    renderRobots();
    showToast("◈", "Fleet created.");
  } catch (err) {
    showToast("⚠", err.message);
  }
}

async function detectKpisForFleet() {
  if (!state.selectedFleetId) {
    showToast("⚠", "Create a fleet first.");
    return;
  }
  const status = byId("status");
  if (status) status.textContent = "Detecting KPIs with AI…";
  try {
    const data = await api(`/api/fleets/${state.selectedFleetId}/detect-kpis`, { method: "POST" });
    renderKpis(data.kpis);
    if (status) status.textContent = "KPIs ready. Streaming live metrics.";
    await loadMetricsAndStream();
    showToast("◈", `Detected ${data.kpis.length} KPI(s).`);
  } catch (err) {
    if (status) status.textContent = err.message;
    showToast("⚠", err.message);
  }
}

async function loadMetricsAndStream() {
  if (!state.selectedFleetId) return;
  const metrics = await api(`/api/fleets/${state.selectedFleetId}/metrics`);
  state.lastMetricsSnapshot = metrics;
  syncCharts(metrics.series);
  renderKpis(metrics.kpis);

  const selected = state.fleets.find((f) => f.id === state.selectedFleetId);
  if (selected?.summary) updateSummary(selected.summary);

  if (state.stream) state.stream.close();
  state.stream = new EventSource(`/api/stream?fleetId=${encodeURIComponent(state.selectedFleetId)}`);
  state.stream.onmessage = (event) => {
    const data = JSON.parse(event.data);
    state.lastMetricsSnapshot = { fleetId: data.fleetId, kpis: data.kpis, series: data.series };
    if (data.predictions) {
      state.predictions = data.predictions;
      renderPredictionBanner();
    }
    syncCharts(data.series);
    renderKpis(data.kpis);
    updateSummary(data.summary);
  };
  state.stream.onerror = () => {
    showToast("⚠", "Live stream interrupted. Reconnecting…");
    state.stream.close();
    setTimeout(() => loadMetricsAndStream().catch(() => {}), 2000);
  };
}

function bindEvents() {
  byId("add-robot-btn").onclick = () => addRobot().catch((e) => showToast("⚠", e.message));
  byId("create-fleet-btn").onclick = () => createFleet().catch((e) => showToast("⚠", e.message));
  byId("detect-kpis-btn").onclick = () => detectKpisForFleet().catch((e) => showToast("⚠", e.message));
  byId("analyze-with-ai-btn").onclick = () =>
    analyzeKpiAnomaliesWithAI()
      .then(() => {
        switchView("technician-report", getNavTab("technician-report"));
        renderTechnicianReport();
      })
      .catch((e) => showToast("⚠", e.message));

  byId("open-settings-btn").onclick = () =>
    loadSettingsIntoUi()
      .then(() => openSettingsModal())
      .catch((e) => showToast("⚠", e.message));
  byId("close-settings-btn").onclick = () => closeSettingsModal();
  byId("st-save-ai-btn").onclick = () => saveAiSettings().catch((e) => showToast("⚠", e.message));
  byId("st-save-data-btn").onclick = () => saveDataSettings().catch((e) => showToast("⚠", e.message));
  byId("st-test-ai-btn").onclick = () => testAiConnection().catch((e) => showToast("⚠", e.message));
  byId("st-clear-keys-btn").onclick = () => clearSettingsKeys().catch((e) => showToast("⚠", e.message));
  const saveAdmin = byId("st-save-admin-token-btn");
  const clearAdmin = byId("st-clear-admin-token-btn");
  if (saveAdmin) saveAdmin.onclick = () => saveSessionAdminToken();
  if (clearAdmin) clearAdmin.onclick = () => clearSessionAdminToken();
  byId("st-ai-provider").onchange = (e) => {
    byId("st-ai-model").value = providerDefaultModel(e.target.value);
  };
}

window.runSimReplay = runSimReplay;
window.submitPredictionFeedback = submitPredictionFeedback;
window.switchView = switchView;
window.switchAgentSubView = switchAgentSubView;
window.selectAgent = selectAgent;
window.updateAgentConfig = updateAgentConfig;
window.toggleWorkflowExpand = toggleWorkflowExpand;
window.applyTechnicianAction = applyTechnicianAction;
window.createAgentFromRecommendation = createAgentFromRecommendation;
window.updateAgentFromRecommendation = updateAgentFromRecommendation;
window.setTechnicianReviewed = setTechnicianReviewed;

setInterval(() => {
  refreshPredictions().then(() => renderPredictionBanner()).catch(() => {});
}, 8000);
setInterval(updateClock, 1000);
updateClock();
bindEvents();
loadSettingsIntoUi().catch(() => {});
loadInitial()
  .then(() => {
    if (state.selectedFleetId) {
      return loadMetricsAndStream().catch(() => {});
    }
  })
  .catch((err) => showToast("⚠", `Load failed: ${err.message}`));
