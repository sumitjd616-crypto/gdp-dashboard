import http from 'node:http';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Titan Omega backend proxy
 *
 * Keeps API keys server-side and exposes:
 * - GET /health
 * - GET /api/prev          -> prev day SPX/VIX
 * - GET /api/daily?days=10 -> daily bars for weekly analysis
 * - GET /api/options/profile -> latest dealer profile snapshot (real options data)
 * - WS  /stream            -> pushes live SPX/VIX updates
 *
 * Env (server-side):
 * - MASSIVE_API_KEY (recommended)
 * - VITE_POLYGON_API_KEY or VITE_MASSIVE_API_KEY (fallback for local dev only)
 * - MASSIVE_WS_INDICES_URL (optional; defaults to Polygon indices socket)
 * - PROXY_TOKEN (optional). If set:
 *   - REST requires header: `x-titan-token: <token>`
 *   - WS requires query param: `/stream?token=<token>`
 * - PORT (default 8787)
 */

const PORT = Number(process.env.PORT || 8787);
const PROXY_TOKEN = process.env.PROXY_TOKEN || '';
const API_KEY =
  process.env.MASSIVE_API_KEY ||
  process.env.POLYGON_API_KEY ||
  process.env.VITE_POLYGON_API_KEY ||
  process.env.VITE_MASSIVE_API_KEY ||
  '';

const WS_INDICES_URL = process.env.MASSIVE_WS_INDICES_URL || 'wss://socket.polygon.io/indices';
const WS_STOCKS_URL = process.env.MASSIVE_WS_STOCKS_URL || 'wss://socket.polygon.io/stocks';
const WS_OPTIONS_URL = process.env.MASSIVE_WS_OPTIONS_URL || 'wss://socket.polygon.io/options';
const REST_BASE_URL = 'https://api.polygon.io';

// Optional recorder (real data only, no secrets)
const RECORD_PATH = process.env.RECORD_PATH || '';

// Alert + risk configuration (pro-trader defaults; override via env)
const CFG = {
  headsUpMinScore: Number(process.env.HEADSUP_MIN_SCORE || 60),
  triggerMinScore: Number(process.env.TRIGGER_MIN_SCORE || 65),
  headsUpCooldownMs: Number(process.env.HEADSUP_COOLDOWN_MS || 20_000),
  triggerCooldownMs: Number(process.env.TRIGGER_COOLDOWN_MS || 60_000),
  maxTriggersPerDay: Number(process.env.MAX_TRIGGERS_PER_DAY || 26),
  maxHeadsUpPerDay: Number(process.env.MAX_HEADSUP_PER_DAY || 250),
  minAgreement: Number(process.env.MIN_DEALER_AGREEMENT || 45),
  // "Institutional speed" gating:
  // - require tick freshness (seconds) for TRIGGER
  // - require options-flow freshness (seconds) for TRIGGER
  // - keep options snapshot freshness tighter than before
  tickFreshMs: Number(process.env.TICK_FRESH_MS || 8_000),
  flowFreshMs: Number(process.env.FLOW_FRESH_MS || 6_000),
  dealerFreshMs: Number(process.env.DEALER_FRESH_MS || 45_000),
  barFreshMs: Number(process.env.BAR_FRESH_MS || 150_000), // minute bars update slowly; don't over-gate
  // Risk model: structure + realized volatility (all from real price)
  stopMinPts: Number(process.env.STOP_MIN_PTS || 8),
  stopAtrMult: Number(process.env.STOP_ATR_MULT || 0.5),
  stopBufferPts: Number(process.env.STOP_BUFFER_PTS || 2),
  // Targets
  tp1Pts: Number(process.env.TP1_PTS || 10),
  tp2Pts: Number(process.env.TP2_PTS || 15),
  tp3Pts: Number(process.env.TP3_PTS || 25),
  // Trade time-to-live for 0DTE style scalps
  ttlMinutes: Number(process.env.TRADE_TTL_MIN || 60),
  // Options snapshot cadence (balance speed vs API load)
  optionsPollMs: Number(process.env.OPTIONS_POLL_MS || 20_000),
  // Flow window (seconds-level) for impulse detection
  flowWindowSec: Number(process.env.FLOW_WINDOW_SEC || 15),
  // Broadcast consolidated state to UI
  stateBroadcastMs: Number(process.env.STATE_BROADCAST_MS || 1000),
};

const app = express();
const server = http.createServer(app);

function etDateKey(tsMs) {
  try {
    const d = new Date(tsMs);
    // YYYY-MM-DD in America/New_York
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    return `${y}-${m}-${day}`;
  } catch {
    return new Date(tsMs).toISOString().slice(0, 10);
  }
}

const dailyBudget = {
  dateET: etDateKey(Date.now()),
  triggers: 0,
  headsUp: 0,
};

function resetDailyBudgetIfNeeded(tsMs) {
  const key = etDateKey(tsMs);
  if (dailyBudget.dateET !== key) {
    dailyBudget.dateET = key;
    dailyBudget.triggers = 0;
    dailyBudget.headsUp = 0;
  }
}

// Latest snapshot cached in-memory (and served to new WS clients).
const latest = {
  status: {
    connected: false,
    authenticated: false,
    lastMessageTs: null,
    lastSPXTs: null,
    lastVIXTs: null,
    lastSPXBarTs: null,
    lastVIXBarTs: null,
    counters: { msgs: 0, spx: 0, vix: 0, spxBars: 0, vixBars: 0 },
    countersStocks: { msgs: 0, spy: 0, spyBars: 0 },
    options: {
      connected: false,
      authenticated: false,
      lastMessageTs: null,
      lastTradeTs: null,
      counters: { msgs: 0, trades: 0 },
    },
  },
  SPX: null,
  VIX: null,
  SPY: null,
  bars: {
    SPX: [], // newest-first, minute bars from AM.I:SPX
    VIX: [], // newest-first, minute bars from AM.I:VIX (if available)
    SPY: [], // newest-first, minute bars from AM.SPY
  },
  dealer: {
    spx: {
      available: false,
      reason: 'not_loaded',
      timestamp: null,
      underlying: 'SPX',
      expirations: { d0: null, weekly: null },
      contracts: 0,
      spot: null,
      vix: null,
      net: { gex: null, vanna: null, charm: null },
      levels: { gammaFlip: null, callWall: null, putWall: null },
      perStrike: [],
      changes: null,
      d0: null,
      weekly: null,
      blend: null,
    },
    spy: {
      available: false,
      reason: 'not_loaded',
      timestamp: null,
      underlying: 'SPY',
      expirations: { d0: null, weekly: null },
      contracts: 0,
      spot: null,
      vix: null,
      net: { gex: null, vanna: null, charm: null },
      levels: { gammaFlip: null, callWall: null, putWall: null },
      perStrike: [],
      changes: null,
      d0: null,
      weekly: null,
      blend: null,
    },
    sync: {
      available: false,
      timestamp: null,
      spxSpot: null,
      spySpot: null,
      spyToSpx: null,
      basis: null,
      basisPct: null,
      agreement: null, // 0..100
      notes: [],
    },
    flow: {
      available: false,
      timestamp: null,
      windowSec: 30,
      // Aggregated delta/gamma-ish pressure proxies from REAL option trades (seconds-level).
      // These are *flows*, not OI, and are used to detect rapid positioning changes.
      spx: { deltaNotional: 0, gammaNotional: 0, trades: 0 },
      spy: { deltaNotional: 0, gammaNotional: 0, trades: 0 },
      lastTradeTs: null,
      computedAtTs: null,
      notes: [],
    },
  },
  alerts: [], // newest-first
};

