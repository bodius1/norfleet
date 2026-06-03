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
      const key = bufferKey(robotId, signal);
      if (!hotBuffer.has(key)) hotBuffer.set(key, []);
      const buf = hotBuffer.get(key);
      if (buf.length && buf[buf.length - 1].ts === ts) return;
      if (repository.writeTelemetry) repository.writeTelemetry(robotId, signal, ts, Number(value));
      buf.push({ ts, value: Number(value) });
      if (buf.length > HOT_BUFFER_MAX) buf.shift();
    });
  }

  function query(robotId, signal, fromTs, toTs) {
    const key = bufferKey(robotId, signal);
    const fromBuf = (hotBuffer.get(key) || []).filter((p) => p.ts >= fromTs && p.ts <= toTs);
    let fromRepo = [];
    if (repository.queryTelemetry) {
      fromRepo = repository.queryTelemetry(robotId, signal, fromTs, toTs);
    }
    const merged = new Map();
    fromRepo.forEach((p) => merged.set(p.ts, p));
    fromBuf.forEach((p) => merged.set(p.ts, p));
    return Array.from(merged.values()).sort((a, b) => a.ts - b.ts);
  }

  /** Window anchored to latest sim/wall time; hot buffer first, repository fallback. */
  function window(robotId, signals, lookbackMs, nowTs) {
    const out = {};
    signals.forEach((signal) => {
      const key = bufferKey(robotId, signal);
      const buf = hotBuffer.get(key) || [];
      let anchorTs = nowTs;
      if (buf.length) {
        anchorTs = anchorTs != null ? Math.max(anchorTs, buf[buf.length - 1].ts) : buf[buf.length - 1].ts;
      }
      let series = [];
      if (buf.length && anchorTs != null) {
        const fromTs = anchorTs - lookbackMs;
        series = buf.filter((p) => p.ts >= fromTs && p.ts <= anchorTs);
      }
      if (!series.length && repository.queryTelemetry && anchorTs != null) {
        series = repository.queryTelemetry(robotId, signal, anchorTs - lookbackMs, anchorTs);
      }
      out[signal] = series;
    });
    return out;
  }

  function getHotSeries(robotId, signal) {
    return hotBuffer.get(bufferKey(robotId, signal)) || [];
  }

  function clear() {
    hotBuffer.clear();
  }

  function countBySignal(robotId, signals) {
    const counts = {};
    (signals || []).forEach((signal) => {
      counts[signal] = getHotSeries(robotId, signal).length;
    });
    return counts;
  }

  return { write, query, window, getHotSeries, countBySignal, clear, hotBuffer };
}

module.exports = { createTimeSeriesStore, HOT_BUFFER_MAX };
