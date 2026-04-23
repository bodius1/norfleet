# Norfleet

Norfleet is a centralized KPI tracking platform for industrial robot fleets in warehouse environments.

## What is now real

- Live backend telemetry simulation for connected robots
- Realtime fleet updates to the UI using Server-Sent Events
- KPI registry API with AI-assisted KPI auto-detection endpoint
- AI "what-if" simulator endpoint for robot setting changes
- Optional LLM narrative integration via `OPENAI_API_KEY`

## Run locally

1. Install dependencies:
   - `npm install`
2. Optional AI narrative with OpenAI:
   - copy `.env.example` to `.env`
   - add your `OPENAI_API_KEY`
3. Start:
   - `npm start`
4. Open:
   - `http://localhost:5050/robotics_kpi_platform.html`

## APIs

- `GET /api/fleet/summary`
- `GET /api/robots`
- `GET /api/kpis`
- `GET /api/alerts`
- `POST /api/ai/detect-kpis`
- `POST /api/ai/simulate`
- `GET /api/stream` (SSE realtime stream)
