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
const REST_BASE_URL = 'https://api.polygon.io';

const app = express();
const server = http.createServer(app);

// Latest snapshot cached in-memory (and served to new WS clients).
const latest = {
  status: { connected: false, authenticated: false },
  SPX: null,
  VIX: null,
  bars: {
    SPX: [], // newest-first, minute bars from AM.I:SPX
  },
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
  res.json({
    ok: true,
    hasKey: Boolean(API_KEY),
    tokenProtected: Boolean(PROXY_TOKEN),
    wsUrl: WS_INDICES_URL,
    connected: latest.status.connected,
    authenticated: latest.status.authenticated,
  });
});

app.get('/api/prev', async (_req, res) => {
  if (!requireToken(_req, res)) return;
  if (!API_KEY) return res.status(400).json({ ok: false, error: 'Missing server API key (set MASSIVE_API_KEY)' });
  try {
    const [spx, vix] = await Promise.all([
      fetchJson(`${REST_BASE_URL}/v2/aggs/ticker/I:SPX/prev?apiKey=${encodeURIComponent(API_KEY)}`),
      fetchJson(`${REST_BASE_URL}/v2/aggs/ticker/I:VIX/prev?apiKey=${encodeURIComponent(API_KEY)}`),
    ]);
    res.json({
      ok: true,
      spx: spx?.results?.[0] || null,
      vix: vix?.results?.[0] || null,
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

// Provider socket (upstream)
let upstream = null;
let upstreamAuthed = false;
let reconnectTimer = null;

function connectUpstream() {
  if (!API_KEY) {
    latest.status = { connected: false, authenticated: false, error: 'missing_key' };
    return;
  }

  if (upstream) {
    try {
      upstream.close();
    } catch {
      // ignore
    }
  }

  upstreamAuthed = false;
  latest.status = { connected: false, authenticated: false };
  wsBroadcast(wss, { type: 'status', status: latest.status });

  upstream = new WebSocket(WS_INDICES_URL);

  upstream.on('open', () => {
    latest.status = { connected: true, authenticated: false };
    wsBroadcast(wss, { type: 'status', status: latest.status });
    upstream.send(JSON.stringify({ action: 'auth', params: API_KEY }));
  });

  upstream.on('message', (buf) => {
    const messages = safeJsonParse(buf.toString());
    if (!messages) return;
    const list = Array.isArray(messages) ? messages : [messages];

    for (const msg of list) {
      if (msg?.ev === 'status') {
        if (msg.status === 'auth_success') {
          upstreamAuthed = true;
          latest.status = { connected: true, authenticated: true };
          wsBroadcast(wss, { type: 'status', status: latest.status });
          upstream.send(JSON.stringify({ action: 'subscribe', params: 'V.I:SPX,V.I:VIX,AM.I:SPX,AM.I:VIX' }));
        } else if (msg.status === 'auth_failed') {
          latest.status = { connected: false, authenticated: false, error: msg.message || 'auth_failed' };
          wsBroadcast(wss, { type: 'status', status: latest.status });
        }
        continue;
      }

      if (!upstreamAuthed) continue;

      if (msg?.ev === 'V') {
        const sym = String(msg.T || '').replace('I:', '');
        const val = Number(msg.val ?? msg.v);
        const ts = msg.t || Date.now();
        if (sym === 'SPX') {
          latest.SPX = { price: val, timestamp: ts, source: 'WS_V' };
          wsBroadcast(wss, { type: 'SPX', data: latest.SPX });
        } else if (sym === 'VIX') {
          latest.VIX = { value: val, timestamp: ts, source: 'WS_V' };
          wsBroadcast(wss, { type: 'VIX', data: latest.VIX });
        }
        continue;
      }

      // Aggregate minute bars (real bars)
      if (msg?.ev === 'AM') {
        const sym = String(msg.sym || msg.T || '').replace('I:', '');
        if (sym !== 'SPX') continue;

        const bar = {
          timestamp: msg.s || Date.now(),
          open: msg.o,
          high: msg.h,
          low: msg.l,
          close: msg.c,
          volume: msg.v,
          source: 'WS_AM',
        };

        latest.bars.SPX.unshift(bar);
        if (latest.bars.SPX.length > 500) latest.bars.SPX.pop();

        // Keep spot synced from close
        latest.SPX = { price: bar.close, timestamp: bar.timestamp, source: 'WS_AM' };
        wsBroadcast(wss, { type: 'SPX', data: latest.SPX });
        wsBroadcast(wss, { type: 'SPX_BAR', data: bar });
      }
    }
  });

  upstream.on('close', () => {
    latest.status = { connected: false, authenticated: false, error: 'closed' };
    wsBroadcast(wss, { type: 'status', status: latest.status });
    scheduleReconnect();
  });

  upstream.on('error', () => {
    latest.status = { connected: false, authenticated: false, error: 'error' };
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

server.listen(PORT, () => {
  // Intentionally do NOT log keys.
  // eslint-disable-next-line no-console
  console.log(`Titan Omega backend listening on :${PORT}`);
  connectUpstream();
});

