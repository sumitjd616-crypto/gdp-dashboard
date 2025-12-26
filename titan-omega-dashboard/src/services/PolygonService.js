/**
 * Polygon.io API Service for Real-Time Market Data
 */

const API_KEY = import.meta.env.VITE_POLYGON_API_KEY || 'demo';
const BASE_URL = 'https://api.polygon.io';

class PolygonService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 30000; // 30 second cache
  }

  async fetch(endpoint, options = {}) {
    const cacheKey = endpoint;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.time < this.cacheTimeout) {
      return cached.data;
    }

    const url = `${BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}apiKey=${API_KEY}`;
    
    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        if (response.status === 403) {
          console.warn('Polygon API: Access denied - using demo data');
          return null;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      this.cache.set(cacheKey, { data, time: Date.now() });
      return data;
    } catch (error) {
      console.error('Polygon API Error:', error.message);
      return null;
    }
  }

  // Get previous day's close for SPY (SPX proxy)
  async getSpotPrice() {
    const data = await this.fetch('/v2/aggs/ticker/SPY/prev');
    if (data?.results?.[0]) {
      return {
        price: data.results[0].c * 10, // SPY * 10 ≈ SPX
        change: ((data.results[0].c - data.results[0].o) / data.results[0].o) * 100,
        high: data.results[0].h * 10,
        low: data.results[0].l * 10,
        volume: data.results[0].v,
      };
    }
    return null;
  }

  // Get intraday bars
  async getIntradayBars(ticker = 'SPY', minutes = 5, days = 1) {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const data = await this.fetch(
      `/v2/aggs/ticker/${ticker}/range/${minutes}/minute/${from}/${to}?adjusted=true&sort=desc&limit=100`
    );
    
    if (data?.results) {
      return data.results.map(bar => ({
        time: new Date(bar.t),
        open: bar.o * 10,
        high: bar.h * 10,
        low: bar.l * 10,
        close: bar.c * 10,
        volume: bar.v,
        vwap: bar.vw * 10,
      }));
    }
    return [];
  }

  // Get VIX
  async getVIX() {
    // VIX is typically available via different endpoints
    // For now, estimate from market conditions
    const data = await this.fetch('/v2/aggs/ticker/VIXY/prev');
    if (data?.results?.[0]) {
      return data.results[0].c * 1.5; // Rough VIX estimate
    }
    return 15; // Default VIX
  }

  // Get options chain snapshot (requires options subscription)
  async getOptionsChain(underlying = 'SPY') {
    const data = await this.fetch(`/v3/snapshot/options/${underlying}?limit=250`);
    return data?.results || [];
  }

  // Get market status
  async getMarketStatus() {
    const data = await this.fetch('/v1/marketstatus/now');
    return data;
  }
}

export const polygonService = new PolygonService();
export default polygonService;
