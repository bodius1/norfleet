/**
 * Vendor-shaped telemetry adapter stub.
 * // TODO(integration): wire auth, polling/WebSocket, and schema map to your robot vendor.
 */
function normalize(raw) {
  return {
    robotId: raw.deviceId || raw.robotId,
    ts: raw.timestamp || raw.ts || Date.now(),
    signals: raw.metrics || raw.signals || {},
    model: raw.model
  };
}

function createVendorTelemetryAdapter(config) {
  return {
    name: "vendor",
    async connect() {
      // TODO(integration): authenticate against config.robotApiBaseUrl
      void config;
    },
    async disconnect() {
      // TODO(integration): close websocket / stop polling
    },
    subscribe(onReading) {
      // TODO(integration): stream vendor payloads -> normalize -> onReading
      void onReading;
      return () => {};
    },
    normalize
  };
}

module.exports = { createVendorTelemetryAdapter, normalize };
