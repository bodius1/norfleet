/** Technician Dispatch UI — technician-first surface (loaded after webapp.js + DispatchUI helpers). */

function resolveDispatchUiHelpers() {
  return (
    (typeof globalThis !== "undefined" && globalThis.DispatchUI) ||
    (typeof DispatchUI !== "undefined" && DispatchUI) ||
    null
  );
}

function createSafeDispatchUiHelpers(base) {
  const src = base && typeof base === "object" ? base : {};
  const pick = (name, fallback) => (typeof src[name] === "function" ? src[name] : fallback);

  return {
    sanitizeDisplayValue: pick("sanitizeDisplayValue", (value, fallback = "Not available") => {
      if (value === undefined || value === null) return fallback;
      if (typeof value === "number" && !Number.isFinite(value)) return fallback;
      const s = String(value).trim();
      return s || fallback;
    }),
    getDispatchStatusLabel: pick("getDispatchStatusLabel", () => "New"),
    getWorkOrderStatusLabel: pick("getWorkOrderStatusLabel", () => "Open"),
    getDispatchPrimaryAction: pick("getDispatchPrimaryAction", () => ({ type: "none", label: "" })),
    getActiveQueueCount: pick("getActiveQueueCount", () => 0),
    getCriticalNowCount: pick("getCriticalNowCount", () => 0),
    getOpenWorkOrdersCount: pick("getOpenWorkOrdersCount", () => 0),
    formatTrustReason: pick("formatTrustReason", () => "Prediction details unavailable."),
    buildEvidenceRows: pick("buildEvidenceRows", () => []),
    buildSopRows: pick("buildSopRows", () => []),
    buildSnapshotSummary: pick("buildSnapshotSummary", () => "Telemetry snapshot not available."),
    shouldShowDemoTools: pick("shouldShowDemoTools", () => false),
    getEmptyQueueCopy: pick(
      "getEmptyQueueCopy",
      () => "No actionable robot failures right now. Fleet is being monitored."
    ),
    mapResolveOutcomeForApi: pick("mapResolveOutcomeForApi", (uiOutcome) => uiOutcome || "not_enough_evidence"),
    formatResolveOutcomeMessage: pick("formatResolveOutcomeMessage", () => "Outcome saved."),
    indexWorkOrdersByDispatch: pick("indexWorkOrdersByDispatch", (workOrders) => {
      if (!Array.isArray(workOrders)) return {};
      return workOrders.reduce((acc, wo) => {
        if (wo && wo.dispatchId) acc[wo.dispatchId] = wo;
        return acc;
      }, {});
    }),
    formatCompactTtf: pick("formatCompactTtf", () => "Not available"),
    formatHumanDate: pick("formatHumanDate", () => "Not available"),
    priorityChipClass: pick("priorityChipClass", () => "td-chip td-chip--medium"),
    statusChipClass: pick("statusChipClass", () => "td-chip td-chip--neutral"),
    failureModeLabel: pick("failureModeLabel", (mode) => String(mode || "unknown").replace(/_/g, " "))
  };
}

const H = createSafeDispatchUiHelpers(resolveDispatchUiHelpers());

function ensureDispatchUiState() {
  if (!state.dispatchUi) {
    state.dispatchUi = {
      syncStatus: "idle",
      lastRefresh: null,
      cardMessages: {},
      cardErrors: {},
      resolveMessages: {},
      resolveErrors: {},
      expandedResolveId: null
    };
  }
  if (!Array.isArray(state.workOrders)) state.workOrders = [];
}

const DISPATCH_REPORT_FETCH_MS = 5000;

function emptyDispatchReport(options = {}) {
  return {
    dispatches: [],
    adminUpdates: [],
    feedbackQueue: [],
    timedOut: Boolean(options.timedOut),
    emptyState:
      options.message ||
      "Dispatch report unavailable. Fleet monitoring continues.",
    summary: {
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      technicianDispatchCount: 0,
      automationUpdateCount: 0,
      approvalRequiredCount: 0,
      estimatedDowntimeRiskHours: 0
    }
  };
}

