/**
 * Runtime facade over persistence repository — single source of truth.
 */
let repo = null;

function init(repository) {
  repo = repository;
}

function requireRepo() {
  if (!repo) throw new Error("runtimeStore not initialized");
  return repo;
}

function getRobots() {
  return requireRepo().getRobots();
}

function addRobot(robot) {
  return requireRepo().addRobot(robot);
}

function updateRobotStatuses(mutator) {
  const robots = getRobots();
  robots.forEach(mutator);
  requireRepo().setRobots(robots);
}

function getFleets() {
  return requireRepo().getFleets();
}

function findFleet(fleetId) {
  return getFleets().find((f) => f.id === fleetId) || null;
}

function addFleet(fleet) {
  return requireRepo().addFleet(fleet);
}

function setFleetKpis(fleetId, kpis) {
  const fleets = getFleets();
  const fleet = fleets.find((f) => f.id === fleetId);
  if (fleet) {
    fleet.kpis = kpis;
    requireRepo().setFleets(fleets);
  }
}

function getFleetHistory(fleetId) {
  const h = requireRepo().getFleetHistory();
  return fleetId ? h[fleetId] || null : h;
}

function getFleetHistoryRef() {
  return requireRepo().getFleetHistory();
}

function ensureHistory(fleetId, kpis, baselineForKpi) {
  const history = requireRepo().getFleetHistory();
  if (!history[fleetId]) history[fleetId] = {};
  kpis.forEach((kpi) => {
    if (!history[fleetId][kpi]) {
      history[fleetId][kpi] = Array.from({ length: 20 }, () => baselineForKpi(kpi));
    }
  });
  requireRepo().setFleetHistory(history);
}

function appendKpiSample(fleetId, kpi, value, maxLen = 30) {
  const history = requireRepo().getFleetHistory();
  if (!history[fleetId]?.[kpi]) return;
  const arr = history[fleetId][kpi];
  arr.push(value);
  if (arr.length > maxLen) arr.shift();
  requireRepo().setFleetHistory(history);
}

function getTechnicianTickets() {
  return requireRepo().getTechnicianTickets();
}

function getTechnicianFeedbackHistory() {
  return requireRepo().getFeedback();
}

function getAiSessionCalls() {
  return requireRepo().getAiSessionCalls();
}

function pushAiSessionCall(entry) {
  requireRepo().pushAiSessionCall(entry);
}

function getActiveAgentsRuntime() {
  return requireRepo().getAgentRuntime();
}

function setActiveAgentsRuntime(definitions) {
  requireRepo().setAgentRuntime(definitions);
}

function nextRobotId() {
  let max = 0;
  for (const r of getRobots()) {
    const m = /^R-(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `R-${String(max + 1).padStart(3, "0")}`;
}

function nextFleetId() {
  let max = 0;
  for (const f of getFleets()) {
    const m = /^F-(\d+)$/.exec(f.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `F-${String(max + 1).padStart(3, "0")}`;
}

module.exports = {
  init,
  getRobots,
  addRobot,
  updateRobotStatuses,
  getFleets,
  findFleet,
  addFleet,
  setFleetKpis,
  getFleetHistory,
  getFleetHistoryRef,
  ensureHistory,
  appendKpiSample,
  getTechnicianTickets,
  getTechnicianFeedbackHistory,
  getAiSessionCalls,
  pushAiSessionCall,
  getActiveAgentsRuntime,
  setActiveAgentsRuntime,
  nextRobotId,
  nextFleetId
};
