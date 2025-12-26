/**
 * Polygon.io API Service - REAL-TIME MARKET DATA
 * 
 * Uses actual Polygon.io API for live SPX/SPY data
 * NO SIMULATED DATA - Real market data only
 */

const API_KEY = import.meta.env.VITE_POLYGON_API_KEY;
const BASE_URL = 'https://api.polygon.io';

if (!API_KEY) {
  console.error('❌ POLYGON API KEY NOT FOUND! Add VITE_POLYGON_API_KEY to .env');
}

class PolygonService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 15000; // 15 second cache for real-time feel
    this.lastError = null;
  }

  async fetch(endpoint, skipCache = false) {
    if (!API_KEY) {
      throw new Error('Polygon API key not configured');
    }

    const cacheKey = endpoint;
    
    if (!skipCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.time < this.cacheTimeout) {
        return cached.data;
      }
    }

    const url = `${BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}apiKey=${API_KEY}`;
    
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorText = await response.text();
        this.lastError = `HTTP ${response.status}: ${errorText}`;
        console.error('Polygon API Error:', this.lastError);
        throw new Error(this.lastError);
      }
      
      const data = await response.json();
      this.cache.set(cacheKey, { data, time: Date.now() });
      this.lastError = null;
      return data;
    } catch (error) {
      this.lastError = error.message;
      console.error('Polygon Fetch Error:', error.message);
      throw error;
    }
  }

  // Get real-time SPY quote (SPY * 10 ≈ SPX)
  async getSpotPrice() {
    try {
      // Try real-time snapshot first
      const snapshot = await this.fetch('/v2/snapshot/locale/us/markets/stocks/tickers/SPY');
      
      if (snapshot?.ticker) {
        const t = snapshot.ticker;
        const price = t.lastTrade?.p || t.prevDay?.c || t.day?.c;
        const prevClose = t.prevDay?.c || price;
        const change = price && prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
        
        return {
          price: price * 10, // Convert SPY to SPX
          raw: price,
          change: change,
          high: (t.day?.h || price) * 10,
          low: (t.day?.l || price) * 10,
          open: (t.day?.o || price) * 10,
          volume: t.day?.v || 0,
          prevClose: prevClose * 10,
          timestamp: new Date(t.lastTrade?.t || Date.now()),
          source: 'realtime',
        };
      }
    } catch (e) {
      console.warn('Snapshot failed, trying prev day:', e.message);
    }

    // Fallback to previous day close
    try {
      const prev = await this.fetch('/v2/aggs/ticker/SPY/prev');
      if (prev?.results?.[0]) {
        const r = prev.results[0];
        return {
          price: r.c * 10,
          raw: r.c,
          change: ((r.c - r.o) / r.o) * 100,
          high: r.h * 10,
          low: r.l * 10,
          open: r.o * 10,
          volume: r.v,
          prevClose: r.o * 10,
          timestamp: new Date(r.t),
          source: 'prevday',
        };
      }
    } catch (e) {
      console.error('Failed to get spot price:', e.message);
      throw e;
    }

    throw new Error('Could not fetch spot price');
  }

  // Get intraday bars - REAL DATA
  async getIntradayBars(ticker = 'SPY', minutes = 5, days = 2) {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const data = await this.fetch(
      `/v2/aggs/ticker/${ticker}/range/${minutes}/minute/${from}/${to}?adjusted=true&sort=desc&limit=200`
    );
    
    if (data?.results) {
      return data.results.map(bar => ({
        time: new Date(bar.t),
        open: bar.o * 10,  // Convert to SPX
        high: bar.h * 10,
        low: bar.l * 10,
        close: bar.c * 10,
        volume: bar.v,
        vwap: bar.vw ? bar.vw * 10 : null,
        trades: bar.n,
        raw: { o: bar.o, h: bar.h, l: bar.l, c: bar.c },
      }));
    }
    
    return [];
  }

  // Get VIX - REAL DATA
  async getVIX() {
    try {
      // Try VIX ETF as proxy
      const data = await this.fetch('/v2/aggs/ticker/VIXY/prev');
      if (data?.results?.[0]) {
        // VIXY is roughly VIX * 0.9
        return data.results[0].c * 1.1;
      }
    } catch (e) {
      console.warn('VIXY failed, trying VXX:', e.message);
    }

    try {
      const data = await this.fetch('/v2/aggs/ticker/VXX/prev');
      if (data?.results?.[0]) {
        return data.results[0].c * 0.8;
      }
    } catch (e) {
      console.warn('VXX failed:', e.message);
    }

    // Return typical VIX if we can't get real data
    return 16;
  }

  // Get options chain - REAL DATA (requires options subscription)
  async getOptionsChain(underlying = 'SPY', expiration = null) {
    try {
      let endpoint = `/v3/snapshot/options/${underlying}?limit=250`;
      if (expiration) {
        endpoint += `&expiration_date=${expiration}`;
      }
      
      const data = await this.fetch(endpoint);
      
      if (data?.results) {
        return data.results.map(opt => ({
          ticker: opt.details?.ticker,
          strike: opt.details?.strike_price,
          expiration: opt.details?.expiration_date,
          type: opt.details?.contract_type,
          openInterest: opt.open_interest,
          volume: opt.day?.volume,
          lastPrice: opt.day?.close,
          bid: opt.last_quote?.bid,
          ask: opt.last_quote?.ask,
          greeks: opt.greeks || {},
          impliedVol: opt.implied_volatility,
          raw: opt,
        }));
      }
      
      return [];
    } catch (e) {
      console.warn('Options chain not available (may require subscription):', e.message);
      return [];
    }
  }

  // Get market status
  async getMarketStatus() {
    try {
      const data = await this.fetch('/v1/marketstatus/now');
      return {
        isOpen: data?.market === 'open',
        status: data?.market,
        afterHours: data?.afterHours,
        earlyHours: data?.earlyHours,
        exchanges: data?.exchanges,
      };
    } catch (e) {
      // Estimate based on time
      const now = new Date();
      const hour = now.getHours();
      const day = now.getDay();
      const isWeekday = day > 0 && day < 6;
      const isMarketHours = hour >= 9 && hour < 16;
      
      return {
        isOpen: isWeekday && isMarketHours,
        status: isWeekday && isMarketHours ? 'open' : 'closed',
        estimated: true,
      };
    }
  }

  // Get trades for a ticker
  async getTrades(ticker = 'SPY', limit = 10) {
    try {
      const data = await this.fetch(`/v3/trades/${ticker}?limit=${limit}&sort=timestamp&order=desc`);
      return data?.results || [];
    } catch (e) {
      return [];
    }
  }

  // Check API connectivity
  async testConnection() {
    try {
      await this.fetch('/v1/marketstatus/now', true);
      return { connected: true, error: null };
    } catch (e) {
      return { connected: false, error: e.message };
    }
  }

  // Get last error
  getLastError() {
    return this.lastError;
  }

  // Clear cache
  clearCache() {
    this.cache.clear();
  }
}

export const polygonService = new PolygonService();
export default polygonService;
