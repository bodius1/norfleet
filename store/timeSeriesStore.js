/**
 * Time-series store: SQLite telemetry table + bounded in-memory hot buffer for live charts.
 */
const HOT_BUFFER_MAX = 500;

function createTimeSeriesStore(repository) {
  const hotBuffer = new Map();

  function bufferKey(robotId, signal) {
    return `${robotId}:${signal}`;
  }

  function write(reading) {
    const { robotId, ts, signals } = reading;
    Object.entries(signals || {}).forEach(([signal, value]) => {
      if (repository.writeTelemetry) {
        repository.writeTelemetry(robotId, signal, ts, Number(value));
      }
      const key = bufferKey(robotId, signal);
      if (!hotBuffer.has(key)) hotBuffer.set(key, []);
      const buf = hotBuffer.get(key);
      buf.push({ ts, value: Number(value) });
      if (buf.length > HOT_BUFFER_MAX) buf.shift();
    });
  }

  function query(robotId, signal, fromTs, toTs) {
    if (repository.queryTelemetry) {
      return repository.queryTelemetry(robotId, signal, fromTs, toTs);
    }
    const key = bufferKey(robotId, signal);
    const buf = hotBuffer.get(key) || [];
    return buf.filter((p) => p.ts >= fromTs && p.ts <= toTs);
  }

  function window(robotId, signals, lookbackMs, nowTs = Date.now()) {
    const fromTs = nowTs - lookbackMs;
    const out = {};
    signals.forEach((signal) => {
      out[signal] = query(robotId, signal, fromTs, nowTs);
    });
    return out;
  }

  function getHotSeries(robotId, signal) {
    return hotBuffer.get(bufferKey(robotId, signal)) || [];
  }

  return { write, query, window, getHotSeries, hotBuffer };
}

module.exports = { createTimeSeriesStore, HOT_BUFFER_MAX };