async function fetchDispatchReport() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISPATCH_REPORT_FETCH_MS);
  try {
    const report = await api("/api/technician/dispatch-report", { signal: controller.signal });
    if (report?.timedOut) {
      return {
        report: emptyDispatchReport({
          timedOut: true,
          message: report.emptyState || "Dispatch report timed out. Retry from Refresh."
        }),
        degraded: true
      };
    }
    return { report, degraded: false };
  } catch (err) {
    const isTimeout =
      err?.name === "AbortError" ||
      String(err?.message || "")
        .toLowerCase()
        .includes("abort");
    return {
      report: emptyDispatchReport({
        timedOut: isTimeout,
        message: isTimeout
          ? "Dispatch report timed out. Retry from Refresh."
          : "Dispatch report unavailable."
      }),
      degraded: true
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadWorkOrders() {
  ensureDispatchUiState();
  const res = await api("/api/work-orders");
  state.workOrders = Array.isArray(res.workOrders) ? res.workOrders : [];
  return state.workOrders;
}

async function loadDispatchReport() {
  ensureDispatchUiState();
  state.dispatchUi.syncStatus = "syncing";
  const { report, degraded } = await fetchDispatchReport();
  state.dispatchReport = report;
  state.dispatchUi.syncStatus = degraded ? "degraded" : "idle";
  state.dispatchUi.lastRefresh = degraded ? state.dispatchUi.lastRefresh : new Date().toISOString();
  loadWorkOrders().catch(() => {});
  return report;
}

async function refreshTechnicianDispatch() {
  ensureDispatchUiState();
  state.dispatchUi.syncStatus = "syncing";
  const { report, degraded } = await fetchDispatchReport();
  state.dispatchReport = report;
  await loadWorkOrders().catch(() => {});
  state.dispatchUi.syncStatus = degraded ? "degraded" : "idle";
  state.dispatchUi.lastRefresh = degraded ? state.dispatchUi.lastRefresh : new Date().toISOString();
  renderTechnicianReport();
  return report;
}

async function dispatchWorkflowAction(dispatchId, action, extra = {}) {
  await api(`/api/dispatch/${encodeURIComponent(dispatchId)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...extra, technicianId: extra.technicianId || "tech-demo" })
  });
  await refreshTechnicianDispatch();
  showToast("◇", `Dispatch ${action.replace("-", " ")}.`);
}

async function createWorkOrderForDispatch(dispatch) {
  ensureDispatchUiState();
  const dispatchId = dispatch.dispatchId;
  delete state.dispatchUi.cardErrors[dispatchId];
  try {
    const res = await api(`/api/dispatch/${encodeURIComponent(dispatchId)}/work-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ technicianId: "tech-demo", createdBy: "demo" })
    });
    if (res.reusedExisting) {
      state.dispatchUi.cardMessages[dispatchId] = "Work order already open for this issue.";
    } else {
      state.dispatchUi.cardMessages[dispatchId] =
        "Work order open. Continue here or in Active Work Orders.";
    }
    await refreshTechnicianDispatch();
    return res;
  } catch (err) {
    state.dispatchUi.cardErrors[dispatchId] = err.message || "Could not create work order.";
    renderTechnicianReport();
    throw err;
  }
}

