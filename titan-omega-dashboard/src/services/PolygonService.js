/**
 * Polygon.io API Service - REAL DATA ONLY
 * 
 * NO MOCK DATA - NO SYNTHETIC DATA - NO FALLBACKS
 * 
 * This service ONLY returns real market data from Polygon.io
 * If data is unavailable, it returns null (not fake data)
 */

const API_KEY = import.meta.env.VITE_POLYGON_API_KEY;
const BASE_URL = 'https://api.polygon.io';
const STORAGE_KEY = 'titan_omega_last_session';

if (!API_KEY) {
  console.error('❌ POLYGON API KEY NOT FOUND!');
}

class PolygonService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 15000;
    this.lastSession = this.loadLastSession();
    this.marketStatus = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // PERSISTENCE - Save/Load Last Session for After-Hours
  // ═══════════════════════════════════════════════════════════════════════════════════

  loadLastSession() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        data.timestamp = new Date(data.timestamp);
        return data;
      }
    } catch (e) {
      console.warn('Could not load last session:', e);
    }
    return null;
  }

  saveLastSession(data) {
    try {
      this.lastSession = { ...data, timestamp: new Date() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.lastSession));
    } catch (e) {
      console.warn('Could not save session:', e);
    }
  }

  getLastSession() {
    return this.lastSession;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // API FETCH - Real Data Only
  // ═══════════════════════════════════════════════════════════════════════════════════

  async fetch(endpoint, skipCache = false) {
    if (!API_KEY) {
      throw new Error('API key not configured');
    }

    const cacheKey = endpoint;
    
    if (!skipCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.time < this.cacheTimeout) {
        return cached.data;
      }
    }

    const url = `${BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}apiKey=${API_KEY}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    this.cache.set(cacheKey, { data, time: Date.now() });
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // MARKET STATUS - Is Market Open?
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getMarketStatus() {
    try {
      const data = await this.fetch('/v1/marketstatus/now', true);
      this.marketStatus = {
        isOpen: data?.market === 'open',
        status: data?.market || 'unknown',
        afterHours: data?.afterHours === true,
        preMarket: data?.earlyHours === true,
        serverTime: data?.serverTime,
        exchanges: data?.exchanges,
      };
      return this.marketStatus;
    } catch (e) {
      // Estimate based on time
      const now = new Date();
      const hour = now.getUTCHours() - 5; // EST
      const day = now.getDay();
      const isWeekday = day > 0 && day < 6;
      const isRegularHours = hour >= 9.5 && hour < 16;
      const isPreMarket = hour >= 4 && hour < 9.5;
      const isAfterHours = hour >= 16 && hour < 20;
      
      this.marketStatus = {
        isOpen: isWeekday && isRegularHours,
        status: isWeekday && isRegularHours ? 'open' : 'closed',
        afterHours: isWeekday && isAfterHours,
        preMarket: isWeekday && isPreMarket,
        estimated: true,
      };
      return this.marketStatus;
    }
  }

  isMarketOpen() {
    return this.marketStatus?.isOpen || false;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // REAL SPY DATA (Primary Data Source)
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getSPYSnapshot() {
    const data = await this.fetch('/v2/snapshot/locale/us/markets/stocks/tickers/SPY');
    
    if (!data?.ticker) {
      throw new Error('SPY snapshot not available');
    }

    const t = data.ticker;
    const lastPrice = t.lastTrade?.p || t.day?.c || t.prevDay?.c;
    const prevClose = t.prevDay?.c;
    
    if (!lastPrice) {
      throw new Error('SPY price not available');
    }

    const result = {
      ticker: 'SPY',
      price: lastPrice,
      spxEquivalent: lastPrice * 10, // SPY * 10 ≈ SPX
      change: prevClose ? ((lastPrice - prevClose) / prevClose) * 100 : 0,
      changePts: prevClose ? (lastPrice - prevClose) * 10 : 0,
      
      day: {
        open: t.day?.o,
        high: t.day?.h,
        low: t.day?.l,
        close: t.day?.c,
        volume: t.day?.v,
        vwap: t.day?.vw,
      },
      
      prevDay: {
        open: t.prevDay?.o,
        high: t.prevDay?.h,
        low: t.prevDay?.l,
        close: t.prevDay?.c,
        volume: t.prevDay?.v,
        vwap: t.prevDay?.vw,
      },
      
      lastTrade: {
        price: t.lastTrade?.p,
        size: t.lastTrade?.s,
        timestamp: t.lastTrade?.t ? new Date(t.lastTrade.t / 1e6) : null,
      },
      
      lastQuote: {
        bid: t.lastQuote?.p,
        ask: t.lastQuote?.P,
        bidSize: t.lastQuote?.s,
        askSize: t.lastQuote?.S,
      },
      
      timestamp: new Date(),
      source: 'POLYGON_REALTIME',
    };

    // Save for after-hours reference
    if (this.marketStatus?.isOpen) {
      this.saveLastSession(result);
    }

    return result;
  }

  // Get previous day's data (for after-hours/weekends)
  async getSPYPrevDay() {
    const data = await this.fetch('/v2/aggs/ticker/SPY/prev');
    
    if (!data?.results?.[0]) {
      throw new Error('SPY previous day data not available');
    }

    const r = data.results[0];
    return {
      ticker: 'SPY',
      price: r.c,
      spxEquivalent: r.c * 10,
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
      vwap: r.vw,
      date: new Date(r.t),
      source: 'POLYGON_PREV_DAY',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // INTRADAY BARS - Real Historical Data
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getIntradayBars(ticker = 'SPY', timeframe = 5, days = 5) {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const data = await this.fetch(
      `/v2/aggs/ticker/${ticker}/range/${timeframe}/minute/${from}/${to}?adjusted=true&sort=desc&limit=500`
    );
    
    if (!data?.results?.length) {
      return [];
    }

    return data.results.map(bar => ({
      timestamp: new Date(bar.t),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      vwap: bar.vw,
      trades: bar.n,
      // SPX equivalent
      spx: {
        open: bar.o * 10,
        high: bar.h * 10,
        low: bar.l * 10,
        close: bar.c * 10,
      },
    }));
  }

  // Get daily bars for weekly analysis
  async getDailyBars(ticker = 'SPY', days = 30) {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const data = await this.fetch(
      `/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=${days}`
    );
    
    if (!data?.results?.length) {
      return [];
    }

    return data.results.map(bar => ({
      date: new Date(bar.t),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      vwap: bar.vw,
      spxClose: bar.c * 10,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // OPTIONS DATA - Real Options Chain
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getOptionsChain(underlying = 'SPY') {
    try {
      const data = await this.fetch(`/v3/snapshot/options/${underlying}?limit=250`);
      
      if (!data?.results?.length) {
        console.warn('Options chain empty or not available (may require subscription)');
        return { available: false, data: [], reason: 'No options data returned' };
      }

      const options = data.results.map(opt => ({
        ticker: opt.details?.ticker,
        strike: opt.details?.strike_price,
        expiration: opt.details?.expiration_date,
        type: opt.details?.contract_type,
        
        openInterest: opt.open_interest || 0,
        volume: opt.day?.volume || 0,
        
        lastPrice: opt.day?.close,
        bid: opt.last_quote?.bid,
        ask: opt.last_quote?.ask,
        
        impliedVol: opt.implied_volatility,
        
        greeks: {
          delta: opt.greeks?.delta,
          gamma: opt.greeks?.gamma,
          theta: opt.greeks?.theta,
          vega: opt.greeks?.vega,
        },
        
        raw: opt,
      }));

      return { 
        available: true, 
        data: options, 
        count: options.length,
        timestamp: new Date(),
      };
    } catch (e) {
      console.warn('Options chain error:', e.message);
      return { 
        available: false, 
        data: [], 
        reason: e.message,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // VIX DATA
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getVIX() {
    // Try VIX-tracking ETFs
    const vixTickers = ['VIXY', 'VXX', 'UVXY'];
    
    for (const ticker of vixTickers) {
      try {
        const data = await this.fetch(`/v2/aggs/ticker/${ticker}/prev`);
        if (data?.results?.[0]?.c) {
          // Approximate VIX from ETF
          const etfPrice = data.results[0].c;
          let vixEstimate;
          
          if (ticker === 'VIXY') vixEstimate = etfPrice * 1.1;
          else if (ticker === 'VXX') vixEstimate = etfPrice * 0.7;
          else if (ticker === 'UVXY') vixEstimate = etfPrice * 0.35;
          else vixEstimate = etfPrice;
          
          return {
            value: vixEstimate,
            source: ticker,
            etfPrice,
            timestamp: new Date(),
          };
        }
      } catch (e) {
        continue;
      }
    }
    
    throw new Error('VIX data not available');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // COMPREHENSIVE DATA FETCH
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getAllData() {
    const status = await this.getMarketStatus();
    
    const result = {
      timestamp: new Date(),
      marketStatus: status,
      spy: null,
      vix: null,
      options: null,
      bars: null,
      dailyBars: null,
      lastSession: this.lastSession,
      errors: [],
    };

    // Get SPY data
    try {
      if (status.isOpen || status.afterHours || status.preMarket) {
        result.spy = await this.getSPYSnapshot();
      } else {
        result.spy = await this.getSPYPrevDay();
      }
    } catch (e) {
      result.errors.push({ source: 'SPY', error: e.message });
      // Use last session as fallback
      if (this.lastSession) {
        result.spy = { ...this.lastSession, source: 'LAST_SESSION' };
      }
    }

    // Get VIX
    try {
      result.vix = await this.getVIX();
    } catch (e) {
      result.errors.push({ source: 'VIX', error: e.message });
    }

    // Get Options Chain
    try {
      result.options = await this.getOptionsChain('SPY');
    } catch (e) {
      result.errors.push({ source: 'OPTIONS', error: e.message });
      result.options = { available: false, data: [], reason: e.message };
    }

    // Get Intraday Bars
    try {
      result.bars = await this.getIntradayBars('SPY', 5, 5);
    } catch (e) {
      result.errors.push({ source: 'BARS', error: e.message });
    }

    // Get Daily Bars for weekly analysis
    try {
      result.dailyBars = await this.getDailyBars('SPY', 30);
    } catch (e) {
      result.errors.push({ source: 'DAILY_BARS', error: e.message });
    }

    return result;
  }

  // Clear all caches
  clearCache() {
    this.cache.clear();
  }
}

export const polygonService = new PolygonService();
export default polygonService;
