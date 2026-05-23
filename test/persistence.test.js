const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { createJsonRepository, JSON_PATH } = require("../store/persistence");

describe("persistence repository", () => {
  it("round-trips robots and survives reload", () => {
    const repo = createJsonRepository();
    repo.clearAll();
    repo.addRobot({ id: "R-99", name: "Test", model: "Stretch", status: "active" });
    repo.addPrediction({ id: "P-1", robotId: "R-99", failureMode: "bearing_wear", status: "open" });
    repo.addFeedback({ id: "FB-1", outcome: "false-alarm", failureMode: "bearing_wear" });

    const repo2 = createJsonRepository();
    assert.equal(repo2.getRobots().length, 1);
    assert.equal(repo2.getPredictions().length, 1);
    assert.equal(repo2.getFeedback().length, 1);
    assert.ok(fs.existsSync(JSON_PATH));
    repo.clearAll();
  });

  it("stores demo scenario for restart", () => {
    const repo = createJsonRepository();
    repo.clearAll();
    repo.setDemoScenario({ injected: [{ robotId: "R-002", mode: "bearing_wear", progress: 0.58 }] });
    const repo2 = createJsonRepository();
    assert.equal(repo2.getDemoScenario().injected[0].robotId, "R-002");
    repo.clearAll();
  });
});
