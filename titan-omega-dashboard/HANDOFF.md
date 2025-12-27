### Titan Omega / Heatseeker — Handoff (for Claude 4.5)

This repo contains a **real-time SPX day-trading dashboard** (“Titan Omega / Heatseeker”) designed to catch **10–15+ SPX point moves** using **Polygon real-time data** with strict discipline:

- **No mock/synthetic data** (only Polygon WS + REST).
- **API keys never shipped to the browser** (backend proxy only).
- **Two-tier alerts**: HEADS-UP (high recall) + TRIGGER (high precision) with **TRIGGER hard cap = 26/day**.
- **SPX + SPY + QQQ** analyzed **together (confluence)** and **separately**.
- **Options trades (T) + options quotes (Q)** ingested for seconds-level signals; options snapshot used for structural context.

---

## Architecture (what’s implemented)

### Backend (Node + Express + ws)
File: `titan-omega-dashboard/server/index.js`

- Upstream WebSockets (Polygon):
  - Indices: `wss://socket.polygon.io/indices` (SPX/VIX ticks + minute bars)
  - Stocks: `wss://socket.polygon.io/stocks` (SPY/QQQ ticks + minute bars)
  - Options: `wss://socket.polygon.io/options` (options **trades** + **quotes**)
- REST:
  - Prev day: SPX/VIX/SPY/QQQ
  - Options snapshots: SPX/SPY/QQQ (0DTE + nearest weekly blend)
  - Daily bars for weekly analysis
- Broadcast:
  - Consolidated `STATE` message at **1Hz** over `WS /stream` for smooth UI updates.
- Dealer positioning:
  - For SPX/SPY/QQQ: compute per-strike **netGEX**, plus **Vanna (VEX proxy)** and **Charm** (via Black–Scholes-derived vanna/charm using snapshot IV).
  - Structural levels: **gammaFlip**, **callWall**, **putWall** derived from per-strike netGEX.
  - Blend: **0DTE + weekly** (default weights 65/35).
- Seconds-layer signals:
  - **Flow layer** from options trades (rolling window): `deltaNotional`, `gammaNotional`.
  - **Quotes layer** from options quotes (rolling window): estimated **avg IV**, **skew (putIV − callIV)**, **IV ROC**.
- Confluence:
  - `sync`: SPX↔SPY basis + agreement.
  - `sync3`: SPX/SPY/QQQ dealer/quotes alignment agreement.
- Alert engine:
  - Fires HEADS-UP and TRIGGER alerts with a trade plan (entry/stop/targets/TTL).
  - TRIGGER gating requires fresh tick + flow + snapshot + bar + session constraints.

### Frontend (Vite + React)
Files:
- `titan-omega-dashboard/src/services/MassiveService.js`
- `titan-omega-dashboard/src/TitanOmegaDashboard.jsx`

Consumes backend `/stream` and renders:
- Live SPX/VIX/SPY/QQQ
- Dealer positioning panels (SPX/SPY/QQQ) from `dealer.<symbol>.blend.*`
- Flow + Quotes layer panels
- SPX↔SPY basis + `sync3` confluence
- Alerts list (HEADS-UP + TRIGGER)

---

## Security / Keys (IMPORTANT)

Keys are **backend-only**. Frontend never uses Polygon keys.

### Key ring support (multi-key)
- Local file: `titan-omega-dashboard/.env` (**gitignored**)
- Env var: `MASSIVE_API_KEYS` (comma/space/newline separated)
- Backend auto-selects a working key and reports only **masked last4** in `/health`.

### Key probe tool (masked output only)
File: `titan-omega-dashboard/server/check_keys.js`

Checks per key:
- Indices access (SPX prev agg)
- Options snapshots: SPY + QQQ + SPX + SPXW
- Options WS auth (`wss://socket.polygon.io/options` auth_success)

Run:

```bash
cd titan-omega-dashboard
node server/check_keys.js
```

---

## Message schema (UI contract)

Backend emits `STATE` once per second:

