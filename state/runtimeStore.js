/**
 * Mutable in-memory runtime state. All reads/writes go through this module.
 */

const robots = [];
const fleets = [];
const fleetHistory = {};
const technicianTickets = [];
const technicianFeedbackHistory = [];
const aiSessionCalls = [];
let activeAgentsRuntime = [];

function getRobots() {
  return robots;
}

function addRobot(robot) {
  robots.push(robot);
  return robot;
}

function updateRobotStatuses(mutator) {
  robots.forEach(mutator);
}

function getFleets() {
  return fleets;
}

function findFleet(fleetId) {
  return fleets.find((f) => f.id === fleetId) || null;
}

function addFleet(fleet) {
  fleets.push(fleet);
  return fleet;
}

function setFleetKpis(fleetId, kpis) {
  const fleet = findFleet(fleetId);
  if (fleet) fleet.kpis = kpis;
}

function getFleetHistory(fleetId) {
  return fleetHistory[fleetId] || null;
}

function getFleetHistoryRef() {
  return fleetHistory;
}

function ensureHistory(fleetId, kpis, baselineForKpi) {
  if (!fleetHistory[fleetId]) {
    fleetHistory[fleetId] = {};
  }
  kpis.forEach((kpi) => {
    if (!fleetHistory[fleetId][kpi]) {
      fleetHistory[fleetId][kpi] = Array.from({ length: 20 }, () => baselineForKpi(kpi));
    }
  });
}

function appendKpiSample(fleetId, kpi, value, maxLen = 30) {
  const arr = fleetHistory[fleetId][kpi];
  arr.push(value);
  if (arr.length > maxLen) arr.shift();
}

function getTechnicianTickets() {
  return technicianTickets;
}

function getTechnicianFeedbackHistory() {
  return technicianFeedbackHistory;
}

function getAiSessionCalls() {
  return aiSessionCalls;
}

function pushAiSessionCall(entry) {
  aiSessionCalls.push(entry);
}

function getActiveAgentsRuntime() {
  return activeAgentsRuntime;
}

function setActiveAgentsRuntime(definitions) {
  activeAgentsRuntime = definitions;
}

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

module.exports = {
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
