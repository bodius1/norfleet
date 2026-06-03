/**
 * Tool registry, input validation, and execution for Norfleet runtime actions.
 * External tools/skills require review before use because tool permissions can expose secrets or modify state.
 */
const ragMemory = require("./ragMemory");
const { normalizeAgentList } = require("./contracts/runtimeShapes");

function createAgentDefinitions() {
  return normalizeAgentList([
    {
      id: "pre-shift-monitor",
      name: "Pre-Shift Monitor",
      role: "Fleet telemetry and KPI guardrail monitor",
      assignedTask: "Scanning overnight robot health",
      failures: "None (2 advisory warnings)",
      persona: "Calm and methodical reliability analyst",
      heartbeatChecklist: [
        "Confirm active fleet.",
        "Read latest KPI summary.",
        "Check anomalies from last shift.",
        "Compare against trigger thresholds.",
        "Decide if report or update is needed.",
        "Log result to memory."
      ],
      triggerCondition: "Every 15 minutes or shift handoff",
      permissions: ["readLogs", "recommendRepair"],
      toolsAllowed: ["getFleetSummary", "getKpiHistory", "retrieveMaintenanceKnowledge"],
      memory: [],
      status: "active",
      lastRun: null,
      tokenCostEstimate: 0,
      tasksCompleted: 0,
      confidenceThreshold: 0.8
    },
    {
      id: "root-cause",
      name: "Root Cause Agent",
      role: "Hypothesis ranking from KPI spikes and logs",
      assignedTask: "Analyzing repeated failures",
      failures: "3 correlated fault signatures",
      persona: "Data-heavy forensic maintainer",
      heartbeatChecklist: [
        "Inspect anomaly payload.",
        "Check logs and maintenance history.",
        "Retrieve SOP/manual context.",
        "Rank root-cause hypotheses.",
        "Propose fixes + escalation."
      ],
      triggerCondition: "On medium/high anomalies",
      permissions: ["readLogs", "recommendRepair", "requestApproval"],
      toolsAllowed: ["getRobotLogs", "retrieveMaintenanceKnowledge"],
      memory: [],
      status: "active",
      lastRun: null,
      tokenCostEstimate: 0,
      tasksCompleted: 0,
      confidenceThreshold: 0.82
    },
    {
      id: "maintenance-planner",
      name: "Maintenance Planner",
      role: "Builds actionable checklist from agent findings",
      assignedTask: "Generating repair checklist",
      failures: "0 blocking",
      persona: "Execution-first planner",
      heartbeatChecklist: ["Ingest analysis", "Map to tickets", "Assess approval need", "Publish plan"],
      triggerCondition: "After root-cause output",
      permissions: ["createTicket", "recommendRepair"],
      toolsAllowed: ["createTechnicianTicket", "updateAgentWorkflow"],
      memory: [],
      status: "active",
      lastRun: null,
      tokenCostEstimate: 0,
      tasksCompleted: 0,
      confidenceThreshold: 0.78
    },
    {
      id: "technician-dispatch",
      name: "Technician Dispatch Agent",
      role: "Converts approved actions into execution tickets",
      assignedTask: "Waiting for technician assignment",
      failures: "—",
      persona: "SLA-focused dispatcher",
      heartbeatChecklist: ["Read approvals", "Send tickets", "Track closure", "Report blockers"],
      triggerCondition: "When actions are approved",
      permissions: ["createTicket", "updateHistory"],
      toolsAllowed: ["createTechnicianTicket", "saveTechnicianFeedback"],
      memory: [],
      status: "active",
      lastRun: null,
      tokenCostEstimate: 0,
      tasksCompleted: 0,
      confidenceThreshold: 0.75
    },
    {
      id: "feedback-loop",
      name: "Feedback Loop Agent",
      role: "Learns from before/after KPI outcomes",
      assignedTask: "Learning from completed fixes",
      failures: "1 open verification",
      persona: "Continuous-improvement analyst",
      heartbeatChecklist: ["Ingest feedback", "Compare KPI deltas", "Update memory", "Propose tuning"],
      triggerCondition: "On ticket completion",
      permissions: ["updateHistory", "requestApproval"],
      toolsAllowed: ["saveTechnicianFeedback", "getKpiHistory"],
      memory: [],
      status: "active",
      lastRun: null,
      tokenCostEstimate: 0,
      tasksCompleted: 0,
      confidenceThreshold: 0.77
    }
  ]);
}

