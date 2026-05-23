const { describe, it } = require("node:test");
const assert = require("node:assert");
const { runBacktest } = require("../scripts/validate");
const { DEFAULT_CALIBRATION, applyOutcome } = require("../predictor/calibration");

describe("validate harness thresholds (DONE #4)", () => {
  it("meets recall, false-alarm, and median lead time targets", () => {
    const r = runBacktest(DEFAULT_CALIBRATION);
    assert.ok(r.recall >= 0.8, `recall ${r.recall}`);
    assert.ok(r.falseAlarmRate <= 0.2, `falseAlarmRate ${r.falseAlarmRate}`);
    assert.ok(r.medianLeadHours >= 8, `medianLeadHours ${r.medianLeadHours}`);
  });

  it("false-alarm rate drops after feedback calibration", () => {
    const before = runBacktest(DEFAULT_CALIBRATION);
    let cal = DEFAULT_CALIBRATION;
    for (let i = 0; i < 6; i += 1) cal = applyOutcome(cal, "bearing_wear", "false-alarm");
    const after = runBacktest(cal);
    assert.ok(after.falseAlarmRate <= before.falseAlarmRate);
  });
});
