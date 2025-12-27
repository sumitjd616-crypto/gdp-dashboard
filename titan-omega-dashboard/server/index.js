import http from 'node:http';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

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
const REST_BASE_URL = 'https://api.polygon.io';

const app = express();
const server = http.createServer(app);

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
    available: false,
    reason: 'not_loaded',
    timestamp: null,
    underlying: null,
    expiration: null,
    contracts: 0,
    spot: null,
    vix: null,
    net: { gex: null, vanna: null, charm: null },
    levels: { gammaFlip: null, callWall: null, putWall: null },
    perStrike: [], // [{ strike, netGEX, callGEX, putGEX, callOI, putOI }]
    changes: null, // diff vs previous snapshot
  },
  alerts: [], // newest-first
};

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
let reconnectTimer = null;
let reconnectTimerStocks = null;

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

function computeDealerProfile({ spot, vix, contracts, expiration }) {
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
    spot,
    vix,
    expiration,
    contracts: contracts.length,
    net: { gex: netGEX, vanna: netVanna, charm: netCharm },
    levels: { gammaFlip, callWall, putWall },
    perStrike: strikes,
  };
}

let lastDealer = null;
async function pollDealerProfile() {
  if (!API_KEY) return;
  try {
    // Spot and VIX from latest streaming (real)
    const spot = Number(latest.SPX?.price);
    const vix = Number(latest.VIX?.value);
    if (!spot) {
      latest.dealer = { available: false, reason: 'no_spot_yet', timestamp: new Date().toISOString() };
      return;
    }

    // Try SPX options first; fall back to SPY options (still real) if needed
    let underlying = 'SPX';
    let contracts = [];
    try {
      contracts = await fetchOptionsSnapshot('SPX');
    } catch {
      underlying = 'SPY';
      contracts = await fetchOptionsSnapshot('SPY');
    }
    if (!contracts.length) {
      latest.dealer = { available: false, reason: 'no_contracts', timestamp: new Date().toISOString() };
      return;
    }

    const nearest = pickNearestExpiry(contracts);
    const profile = computeDealerProfile({ spot: underlying === 'SPY' ? spot / 10 : spot, vix, contracts, expiration: nearest });

    // If we used SPY options, scale strikes up to SPX-equivalent to display
    if (underlying === 'SPY') {
      profile.spot = spot;
      profile.perStrike = profile.perStrike.map((s) => ({ ...s, strike: s.strike * 10 }));
      if (profile.levels.gammaFlip) profile.levels.gammaFlip *= 10;
      if (profile.levels.callWall) profile.levels.callWall *= 10;
      if (profile.levels.putWall) profile.levels.putWall *= 10;
    }
    profile.underlying = underlying;

    // Changes vs last snapshot (real deltas)
    if (lastDealer?.available) {
      profile.changes = {
        netGEX: profile.net.gex - lastDealer.net.gex,
        netVanna: profile.net.vanna - lastDealer.net.vanna,
        netCharm: profile.net.charm - lastDealer.net.charm,
        gammaFlip: profile.levels.gammaFlip - (lastDealer.levels.gammaFlip || profile.levels.gammaFlip),
        callWall: profile.levels.callWall,
        putWall: profile.levels.putWall,
      };
    }

    lastDealer = profile;
    latest.dealer = profile;
    wsBroadcast(wss, { type: 'DEALER_PROFILE', data: profile });
  } catch (e) {
    latest.dealer = { available: false, reason: String(e?.message || e), timestamp: new Date().toISOString() };
  }
}

function pushAlert(alert) {
  latest.alerts.unshift(alert);
  if (latest.alerts.length > 200) latest.alerts.pop();
  wsBroadcast(wss, { type: 'ALERT', data: alert });
}

function scoreMove15({ spot, bars, dealer }) {
  if (!spot || !bars?.length || !dealer?.available) return null;
  // Simple first-pass engine (real data only):
  // - negative gamma + price accelerating away from flip + near a wall => higher probability of 15pt move
  const last = bars[0];
  const prev = bars[1];
  if (!last || !prev) return null;
  const momentum = last.close - prev.close;
  const atr = null; // keep simple here; can expand
  const flip = dealer.levels.gammaFlip;
  const call = dealer.levels.callWall;
  const put = dealer.levels.putWall;
  let score = 0;
  const reasons = [];

  if (dealer.net.gex < 0) {
    score += 25;
    reasons.push('Net dealer gamma < 0 (amplification regime)');
  } else {
    score += 5;
    reasons.push('Net dealer gamma > 0 (dampening regime)');
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

  const direction = momentum >= 0 ? 'UP' : 'DOWN';
  const threshold = 65;

  return {
    score,
    direction,
    fire: score >= threshold,
    reasons,
  };
}

let lastAlertTs = 0;
function maybeEmitMoveAlert() {
  const spot = Number(latest.SPX?.price);
  const bars = latest.bars.SPX;
  const dealer = latest.dealer;
  const s = scoreMove15({ spot, bars, dealer });
  if (!s?.fire) return;
  const now = Date.now();
  if (now - lastAlertTs < 60_000) return; // 1/min max
  lastAlertTs = now;
  pushAlert({
    type: 'MOVE_15PT',
    ts: now,
    spot,
    direction: s.direction,
    score: s.score,
    reasons: s.reasons,
    dealer: {
      netGEX: dealer.net?.gex,
      gammaFlip: dealer.levels?.gammaFlip,
      callWall: dealer.levels?.callWall,
      putWall: dealer.levels?.putWall,
    },
  });
}

server.listen(PORT, () => {
  // Intentionally do NOT log keys.
  // eslint-disable-next-line no-console
  console.log(`Titan Omega backend listening on :${PORT}`);
  connectUpstream();
  connectUpstreamStocks();

  // Options + alerts loops (real data only)
  pollDealerProfile();
  setInterval(pollDealerProfile, 30_000); // refresh dealer profile every 30s
  setInterval(maybeEmitMoveAlert, 5_000); // evaluate alert engine every 5s
});

