/**
 * Massive.com WebSocket Service
 * 
 * Real-time streaming market data for SPX, VIX, SPY, QQQ
 * 
 * WebSocket Endpoints:
 * - Stocks: wss://socket.massive.com/stocks (SPY, QQQ, etc.)
 * - Indices: wss://socket.massive.com/indices (SPX, VIX, etc.)
 * 
 * Data Feeds:
 * - AM = Aggregates per Minute (OHLCV bars)
 * - AS = Aggregates per Second
 * - T  = Trades
 * - V  = Index Value (for indices)
 */

const API_KEY = import.meta.env.VITE_MASSIVE_API_KEY;
const STORAGE_KEY = 'titan_omega_massive_v1';

// WebSocket endpoints
const WS_ENDPOINTS = {
  stocks: 'wss://socket.massive.com/stocks',
  stocksDelayed: 'wss://delayed.massive.com/stocks',
  indices: 'wss://socket.massive.com/indices',
  indicesDelayed: 'wss://delayed.massive.com/indices',
  options: 'wss://socket.massive.com/options',
};

class MassiveService {
  constructor() {
    this.connections = new Map(); // type -> WebSocket
    this.subscribers = new Map(); // channel -> Set of callbacks
    this.authenticated = new Map(); // type -> boolean
    this.reconnectAttempts = new Map();
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000;
    
    // Real-time data storage
    this.data = {
      SPX: null,
      VIX: null,
      SPY: null,
      QQQ: null,
      bars: {
        SPX: [],
        SPY: [],
        QQQ: [],
      },
    };
    
    // Callbacks for data updates
    this.onDataUpdate = null;
    this.onConnectionStatus = null;
    this.onError = null;
    
    // Load last session
    this.lastSession = this.loadLastSession();
    
    if (!API_KEY) {
      console.error('❌ MASSIVE API KEY NOT FOUND! Add VITE_MASSIVE_API_KEY to .env');
    } else {
      console.log('🔑 Massive API Key:', API_KEY.slice(0, 4) + '...' + API_KEY.slice(-4));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SESSION PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════════════

  loadLastSession() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        console.log('📂 Loaded last session');
        return data;
      }
    } catch (e) {
      console.warn('Could not load session:', e);
    }
    return null;
  }

  saveSession() {
    try {
      const session = {
        timestamp: new Date().toISOString(),
        data: this.data,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch (e) {
      console.warn('Could not save session:', e);
    }
  }

  getLastSession() {
    return this.lastSession;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // WEBSOCKET CONNECTION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════════

  connect(type = 'stocks', useDelayed = false) {
    return new Promise((resolve, reject) => {
      if (!API_KEY) {
        reject(new Error('API key not configured'));
        return;
      }

      // Get endpoint
      let endpoint;
      if (type === 'stocks') {
        endpoint = useDelayed ? WS_ENDPOINTS.stocksDelayed : WS_ENDPOINTS.stocks;
      } else if (type === 'indices') {
        endpoint = useDelayed ? WS_ENDPOINTS.indicesDelayed : WS_ENDPOINTS.indices;
      } else if (type === 'options') {
        endpoint = WS_ENDPOINTS.options;
      } else {
        reject(new Error(`Unknown connection type: ${type}`));
        return;
      }

      // Close existing connection
      if (this.connections.has(type)) {
        this.connections.get(type).close();
      }

      console.log(`🔌 Connecting to ${type}: ${endpoint}`);
      
      const ws = new WebSocket(endpoint);
      this.connections.set(type, ws);

      ws.onopen = () => {
        console.log(`✅ Connected to ${type}`);
        this.reconnectAttempts.set(type, 0);
        this.authenticate(type);
      };

      ws.onmessage = (event) => {
        this.handleMessage(type, event.data, resolve, reject);
      };

      ws.onerror = (error) => {
        console.error(`❌ WebSocket error (${type}):`, error);
        this.onError?.(`WebSocket error: ${type}`);
        reject(error);
      };

      ws.onclose = (event) => {
        console.log(`🔌 Disconnected from ${type}:`, event.code, event.reason);
        this.authenticated.set(type, false);
        this.onConnectionStatus?.({ type, connected: false, reason: event.reason });
        
        // Attempt reconnect
        this.attemptReconnect(type, useDelayed);
      };
    });
  }

  authenticate(type) {
    const ws = this.connections.get(type);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    console.log(`🔐 Authenticating ${type}...`);
    ws.send(JSON.stringify({
      action: 'auth',
      params: API_KEY,
    }));
  }

  subscribe(type, channels) {
    const ws = this.connections.get(type);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn(`Cannot subscribe - ${type} not connected`);
      return false;
    }

    if (!this.authenticated.get(type)) {
      console.warn(`Cannot subscribe - ${type} not authenticated`);
      return false;
    }

    const channelList = Array.isArray(channels) ? channels.join(',') : channels;
    console.log(`📡 Subscribing to ${type}: ${channelList}`);
    
    ws.send(JSON.stringify({
      action: 'subscribe',
      params: channelList,
    }));

    return true;
  }

  unsubscribe(type, channels) {
    const ws = this.connections.get(type);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const channelList = Array.isArray(channels) ? channels.join(',') : channels;
    ws.send(JSON.stringify({
      action: 'unsubscribe',
      params: channelList,
    }));
  }

  attemptReconnect(type, useDelayed) {
    const attempts = this.reconnectAttempts.get(type) || 0;
    
    if (attempts >= this.maxReconnectAttempts) {
      console.error(`❌ Max reconnect attempts reached for ${type}`);
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, attempts);
    console.log(`🔄 Reconnecting ${type} in ${delay}ms (attempt ${attempts + 1})`);
    
    this.reconnectAttempts.set(type, attempts + 1);
    
    setTimeout(() => {
      this.connect(type, useDelayed).catch(console.error);
    }, delay);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════════════

  handleMessage(type, rawData, resolveConnect, rejectConnect) {
    try {
      const messages = JSON.parse(rawData);
      
      for (const msg of Array.isArray(messages) ? messages : [messages]) {
        // Handle status messages
        if (msg.ev === 'status') {
          this.handleStatusMessage(type, msg, resolveConnect, rejectConnect);
          continue;
        }

        // Handle data messages
        this.handleDataMessage(type, msg);
      }
    } catch (e) {
      console.error('Message parse error:', e, rawData);
    }
  }

  handleStatusMessage(type, msg, resolveConnect, rejectConnect) {
    console.log(`📨 [${type}] Status:`, msg.status, msg.message);

    switch (msg.status) {
      case 'connected':
        this.onConnectionStatus?.({ type, connected: true, status: 'connected' });
        break;

      case 'auth_success':
        console.log(`✅ Authenticated: ${type}`);
        this.authenticated.set(type, true);
        this.onConnectionStatus?.({ type, connected: true, status: 'authenticated' });
        resolveConnect?.({ type, authenticated: true });
        
        // Auto-subscribe based on type
        this.autoSubscribe(type);
        break;

      case 'auth_failed':
        console.error(`❌ Auth failed: ${type} - ${msg.message}`);
        this.onError?.(`Authentication failed: ${msg.message}`);
        rejectConnect?.(new Error(`Auth failed: ${msg.message}`));
        break;

      case 'success':
        console.log(`✅ ${msg.message}`);
        break;

      case 'error':
        console.error(`❌ Error: ${msg.message}`);
        this.onError?.(msg.message);
        break;
    }
  }

  autoSubscribe(type) {
    if (type === 'stocks') {
      // Subscribe to SPY and QQQ minute bars + trades
      // Note: Requires stocks WebSocket subscription
      this.subscribe(type, ['AM.SPY', 'AM.QQQ', 'T.SPY', 'T.QQQ']);
    } else if (type === 'indices') {
      // Subscribe to SPX and VIX values + minute bars
      // Format: V.I:SPX for value, AM.I:SPX for aggregates
      this.subscribe(type, ['V.I:SPX', 'V.I:VIX', 'AM.I:SPX', 'AM.I:VIX']);
    } else if (type === 'options') {
      // Subscribe to SPY options
      this.subscribe(type, ['T.O:SPY*']);
    }
  }

  handleDataMessage(type, msg) {
    const { ev, sym } = msg;
    
    switch (ev) {
      // ═══════════════════════════════════════════════════════════════════════════
      // INDEX VALUE (Real-time index level)
      // ═══════════════════════════════════════════════════════════════════════════
      case 'V':
        this.handleIndexValue(msg);
        break;

      // ═══════════════════════════════════════════════════════════════════════════
      // AGGREGATE MINUTE (OHLCV bars)
      // ═══════════════════════════════════════════════════════════════════════════
      case 'AM':
        this.handleAggregateMinute(msg);
        break;

      // ═══════════════════════════════════════════════════════════════════════════
      // AGGREGATE SECOND
      // ═══════════════════════════════════════════════════════════════════════════
      case 'AS':
        this.handleAggregateSecond(msg);
        break;

      // ═══════════════════════════════════════════════════════════════════════════
      // TRADE
      // ═══════════════════════════════════════════════════════════════════════════
      case 'T':
        this.handleTrade(msg);
        break;

      // ═══════════════════════════════════════════════════════════════════════════
      // QUOTE
      // ═══════════════════════════════════════════════════════════════════════════
      case 'Q':
        this.handleQuote(msg);
        break;

      default:
        // console.log(`Unknown event type: ${ev}`, msg);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // DATA HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════════════

  handleIndexValue(msg) {
    // V = Index Value
    // { ev: 'V', val: 6050.25, T: 'I:SPX', t: 1234567890000 }
    const rawSymbol = msg.T || msg.sym;
    const symbol = rawSymbol?.replace('I:', '') || rawSymbol; // Normalize: I:SPX -> SPX
    const value = msg.val || msg.v;
    const timestamp = msg.t;

    if (symbol === 'SPX') {
      this.data.SPX = {
        price: value,
        timestamp: new Date(timestamp),
        source: 'MASSIVE_REALTIME',
      };
      console.log(`📊 SPX: ${value}`);
    } else if (symbol === 'VIX') {
      this.data.VIX = {
        value: value,
        timestamp: new Date(timestamp),
        source: 'MASSIVE_REALTIME',
      };
      console.log(`📊 VIX: ${value}`);
    }

    this.saveSession();
    this.onDataUpdate?.('index', symbol, this.data);
  }

  handleAggregateMinute(msg) {
    // AM = Aggregate Minute
    // { ev: 'AM', sym: 'I:SPX', v: 12345, o: 6050, c: 6055, h: 6058, l: 6048, a: 6052, s: 1611082800000, e: 1611082860000 }
    const rawSymbol = msg.sym || msg.T;
    const symbol = rawSymbol?.replace('I:', '') || rawSymbol; // Normalize: I:SPX -> SPX
    const bar = {
      timestamp: new Date(msg.s),
      endTime: new Date(msg.e),
      open: msg.o,
      high: msg.h,
      low: msg.l,
      close: msg.c,
      volume: msg.v,
      vwap: msg.a || msg.vw,
      trades: msg.n,
    };

    // Update current price from close
    if (symbol === 'SPY') {
      this.data.SPY = {
        price: bar.close,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        volume: bar.volume,
        vwap: bar.vwap,
        timestamp: bar.timestamp,
        source: 'MASSIVE_AM',
      };
      
      // Store bar
      this.data.bars.SPY.unshift(bar);
      if (this.data.bars.SPY.length > 500) this.data.bars.SPY.pop();
      
      console.log(`📊 SPY: ${bar.close} (AM bar)`);
    } else if (symbol === 'QQQ') {
      this.data.QQQ = {
        price: bar.close,
        timestamp: bar.timestamp,
        source: 'MASSIVE_AM',
      };
      this.data.bars.QQQ.unshift(bar);
      if (this.data.bars.QQQ.length > 500) this.data.bars.QQQ.pop();
    } else if (symbol === 'SPX' || symbol === 'I:SPX') {
      this.data.SPX = {
        price: bar.close,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        timestamp: bar.timestamp,
        source: 'MASSIVE_AM',
      };
      this.data.bars.SPX.unshift(bar);
      if (this.data.bars.SPX.length > 500) this.data.bars.SPX.pop();
      console.log(`📊 SPX: ${bar.close} (AM bar)`);
    }

    this.saveSession();
    this.onDataUpdate?.('bar', symbol, bar);
  }

  handleAggregateSecond(msg) {
    // Similar to AM but per second
    const symbol = msg.sym || msg.T;
    const price = msg.c;

    if (symbol === 'SPY') {
      this.data.SPY = { 
        ...this.data.SPY, 
        price, 
        timestamp: new Date(msg.s),
        source: 'MASSIVE_AS',
      };
    } else if (symbol === 'SPX') {
      this.data.SPX = { 
        ...this.data.SPX, 
        price, 
        timestamp: new Date(msg.s),
        source: 'MASSIVE_AS',
      };
    }

    this.onDataUpdate?.('tick', symbol, { price, timestamp: msg.s });
  }

  handleTrade(msg) {
    // T = Trade
    // { ev: 'T', sym: 'SPY', p: 450.25, s: 100, t: 1234567890000 }
    const symbol = msg.sym;
    const price = msg.p;
    const size = msg.s;
    const timestamp = msg.t;

    if (symbol === 'SPY') {
      this.data.SPY = {
        ...this.data.SPY,
        price,
        lastTrade: { price, size, timestamp: new Date(timestamp) },
        source: 'MASSIVE_TRADE',
      };
    } else if (symbol === 'QQQ') {
      this.data.QQQ = {
        ...this.data.QQQ,
        price,
        lastTrade: { price, size, timestamp: new Date(timestamp) },
        source: 'MASSIVE_TRADE',
      };
    }

    this.onDataUpdate?.('trade', symbol, { price, size, timestamp });
  }

  handleQuote(msg) {
    // Q = Quote (bid/ask)
    const symbol = msg.sym;
    const bid = msg.bp;
    const ask = msg.ap;

    if (symbol === 'SPY' || symbol === 'QQQ') {
      const existing = this.data[symbol] || {};
      this.data[symbol] = {
        ...existing,
        bid,
        ask,
        mid: (bid + ask) / 2,
        spread: ask - bid,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════════════

  async connectAll(useDelayed = false) {
    console.log('🚀 Connecting to Massive WebSocket feeds...');
    
    const results = {
      stocks: null,
      indices: null,
      rest: null,
      errors: [],
    };

    // Connect to indices (SPX, VIX) - This is our primary data source
    try {
      results.indices = await this.connect('indices', useDelayed);
      console.log('✅ Indices WebSocket connected');
    } catch (e) {
      console.error('❌ Indices connection failed:', e.message);
      results.errors.push({ type: 'indices', error: e.message });
    }

    // Try to connect to stocks (SPY, QQQ) - May not be available on all plans
    try {
      results.stocks = await this.connect('stocks', useDelayed);
      console.log('✅ Stocks WebSocket connected');
    } catch (e) {
      // This is expected if the plan doesn't include stocks WebSocket
      console.warn('⚠️ Stocks WebSocket not available:', e.message);
      results.errors.push({ type: 'stocks', error: e.message, expected: true });
    }

    // Fetch REST API data as fallback/initial data
    try {
      console.log('📡 Fetching REST API data...');
      results.rest = await this.fetchPreviousDayData();
      if (results.rest) {
        console.log('✅ REST data loaded');
        // Notify listeners of initial data
        this.onDataUpdate?.('initial', 'REST', this.data);
      }
    } catch (e) {
      console.error('❌ REST API failed:', e.message);
      results.errors.push({ type: 'rest', error: e.message });
    }

    return results;
  }

  disconnect(type) {
    const ws = this.connections.get(type);
    if (ws) {
      ws.close();
      this.connections.delete(type);
      this.authenticated.delete(type);
    }
  }

  disconnectAll() {
    for (const type of this.connections.keys()) {
      this.disconnect(type);
    }
  }

  // Get current data
  getData() {
    return {
      ...this.data,
      timestamp: new Date(),
      connected: {
        stocks: this.authenticated.get('stocks') || false,
        indices: this.authenticated.get('indices') || false,
      },
    };
  }

  // Get SPX price (with fallbacks)
  getSPXPrice() {
    if (this.data.SPX?.price) {
      return this.data.SPX;
    }
    
    // Fallback: SPY * 10 approximation
    if (this.data.SPY?.price) {
      return {
        price: this.data.SPY.price * 10,
        source: 'SPY_PROXY',
        timestamp: this.data.SPY.timestamp,
        note: 'Approximated from SPY',
      };
    }
    
    // Last session fallback
    if (this.lastSession?.data?.SPX) {
      return {
        ...this.lastSession.data.SPX,
        source: 'LAST_SESSION',
      };
    }
    
    return null;
  }

  // Fetch previous day data via REST API (for when markets are closed)
  async fetchPreviousDayData() {
    if (!API_KEY) return null;
    
    const BASE_URL = 'https://api.polygon.io';
    
    try {
      // Fetch SPX previous day
      const spxResponse = await fetch(`${BASE_URL}/v2/aggs/ticker/I:SPX/prev?apiKey=${API_KEY}`);
      const spxData = await spxResponse.json();
      
      if (spxData.results?.[0]) {
        const r = spxData.results[0];
        this.data.SPX = {
          price: r.c,
          open: r.o,
          high: r.h,
          low: r.l,
          volume: r.v,
          timestamp: new Date(r.t),
          source: 'REST_PREV_DAY',
        };
        console.log(`📊 SPX (prev day): ${r.c}`);
      }
      
      // Fetch VIX previous day
      const vixResponse = await fetch(`${BASE_URL}/v2/aggs/ticker/I:VIX/prev?apiKey=${API_KEY}`);
      const vixData = await vixResponse.json();
      
      if (vixData.results?.[0]) {
        const r = vixData.results[0];
        this.data.VIX = {
          value: r.c,
          open: r.o,
          high: r.h,
          low: r.l,
          timestamp: new Date(r.t),
          source: 'REST_PREV_DAY',
        };
        console.log(`📊 VIX (prev day): ${r.c}`);
      }
      
      this.saveSession();
      return this.data;
    } catch (e) {
      console.error('REST API error:', e.message);
      return null;
    }
  }

  // Get VIX
  getVIX() {
    return this.data.VIX || this.lastSession?.data?.VIX || null;
  }

  // Get bars
  getBars(symbol = 'SPY', limit = 100) {
    const bars = this.data.bars[symbol] || [];
    return bars.slice(0, limit);
  }

  // Check connection status
  isConnected(type = 'stocks') {
    return this.authenticated.get(type) || false;
  }

  // Set callbacks
  setCallbacks({ onDataUpdate, onConnectionStatus, onError }) {
    if (onDataUpdate) this.onDataUpdate = onDataUpdate;
    if (onConnectionStatus) this.onConnectionStatus = onConnectionStatus;
    if (onError) this.onError = onError;
  }
}

// Singleton instance
export const massiveService = new MassiveService();
export default massiveService;
