/**
 * Compact SOP references keyed by failure mode — never returns full SOP body text.
 */
const fs = require("fs");
const path = require("path");

const KNOWLEDGE_ROOT = path.join(__dirname, "..", "knowledge");

const SOP_MAPPINGS = {
  bearing_wear: [
    {
      title: "Wheel slippage and bearing stress inspection",
      sourceFile: "knowledge/robot_manuals/charging-dock-alignment.txt",
      section: "Wheel slippage and floor markings",
      relevance: "Inspect drive wheel play, slippage, and heat at the bearing housing after route stress.",
      confidence: 0.78
    },
    {
      title: "Route congestion drive inspection",
      sourceFile: "knowledge/maintenance_notes/field-playbook.txt",
      section: "Route congestion troubleshooting",
      relevance: "Check intersection dwell and wheel drag that accelerates bearing wear.",
      confidence: 0.62
    }
  ],
  battery_degradation: [
    {
      title: "Battery health trend diagnostics",
      sourceFile: "knowledge/maintenance_notes/field-playbook.txt",
      section: "Battery health troubleshooting",
      relevance: "Schedule charging-cycle diagnostics when capacity trend declines over multiple windows.",
      confidence: 0.85
    },
    {
      title: "Charging dock alignment and contacts",
      sourceFile: "knowledge/robot_manuals/charging-dock-alignment.txt",
      section: "Dock marker wear and contact validation",
      relevance: "Verify charging contacts, dock alignment, and approach angle for degraded charge behavior.",
      confidence: 0.82
    }
  ],
  motor_creep: [
    {
      title: "Wheel slippage and drivetrain drag",
      sourceFile: "knowledge/robot_manuals/charging-dock-alignment.txt",
      section: "Wheel slippage and floor markings",
      relevance: "Inspect wheel drag, debris, and resistance that raise motor current draw.",
      confidence: 0.74
    },
    {
      title: "Route congestion motor load check",
      sourceFile: "knowledge/maintenance_notes/field-playbook.txt",
      section: "Route congestion troubleshooting",
      relevance: "Review intersection dwell and repeated stop-start cycles that stress the drivetrain.",
      confidence: 0.65
    }
  ],
  pick_drift: [
    {
      title: "Pick accuracy and end-effector inspection",
      sourceFile: "knowledge/maintenance_notes/field-playbook.txt",
      section: "Pick accuracy troubleshooting",
      relevance: "Compare SKU profiles, jaw pressure, and camera blur when pick accuracy drops.",
      confidence: 0.88
    },
    {
      title: "Pick actuator calibration follow-up",
      sourceFile: "knowledge/maintenance_notes/field-playbook.txt",
      section: "Pick accuracy troubleshooting",
      relevance: "Raise inspection frequency when pick accuracy falls below 92% for three windows.",
      confidence: 0.8
    }
  ],
  lidar_obstruction: [
    {
      title: "Lidar lens cleanliness and debris removal",
      sourceFile: "knowledge/sops/lidar-obstruction.txt",
      section: "Lens cleanliness and packaging debris",
      relevance: "Verify front scanner lens cleanliness and remove packaging debris near the sensor.",
      confidence: 0.9
    },
    {
      title: "Obstacle envelope recalibration",
      sourceFile: "knowledge/sops/lidar-obstruction.txt",
      section: "Obstacle envelope recalibration",
      relevance: "Recalibrate obstacle envelope when false positives repeat at lane merge points.",
      confidence: 0.84
    }
  ]
};

function sourceFileExists(sourceFile) {
  try {
    return fs.existsSync(path.join(__dirname, "..", sourceFile));
  } catch {
    return false;
  }
}

function getSopRefsForFailureMode(failureMode, limit = 4) {
  const mode = failureMode || "bearing_wear";
  const refs = SOP_MAPPINGS[mode] || [];
  return refs.slice(0, limit).map((ref) => {
    const exists = sourceFileExists(ref.sourceFile);
    return {
      title: ref.title,
      sourceFile: ref.sourceFile,
      section: ref.section,
      relevance: ref.relevance,
      confidence: exists ? ref.confidence : Math.max(0.35, ref.confidence - 0.25)
    };
  });
}

function listSupportedFailureModes() {
  return Object.keys(SOP_MAPPINGS);
}

module.exports = {
  SOP_MAPPINGS,
  getSopRefsForFailureMode,
  listSupportedFailureModes,
  sourceFileExists
};
