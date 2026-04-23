const state = {
  robots: [],
  fleets: [],
  selectedRobotIds: new Set(),
  selectedFleetId: null,
  charts: {},
  stream: null
};

const byId = (id) => document.getElementById(id);

function switchView(id, tabEl) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
  const view = byId(`view-${id}`);
  if (view) view.classList.add("active");
  if (tabEl) tabEl.classList.add("active");
  if (id === "monitor") {
    if (!state.fleets.length) {
      showToast("⚠", "Create a fleet in Fleet Builder first.");
      return;
    }
    if (!state.selectedFleetId) state.selectedFleetId = state.fleets[0].id;
    syncFleetDropdowns();
    loadMetricsAndStream().catch((err) => showToast("⚠", err.message));
  }
}

function showToast(icon, msg) {
  const t = byId("toast");
  if (!t) return;
  byId("toast-icon").textContent = icon;
  byId("toast-msg").textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}

function updateClock() {
  const el = byId("live-clock");
  if (el) el.textContent = new Date().toLocaleTimeString("en-US", { hour12: false }) + " UTC";
}

function updateChips(summary) {
  const a = byId("chip-active");
  const i = byId("chip-idle");
  const c = byId("chip-charging");
  if (a) a.textContent = `${summary.active} Active`;
  if (i) i.textContent = `${summary.idle} Idle`;
  if (c) c.textContent = `${summary.charging} Charging`;
}

async function api(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function syncFleetDropdowns() {
  const a = byId("fleet-select");
  const b = byId("fleet-select-monitor");
  if (!a || !b) return;
  const validIds = new Set(state.fleets.map((f) => f.id));
  if (state.selectedFleetId && !validIds.has(state.selectedFleetId)) {
    state.selectedFleetId = state.fleets[0]?.id ?? null;
  }
  [a, b].forEach((sel) => {
    sel.innerHTML = "";
    state.fleets.forEach((fleet) => {
      const option = document.createElement("option");
      option.value = fleet.id;
      option.textContent = `${fleet.name} (${fleet.summary?.total ?? 0} robots)`;
      sel.appendChild(option);
    });
    if (state.selectedFleetId) sel.value = state.selectedFleetId;
  });
  a.onchange = (e) => {
    state.selectedFleetId = e.target.value;
    b.value = state.selectedFleetId;
  };
  b.onchange = (e) => {
    state.selectedFleetId = e.target.value;
    a.value = state.selectedFleetId;
    loadMetricsAndStream().catch((err) => showToast("⚠", err.message));
  };
}

function renderRobots() {
  const robotsList = byId("robots-list");
  const selector = byId("fleet-robot-select");
  if (!robotsList || !selector) return;
  robotsList.innerHTML = "";
  selector.innerHTML = "";

  if (state.robots.length === 0) {
    robotsList.innerHTML = '<div class="list-item muted">No robots yet. Add one above.</div>';
    selector.innerHTML = '<div class="list-item muted">Add robots to assign them to a fleet.</div>';
    return;
  }

  state.robots.forEach((robot) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `<span>${robot.id} · ${robot.name} · ${robot.model} <span style="color:var(--text3)">Z${robot.warehouseZone}</span></span><span style="color:var(--accent3)">${robot.status}</span>`;
    robotsList.appendChild(row);

    const wrap = document.createElement("label");
    wrap.className = "list-item";
    wrap.style.cursor = "pointer";
    const checked = state.selectedRobotIds.has(robot.id);
    wrap.innerHTML = `<span>${robot.id} · ${robot.name}</span><input type="checkbox" ${checked ? "checked" : ""} />`;
    wrap.querySelector("input").onchange = (e) => {
      if (e.target.checked) state.selectedRobotIds.add(robot.id);
      else state.selectedRobotIds.delete(robot.id);
    };
    selector.appendChild(wrap);
  });
}

function renderFleets() {
  syncFleetDropdowns();
  if (state.fleets.length && !state.selectedFleetId) {
    state.selectedFleetId = state.fleets[0].id;
    syncFleetDropdowns();
  }
}

function renderKpis(kpis) {
  const kpiList = byId("kpi-list");
  if (!kpiList) return;
  kpiList.innerHTML = "";
  if (!kpis || kpis.length === 0) {
    kpiList.innerHTML = '<span class="muted">No KPIs yet — run AI detection for the selected fleet.</span>';
    return;
  }
  kpis.forEach((kpi) => {
    const tag = document.createElement("div");
    tag.className = "kpi-tag";
    tag.textContent = kpi;
    kpiList.appendChild(tag);
  });
}

