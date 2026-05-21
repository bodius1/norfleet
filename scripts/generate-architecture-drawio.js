/**
 * One-off generator for docs/architecture.drawio (Norfleet).
 * Run: node scripts/generate-architecture-drawio.js
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "docs", "architecture.drawio");

const CARD =
  "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#cbd5e1;fontColor=#111827;fontSize=14;arcSize=8;";
const LANE =
  "swimlane;horizontal=0;startSize=32;fillColor=#e8f4fc;strokeColor=#94a3b8;fontColor=#111827;fontSize=18;childLayout=stackLayout;stackSpacing=12;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=0;marginBottom=0;whiteSpace=wrap;html=1;";
const LEGEND =
  "rounded=1;whiteSpace=wrap;html=1;fillColor=#f8fafc;strokeColor=#94a3b8;fontColor=#111827;fontSize=12;align=left;spacingLeft=10;";
const BADGE =
  "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#94a3b8;fontColor=#111827;fontSize=11;fontStyle=1;align=center;";

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(id, parent, value, style, geom, extra = "") {
  const g = geom.vertex
    ? `<mxGeometry x="${geom.x}" y="${geom.y}" width="${geom.w}" height="${geom.h}" as="geometry"/>`
    : `<mxGeometry relative="1" as="geometry"/>`;
  const v = value ? ` value="${esc(value)}"` : "";
  return `<mxCell id="${id}"${v} style="${style}" vertex="${geom.vertex ? 1 : 0}" edge="${geom.vertex ? 0 : 1}" parent="${parent}"${extra}>${g}</mxCell>`;
}

function edge(id, parent, source, target, color, dashed, points) {
  const dash = dashed ? "dashed=1;" : "";
  const style = `edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=3;strokeColor=${color};endArrow=classic;endFill=1;${dash}exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;`;
  let pts = "";
  if (points && points.length) {
    pts =
      "<mxGeometry relative=\"1\" as=\"geometry\">" +
      points.map((p) => `<mxPoint x="${p.x}" y="${p.y}" as="sourcePoint"/>`).join("") +
      "</mxGeometry>";
    return `<mxCell id="${id}" style="${style}" edge="1" parent="${parent}" source="${source}" target="${target}">${pts}</mxCell>`;
  }
  return `<mxCell id="${id}" style="${style}" edge="1" parent="${parent}" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
}

function page(name, diagramId, body) {
  return `<diagram id="${diagramId}" name="${esc(name)}"><mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1600" pageHeight="1200" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram>`;
}

function buildPage1() {
  let id = 2;
  const n = () => String(id++);
  const cells = [];

  const lanes = [
    { id: n(), x: 40, y: 40, w: 220, h: 520, title: "UI / Entry", fill: "#dbeafe" },
    { id: n(), x: 280, y: 40, w: 240, h: 520, title: "Client Logic", fill: "#dcfce7" },
    { id: n(), x: 540, y: 40, w: 260, h: 520, title: "Backend / API", fill: "#ffedd5" },
    { id: n(), x: 820, y: 40, w: 220, h: 520, title: "Data / Assets", fill: "#fef9c3" },
    { id: n(), x: 1060, y: 40, w: 220, h: 520, title: "AI / External", fill: "#fce7f3" },
    { id: n(), x: 1300, y: 40, w: 200, h: 520, title: "Run / Deploy", fill: "#f1f5f9" }
  ];
  const laneIds = lanes.map((l) => {
    cells.push(
      cell(l.id, "1", l.title, LANE.replace("#e8f4fc", l.fill), { x: l.x, y: l.y, w: l.w, h: l.h, vertex: true })
    );
    return l.id;
  });

  const nodes = [
    [laneIds[0], "robotics_kpi_platform.html\nNav + views shell\nSettings modal\nChart.js CDN", 20, 50, 180, 100],
    [laneIds[1], "webapp.js\nCentral state object\nView switching\nfetch / EventSource", 20, 50, 200, 110],
    [laneIds[1], "Client views\nFleet Builder · KPI Monitor\nAI Agents · Technician Report", 20, 180, 200, 100],
    [laneIds[2], "server.js\nExpress :5050\nCORS + JSON\nStatic + /api/*", 20, 50, 220, 90],
    [laneIds[2], "validation.js\nAI payload guards", 20, 160, 220, 70],
    [laneIds[2], "agentRuntime.js\nAnomaly detect + tools", 20, 250, 220, 80],
    [laneIds[2], "aiProvider.js\ngenerateJson()\nOpenAI / Anthropic / Gemini / mock", 20, 350, 220, 90],
    [laneIds[2], "ragMemory.js\nChunk + mock embed search", 20, 460, 220, 70],
    [laneIds[3], "In-memory stores\nrobots · fleets · fleetHistory\ntickets · feedback · agents", 20, 50, 180, 110],
    [laneIds[3], "knowledge/\nmanuals · sops · notes", 20, 180, 180, 80],
    [laneIds[3], ".env + appSettings\nAPI keys (session)", 20, 280, 180, 80],
    [laneIds[4], "LLM providers\n(OpenAI · Anthropic · Gemini)", 20, 80, 180, 90],
    [laneIds[4], "KPI / Robot APIs\n(Needs verification)", 20, 200, 180, 70],
    [laneIds[5], "npm start\nnode server.js\nlocalhost:5050", 20, 120, 160, 90],
    [laneIds[5], "test/*.test.js\nnode --test", 20, 240, 160, 70]
  ];
  const nodeIds = nodes.map(([parent, label, x, y, w, h]) => {
    const cid = n();
    cells.push(cell(cid, parent, label, CARD, { x, y, w, h, vertex: true }));
    return cid;
  });

  const legendId = n();
  cells.push(
    cell(
      legendId,
      "1",
      "Legend\n①–⑥ Numbered flows on diagram\nSolid = confirmed path · Dashed = optional / BYOK / needs verification\nBlue UI · Green client · Orange API · Gold data · Purple settings/auth · Red/pink AI · Gray deploy\nBYOK = API keys via Settings or .env (not committed)",
      LEGEND,
      { x: 40, y: 600, w: 1460, h: 100, vertex: true }
    )
  );

  const html = nodeIds[0];
  const webapp = nodeIds[1];
  const views = nodeIds[2];
  const server = nodeIds[3];
  const validation = nodeIds[4];
  const agentRt = nodeIds[5];
  const aiProv = nodeIds[6];
  const rag = nodeIds[7];
  const mem = nodeIds[8];
  const kb = nodeIds[9];
  const settings = nodeIds[10];
  const llm = nodeIds[11];
  const extKpi = nodeIds[12];
  const deploy = nodeIds[13];

  const edges = [
    [n(), html, webapp, "#2563eb", false],
    [n(), webapp, server, "#ea580c", false],
    [n(), views, server, "#16a34a", false],
    [n(), server, validation, "#ea580c", false],
    [n(), server, agentRt, "#16a34a", false],
    [n(), server, aiProv, "#16a34a", false],
    [n(), server, rag, "#16a34a", false],
    [n(), rag, kb, "#ca8a04", false],
    [n(), server, mem, "#ca8a04", false],
    [n(), aiProv, llm, "#db2777", false],
    [n(), settings, llm, "#7c3aed", true],
    [n(), server, extKpi, "#db2777", true],
    [n(), deploy, server, "#64748b", false]
  ];
  edges.forEach(([eid, s, t, color, dashed]) => cells.push(edge(eid, "1", s, t, color, dashed)));

  return page("Architecture Overview", "p1", cells.join(""));
}

function buildPage2() {
  let id = 2;
  const n = () => String(id++);
  const cells = [];

  const lanes = [
    { title: "User / UI", x: 40, fill: "#dbeafe" },
    { title: "webapp.js", x: 300, fill: "#dcfce7" },
    { title: "server.js APIs", x: 580, fill: "#ffedd5" },
    { title: "AI pipeline", x: 860, fill: "#fce7f3" },
    { title: "State touched", x: 1140, fill: "#f3e8ff" }
  ].map((l) => {
    const lid = n();
    cells.push(cell(lid, "1", l.title, LANE.replace("#e8f4fc", l.fill), { x: l.x, y: 40, w: 230, h: 700, vertex: true }));
    return lid;
  });

  const add = (lane, text, y, h = 88) => {
    const cid = n();
    cells.push(cell(cid, lane, text, CARD, { x: 16, y, w: 198, h, vertex: true }));
    return cid;
  };

  const u1 = add(lanes[0], "AI Agents tab\nAgentic AI Builder subview\nWorkflow nodes + permissions", 48, 100);
  const u2 = add(lanes[0], "Technician Report\nGenerate / Apply actions\nFeedback save", 170, 95);
  const u3 = add(lanes[0], "KPI Monitor\nDetect KPIs · Analyze with AI", 290, 85);

  const w1 = add(lanes[1], "agentBuilderConfig\nagents · workflowOrder\ndashboardMetrics", 48, 100);
  const w2 = add(lanes[1], "switchAgentSubView()\nrenderAgentBuilder()\napplyTechnicianAction()", 170, 100);
  const w3 = add(lanes[1], "runAiAnalyzeKpis()\nrunAiTechnicianReport()\nrunAiRecommendUpdates()", 290, 100);
  const w4 = add(lanes[1], "api() + x-norfleet-admin-token\nlocalStorage settings", 410, 85);

  const s1 = add(lanes[2], "POST /api/ai/analyze-kpis", 48, 75);
  const s2 = add(lanes[2], "POST /api/ai/generate-technician-report", 140, 75);
  const s3 = add(lanes[2], "POST /api/ai/recommend-agent-updates", 232, 75);
  const s4 = add(lanes[2], "POST /api/ai/feedback", 324, 70);
  const s5 = add(lanes[2], "GET /api/stream (SSE)\nGET /api/fleets/:id/metrics", 410, 85);

  const a1 = add(lanes[3], "detectKpiAnomalies()\ndeterministic thresholds", 48, 85);
  const a2 = add(lanes[3], "ragMemory.retrieve…\nknowledge context", 150, 80);
  const a3 = add(lanes[3], "aiProvider.generateJson\nmock fallback schemas", 250, 85);
  const a4 = add(lanes[3], "runtimeTools.saveTechnicianFeedback", 350, 75);

  const t1 = add(lanes[4], "state.agentBuilderConfig\n(agentChangeLog)", 48, 90);
  const t2 = add(lanes[4], "state.technicianReport\n+ feedback history", 160, 85);
  const t3 = add(lanes[4], "Server: activeAgentsRuntime\ntechnicianFeedbackHistory", 270, 95);
  const t4 = add(lanes[4], "Files likely to change:\nwebapp.js · server.js\nagentRuntime · HTML builder CSS", 390, 110);

  cells.push(
    cell(
      n(),
      "1",
      "Feature focus: Agentic AI Builder + AI maintenance loop (inferred from open file: builder checkbox CSS in robotics_kpi_platform.html ~L1517)\nLegend: solid = main flow · dashed = approval-gated / optional",
      LEGEND,
      { x: 40, y: 760, w: 1380, h: 80, vertex: true }
    )
  );

  [
    [n(), u3, w3, "#2563eb", false],
    [n(), u2, w2, "#2563eb", false],
    [n(), u1, w1, "#2563eb", false],
    [n(), w3, s1, "#16a34a", false],
    [n(), w3, s2, "#16a34a", false],
    [n(), w2, s3, "#16a34a", true],
    [n(), w2, s4, "#16a34a", false],
    [n(), s1, a1, "#ea580c", false],
    [n(), s1, a2, "#ea580c", false],
    [n(), s2, a3, "#ea580c", false],
    [n(), s3, a3, "#ea580c", false],
    [n(), s4, a4, "#ea580c", false],
    [n(), w1, t1, "#7c3aed", false],
    [n(), w2, t1, "#7c3aed", false],
    [n(), w2, t2, "#7c3aed", false],
    [n(), a4, t3, "#ca8a04", false],
    [n(), w4, s1, "#16a34a", false]
  ].forEach(([eid, s, t, color, dashed]) => cells.push(edge(eid, "1", s, t, color, dashed)));

  return page("Feature Deep Dive — Agentic AI Builder", "p2", cells.join(""));
}

function buildPage3() {
  let id = 2;
  const n = () => String(id++);
  const cells = [];

  const laneId = n();
  cells.push(cell(laneId, "1", "Bug impact zones", LANE.replace("#e8f4fc", "#fee2e2"), { x: 40, y: 40, w: 1500, h: 680, vertex: true }));

  const zones = [
    [
      "Symptom: KPI charts empty / stale",
      "Look: webapp.js startStream()\n/api/stream · fleetHistory",
      "State: state.latestSeries\nstate.selectedFleetId",
      "Tests: manual KPI Monitor",
      "Root: server.js SSE · wrong fleetId"
    ],
    [
      "Symptom: AI always mock / no LLM",
      "Look: aiProvider.js resolveProviderAuth\nSettings · .env keys",
      "State: appSettings.ai\nstate.settings",
      "Tests: POST /api/settings/test-connection",
      "Root: mockMode · missing API key"
    ],
    [
      "Symptom: Technician actions don't apply",
      "Look: applyTechnicianAction()\nagentBuilderConfig mutations",
      "State: technicianReport.actionStatus",
      "Tests: webapp flow B in README",
      "Root: action kind mapping · approval flags"
    ],
    [
      "Symptom: 401 on settings/tools",
      "Look: requireAdminIfConfigured\nx-norfleet-admin-token header",
      "State: localStorage admin token",
      "Tests: Needs verification",
      "Root: NORFLEET_ADMIN_TOKEN mismatch"
    ],
    [
      "Symptom: Anomalies missing / wrong",
      "Look: detectKpiAnomalies()\nvalidateAnalyzeKpisInput",
      "State: kpiHistory payload from client",
      "Tests: test/agentRuntime.test.js",
      "Root: thresholds vs series shape"
    ],
    [
      "Symptom: RAG context irrelevant",
      "Look: ragMemory.js · knowledge/",
      "State: filesystem KB only",
      "Tests: GET /api/tools/maintenance-knowledge",
      "Root: mock embed scoring"
    ],
    [
      "Symptom: Builder UI misaligned",
      "Look: robotics_kpi_platform.html\nbuilder-* / nf-checkbox CSS",
      "State: DOM only (no server)",
      "Tests: visual Agentic AI Builder",
      "Root: CSS grid/checkbox rules"
    ],
    [
      "Symptom: Fleet seed missing",
      "Look: seedExampleFleet()",
      "State: in-memory robots/fleets",
      "Tests: GET /api/fleets",
      "Root: server restart clears data"
    ]
  ];

  let y = 50;
  const zoneIds = zones.map((z) => {
    const cid = n();
    cells.push(
      cell(
        cid,
        laneId,
        z.join("\n"),
        CARD,
        { x: 24, y, w: 1450, h: 72, vertex: true }
      )
    );
    y += 82;
    return cid;
  });

  cells.push(
    cell(
      n(),
      "1",
      "When X breaks → check Y first (summary)\nCharts/SSE → webapp startStream + server /api/stream\nAI mock → Settings + aiProvider + .env\nActions stuck → applyTechnicianAction + agentBuilderConfig\n401 → admin token header vs NORFLEET_ADMIN_TOKEN\nBad anomalies → agentRuntime detect + validation tests\nWeak RAG → ragMemory + knowledge files\nBuilder layout → HTML/CSS builder section\nEmpty fleet → seedExampleFleet + POST /api/fleets",
      LEGEND,
      { x: 40, y: 740, w: 1500, h: 110, vertex: true }
    )
  );

  return page("Bug Impact Map", "p3", cells.join(""));
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="norfleet-arch-gen" version="22.1.0" type="device">
${buildPage1()}
${buildPage2()}
${buildPage3()}
</mxfile>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, xml, "utf8");
console.log("Wrote", OUT);
