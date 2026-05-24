/** Technician Dispatch UI — Phase 1 dispatch-first surface (loaded after webapp.js). */

async function loadDispatchReport() {
  const report = await api("/api/technician/dispatch-report");
  state.dispatchReport = report;
  if (!state.selectedDispatchId && report.dispatches?.length) {
    state.selectedDispatchId = report.dispatches[0].dispatchId;
  }
  return report;
}

async function dispatchWorkflowAction(dispatchId, action, extra = {}) {
  const res = await api(`/api/dispatch/${encodeURIComponent(dispatchId)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(extra)
  });
  await loadDispatchReport();
  renderTechnicianReport();
  showToast("◇", `Dispatch ${action.replace("-", " ")}.`);
  return res;
}

async function submitDispatchFeedback(dispatchId, payload) {
  const res = await api(`/api/dispatch/${encodeURIComponent(dispatchId)}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (res.calibration) state.calibration = res.calibration;
  await loadDispatchReport();
  renderTechnicianReport();
  showToast("◇", "Feedback saved — calibration updated.");
  return res;
}

function renderTechnicianReport() {
  const root = byId("technician-report-root");
  if (!root) return;
  const report = state.dispatchReport;
  const sum = report?.summary || {
    criticalCount: 0,
    highCount: 0,
    mediumCount: 0,
    lowCount: 0,
    approvalRequiredCount: 0,
    technicianDispatchCount: 0
  };
  const dispatches = report?.dispatches || [];
  const adminUpdates = report?.adminUpdates || [];
  const emptyState =
    report?.emptyState || "No predicted failures ready. Run telemetry analysis or check Fleet Health.";
  const selected = dispatches.find((d) => d.dispatchId === state.selectedDispatchId) || dispatches[0] || null;

  const summaryHtml = `
    <div class="td-summary-strip">
      <div class="td-summary-stat"><span class="val critical">${sum.criticalCount || 0}</span><span class="lbl">Critical</span></div>
      <div class="td-summary-stat"><span class="val high">${sum.highCount || 0}</span><span class="lbl">High</span></div>
      <div class="td-summary-stat"><span class="val">${sum.mediumCount || 0}</span><span class="lbl">Medium</span></div>
      <div class="td-summary-stat"><span class="val">${formatHours(sum.earliestFailureHours)}</span><span class="lbl">Earliest failure${sum.earliestFailureRobotId ? ` (${safeText(sum.earliestFailureRobotId)})` : ""}</span></div>
      <div class="td-summary-stat"><span class="val">${sum.approvalRequiredCount || 0}</span><span class="lbl">Approval required</span></div>
    </div>`;

  const dispatchCards = dispatches.length
    ? dispatches
        .map((d) => {
          const mode = safeText(d.prediction?.failureMode, "unknown").replace(/_/g, " ");
          const ttf = formatHours(d.prediction?.estimatedTimeToFailureHours);
          const why =
            (d.evidence?.signals || [])
              .slice(0, 3)
              .map((s) => `${formatSignalName(s.name)} ${safeText(s.direction, "flat")}`)
              .join(" · ") || safeText(d.prediction?.reason, "See evidence below");
          const steps = (d.recommendedAction?.steps || []).slice(0, 6);
          const evidenceLines = (d.evidence?.signals || [])
            .map(
              (s) =>
                `<li>${escapeHtml(formatSignalName(s.name))} ${escapeHtml(safeText(s.direction))} — ${escapeHtml(safeText(s.reason))}</li>`
            )
            .join("");
          const selectedClass = selected?.dispatchId === d.dispatchId ? " td-dispatch-card--selected" : "";
          return `
          <article class="td-dispatch-card${selectedClass}" data-dispatch-id="${escapeHtml(d.dispatchId)}">
            <header class="td-dispatch-head">
              <span class="${tdPriorityClass(d.priority)}">${escapeHtml(safeText(d.priority, "medium"))}</span>
              <div>
                <strong>${escapeHtml(safeText(d.robot?.robotName))}</strong>
                <span class="muted">${escapeHtml(safeText(d.robot?.robotId))} · Zone ${escapeHtml(safeText(d.robot?.zone))} · ${escapeHtml(safeText(d.robot?.status))}</span>
              </div>
            </header>
            <h4 class="td-dispatch-title">Predicted ${escapeHtml(mode)} in ${escapeHtml(ttf)}</h4>
            <div class="td-dispatch-metrics">
              <span>Confidence ${escapeHtml(formatPercent(d.prediction?.confidence))}</span>
              <span>Probability ${escapeHtml(formatPercent(d.prediction?.failureProbability))}</span>
              <span>Health index ${escapeHtml(formatPercent(d.prediction?.healthIndex))}</span>
              <span class="td-status-pill">${escapeHtml(safeText(d.workflow?.status, "new"))}</span>
            </div>
            <div class="td-dispatch-why">
              <strong>Why Norfleet thinks this:</strong>
              <p>${escapeHtml(why)}</p>
              ${evidenceLines ? `<ul class="td-evidence-list">${evidenceLines}</ul>` : ""}
            </div>
            <div class="td-dispatch-do">
              <strong>Do now:</strong>
              <p>${escapeHtml(safeText(d.recommendedAction?.summary))}</p>
              <ol>${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
            </div>
            <footer class="td-dispatch-actions">
              <button type="button" class="tr-btn-ghost" data-dispatch-action="acknowledge" data-id="${escapeHtml(d.dispatchId)}">Acknowledge</button>
              <button type="button" class="tr-btn-ghost" data-dispatch-action="defer" data-id="${escapeHtml(d.dispatchId)}">Defer</button>
              <button type="button" class="tr-btn-primary" data-dispatch-action="resolve" data-id="${escapeHtml(d.dispatchId)}">Resolve</button>
              <button type="button" class="tr-btn-ghost" data-dispatch-action="false-alarm" data-id="${escapeHtml(d.dispatchId)}">False alarm</button>
              <button type="button" class="tr-btn-ghost" data-dispatch-telemetry="${escapeHtml(d.robot?.robotId)}">View telemetry</button>
            </footer>
          </article>`;
        })
        .join("")
    : `<p class="muted td-empty">${escapeHtml(emptyState)}</p>`;

  const adminHtml = adminUpdates.length
    ? adminUpdates
        .map(
          (u) => `
        <div class="td-admin-card">
          <span class="td-admin-badge">Automation / rules</span>
          <h4>${escapeHtml(safeText(u.title))}</h4>
          <p>${escapeHtml(safeText(u.summary))}</p>
        </div>`
        )
        .join("")
    : `<p class="muted">No automation updates suggested right now.</p>`;

  const feedbackHtml = selected
    ? `
    <form class="td-feedback-form" id="td-feedback-form">
      <input type="hidden" name="dispatchId" value="${escapeHtml(selected.dispatchId)}" />
      <input type="hidden" name="robotId" value="${escapeHtml(selected.robot?.robotId)}" />
      <input type="hidden" name="failureMode" value="${escapeHtml(selected.prediction?.failureMode)}" />
      <input type="hidden" name="predictionId" value="${escapeHtml(selected.prediction?.predictionId || "")}" />
      <label>Outcome
        <select name="outcome" required>
          <option value="confirmed_failure">Confirmed failure</option>
          <option value="fixed_early">Fixed early</option>
          <option value="false_alarm">False alarm</option>
          <option value="not_enough_evidence">Not enough evidence</option>
        </select>
      </label>
      <label>Action taken<textarea name="actionTaken" rows="2" placeholder="What did you do on the floor?"></textarea></label>
      <label>Actual cause<input name="actualCause" type="text" placeholder="Root cause if known" /></label>
      <label>Repair minutes<input name="repairMinutes" type="number" min="0" step="1" placeholder="30" /></label>
      <label>Notes<textarea name="notes" rows="2"></textarea></label>
      <button type="submit" class="tr-btn-primary">Save feedback</button>
    </form>`
    : `<p class="muted">Select a dispatch above to record repair outcome.</p>`;

  const devMetaHtml = report?.modelInfo
    ? `Provider: ${escapeHtml(safeText(report.modelInfo.provider))} · Model: ${escapeHtml(safeText(report.modelInfo.model))} · Backend: ${escapeHtml(safeText(report.modelInfo.persistenceBackend || state.persistenceBackend))}`
    : `Provider: ${escapeHtml(displayAiProviderName(state.aiUsage.provider))} · Model: ${escapeHtml(displayAiModelForUi(state.aiUsage.provider, state.aiUsage.model))}`;

  root.innerHTML = `
    <header class="tr-intro">
      <h2>Technician Dispatch</h2>
      <p class="muted">Predicted robot failures and repair actions ranked by urgency.</p>
    </header>

    <section class="tr-block">
      <div class="tr-block-head">
        <h3 class="tr-section-title">Summary</h3>
        <button type="button" class="tr-btn-primary" id="td-refresh-btn">Refresh dispatch</button>
      </div>
      ${summaryHtml}
    </section>

    <section class="tr-block">
      <h3 class="tr-section-title">Priority dispatch queue</h3>
      <p class="muted" style="margin:6px 0 12px;font-size:12px">Robots ranked by urgency — inspect highest priority first.</p>
      <div class="td-dispatch-queue">${dispatchCards}</div>
    </section>

    <section class="tr-block td-admin-section">
      <h3 class="tr-section-title">Admin updates suggested</h3>
      <p class="muted" style="margin:6px 0 12px;font-size:12px">Agent, threshold, and automation changes — not technician repair tasks.</p>
      <div class="td-admin-grid">${adminHtml}</div>
    </section>

    <section class="tr-block">
      <h3 class="tr-section-title">Close the loop</h3>
      <p class="muted" style="margin:6px 0 12px;font-size:12px">Tell Norfleet whether the prediction was right — this improves calibration.</p>
      ${feedbackHtml}
    </section>

    <details class="tr-dev-details tr-block">
      <summary>Demo / Dev Tools</summary>
      <div class="td-dev-tools">
        <button type="button" class="tr-btn-ghost" id="td-replay-btn">Fast-forward simulation 60×</button>
        <button type="button" class="tr-btn-ghost" id="td-reset-demo-btn">Reset demo (refresh)</button>
        <button type="button" class="tr-btn-ghost" id="td-refresh-pred-btn">Refresh predictions</button>
      </div>
      <details style="margin-top:10px">
        <summary>Model trace / developer info</summary>
        <p class="tr-dev-meta">${devMetaHtml}</p>
      </details>
    </details>
  `;

  root.querySelectorAll("[data-dispatch-action]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      dispatchWorkflowAction(btn.dataset.id, btn.dataset.dispatchAction, { technicianId: "technician" }).catch((err) =>
        showToast("⚠", err.message)
      );
    };
  });
  root.querySelectorAll("[data-dispatch-telemetry]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      state.fleetHealthFocusRobot = btn.dataset.dispatchTelemetry;
      switchView("fleet-health", getNavTab("fleet-health"));
      refreshFleetHealth().catch(() => {});
    };
  });
  root.querySelectorAll(".td-dispatch-card").forEach((card) => {
    card.onclick = (e) => {
      if (e.target.closest("button")) return;
      state.selectedDispatchId = card.dataset.dispatchId;
      renderTechnicianReport();
    };
  });

  const refreshBtn = byId("td-refresh-btn");
  if (refreshBtn) {
    refreshBtn.onclick = () =>
      loadDispatchReport()
        .then(() => renderTechnicianReport())
        .catch((e) => showToast("⚠", e.message));
  }
  const replayBtn = byId("td-replay-btn");
  if (replayBtn) replayBtn.onclick = () => runSimReplay(60).catch((e) => showToast("⚠", e.message));
  const resetBtn = byId("td-reset-demo-btn");
  if (resetBtn) {
    resetBtn.onclick = () =>
      refreshFleetHealth()
        .then(() => loadDispatchReport())
        .then(() => renderTechnicianReport())
        .catch((e) => showToast("⚠", e.message));
  }
  const predBtn = byId("td-refresh-pred-btn");
  if (predBtn) {
    predBtn.onclick = () =>
      refreshPredictions()
        .then(() => loadDispatchReport())
        .then(() => renderTechnicianReport())
        .catch((e) => showToast("⚠", e.message));
  }

  const fbForm = byId("td-feedback-form");
  if (fbForm) {
    fbForm.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(fbForm);
      submitDispatchFeedback(fd.get("dispatchId"), {
        outcome: fd.get("outcome"),
        robotId: fd.get("robotId"),
        failureMode: fd.get("failureMode"),
        predictionId: fd.get("predictionId") || undefined,
        actionTaken: fd.get("actionTaken"),
        actualCause: fd.get("actualCause"),
        repairMinutes: fd.get("repairMinutes") ? Number(fd.get("repairMinutes")) : undefined,
        notes: fd.get("notes"),
        technicianId: "technician"
      }).catch((err) => showToast("⚠", err.message));
    };
  }
}

window.loadDispatchReport = loadDispatchReport;
