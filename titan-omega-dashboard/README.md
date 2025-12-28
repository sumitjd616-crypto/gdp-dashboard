# Titan Omega Dashboard (secure real-time)

This tool runs a **backend proxy** that holds your API key server-side and streams **real-time SPX/VIX** to the React UI.

## Quick start

```bash
cd titan-omega-dashboard
npm install

cp .env.example .env
# edit .env and set MASSIVE_API_KEY=...

# one command (runs backend + frontend)
npm run dev:all
```

Open the URL printed by Vite (usually `http://localhost:5173`).

## Security

- Put secrets in **backend-only** env var: `MASSIVE_API_KEY`
- Never commit `.env`
- Optional protection for deployments:
  - Set `PROXY_TOKEN=...` and `VITE_PROXY_TOKEN=...`