function computeRealtimeDealerPulse() {
  // 1Hz “pulse”: combines *latest snapshot* + *seconds-level flow* + *spot drift*.
  // This is NOT new options-chain data; it’s a real-time interpretation layer.
  const now = Date.now();
  const spxSpot = Number(latest.SPX?.price) || null;
  const spySpot = Number(latest.SPY?.price) || null;

  const spxBlend = latest.dealer?.spx?.blend?.available ? latest.dealer.spx.blend : null;
  const spyBlend = latest.dealer?.spy?.blend?.available ? latest.dealer.spy.blend : null;

  const flow = latest.dealer?.flow?.available ? latest.dealer.flow : null;

  const pulse = {
    timestamp: new Date().toISOString(),
    spx: {
      spot: spxSpot,
      flip: spxBlend?.levels?.gammaFlip ?? null,
      callWall: spxBlend?.levels?.callWall ?? null,
      putWall: spxBlend?.levels?.putWall ?? null,
      netGEX: spxBlend?.net?.gex ?? null,
      // Spot displacement from flip/walls (real)
      dFlip: spxSpot != null && spxBlend?.levels?.gammaFlip != null ? spxSpot - spxBlend.levels.gammaFlip : null,
      dCall: spxSpot != null && spxBlend?.levels?.callWall != null ? spxBlend.levels.callWall - spxSpot : null,
      dPut: spxSpot != null && spxBlend?.levels?.putWall != null ? spxSpot - spxBlend.levels.putWall : null,
      // Seconds-level flow impulse (real)
      flowGammaNotional: flow?.spx?.gammaNotional ?? null,
      flowDeltaNotional: flow?.spx?.deltaNotional ?? null,
      flowTrades: flow?.spx?.trades ?? null,
      // Simple “pressure” heuristic (real inputs only)
      // Negative gammaNotional here tends to correspond to buy-hedging impulse (in our sign convention).
      impulse: flow?.spx?.gammaNotional != null ? (flow.spx.gammaNotional < 0 ? 'BUY_IMPULSE' : flow.spx.gammaNotional > 0 ? 'SELL_IMPULSE' : 'NEUTRAL') : 'UNKNOWN',
    },
    spy: {
      spot: spySpot,
      flip: spyBlend?.levels?.gammaFlip ?? null,
      callWall: spyBlend?.levels?.callWall ?? null,
      putWall: spyBlend?.levels?.putWall ?? null,
      netGEX: spyBlend?.net?.gex ?? null,
      flowGammaNotional: flow?.spy?.gammaNotional ?? null,
      flowDeltaNotional: flow?.spy?.deltaNotional ?? null,
      flowTrades: flow?.spy?.trades ?? null,
      impulse: flow?.spy?.gammaNotional != null ? (flow.spy.gammaNotional < 0 ? 'BUY_IMPULSE' : flow.spy.gammaNotional > 0 ? 'SELL_IMPULSE' : 'NEUTRAL') : 'UNKNOWN',
    },
    sync: latest.dealer?.sync ?? null,
    freshness: {
      spxTickMs: latest.status.lastSPXTs ? now - Number(latest.status.lastSPXTs) : null,
      spyTickMs: latest.SPY?.timestamp ? now - Number(latest.SPY.timestamp) : null,
      flowMs: latest.dealer?.flow?.timestamp ? now - Date.parse(latest.dealer.flow.timestamp) : null,
      spxSnapshotMs: spxBlend?.timestamp ? now - Date.parse(spxBlend.timestamp) : null,
      spySnapshotMs: spyBlend?.timestamp ? now - Date.parse(spyBlend.timestamp) : null,
    },
  };

  latest.dealer.pulse = pulse;
  return pulse;
}

function broadcastState() {
  // 1Hz state broadcast for smooth UI
  computeRealtimeDealerPulse();
  wsBroadcast(wss, {
    type: 'STATE',
    data: {
      status: latest.status,
      SPX: latest.SPX,
      VIX: latest.VIX,
      SPY: latest.SPY,
      bars: latest.bars,
      dealer: latest.dealer,
      alerts: latest.alerts,
    },
  });
}

function recordEvent(type, payload) {
  if (!RECORD_PATH) return;
  try {
    const line = JSON.stringify({ ts: Date.now(), type, payload });
    fs.appendFileSync(RECORD_PATH, `${line}\n`);
  } catch {
    // ignore recorder failures
  }
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function wsBroadcast(wss, payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
  // Record broadcast payload (no secrets)
  recordEvent('broadcast', payload);
}

function isRthNowET(tsMs) {
  // Very lightweight: estimate using America/New_York clock via Intl
  // We intentionally avoid external deps. This is used only as a soft score/gate.
  try {
    const d = new Date(tsMs);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const hh = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const mm = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    const minutes = hh * 60 + mm;
    // 9:30 (570) to 16:00 (960)
    return minutes >= 570 && minutes <= 960;
  } catch {
    return true;
  }
}

function computeATRFromBars(newestFirstBars, period = 14) {
  if (!Array.isArray(newestFirstBars) || newestFirstBars.length < period + 2) return null;
  const bars = [...newestFirstBars].slice(0, period + 2).reverse(); // oldest->newest
  const trs = [];
  for (let i = 1; i < bars.length; i += 1) {
    const hi = Number(bars[i].high);
    const lo = Number(bars[i].low);
    const pc = Number(bars[i - 1].close);
    if (!Number.isFinite(hi) || !Number.isFinite(lo) || !Number.isFinite(pc)) continue;
    trs.push(Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc)));
  }
  if (!trs.length) return null;
  const tail = trs.slice(-period);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

