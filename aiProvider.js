const OpenAI = require("openai");

const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-latest",
  gemini: "gemini-1.5-pro",
  mock: "mock-norfleet-v1"
};

function estimateTokensFromText(text) {
  return Math.ceil((String(text || "").length || 0) / 4);
}

function makeMeta({ provider, model, promptText, outputText, startedAt, usage }) {
  const promptTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? estimateTokensFromText(promptText);
  const completionTokens = usage?.completion_tokens ?? usage?.output_tokens ?? estimateTokensFromText(outputText);
  const estimatedTokens = Number(promptTokens) + Number(completionTokens);
  const costEstimate = ((estimatedTokens / 1000) * 0.002).toFixed(4);
  return {
    provider,
    model,
    estimatedTokens,
    promptTokensEstimate: Number(promptTokens),
    completionTokensEstimate: Number(completionTokens),
    costEstimate: `$${costEstimate}`,
    latencyMs: Date.now() - startedAt
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || "").match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function wrapPrompt({ role, task, data, constraints, outputSchema, examples }) {
  return [
    `Role/persona: ${role}`,
    `Task: ${task}`,
    `Available data: ${JSON.stringify(data || {}, null, 2)}`,
    `Constraints: ${JSON.stringify(constraints || [], null, 2)}`,
    `Required JSON schema: ${JSON.stringify(outputSchema || {}, null, 2)}`,
    `Examples: ${JSON.stringify(examples || [], null, 2)}`,
    "Safety rules: output valid JSON only, no markdown, no prose outside JSON."
  ].join("\n\n");
}

function makeMockResult(schemaFallback, provider, model, promptText, startedAt) {
  const text = JSON.stringify(schemaFallback);
  return { data: schemaFallback, meta: makeMeta({ provider, model, promptText, outputText: text, startedAt }) };
}

async function callOpenAI({ apiKey, model, promptText, schemaFallback }) {
  const startedAt = Date.now();
  const client = new OpenAI({ apiKey });
  const resp = await client.chat.completions.create({
    model: model || DEFAULT_MODELS.openai,
    messages: [
      { role: "system", content: "You are Norfleet AI runtime. Return valid JSON only." },
      { role: "user", content: promptText }
    ],
    temperature: 0.2
  });
  const text = resp.choices?.[0]?.message?.content || "{}";
  const parsed = safeJsonParse(text) || schemaFallback;
  const meta = makeMeta({
    provider: "openai",
    model: model || DEFAULT_MODELS.openai,
    promptText,
    outputText: text,
    startedAt,
    usage: resp.usage
  });
  return { data: parsed, meta };
}

async function callAnthropic({ apiKey, model, promptText, schemaFallback }) {
  const startedAt = Date.now();
  const selectedModel = model || DEFAULT_MODELS.anthropic;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: selectedModel,
      max_tokens: 1200,
      temperature: 0.2,
      messages: [{ role: "user", content: promptText }]
    })
  });
  if (!resp.ok) throw new Error(`Anthropic error: HTTP ${resp.status}`);
  const body = await resp.json();
  const text = body?.content?.[0]?.text || "{}";
  const parsed = safeJsonParse(text) || schemaFallback;
  const meta = makeMeta({
    provider: "anthropic",
    model: selectedModel,
    promptText,
    outputText: text,
    startedAt,
    usage: body.usage
  });
  return { data: parsed, meta };
}

async function callGemini({ apiKey, model, promptText, schemaFallback }) {
  const startedAt = Date.now();
  const selectedModel = model || DEFAULT_MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      contents: [{ role: "user", parts: [{ text: promptText }] }]
    })
  });
  if (!resp.ok) throw new Error(`Gemini error: HTTP ${resp.status}`);
  const body = await resp.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const parsed = safeJsonParse(text) || schemaFallback;
  const meta = makeMeta({
    provider: "gemini",
    model: selectedModel,
    promptText,
    outputText: text,
    startedAt
  });
  return { data: parsed, meta };
}

async function generateJson({
  provider = "mock",
  model,
  apiKey,
  role,
  task,
  data,
  constraints,
  outputSchema,
  examples,
  schemaFallback
}) {
  const promptText = wrapPrompt({ role, task, data, constraints, outputSchema, examples });
  const selectedProvider = String(provider || "mock").toLowerCase();
  const selectedModel = model || DEFAULT_MODELS[selectedProvider] || DEFAULT_MODELS.mock;

  if (!apiKey || selectedProvider === "mock") {
    return makeMockResult(schemaFallback, "mock", DEFAULT_MODELS.mock, promptText, Date.now());
  }
  try {
    if (selectedProvider === "openai") {
      return await callOpenAI({ apiKey, model: selectedModel, promptText, schemaFallback });
    }
    if (selectedProvider === "anthropic") {
      return await callAnthropic({ apiKey, model: selectedModel, promptText, schemaFallback });
    }
    if (selectedProvider === "gemini") {
      return await callGemini({ apiKey, model: selectedModel, promptText, schemaFallback });
    }
    return makeMockResult(schemaFallback, "mock", DEFAULT_MODELS.mock, promptText, Date.now());
  } catch {
    return makeMockResult(schemaFallback, "mock", DEFAULT_MODELS.mock, promptText, Date.now());
  }
}

module.exports = {
  DEFAULT_MODELS,
  generateJson,
  estimateTokensFromText
};
