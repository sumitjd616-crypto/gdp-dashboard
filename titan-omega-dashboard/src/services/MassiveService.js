/**
 * MassiveService (secure mode)
 *
 * Frontend talks ONLY to our backend proxy:
 * - WebSocket: `ws(s)://<host>/stream`
 * - REST:      `/api/*`
 *
 * This keeps API keys out of the browser bundle.
 */

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
    this.ws = null; // connection to our backend (/stream)
    this.connected = { backend: false, indices: false };
    this.authenticated = { backend: false, indices: false };
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
    this.connected.backend = false;
    this.authenticated.backend = false;
    this.connected.indices = false;
    this.authenticated.indices = false;
  }

  isConnected(type = 'backend') {
    return Boolean(this.connected[type]);
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
    const res = await fetch('/api/prev');
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'REST /api/prev failed');

    const spx = json?.spx;
    if (spx?.c != null) {
      this.data.SPX = {
        price: spx.c,
        open: spx.o,
        high: spx.h,
        low: spx.l,
        volume: spx.v,
        timestamp: new Date(spx.t),
        source: 'REST_PREV_DAY_PROXY',
      };
    }

    const vix = json?.vix;
    if (vix?.c != null) {
      this.data.VIX = {
        value: vix.c,
        open: vix.o,
        high: vix.h,
        low: vix.l,
        timestamp: new Date(vix.t),
        source: 'REST_PREV_DAY_PROXY',
      };
    }

    this.saveSession();
    return this.data;
  }

  connectIndices() {
    this.disconnectAll();

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const endpoint = `${proto}://${window.location.host}/stream`;
    const ws = new WebSocket(endpoint);
    this.ws = ws;

    ws.onopen = () => {
      this.connected.backend = true;
      this.authenticated.backend = true; // our proxy handles auth upstream
      this.onConnectionStatus?.({ type: 'backend', connected: true, status: 'connected' });
    };

    ws.onmessage = (event) => {
      const messages = safeJsonParse(event.data);
      if (!messages) return;

      // Proxy message formats:
      // - { type: 'snapshot', data: { status, SPX, VIX } }
      // - { type: 'status', status: {...} }
      // - { type: 'SPX', data: {...} }
      // - { type: 'VIX', data: {...} }
      if (messages.type === 'snapshot') {
        const snap = messages.data || {};
        if (snap.SPX) this.data.SPX = snap.SPX;
        if (snap.VIX) this.data.VIX = snap.VIX;
        if (snap.status) {
          this.connected.indices = Boolean(snap.status.connected);
          this.authenticated.indices = Boolean(snap.status.authenticated);
        }
        this.saveSession();
        this.onDataUpdate?.('initial', 'SNAPSHOT', this.data);
        return;
      }

      if (messages.type === 'status') {
        const st = messages.status || {};
        this.connected.indices = Boolean(st.connected);
        this.authenticated.indices = Boolean(st.authenticated);
        this.onConnectionStatus?.({ type: 'indices', connected: this.connected.indices, status: st.authenticated ? 'authenticated' : 'connected' });
        return;
      }

      if (messages.type === 'SPX') {
        this.data.SPX = { ...messages.data, source: messages.data?.source || 'WS_PROXY' };
        this.saveSession();
        this.onDataUpdate?.('index', 'SPX', this.data);
        return;
      }

      if (messages.type === 'VIX') {
        this.data.VIX = { ...messages.data, source: messages.data?.source || 'WS_PROXY' };
        this.saveSession();
        this.onDataUpdate?.('index', 'VIX', this.data);
      }
    };

    ws.onerror = () => {
      this.onError?.('WebSocket error (proxy)');
      this.connected.backend = false;
      this.connected.indices = false;
      this.authenticated.indices = false;
      this.onConnectionStatus?.({ type: 'backend', connected: false, status: 'error' });
    };

    ws.onclose = () => {
      this.connected.backend = false;
      this.connected.indices = false;
      this.authenticated.indices = false;
      this.onConnectionStatus?.({ type: 'backend', connected: false, status: 'closed' });
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

