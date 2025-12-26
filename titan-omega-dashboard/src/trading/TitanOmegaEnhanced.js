/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA ENHANCED - INSTITUTIONAL GRADE TRADING ENGINE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Inspired by:
 * 🧠 Andrej Karpathy - Adaptive learning, pattern recognition, feature extraction
 * 🔍 Larry Page - Efficient algorithms, scalable data processing, PageRank-style signal weighting
 * 📈 Mark Minervini - SEPA methodology, trend templates, proper risk management
 * 
 * Features:
 * - Real-time options Greeks calculations (Delta, Gamma, Vega, Theta, Charm, Vanna)
 * - Machine learning-inspired pattern recognition
 * - Minervini's Trend Template validation
 * - Statistical edge tracking and adaptive position sizing
 * - Kelly Criterion-based risk management
 * - Real-time GEX (Gamma Exposure) calculations
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION - MINERVINI STYLE RISK MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

export const CONFIG = {
  account: {
    size: 2000,
    maxRiskPerTrade: 0.25,      // 25% max risk per trade (Minervini: 0.5-1% for stocks, higher for options)
    maxPortfolioHeat: 0.50,     // 50% max total exposure
    maxDailyLoss: 0.15,         // 15% max daily drawdown
  },
  
  // Minervini's SEPA Criteria adapted for SPX intraday
  trendTemplate: {
    aboveMA10: true,            // Price above 10-bar MA
    aboveMA20: true,            // Price above 20-bar MA  
    aboveMA50: true,            // Price above 50-bar MA
    ma10AboveMA20: true,        // 10 MA > 20 MA
    ma20AboveMA50: true,        // 20 MA > 50 MA
    priceWithin25PctOf52WkHigh: true,  // Adapted: within range of session high
    priceAtLeast30PctAbove52WkLow: true, // Adapted: above session low
    relativeStrengthRank: 80,   // Minimum RS rank (top 20%)
  },
  
  // Options parameters
  options: {
    defaultDelta: 0.50,
    defaultGamma: 0.05,
    defaultVega: 0.10,
    defaultTheta: -0.02,
    riskFreeRate: 0.05,
    contractMultiplier: 100,
  },
  
  // Targets based on GEX levels and ATR
  targets: {
    minRMultiple: 2.0,          // Minimum 2:1 reward to risk
    tp1RMultiple: 2.0,          // TP1 at 2R
    tp2RMultiple: 3.5,          // TP2 at 3.5R
    tp3RMultiple: 5.0,          // TP3 at 5R (home run)
  },
  
  // ML-inspired parameters
  ml: {
    patternMemorySize: 100,     // Number of patterns to remember
    minPatternConfidence: 0.65, // Minimum pattern match confidence
    adaptiveLearningRate: 0.1,  // How fast to adapt to new data
    featureWeightDecay: 0.99,   // Feature importance decay
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// BLACK-SCHOLES OPTIONS PRICING & GREEKS (Karpathy: Mathematical Foundation)
// ═══════════════════════════════════════════════════════════════════════════

class OptionsGreeks {
  /**
   * Standard normal cumulative distribution function
   */
  static normalCDF(x) {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    
    return 0.5 * (1.0 + sign * y);
  }
  
  /**
   * Standard normal probability density function
   */
  static normalPDF(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }
  
  /**
   * Calculate d1 and d2 for Black-Scholes
   */
  static calculateD1D2(S, K, T, r, sigma) {
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    return { d1, d2 };
  }
  
  /**
   * Calculate all Greeks for a call option
   */
  static calculateCallGreeks(spot, strike, timeToExpiry, riskFreeRate, impliedVol) {
    const S = spot;
    const K = strike;
    const T = Math.max(timeToExpiry, 0.0001); // Avoid division by zero
    const r = riskFreeRate;
    const sigma = impliedVol;
    
    const { d1, d2 } = this.calculateD1D2(S, K, T, r, sigma);
    const sqrtT = Math.sqrt(T);
    
    // Delta: Rate of change of option price with respect to spot
    const delta = this.normalCDF(d1);
    
    // Gamma: Rate of change of delta with respect to spot
    const gamma = this.normalPDF(d1) / (S * sigma * sqrtT);
    
    // Vega: Sensitivity to volatility (per 1% move)
    const vega = S * this.normalPDF(d1) * sqrtT / 100;
    
    // Theta: Time decay (per day)
    const theta = (-S * this.normalPDF(d1) * sigma / (2 * sqrtT) - 
                   r * K * Math.exp(-r * T) * this.normalCDF(d2)) / 365;
    
    // Charm (Delta decay): dDelta/dTime
    const charm = -this.normalPDF(d1) * (2 * r * T - d2 * sigma * sqrtT) / 
                  (2 * T * sigma * sqrtT);
    
    // Vanna: dDelta/dVol or dVega/dSpot
    const vanna = -this.normalPDF(d1) * d2 / sigma;
    
    // Speed: dGamma/dSpot
    const speed = -gamma / S * (d1 / (sigma * sqrtT) + 1);
    
    // Option price
    const price = S * this.normalCDF(d1) - K * Math.exp(-r * T) * this.normalCDF(d2);
    
    return {
      price,
      delta,
      gamma,
      vega,
      theta,
      charm,
      vanna,
      speed,
      d1,
      d2,
    };
  }
  
  /**
   * Calculate all Greeks for a put option
   */
  static calculatePutGreeks(spot, strike, timeToExpiry, riskFreeRate, impliedVol) {
    const callGreeks = this.calculateCallGreeks(spot, strike, timeToExpiry, riskFreeRate, impliedVol);
    
    // Put-call parity adjustments
    return {
      ...callGreeks,
      delta: callGreeks.delta - 1,
      price: callGreeks.price - spot + strike * Math.exp(-riskFreeRate * timeToExpiry),
    };
  }
  
  /**
   * Calculate Gamma Exposure (GEX) at a strike
   * GEX = Gamma * Open Interest * Contract Multiplier * Spot^2 / 100
   */
  static calculateGEX(gamma, openInterest, spot, isCall = true, dealerPosition = 'short') {
    const contractMultiplier = CONFIG.options.contractMultiplier;
    const rawGEX = gamma * openInterest * contractMultiplier * spot * spot / 100;
    
    // Dealers are typically short calls and long puts
    // When short gamma, dealers must buy high and sell low (amplify moves)
    // When long gamma, dealers buy low and sell high (dampen moves)
    const sign = isCall ? (dealerPosition === 'short' ? -1 : 1) : (dealerPosition === 'long' ? 1 : -1);
    
    return rawGEX * sign;
  }
  
  /**
   * Find the gamma flip level (where net GEX = 0)
   */
  static findGammaFlip(strikes, gexByStrike, currentSpot) {
    let flipLevel = currentSpot;
    let minAbsGEX = Infinity;
    
    // Find strike closest to zero net GEX
    strikes.forEach(strike => {
      const absGEX = Math.abs(gexByStrike[strike] || 0);
      if (absGEX < minAbsGEX) {
        minAbsGEX = absGEX;
        flipLevel = strike;
      }
    });
    
    return flipLevel;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GEX ANALYSIS ENGINE (Page: Efficient Data Structure)
// ═══════════════════════════════════════════════════════════════════════════

class GEXEngine {
  constructor() {
    this.strikes = [];
    this.gexByStrike = {};
    this.netGEX = 0;
    this.gammaFlip = 0;
    this.majorLevels = [];
  }
  
  /**
   * Calculate GEX profile from options chain data
   */
  calculateGEXProfile(spot, optionsChain, impliedVol = 0.15, timeToExpiry = 1/365) {
    this.strikes = [];
    this.gexByStrike = {};
    this.netGEX = 0;
    
    // Generate strikes around spot (simulate options chain)
    const strikeInterval = 5; // $5 strike intervals
    const numStrikes = 20;
    
    for (let i = -numStrikes; i <= numStrikes; i++) {
      const strike = Math.round(spot / strikeInterval) * strikeInterval + i * strikeInterval;
      this.strikes.push(strike);
      
      // Calculate Greeks for this strike
      const callGreeks = OptionsGreeks.calculateCallGreeks(spot, strike, timeToExpiry, CONFIG.options.riskFreeRate, impliedVol);
      const putGreeks = OptionsGreeks.calculatePutGreeks(spot, strike, timeToExpiry, CONFIG.options.riskFreeRate, impliedVol);
      
      // Simulate open interest (higher at round numbers)
      const isRoundNumber = strike % 25 === 0;
      const baseOI = isRoundNumber ? 5000 : 1000;
      const distanceFromSpot = Math.abs(strike - spot);
      const oiMultiplier = Math.exp(-distanceFromSpot / 100);
      
      const callOI = Math.floor(baseOI * oiMultiplier * (1 + Math.random() * 0.5));
      const putOI = Math.floor(baseOI * oiMultiplier * (1 + Math.random() * 0.5));
      
      // Calculate GEX (dealers typically short calls, long puts for hedging)
      const callGEX = OptionsGreeks.calculateGEX(callGreeks.gamma, callOI, spot, true, 'short');
      const putGEX = OptionsGreeks.calculateGEX(putGreeks.gamma, putOI, spot, false, 'long');
      
      this.gexByStrike[strike] = callGEX + putGEX;
      this.netGEX += this.gexByStrike[strike];
    }
    
    // Find gamma flip level
    this.gammaFlip = OptionsGreeks.findGammaFlip(this.strikes, this.gexByStrike, spot);
    
    // Find major support/resistance levels (highest absolute GEX)
    this.majorLevels = this.strikes
      .map(s => ({ strike: s, gex: this.gexByStrike[s], absGEX: Math.abs(this.gexByStrike[s]) }))
      .sort((a, b) => b.absGEX - a.absGEX)
      .slice(0, 5);
    
    return {
      netGEX: this.netGEX,
      gammaFlip: this.gammaFlip,
      isPositiveGamma: spot > this.gammaFlip,
      majorLevels: this.majorLevels,
      gexByStrike: this.gexByStrike,
    };
  }
  
  /**
   * Get support/resistance based on GEX
   */
  getSupportResistance(spot) {
    const supports = this.strikes
      .filter(s => s < spot && this.gexByStrike[s] > 0)
      .sort((a, b) => b - a)
      .slice(0, 3);
    
    const resistances = this.strikes
      .filter(s => s > spot && this.gexByStrike[s] < 0)
      .sort((a, b) => a - b)
      .slice(0, 3);
    
    return { supports, resistances };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MINERVINI TREND TEMPLATE ANALYZER
// ═══════════════════════════════════════════════════════════════════════════

class TrendTemplateAnalyzer {
  /**
   * Calculate Simple Moving Average
   */
  static SMA(prices, period) {
    if (prices.length < period) return null;
    const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
  }
  
  /**
   * Calculate Exponential Moving Average
   */
  static EMA(prices, period) {
    if (prices.length < period) return null;
    const multiplier = 2 / (period + 1);
    let ema = this.SMA(prices.slice(0, period), period);
    
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
  }
  
  /**
   * Calculate Relative Strength (vs benchmark/session)
   */
  static calculateRelativeStrength(priceChange, benchmarkChange) {
    if (benchmarkChange === 0) return 100;
    return (priceChange / Math.abs(benchmarkChange)) * 100;
  }
  
  /**
   * Validate Minervini's Trend Template
   * Adapted for intraday SPX trading
   */
  static validateTrendTemplate(candles, currentBar) {
    if (candles.length < 50) return { valid: false, score: 0, criteria: {} };
    
    const prices = candles.map(c => c.close);
    const current = prices[prices.length - 1];
    
    // Calculate MAs
    const ma10 = this.SMA(prices, 10);
    const ma20 = this.SMA(prices, 20);
    const ma50 = this.SMA(prices, 50);
    
    // Session high/low (instead of 52-week)
    const sessionHigh = Math.max(...prices);
    const sessionLow = Math.min(...prices);
    
    // Evaluate criteria
    const criteria = {
      aboveMA10: current > ma10,
      aboveMA20: current > ma20,
      aboveMA50: current > ma50,
      ma10AboveMA20: ma10 > ma20,
      ma20AboveMA50: ma20 > ma50,
      within25PctOfHigh: current >= sessionHigh * 0.75,
      above30PctFromLow: current >= sessionLow * 1.30,
      trendingUp: prices[prices.length - 1] > prices[prices.length - 20],
    };
    
    // Calculate score
    const weights = {
      aboveMA10: 15,
      aboveMA20: 15,
      aboveMA50: 15,
      ma10AboveMA20: 15,
      ma20AboveMA50: 10,
      within25PctOfHigh: 10,
      above30PctFromLow: 10,
      trendingUp: 10,
    };
    
    let score = 0;
    Object.keys(criteria).forEach(key => {
      if (criteria[key]) score += weights[key] || 0;
    });
    
    // Template is valid if score >= 70
    const valid = score >= 70;
    
    return {
      valid,
      score,
      criteria,
      mas: { ma10, ma20, ma50 },
      sessionHigh,
      sessionLow,
    };
  }
  
  /**
   * Identify stage in Minervini's market cycle
   * Stage 1: Basing/Accumulation
   * Stage 2: Advancing (BEST for long)
   * Stage 3: Topping/Distribution
   * Stage 4: Declining (BEST for short)
   */
  static identifyStage(trendData) {
    const { criteria, mas } = trendData;
    
    if (criteria.aboveMA50 && criteria.ma10AboveMA20 && criteria.ma20AboveMA50 && criteria.trendingUp) {
      return { stage: 2, name: 'ADVANCING', bias: 'long', strength: 'strong' };
    }
    
    if (criteria.aboveMA50 && !criteria.ma10AboveMA20) {
      return { stage: 3, name: 'TOPPING', bias: 'neutral', strength: 'weak' };
    }
    
    if (!criteria.aboveMA50 && !criteria.aboveMA20) {
      return { stage: 4, name: 'DECLINING', bias: 'short', strength: 'strong' };
    }
    
    return { stage: 1, name: 'BASING', bias: 'neutral', strength: 'weak' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ML-INSPIRED PATTERN RECOGNITION (Karpathy Style)
// ═══════════════════════════════════════════════════════════════════════════

class PatternRecognition {
  constructor() {
    this.patternMemory = [];
    this.featureWeights = {};
    this.winRateByPattern = {};
    this.initializeFeatureWeights();
  }
  
  initializeFeatureWeights() {
    // Initialize feature importance weights (will adapt over time)
    this.featureWeights = {
      momentum: 1.0,
      volume: 1.0,
      volatility: 1.0,
      trendStrength: 1.0,
      gexAlignment: 1.0,
      rsi: 1.0,
      macd: 1.0,
      pattern: 1.0,
      timeOfDay: 1.0,
      greeksFlow: 1.0,
    };
  }
  
  /**
   * Extract features from market data (Feature Engineering)
   */
  extractFeatures(candles, index, gexData, greeks) {
    if (index < 50) return null;
    
    const c = candles[index];
    const recent = candles.slice(Math.max(0, index - 50), index + 1);
    const prices = recent.map(x => x.close);
    
    // Price features
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i-1]) / prices[i-1]);
    }
    
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdReturn = Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length);
    
    // Momentum features
    const momentum5 = (prices[prices.length-1] - prices[prices.length-6]) / prices[prices.length-6];
    const momentum10 = (prices[prices.length-1] - prices[prices.length-11]) / prices[prices.length-11];
    const momentum20 = (prices[prices.length-1] - prices[prices.length-21]) / prices[prices.length-21];
    
    // Volume features
    const volumes = recent.map(x => x.volume);
    const avgVolume = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const volumeRatio = c.volume / avgVolume;
    const volumeTrend = volumes[volumes.length-1] > volumes[volumes.length-6];
    
    // Volatility features
    const atr = this.calculateATR(recent);
    const volatilityRatio = atr / (prices[prices.length-1] * 0.001);
    
    // RSI
    const rsi = this.calculateRSI(prices);
    
    // MACD
    const macd = this.calculateMACD(prices);
    
    // Pattern features
    const candlePattern = this.identifyCandlePattern(candles, index);
    
    // Greeks features (if available)
    const deltaExposure = greeks?.delta || 0;
    const gammaExposure = greeks?.gamma || 0;
    const thetaDecay = greeks?.theta || 0;
    
    // GEX features
    const isPositiveGamma = gexData?.isPositiveGamma || false;
    const nearGammaFlip = gexData ? Math.abs(c.close - gexData.gammaFlip) < 10 : false;
    
    // Time features
    const hour = c.timestamp?.getHours() + (c.timestamp?.getMinutes() || 0) / 60 || 10;
    const isOpeningHour = hour >= 9.5 && hour <= 10.5;
    const isClosingHour = hour >= 15 && hour <= 16;
    const isPowerHour = isOpeningHour || isClosingHour;
    
    // Trend template
    const trendTemplate = TrendTemplateAnalyzer.validateTrendTemplate(candles.slice(0, index + 1), index);
    const stage = TrendTemplateAnalyzer.identifyStage(trendTemplate);
    
    return {
      // Raw features
      price: c.close,
      volume: c.volume,
      timestamp: c.timestamp,
      
      // Momentum
      momentum5,
      momentum10,
      momentum20,
      momentumScore: (momentum5 * 3 + momentum10 * 2 + momentum20) / 6,
      
      // Volume
      volumeRatio,
      volumeTrend,
      volumeSpike: volumeRatio > 1.5,
      
      // Volatility
      atr,
      volatilityRatio,
      stdReturn,
      
      // Oscillators
      rsi,
      rsiOversold: rsi < 30,
      rsiOverbought: rsi > 70,
      macd,
      macdBullish: macd.histogram > 0 && macd.histogram > macd.prevHistogram,
      macdBearish: macd.histogram < 0 && macd.histogram < macd.prevHistogram,
      
      // Pattern
      candlePattern,
      
      // Greeks & GEX
      deltaExposure,
      gammaExposure,
      thetaDecay,
      isPositiveGamma,
      nearGammaFlip,
      gexData,
      
      // Time
      hour,
      isPowerHour,
      isOpeningHour,
      isClosingHour,
      
      // Trend
      trendTemplate,
      stage,
      trendScore: trendTemplate.score,
      inStage2: stage.stage === 2,
      inStage4: stage.stage === 4,
    };
  }
  
  calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return 5;
    const recent = candles.slice(-period - 1);
    let sum = 0;
    for (let i = 1; i < recent.length; i++) {
      const tr = Math.max(
        recent[i].high - recent[i].low,
        Math.abs(recent[i].high - recent[i-1].close),
        Math.abs(recent[i].low - recent[i-1].close)
      );
      sum += tr;
    }
    return sum / period;
  }
  
  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    const recent = prices.slice(-period - 1);
    let gains = 0, losses = 0;
    for (let i = 1; i < recent.length; i++) {
      const change = recent[i] - recent[i-1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    const rs = (gains / period) / (losses / period || 0.001);
    return 100 - (100 / (1 + rs));
  }
  
  calculateMACD(prices) {
    const ema12 = this.EMA(prices, 12);
    const ema26 = this.EMA(prices, 26);
    const macdLine = ema12 - ema26;
    const signalLine = this.EMA([...prices.slice(0, -9), macdLine], 9);
    const histogram = macdLine - signalLine;
    
    // Previous histogram for comparison
    const prevPrices = prices.slice(0, -1);
    const prevEma12 = this.EMA(prevPrices, 12);
    const prevEma26 = this.EMA(prevPrices, 26);
    const prevMacdLine = prevEma12 - prevEma26;
    const prevSignalLine = this.EMA([...prevPrices.slice(0, -9), prevMacdLine], 9);
    const prevHistogram = prevMacdLine - prevSignalLine;
    
    return { macdLine, signalLine, histogram, prevHistogram };
  }
  
  EMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
  }
  
  identifyCandlePattern(candles, index) {
    if (index < 3) return { name: 'NONE', bias: 'neutral', strength: 0 };
    
    const c = candles[index];
    const p = candles[index - 1];
    const p2 = candles[index - 2];
    
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low || 0.01;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    
    // Doji
    if (body < range * 0.1) {
      return { name: 'DOJI', bias: 'neutral', strength: 0.5 };
    }
    
    // Hammer / Hanging Man
    if (lowerWick > body * 2 && upperWick < body * 0.3) {
      return { 
        name: c.close > c.open ? 'HAMMER' : 'HANGING_MAN', 
        bias: c.close > c.open ? 'bullish' : 'bearish', 
        strength: 0.7 
      };
    }
    
    // Shooting Star / Inverted Hammer
    if (upperWick > body * 2 && lowerWick < body * 0.3) {
      return { 
        name: c.close < c.open ? 'SHOOTING_STAR' : 'INVERTED_HAMMER', 
        bias: c.close < c.open ? 'bearish' : 'bullish', 
        strength: 0.7 
      };
    }
    
    // Engulfing
    if (body > Math.abs(p.close - p.open) * 1.2) {
      if (c.close > c.open && p.close < p.open && c.close > p.open && c.open < p.close) {
        return { name: 'BULLISH_ENGULFING', bias: 'bullish', strength: 0.85 };
      }
      if (c.close < c.open && p.close > p.open && c.open > p.close && c.close < p.open) {
        return { name: 'BEARISH_ENGULFING', bias: 'bearish', strength: 0.85 };
      }
    }
    
    // Three soldiers / crows
    if (c.close > c.open && p.close > p.open && p2.close > p2.open) {
      if (c.close > p.close && p.close > p2.close) {
        return { name: 'THREE_WHITE_SOLDIERS', bias: 'bullish', strength: 0.9 };
      }
    }
    if (c.close < c.open && p.close < p.open && p2.close < p2.open) {
      if (c.close < p.close && p.close < p2.close) {
        return { name: 'THREE_BLACK_CROWS', bias: 'bearish', strength: 0.9 };
      }
    }
    
    // Strong momentum candle
    if (body > range * 0.7 && body > 5) {
      return { 
        name: c.close > c.open ? 'STRONG_BULL' : 'STRONG_BEAR', 
        bias: c.close > c.open ? 'bullish' : 'bearish', 
        strength: 0.75 
      };
    }
    
    return { name: 'NONE', bias: 'neutral', strength: 0 };
  }
  
  /**
   * Calculate weighted signal score (PageRank-inspired)
   */
  calculateSignalScore(features) {
    let score = 0;
    const breakdown = {};
    
    // Momentum score (weight: 20%)
    const momentumScore = Math.min(100, Math.abs(features.momentumScore) * 5000 + 
      (features.momentum5 > 0 && features.momentum10 > 0 ? 20 : 0));
    breakdown.momentum = momentumScore;
    score += momentumScore * this.featureWeights.momentum * 0.20;
    
    // Volume score (weight: 15%)
    const volumeScore = features.volumeSpike ? 90 : 
      features.volumeRatio > 1.3 ? 70 : 
      features.volumeRatio > 1.0 ? 50 : 30;
    breakdown.volume = volumeScore;
    score += volumeScore * this.featureWeights.volume * 0.15;
    
    // Trend score (weight: 20%)
    const trendScore = features.trendScore;
    breakdown.trend = trendScore;
    score += trendScore * this.featureWeights.trendStrength * 0.20;
    
    // GEX alignment score (weight: 15%)
    const gexScore = features.isPositiveGamma ? 70 : 50;
    const gexBonus = features.nearGammaFlip ? 20 : 0;
    breakdown.gex = gexScore + gexBonus;
    score += (gexScore + gexBonus) * this.featureWeights.gexAlignment * 0.15;
    
    // RSI score (weight: 10%)
    const rsiScore = features.rsiOversold || features.rsiOverbought ? 80 : 50;
    breakdown.rsi = rsiScore;
    score += rsiScore * this.featureWeights.rsi * 0.10;
    
    // Pattern score (weight: 10%)
    const patternScore = features.candlePattern.strength * 100;
    breakdown.pattern = patternScore;
    score += patternScore * this.featureWeights.pattern * 0.10;
    
    // Time score (weight: 10%)
    const timeScore = features.isPowerHour ? 85 : 50;
    breakdown.time = timeScore;
    score += timeScore * this.featureWeights.timeOfDay * 0.10;
    
    return {
      total: Math.round(score),
      breakdown,
      grade: score >= 75 ? 'A' : score >= 65 ? 'B' : score >= 55 ? 'C' : 'D',
      tradeable: score >= 68,
    };
  }
  
  /**
   * Store pattern outcome for learning
   */
  recordPatternOutcome(pattern, features, outcome) {
    const patternKey = this.getPatternKey(features);
    
    // Update pattern memory
    this.patternMemory.push({
      key: patternKey,
      features: this.simplifyFeatures(features),
      outcome,
      timestamp: Date.now(),
    });
    
    // Keep memory bounded
    if (this.patternMemory.length > CONFIG.ml.patternMemorySize) {
      this.patternMemory.shift();
    }
    
    // Update win rate tracking
    if (!this.winRateByPattern[patternKey]) {
      this.winRateByPattern[patternKey] = { wins: 0, losses: 0 };
    }
    if (outcome.win) {
      this.winRateByPattern[patternKey].wins++;
    } else {
      this.winRateByPattern[patternKey].losses++;
    }
    
    // Adaptive feature weight update
    this.updateFeatureWeights(features, outcome);
  }
  
  getPatternKey(features) {
    return `${features.candlePattern.name}_${features.stage.stage}_${features.isPositiveGamma ? 'PG' : 'NG'}`;
  }
  
  simplifyFeatures(features) {
    return {
      momentum: features.momentumScore > 0 ? 'up' : 'down',
      volume: features.volumeSpike ? 'spike' : 'normal',
      trend: features.trendScore > 70 ? 'strong' : 'weak',
      rsi: features.rsiOversold ? 'oversold' : features.rsiOverbought ? 'overbought' : 'neutral',
      pattern: features.candlePattern.name,
      stage: features.stage.stage,
    };
  }
  
  updateFeatureWeights(features, outcome) {
    const lr = CONFIG.ml.adaptiveLearningRate;
    const reward = outcome.win ? 1 : -1;
    const rMultiple = outcome.rMultiple || 0;
    
    // Adjust weights based on which features contributed to win/loss
    Object.keys(this.featureWeights).forEach(key => {
      // Decay all weights slightly
      this.featureWeights[key] *= CONFIG.ml.featureWeightDecay;
      
      // Boost weights for features that aligned with winning trade
      if (outcome.win && rMultiple > 1) {
        if (key === 'momentum' && Math.abs(features.momentumScore) > 0.001) {
          this.featureWeights[key] += lr * rMultiple;
        }
        if (key === 'volume' && features.volumeSpike) {
          this.featureWeights[key] += lr * rMultiple;
        }
        if (key === 'trendStrength' && features.trendScore > 70) {
          this.featureWeights[key] += lr * rMultiple;
        }
      }
      
      // Clamp weights between 0.5 and 2.0
      this.featureWeights[key] = Math.max(0.5, Math.min(2.0, this.featureWeights[key]));
    });
  }
  
  /**
   * Get pattern confidence based on historical performance
   */
  getPatternConfidence(features) {
    const patternKey = this.getPatternKey(features);
    const stats = this.winRateByPattern[patternKey];
    
    if (!stats || stats.wins + stats.losses < 3) {
      return { confidence: 0.5, sampleSize: 0 };
    }
    
    const winRate = stats.wins / (stats.wins + stats.losses);
    const sampleSize = stats.wins + stats.losses;
    
    // Confidence increases with sample size (Bayesian-inspired)
    const confidence = winRate * (1 - 1 / (sampleSize + 1));
    
    return { confidence, winRate, sampleSize };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// KELLY CRITERION POSITION SIZING (Minervini + Mathematical Edge)
// ═══════════════════════════════════════════════════════════════════════════

class PositionSizer {
  /**
   * Calculate optimal position size using Kelly Criterion
   * f* = (bp - q) / b
   * where: b = odds (avg win / avg loss), p = win probability, q = 1 - p
   */
  static kellyFraction(winRate, avgWin, avgLoss) {
    const p = winRate;
    const q = 1 - p;
    const b = avgWin / avgLoss;
    
    const kelly = (b * p - q) / b;
    
    // Use fractional Kelly (typically 25-50%) for safety
    const fractionalKelly = kelly * 0.25;
    
    return Math.max(0, Math.min(0.25, fractionalKelly)); // Cap at 25%
  }
  
  /**
   * Calculate position size based on risk
   * Minervini method: Risk fixed dollar amount, size position accordingly
   */
  static calculatePositionSize(accountSize, riskPercent, entryPrice, stopPrice) {
    const riskAmount = accountSize * riskPercent;
    const riskPerShare = Math.abs(entryPrice - stopPrice);
    
    if (riskPerShare === 0) return 0;
    
    const shares = Math.floor(riskAmount / riskPerShare);
    const positionValue = shares * entryPrice;
    const positionPercent = positionValue / accountSize;
    
    return {
      shares,
      positionValue,
      positionPercent,
      riskAmount,
      riskPerShare,
    };
  }
  
  /**
   * Adjust position size based on signal quality
   */
  static adjustForSignalQuality(baseSize, signalScore, confidence) {
    // Higher quality signals get larger positions
    const qualityMultiplier = 0.5 + (signalScore / 100) * 0.5;
    const confidenceMultiplier = 0.5 + confidence * 0.5;
    
    return baseSize * qualityMultiplier * confidenceMultiplier;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENHANCED TRADING ENGINE
// ═══════════════════════════════════════════════════════════════════════════

export class TitanOmegaEnhanced {
  constructor() {
    this.gexEngine = new GEXEngine();
    this.patternRecognition = new PatternRecognition();
    this.account = { ...CONFIG.account };
    this.position = null;
    this.trades = [];
    this.dailyPnL = 0;
    this.stats = { wins: 0, losses: 0, totalPnL: 0 };
  }
  
  /**
   * Analyze market and generate signal
   */
  analyze(candles, index) {
    if (index < 50) return null;
    
    const currentPrice = candles[index].close;
    
    // Calculate GEX profile
    const gexData = this.gexEngine.calculateGEXProfile(currentPrice, null);
    
    // Calculate Greeks for current position
    const greeks = OptionsGreeks.calculateCallGreeks(
      currentPrice, 
      Math.round(currentPrice / 5) * 5,  // ATM strike
      1/365,  // 0DTE
      CONFIG.options.riskFreeRate,
      0.15  // 15% IV
    );
    
    // Extract features
    const features = this.patternRecognition.extractFeatures(candles, index, gexData, greeks);
    if (!features) return null;
    
    // Calculate signal score
    const score = this.patternRecognition.calculateSignalScore(features);
    
    // Get pattern confidence
    const patternConf = this.patternRecognition.getPatternConfidence(features);
    
    return {
      features,
      score,
      patternConfidence: patternConf,
      gexData,
      greeks,
      trendTemplate: features.trendTemplate,
      stage: features.stage,
    };
  }
  
  /**
   * Generate trade signal
   */
  generateSignal(analysis) {
    if (!analysis || !analysis.score.tradeable) return null;
    
    const { features, score, gexData, stage, patternConfidence } = analysis;
    
    let direction = null;
    const reasons = [];
    
    // LONG CONDITIONS (Minervini: Stage 2 + Trend Template + Catalyst)
    const longConditions = {
      stage2: stage.stage === 2,
      trendValid: features.trendScore >= 70,
      momentumUp: features.momentumScore > 0.0005,
      volumeConfirm: features.volumeRatio > 1.2,
      positiveGamma: features.isPositiveGamma,
      oversoldBounce: features.rsiOversold && features.candlePattern.bias === 'bullish',
      bullishPattern: features.candlePattern.bias === 'bullish' && features.candlePattern.strength > 0.6,
      macdBullish: features.macdBullish,
    };
    
    const longScore = Object.values(longConditions).filter(Boolean).length;
    
    if (longScore >= 4 && (longConditions.stage2 || longConditions.bullishPattern)) {
      direction = 'long';
      if (longConditions.stage2) reasons.push('📈 Stage 2 Uptrend');
      if (longConditions.bullishPattern) reasons.push(`🔨 ${features.candlePattern.name}`);
      if (longConditions.volumeConfirm) reasons.push('📊 Volume Confirm');
      if (longConditions.positiveGamma) reasons.push('✅ +Gamma');
      if (longConditions.oversoldBounce) reasons.push('📉 Oversold Bounce');
    }
    
    // SHORT CONDITIONS (Stage 4 + Breakdown + Negative Gamma)
    const shortConditions = {
      stage4: stage.stage === 4,
      trendBreaking: features.trendScore < 50,
      momentumDown: features.momentumScore < -0.0005,
      volumeConfirm: features.volumeRatio > 1.2,
      negativeGamma: !features.isPositiveGamma,
      overboughtDrop: features.rsiOverbought && features.candlePattern.bias === 'bearish',
      bearishPattern: features.candlePattern.bias === 'bearish' && features.candlePattern.strength > 0.6,
      macdBearish: features.macdBearish,
    };
    
    const shortScore = Object.values(shortConditions).filter(Boolean).length;
    
    if (!direction && shortScore >= 4 && (shortConditions.stage4 || shortConditions.bearishPattern)) {
      direction = 'short';
      if (shortConditions.stage4) reasons.push('📉 Stage 4 Downtrend');
      if (shortConditions.bearishPattern) reasons.push(`⭐ ${features.candlePattern.name}`);
      if (shortConditions.volumeConfirm) reasons.push('📊 Volume Confirm');
      if (shortConditions.negativeGamma) reasons.push('🔴 -Gamma');
      if (shortConditions.overboughtDrop) reasons.push('📈 Overbought Drop');
    }
    
    if (!direction) return null;
    
    // Calculate position size and targets
    const atr = features.atr;
    const stopDistance = Math.max(6, Math.min(12, atr * 1.5));
    
    // 25% max drawdown rule
    const maxStopPercent = CONFIG.account.maxRiskPerTrade;
    const maxStopPoints = features.price * maxStopPercent / 100 * 2; // Approximate
    const finalStopDistance = Math.min(stopDistance, maxStopPoints);
    
    const entry = features.price;
    const stop = direction === 'long' ? entry - finalStopDistance : entry + finalStopDistance;
    const riskPerPoint = Math.abs(entry - stop);
    
    // Targets based on R-multiples
    const tp1 = direction === 'long' ? 
      entry + riskPerPoint * CONFIG.targets.tp1RMultiple :
      entry - riskPerPoint * CONFIG.targets.tp1RMultiple;
    const tp2 = direction === 'long' ? 
      entry + riskPerPoint * CONFIG.targets.tp2RMultiple :
      entry - riskPerPoint * CONFIG.targets.tp2RMultiple;
    const tp3 = direction === 'long' ? 
      entry + riskPerPoint * CONFIG.targets.tp3RMultiple :
      entry - riskPerPoint * CONFIG.targets.tp3RMultiple;
    
    // Adjust position size for signal quality
    const baseRisk = CONFIG.account.maxRiskPerTrade;
    const adjustedRisk = PositionSizer.adjustForSignalQuality(
      baseRisk, 
      score.total, 
      patternConfidence.confidence
    );
    
    return {
      direction,
      entry,
      stop,
      tp1,
      tp2,
      tp3,
      score: score.total,
      reasons,
      riskPercent: adjustedRisk,
      features,
      gexData,
      greeks: analysis.greeks,
      stage,
      patternConfidence: patternConfidence.confidence,
    };
  }
  
  /**
   * Record trade outcome for learning
   */
  recordTradeOutcome(trade, exitPrice, exitReason) {
    const pnl = trade.direction === 'long' ? 
      exitPrice - trade.entry : 
      trade.entry - exitPrice;
    
    const rMultiple = pnl / Math.abs(trade.entry - trade.stop);
    const win = pnl > 0;
    
    // Record for pattern learning
    this.patternRecognition.recordPatternOutcome(
      trade.features.candlePattern,
      trade.features,
      { win, pnl, rMultiple, exitReason }
    );
    
    // Update stats
    if (win) this.stats.wins++;
    else this.stats.losses++;
    this.stats.totalPnL += pnl;
    
    return { pnl, rMultiple, win };
  }
  
  /**
   * Get current system statistics
   */
  getSystemStats() {
    const totalTrades = this.stats.wins + this.stats.losses;
    const winRate = totalTrades > 0 ? this.stats.wins / totalTrades : 0;
    
    return {
      totalTrades,
      wins: this.stats.wins,
      losses: this.stats.losses,
      winRate: (winRate * 100).toFixed(1) + '%',
      totalPnL: this.stats.totalPnL.toFixed(2),
      featureWeights: { ...this.patternRecognition.featureWeights },
      patternPerformance: { ...this.patternRecognition.winRateByPattern },
    };
  }
}

export default TitanOmegaEnhanced;
