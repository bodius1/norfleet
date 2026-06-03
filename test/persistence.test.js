const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createJsonRepository } = require("../store/persistence");

function createIsolatedJsonRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "norfleet-persist-"));
  const jsonPath = path.join(dir, "norfleet.json");
  const repo = createJsonRepository({ jsonPath });
  return { repo, dir, jsonPath };
}

describe("persistence repository", () => {
  let isolated = null;

  beforeEach(() => {
    isolated = createIsolatedJsonRepo();
  });

  afterEach(() => {
    if (isolated?.dir && fs.existsSync(isolated.dir)) {
      fs.rmSync(isolated.dir, { recursive: true, force: true });
    }
    isolated = null;
  });

  it("round-trips robots and survives reload", () => {
    const { repo, jsonPath } = isolated;
    repo.addRobot({ id: "R-99", name: "Test", model: "Stretch", status: "active" });
    repo.addPrediction({ id: "P-1", robotId: "R-99", failureMode: "bearing_wear", status: "open" });
    repo.addFeedback({ id: "FB-1", outcome: "false-alarm", failureMode: "bearing_wear" });

    const repo2 = createJsonRepository({ jsonPath });
    assert.equal(repo2.getRobots().length, 1);
    assert.equal(repo2.getPredictions().length, 1);
    assert.equal(repo2.getFeedback().length, 1);
    assert.ok(fs.existsSync(jsonPath));
  });

  it("stores demo scenario for restart", () => {
    const { repo, jsonPath } = isolated;
    repo.setDemoScenario({ injected: [{ robotId: "R-002", mode: "bearing_wear", progress: 0.58 }] });
    const repo2 = createJsonRepository({ jsonPath });
    assert.equal(repo2.getDemoScenario().injected[0].robotId, "R-002");
  });
});
