# Norfleet

Norfleet is a self-learning maintenance platform for industrial robot fleets.

## Current Functional AI Layer

- Fleet Builder, KPI Monitor, AI Agents, Agentic AI Builder, Technician Report.
- Settings modal for provider/API configuration (demo-safe local behavior).
- Provider abstraction with OpenAI / Anthropic / Gemini / built-in (offline) fallback.
- Structured AI endpoints for anomaly analysis, technician reports, root-cause, workflow updates, and feedback learning.
- Local RAG-ready knowledge retrieval from:
  - `knowledge/robot_manuals/`
  - `knowledge/sops/`
  - `knowledge/maintenance_notes/`
- Deterministic KPI anomaly detection before AI reasoning.
- Approval-first workflow updates from Technician Report into Agentic AI Builder state.
- Session token/cost estimate metadata on AI calls.

## Security Notes

- Do **not** hardcode production keys.
- Use `.env.example` placeholders and/or Settings modal input for local demo.
- Keys entered in Settings are demo-only and not committed to Git.
- External tools/skills require review before use because tool permissions can expose secrets or modify state.

## Run Locally

1. Install dependencies:
   - `npm install`
2. Optional environment setup:
   - copy `.env.example` to `.env`
   - fill any needed values:
     - `OPENAI_API_KEY=`
     - `ANTHROPIC_API_KEY=`
     - `GEMINI_API_KEY=`
     - `KPI_API_KEY=`
     - `KPI_API_BASE_URL=`
3. Start server:
   - `npm start`
4. Open:
   - `http://localhost:5050/robotics_kpi_platform.html`

## Settings + built-in assistant

- Open **Settings** (gear in the header).
- Choose provider/model, optionally paste API key (local use only).
- Use **Built-in (no API key)** or the built-in toggle to run without calling a provider.
- If the server sets `NORFLEET_ADMIN_TOKEN`, paste the same value under **Session access token** so the browser sends `x-norfleet-admin-token` on API calls.
- Save + Test connection.

## Demo/Test Flows

### A) No API Keys
- Keep built-in assistant enabled.
- Go to Technician Report.
- Click **Generate AI Report**.
- Review actions and apply updates.

### B) With API Key
- In Settings, choose provider and key.
- Click **Test connection**.
- Generate AI report and recommendations.

### C) KPI Monitor Integration
- In KPI Monitor, run **Detect KPIs (AI)**.
- Click **Analyze with AI** to jump to Technician Report with anomaly context.

### D) Agent Builder Integration
- In Technician Report, review and apply workflow actions.
- Verify updates in AI Agents Overview + Agentic AI Builder.
- Check Agent Change Log.

### E) Feedback Loop
- Apply or send an action.
- Click **Save Technician Feedback**.
- Feedback is stored in session memory and used in future prompts.

## AI / Settings Endpoints

- `GET /api/settings`
- `POST /api/settings/ai`
- `POST /api/settings/data`
- `POST /api/settings/test-connection`
- `POST /api/settings/clear-keys`

## Agentic AI Endpoints

- `POST /api/ai/analyze-kpis`
- `POST /api/ai/generate-technician-report`
- `POST /api/ai/recommend-agent-updates`
- `POST /api/ai/root-cause`
- `POST /api/ai/feedback`
- `GET /api/ai/runtime`

## Existing Fleet/KPI Endpoints

- `GET /api/robots`
- `POST /api/robots`
- `GET /api/fleets`
- `POST /api/fleets`
- `POST /api/fleets/:fleetId/detect-kpis`
- `GET /api/fleets/:fleetId/metrics`
- `GET /api/stream`
