/**
 * Canonical API ↔ UI shapes for agents and predictions.
 * Loaded in Node (require) and browser (<script>) — keep field names in sync.
 */
(function (root) {
  const AGENT_ID_ALIASES = {
    "root-cause-agent": "root-cause",
    "feedback-loop-agent": "feedback-loop"
  };

  const DEFAULT_WORKFLOW_ORDER = [
    "pre-shift-monitor",
    "root-cause",
    "maintenance-planner",
    "technician-dispatch",
    "feedback-loop"
  ];

  const AGENT_TASK_DEFAULTS = {
    "pre-shift-monitor": "Scanning overnight robot health",
    "root-cause": "Analyzing repeated failures",
    "maintenance-planner": "Generating repair checklist",
    "technician-dispatch": "Waiting for technician assignment",
    "feedback-loop": "Learning from completed fixes"
  };

  const AGENT_FAILURE_DEFAULTS = {
    "pre-shift-monitor": "None (2 advisory warnings)",
    "root-cause": "3 correlated fault signatures",
    "maintenance-planner": "0 blocking",
    "technician-dispatch": "—",
    "feedback-loop": "1 open verification"
  };

  function canonicalAgentId(id) {
    return AGENT_ID_ALIASES[id] || id;
  }

  /** @returns {object} Agent row for API + UI cards */
  function normalizeAgent(agent) {
    if (!agent || typeof agent !== "object") return null;
    const id = canonicalAgentId(agent.id);
    return {
      id,
      name: agent.name || id,
      role: agent.role || "Fleet maintenance agent",
      assignedTask:
        agent.assignedTask ||
        AGENT_TASK_DEFAULTS[id] ||
        agent.triggerCondition ||
        "Monitoring fleet telemetry",
      encounteredFailures:
        agent.encounteredFailures ?? agent.failures ?? AGENT_FAILURE_DEFAULTS[id] ?? "None reported",
      failures: agent.failures ?? agent.encounteredFailures ?? AGENT_FAILURE_DEFAULTS[id] ?? "None reported",
      triggerCondition: agent.triggerCondition || "",
      status: agent.status || "active",
      persona: agent.persona,
      permissions: agent.permissions,
      toolsAllowed: agent.toolsAllowed,
      memory: agent.memory,
      lastRun: agent.lastRun,
      tokenCostEstimate: agent.tokenCostEstimate,
      tasksCompleted: agent.tasksCompleted,
      confidenceThreshold: agent.confidenceThreshold,
      icon: agent.icon,
      stage: agent.stage,
      priorityLevel: agent.priorityLevel,
      escalationRule: agent.escalationRule,
      robots: agent.robots,
      params: agent.params
    };
  }

  function normalizeAgentList(agents) {
    const seen = new Set();
    const out = [];
    (agents || []).forEach((raw) => {
      const a = normalizeAgent(raw);
      if (!a || seen.has(a.id)) return;
      seen.add(a.id);
      out.push(a);
    });
    return out;
  }

  function workflowOrderFromAgents(agents) {
    const ids = normalizeAgentList(agents).map((a) => a.id);
    const ordered = DEFAULT_WORKFLOW_ORDER.filter((id) => ids.includes(id));
    ids.forEach((id) => {
      if (!ordered.includes(id)) ordered.push(id);
    });
    return ordered.length ? ordered : [...DEFAULT_WORKFLOW_ORDER];
  }

  /** @returns {object} Prediction row for API + Fleet Health UI */
  function normalizePrediction(pred, robotName) {
    if (!pred || typeof pred !== "object") return null;
    const insufficient = Boolean(pred.insufficientData);
    return {
      id: pred.id,
      robotId: pred.robotId,
      robotName: pred.robotName || robotName || pred.robotId,
      ts: pred.ts,
      failureMode: pred.failureMode || "unknown",
      failureProbability: Number.isFinite(pred.failureProbability) ? pred.failureProbability : 0.05,
      estimatedTimeToFailureHours:
        pred.estimatedTimeToFailureHours !== undefined && pred.estimatedTimeToFailureHours !== null
          ? pred.estimatedTimeToFailureHours
          : null,
      confidence: Number.isFinite(pred.confidence) ? pred.confidence : 0.2,
      healthIndex: Number.isFinite(pred.healthIndex) ? Math.max(0, Math.min(1, pred.healthIndex)) : 1,
      contributingSignals: Array.isArray(pred.contributingSignals) ? pred.contributingSignals : [],
      alert: Boolean(pred.alert),
      slope: pred.slope,
      insufficientData: insufficient,
      reason: pred.reason || null,
      status: pred.status
    };
  }

  const api = {
    AGENT_ID_ALIASES,
    DEFAULT_WORKFLOW_ORDER,
    canonicalAgentId,
    normalizeAgent,
    normalizeAgentList,
    workflowOrderFromAgents,
    normalizePrediction
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.RuntimeShapes = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
