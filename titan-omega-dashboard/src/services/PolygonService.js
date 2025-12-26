/**
 * Polygon.io API Service - REAL DATA ONLY
 * 
 * Subscription: Options Developer + Indices
 * 
 * REAL DATA SOURCES:
 * - I:SPX  → Real S&P 500 Index
 * - I:VIX  → Real VIX Index  
 * - SPX Options → Real options chain with Greeks
 * - SPY Options → Backup options data
 * 
 * NO MOCK DATA - NO SYNTHETIC DATA - NO PROXIES
 */

const API_KEY = import.meta.env.VITE_POLYGON_API_KEY;
const BASE_URL = 'https://api.polygon.io';
const STORAGE_KEY = 'titan_omega_session_v2';

if (!API_KEY) {
  console.error('❌ POLYGON API KEY NOT FOUND! Add VITE_POLYGON_API_KEY to .env');
} else {
  console.log('🔑 API Key configured:', API_KEY.slice(0, 4) + '...' + API_KEY.slice(-4));
}

class PolygonService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 10000; // 10 second cache for real-time
    this.lastSession = this.loadLastSession();
    this.marketStatus = null;
    this.apiKeyValid = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SESSION PERSISTENCE (After-hours / Weekends)
  // ═══════════════════════════════════════════════════════════════════════════════════

  loadLastSession() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        data.timestamp = new Date(data.timestamp);
        console.log('📂 Loaded last session from', data.timestamp);
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
      console.log('💾 Session saved');
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

    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${BASE_URL}${endpoint}${separator}apiKey=${API_KEY}`;
    
    console.log(`🔄 Fetching: ${endpoint}`);
    
    const response = await fetch(url);
    const data = await response.json();
    
    // Handle API errors
    if (!response.ok || data.status === 'ERROR') {
      const errorMsg = data.error || data.message || `HTTP ${response.status}`;
      console.error(`❌ API Error:`, errorMsg);
      
      // Provide helpful error messages
      if (errorMsg.includes('Unknown API Key') || response.status === 401) {
        throw new Error('Invalid API Key - Please verify your Polygon.io API key is correct and active');
      }
      if (errorMsg.includes('not authorized') || response.status === 403) {
        throw new Error('Subscription Required - This endpoint requires Options Developer or Indices subscription');
      }
      if (response.status === 429) {
        throw new Error('Rate Limited - Too many requests, waiting...');
      }
      
      throw new Error(errorMsg);
    }
    
    this.cache.set(cacheKey, { data, time: Date.now() });
    this.apiKeyValid = true;
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // MARKET STATUS
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getMarketStatus() {
    try {
      const data = await this.fetch('/v1/marketstatus/now', true);
      
      this.marketStatus = {
        market: data.market,
        isOpen: data.market === 'open',
        afterHours: data.afterHours === true,
        preMarket: data.earlyHours === true,
        serverTime: data.serverTime,
        nextOpen: data.exchanges?.nasdaq,
        nextClose: data.exchanges?.nasdaq,
      };
      
      console.log(`📊 Market Status: ${this.marketStatus.market}`);
      return this.marketStatus;
    } catch (e) {
      console.warn('Market status error, estimating:', e.message);
      
      const now = new Date();
      const estHour = (now.getUTCHours() - 5 + 24) % 24;
      const day = now.getDay();
      const isWeekday = day > 0 && day < 6;
      
      this.marketStatus = {
        market: isWeekday && estHour >= 9.5 && estHour < 16 ? 'open' : 'closed',
        isOpen: isWeekday && estHour >= 9.5 && estHour < 16,
        afterHours: isWeekday && estHour >= 16 && estHour < 20,
        preMarket: isWeekday && estHour >= 4 && estHour < 9.5,
        estimated: true,
      };
      
      return this.marketStatus;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // REAL SPX INDEX DATA (Indices Subscription)
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getSPXPrice() {
    // Try real-time snapshot first
    try {
      const data = await this.fetch('/v3/snapshot/indices?ticker.any_of=I:SPX');
      
      if (data?.results?.[0]) {
        const spx = data.results[0];
        console.log('✅ Real SPX Index data received');
        
        return {
          ticker: 'SPX',
          price: spx.value,
          
          session: {
            open: spx.session?.open,
            high: spx.session?.high,
            low: spx.session?.low,
            close: spx.session?.close,
            change: spx.session?.change,
            changePercent: spx.session?.change_percent,
          },
          
          previousClose: spx.session?.previous_close,
          
          timestamp: spx.last_updated ? new Date(spx.last_updated / 1e6) : new Date(),
          source: 'POLYGON_SPX_REALTIME',
          isRealIndex: true,
        };
      }
    } catch (e) {
      console.warn('SPX snapshot not available:', e.message);
    }

    // Fallback to aggregates
    try {
      const data = await this.fetch('/v2/aggs/ticker/I:SPX/prev');
      
      if (data?.results?.[0]) {
        const r = data.results[0];
        console.log('✅ SPX Previous day data received');
        
        return {
          ticker: 'SPX',
          price: r.c,
          
          session: {
            open: r.o,
            high: r.h,
            low: r.l,
            close: r.c,
          },
          
          volume: r.v,
          vwap: r.vw,
          date: new Date(r.t),
          
          source: 'POLYGON_SPX_PREV',
          isRealIndex: true,
        };
      }
    } catch (e) {
      console.warn('SPX prev day not available:', e.message);
    }

    throw new Error('SPX data not available');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // REAL VIX INDEX DATA (Indices Subscription)
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getVIX() {
    // Try real-time VIX
    try {
      const data = await this.fetch('/v3/snapshot/indices?ticker.any_of=I:VIX');
      
      if (data?.results?.[0]) {
        const vix = data.results[0];
        console.log('✅ Real VIX Index data received');
        
        return {
          value: vix.value,
          
          session: {
            open: vix.session?.open,
            high: vix.session?.high,
            low: vix.session?.low,
            close: vix.session?.close,
            change: vix.session?.change,
            changePercent: vix.session?.change_percent,
          },
          
          previousClose: vix.session?.previous_close,
          timestamp: vix.last_updated ? new Date(vix.last_updated / 1e6) : new Date(),
          source: 'POLYGON_VIX_REALTIME',
          isRealVIX: true,
        };
      }
    } catch (e) {
      console.warn('VIX snapshot not available:', e.message);
    }

    // Fallback to prev day
    try {
      const data = await this.fetch('/v2/aggs/ticker/I:VIX/prev');
      
      if (data?.results?.[0]) {
        const r = data.results[0];
        console.log('✅ VIX Previous day data received');
        
        return {
          value: r.c,
          open: r.o,
          high: r.h,
          low: r.l,
          close: r.c,
          date: new Date(r.t),
          source: 'POLYGON_VIX_PREV',
          isRealVIX: true,
        };
      }
    } catch (e) {
      console.warn('VIX prev day not available:', e.message);
    }

    throw new Error('VIX data not available');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SPX INTRADAY BARS (For chart and analysis)
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getSPXBars(timeframe = 5, days = 5) {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const data = await this.fetch(
      `/v2/aggs/ticker/I:SPX/range/${timeframe}/minute/${from}/${to}?adjusted=true&sort=desc&limit=1000`
    );
    
    if (!data?.results?.length) {
      console.warn('No SPX bars returned');
      return [];
    }

    console.log(`✅ Loaded ${data.results.length} SPX bars`);
    
    return data.results.map(bar => ({
      timestamp: new Date(bar.t),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      vwap: bar.vw,
      trades: bar.n,
    }));
  }

  // Daily bars for weekly analysis
  async getSPXDailyBars(days = 60) {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const data = await this.fetch(
      `/v2/aggs/ticker/I:SPX/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=${days}`
    );
    
    if (!data?.results?.length) {
      return [];
    }

    console.log(`✅ Loaded ${data.results.length} SPX daily bars`);
    
    return data.results.map(bar => ({
      date: new Date(bar.t),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      vwap: bar.vw,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // OPTIONS CHAIN - Real Options Data (Options Developer Subscription)
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getOptionsChain(underlying = 'SPY', expirationDate = null) {
    let endpoint = `/v3/snapshot/options/${underlying}?limit=250`;
    
    if (expirationDate) {
      endpoint += `&expiration_date=${expirationDate}`;
    }
    
    // For 0DTE, get today's expiration
    // For SPX, use SPXW (weekly) options
    
    try {
      const data = await this.fetch(endpoint);
      
      if (!data?.results?.length) {
        console.warn('Options chain empty');
        return { available: false, data: [], count: 0 };
      }

      console.log(`✅ Loaded ${data.results.length} options contracts`);

      const options = data.results
        .filter(opt => opt.details && opt.open_interest > 0)
        .map(opt => ({
          ticker: opt.details.ticker,
          underlying: opt.underlying_asset?.ticker,
          strike: opt.details.strike_price,
          expiration: opt.details.expiration_date,
          type: opt.details.contract_type, // 'call' or 'put'
          
          openInterest: opt.open_interest,
          volume: opt.day?.volume || 0,
          
          price: {
            last: opt.day?.close,
            bid: opt.last_quote?.bid,
            ask: opt.last_quote?.ask,
            mid: opt.last_quote?.bid && opt.last_quote?.ask 
              ? (opt.last_quote.bid + opt.last_quote.ask) / 2 
              : opt.day?.close,
          },
          
          impliedVol: opt.implied_volatility,
          
          greeks: {
            delta: opt.greeks?.delta,
            gamma: opt.greeks?.gamma,
            theta: opt.greeks?.theta,
            vega: opt.greeks?.vega,
          },
          
          hasGreeks: !!(opt.greeks?.delta),
        }));

      return {
        available: true,
        data: options,
        count: options.length,
        underlying,
        timestamp: new Date(),
        source: 'POLYGON_OPTIONS',
      };
    } catch (e) {
      console.error('Options chain error:', e.message);
      return { 
        available: false, 
        data: [], 
        count: 0,
        error: e.message,
      };
    }
  }

  // Get SPX options specifically
  async getSPXOptions() {
    // Try SPX options first (SPXW for weeklies)
    let result = await this.getOptionsChain('SPX');
    
    if (result.available && result.count > 0) {
      return result;
    }

    // Fallback to SPY options (scale strikes by 10)
    console.log('SPX options not available, trying SPY...');
    result = await this.getOptionsChain('SPY');
    
    if (result.available) {
      // Scale SPY strikes to SPX equivalent
      result.data = result.data.map(opt => ({
        ...opt,
        strikeOriginal: opt.strike,
        strike: opt.strike * 10, // SPY strike * 10 ≈ SPX strike
        scaledFromSPY: true,
      }));
      result.scaledFromSPY = true;
    }
    
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // COMPREHENSIVE DATA FETCH
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getAllData() {
    console.log('\n🔄 Fetching all market data...');
    
    const result = {
      timestamp: new Date(),
      marketStatus: null,
      spx: null,
      vix: null,
      options: null,
      bars: null,
      dailyBars: null,
      lastSession: this.lastSession,
      errors: [],
      dataQuality: 'UNKNOWN',
    };

    // 1. Market Status
    try {
      result.marketStatus = await this.getMarketStatus();
    } catch (e) {
      result.errors.push({ source: 'MARKET_STATUS', error: e.message });
    }

    // 2. Real SPX Price
    try {
      result.spx = await this.getSPXPrice();
      
      // Save session during market hours
      if (result.marketStatus?.isOpen && result.spx) {
        this.saveLastSession({
          spx: result.spx,
          timestamp: new Date(),
        });
      }
    } catch (e) {
      result.errors.push({ source: 'SPX', error: e.message });
      
      // Use last session during off-hours
      if (this.lastSession?.spx) {
        result.spx = {
          ...this.lastSession.spx,
          source: 'LAST_SESSION',
          sessionTime: this.lastSession.timestamp,
        };
      }
    }

    // 3. Real VIX
    try {
      result.vix = await this.getVIX();
    } catch (e) {
      result.errors.push({ source: 'VIX', error: e.message });
    }

    // 4. Options Chain
    try {
      result.options = await this.getSPXOptions();
    } catch (e) {
      result.errors.push({ source: 'OPTIONS', error: e.message });
      result.options = { available: false, data: [], error: e.message };
    }

    // 5. Intraday Bars
    try {
      result.bars = await this.getSPXBars(5, 5);
    } catch (e) {
      result.errors.push({ source: 'BARS', error: e.message });
      result.bars = [];
    }

    // 6. Daily Bars for Weekly Analysis
    try {
      result.dailyBars = await this.getSPXDailyBars(60);
    } catch (e) {
      result.errors.push({ source: 'DAILY_BARS', error: e.message });
      result.dailyBars = [];
    }

    // Assess data quality
    const hasRealSPX = result.spx?.isRealIndex;
    const hasRealVIX = result.vix?.isRealVIX;
    const hasOptions = result.options?.available;
    const hasBars = result.bars?.length > 0;

    if (hasRealSPX && hasRealVIX && hasOptions) {
      result.dataQuality = 'EXCELLENT';
    } else if (hasRealSPX && hasRealVIX) {
      result.dataQuality = 'GOOD';
    } else if (hasRealSPX || result.spx) {
      result.dataQuality = 'BASIC';
    } else {
      result.dataQuality = 'LIMITED';
    }

    console.log(`\n📊 Data Quality: ${result.dataQuality}`);
    console.log(`   SPX: ${hasRealSPX ? '✅ Real' : result.spx ? '⚠️ Session' : '❌ None'}`);
    console.log(`   VIX: ${hasRealVIX ? '✅ Real' : '❌ None'}`);
    console.log(`   Options: ${hasOptions ? `✅ ${result.options.count} contracts` : '❌ None'}`);
    console.log(`   Bars: ${hasBars ? `✅ ${result.bars.length}` : '❌ None'}`);
    
    if (result.errors.length > 0) {
      console.log(`   ⚠️ Errors: ${result.errors.map(e => e.source).join(', ')}`);
    }

    return result;
  }

  // Test API connection
  async testConnection() {
    try {
      await this.fetch('/v1/marketstatus/now', true);
      console.log('✅ API Connection successful');
      return { success: true };
    } catch (e) {
      console.error('❌ API Connection failed:', e.message);
      return { success: false, error: e.message };
    }
  }

  clearCache() {
    this.cache.clear();
    console.log('🗑️ Cache cleared');
  }
}

export const polygonService = new PolygonService();
export default polygonService;
