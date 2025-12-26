/**
 * MassiveService (Polygon-backed)
 *
 * Provides:
 * - WebSocket streaming for indices (SPX/VIX) via Polygon
 * - REST fallback to previous day aggregates
 * - After-hours persistence via localStorage
 *
 * Env:
 * - Prefer `VITE_POLYGON_API_KEY`, fall back to `VITE_MASSIVE_API_KEY`.
 */

const API_KEY = import.meta.env.VITE_POLYGON_API_KEY || import.meta.env.VITE_MASSIVE_API_KEY;
const BASE_URL = 'https://api.polygon.io';
const STORAGE_KEY = 'titan_omega_session_v1';

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

class MassiveService {
  constructor() {
    this.ws = null;
    this.connected = { indices: false };
    this.authenticated = { indices: false };
    this.data = {
      SPX: null,
      VIX: null,
      bars: { SPX: [] },
    };

    this.onDataUpdate = null;
    this.onConnectionStatus = null;
    this.onError = null;

    this.lastSession = this.loadLastSession();
  }

  loadLastSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  saveSession() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          data: this.data,
        })
      );
    } catch {
      // ignore
    }
  }

  getLastSession() {
    return this.lastSession;
  }

  setCallbacks({ onDataUpdate, onConnectionStatus, onError }) {
    if (onDataUpdate) this.onDataUpdate = onDataUpdate;
    if (onConnectionStatus) this.onConnectionStatus = onConnectionStatus;
    if (onError) this.onError = onError;
  }

  disconnectAll() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;
    this.connected.indices = false;
    this.authenticated.indices = false;
  }

  isConnected(type = 'indices') {
    return Boolean(this.authenticated[type]);
  }

  getData() {
    return {
      ...this.data,
      connected: { ...this.connected },
      authenticated: { ...this.authenticated },
      timestamp: new Date(),
    };
  }

  getSPXPrice() {
    return this.data.SPX || this.lastSession?.data?.SPX || null;
  }

  getVIX() {
    return this.data.VIX || this.lastSession?.data?.VIX || null;
  }

  getBars(symbol = 'SPX', limit = 100) {
    const bars = this.data.bars[symbol] || [];
    return bars.slice(0, limit);
  }

  async fetchPreviousDayData() {
    if (!API_KEY) return null;

    const [spxRes, vixRes] = await Promise.all([
      fetch(`${BASE_URL}/v2/aggs/ticker/I:SPX/prev?apiKey=${encodeURIComponent(API_KEY)}`),
      fetch(`${BASE_URL}/v2/aggs/ticker/I:VIX/prev?apiKey=${encodeURIComponent(API_KEY)}`),
    ]);

    const spxJson = await spxRes.json();
    const vixJson = await vixRes.json();

    const spx = spxJson?.results?.[0];
    if (spx) {
      this.data.SPX = {
        price: spx.c,
        open: spx.o,
        high: spx.h,
        low: spx.l,
        volume: spx.v,
        timestamp: new Date(spx.t),
        source: 'REST_PREV_DAY',
      };
    }

    const vix = vixJson?.results?.[0];
    if (vix) {
      this.data.VIX = {
        value: vix.c,
        open: vix.o,
        high: vix.h,
        low: vix.l,
        timestamp: new Date(vix.t),
        source: 'REST_PREV_DAY',
      };
    }

    this.saveSession();
    return this.data;
  }

  connectIndices() {
    if (!API_KEY) {
      throw new Error('API key not configured (set VITE_POLYGON_API_KEY)');
    }

    const endpoint = 'wss://socket.polygon.io/indices';
    this.disconnectAll();

    const ws = new WebSocket(endpoint);
    this.ws = ws;

    ws.onopen = () => {
      this.connected.indices = true;
      this.onConnectionStatus?.({ type: 'indices', connected: true, status: 'connected' });
      ws.send(JSON.stringify({ action: 'auth', params: API_KEY }));
    };

    ws.onmessage = (event) => {
      const messages = safeJsonParse(event.data);
      if (!messages) return;
      const list = Array.isArray(messages) ? messages : [messages];

      for (const msg of list) {
        if (msg?.ev === 'status') {
          if (msg.status === 'auth_success') {
            this.authenticated.indices = true;
            this.onConnectionStatus?.({ type: 'indices', connected: true, status: 'authenticated' });
            ws.send(JSON.stringify({ action: 'subscribe', params: 'V.I:SPX,V.I:VIX,AM.I:SPX,AM.I:VIX' }));
          } else if (msg.status === 'auth_failed') {
            this.authenticated.indices = false;
            this.onError?.(msg.message || 'auth_failed');
            this.onConnectionStatus?.({ type: 'indices', connected: false, status: 'auth_failed' });
          }
          continue;
        }

        if (msg?.ev === 'V') {
          const sym = String(msg.T || '').replace('I:', '');
          const val = Number(msg.val ?? msg.v);
          const t = msg.t ? new Date(msg.t) : new Date();

          if (sym === 'SPX') {
            this.data.SPX = { price: val, timestamp: t, source: 'WS_V' };
            this.saveSession();
            this.onDataUpdate?.('index', 'SPX', this.data);
          } else if (sym === 'VIX') {
            this.data.VIX = { value: val, timestamp: t, source: 'WS_V' };
            this.saveSession();
            this.onDataUpdate?.('index', 'VIX', this.data);
          }
          continue;
        }

        if (msg?.ev === 'AM') {
          const sym = String(msg.sym || '').replace('I:', '');
          if (sym !== 'SPX') continue;

          const bar = {
            timestamp: msg.s ? new Date(msg.s) : new Date(),
            open: msg.o,
            high: msg.h,
            low: msg.l,
            close: msg.c,
            volume: msg.v,
            source: 'WS_AM',
          };

          this.data.bars.SPX.unshift(bar);
          if (this.data.bars.SPX.length > 500) this.data.bars.SPX.pop();

          // Keep last price in sync
          this.data.SPX = { price: bar.close, timestamp: bar.timestamp, source: 'WS_AM' };

          this.saveSession();
          this.onDataUpdate?.('bar', 'SPX', bar);
        }
      }
    };

    ws.onerror = () => {
      this.onError?.('WebSocket error');
      this.connected.indices = false;
      this.authenticated.indices = false;
      this.onConnectionStatus?.({ type: 'indices', connected: false, status: 'error' });
    };

    ws.onclose = () => {
      this.connected.indices = false;
      this.authenticated.indices = false;
      this.onConnectionStatus?.({ type: 'indices', connected: false, status: 'closed' });
    };
  }

  async connectAll() {
    const results = { indices: null, rest: null, errors: [] };

    try {
      this.connectIndices();
      results.indices = { connected: true };
    } catch (e) {
      results.errors.push({ type: 'indices', error: String(e?.message || e) });
    }

    try {
      results.rest = await this.fetchPreviousDayData();
      if (results.rest) this.onDataUpdate?.('initial', 'REST', this.data);
    } catch (e) {
      results.errors.push({ type: 'rest', error: String(e?.message || e) });
    }

    return results;
  }
}

export const massiveService = new MassiveService();
export default massiveService;