async function resolveWorkOrderOutcome(workOrderId, uiOutcome, notes) {
  ensureDispatchUiState();
  delete state.dispatchUi.resolveErrors[workOrderId];
  try {
    const res = await api(`/api/work-orders/${encodeURIComponent(workOrderId)}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outcome: H.mapResolveOutcomeForApi(uiOutcome),
        notes: notes || "",
        technicianId: "tech-demo"
      })
    });
    const wo = res.workOrder || {};
    state.dispatchUi.resolveMessages[workOrderId] = H.formatResolveOutcomeMessage(wo, uiOutcome);
    state.dispatchUi.expandedResolveId = null;
    await refreshTechnicianDispatch();
    return res;
  } catch (err) {
    state.dispatchUi.resolveErrors[workOrderId] = err.message || "Could not save outcome.";
    renderTechnicianReport();
    throw err;
  }
}

async function resetDemoScenario() {
  try {
    const res = await api("/api/demo/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clearWorkOrders: true, resetCalibration: true })
    });
    if (!res || res.ok === false) throw new Error("Demo reset failed");
    await refreshTechnicianDispatch();
    if (typeof refreshFleetHealth === "function") await refreshFleetHealth().catch(() => {});
    showToast("◇", "Demo reset complete. R-002 dispatch is ready.");
    return res;
  } catch (_err) {
    showToast(
      "⚠",
      "Demo reset endpoint not available — reseed from terminal with: npm run seed:demo"
    );
  }
}

function renderChip(label, className) {
  return `<span class="${escapeHtml(className)}">${escapeHtml(H.sanitizeDisplayValue(label))}</span>`;
}

function renderEvidenceDrawer(dispatch) {
  const rows = H.buildEvidenceRows(dispatch);
  const evidenceBody = rows.length
    ? rows
        .map(
          (row) => `
        <div class="td-evidence-row">
          <strong>${escapeHtml(row.name)}</strong>
          <div class="td-card-sub">${escapeHtml(row.direction)} · ${escapeHtml(row.reason)} · Latest ${escapeHtml(row.latest)}</div>
        </div>`
        )
        .join("")
    : `<p class="td-card-sub">No signal evidence available.</p>`;

  return `
    <details class="td-drawer">
      <summary>Evidence</summary>
      <div class="td-drawer-body">${evidenceBody}</div>
    </details>`;
}

function renderSopDrawer(dispatch, workOrderLookup) {
  const rows = H.buildSopRows(dispatch, workOrderLookup);
  const body = rows.length
    ? rows
        .map(
          (row) => `
        <div class="td-sop-row">
          <strong>${escapeHtml(row.title)}</strong>
          <p class="td-card-sub">${escapeHtml(row.relevance)}</p>
          <p class="td-card-sub">Confidence ${escapeHtml(row.confidence)} · ${escapeHtml(row.source)}</p>
        </div>`
        )
        .join("")
    : `<p class="td-card-sub">No SOP references found for this failure mode.</p>`;

  return `
    <details class="td-drawer">
      <summary>SOP references</summary>
      <div class="td-drawer-body">${body}</div>
    </details>`;
}

function renderDispatchCard(dispatch, workOrderLookup) {
  ensureDispatchUiState();
  const dispatchId = dispatch.dispatchId;
  const status = dispatch.workflow?.status || "new";
  const primary = H.getDispatchPrimaryAction(dispatch);
  const linkedWo = workOrderLookup[dispatchId];
  const snapshotLine = linkedWo?.beforeSnapshot ? H.buildSnapshotSummary(linkedWo.beforeSnapshot) : "";
  const mode = H.failureModeLabel(dispatch.prediction?.failureMode);
  const ttf = H.formatCompactTtf(dispatch.prediction?.estimatedTimeToFailureHours);
  const cardMsg = state.dispatchUi.cardMessages[dispatchId];
  const cardErr = state.dispatchUi.cardErrors[dispatchId];
  const criticalClass =
    String(dispatch.priority || "").toLowerCase() === "critical" ? " td-dispatch-card--critical" : "";

  let primaryHtml = "";
  if (primary.type === "create_work_order") {
    primaryHtml = `<button type="button" class="tr-btn-primary td-primary-action" data-create-wo="${escapeHtml(dispatchId)}">${escapeHtml(primary.label)}</button>`;
  } else if (primary.type === "work_order_open") {
    primaryHtml = `
      <span class="td-primary-label">${escapeHtml(primary.label)}</span>
      <button type="button" class="tr-btn-ghost td-primary-action" data-open-wo="${escapeHtml(primary.workOrderId)}">${escapeHtml(primary.secondaryLabel)}</button>`;
  }

  const bannerHtml = cardErr
    ? `<div class="td-card-banner td-card-banner--error">${escapeHtml(cardErr)}</div>`
    : cardMsg
      ? `<div class="td-card-banner td-card-banner--info">${escapeHtml(cardMsg)}</div>`
      : "";

  return `
    <article class="td-dispatch-card${criticalClass}" data-dispatch-id="${escapeHtml(dispatchId)}" id="dispatch-${escapeHtml(dispatchId)}">
      <header class="td-card-head">
        <div class="td-card-head-main">
          <strong>${escapeHtml(H.sanitizeDisplayValue(dispatch.robot?.robotName))}</strong>
          <span class="td-card-sub">${escapeHtml(H.sanitizeDisplayValue(dispatch.robot?.robotId))} · Zone ${escapeHtml(H.sanitizeDisplayValue(dispatch.robot?.zone))}</span>
        </div>
      </header>
      <div class="td-chip-row">
        ${renderChip(`Priority ${H.sanitizeDisplayValue(dispatch.priority, "medium")}`, H.priorityChipClass(dispatch.priority))}
        ${renderChip(H.getDispatchStatusLabel(status), H.statusChipClass(status))}
      </div>
      <p class="td-mode-line">${escapeHtml(mode)} · TTF ${escapeHtml(ttf)}</p>
      <p class="td-trust-line">${escapeHtml(H.formatTrustReason(dispatch))}</p>
      ${snapshotLine && snapshotLine !== "Telemetry snapshot not available." ? `<p class="td-snapshot-line">${escapeHtml(snapshotLine)}</p>` : ""}
      ${bannerHtml}
      ${primaryHtml}
      <div class="td-secondary-actions">
        <button type="button" class="tr-btn-ghost" data-dispatch-action="acknowledge" data-id="${escapeHtml(dispatchId)}">Acknowledge</button>
        <button type="button" class="tr-btn-ghost" data-dispatch-action="defer" data-id="${escapeHtml(dispatchId)}">Defer</button>
        <button type="button" class="tr-btn-ghost" data-dispatch-telemetry="${escapeHtml(dispatch.robot?.robotId)}">View telemetry</button>
        <button type="button" class="tr-btn-ghost" data-dispatch-action="false-alarm" data-id="${escapeHtml(dispatchId)}">Mark false alarm</button>
      </div>
      ${renderEvidenceDrawer(dispatch)}
      ${renderSopDrawer(dispatch, workOrderLookup)}
    </article>`;
}

function renderWorkOrderCard(workOrder) {
  ensureDispatchUiState();
  const workOrderId = workOrder.workOrderId;
  const expanded = state.dispatchUi.expandedResolveId === workOrderId;
  const resolveMsg = state.dispatchUi.resolveMessages[workOrderId];
  const resolveErr = state.dispatchUi.resolveErrors[workOrderId];
  const steps = (workOrder.recommendedSteps || []).slice(0, 6);

  return `
    <article class="td-work-order-card" id="wo-${escapeHtml(workOrderId)}" data-work-order-id="${escapeHtml(workOrderId)}">
      <header class="td-card-head">
        <div class="td-card-head-main">
          <strong>${escapeHtml(H.sanitizeDisplayValue(workOrder.robotName))}</strong>
          <span class="td-card-sub">${escapeHtml(H.sanitizeDisplayValue(workOrder.workOrderId))} · Zone ${escapeHtml(H.sanitizeDisplayValue(workOrder.zone))}</span>
        </div>
      </header>
      <div class="td-chip-row">
        ${renderChip(H.getWorkOrderStatusLabel(workOrder.status), H.statusChipClass(workOrder.status))}
        ${renderChip(H.failureModeLabel(workOrder.failureMode), "td-chip td-chip--neutral")}
      </div>
      <p class="td-card-sub">Created ${escapeHtml(H.formatHumanDate(workOrder.createdAt))}</p>
      ${
        workOrder.assignedTechnicianId
          ? `<p class="td-card-sub">Assigned ${escapeHtml(H.sanitizeDisplayValue(workOrder.assignedTechnicianId))}</p>`
          : ""
      }
      <p class="td-snapshot-line">${escapeHtml(H.buildSnapshotSummary(workOrder.beforeSnapshot))}</p>
      <details class="td-drawer">
        <summary>Recommended steps</summary>
        <div class="td-drawer-body">
          ${
            steps.length
              ? `<ol>${steps.map((s) => `<li>${escapeHtml(H.sanitizeDisplayValue(s))}</li>`).join("")}</ol>`
              : `<p class="td-card-sub">No steps listed.</p>`
          }
        </div>
      </details>
      <div class="td-resolve-panel">
        <button type="button" class="tr-btn-primary td-primary-action" data-toggle-resolve="${escapeHtml(workOrderId)}">${expanded ? "Hide resolve form" : "Resolve work order"}</button>
        ${
          expanded
            ? `
          <form class="td-resolve-form" data-resolve-form="${escapeHtml(workOrderId)}">
            <label>Outcome
              <select name="outcome" required>
                <option value="repaired">Repaired</option>
                <option value="false_alarm">False alarm</option>
                <option value="deferred">Deferred</option>
              </select>
            </label>
            <label>Notes
              <textarea name="notes" rows="3" placeholder="Optional notes for the maintenance record"></textarea>
            </label>
            <button type="submit" class="tr-btn-primary">Save outcome</button>
            ${resolveErr ? `<p class="td-resolve-error">${escapeHtml(resolveErr)}</p>` : ""}
          </form>`
            : ""
        }
        ${resolveMsg ? `<p class="td-outcome-note">${escapeHtml(resolveMsg)}</p>` : ""}
      </div>
    </article>`;
}

function formatAdminUpdateForDisplay(update) {
  const summary = String(update?.summary || "").toLowerCase();
  const title = String(update?.title || "").toLowerCase();
  const updateId = String(update?.updateId || "");
  let count = 1;
  const countMatch = String(update?.summary || "").match(/(\d+)\s+kpi anomaly/i);
  if (countMatch) count = Number(countMatch[1]) || 1;

  if (
    updateId.includes("kpi") ||
    summary.includes("anomaly pattern") ||
    summary.includes("fault signature") ||
    summary.includes("correlated")
  ) {
    const noun = count === 1 ? "fault pattern" : "fault patterns";
    return {
      title: `${count} ${noun} detected across the fleet.`,
      summary: "Automated monitoring noticed recurring trends worth a later review."
    };
  }

  if (
    summary.includes("verification") ||
    summary.includes("pending confirmation") ||
    title.includes("verification") ||
    summary.includes("confirm")
  ) {
    const noun = count === 1 ? "maintenance action" : "maintenance actions";
    return {
      title: `${count} ${noun} pending confirmation.`,
      summary: "Confirm completed work when your team is ready."
    };
  }

  const noun = count === 1 ? "item" : "items";
  return {
    title: `${count} ${noun} flagged for review.`,
    summary: "Automation noted something to check. No immediate floor repair is required."
  };
}

function renderTechnicianReport() {
  const root = byId("technician-report-root");
  if (!root) return;
  ensureDispatchUiState();

  const report = state.dispatchReport;
  const dispatches = report?.dispatches || [];
  const adminUpdates = report?.adminUpdates || [];
  const workOrders = state.workOrders || [];
  const workOrderLookup = H.indexWorkOrdersByDispatch(workOrders);
  const openWorkOrders = workOrders.filter((w) =>
    ["open", "in_progress", "assigned"].includes(String(w.status || "").toLowerCase())
  );

  const syncBanner =
    state.dispatchUi.syncStatus === "failed" || state.dispatchUi.syncStatus === "degraded"
      ? `<div class="td-sync-banner td-sync-banner--failed">${escapeHtml(
          state.dispatchReport?.emptyState || "Dispatch report unavailable."
        )} <button type="button" class="tr-btn-ghost" id="td-retry-sync-btn">Retry</button></div>`
      : state.dispatchUi.syncStatus === "syncing"
        ? `<div class="td-sync-banner">Syncing dispatch and work orders…</div>`
        : "";

  const headerHtml = `
    <div class="td-header-metrics">
      <div class="td-metric-card"><span class="td-metric-value">${H.getActiveQueueCount(report)}</span><span class="td-metric-label">Active queue</span></div>
      <div class="td-metric-card"><span class="td-metric-value">${H.getCriticalNowCount(report)}</span><span class="td-metric-label">Critical now</span></div>
      <div class="td-metric-card"><span class="td-metric-value">${H.getOpenWorkOrdersCount(workOrders)}</span><span class="td-metric-label">Open work orders</span></div>
      <div class="td-metric-card"><span class="td-metric-value">${escapeHtml(H.formatHumanDate(state.dispatchUi.lastRefresh))}</span><span class="td-metric-label">Last refresh</span></div>
    </div>`;

  const dispatchCards = dispatches.length
    ? dispatches.map((d) => renderDispatchCard(d, workOrderLookup)).join("")
    : `<p class="td-empty-copy">${escapeHtml(H.getEmptyQueueCopy())}</p>`;

  const workOrderCards = openWorkOrders.length
    ? openWorkOrders.map((wo) => renderWorkOrderCard(wo)).join("")
    : `<p class="td-empty-copy">No open work orders right now.</p>`;

  const adminHtml = adminUpdates.length
    ? adminUpdates
        .map((u) => {
          const display = formatAdminUpdateForDisplay(u);
          return `
        <div class="td-admin-card">
          <span class="td-chip td-chip--deferred">Automation update</span>
          <h4>${escapeHtml(display.title)}</h4>
          <p>${escapeHtml(display.summary)}</p>
        </div>`;
        })
        .join("")
    : `<p class="td-card-sub">No automation updates suggested right now.</p>`;

  const showDev = H.shouldShowDemoTools(report);

  root.innerHTML = `
    <div class="td-page-header">
      <div>
        <h2>Technician Dispatch</h2>
        <p class="muted">Floor-first repair queue for predicted robot failures.</p>
      </div>
      <button type="button" class="tr-btn-primary" id="td-refresh-btn">Refresh</button>
    </div>
    ${syncBanner}
    ${headerHtml}

    <section class="td-section tr-block">
      <h3 class="td-section-title">Priority dispatch queue</h3>
      <p class="td-section-note">Inspect highest urgency first. One primary action per card.</p>
      <div class="td-dispatch-queue">${dispatchCards}</div>
    </section>

    <section class="td-section tr-block">
      <h3 class="td-section-title">Active work orders</h3>
      <p class="td-section-note">Open maintenance tasks linked to dispatches.</p>
      <div class="td-work-order-list">${workOrderCards}</div>
    </section>

    <details class="td-collapsed-section tr-block">
      <summary>Admin / automation updates (${adminUpdates.length})</summary>
      <div class="td-collapsed-body td-admin-grid">${adminHtml}</div>
    </details>

    ${
      showDev
        ? `
    <details class="td-collapsed-section td-dev-isolated tr-block">
      <summary>Demo / Dev Tools</summary>
      <div class="td-collapsed-body td-dev-tools">
        <button type="button" class="tr-btn-ghost" id="td-reset-demo-btn">Reset demo scenario</button>
      </div>
    </details>`
        : ""
    }`;

  byId("td-refresh-btn")?.addEventListener("click", () => refreshTechnicianDispatch().catch((e) => showToast("⚠", e.message)));
  byId("td-retry-sync-btn")?.addEventListener("click", () => refreshTechnicianDispatch().catch((e) => showToast("⚠", e.message)));
  byId("td-reset-demo-btn")?.addEventListener("click", () => resetDemoScenario());

  root.querySelectorAll("[data-create-wo]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const dispatch = dispatches.find((d) => d.dispatchId === btn.dataset.createWo);
      if (dispatch) createWorkOrderForDispatch(dispatch).catch(() => {});
    });
  });

  root.querySelectorAll("[data-open-wo]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      byId(`wo-${btn.dataset.openWo}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  root.querySelectorAll("[data-dispatch-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      dispatchWorkflowAction(btn.dataset.id, btn.dataset.dispatchAction, { technicianId: "tech-demo" }).catch((err) =>
        showToast("⚠", err.message)
      );
    });
  });

  root.querySelectorAll("[data-dispatch-telemetry]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.fleetHealthFocusRobot = btn.dataset.dispatchTelemetry;
      switchView("fleet-health", getNavTab("fleet-health"));
      refreshFleetHealth().catch(() => {});
    });
  });

  root.querySelectorAll("[data-toggle-resolve]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dispatchUi.expandedResolveId =
        state.dispatchUi.expandedResolveId === btn.dataset.toggleResolve ? null : btn.dataset.toggleResolve;
      renderTechnicianReport();
    });
  });

  root.querySelectorAll("[data-resolve-form]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      resolveWorkOrderOutcome(form.dataset.resolveForm, fd.get("outcome"), fd.get("notes")).catch(() => {});
    });
  });
}

const browserGlobal = typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : {};

browserGlobal.loadDispatchReport = loadDispatchReport;
browserGlobal.loadWorkOrders = loadWorkOrders;
browserGlobal.refreshTechnicianDispatch = refreshTechnicianDispatch;
browserGlobal.renderTechnicianReport = renderTechnicianReport;

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createSafeDispatchUiHelpers,
    renderDispatchCard,
    renderWorkOrderCard,
    renderTechnicianReport
  };
}