function buildTradePlan({ ts, spot, direction, dealer }) {
  const dir = direction === 'DOWN' ? -1 : 1;
  const flip = dealer?.spx?.gammaFlip ?? null;
  const call = dealer?.spx?.callWall ?? null;
  const put = dealer?.spx?.putWall ?? null;

  const atr = computeATRFromBars(latest.bars.SPX, 14);
  const volStop = atr ? Math.max(CFG.stopMinPts, atr * CFG.stopAtrMult) : CFG.stopMinPts;

  // Structure stop: opposite side of the nearest structural level with a buffer.
  let structuralStop = null;
  if (dir === 1) {
    // long: invalid below max(putWall, flip) - buffer
    const ref = [put, flip].filter((x) => Number.isFinite(Number(x))).sort((a, b) => b - a)[0];
    if (ref != null) structuralStop = Number(ref) - CFG.stopBufferPts;
  } else {
    // short: invalid above min(callWall, flip) + buffer
    const ref = [call, flip].filter((x) => Number.isFinite(Number(x))).sort((a, b) => a - b)[0];
    if (ref != null) structuralStop = Number(ref) + CFG.stopBufferPts;
  }

  // Fallback stop: fixed points
  const fixedStop = spot - dir * volStop;

  // Choose more conservative stop (tighter) if it still makes sense, otherwise use fixed.
  const stop = structuralStop != null ? structuralStop : fixedStop;
  const riskPts = Math.abs(spot - stop);

  const tp1 = spot + dir * CFG.tp1Pts;
  const tp2 = spot + dir * CFG.tp2Pts;
  const tp3 = spot + dir * CFG.tp3Pts;

  const ttlMs = CFG.ttlMinutes * 60_000;

  const plan = {
    entry: spot,
    direction,
    stop,
    riskPts,
    targets: [tp1, tp2, tp3],
    ttlMinutes: CFG.ttlMinutes,
    expiresAt: ts + ttlMs,
    rationale: {
      stopModel: structuralStop != null ? 'STRUCTURE+BUFFER' : atr ? 'ATR' : 'FIXED',
      atr: atr ?? null,
      flip,
      callWall: call,
      putWall: put,
    },
    execution: {
      // Human-friendly: scale out & protect
      suggestion: 'Scale: take partial at TP1, trail stop after TP1, exit remainder by TTL if not hit.',
      invalidation: 'If stop breaks, exit immediately (no averaging).',
    },
  };

  return plan;
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data?.status === 'ERROR') {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function requireToken(req, res) {
  if (!PROXY_TOKEN) return true;
  const tok = req.headers['x-titan-token'];
  if (tok && String(tok) === PROXY_TOKEN) return true;
  res.status(401).json({ ok: false, error: 'Unauthorized' });
  return false;
}

app.get('/health', (_req, res) => {
  if (!requireToken(_req, res)) return;
  res.json({
    ok: true,
    hasKey: Boolean(API_KEY),
    tokenProtected: Boolean(PROXY_TOKEN),
    wsUrl: WS_INDICES_URL,
    connected: latest.status.connected,
    authenticated: latest.status.authenticated,
  });
});

app.get('/api/status', (req, res) => {
  if (!requireToken(req, res)) return;
  res.json({ ok: true, latest });
});

app.get('/api/options/profile', (req, res) => {
  if (!requireToken(req, res)) return;
  res.json({ ok: true, dealer: latest.dealer });
});

app.get('/api/options/flow', (req, res) => {
  if (!requireToken(req, res)) return;
  res.json({ ok: true, flow: latest.dealer.flow });
});

app.get('/api/prev', async (_req, res) => {
  if (!requireToken(_req, res)) return;
  if (!API_KEY) return res.status(400).json({ ok: false, error: 'Missing server API key (set MASSIVE_API_KEY)' });
  try {
    const [spx, vix, spy] = await Promise.all([
      fetchJson(`${REST_BASE_URL}/v2/aggs/ticker/I:SPX/prev?apiKey=${encodeURIComponent(API_KEY)}`),
      fetchJson(`${REST_BASE_URL}/v2/aggs/ticker/I:VIX/prev?apiKey=${encodeURIComponent(API_KEY)}`),
      fetchJson(`${REST_BASE_URL}/v2/aggs/ticker/SPY/prev?apiKey=${encodeURIComponent(API_KEY)}`),
    ]);
    res.json({
      ok: true,
      spx: spx?.results?.[0] || null,
      vix: vix?.results?.[0] || null,
      spy: spy?.results?.[0] || null,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get('/api/daily', async (req, res) => {
  if (!requireToken(req, res)) return;
  if (!API_KEY) return res.status(400).json({ ok: false, error: 'Missing server API key (set MASSIVE_API_KEY)' });
  const days = Math.max(5, Math.min(90, Number(req.query.days || 10)));
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const data = await fetchJson(
      `${REST_BASE_URL}/v2/aggs/ticker/I:SPX/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=${days}&apiKey=${encodeURIComponent(API_KEY)}`
    );
    const bars = Array.isArray(data?.results)
      ? data.results.map((b) => ({
          date: new Date(b.t).toISOString().slice(0, 10),
          timestamp: b.t,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
        }))
      : [];
    res.json({ ok: true, bars });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
});

// WebSocket server for frontend clients
const wss = new WebSocketServer({ server, path: '/stream' });
wss.on('connection', (socket, req) => {
  if (PROXY_TOKEN) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const tok = url.searchParams.get('token') || '';
    if (tok !== PROXY_TOKEN) {
      socket.close(1008, 'Unauthorized');
      return;
    }
  }
  // Send current snapshot immediately
  socket.send(JSON.stringify({ type: 'snapshot', data: latest }));
});

// Provider sockets (upstream): indices + stocks
let upstreamIndices = null;
let upstreamIndicesAuthed = false;
let upstreamStocks = null;
let upstreamStocksAuthed = false;
let upstreamOptions = null;
let upstreamOptionsAuthed = false;
let reconnectTimer = null;
let reconnectTimerStocks = null;
let reconnectTimerOptions = null;

function connectUpstream() {
  if (!API_KEY) {
    latest.status = { connected: false, authenticated: false, error: 'missing_key' };
    return;
  }

  if (upstreamIndices) {
    try {
      upstreamIndices.close();
    } catch {
      // ignore
    }
  }

  upstreamIndicesAuthed = false;
  latest.status.connected = false;
  latest.status.authenticated = false;
  latest.status.error = undefined;
  wsBroadcast(wss, { type: 'status', status: latest.status });

  upstreamIndices = new WebSocket(WS_INDICES_URL);

  upstreamIndices.on('open', () => {
    latest.status.connected = true;
    latest.status.authenticated = false;
    latest.status.error = undefined;
    wsBroadcast(wss, { type: 'status', status: latest.status });
    upstreamIndices.send(JSON.stringify({ action: 'auth', params: API_KEY }));
  });

  upstreamIndices.on('message', (buf) => {
    latest.status.lastMessageTs = Date.now();
    const messages = safeJsonParse(buf.toString());
    if (!messages) return;
    const list = Array.isArray(messages) ? messages : [messages];

    for (const msg of list) {
      latest.status.counters.msgs += 1;
      if (msg?.ev === 'status') {
        if (msg.status === 'auth_success') {
          upstreamIndicesAuthed = true;
          latest.status.connected = true;
          latest.status.authenticated = true;
          latest.status.error = undefined;
          wsBroadcast(wss, { type: 'status', status: latest.status });
          upstreamIndices.send(JSON.stringify({ action: 'subscribe', params: 'V.I:SPX,V.I:VIX,AM.I:SPX,AM.I:VIX' }));
        } else if (msg.status === 'auth_failed') {
          latest.status.connected = false;
          latest.status.authenticated = false;
          latest.status.error = msg.message || 'auth_failed';
          wsBroadcast(wss, { type: 'status', status: latest.status });
        }
        continue;
      }

      if (!upstreamIndicesAuthed) continue;

      if (msg?.ev === 'V') {
        const sym = String(msg.T || '').replace('I:', '');
        const val = Number(msg.val ?? msg.v);
        const ts = msg.t || Date.now();
        if (sym === 'SPX') {
          latest.status.lastSPXTs = ts;
          latest.status.counters.spx += 1;
          latest.SPX = { price: val, timestamp: ts, source: 'WS_V' };
          wsBroadcast(wss, { type: 'SPX', data: latest.SPX });
        } else if (sym === 'VIX') {
          latest.status.lastVIXTs = ts;
          latest.status.counters.vix += 1;
          latest.VIX = { value: val, timestamp: ts, source: 'WS_V' };
          wsBroadcast(wss, { type: 'VIX', data: latest.VIX });
        }
        continue;
      }

      // Aggregate minute bars (real bars)
      if (msg?.ev === 'AM') {
        const sym = String(msg.sym || msg.T || '').replace('I:', '');
        if (sym !== 'SPX' && sym !== 'VIX') continue;

        const bar = {
          timestamp: msg.s || Date.now(),
          open: msg.o,
          high: msg.h,
          low: msg.l,
          close: msg.c,
          volume: msg.v,
          source: 'WS_AM',
        };

        if (sym === 'SPX') {
          latest.status.lastSPXBarTs = bar.timestamp;
          latest.status.counters.spxBars += 1;
          latest.bars.SPX.unshift(bar);
          if (latest.bars.SPX.length > 500) latest.bars.SPX.pop();
          latest.SPX = { price: bar.close, timestamp: bar.timestamp, source: 'WS_AM' };
          wsBroadcast(wss, { type: 'SPX', data: latest.SPX });
          wsBroadcast(wss, { type: 'SPX_BAR', data: bar });
        } else {
          latest.status.lastVIXBarTs = bar.timestamp;
          latest.status.counters.vixBars += 1;
          latest.bars.VIX.unshift(bar);
          if (latest.bars.VIX.length > 500) latest.bars.VIX.pop();
          latest.VIX = { value: bar.close, timestamp: bar.timestamp, source: 'WS_AM' };
          wsBroadcast(wss, { type: 'VIX', data: latest.VIX });
          wsBroadcast(wss, { type: 'VIX_BAR', data: bar });
        }
      }
    }
  });

  upstreamIndices.on('close', () => {
    latest.status.connected = false;
    latest.status.authenticated = false;
    latest.status.error = 'closed';
    wsBroadcast(wss, { type: 'status', status: latest.status });
    scheduleReconnect();
  });

  upstreamIndices.on('error', () => {
    latest.status.connected = false;
    latest.status.authenticated = false;
    latest.status.error = 'error';
    wsBroadcast(wss, { type: 'status', status: latest.status });
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectUpstream();
  }, 2000);
}

function connectUpstreamStocks() {
  if (!API_KEY) return;
  if (upstreamStocks) {
    try {
      upstreamStocks.close();
    } catch {
      // ignore
    }
  }

  upstreamStocksAuthed = false;
  upstreamStocks = new WebSocket(WS_STOCKS_URL);

  upstreamStocks.on('open', () => {
    upstreamStocks.send(JSON.stringify({ action: 'auth', params: API_KEY }));
  });

  upstreamStocks.on('message', (buf) => {
    const messages = safeJsonParse(buf.toString());
    if (!messages) return;
    const list = Array.isArray(messages) ? messages : [messages];
    for (const msg of list) {
      latest.status.countersStocks.msgs += 1;
      if (msg?.ev === 'status') {
        if (msg.status === 'auth_success') {
          upstreamStocksAuthed = true;
          upstreamStocks.send(JSON.stringify({ action: 'subscribe', params: 'T.SPY,AM.SPY' }));
        }
        continue;
      }
      if (!upstreamStocksAuthed) continue;

      if (msg?.ev === 'T' && msg.sym === 'SPY') {
        latest.status.countersStocks.spy += 1;
        latest.SPY = { price: msg.p, timestamp: msg.t || Date.now(), source: 'WS_T' };
        wsBroadcast(wss, { type: 'SPY', data: latest.SPY });
      }

      if (msg?.ev === 'AM' && msg.sym === 'SPY') {
        latest.status.countersStocks.spyBars += 1;
        const bar = {
          timestamp: msg.s || Date.now(),
          open: msg.o,
          high: msg.h,
          low: msg.l,
          close: msg.c,
          volume: msg.v,
          source: 'WS_AM',
        };
        latest.bars.SPY.unshift(bar);
        if (latest.bars.SPY.length > 500) latest.bars.SPY.pop();
        latest.SPY = { price: bar.close, timestamp: bar.timestamp, source: 'WS_AM' };
        wsBroadcast(wss, { type: 'SPY', data: latest.SPY });
        wsBroadcast(wss, { type: 'SPY_BAR', data: bar });
      }
    }
  });

  upstreamStocks.on('close', () => scheduleReconnectStocks());
  upstreamStocks.on('error', () => scheduleReconnectStocks());
}

function scheduleReconnectStocks() {
  if (reconnectTimerStocks) return;
  reconnectTimerStocks = setTimeout(() => {
    reconnectTimerStocks = null;
    connectUpstreamStocks();
  }, 2000);
}

// ----------------------------
// Options WebSocket (seconds-level flow)
// ----------------------------

// We dynamically subscribe to a small, high-signal set of option tickers:
// - SPY 0DTE + nearest weekly around ATM (calls/puts)
// - (Optional) SPX options tickers if available via snapshot results
//
// We then compute rolling-window deltaNotional/gammaNotional proxies:
//   deltaNotional += dealerSignedDelta * size * 100 * underlyingPrice
//   gammaNotional += dealerSignedGamma * size * 100 * underlyingPrice^2
//
// Dealer sign convention matches the rest: calls negative, puts positive.
const optionGreeksByTicker = new Map(); // ticker -> { delta, gamma, type, underlying }
const optionFlowEvents = []; // [{ ts, underlying, deltaNotional, gammaNotional }]
let currentOptionSubs = new Set();

function pruneFlow(windowMs) {
  const cutoff = Date.now() - windowMs;
  while (optionFlowEvents.length && optionFlowEvents[0].ts < cutoff) optionFlowEvents.shift();
}

function recomputeFlow(windowSec = 30) {
  pruneFlow(windowSec * 1000);
  const agg = {
    available: upstreamOptionsAuthed,
    timestamp: new Date().toISOString(),
    windowSec,
    spx: { deltaNotional: 0, gammaNotional: 0, trades: 0 },
    spy: { deltaNotional: 0, gammaNotional: 0, trades: 0 },
    lastTradeTs: latest.status.options.lastTradeTs,
    computedAtTs: Date.now(),
    notes: [],
  };
  for (const e of optionFlowEvents) {
    const bucket = e.underlying === 'SPX' ? agg.spx : e.underlying === 'SPY' ? agg.spy : null;
    if (!bucket) continue;
    bucket.deltaNotional += e.deltaNotional;
    bucket.gammaNotional += e.gammaNotional;
    bucket.trades += 1;
  }
  latest.dealer.flow = agg;
}

function connectUpstreamOptions() {
  if (!API_KEY) return;
  if (upstreamOptions) {
    try {
      upstreamOptions.close();
    } catch {
      // ignore
    }
  }

  upstreamOptionsAuthed = false;
  latest.status.options.connected = false;
  latest.status.options.authenticated = false;
  latest.status.options.lastMessageTs = null;
  upstreamOptions = new WebSocket(WS_OPTIONS_URL);

  upstreamOptions.on('open', () => {
    latest.status.options.connected = true;
    upstreamOptions.send(JSON.stringify({ action: 'auth', params: API_KEY }));
  });

  upstreamOptions.on('message', (buf) => {
    const messages = safeJsonParse(buf.toString());
    if (!messages) return;
    const list = Array.isArray(messages) ? messages : [messages];
    for (const msg of list) {
      latest.status.options.lastMessageTs = Date.now();
      latest.status.options.counters.msgs += 1;
      if (msg?.ev === 'status') {
        if (msg.status === 'auth_success') {
          upstreamOptionsAuthed = true;
          latest.status.options.authenticated = true;
          // Subscribe to current set if we have one
          if (currentOptionSubs.size) {
            upstreamOptions.send(JSON.stringify({ action: 'subscribe', params: Array.from(currentOptionSubs).join(',') }));
          }
          recomputeFlow(latest.dealer.flow.windowSec || 30);
          wsBroadcast(wss, { type: 'DEALER_FLOW', data: latest.dealer.flow });
        }
        continue;
      }
      if (!upstreamOptionsAuthed) continue;

      // Options trade events: Polygon uses ev:'T' with msg.sym as option ticker (e.g. "O:SPY...")
      if (msg?.ev === 'T' && msg.sym && String(msg.sym).startsWith('O:')) {
        latest.status.options.counters.trades += 1;
        const ticker = String(msg.sym);
        const g = optionGreeksByTicker.get(ticker);
        if (!g) continue; // only track what we have greeks for (real)

        const size = Number(msg.s || 0);
        const ts = Number(msg.t || Date.now());
        if (!size) continue;
        latest.status.options.lastTradeTs = ts;

        const under = g.underlying;
        const spot = under === 'SPX' ? Number(latest.SPX?.price) : under === 'SPY' ? Number(latest.SPY?.price) : null;
        if (!spot) continue;

        const delta = Number(g.delta || 0);
        const gamma = Number(g.gamma || 0);
        const dealerSign = g.type === 'call' ? -1 : 1;

        const deltaNotional = dealerSign * delta * size * 100 * spot;
        const gammaNotional = dealerSign * gamma * size * 100 * spot * spot;

        optionFlowEvents.push({ ts, underlying: under, deltaNotional, gammaNotional });
        pruneFlow((latest.dealer.flow.windowSec || 30) * 1000);
        recomputeFlow(latest.dealer.flow.windowSec || 30);
        wsBroadcast(wss, { type: 'DEALER_FLOW', data: latest.dealer.flow });
      }
    }
  });

  upstreamOptions.on('close', () => scheduleReconnectOptions());
  upstreamOptions.on('error', () => scheduleReconnectOptions());
}

function scheduleReconnectOptions() {
  if (reconnectTimerOptions) return;
  reconnectTimerOptions = setTimeout(() => {
    reconnectTimerOptions = null;
    connectUpstreamOptions();
  }, 2000);
}

// ----------------------------
// Options analytics (dealer positioning): real data only
// ----------------------------

function normalCDF(x) {
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

function normalPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function calcVannaCharm(spot, strike, tteYears, iv, r = 0.05) {
  if (!spot || !strike || !tteYears || tteYears <= 0 || !iv || iv <= 0) return null;
  const sqrtT = Math.sqrt(tteYears);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * iv * iv) * tteYears) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  const npd1 = normalPDF(d1);
  const vanna = -npd1 * d2 / iv;
  const charm = -npd1 * (2 * r * tteYears - d2 * iv * sqrtT) / (2 * tteYears * iv * sqrtT);
  return { vanna, charm };
}

function pickNearestExpiry(contracts) {
  const today = new Date().toISOString().slice(0, 10);
  const exps = Array.from(
    new Set(
      contracts
        .map((c) => c?.details?.expiration_date)
        .filter((d) => typeof d === 'string' && d >= today)
    )
  ).sort();
  return exps[0] || null;
}

function pickExpiryBlend(contracts) {
  const today = new Date().toISOString().slice(0, 10);
  const expirations = Array.from(
    new Set(
      contracts
        .map((c) => c?.details?.expiration_date)
        .filter((d) => typeof d === 'string' && d >= today)
    )
  ).sort();

  const d0 = expirations.includes(today) ? today : null;
  const weekly = expirations.find((d) => d > today) || null;
  return { d0, weekly };
}

async function fetchOptionsSnapshot(underlying) {
  // Uses snapshot endpoint; follows next_url a few times (real data only).
  const out = [];
  let url = `${REST_BASE_URL}/v3/snapshot/options/${encodeURIComponent(underlying)}?limit=250&apiKey=${encodeURIComponent(API_KEY)}`;
  for (let i = 0; i < 5; i += 1) {
    const json = await fetchJson(url);
    if (Array.isArray(json?.results)) out.push(...json.results);
    if (!json?.next_url) break;
    url = `${json.next_url}${json.next_url.includes('?') ? '&' : '?'}apiKey=${encodeURIComponent(API_KEY)}`;
  }
  return out;
}

function computeDealerProfile({ spot, vix, contracts, expiration, underlying }) {
  const perStrike = new Map();
  let netGEX = 0;
  let netVanna = 0;
  let netCharm = 0;

  const now = Date.now();
  const expMs = expiration ? new Date(`${expiration}T16:00:00-04:00`).getTime() : null;
  const tteYears = expMs ? Math.max(1 / 365, (expMs - now) / (365 * 24 * 60 * 60 * 1000)) : 7 / 365;

  for (const c of contracts) {
    const d = c.details;
    if (!d) continue;
    if (expiration && d.expiration_date !== expiration) continue;
    const strike = Number(d.strike_price);
    const type = d.contract_type; // call|put
    const oi = Number(c.open_interest || 0);
    if (!strike || !oi) continue;

    const gamma = Number(c.greeks?.gamma || 0);
    const iv = Number(c.implied_volatility || 0);
    const scale = oi * 100;
    const gex = gamma * scale * spot * spot / 1e6;
    const sign = type === 'call' ? -1 : 1; // dealer assumed opposite customer long

    const vc = calcVannaCharm(spot, strike, tteYears, iv || (vix ? vix / 100 : 0.2));
    const vanna = vc?.vanna ? vc.vanna * scale : 0;
    const charm = vc?.charm ? vc.charm * scale : 0;

    netGEX += sign * gex;
    netVanna += sign * vanna;
    netCharm += sign * charm;

    if (!perStrike.has(strike)) {
      perStrike.set(strike, { strike, netGEX: 0, callGEX: 0, putGEX: 0, callOI: 0, putOI: 0 });
    }
    const s = perStrike.get(strike);
    if (type === 'call') {
      s.callGEX += sign * gex;
      s.callOI += oi;
    } else {
      s.putGEX += sign * gex;
      s.putOI += oi;
    }
    s.netGEX = s.callGEX + s.putGEX;
  }

  const strikes = Array.from(perStrike.values()).sort((a, b) => a.strike - b.strike);
  // Gamma flip: nearest strike where netGEX crosses 0 when traversing strikes
  let gammaFlip = null;
  for (let i = 1; i < strikes.length; i += 1) {
    if (strikes[i - 1].netGEX === 0) {
      gammaFlip = strikes[i - 1].strike;
      break;
    }
    if (strikes[i - 1].netGEX * strikes[i].netGEX < 0) {
      gammaFlip = strikes[i].strike;
      break;
    }
  }

  // Call wall: most negative netGEX above spot; Put wall: most positive below spot
  const above = strikes.filter((s) => s.strike >= spot);
  const below = strikes.filter((s) => s.strike <= spot);
  above.sort((a, b) => a.netGEX - b.netGEX); // most negative first
  below.sort((a, b) => b.netGEX - a.netGEX); // most positive first
  const callWall = above[0]?.strike ?? null;
  const putWall = below[0]?.strike ?? null;

  return {
    available: true,
    timestamp: new Date().toISOString(),
    underlying,
    spot,
    vix,
    expiration,
    contracts: contracts.length,
    net: { gex: netGEX, vanna: netVanna, charm: netCharm },
    levels: { gammaFlip, callWall, putWall },
    perStrike: strikes,
  };
}

function blendProfiles(p0, pw, weights = { d0: 0.65, weekly: 0.35 }) {
  const has0 = p0?.available;
  const hasW = pw?.available;
  if (!has0 && !hasW) return { available: false, reason: 'no_profiles' };

  const w0 = has0 && hasW ? weights.d0 : has0 ? 1 : 0;
  const wW = has0 && hasW ? weights.weekly : hasW ? 1 : 0;

  const perStrike = new Map();
  const add = (p, w) => {
    for (const s of p.perStrike || []) {
      if (!perStrike.has(s.strike)) perStrike.set(s.strike, { strike: s.strike, netGEX: 0, callGEX: 0, putGEX: 0, callOI: 0, putOI: 0 });
      const t = perStrike.get(s.strike);
      t.netGEX += (s.netGEX || 0) * w;
      t.callGEX += (s.callGEX || 0) * w;
      t.putGEX += (s.putGEX || 0) * w;
      t.callOI += (s.callOI || 0) * w;
      t.putOI += (s.putOI || 0) * w;
    }
  };

  if (has0) add(p0, w0);
  if (hasW) add(pw, wW);

  const strikes = Array.from(perStrike.values()).sort((a, b) => a.strike - b.strike);
  let gammaFlip = null;
  for (let i = 1; i < strikes.length; i += 1) {
    if (strikes[i - 1].netGEX === 0) {
      gammaFlip = strikes[i - 1].strike;
      break;
    }
    if (strikes[i - 1].netGEX * strikes[i].netGEX < 0) {
      gammaFlip = strikes[i].strike;
      break;
    }
  }
  const spot = (has0 ? p0.spot : pw.spot) ?? null;
  const above = strikes.filter((s) => spot != null && s.strike >= spot).sort((a, b) => a.netGEX - b.netGEX);
  const below = strikes.filter((s) => spot != null && s.strike <= spot).sort((a, b) => b.netGEX - a.netGEX);
  const callWall = above[0]?.strike ?? null;
  const putWall = below[0]?.strike ?? null;

  const net = {
    gex: (has0 ? p0.net.gex * w0 : 0) + (hasW ? pw.net.gex * wW : 0),
    vanna: (has0 ? p0.net.vanna * w0 : 0) + (hasW ? pw.net.vanna * wW : 0),
    charm: (has0 ? p0.net.charm * w0 : 0) + (hasW ? pw.net.charm * wW : 0),
  };

  return {
    available: true,
    timestamp: new Date().toISOString(),
    underlying: has0 ? p0.underlying : pw.underlying,
    spot,
    expiration: { d0: has0 ? p0.expiration : null, weekly: hasW ? pw.expiration : null },
    net,
    levels: { gammaFlip, callWall, putWall },
    perStrike: strikes,
    weights: { d0: w0, weekly: wW },
  };
}

let lastDealerSPX = null;
let lastDealerSPY = null;

function computeSync() {
  const notes = [];
  const spxSpot = Number(latest.SPX?.price) || null;
  const spySpot = Number(latest.SPY?.price) || null;
  if (!spxSpot || !spySpot) {
    latest.dealer.sync = { available: false, timestamp: new Date().toISOString(), spxSpot, spySpot, notes: ['Waiting for both SPX and SPY spots'] };
    return;
  }

  const spyToSpx = spySpot * 10;
  const basis = spxSpot - spyToSpx;
  const basisPct = (basis / spxSpot) * 100;

  const spx = latest.dealer.spx;
  const spy = latest.dealer.spy;

  let agreement = 50;
  if (spx?.available && spy?.available) {
    const s1 = Math.sign(spx.net?.gex || 0);
    const s2 = Math.sign(spy.net?.gex || 0);
    if (s1 !== 0 && s2 !== 0 && s1 === s2) {
      agreement += 25;
      notes.push('SPX+SPY dealer gamma agree (same sign)');
    } else if (s1 !== 0 && s2 !== 0 && s1 !== s2) {
      agreement -= 20;
      notes.push('SPX vs SPY dealer gamma disagree (sign mismatch)');
    }

    const dv1 = Math.sign(spx.changes?.netVanna || 0);
    const dv2 = Math.sign(spy.changes?.netVanna || 0);
    if (dv1 !== 0 && dv2 !== 0 && dv1 === dv2) {
      agreement += 10;
      notes.push('Vanna change agrees');
    }

    const dc1 = Math.sign(spx.changes?.netCharm || 0);
    const dc2 = Math.sign(spy.changes?.netCharm || 0);
    if (dc1 !== 0 && dc2 !== 0 && dc1 === dc2) {
      agreement += 10;
      notes.push('Charm change agrees');
    }
  } else {
    notes.push('Waiting for both SPX and SPY options snapshots');
  }

  // basis sanity
  if (Math.abs(basisPct) > 1.0) notes.push('Large SPX-SPY basis (check data timing)');

  agreement = Math.max(0, Math.min(100, agreement));

  latest.dealer.sync = {
    available: true,
    timestamp: new Date().toISOString(),
    spxSpot,
    spySpot,
    spyToSpx,
    basis,
    basisPct,
    agreement,
    notes,
  };
}

async function pollDealerProfile() {
  if (!API_KEY) return;
  try {
    // keep flow window aligned to config (seconds-level)
    latest.dealer.flow.windowSec = CFG.flowWindowSec;

    const spxSpot = Number(latest.SPX?.price);
    const spySpot = Number(latest.SPY?.price);
    const vix = Number(latest.VIX?.value);

    const [spxContracts, spyContracts] = await Promise.all([fetchOptionsSnapshot('SPX'), fetchOptionsSnapshot('SPY')]);

    // SPX profile
    if (!spxSpot) {
      latest.dealer.spx = { ...latest.dealer.spx, available: false, reason: 'no_spx_spot_yet', timestamp: new Date().toISOString() };
    } else if (!spxContracts.length) {
      latest.dealer.spx = { ...latest.dealer.spx, available: false, reason: 'no_spx_contracts', timestamp: new Date().toISOString() };
    } else {
      const exps = pickExpiryBlend(spxContracts);
      const d0 = exps.d0 ? computeDealerProfile({ spot: spxSpot, vix, contracts: spxContracts, expiration: exps.d0, underlying: 'SPX' }) : null;
      const wk = exps.weekly ? computeDealerProfile({ spot: spxSpot, vix, contracts: spxContracts, expiration: exps.weekly, underlying: 'SPX' }) : null;
      const blend = blendProfiles(d0, wk);

      const composite = {
        available: Boolean(blend?.available),
        reason: blend?.available ? null : blend?.reason || 'unavailable',
        timestamp: new Date().toISOString(),
        underlying: 'SPX',
        spot: spxSpot,
        vix,
        expirations: exps,
        d0,
        weekly: wk,
        blend,
      };

      if (lastDealerSPX?.blend?.available && composite.blend?.available) {
        composite.changes = {
          netGEX: composite.blend.net.gex - lastDealerSPX.blend.net.gex,
          netVanna: composite.blend.net.vanna - lastDealerSPX.blend.net.vanna,
          netCharm: composite.blend.net.charm - lastDealerSPX.blend.net.charm,
          gammaFlip: (composite.blend.levels.gammaFlip ?? 0) - (lastDealerSPX.blend.levels.gammaFlip ?? 0),
        };
      }

      lastDealerSPX = composite;
      latest.dealer.spx = composite;
      wsBroadcast(wss, { type: 'DEALER_PROFILE_SPX', data: composite });
    }

    // SPY profile (native SPY strikes)
    if (!spySpot) {
      latest.dealer.spy = { ...latest.dealer.spy, available: false, reason: 'no_spy_spot_yet', timestamp: new Date().toISOString() };
    } else if (!spyContracts.length) {
      latest.dealer.spy = { ...latest.dealer.spy, available: false, reason: 'no_spy_contracts', timestamp: new Date().toISOString() };
    } else {
      const exps = pickExpiryBlend(spyContracts);
      const d0 = exps.d0 ? computeDealerProfile({ spot: spySpot, vix, contracts: spyContracts, expiration: exps.d0, underlying: 'SPY' }) : null;
      const wk = exps.weekly ? computeDealerProfile({ spot: spySpot, vix, contracts: spyContracts, expiration: exps.weekly, underlying: 'SPY' }) : null;
      const blend = blendProfiles(d0, wk);

      const composite = {
        available: Boolean(blend?.available),
        reason: blend?.available ? null : blend?.reason || 'unavailable',
        timestamp: new Date().toISOString(),
        underlying: 'SPY',
        spot: spySpot,
        vix,
        expirations: exps,
        d0,
        weekly: wk,
        blend,
      };

      if (lastDealerSPY?.blend?.available && composite.blend?.available) {
        composite.changes = {
          netGEX: composite.blend.net.gex - lastDealerSPY.blend.net.gex,
          netVanna: composite.blend.net.vanna - lastDealerSPY.blend.net.vanna,
          netCharm: composite.blend.net.charm - lastDealerSPY.blend.net.charm,
          gammaFlip: (composite.blend.levels.gammaFlip ?? 0) - (lastDealerSPY.blend.levels.gammaFlip ?? 0),
        };
      }

      lastDealerSPY = composite;
      latest.dealer.spy = composite;
      wsBroadcast(wss, { type: 'DEALER_PROFILE_SPY', data: composite });
    }

    computeSync();
    wsBroadcast(wss, { type: 'DEALER_SYNC', data: latest.dealer.sync });

    // Update options WS subscriptions to track seconds-level flow around ATM for 0DTE+weekly.
    // We only subscribe to a limited set to keep it efficient.
    const subTickers = new Set();
    optionGreeksByTicker.clear();

    const addSubs = (composite, underlying) => {
      const spotPx = Number(composite?.spot);
      if (!spotPx || !composite?.blend?.available) return;
      const near = (arr) =>
        (arr || [])
          .filter((s) => Math.abs(Number(s.strike) - spotPx) <= (underlying === 'SPX' ? 100 : 10))
          .sort((a, b) => Math.abs(Number(a.strike) - spotPx) - Math.abs(Number(b.strike) - spotPx))
          .slice(0, 40);

      // Use snapshot contracts to map tickers -> greeks; prefer 0DTE + weekly expirations.
      const expirations = [composite.expirations?.d0, composite.expirations?.weekly].filter(Boolean);
      const contracts = underlying === 'SPX' ? spxContracts : spyContracts;

      // Build a quick index: strike+type+exp -> ticker+greeks
      for (const c of contracts) {
        const d = c.details;
        if (!d) continue;
        if (!expirations.includes(d.expiration_date)) continue;
        const strike = Number(d.strike_price);
        const type = d.contract_type;
        const ticker = d.ticker;
        if (!ticker) continue;
        if (Math.abs(strike - (underlying === 'SPX' ? spotPx : spotPx)) > (underlying === 'SPX' ? 100 : 10)) continue;

        // store greeks for flow inference
        optionGreeksByTicker.set(ticker, {
          delta: Number(c.greeks?.delta || 0),
          gamma: Number(c.greeks?.gamma || 0),
          type,
          underlying,
        });
      }

      // Subscribe to tickers we have greeks for
      for (const [ticker, g] of optionGreeksByTicker) {
        if (g.underlying !== underlying) continue;
        // Options WS uses trade channel "T.<ticker>"
        subTickers.add(`T.${ticker}`);
      }
    };

    if (latest.dealer.spx?.available) addSubs(latest.dealer.spx, 'SPX');
    if (latest.dealer.spy?.available) addSubs(latest.dealer.spy, 'SPY');

    // Apply new subscriptions (diff)
    const next = subTickers;
    const toAdd = Array.from(next).filter((x) => !currentOptionSubs.has(x));
    const toRemove = Array.from(currentOptionSubs).filter((x) => !next.has(x));
    currentOptionSubs = next;

    if (upstreamOptionsAuthed && upstreamOptions) {
      if (toRemove.length) upstreamOptions.send(JSON.stringify({ action: 'unsubscribe', params: toRemove.join(',') }));
      if (toAdd.length) upstreamOptions.send(JSON.stringify({ action: 'subscribe', params: toAdd.join(',') }));
    }
  } catch (e) {
    latest.dealer.spx = { ...latest.dealer.spx, available: false, reason: String(e?.message || e), timestamp: new Date().toISOString() };
    latest.dealer.spy = { ...latest.dealer.spy, available: false, reason: String(e?.message || e), timestamp: new Date().toISOString() };
    computeSync();
  }
}

function pushAlert(alert) {
  latest.alerts.unshift(alert);
  if (latest.alerts.length > 200) latest.alerts.pop();
  wsBroadcast(wss, { type: 'ALERT', data: alert });
}

function scoreMove15({ spot, bars, dealer }) {
  // dealer now has spx/spy/sync; require at least SPX options for primary.
  if (!spot || !bars?.length || !dealer?.spx?.blend?.available) return null;
  // Simple first-pass engine (real data only):
  // - negative gamma + price accelerating away from flip + near a wall => higher probability of 15pt move
  const last = bars[0];
  const prev = bars[1];
  if (!last || !prev) return null;
  const momentum = last.close - prev.close;
  const flip = dealer.spx.blend.levels.gammaFlip;
  const call = dealer.spx.blend.levels.callWall;
  const put = dealer.spx.blend.levels.putWall;
  let score = 0;
  const reasons = [];

  if (dealer.spx.blend.net.gex < 0) {
    score += 25;
    reasons.push('SPX net dealer gamma < 0 (amplification regime)');
  } else {
    score += 5;
    reasons.push('SPX net dealer gamma > 0 (dampening regime)');
  }

  const distFlip = flip != null ? spot - flip : 0;
  if (Math.abs(distFlip) > 10) {
    score += 10;
    reasons.push('Price displaced from gamma flip');
  }

  if (momentum > 3) {
    score += 20;
    reasons.push('Upward momentum (last bar)');
  } else if (momentum < -3) {
    score += 20;
    reasons.push('Downward momentum (last bar)');
  }

  if (call && spot > call - 10) {
    score += 15;
    reasons.push('Near call wall');
  }
  if (put && spot < put + 10) {
    score += 15;
    reasons.push('Near put wall');
  }

  // Cross-confirmation: SPY options agree with SPX options
  if (dealer.spy?.blend?.available && dealer.sync?.available) {
    const s1 = Math.sign(dealer.spx.blend.net.gex || 0);
    const s2 = Math.sign(dealer.spy.blend.net.gex || 0);
    if (s1 !== 0 && s2 !== 0 && s1 === s2) {
      score += 10;
      reasons.push('SPY options confirm SPX gamma sign');
    }
    if ((dealer.sync.agreement || 0) >= 75) {
      score += 5;
      reasons.push('High SPX↔SPY dealer agreement');
    }
  }

  const direction = momentum >= 0 ? 'UP' : 'DOWN';

  // Seconds-level flow impulse (options WS)
  if (dealer.flow?.available) {
    const f = dealer.flow;
    const flow = f.spx?.gammaNotional || 0;
    if (direction === 'UP' && flow < 0) {
      score += 8;
      reasons.push('SPX options flow implies hedging buy impulse');
    }
    if (direction === 'DOWN' && flow > 0) {
      score += 8;
      reasons.push('SPX options flow implies hedging sell impulse');
    }
  }

  return {
    score,
    direction,
    headsUp: score >= CFG.headsUpMinScore,
    trigger: score >= CFG.triggerMinScore,
    reasons,
  };
}

let lastAlertTs = 0;
let lastHeadsUpTs = 0;
function maybeEmitMoveAlert() {
  const spot = Number(latest.SPX?.price);
  const bars = latest.bars.SPX;
  const dealer = latest.dealer;
  const s = scoreMove15({ spot, bars, dealer });
  const now = Date.now();
  if (!s) return;
  resetDailyBudgetIfNeeded(now);

  const dealerPayload = {
    spx: dealer.spx?.blend?.available
      ? {
          netGEX: dealer.spx.blend.net?.gex,
          gammaFlip: dealer.spx.blend.levels?.gammaFlip,
          callWall: dealer.spx.blend.levels?.callWall,
          putWall: dealer.spx.blend.levels?.putWall,
          expirations: dealer.spx.expirations,
        }
      : null,
    spy: dealer.spy?.blend?.available
      ? {
          netGEX: dealer.spy.blend.net?.gex,
          gammaFlip: dealer.spy.blend.levels?.gammaFlip,
          callWall: dealer.spy.blend.levels?.callWall,
          putWall: dealer.spy.blend.levels?.putWall,
          expirations: dealer.spy.expirations,
        }
      : null,
    sync: dealer.sync || null,
    flow: dealer.flow || null,
  };

  // Tier 1: HEADS-UP (high recall, low spam)
  if (s.headsUp && now - lastHeadsUpTs >= CFG.headsUpCooldownMs && dailyBudget.headsUp < CFG.maxHeadsUpPerDay) {
    lastHeadsUpTs = now;
    dailyBudget.headsUp += 1;
    pushAlert({
      type: 'MOVE_15PT_HEADS_UP',
      tier: 'HEADS_UP',
      ts: now,
      spot,
      direction: s.direction,
      score: s.score,
      reasons: s.reasons,
      plan: buildTradePlan({ ts: now, spot, direction: s.direction, dealer: dealerPayload }),
      dealer: dealerPayload,
    });
  }

  // Tier 2: TRIGGER (high precision, confirmation required)
  // Confirmation: (a) score threshold, (b) fresh options profile, (c) fresh SPX bar, (d) dealer agreement not terrible
  const dealerFresh = dealer.spx?.blend?.timestamp ? now - Date.parse(dealer.spx.blend.timestamp) < CFG.dealerFreshMs : false;
  const barFresh = latest.status.lastSPXBarTs ? now - Number(latest.status.lastSPXBarTs) < CFG.barFreshMs : false;
  const tickFresh = latest.status.lastSPXTs ? now - Number(latest.status.lastSPXTs) < CFG.tickFreshMs : false;
  const flowFresh = dealer.flow?.timestamp ? now - Date.parse(dealer.flow.timestamp) < CFG.flowFreshMs : false;
  const agreement = Number(dealer.sync?.agreement || 0);
  const okAgreement = !dealer.sync?.available || agreement >= CFG.minAgreement;
  const okSession = isRthNowET(now);

  // Discipline: TRIGGER requires seconds-level freshness (tick + flow) and a reasonably fresh dealer snapshot.
  if (s.trigger && tickFresh && flowFresh && dealerFresh && barFresh && okAgreement && okSession) {
    if (now - lastAlertTs < CFG.triggerCooldownMs) return; // max trigger rate
    if (dailyBudget.triggers >= CFG.maxTriggersPerDay) return;
    lastAlertTs = now;
    dailyBudget.triggers += 1;
    pushAlert({
      type: 'MOVE_15PT_TRIGGER',
      tier: 'TRIGGER',
      ts: now,
      spot,
      direction: s.direction,
      score: s.score,
      reasons: [...s.reasons, 'Trigger confirmations passed'],
      plan: buildTradePlan({ ts: now, spot, direction: s.direction, dealer: dealerPayload }),
      dealer: dealerPayload,
    });
  }
}

server.listen(PORT, () => {
  // Intentionally do NOT log keys.
  // eslint-disable-next-line no-console
  console.log(`Titan Omega backend listening on :${PORT}`);
  connectUpstream();
  connectUpstreamStocks();
  connectUpstreamOptions();

  // Options + alerts loops (real data only)
  pollDealerProfile();
  setInterval(pollDealerProfile, CFG.optionsPollMs); // refresh dealer profile cadence
  setInterval(maybeEmitMoveAlert, 5_000); // evaluate alert engine every 5s

  // 1Hz dashboard state stream (real inputs, no extra API calls)
  setInterval(broadcastState, CFG.stateBroadcastMs);

  // 1Hz flow recompute even if no trades (keeps freshness honest)
  setInterval(() => {
    latest.dealer.flow.windowSec = CFG.flowWindowSec;
    recomputeFlow(CFG.flowWindowSec);
  }, 1000);
});

