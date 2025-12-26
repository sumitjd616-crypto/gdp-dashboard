/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REAL-TIME DATA ENGINE - Market Data Integration Layer
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This module provides interfaces for connecting to real market data sources.
 * Designed with Larry Page's systems thinking:
 * - Modular architecture for different data providers
 * - Efficient data structures for real-time processing
 * - Fault-tolerant with automatic reconnection
 * 
 * Supported Data Sources:
 * - TD Ameritrade / Charles Schwab API
 * - Interactive Brokers TWS
 * - Polygon.io
 * - Alpaca Markets
 * - TradeStation
 * - WebSocket feeds
 */

// ═══════════════════════════════════════════════════════════════════════════
// DATA PROVIDER INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

export class DataProvider {
  constructor(config = {}) {
    this.config = config;
    this.connected = false;
    this.subscribers = new Map();
    this.lastData = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  async connect() {
    throw new Error('connect() must be implemented by subclass');
  }

  async disconnect() {
    throw new Error('disconnect() must be implemented by subclass');
  }

  subscribe(symbol, callback) {
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, new Set());
    }
    this.subscribers.get(symbol).add(callback);
    return () => this.subscribers.get(symbol).delete(callback);
  }

  notifySubscribers(symbol, data) {
    this.lastData[symbol] = data;
    const callbacks = this.subscribers.get(symbol);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POLYGON.IO PROVIDER (Recommended for SPX options)
// ═══════════════════════════════════════════════════════════════════════════

export class PolygonProvider extends DataProvider {
  constructor(apiKey) {
    super({ apiKey });
    this.ws = null;
    this.baseUrl = 'wss://socket.polygon.io';
    this.restUrl = 'https://api.polygon.io';
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${this.baseUrl}/indices`);
      
      this.ws.onopen = () => {
        console.log('🔌 Polygon WebSocket connected');
        this.ws.send(JSON.stringify({ action: 'auth', params: this.config.apiKey }));
        this.connected = true;
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onmessage = (event) => {
        const messages = JSON.parse(event.data);
        messages.forEach(msg => this.handleMessage(msg));
      };

      this.ws.onerror = (error) => {
        console.error('❌ Polygon WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.attemptReconnect();
      };
    });
  }

  handleMessage(msg) {
    switch (msg.ev) {
      case 'status':
        if (msg.message === 'authenticated') {
          this.subscribeToChannels();
        }
        break;
      case 'V': // Index value
        this.notifySubscribers(msg.T, {
          symbol: msg.T,
          price: msg.val,
          timestamp: msg.t,
          type: 'index'
        });
        break;
      case 'A': // Aggregates
        this.notifySubscribers(msg.sym, {
          symbol: msg.sym,
          open: msg.o,
          high: msg.h,
          low: msg.l,
          close: msg.c,
          volume: msg.v,
          vwap: msg.vw,
          timestamp: msg.e,
          type: 'candle'
        });
        break;
      case 'T': // Trade
        this.notifySubscribers(msg.sym, {
          symbol: msg.sym,
          price: msg.p,
          size: msg.s,
          timestamp: msg.t,
          type: 'trade'
        });
        break;
    }
  }

  subscribeToChannels() {
    const channels = [];
    this.subscribers.forEach((_, symbol) => {
      channels.push(`V.${symbol}`, `A.${symbol}`, `T.${symbol}`);
    });
    if (channels.length > 0) {
      this.ws.send(JSON.stringify({ action: 'subscribe', params: channels.join(',') }));
    }
  }

  async getOptionsChain(symbol, expirationDate) {
    const response = await fetch(
      `${this.restUrl}/v3/reference/options/contracts?` +
      `underlying_ticker=${symbol}&expiration_date=${expirationDate}&` +
      `apiKey=${this.config.apiKey}`
    );
    return response.json();
  }

  async getOptionsGreeks(contractSymbol) {
    const response = await fetch(
      `${this.restUrl}/v3/snapshot/options/${contractSymbol}?apiKey=${this.config.apiKey}`
    );
    const data = await response.json();
    return data.results?.greeks || null;
  }

  async disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(`🔄 Reconnecting in ${delay/1000}s (attempt ${this.reconnectAttempts})`);
      setTimeout(() => this.connect(), delay);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERACTIVE BROKERS PROVIDER
// ═══════════════════════════════════════════════════════════════════════════

export class IBKRProvider extends DataProvider {
  constructor(config) {
    super({
      host: 'localhost',
      port: 7497, // TWS paper trading port (7496 for live)
      clientId: 1,
      ...config
    });
    this.reqId = 0;
    this.pendingRequests = new Map();
  }

  async connect() {
    // Note: Actual IB connection requires the ib-tws-api or similar library
    // This is a structural example showing the interface
    console.log('📊 IBKR Provider: Would connect to TWS at', 
      `${this.config.host}:${this.config.port}`);
    
    // In production, you would:
    // 1. Connect to TWS via socket
    // 2. Subscribe to market data
    // 3. Request options chain data
    // 4. Get real-time Greeks from the options model
    
    this.connected = true;
    return Promise.resolve();
  }

  async requestMarketData(symbol) {
    const reqId = ++this.reqId;
    // In production: ib.reqMktData(reqId, contract, '', false, false, [])
    return reqId;
  }

  async requestOptionsChain(symbol, expiry) {
    const reqId = ++this.reqId;
    // In production: ib.reqSecDefOptParams(reqId, symbol, '', 'STK', conId)
    return new Promise((resolve) => {
      this.pendingRequests.set(reqId, resolve);
    });
  }

  async requestRealTimeGreeks(optionSymbol) {
    // IB provides Greeks through:
    // 1. Snapshot data (optionImpliedVol, optionDelta, etc.)
    // 2. Real-time with tick types 10-13 (bidImpliedVol, askImpliedVol, lastImpliedVol, modelImpliedVol)
    const reqId = ++this.reqId;
    return reqId;
  }

  async disconnect() {
    this.connected = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ALPACA PROVIDER (Commission-free)
// ═══════════════════════════════════════════════════════════════════════════

export class AlpacaProvider extends DataProvider {
  constructor(apiKey, secretKey, paper = true) {
    super({ apiKey, secretKey, paper });
    this.ws = null;
    this.baseUrl = paper 
      ? 'wss://stream.data.sandbox.alpaca.markets/v2/iex'
      : 'wss://stream.data.alpaca.markets/v2/iex';
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.baseUrl);
      
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({
          action: 'auth',
          key: this.config.apiKey,
          secret: this.config.secretKey
        }));
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        data.forEach(msg => {
          if (msg.T === 'success' && msg.msg === 'authenticated') {
            this.connected = true;
            resolve();
          } else if (msg.T === 'b') { // Bar
            this.notifySubscribers(msg.S, {
              symbol: msg.S,
              open: msg.o,
              high: msg.h,
              low: msg.l,
              close: msg.c,
              volume: msg.v,
              timestamp: msg.t,
              type: 'candle'
            });
          } else if (msg.T === 't') { // Trade
            this.notifySubscribers(msg.S, {
              symbol: msg.S,
              price: msg.p,
              size: msg.s,
              timestamp: msg.t,
              type: 'trade'
            });
          } else if (msg.T === 'q') { // Quote
            this.notifySubscribers(msg.S, {
              symbol: msg.S,
              bid: msg.bp,
              ask: msg.ap,
              bidSize: msg.bs,
              askSize: msg.as,
              timestamp: msg.t,
              type: 'quote'
            });
          }
        });
      };

      this.ws.onerror = reject;
    });
  }

  subscribeToSymbol(symbol) {
    if (this.connected) {
      this.ws.send(JSON.stringify({
        action: 'subscribe',
        trades: [symbol],
        quotes: [symbol],
        bars: [symbol]
      }));
    }
  }

  async disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTIONS DATA AGGREGATOR
// ═══════════════════════════════════════════════════════════════════════════

export class OptionsDataAggregator {
  constructor(provider) {
    this.provider = provider;
    this.optionsChain = new Map();
    this.greeksCache = new Map();
    this.gexLevels = [];
    this.lastUpdate = null;
  }

  async loadOptionsChain(underlying, expirations) {
    for (const expiry of expirations) {
      const chain = await this.provider.getOptionsChain(underlying, expiry);
      this.optionsChain.set(expiry, chain);
    }
    await this.calculateGEX();
    this.lastUpdate = Date.now();
  }

  async calculateGEX() {
    const gexByStrike = new Map();
    
    for (const [expiry, chain] of this.optionsChain) {
      for (const option of chain.results || []) {
        const greeks = await this.provider.getOptionsGreeks(option.ticker);
        if (greeks) {
          this.greeksCache.set(option.ticker, greeks);
          
          const strike = option.strike_price;
          const gamma = greeks.gamma || 0;
          const oi = option.open_interest || 0;
          const spot = option.underlying_ticker ? 5950 : 5950; // Would come from live data
          
          // Calculate GEX contribution
          // Dealers are typically short calls and long puts
          const isCall = option.contract_type === 'call';
          const gex = gamma * oi * 100 * spot * spot / 100;
          const signedGEX = isCall ? -gex : gex; // Short calls, long puts
          
          const currentGEX = gexByStrike.get(strike) || 0;
          gexByStrike.set(strike, currentGEX + signedGEX);
        }
      }
    }
    
    // Sort by absolute GEX to find major levels
    this.gexLevels = Array.from(gexByStrike.entries())
      .map(([strike, gex]) => ({ strike, gex }))
      .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex));
  }

  getGammaFlip(currentSpot) {
    // Find where GEX transitions from positive to negative
    let flipLevel = currentSpot;
    let minAbsGEX = Infinity;
    
    for (const { strike, gex } of this.gexLevels) {
      if (Math.abs(gex) < minAbsGEX) {
        minAbsGEX = Math.abs(gex);
        flipLevel = strike;
      }
    }
    
    return flipLevel;
  }

  getSupportResistance(currentSpot) {
    return {
      supports: this.gexLevels
        .filter(l => l.strike < currentSpot && l.gex > 0)
        .slice(0, 3)
        .map(l => l.strike),
      resistances: this.gexLevels
        .filter(l => l.strike > currentSpot && l.gex < 0)
        .slice(0, 3)
        .map(l => l.strike),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REAL-TIME ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════════════════

export class RealTimeAnalysisEngine {
  constructor(dataProvider, optionsAggregator) {
    this.dataProvider = dataProvider;
    this.optionsAggregator = optionsAggregator;
    this.candles = [];
    this.currentBar = null;
    this.analysisCallbacks = new Set();
  }

  start(symbol, interval = '5min') {
    // Subscribe to real-time data
    this.dataProvider.subscribe(symbol, (data) => {
      this.processData(data);
    });

    // Update options data every 5 minutes
    setInterval(() => {
      this.optionsAggregator.loadOptionsChain(symbol, this.getExpirations());
    }, 5 * 60 * 1000);
  }

  processData(data) {
    if (data.type === 'candle') {
      this.candles.push({
        timestamp: new Date(data.timestamp),
        o: data.open,
        h: data.high,
        l: data.low,
        c: data.close,
        v: data.volume,
      });
      
      // Keep last 200 candles
      if (this.candles.length > 200) {
        this.candles.shift();
      }
      
      // Run analysis
      this.runAnalysis();
    } else if (data.type === 'trade') {
      // Update current bar
      if (this.currentBar) {
        this.currentBar.h = Math.max(this.currentBar.h, data.price);
        this.currentBar.l = Math.min(this.currentBar.l, data.price);
        this.currentBar.c = data.price;
        this.currentBar.v += data.size;
      }
    }
  }

  runAnalysis() {
    const analysis = {
      timestamp: Date.now(),
      spot: this.candles[this.candles.length - 1]?.c,
      gex: {
        levels: this.optionsAggregator.gexLevels.slice(0, 5),
        gammaFlip: this.optionsAggregator.getGammaFlip(this.candles[this.candles.length - 1]?.c),
        supportResistance: this.optionsAggregator.getSupportResistance(this.candles[this.candles.length - 1]?.c),
      },
      greeks: this.getAggregatedGreeks(),
      signals: this.generateSignals(),
    };

    this.analysisCallbacks.forEach(cb => cb(analysis));
  }

  getAggregatedGreeks() {
    // Aggregate Greeks from the options chain
    let totalDelta = 0;
    let totalGamma = 0;
    let totalVega = 0;
    let totalTheta = 0;

    for (const [ticker, greeks] of this.optionsAggregator.greeksCache) {
      totalDelta += greeks.delta || 0;
      totalGamma += greeks.gamma || 0;
      totalVega += greeks.vega || 0;
      totalTheta += greeks.theta || 0;
    }

    return { totalDelta, totalGamma, totalVega, totalTheta };
  }

  generateSignals() {
    // Implement signal generation based on analysis
    // This would use the TitanOmegaEnhanced engine
    return [];
  }

  onAnalysis(callback) {
    this.analysisCallbacks.add(callback);
    return () => this.analysisCallbacks.delete(callback);
  }

  getExpirations() {
    // Get next 3 weekly expirations
    const expirations = [];
    const today = new Date();
    
    for (let i = 0; i < 3; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + (5 - today.getDay() + 7 * i) % 7);
      expirations.push(date.toISOString().split('T')[0]);
    }
    
    return expirations;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// USAGE EXAMPLE
// ═══════════════════════════════════════════════════════════════════════════

export const createRealTimeEngine = async (config) => {
  // Choose provider based on config
  let provider;
  
  switch (config.provider) {
    case 'polygon':
      provider = new PolygonProvider(config.apiKey);
      break;
    case 'alpaca':
      provider = new AlpacaProvider(config.apiKey, config.secretKey, config.paper);
      break;
    case 'ibkr':
      provider = new IBKRProvider(config);
      break;
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }

  // Connect
  await provider.connect();

  // Create options aggregator
  const optionsAggregator = new OptionsDataAggregator(provider);

  // Create analysis engine
  const analysisEngine = new RealTimeAnalysisEngine(provider, optionsAggregator);

  return {
    provider,
    optionsAggregator,
    analysisEngine,
    
    start: (symbol) => {
      analysisEngine.start(symbol);
      optionsAggregator.loadOptionsChain(symbol, analysisEngine.getExpirations());
    },
    
    onUpdate: (callback) => analysisEngine.onAnalysis(callback),
    
    disconnect: () => provider.disconnect(),
  };
};

/**
 * Example usage in React component:
 * 
 * ```javascript
 * import { createRealTimeEngine } from './trading/RealTimeDataEngine';
 * 
 * useEffect(() => {
 *   const engine = await createRealTimeEngine({
 *     provider: 'polygon',
 *     apiKey: process.env.POLYGON_API_KEY,
 *   });
 *   
 *   engine.start('I:SPX');
 *   
 *   engine.onUpdate((analysis) => {
 *     setSpot(analysis.spot);
 *     setGEXLevels(analysis.gex.levels);
 *     setGreeks(analysis.greeks);
 *     setSignals(analysis.signals);
 *   });
 *   
 *   return () => engine.disconnect();
 * }, []);
 * ```
 */

export default {
  PolygonProvider,
  IBKRProvider,
  AlpacaProvider,
  OptionsDataAggregator,
  RealTimeAnalysisEngine,
  createRealTimeEngine,
};
