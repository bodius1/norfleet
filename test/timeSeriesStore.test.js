const { describe, it } = require("node:test");
const assert = require("node:assert");
const { createJsonRepository } = require("../store/persistence");
const { createTimeSeriesStore } = require("../store/timeSeriesStore");

describe("timeSeriesStore", () => {
  it("write/query/window", () => {
    const repo = createJsonRepository();
    repo.clearAll();
    const ts = createTimeSeriesStore(repo);
    const base = Date.now() - 3600000;
    for (let i = 0; i < 10; i += 1) {
      ts.write({ robotId: "R-1", ts: base + i * 60000, signals: { vibrationRms: 0.4 + i * 0.05 } });
    }
    const q = ts.query("R-1", "vibrationRms", base, base + 3600000);
    assert.equal(q.length, 10);
    const w = ts.window("R-1", ["vibrationRms"], 3600000, base + 600000);
    assert.ok(w.vibrationRms.length >= 1);
    ts.clear();
    const wRepo = ts.window("R-1", ["vibrationRms"], 3600000, base + 600000);
    assert.ok(wRepo.vibrationRms.length >= 1, "window should fall back to repository");
    repo.clearAll();
  });
});
