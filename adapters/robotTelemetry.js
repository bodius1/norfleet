/**
 * Robot/KPI telemetry adapter boundary.
 *
 * Contract: fetchTelemetry(fleetId) => {
 *   fleetId: string,
 *   kpiHistory: Record<string, number[]>,
 *   robots: Array<object>,
 *   series: Record<string, number[]>
 * }
 *
 * // TODO(TBD): real provider not yet verified — replace mockTelemetryAdapter when vendor is chosen.
 */

function createMockTelemetryAdapter(runtimeStore) {
  return {
    fetchTelemetry(fleetId) {
      const fleet = runtimeStore.findFleet(fleetId);
      if (!fleet) {
        return { fleetId, kpiHistory: {}, robots: [], series: {} };
      }
      const robots = runtimeStore.getRobots().filter((r) => fleet.robotIds.includes(r.id));
      const series = runtimeStore.getFleetHistory(fleetId) || {};
      return {
        fleetId,
        kpiHistory: series,
        robots,
        series
      };
    }
  };
}

module.exports = {
  createMockTelemetryAdapter
};
