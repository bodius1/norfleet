/**
 * Single source of truth for environment and session settings.
 * Env is loaded once at startup and exposed as a frozen object.
 */
const { DEFAULT_MODELS } = require("../aiProvider");

const frozenEnv = Object.freeze({
  PORT: Number(process.env.PORT) || 5050,
  NORFLEET_ADMIN_TOKEN: process.env.NORFLEET_ADMIN_TOKEN || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  KPI_API_KEY: process.env.KPI_API_KEY || "",
  KPI_API_BASE_URL: process.env.KPI_API_BASE_URL || ""
});

const config = Object.freeze({
  env: frozenEnv
});

const sessionSettings = {
  ai: {
    provider: "mock",
    model: DEFAULT_MODELS.mock,
    apiKey: "",
    mockMode: true
  },
  data: {
    kpiApiKey: "",
    kpiApiBaseUrl: "",
    robotApiBaseUrl: "",
    dataMode: "mock"
  }
};

function getSessionSettings() {
  return sessionSettings;
}

function getSettingsSnapshot() {
  return {
    ai: {
      provider: sessionSettings.ai.provider,
      model: sessionSettings.ai.model,
      mockMode: Boolean(sessionSettings.ai.mockMode),
      hasApiKey: Boolean(sessionSettings.ai.apiKey)
    },
    data: {
      dataMode: sessionSettings.data.dataMode,
      kpiApiBaseUrl: sessionSettings.data.kpiApiBaseUrl,
      robotApiBaseUrl: sessionSettings.data.robotApiBaseUrl,
      hasKpiApiKey: Boolean(sessionSettings.data.kpiApiKey)
    }
  };
}

function updateAiSettings(body) {
  const provider = String(body.provider || "mock").toLowerCase();
  sessionSettings.ai.provider = ["openai", "anthropic", "gemini", "mock"].includes(provider)
    ? provider
    : "mock";
  sessionSettings.ai.model = String(body.model || DEFAULT_MODELS[sessionSettings.ai.provider] || DEFAULT_MODELS.mock);
  sessionSettings.ai.apiKey = String(body.apiKey || "");
  sessionSettings.ai.mockMode = Boolean(body.mockMode) || sessionSettings.ai.provider === "mock";
}

function updateDataSettings(body) {
  sessionSettings.data.kpiApiKey = String(body.kpiApiKey || "");
  sessionSettings.data.kpiApiBaseUrl = String(body.kpiApiBaseUrl || "");
  sessionSettings.data.robotApiBaseUrl = String(body.robotApiBaseUrl || "");
  sessionSettings.data.dataMode = String(body.dataMode || "mock");
}

function clearStoredKeys() {
  sessionSettings.ai.apiKey = "";
  sessionSettings.data.kpiApiKey = "";
}

function resolveProviderAuth() {
  const provider = String(sessionSettings.ai.provider || "mock").toLowerCase();
  const keyFromSettings = sessionSettings.ai.apiKey || "";
  const envFallback =
    provider === "openai"
      ? frozenEnv.OPENAI_API_KEY
      : provider === "anthropic"
        ? frozenEnv.ANTHROPIC_API_KEY
        : provider === "gemini"
          ? frozenEnv.GEMINI_API_KEY
          : "";
  const apiKey = keyFromSettings || envFallback || "";
  const model = sessionSettings.ai.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.mock;
  const forceMock = sessionSettings.ai.mockMode || !apiKey || provider === "mock";
  return {
    provider: forceMock ? "mock" : provider,
    model: forceMock ? DEFAULT_MODELS.mock : model,
    apiKey: forceMock ? "" : apiKey
  };
}

function requireAdminIfConfigured(req, res, next) {
  if (!frozenEnv.NORFLEET_ADMIN_TOKEN) return next();
  const token = req.get("x-norfleet-admin-token") || "";
  if (token !== frozenEnv.NORFLEET_ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  return next();
}

module.exports = {
  config,
  getSessionSettings,
  getSettingsSnapshot,
  updateAiSettings,
  updateDataSettings,
  clearStoredKeys,
  resolveProviderAuth,
  requireAdminIfConfigured
};
