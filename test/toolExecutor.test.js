const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntimeTools, validateToolInput } = require("../toolExecutor");

test("validateToolInput enforces fleet and robot ids", () => {
  assert.equal(validateToolInput("getFleetSummary", { fleetId: "F-001" }), true);
  assert.equal(validateToolInput("getFleetSummary", {}), false);
  assert.equal(validateToolInput("getRobotLogs", { robotId: "R-001" }), true);
});

test("retrieveMaintenanceKnowledge routes through ragMemory", () => {
  const robots = [];
  const fleets = [{ id: "F-001", name: "Test", robotIds: [], kpis: ["Uptime"] }];
  const tools = createRuntimeTools({
    robots,
    fleets,
    fleetHistory: {},
    ticketStore: [],
    feedbackStore: []
  });
  const results = tools.retrieveMaintenanceKnowledge("charging dock");
  assert.ok(Array.isArray(results));
});