function validateToolInput(toolName, input) {
  switch (toolName) {
    case "getFleetSummary":
    case "getKpiHistory":
      return typeof input?.fleetId === "string" && input.fleetId.length > 0;
    case "getRobotLogs":
      return typeof input?.robotId === "string" && input.robotId.length > 0;
    case "retrieveMaintenanceKnowledge":
      return typeof input?.query === "string";
    case "createTechnicianTicket":
      return input != null && typeof input === "object";
    case "updateAgentWorkflow":
      return input?.update != null;
    case "saveTechnicianFeedback":
    case "captureRepairOutcome":
      return input != null && typeof input === "object";
    default:
      return false;
  }
}

function createRuntimeTools({ robots, fleets, fleetHistory, ticketStore, feedbackStore }) {
  const registry = {
    getFleetSummary: {
      execute({ fleetId }) {
        const fleet = fleets.find((f) => f.id === fleetId) || null;
        if (!fleet) return null;
        const assigned = robots.filter((r) => fleet.robotIds.includes(r.id));
        return {
          fleetId: fleet.id,
          fleetName: fleet.name,
          totalRobots: assigned.length,
          robotIds: assigned.map((r) => r.id),
          kpis: fleet.kpis || []
        };
      }
    },
    getRobotLogs: {
      execute({ robotId }) {
        return [
          `${robotId}: lidar alignment warning detected near lane merge`,
          `${robotId}: speed limited due to congestion envelope`,
          `${robotId}: battery docking retry completed`
        ];
      }
    },
    getKpiHistory: {
      execute({ fleetId, kpiName }) {
        if (kpiName) return fleetHistory[fleetId]?.[kpiName] || [];
        return fleetHistory[fleetId] || {};
      }
    },
    createTechnicianTicket: {
      execute(action) {
        const ticket = {
          id: `T-${String(ticketStore.length + 1).padStart(4, "0")}`,
          createdAt: new Date().toISOString(),
          status: "open",
          ...action
        };
        ticketStore.push(ticket);
        return ticket;
      }
    },
    updateAgentWorkflow: {
      execute({ update, workflowState }) {
        return {
          ok: true,
          note: "Frontend remains source of truth for workflow blocks; update payload prepared.",
          update,
          snapshotVersion: workflowState?.version || 1
        };
      }
    },
    saveTechnicianFeedback: {
      execute(feedback) {
        feedbackStore.push({
          id: `FB-${String(feedbackStore.length + 1).padStart(4, "0")}`,
          createdAt: new Date().toISOString(),
          ...feedback
        });
        ragMemory.captureRepairOutcome({
          actionId: feedback.actionId,
          technicianFeedback: feedback.technicianFeedback,
          fixWorked: feedback.fixWorked,
          beforeAfter: feedback.beforeAfter
        });
        return { saved: true, totalFeedback: feedbackStore.length };
      }
    },
    captureRepairOutcome: {
      execute(outcome) {
        return ragMemory.captureRepairOutcome(outcome);
      }
    },
    retrieveMaintenanceKnowledge: {
      execute({ query, robotId = "", issueType = "", topK = 4 }) {
        return ragMemory.retrieveRelevantContext(query, robotId, issueType, topK);
      }
    },
  };

  function runTool(toolName, input) {
    if (!registry[toolName]) {
      throw new Error(`Unknown tool: ${toolName}`);
    }
    if (!validateToolInput(toolName, input)) {
      throw new Error(`Invalid input for tool: ${toolName}`);
    }
    return registry[toolName].execute(input);
  }

  return {
    getFleetSummary: (fleetId) => runTool("getFleetSummary", { fleetId }),
    getRobotLogs: (robotId) => runTool("getRobotLogs", { robotId }),
    getKpiHistory: (fleetId, kpiName) => runTool("getKpiHistory", { fleetId, kpiName }),
    createTechnicianTicket: (action) => runTool("createTechnicianTicket", action),
    updateAgentWorkflow: (update, workflowState) => runTool("updateAgentWorkflow", { update, workflowState }),
    saveTechnicianFeedback: (feedback) => runTool("saveTechnicianFeedback", feedback),
    retrieveMaintenanceKnowledge: (query) =>
      runTool("retrieveMaintenanceKnowledge", { query }),
    captureRepairOutcome: (outcome) => runTool("captureRepairOutcome", outcome)
  };
}

module.exports = {
  createRuntimeTools,
  createAgentDefinitions,
  validateToolInput
};
