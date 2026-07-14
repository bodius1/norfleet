"use strict";

// Defines the 4-robot fleet and degradation scenario used in demo mode.
// R-002 (Aisle Runner 12) exhibits progressive bearing_wear while the other three robots stay healthy.

const DEMO_ROBOTS = [
  { id: "R-001", name: "Induction Alpha",  model: "Stretch",      warehouseZone: "A", taskProfile: "Multi-SKU pick",   status: "active"   },
  { id: "R-002", name: "Aisle Runner 12",  model: "LocusBot",     warehouseZone: "B", taskProfile: "Transport relay",  status: "active"   },
  { id: "R-003", name: "Sort Cell 3",       model: "Chuck",        warehouseZone: "C", taskProfile: "Sortation",        status: "idle"     },
  { id: "R-004", name: "Outbound Cart",     model: "CartConnect",  warehouseZone: "D", taskProfile: "Cart-to-station",  status: "charging" }
];

// R-002 bearing_wear at 58% progress — enough to generate a prediction with measurable TTF
// but not yet an immediate failure, so the scenario has time to evolve visibly.
const DEMO_SCENARIO = {
  injected: [
    { robotId: "R-002", mode: "bearing_wear", progress: 0.58, leadTimeMs: 720000 }
  ]
};

module.exports = { DEMO_ROBOTS, DEMO_SCENARIO };
