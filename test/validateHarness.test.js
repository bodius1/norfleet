const { describe, it } = require("node:test");
const assert = require("node:assert");
const { runValidation, TEST_DEFAULTS } = require("../scripts/validate");
const { DEFAULT_CALIBRATION, applyOutcome } = require("../predictor/calibration");

describe("validate harness thresholds (DONE #4)", () => {
  it("meets recall, false-alarm, and median lead time targets", async () => {
    const r = await runValidation({ ...TEST_DEFAULTS });
    assert.equal(r.tp + r.fn, r.failureRuns, "failure runs must equal TP + FN");
    assert.equal(r.fp + r.tn, r.healthyRuns, "healthy runs must equal FP + TN");
    assert.ok(r.recall >= 0.8, `recall ${r.recall}`);
    assert.ok(r.falseAlarmRate <= 0.2, `falseAlarmRate ${r.falseAlarmRate}`);
    assert.ok(r.medianLeadHours >= 8, `medianLeadHours ${r.medianLeadHours}`);
  });

  it("false-alarm rate drops after feedback calibration", async () => {
    const before = await runValidation({ ...TEST_DEFAULTS });
    let cal = DEFAULT_CALIBRATION;
    for (let i = 0; i < 6; i += 1) cal = applyOutcome(cal, "bearing_wear", "false-alarm");
    const after = await runValidation({ ...TEST_DEFAULTS, calibration: cal });
    assert.ok(after.falseAlarmRate <= before.falseAlarmRate);
  });
});