function upsertChart(kpi, values) {
  const chartsWrap = byId("charts");
  if (!chartsWrap || !window.Chart) return;
  if (!state.charts[kpi]) {
    const card = document.createElement("div");
    card.className = "chart-card";
    const safeId = kpi.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
    card.innerHTML = `<div class="chart-title">${kpi}</div><canvas id="chart-${safeId}" height="190"></canvas>`;
    chartsWrap.appendChild(card);
    const canvas = card.querySelector("canvas");
    state.charts[kpi] = new Chart(canvas, {
      type: "line",
      data: {
        labels: values.map((_, idx) => idx + 1),
        datasets: [
          {
            label: kpi,
            data: values,
            borderColor: "#00e5ff",
            backgroundColor: "rgba(0,229,255,0.08)",
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { display: true, ticks: { color: "#64748b", maxTicksLimit: 8 }, grid: { color: "rgba(255,255,255,0.05)" } },
          y: { display: true, ticks: { color: "#64748b" }, grid: { color: "rgba(255,255,255,0.05)" } }
        }
      }
    });
  } else {
    const chart = state.charts[kpi];
    chart.data.labels = values.map((_, idx) => idx + 1);
    chart.data.datasets[0].data = values;
    chart.update();
  }
}

function syncCharts(series) {
  if (!series) return;
  Object.entries(series).forEach(([kpi, values]) => upsertChart(kpi, values));
}

function updateSummary(summary) {
  if (!summary) return;
  const total = byId("sum-total");
  const active = byId("sum-active");
  const idle = byId("sum-idle");
  const charging = byId("sum-charging");
  if (total) total.textContent = summary.total;
  if (active) active.textContent = summary.active;
  if (idle) idle.textContent = summary.idle;
  if (charging) charging.textContent = summary.charging;
  updateChips(summary);
}

async function loadInitial() {
  state.robots = await api("/api/robots");
  state.fleets = await api("/api/fleets");
  renderRobots();
  renderFleets();
}

async function addRobot() {
  const name = byId("robot-name").value.trim();
  const model = byId("robot-model").value;
  const warehouseZone = byId("robot-zone").value.trim();
  const taskProfile = byId("robot-task").value.trim();
  if (!name || !warehouseZone) {
    showToast("⬡", "Name and zone are required.");
    return;
  }
  try {
    await api("/api/robots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, model, warehouseZone, taskProfile })
    });
    byId("robot-name").value = "";
    byId("robot-zone").value = "";
    byId("robot-task").value = "";
    state.robots = await api("/api/robots");
    renderRobots();
    showToast("⬡", "Robot added.");
  } catch (err) {
    showToast("⚠", err.message);
  }
}

async function createFleet() {
  const name = byId("fleet-name").value.trim();
  if (!name || state.selectedRobotIds.size === 0) {
    showToast("◈", "Fleet name and at least one robot are required.");
    return;
  }
  try {
    await api("/api/fleets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, robotIds: Array.from(state.selectedRobotIds) })
    });
    byId("fleet-name").value = "";
    state.selectedRobotIds.clear();
    state.fleets = await api("/api/fleets");
    state.selectedFleetId = state.fleets[state.fleets.length - 1]?.id || null;
    renderFleets();
    renderRobots();
    showToast("◈", "Fleet created.");
  } catch (err) {
    showToast("⚠", err.message);
  }
}

async function detectKpisForFleet() {
  if (!state.selectedFleetId) {
    showToast("⚠", "Create a fleet first.");
    return;
  }
  const status = byId("status");
  if (status) status.textContent = "Detecting KPIs with AI…";
  try {
    const data = await api(`/api/fleets/${state.selectedFleetId}/detect-kpis`, { method: "POST" });
    renderKpis(data.kpis);
    if (status) status.textContent = "KPIs ready. Streaming live metrics.";
    await loadMetricsAndStream();
    showToast("◈", `Detected ${data.kpis.length} KPI(s).`);
  } catch (err) {
    if (status) status.textContent = err.message;
    showToast("⚠", err.message);
  }
}

async function loadMetricsAndStream() {
  if (!state.selectedFleetId) return;
  const metrics = await api(`/api/fleets/${state.selectedFleetId}/metrics`);
  renderKpis(metrics.kpis);
  syncCharts(metrics.series);

  const selected = state.fleets.find((f) => f.id === state.selectedFleetId);
  if (selected?.summary) updateSummary(selected.summary);

  if (state.stream) state.stream.close();
  state.stream = new EventSource(`/api/stream?fleetId=${encodeURIComponent(state.selectedFleetId)}`);
  state.stream.onmessage = (event) => {
    const data = JSON.parse(event.data);
    renderKpis(data.kpis);
    syncCharts(data.series);
    updateSummary(data.summary);
  };
  state.stream.onerror = () => {
    showToast("⚠", "Live stream interrupted. Reconnecting…");
    state.stream.close();
    setTimeout(() => loadMetricsAndStream().catch(() => {}), 2000);
  };
}

function bindEvents() {
  byId("add-robot-btn").onclick = () => addRobot().catch((e) => showToast("⚠", e.message));
  byId("create-fleet-btn").onclick = () => createFleet().catch((e) => showToast("⚠", e.message));
  byId("detect-kpis-btn").onclick = () => detectKpisForFleet().catch((e) => showToast("⚠", e.message));
}

window.switchView = switchView;

setInterval(updateClock, 1000);
updateClock();
bindEvents();
loadInitial()
  .then(() => {
    if (state.selectedFleetId) {
      return loadMetricsAndStream().catch(() => {});
    }
  })
  .catch((err) => showToast("⚠", `Load failed: ${err.message}`));
