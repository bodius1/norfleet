const state = {
  robots: [],
  fleets: [],
  selectedRobotIds: new Set(),
  selectedFleetId: null,
  enabledKpis: new Set(["Throughput", "Cycle Time"]),
  latestSeries: {},
  charts: {},
  stream: null,
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
    actionStatus: {}
  }
};

const MOCK_ROBOT_REGISTRY = [
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

/** KPI anomaly mock data (aligned with KPI Monitor naming). */
const MOCK_KPI_ANOMALIES = [
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

function buildOverviewTakeawaysFromConfig() {
  ensureAgentBuilderConfig();
  const agents = state.agentBuilderConfig.agents;
  const get = (id) => agents.find((a) => a.id === id);
  const monitor = get("pre-shift-monitor");
  const root = get("root-cause");
  const planner = get("maintenance-planner");
  const dispatch = get("technician-dispatch");

  const readScope = Object.entries(root?.robots || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([id]) => id)
    .slice(0, 2)
    .join(", ");
  const scopeText = readScope ? `${readScope}` : "priority robots";
  const conf = planner?.params?.confidenceRequired ?? 0.85;
  const autoTicket = dispatch?.params?.autoCreateTicket;
  const approval = dispatch?.params?.requireTechnicianApproval;
  const threshold = root?.params?.failureThreshold ?? 3;

  return [
    {
      text: `${planner?.name || "Maintenance Planner"}: prioritize ${planner?.assignedTask?.toLowerCase?.() || "repair checklist generation"} for ${scopeText}.`,
      priority: "High — execution"
    },
    {
      text: `${root?.name || "Root Cause Agent"} trigger threshold is ${threshold}; monitor repeated faults before escalation.`,
      priority: "High — reliability"
    },
    {
      text: `${dispatch?.name || "Technician Dispatch"} is ${dispatch?.status || "idle"}; ${autoTicket ? "auto-ticketing enabled" : "manual ticket creation"}${approval ? " with technician approval required" : " with autonomous dispatch mode"}.`,
      priority: "Medium — staffing"
    },
    {
      text: `${monitor?.name || "Pre-Shift Monitor"} confidence gate set near ${(conf * 100).toFixed(0)}%; tune during peak shift windows if needed.`,
      priority: "Medium — calibration"
    }
  ];
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
  return TECHNICIAN_REPORT_ACTIONS.find((a) => a.id === id) || null;
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
  if (state.agentSubView === "report") renderTechnicianReport();
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
  }

  if (!ok) {
    showToast("⚠", msg || "Action could not be applied.");
    return;
  }

  setTechnicianActionStatus(rec.id, "applied");
  ensureAgentBuilderConfig();
  state.agentBuilderConfig.dashboardMetrics.suggestedFixes += 1;
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

function trSeverityClass(sev) {
  const s = String(sev || "").toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  return "low";
}

function computeTechnicianReportSummary() {
  const actions = TECHNICIAN_REPORT_ACTIONS;
  const pending = actions.filter((a) => getTechnicianActionStatus(a.id) === "pending").length;
  const applied = actions.filter((a) => {
    const st = getTechnicianActionStatus(a.id);
    return st === "applied" || st === "sent";
  }).length;
  const selfFixEligible = actions.filter((a) => a.selfFix && getTechnicianActionStatus(a.id) === "pending").length;
  const techApproval = actions.filter(
    (a) => a.kind === "technician_task" && getTechnicianActionStatus(a.id) === "pending"
  ).length;
  const downtimeAvoided = 28 + applied * 6;
  return {
    totalAnomalies: MOCK_KPI_ANOMALIES.length,
    recommendedActions: pending,
    selfFixEligible,
    techApproval,
    downtimeAvoided
  };
}

function getKpiMonitorBridgeNote() {
  const keys = Object.keys(state.latestSeries || {});
  if (keys.length === 0) {
    return "KPI anomaly source: mock Norfleet monitor data. Run KPI Monitor on a fleet to align live series with this view.";
  }
  return `KPI Monitor live series: ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? "…" : ""}. Anomaly cards below include mock + monitor-style labels.`;
}

function formatActionStatusLabel(st) {
  if (st === "sent") return "Sent";
  if (st === "applied") return "Applied";
  return "";
}

function renderTechnicianReport() {
  const root = byId("technician-report-root");
  if (!root) return;
  const sum = computeTechnicianReportSummary();
  const takeaways = buildOverviewTakeawaysFromConfig();

  const summaryHtml = `
    <div class="tr-summary-grid">
      <div class="tr-summary-stat"><div class="val">${sum.totalAnomalies}</div><div class="lbl">Total anomalies detected</div></div>
      <div class="tr-summary-stat"><div class="val">${sum.recommendedActions}</div><div class="lbl">Recommended actions</div></div>
      <div class="tr-summary-stat"><div class="val">${sum.selfFixEligible}</div><div class="lbl">Self-fix eligible</div></div>
      <div class="tr-summary-stat"><div class="val">${sum.techApproval}</div><div class="lbl">Technician approval required</div></div>
      <div class="tr-summary-stat"><div class="val">~${sum.downtimeAvoided}h</div><div class="lbl">Est. downtime avoided</div></div>
    </div>`;

  const anomalyCards = MOCK_KPI_ANOMALIES.map(
    (a) => `
    <div class="tr-anomaly-card">
      <div class="kpi-name">${escapeHtml(a.kpi)}</div>
      <div class="tr-anomaly-row"><span class="lbl">Anomaly detected</span>${escapeHtml(a.anomaly)}</div>
      <div class="tr-anomaly-row"><span class="lbl">Affected robot / zone</span>${escapeHtml(a.target)}</div>
      <div class="tr-anomaly-row"><span class="lbl">Severity</span><span class="severity-badge ${trSeverityClass(a.severity)}">${escapeHtml(a.severity)}</span></div>
      <div class="tr-anomaly-row"><span class="lbl">Likely cause</span>${escapeHtml(a.cause)}</div>
      <div class="tr-anomaly-row"><span class="lbl">Recommended action</span>${escapeHtml(a.action)}</div>
    </div>`
  ).join("");

  const recRows = TECHNICIAN_REPORT_ACTIONS.map((rec) => {
    const st = getTechnicianActionStatus(rec.id);
    const done = st !== "pending";
    const reviewed = state.technicianReport.reviewed[rec.id];
    const statusHtml = done
      ? `<span class="tr-status-pill">${escapeHtml(formatActionStatusLabel(st))}</span>`
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
          ${statusHtml}
        </div>
      </div>
      <div class="tr-rec-actions">
        <button type="button" class="tr-action-btn" data-tr-action="${escapeHtml(rec.id)}" ${primaryDisabled}>
          ${escapeHtml(rec.buttonLabel)}
        </button>
      </div>
    </div>`;
  }).join("");

  const selfFix = TECHNICIAN_REPORT_ACTIONS.filter((r) => r.selfFix);
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

  const narrative = takeaways
    .map(
      (t) => `
      <li>
        ${escapeHtml(t.text)}
        <div class="takeaway-priority">${escapeHtml(t.priority)}</div>
      </li>`
    )
    .join("");

  root.innerHTML = `
    <div class="tr-hero">
      <h2>Technician Report</h2>
      <p class="muted">AI-generated maintenance actions from KPI anomalies, agent signals, and technician feedback. This is the action layer: repair recommendations, workflow changes, and self-improving maintenance.</p>
      <p class="muted" style="margin-top:8px;margin-bottom:0;font-size:11px">${escapeHtml(getKpiMonitorBridgeNote())}</p>
    </div>

    <section class="tr-section" aria-labelledby="tr-summary-h">
      <div class="panel-header" style="margin-bottom:10px">
        <div class="tr-section-title" id="tr-summary-h">Report summary</div>
        <span class="panel-badge badge-cyan">Live</span>
      </div>
      ${summaryHtml}
    </section>

    <section class="tr-section" aria-labelledby="tr-kpi-h">
      <div class="panel-header" style="margin-bottom:10px">
        <div class="tr-section-title" id="tr-kpi-h">KPI anomaly insights</div>
        <span class="panel-badge badge-purple">KPI Monitor</span>
      </div>
      <div class="tr-kpi-anomaly-grid">${anomalyCards}</div>
    </section>

    <section class="tr-section" aria-labelledby="tr-rec-h">
      <div class="panel-header" style="margin-bottom:10px">
        <div class="tr-section-title" id="tr-rec-h">Action recommendations / to-do</div>
        <span class="panel-badge badge-cyan">Queue</span>
      </div>
      <p class="muted" style="margin-bottom:12px">Select rows to mark reviewed. Use Implement / Send to Technician / Apply to Agent Builder to close the loop.</p>
      <div class="tr-rec-list">${recRows}</div>
    </section>

    <section class="tr-section" aria-labelledby="tr-sf-h">
      <div class="panel-header" style="margin-bottom:10px">
        <div class="tr-section-title" id="tr-sf-h">Self-fix / agent update suggestions</div>
        <span class="panel-badge badge-purple">Agent workflow update</span>
      </div>
      <p class="muted" style="margin-bottom:12px">Apply changes directly into the shared Agentic AI Builder state and Overview workflow.</p>
      <div class="tr-selffix-grid">${selfFixCards}</div>
    </section>

    <section class="tr-section" aria-labelledby="tr-nar-h">
      <div class="panel-header" style="margin-bottom:10px">
        <div class="tr-section-title" id="tr-nar-h">Narrative priorities</div>
        <span class="panel-badge badge-cyan">Agents</span>
      </div>
      <p class="muted" style="margin-bottom:10px">Synced with current agent configuration (same source as former Overview takeaway).</p>
      <ol class="tr-narrative-list">${narrative}</ol>
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

  root.querySelectorAll("[data-tr-action]").forEach((btn) => {
    btn.onclick = () => applyTechnicianAction(btn.dataset.trAction);
  });
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
      <div class="builder-checkbox-grid">${MOCK_ROBOT_REGISTRY.map((r) => {
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

async function api(url, options) {
  const res = await fetch(url, options);
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
  kpis.forEach((kpi) => {
    const tag = document.createElement("button");
    tag.type = "button";
    tag.className = `kpi-tag ${state.enabledKpis.has(kpi) ? "active" : "disabled"}`;
    tag.textContent = kpi;
    tag.onclick = () => toggleKpi(kpi);
    kpiList.appendChild(tag);
  });
}

function upsertChart(kpi, values) {
  const chartsWrap = byId("charts");
  if (!chartsWrap || !window.Chart) return;
  if (!state.charts[kpi]) {
    const card = document.createElement("div");
    card.className = "chart-card";
    const safeId = kpi.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
    card.innerHTML = `<div class="chart-title">${kpi}</div><canvas id="chart-${safeId}" height="190"></canvas>`;
    chartsWrap.appendChild(card);
    const canvas = card.querySelector("canvas");
    state.charts[kpi] = new Chart(canvas, {
      type: "line",
      data: {
        labels: values.map((_, idx) => idx + 1),
        datasets: [
          {
            label: kpi,
            data: values,
            borderColor: "#00e5ff",
            backgroundColor: "rgba(0,229,255,0.08)",
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { display: true, ticks: { color: "#64748b", maxTicksLimit: 8 }, grid: { color: "rgba(255,255,255,0.05)" } },
          y: { display: true, ticks: { color: "#64748b" }, grid: { color: "rgba(255,255,255,0.05)" } }
        }
      }
    });
  } else {
    const chart = state.charts[kpi];
    chart.data.labels = values.map((_, idx) => idx + 1);
    chart.data.datasets[0].data = values;
    chart.update();
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
    ? Array.from(byId("kpi-list").querySelectorAll(".kpi-tag")).map((el) => el.textContent)
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
  renderKpis(metrics.kpis);
  syncCharts(metrics.series);

  const selected = state.fleets.find((f) => f.id === state.selectedFleetId);
  if (selected?.summary) updateSummary(selected.summary);

  if (state.stream) state.stream.close();
  state.stream = new EventSource(`/api/stream?fleetId=${encodeURIComponent(state.selectedFleetId)}`);
  state.stream.onmessage = (event) => {
    const data = JSON.parse(event.data);
    renderKpis(data.kpis);
    syncCharts(data.series);
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
}

window.switchView = switchView;
window.switchAgentSubView = switchAgentSubView;
window.selectAgent = selectAgent;
window.updateAgentConfig = updateAgentConfig;
window.toggleWorkflowExpand = toggleWorkflowExpand;
window.applyTechnicianAction = applyTechnicianAction;
window.createAgentFromRecommendation = createAgentFromRecommendation;
window.updateAgentFromRecommendation = updateAgentFromRecommendation;
window.setTechnicianReviewed = setTechnicianReviewed;

setInterval(updateClock, 1000);
updateClock();
bindEvents();
loadInitial()
  .then(() => {
    if (state.selectedFleetId) {
      return loadMetricsAndStream().catch(() => {});
    }
  })
  .catch((err) => showToast("⚠", `Load failed: ${err.message}`));
