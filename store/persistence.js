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
    technicianTickets: [],
    dispatchStates: {},
    dispatchFeedback: [],
    dispatchAudit: [],
    activeDispatches: {},
    workOrders: [],
    workOrderAudit: [],
    telemetry: [],
    predictionEvents: [],
    alertEvents: [],
    technicianFeedback: []
  };
}

function createJsonRepository(options = {}) {
  const jsonPath = options.jsonPath || JSON_PATH;
  const dataDir = path.dirname(jsonPath);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  let state = emptyState();
  if (fs.existsSync(jsonPath)) {
    try {
      state = { ...emptyState(), ...JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
      if (!Array.isArray(state.telemetry)) state.telemetry = [];
      if (!Array.isArray(state.predictionEvents)) state.predictionEvents = [];
      if (!Array.isArray(state.alertEvents)) state.alertEvents = [];
      if (!Array.isArray(state.technicianFeedback)) state.technicianFeedback = [];
    } catch {
      state = emptyState();
    }
  }

  function save() {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(state, null, 2), "utf8");
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
    getDispatchStates: () => ({ ...(state.dispatchStates || {}) }),
    setDispatchStates: (states) => {
      state.dispatchStates = states || {};
      save();
    },
    getDispatchFeedback: () => [...(state.dispatchFeedback || [])],
    addDispatchFeedback: (f) => {
      if (!state.dispatchFeedback) state.dispatchFeedback = [];
      state.dispatchFeedback.push(f);
      save();
      return f;
    },
    getDispatchAudit: () => [...(state.dispatchAudit || [])],
    addDispatchAudit: (a) => {
      if (!state.dispatchAudit) state.dispatchAudit = [];
      state.dispatchAudit.push(a);
      save();
      return a;
    },
    getActiveDispatches: () => ({ ...(state.activeDispatches || {}) }),
    setActiveDispatches: (rows) => {
      state.activeDispatches = rows || {};
      save();
    },
    getWorkOrders: () => [...(state.workOrders || [])],
    setWorkOrders: (rows) => {
      state.workOrders = rows || [];
      save();
    },
    addWorkOrder: (w) => {
      if (!state.workOrders) state.workOrders = [];
      state.workOrders.push(w);
      save();
      return w;
    },
    getWorkOrderAudit: () => [...(state.workOrderAudit || [])],
    addWorkOrderAudit: (a) => {
      if (!state.workOrderAudit) state.workOrderAudit = [];
      state.workOrderAudit.push(a);
      save();
      return a;
    },
    addPredictionEvent: (row) => {
      if (!state.predictionEvents) state.predictionEvents = [];
      state.predictionEvents.push(row);
      save();
      return row;
    },
    getPredictionEvents: (filter = {}) => {
      let rows = state.predictionEvents || [];
      if (filter.robotId !== undefined) rows = rows.filter((r) => r.robotId === filter.robotId);
      if (filter.alert !== undefined) rows = rows.filter((r) => Boolean(r.alert) === Boolean(filter.alert));
      if (filter.fromTs !== undefined) rows = rows.filter((r) => r.ts >= filter.fromTs);
      if (filter.toTs !== undefined) rows = rows.filter((r) => r.ts <= filter.toTs);
      if (filter.limit) rows = rows.slice(-filter.limit);
      return [...rows];
    },
    addAlertEvent: (row) => {
      if (!state.alertEvents) state.alertEvents = [];
      const id = row.id || (state.alertEvents.length + 1);
      const entry = { status: "open", ...row, id };
      state.alertEvents.push(entry);
      save();
      return entry;
    },
    getAlertEvents: (filter = {}) => {
      let rows = state.alertEvents || [];
      if (filter.kpi !== undefined) rows = rows.filter((r) => r.kpi === filter.kpi);
      if (filter.severity !== undefined) rows = rows.filter((r) => r.severity === filter.severity);
      if (filter.robotId !== undefined) rows = rows.filter((r) => r.robotId === filter.robotId);
      if (filter.failureMode !== undefined) rows = rows.filter((r) => r.failureMode === filter.failureMode);
      if (filter.status !== undefined) rows = rows.filter((r) => r.status === filter.status);
      if (filter.limit) rows = rows.slice(-filter.limit);
      return [...rows];
    },
    updateAlertEvent: (id, patch) => {
      if (!state.alertEvents) return;
      const i = state.alertEvents.findIndex((r) => r.id == id);
      if (i >= 0) state.alertEvents[i] = { ...state.alertEvents[i], ...patch };
      save();
    },
    addTechnicianFeedback: (row) => {
      if (!state.technicianFeedback) state.technicianFeedback = [];
      state.technicianFeedback.push(row);
      save();
      return row;
    },
    getTechnicianFeedback: (filter = {}) => {
      let rows = state.technicianFeedback || [];
      if (filter.dispatchId !== undefined) rows = rows.filter((r) => r.dispatchId === filter.dispatchId);
      if (filter.outcome !== undefined) rows = rows.filter((r) => r.outcome === filter.outcome);
      if (filter.limit) rows = rows.slice(-filter.limit);
      return [...rows];
    },
    clearPredictions: () => {
      state.predictions = [];
      save();
    },
    setPredictions: (rows) => {
      state.predictions = rows;
      save();
    },
    clearTelemetry: () => {
      state.telemetry = [];
      save();
    },
    writeTelemetry: (robotId, signal, ts, value) => {
      if (!state.telemetry) state.telemetry = [];
      const exists = state.telemetry.some(
        (row) => row.robotId === robotId && row.signal === signal && row.ts === ts
      );
      if (exists) return;
      state.telemetry.push({ robotId, signal, ts, value: Number(value) });
      save();
    },
    queryTelemetry: (robotId, signal, fromTs, toTs) => {
      return (state.telemetry || [])
        .filter(
          (row) =>
            row.robotId === robotId &&
            row.signal === signal &&
            row.ts >= fromTs &&
            row.ts <= toTs
        )
        .sort((a, b) => a.ts - b.ts)
        .map((row) => ({ ts: row.ts, value: row.value }));
    },
    queryTelemetryMulti: (robotId, fromTs, toTs) => {
      return (state.telemetry || [])
        .filter((row) => row.robotId === robotId && row.ts >= fromTs && row.ts <= toTs)
        .sort((a, b) => a.ts - b.ts)
        .map((row) => ({ signal: row.signal, ts: row.ts, value: row.value }));
    },
    clearAll: () => {
      state = emptyState();
      save();
    }
    // clearAll resets predictionEvents, alertEvents, technicianFeedback via emptyState()
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

      CREATE TABLE IF NOT EXISTS prediction_events (
        id TEXT PRIMARY KEY,
        robot_id TEXT NOT NULL,
        robot_name TEXT,
        ts INTEGER,
        failure_mode TEXT NOT NULL,
        failure_probability REAL NOT NULL,
        estimated_ttf_hours REAL,
        confidence REAL NOT NULL,
        health_index REAL NOT NULL,
        contributing_signals TEXT,
        alert INTEGER NOT NULL DEFAULT 0,
        slope REAL,
        health_drop REAL,
        insufficient_data INTEGER NOT NULL DEFAULT 0,
        mode_evidence INTEGER NOT NULL DEFAULT 0,
        reason TEXT,
        status TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_prediction_events_robot_ts ON prediction_events(robot_id, ts);
      CREATE INDEX IF NOT EXISTS idx_prediction_events_alert ON prediction_events(alert);

      CREATE TABLE IF NOT EXISTS alert_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kpi TEXT NOT NULL DEFAULT '',
        latest REAL NOT NULL DEFAULT 0,
        baseline REAL NOT NULL DEFAULT 0,
        delta_pct REAL NOT NULL DEFAULT 0,
        severity TEXT NOT NULL DEFAULT 'Low',
        created_at TEXT NOT NULL,
        robot_id TEXT,
        failure_mode TEXT,
        prediction_id TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        ttf_hours REAL,
        probability REAL,
        confidence REAL,
        acknowledged_by TEXT,
        acknowledged_at TEXT,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_alert_events_kpi ON alert_events(kpi);
      CREATE INDEX IF NOT EXISTS idx_alert_events_status ON alert_events(status);
      CREATE INDEX IF NOT EXISTS idx_alert_events_robot ON alert_events(robot_id, failure_mode);

      CREATE TABLE IF NOT EXISTS technician_feedback (
        id TEXT PRIMARY KEY,
        dispatch_id TEXT NOT NULL,
        robot_id TEXT,
        failure_mode TEXT,
        prediction_id TEXT,
        outcome TEXT NOT NULL,
        actual_cause TEXT,
        action_taken TEXT,
        fix_worked INTEGER NOT NULL DEFAULT 0,
        repair_minutes REAL,
        parts_used TEXT,
        notes TEXT,
        technician_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_technician_feedback_dispatch ON technician_feedback(dispatch_id);
      CREATE INDEX IF NOT EXISTS idx_technician_feedback_outcome ON technician_feedback(outcome);
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

  // Migrate existing alert_events tables that pre-date the prediction-alert columns.
  const alertMigrations = [
    "ALTER TABLE alert_events ADD COLUMN robot_id TEXT",
    "ALTER TABLE alert_events ADD COLUMN failure_mode TEXT",
    "ALTER TABLE alert_events ADD COLUMN prediction_id TEXT",
    "ALTER TABLE alert_events ADD COLUMN status TEXT NOT NULL DEFAULT 'open'",
    "ALTER TABLE alert_events ADD COLUMN ttf_hours REAL",
    "ALTER TABLE alert_events ADD COLUMN probability REAL",
    "ALTER TABLE alert_events ADD COLUMN confidence REAL",
    "ALTER TABLE alert_events ADD COLUMN acknowledged_by TEXT",
    "ALTER TABLE alert_events ADD COLUMN acknowledged_at TEXT",
    "ALTER TABLE alert_events ADD COLUMN resolved_at TEXT"
  ];
  for (const sql of alertMigrations) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }

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
    getDispatchStates: () => getJson("dispatchStates", {}),
    setDispatchStates: (states) => setJson("dispatchStates", states || {}),
    getDispatchFeedback: () => getJson("dispatchFeedback", []),
    addDispatchFeedback: (f) => {
      const rows = getJson("dispatchFeedback", []);
      rows.push(f);
      setJson("dispatchFeedback", rows);
      return f;
    },
    getDispatchAudit: () => getJson("dispatchAudit", []),
    addDispatchAudit: (a) => {
      const rows = getJson("dispatchAudit", []);
      rows.push(a);
      setJson("dispatchAudit", rows);
      return a;
    },
    getActiveDispatches: () => getJson("activeDispatches", {}),
    setActiveDispatches: (rows) => setJson("activeDispatches", rows || {}),
    getWorkOrders: () => getJson("workOrders", []),
    setWorkOrders: (rows) => setJson("workOrders", rows || []),
    addWorkOrder: (w) => {
      const rows = getJson("workOrders", []);
      rows.push(w);
      setJson("workOrders", rows);
      return w;
    },
    getWorkOrderAudit: () => getJson("workOrderAudit", []),
    addWorkOrderAudit: (a) => {
      const rows = getJson("workOrderAudit", []);
      rows.push(a);
      setJson("workOrderAudit", rows);
      return a;
    },
    addPredictionEvent: (row) => {
      const id = row.id || `PE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      db.prepare(`
        INSERT OR REPLACE INTO prediction_events
          (id, robot_id, robot_name, ts, failure_mode, failure_probability,
           estimated_ttf_hours, confidence, health_index, contributing_signals,
           alert, slope, health_drop, insufficient_data, mode_evidence, reason, status, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        id,
        row.robotId || "",
        row.robotName || null,
        typeof row.ts === "number" ? row.ts : null,
        row.failureMode || "bearing_wear",
        row.failureProbability ?? 0,
        row.estimatedTimeToFailureHours ?? null,
        row.confidence ?? 0,
        row.healthIndex ?? 1,
        JSON.stringify(row.contributingSignals || []),
        row.alert ? 1 : 0,
        row.slope ?? null,
        row.healthDrop ?? null,
        row.insufficientData ? 1 : 0,
        row.modeEvidence ? 1 : 0,
        row.reason || null,
        row.status || null,
        row.createdAt || new Date().toISOString()
      );
      return { ...row, id };
    },
    getPredictionEvents: (filter = {}) => {
      let sql = "SELECT * FROM prediction_events WHERE 1=1";
      const params = [];
      if (filter.robotId !== undefined) { sql += " AND robot_id=?"; params.push(filter.robotId); }
      if (filter.alert !== undefined) { sql += " AND alert=?"; params.push(filter.alert ? 1 : 0); }
      if (filter.fromTs !== undefined) { sql += " AND ts>=?"; params.push(filter.fromTs); }
      if (filter.toTs !== undefined) { sql += " AND ts<=?"; params.push(filter.toTs); }
      sql += " ORDER BY ts ASC";
      if (filter.limit) { sql += " LIMIT ?"; params.push(filter.limit); }
      return db.prepare(sql).all(...params).map((r) => ({
        id: r.id,
        robotId: r.robot_id,
        robotName: r.robot_name,
        ts: r.ts,
        failureMode: r.failure_mode,
        failureProbability: r.failure_probability,
        estimatedTimeToFailureHours: r.estimated_ttf_hours,
        confidence: r.confidence,
        healthIndex: r.health_index,
        contributingSignals: JSON.parse(r.contributing_signals || "[]"),
        alert: Boolean(r.alert),
        slope: r.slope,
        healthDrop: r.health_drop,
        insufficientData: Boolean(r.insufficient_data),
        modeEvidence: Boolean(r.mode_evidence),
        reason: r.reason,
        status: r.status,
        createdAt: r.created_at
      }));
    },
    addAlertEvent: (row) => {
      const info = db.prepare(`
        INSERT INTO alert_events
          (kpi, latest, baseline, delta_pct, severity, created_at,
           robot_id, failure_mode, prediction_id, status,
           ttf_hours, probability, confidence)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        row.kpi || "",
        row.latest ?? 0,
        row.baseline ?? 0,
        row.deltaPct ?? 0,
        row.severity || "Low",
        row.createdAt || new Date().toISOString(),
        row.robotId || null,
        row.failureMode || null,
        row.predictionId || null,
        row.status || "open",
        row.ttfHours ?? null,
        row.probability ?? null,
        row.confidence ?? null
      );
      return { ...row, id: info.lastInsertRowid };
    },
    getAlertEvents: (filter = {}) => {
      let sql = "SELECT * FROM alert_events WHERE 1=1";
      const params = [];
      if (filter.kpi !== undefined) { sql += " AND kpi=?"; params.push(filter.kpi); }
      if (filter.severity !== undefined) { sql += " AND severity=?"; params.push(filter.severity); }
      if (filter.robotId !== undefined) { sql += " AND robot_id=?"; params.push(filter.robotId); }
      if (filter.failureMode !== undefined) { sql += " AND failure_mode=?"; params.push(filter.failureMode); }
      if (filter.status !== undefined) { sql += " AND status=?"; params.push(filter.status); }
      sql += " ORDER BY id ASC";
      if (filter.limit) { sql += " LIMIT ?"; params.push(filter.limit); }
      return db.prepare(sql).all(...params).map((r) => ({
        id: r.id,
        kpi: r.kpi,
        latest: r.latest,
        baseline: r.baseline,
        deltaPct: r.delta_pct,
        severity: r.severity,
        createdAt: r.created_at,
        robotId: r.robot_id,
        failureMode: r.failure_mode,
        predictionId: r.prediction_id,
        status: r.status,
        ttfHours: r.ttf_hours,
        probability: r.probability,
        confidence: r.confidence,
        acknowledgedBy: r.acknowledged_by,
        acknowledgedAt: r.acknowledged_at,
        resolvedAt: r.resolved_at
      }));
    },
    updateAlertEvent: (id, patch) => {
      const sets = [];
      const params = [];
      if (patch.status !== undefined) { sets.push("status=?"); params.push(patch.status); }
      if (patch.acknowledgedBy !== undefined) { sets.push("acknowledged_by=?"); params.push(patch.acknowledgedBy); }
      if (patch.acknowledgedAt !== undefined) { sets.push("acknowledged_at=?"); params.push(patch.acknowledgedAt); }
      if (patch.resolvedAt !== undefined) { sets.push("resolved_at=?"); params.push(patch.resolvedAt); }
      if (sets.length === 0) return;
      params.push(id);
      db.prepare(`UPDATE alert_events SET ${sets.join(", ")} WHERE id=?`).run(...params);
    },
    addTechnicianFeedback: (row) => {
      const id = row.id || `TF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      db.prepare(`
        INSERT OR REPLACE INTO technician_feedback
          (id, dispatch_id, robot_id, failure_mode, prediction_id, outcome,
           actual_cause, action_taken, fix_worked, repair_minutes, parts_used,
           notes, technician_id, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        id,
        row.dispatchId || "",
        row.robotId || null,
        row.failureMode || null,
        row.predictionId || null,
        row.outcome || "",
        row.actualCause || null,
        row.actionTaken || null,
        row.fixWorked ? 1 : 0,
        row.repairMinutes ?? null,
        JSON.stringify(row.partsUsed || []),
        row.notes || null,
        row.technicianId || null,
        row.createdAt || new Date().toISOString()
      );
      return { ...row, id };
    },
    getTechnicianFeedback: (filter = {}) => {
      let sql = "SELECT * FROM technician_feedback WHERE 1=1";
      const params = [];
      if (filter.dispatchId !== undefined) { sql += " AND dispatch_id=?"; params.push(filter.dispatchId); }
      if (filter.outcome !== undefined) { sql += " AND outcome=?"; params.push(filter.outcome); }
      sql += " ORDER BY created_at ASC";
      if (filter.limit) { sql += " LIMIT ?"; params.push(filter.limit); }
      return db.prepare(sql).all(...params).map((r) => ({
        id: r.id,
        dispatchId: r.dispatch_id,
        robotId: r.robot_id,
        failureMode: r.failure_mode,
        predictionId: r.prediction_id,
        outcome: r.outcome,
        actualCause: r.actual_cause,
        actionTaken: r.action_taken,
        fixWorked: Boolean(r.fix_worked),
        repairMinutes: r.repair_minutes,
        partsUsed: JSON.parse(r.parts_used || "[]"),
        notes: r.notes,
        technicianId: r.technician_id,
        createdAt: r.created_at
      }));
    },
    clearAll: () => {
      db.exec("DELETE FROM kv_store; DELETE FROM telemetry; DELETE FROM prediction_events; DELETE FROM alert_events; DELETE FROM technician_feedback;");
    },
    clearPredictions: () => setJson("predictions", []),
    setPredictions: (rows) => setJson("predictions", rows),
    clearTelemetry: () => {
      db.exec("DELETE FROM telemetry;");
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
