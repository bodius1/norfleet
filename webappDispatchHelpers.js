/**
 * Pure Technician Dispatch UI helpers — safe for Node tests and browser (window.DispatchUI).
 * Wrapped in an IIFE so top-level bindings never collide with webapp.js globals.
 */
(function dispatchUiHelpersModule(global) {
  let dispatchFormat = null;
  if (typeof require === "function") {
    try {
      dispatchFormat = require("./utils/dispatchFormat");
    } catch (_) {
      dispatchFormat = null;
    }
  }

  const formatSignalName =
    dispatchFormat?.formatSignalName ||
    function formatSignalName(name) {
      return String(name || "Signal")
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase());
    };

  const failureModeLabel =
    dispatchFormat?.failureModeLabel ||
    function failureModeLabel(mode) {
      return String(mode || "unknown").replace(/_/g, " ");
    };

  const safeNumber =
    dispatchFormat?.safeNumber ||
    function safeNumber(value, fallback = null) {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };

  const formatPercent =
    dispatchFormat?.formatPercent ||
    function formatPercent(value) {
      const n = safeNumber(value, null);
      if (n === null) return "Not available";
      const pct = n <= 1 ? n * 100 : n;
      return `${Math.round(pct)}%`;
    };

  const ACTIVE_QUEUE_STATUSES = new Set(["new", "acknowledged", "deferred", "work_order_created"]);
  const OPEN_WORK_ORDER_STATUSES = new Set(["open", "in_progress", "assigned"]);

  const STATUS_LABELS = {
    new: "New",
    acknowledged: "Acknowledged",
    deferred: "Deferred",
    work_order_created: "Work order open",
    resolved: "Resolved",
    false_alarm: "False alarm",
    in_progress: "In progress",
    open: "Open",
    assigned: "Assigned",
    on_hold: "On hold",
    cancelled: "Cancelled"
  };

  function sanitizeDisplayValue(value, fallback = "Not available") {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "number" && !Number.isFinite(value)) return fallback;
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return fallback;
    const s = String(value).trim();
    if (!s || s === "undefined" || s === "null" || s === "NaN" || s === "[object Object]") return fallback;
    return s;
  }

  function getDispatchStatusLabel(status) {
    const key = String(status || "new").toLowerCase();
    return STATUS_LABELS[key] || sanitizeDisplayValue(status, "New");
  }

  function getWorkOrderStatusLabel(status) {
    return getDispatchStatusLabel(status);
  }

  function getDispatchPrimaryAction(dispatch) {
    const status = String(dispatch?.workflow?.status || "new").toLowerCase();
    const workOrderId = dispatch?.workflow?.workOrderId;

    if (status === "new" || status === "acknowledged") {
      return { type: "create_work_order", label: "Create work order" };
    }
    if (status === "work_order_created" && workOrderId) {
      return {
        type: "work_order_open",
        label: `Work order open: ${workOrderId}`,
        secondaryLabel: "Open work order",
        workOrderId
      };
    }
    return { type: "none", label: "" };
  }

  function getActiveQueueCount(report) {
    const dispatches = report?.dispatches || [];
    return dispatches.filter((d) => ACTIVE_QUEUE_STATUSES.has(String(d?.workflow?.status || "new").toLowerCase())).length;
  }

  function getCriticalNowCount(report) {
    return (report?.dispatches || []).filter(
      (d) => String(d?.priority || "").toLowerCase() === "critical" && d?.prediction?.alert === true
    ).length;
  }

  function getOpenWorkOrdersCount(workOrders) {
    return (workOrders || []).filter((w) => OPEN_WORK_ORDER_STATUSES.has(String(w?.status || "").toLowerCase())).length;
  }

  function risingSignals(dispatch, limit = 2) {
    const signals = (dispatch?.evidence?.signals || []).slice();
    const rising = signals.filter((s) => String(s?.direction || "").toLowerCase() === "rising");
    const pool = rising.length ? rising : signals;
    return pool.slice(0, limit);
  }

  function formatTrustReason(dispatch) {
    const mode = failureModeLabel(dispatch?.prediction?.failureMode);
    const signals = risingSignals(dispatch, 2).map((s) => formatSignalName(s.name).toLowerCase());
    if (!signals.length) {
      return `Predicted ${mode} based on monitored telemetry trends.`;
    }
    if (signals.length === 1) {
      return `Predicted ${mode} based on rising ${signals[0]}.`;
    }
    return `Predicted ${mode} based on rising ${signals[0]} and ${signals[1]}.`;
  }

  function buildEvidenceRows(dispatch, limit = 3) {
    return (dispatch?.evidence?.signals || []).slice(0, limit).map((signal) => ({
      name: sanitizeDisplayValue(formatSignalName(signal?.name), "Signal"),
      direction: sanitizeDisplayValue(signal?.direction, "flat"),
      reason: sanitizeDisplayValue(signal?.reason, "Signal monitored"),
      latest:
        signal?.latest != null && Number.isFinite(Number(signal.latest))
          ? sanitizeDisplayValue(Number(signal.latest).toFixed(2))
          : "Not available"
    }));
  }

  function basenameSource(sourceFile) {
    const raw = sanitizeDisplayValue(sourceFile, "");
    if (!raw || raw === "Not available") return "Not available";
    const parts = raw.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || raw;
  }

  function buildSopRows(workOrderOrDispatch, workOrderLookup = {}) {
    const dispatchId = workOrderOrDispatch?.dispatchId;
    const linked =
      workOrderOrDispatch?.sopRefs?.length
        ? workOrderOrDispatch
        : workOrderOrDispatch?.workflow?.workOrderId
          ? Object.values(workOrderLookup).find((w) => w.workOrderId === workOrderOrDispatch.workflow.workOrderId)
          : dispatchId
            ? workOrderLookup[dispatchId]
            : null;

    const refs = linked?.sopRefs || [];
    if (!refs.length) return [];

    return refs.map((ref) => ({
      title: sanitizeDisplayValue(ref?.title, "SOP reference"),
      relevance: sanitizeDisplayValue(ref?.relevance, "Maintenance reference"),
      confidence: sanitizeDisplayValue(formatPercent(ref?.confidence), "Not available"),
      source: basenameSource(ref?.sourceFile)
    }));
  }

  function buildSnapshotSummary(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return "Telemetry snapshot not available.";
    }
    const hi = safeNumber(snapshot.healthIndex, null);
    const prob = safeNumber(snapshot.failureProbability, null);
    const mode = sanitizeDisplayValue(snapshot.failureMode, "unknown");
    const hiText = hi != null ? hi.toFixed(2) : "Not available";
    const probText = prob != null ? `${Math.round(prob <= 1 ? prob * 100 : prob)}%` : "Not available";
    return `At dispatch — HI ${hiText} | Prob ${probText} | Mode ${mode}`;
  }

  function shouldShowDemoTools(reportOrSiteId) {
    if (typeof reportOrSiteId === "string") {
      return reportOrSiteId.includes("localhost-demo") || reportOrSiteId.includes("demo");
    }
    const siteId = reportOrSiteId?.siteId || reportOrSiteId?.modelInfo?.siteId || "";
    if (String(siteId).includes("localhost-demo")) return true;
    if (typeof window !== "undefined" && window.location?.hostname === "localhost") return true;
    return false;
  }

  function getEmptyQueueCopy() {
    return "No actionable robot failures right now. Fleet is being monitored.";
  }

  function mapResolveOutcomeForApi(uiOutcome) {
    const map = {
      repaired: "fixed_early",
      false_alarm: "false_alarm",
      deferred: "not_enough_evidence"
    };
    return map[uiOutcome] || uiOutcome;
  }

  function assessSnapshotImprovement(beforeSnapshot, afterSnapshot) {
    if (!beforeSnapshot || !afterSnapshot) return "unknown";
    const hiBefore = safeNumber(beforeSnapshot.healthIndex, null);
    const hiAfter = safeNumber(afterSnapshot.healthIndex, null);
    const probBefore = safeNumber(beforeSnapshot.failureProbability, null);
    const probAfter = safeNumber(afterSnapshot.failureProbability, null);

    let improved = false;
    if (hiBefore != null && hiAfter != null && hiAfter > hiBefore + 0.02) improved = true;
    if (probBefore != null && probAfter != null && probAfter < probBefore - 0.05) improved = true;
    return improved ? "improved" : "unchanged";
  }

  function formatResolveOutcomeMessage(workOrder, uiOutcome) {
    if (uiOutcome === "false_alarm") {
      return "False alarm recorded. Model review will use this feedback.";
    }
    const before = workOrder?.beforeSnapshot;
    const after = workOrder?.afterSnapshot;
    if (!after) {
      return "Telemetry snapshot not available.";
    }
    const verdict = assessSnapshotImprovement(before, after);
    if (verdict === "improved") {
      return "Outcome saved. Health risk improved after repair.";
    }
    return "Outcome saved. Risk still elevated — monitor next shift.";
  }

  function indexWorkOrdersByDispatch(workOrders) {
    if (!Array.isArray(workOrders)) return {};
    return workOrders.reduce((acc, wo) => {
      if (wo && wo.dispatchId) acc[wo.dispatchId] = wo;
      return acc;
    }, {});
  }

  function formatCompactTtf(hours) {
    if (dispatchFormat) return dispatchFormat.formatHours(hours);
    const n = safeNumber(hours, null);
    if (n === null || n <= 0) return "Not available";
    if (n < 0.1) return "imminent";
    if (n < 1) return `~${Math.max(1, Math.round(n * 60))} min`;
    return `~${n.toFixed(1)}h`;
  }

  function formatHumanDate(iso) {
    if (!iso) return "Not available";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "Not available";
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function priorityChipClass(priority) {
    const p = String(priority || "medium").toLowerCase();
    if (p === "critical") return "td-chip td-chip--critical";
    if (p === "high") return "td-chip td-chip--high";
    if (p === "low") return "td-chip td-chip--low";
    return "td-chip td-chip--medium";
  }

  function statusChipClass(status) {
    const s = String(status || "new").toLowerCase();
    if (s === "work_order_created" || s === "open" || s === "in_progress") return "td-chip td-chip--active";
    if (s === "resolved") return "td-chip td-chip--resolved";
    if (s === "false_alarm") return "td-chip td-chip--muted";
    if (s === "deferred") return "td-chip td-chip--deferred";
    return "td-chip td-chip--neutral";
  }

  const dispatchUiExports = {
    ACTIVE_QUEUE_STATUSES,
    OPEN_WORK_ORDER_STATUSES,
    STATUS_LABELS,
    sanitizeDisplayValue,
    getDispatchStatusLabel,
    getWorkOrderStatusLabel,
    getDispatchPrimaryAction,
    getActiveQueueCount,
    getCriticalNowCount,
    getOpenWorkOrdersCount,
    formatTrustReason,
    buildEvidenceRows,
    buildSopRows,
    buildSnapshotSummary,
    shouldShowDemoTools,
    getEmptyQueueCopy,
    mapResolveOutcomeForApi,
    assessSnapshotImprovement,
    formatResolveOutcomeMessage,
    indexWorkOrdersByDispatch,
    formatCompactTtf,
    formatHumanDate,
    priorityChipClass,
    statusChipClass,
    failureModeLabel
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = dispatchUiExports;
  }
  if (typeof global !== "undefined") {
    global.DispatchUI = dispatchUiExports;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
