/**
 * Knowledge retrieval and outcome capture — sole module that reads/writes knowledge/ files.
 *
 * Read path:  toolExecutor (retrieveMaintenanceKnowledge) → ragMemory → knowledge/
 * Write path: toolExecutor (saveTechnicianFeedback / captureRepairOutcome) → ragMemory → knowledge/
 */
const fs = require("fs");
const path = require("path");

const KB_ROOT = path.join(__dirname, "knowledge");
const KB_DIRS = ["robot_manuals", "sops", "maintenance_notes"];
const OUTCOMES_DIR = path.join(KB_ROOT, "maintenance_notes");

function loadKnowledgeDocs() {
  const docs = [];
  KB_DIRS.forEach((dir) => {
    const full = path.join(KB_ROOT, dir);
    if (!fs.existsSync(full)) return;
    const names = fs.readdirSync(full);
    names.forEach((name) => {
      const filePath = path.join(full, name);
      if (!fs.statSync(filePath).isFile()) return;
      const text = fs.readFileSync(filePath, "utf8");
      docs.push({ id: `${dir}/${name}`, source: dir, text });
    });
  });
  return docs;
}

function chunkDocuments(docs, chunkSize = 380, overlap = 60) {
  const chunks = [];
  docs.forEach((doc) => {
    const words = String(doc.text || "").split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += Math.max(1, chunkSize - overlap)) {
      const w = words.slice(i, i + chunkSize);
      if (!w.length) continue;
      chunks.push({
        chunkId: `${doc.id}#${i}`,
        docId: doc.id,
        source: doc.source,
        text: w.join(" ")
      });
    }
  });
  return chunks;
}

function embedOrMockEmbed(text) {
  const tokens = String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const vec = {};
  tokens.forEach((t) => {
    vec[t] = (vec[t] || 0) + 1;
  });
  return vec;
}

function cosineLike(a, b) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  Object.entries(a).forEach(([k, v]) => {
    magA += v * v;
    if (b[k]) dot += v * b[k];
  });
  Object.values(b).forEach((v) => {
    magB += v * v;
  });
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function semanticSearch(query, chunks, topK = 4) {
  const q = embedOrMockEmbed(query);
  return chunks
    .map((c) => ({ ...c, score: cosineLike(q, embedOrMockEmbed(c.text)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function retrieveRelevantContext(query, robotId, issueType, topK = 4) {
  const docs = loadKnowledgeDocs();
  const chunks = chunkDocuments(docs);
  const searchQ = [query, robotId, issueType].filter(Boolean).join(" ");
  return semanticSearch(searchQ, chunks, topK).map((x) => ({
    chunkId: x.chunkId,
    source: x.source,
    score: Number(x.score.toFixed(3)),
    text: x.text.slice(0, 550)
  }));
}

function captureRepairOutcome(outcome = {}) {
  if (!fs.existsSync(OUTCOMES_DIR)) {
    fs.mkdirSync(OUTCOMES_DIR, { recursive: true });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `captured-outcome-${stamp}.txt`;
  const filePath = path.join(OUTCOMES_DIR, fileName);
  const lines = [
    `Captured: ${new Date().toISOString()}`,
    `Action: ${outcome.actionId || "n/a"}`,
    `Fix worked: ${Boolean(outcome.fixWorked)}`,
    `Feedback: ${outcome.technicianFeedback || ""}`,
    `Before/after KPI: ${JSON.stringify(outcome.beforeAfter || {})}`
  ];
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  return { saved: true, path: `maintenance_notes/${fileName}` };
}

module.exports = {
  chunkDocuments,
  embedOrMockEmbed,
  semanticSearch,
  retrieveRelevantContext,
  captureRepairOutcome
};
