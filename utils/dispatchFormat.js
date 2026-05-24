function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isFinitePositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeText(value, fallback = "Not available") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number" && !Number.isFinite(value)) return fallback;
  if (typeof value === "object") return fallback;
  const s = String(value).trim();
  if (!s || s === "undefined" || s === "null" || s === "NaN" || s === "[object Object]") return fallback;
  return s;
}

function formatTimeToFailureWithin(value) {
  if (!isFinitePositiveNumber(value)) return null;
  const hours = Number(value);
  if (hours < 0.1) return "within ~1 minute";
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `within ~${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `within ${hours.toFixed(1)} hours`;
}

function formatHours(value) {
  if (!isFinitePositiveNumber(value)) return "Not available";
  const hours = Number(value);
  if (hours < 0.1) return "imminent";
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `~${minutes} min`;
  }
  return `~${hours.toFixed(1)}h`;
}

function formatPercent(value) {
  const n = safeNumber(value, null);
  if (n === null) return "Not available";
  const pct = n <= 1 ? n * 100 : n;
  return `${Math.round(pct)}%`;
}

function formatSignalName(name) {
  const labels = {
    vibrationRms: "Vibration RMS",
    motorCurrentA: "Motor current",
    bearingTempC: "Bearing temperature",
    batteryCapacityPct: "Battery capacity",
    batteryVoltage: "Battery voltage",
    cycleTimeMs: "Cycle time",
    trafficDelayMs: "Traffic delay",
    pickAccuracyPct: "Pick accuracy",
    pickActuatorDriftMm: "Pick actuator drift",
    pickErrorRate: "Pick error rate"
  };
  return labels[name] || safeText(name, "Signal").replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function sanitizeForJson(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(sanitizeForJson).filter((v) => v !== undefined);
  if (typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      const clean = sanitizeForJson(v);
      if (clean !== undefined) out[k] = clean;
    });
    return out;
  }
  return undefined;
}

function failureModeLabel(mode) {
  return safeText(mode, "unknown").replace(/_/g, " ");
}

module.exports = {
  isFiniteNumber,
  isFinitePositiveNumber,
  safeNumber,
  safeText,
  formatHours,
  formatTimeToFailureWithin,
  formatPercent,
  formatSignalName,
  sanitizeForJson,
  failureModeLabel
};