```json
{
  "type": "STATE",
  "data": {
    "status": { "connected": true, "authenticated": true, "options": { "connected": true, "authenticated": true } },
    "SPX": { "price": 0, "timestamp": 0, "source": "WS_*" },
    "VIX": { "value": 0, "timestamp": 0, "source": "WS_*" },
    "SPY": { "price": 0, "timestamp": 0, "source": "WS_*" },
    "QQQ": { "price": 0, "timestamp": 0, "source": "WS_*" },
    "bars": { "SPX": [], "VIX": [], "SPY": [], "QQQ": [] },
    "dealer": {
      "spx": { "blend": { "net": {}, "levels": {}, "perStrike": [] }, "changes": {} },
      "spy": { "blend": { "net": {}, "levels": {}, "perStrike": [] }, "changes": {} },
      "qqq": { "blend": { "net": {}, "levels": {}, "perStrike": [] }, "changes": {} },
      "flow": { "spx": {}, "spy": {}, "qqq": {}, "windowSec": 15 },
      "quotes": { "spx": {}, "spy": {}, "qqq": {}, "windowSec": 15 },
      "sync": { "agreement": 0, "basis": 0, "basisPct": 0, "notes": [] },
      "sync3": { "agreement": 0, "notes": [] },
      "pulse": { "freshness": { "spxTickMs": 0, "flowMs": 0, "quoteMs": 0 } }
    },
    "alerts": []
  }
}
```

Notes:
- Dealer positioning **must be read from** `dealer.<symbol>.blend` (not from `dealer.<symbol>.net/levels`).
- Quotes/IV layer is a rolling estimate from **real quotes**; no synthetic IV.

---

## Alert tiers (current discipline)

- HEADS-UP:
  - Higher recall, throttled by cooldown + daily cap.
- TRIGGER:
  - Higher precision, **maxTriggersPerDay = 26**
  - Requires freshness gates and confluence (`sync3` preferred, else `sync`).

Tuning is via env vars (see `titan-omega-dashboard/.env.example`), including freshness windows and thresholds.

---

## How to run (local)

1) Create `titan-omega-dashboard/.env`:

```env
MASSIVE_API_KEYS=key1,key2,key3,key4,key5
# optional hardening
# PROXY_TOKEN=...
# VITE_PROXY_TOKEN=...
```

2) Start backend + frontend:

```bash
npm --prefix "titan-omega-dashboard" install
npm --prefix "titan-omega-dashboard" run dev:all
```

3) Open:
- `http://localhost:5173`

Quick sanity checks:

```bash
curl -s http://localhost:8787/health
curl -s http://localhost:8787/api/status | jq '.latest | {SPX,SPY,QQQ,dealer:{sync3:.dealer.sync3,flow:.dealer.flow,quotes:.dealer.quotes}}'
```

---

## Claude 4.5 prompt (paste this)

```text
You are Claude 4.5. Help refine an institutional SPX day-trading tool “Titan Omega / Heatseeker”.

Goal:
- Detect/forecast actionable 10–15+ SPX point moves fast (seconds-level), from a 0DTE options trader POV.
- Keep alerts disciplined: HEADS-UP + TRIGGER, with TRIGGER hard cap 26/day.
- Improve edge over existing tools via earlier confirmation, better confluence, and fewer false positives.

Hard constraints:
- Real data only (Polygon WS + REST). No mock/synthetic features or backfilled fake values.
- API keys must remain server-side (never in browser).
- Must analyze SPX/SPY/QQQ together (confluence) and separately.
- Must ingest options quotes (Q) and use them for earlier signals (IV/skew ROC), plus options trades (T) for flow.
- Must keep strict freshness gating: don’t fire TRIGGERs on stale feeds.

Please read and reason about these files:
- titan-omega-dashboard/server/index.js
- titan-omega-dashboard/server/check_keys.js
- titan-omega-dashboard/src/services/MassiveService.js
- titan-omega-dashboard/src/TitanOmegaDashboard.jsx

Deliverables:
1) Identify the most critical flaws/limitations in the current logic that prevent “institutional edge”.
2) Propose a refined Heatseeker-style node framework using only real inputs:
   - Define King/Gatekeeper/Mid nodes from dealer levels + price interaction + flow/quotes ROC.
   - Add node freshness/touch strength and node ROC (how levels migrate).
3) Upgrade the quotes/IV layer:
   - More robust IV estimation (prefer using quote IV if available; otherwise infer from mid with safer bounds).
   - Per-strike and near-ATM skew/term structure micro-signals.
   - A “vol expansion vs compression” regime detector that gates TRIGGERs.
4) Redesign the TRIGGER scoring to be more precise:
   - Explicit formula/pseudocode; list each term and why it matters.
   - Include confluence (SPX/SPY/QQQ), flow impulse, quote IV ROC/skew ROC, distance-to-node, and momentum.
   - Include a hard daily budget + cooldown + clustering rules to avoid duplicates.
5) Provide concrete patch suggestions (specific functions/blocks to change), keeping complexity controlled.

Output format:
- A prioritized checklist of changes (highest leverage first).
- Proposed scoring model (math + pseudocode).
- Exact code touchpoints (file + function names) and any new data fields needed in STATE.
```

