/**
 * Repository — SQLite (better-sqlite3) with JSON file fallback behind one interface.
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const JSON_PATH = path.join(DATA_DIR, "norfleet.json");
const SQLITE_PATH = path.join(DATA_DIR, "norfleet.sqlite");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function emptyState() {
  return {
    robots: [],
    fleets: [],
    fleetHistory: {},
    predictions: [],
    failureEvents: [],
    technicianReports: [],
    feedback: [],
    anomalies: [],
    agentRuntime: [],
    calibration: {},
    demoScenario: null,
    aiSessionCalls: [],
    technicianTickets: []
  };
}

function createJsonRepository() {
  ensureDataDir();
  let state = emptyState();
  if (fs.existsSync(JSON_PATH)) {
    try {
      state = { ...emptyState(), ...JSON.parse(fs.readFileSync(JSON_PATH, "utf8")) };
    } catch {
      state = emptyState();
    }
  }

  function save() {
    ensureDataDir();
    fs.writeFileSync(JSON_PATH, JSON.stringify(state, null, 2), "utf8");
  }

  function initSchema() {
    save();
  }

  return {
    backend: "json",
    initSchema,
    save,
    getRobots: () => [...state.robots],
    setRobots: (rows) => {
      state.robots = rows;
      save();
    },
    addRobot: (r) => {
      state.robots.push(r);
      save();
      return r;
    },
    getFleets: () => [...state.fleets],
    setFleets: (rows) => {
      state.fleets = rows;
      save();
    },
    addFleet: (f) => {
      state.fleets.push(f);
      save();
      return f;
    },
    getFleetHistory: () => state.fleetHistory,
    setFleetHistory: (h) => {
      state.fleetHistory = h;
      save();
    },
    getPredictions: () => [...state.predictions],
    addPrediction: (p) => {
      state.predictions.push(p);
      save();
      return p;
    },
    updatePrediction: (id, patch) => {
      const i = state.predictions.findIndex((x) => x.id === id);
      if (i >= 0) state.predictions[i] = { ...state.predictions[i], ...patch };
      save();
    },
    getFailureEvents: () => [...state.failureEvents],
    addFailureEvent: (e) => {
      state.failureEvents.push(e);
      save();
      return e;
    },
    getTechnicianReports: () => [...state.technicianReports],
    addTechnicianReport: (r) => {
      state.technicianReports.push(r);
      save();
      return r;
    },
    getFeedback: () => [...state.feedback],
    addFeedback: (f) => {
      state.feedback.push(f);
      save();
      return f;
    },
    getAnomalies: () => [...state.anomalies],
    addAnomaly: (a) => {
      state.anomalies.push(a);
      save();
      return a;
    },
    getAgentRuntime: () => state.agentRuntime,
    setAgentRuntime: (a) => {
      state.agentRuntime = a;
      save();
    },
    getCalibration: () => ({ ...state.calibration }),
    setCalibration: (c) => {
      state.calibration = c;
      save();
    },
    getDemoScenario: () => state.demoScenario,
    setDemoScenario: (s) => {
      state.demoScenario = s;
      save();
    },
    getAiSessionCalls: () => [...state.aiSessionCalls],
    pushAiSessionCall: (c) => {
      state.aiSessionCalls.push(c);
      save();
    },
    getTechnicianTickets: () => [...state.technicianTickets],
    addTechnicianTicket: (t) => {
      state.technicianTickets.push(t);
      save();
      return t;
    },
    clearAll: () => {
      state = emptyState();
      save();
    },
    writeTelemetry: () => {},
    queryTelemetry: () => [],
    queryTelemetryMulti: () => []
  };
}

function createSqliteRepository() {
  const Database = require("better-sqlite3");
  ensureDataDir();
  const db = new Database(SQLITE_PATH);
  db.pragma("journal_mode = WAL");

  function initSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS telemetry (
        robot_id TEXT NOT NULL, signal TEXT NOT NULL, ts INTEGER NOT NULL, value REAL NOT NULL,
        PRIMARY KEY (robot_id, signal, ts)
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_robot_ts ON telemetry(robot_id, ts);
    `);
  }

  function getJson(key, fallback) {
    const row = db.prepare("SELECT value FROM kv_store WHERE key = ?").get(key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return fallback;
    }
  }

  function setJson(key, val) {
    db.prepare("INSERT INTO kv_store(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(
      key,
      JSON.stringify(val)
    );
  }

  initSchema();

  return {
    backend: "sqlite",
    db,
    initSchema,
    save: () => {},
    getRobots: () => getJson("robots", []),
    setRobots: (rows) => setJson("robots", rows),
    addRobot: (r) => {
      const rows = getJson("robots", []);
      rows.push(r);
      setJson("robots", rows);
      return r;
    },
    getFleets: () => getJson("fleets", []),
    setFleets: (rows) => setJson("fleets", rows),
    addFleet: (f) => {
      const rows = getJson("fleets", []);
      rows.push(f);
      setJson("fleets", rows);
      return f;
    },
    getFleetHistory: () => getJson("fleetHistory", {}),
    setFleetHistory: (h) => setJson("fleetHistory", h),
    getPredictions: () => getJson("predictions", []),
    addPrediction: (p) => {
      const rows = getJson("predictions", []);
      rows.push(p);
      setJson("predictions", rows);
      return p;
    },
    updatePrediction: (id, patch) => {
      const rows = getJson("predictions", []);
      const i = rows.findIndex((x) => x.id === id);
      if (i >= 0) rows[i] = { ...rows[i], ...patch };
      setJson("predictions", rows);
    },
    getFailureEvents: () => getJson("failureEvents", []),
    addFailureEvent: (e) => {
      const rows = getJson("failureEvents", []);
      rows.push(e);
      setJson("failureEvents", rows);
      return e;
    },
    getTechnicianReports: () => getJson("technicianReports", []),
    addTechnicianReport: (r) => {
      const rows = getJson("technicianReports", []);
      rows.push(r);
      setJson("technicianReports", rows);
      return r;
    },
    getFeedback: () => getJson("feedback", []),
    addFeedback: (f) => {
      const rows = getJson("feedback", []);
      rows.push(f);
      setJson("feedback", rows);
      return f;
    },
    getAnomalies: () => getJson("anomalies", []),
    addAnomaly: (a) => {
      const rows = getJson("anomalies", []);
      rows.push(a);
      setJson("anomalies", rows);
    },
    getAgentRuntime: () => getJson("agentRuntime", []),
    setAgentRuntime: (a) => setJson("agentRuntime", a),
    getCalibration: () => getJson("calibration", {}),
    setCalibration: (c) => setJson("calibration", c),
    getDemoScenario: () => getJson("demoScenario", null),
    setDemoScenario: (s) => setJson("demoScenario", s),
    getAiSessionCalls: () => getJson("aiSessionCalls", []),
    pushAiSessionCall: (c) => {
      const rows = getJson("aiSessionCalls", []);
      rows.push(c);
      setJson("aiSessionCalls", rows);
    },
    getTechnicianTickets: () => getJson("technicianTickets", []),
    addTechnicianTicket: (t) => {
      const rows = getJson("technicianTickets", []);
      rows.push(t);
      setJson("technicianTickets", rows);
    },
    clearAll: () => {
      db.exec("DELETE FROM kv_store; DELETE FROM telemetry;");
    },
    writeTelemetry: (robotId, signal, ts, value) => {
      db.prepare("INSERT OR REPLACE INTO telemetry(robot_id,signal,ts,value) VALUES(?,?,?,?)").run(
        robotId,
        signal,
        ts,
        value
      );
    },
    queryTelemetry: (robotId, signal, fromTs, toTs) => {
      return db
        .prepare(
          "SELECT ts, value FROM telemetry WHERE robot_id=? AND signal=? AND ts>=? AND ts<=? ORDER BY ts ASC"
        )
        .all(robotId, signal, fromTs, toTs);
    },
    queryTelemetryMulti: (robotId, fromTs, toTs) => {
      return db
        .prepare("SELECT signal, ts, value FROM telemetry WHERE robot_id=? AND ts>=? AND ts<=? ORDER BY ts ASC")
        .all(robotId, fromTs, toTs);
    }
  };
}

function createRepository() {
  try {
    const repo = createSqliteRepository();
    return repo;
  } catch {
    return createJsonRepository();
  }
}

module.exports = {
  createRepository,
  createJsonRepository,
  createSqliteRepository,
  DATA_DIR,
  JSON_PATH,
  SQLITE_PATH
};
