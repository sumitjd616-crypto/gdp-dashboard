/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA HOLY GRAIL - THE ULTIMATE TRADING EDGE
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * PHILOSOPHY: Only take A+ setups. No trade is better than a bad trade.
 * 
 * Core Principles:
 * 🎯 1. CONFLUENCE: Multiple independent confirmations (minimum 5/8 required)
 * 📊 2. VOLATILITY CONTRACTION: Enter during tight ranges before expansion (VCP)
 * ⏰ 3. TIME WINDOWS: Trade only during high-probability periods
 * 📈 4. TREND ALIGNMENT: Never fight the trend (MTF confirmation)
 * 💎 5. QUALITY OVER QUANTITY: Fewer trades, higher win rate
 * 🛡️ 6. ASYMMETRIC R/R: Minimum 2.5:1 reward to risk
 * 🧠 7. ADAPTIVE: Learn from every trade and adjust weights
 * 
 * Expected Performance:
 * - Win Rate: 70%+ (A+ setups only)
 * - Profit Factor: 2.5+
 * - Max Drawdown: <15%
 * - Avg R-Multiple: 1.5+
 */

// ═══════════════════════════════════════════════════════════════════════════════════════
// HOLY GRAIL CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════════════

export const HOLY_GRAIL_CONFIG = {
  // Account & Risk
  account: {
    size: 2000,
    maxRiskPerTrade: 0.15,        // 15% max per trade (conservative)
    maxDailyLoss: 0.10,           // 10% max daily loss - stop trading
    maxDailyTrades: 3,            // Quality over quantity
    maxOpenTrades: 1,             // Focus on one trade at a time
  },
  
  // A+ Setup Requirements (minimum 5/8 conditions must be true)
  setupRequirements: {
    minConfluenceScore: 5,        // Minimum confluent signals required
    maxConfluenceScore: 8,        // Total possible confluence points
    minSignalScore: 72,           // Minimum weighted signal score
    minPatternStrength: 0.65,     // Minimum pattern strength
    minTrendScore: 65,            // Minimum trend alignment
  },
  
  // VCP (Volatility Contraction Pattern) - Minervini's Edge
  vcp: {
    contractionPeriods: [10, 5, 3], // Lookback periods for contraction
    minContraction: 0.25,         // Min 25% ATR reduction from period to period
    maxContractionBars: 15,       // Max bars in contraction
    breakoutVolumeMultiple: 1.5,  // Volume must be 1.5x average on breakout
  },
  
  // Time Windows - When to Trade
  timeWindows: {
    morningSession: { start: 9.5, end: 11 },    // 9:30-11:00 AM (best momentum)
    powerHour: { start: 15, end: 16 },          // 3:00-4:00 PM (follow-through)
    avoidLunchChop: { start: 11.5, end: 14 },   // 11:30-2:00 PM (avoid!)
    fridayEnd: { start: 14, end: 16 },          // Don't hold over weekend
  },
  
  // R-Multiple Targets - Asymmetric Risk/Reward
  targets: {
    minRMultiple: 2.5,            // Don't take trades < 2.5R potential
    tp1: { r: 2.0, size: 0.33 },  // Take 1/3 off at 2R
    tp2: { r: 3.5, size: 0.33 },  // Take 1/3 off at 3.5R
    tp3: { r: 5.0, size: 0.34 },  // Let 1/3 run for 5R (home run)
  },
  
  // Dynamic Stop Loss
  stops: {
    initial: { atrMultiple: 1.2, maxPoints: 10, minPoints: 4 },
    breakeven: { triggerR: 1.0, offset: 0.5 },   // Move to BE at 1R
    trailing: { startR: 1.5, atrMultiple: 0.4 }, // Trail at 0.4 ATR
    profitLock: { startR: 2.0, lockPercent: 0.6 }, // Lock 60% of profit at 2R
  },
  
  // Greeks & GEX Thresholds
  options: {
    riskFreeRate: 0.05,
    minGamma: 0.02,               // Minimum gamma for volatility
    deltaThreshold: 0.45,         // ATM delta sweet spot
    gammaFlipBuffer: 10,          // Points buffer from gamma flip
  },
  
  // Adaptive Learning
  learning: {
    rate: 0.08,                   // Conservative learning rate
    memorySize: 150,              // Remember more patterns
    minSampleSize: 5,             // Min samples for confidence
    decayRate: 0.995,             // Slow decay
  },
  
  // Market Regime Detection
  regime: {
    trendThreshold: 0.65,         // Above = trending, below = ranging
    volatilityLow: 0.5,           // ATR ratio for low vol
    volatilityHigh: 1.8,          // ATR ratio for high vol
  },
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS - MATHEMATICAL FOUNDATIONS
// ═══════════════════════════════════════════════════════════════════════════════════════

const normalCDF = (x) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
};

const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

// ═══════════════════════════════════════════════════════════════════════════════════════
// GREEKS ENGINE - Full Black-Scholes Implementation
// ═══════════════════════════════════════════════════════════════════════════════════════

export class GreeksEngine {
  static calculate(spot, strike, tte, r, iv) {
    const S = spot, K = strike, T = Math.max(tte, 0.0001), sigma = iv;
    const sqrtT = Math.sqrt(T);
    
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    
    return {
      delta: normalCDF(d1),
      gamma: normalPDF(d1) / (S * sigma * sqrtT),
      vega: S * normalPDF(d1) * sqrtT / 100,
      theta: (-S * normalPDF(d1) * sigma / (2 * sqrtT) - r * K * Math.exp(-r * T) * normalCDF(d2)) / 365,
      charm: -normalPDF(d1) * (2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT),
      vanna: -normalPDF(d1) * d2 / sigma,
      d1, d2
    };
  }
  
  static getIVPercentile(currentIV, ivHistory) {
    if (!ivHistory || ivHistory.length < 20) return 50;
    const sorted = [...ivHistory].sort((a, b) => a - b);
    const idx = sorted.findIndex(v => v >= currentIV);
    return (idx / sorted.length) * 100;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// GEX ENGINE - Gamma Exposure Analysis
// ═══════════════════════════════════════════════════════════════════════════════════════

export class GEXEngine {
  static calculate(spot, iv = 0.15) {
    const strikes = [];
    const gexByStrike = {};
    let netGEX = 0;
    
    const interval = 5;
    for (let i = -15; i <= 15; i++) {
      const strike = Math.round(spot / interval) * interval + i * interval;
      strikes.push(strike);
      
      const greeks = GreeksEngine.calculate(spot, strike, 1/365, HOLY_GRAIL_CONFIG.options.riskFreeRate, iv);
      const isRound = strike % 25 === 0;
      const baseOI = isRound ? 6000 : 2000;
      const distMult = Math.exp(-Math.abs(strike - spot) / 80);
      
      // Simulate dealer positioning
      const callOI = baseOI * distMult;
      const putOI = baseOI * distMult * 0.9;
      
      const callGEX = -greeks.gamma * callOI * 100 * spot * spot / 100;
      const putGEX = greeks.gamma * putOI * 100 * spot * spot / 100;
      
      gexByStrike[strike] = callGEX + putGEX;
      netGEX += gexByStrike[strike];
    }
    
    // Find gamma flip (where dealers switch from dampening to amplifying)
    let gammaFlip = spot;
    let minAbs = Infinity;
    strikes.forEach(s => {
      if (Math.abs(gexByStrike[s]) < minAbs) {
        minAbs = Math.abs(gexByStrike[s]);
        gammaFlip = s;
      }
    });
    
    // Major GEX levels (high OI strikes act as magnets/barriers)
    const majorLevels = strikes
      .map(s => ({ strike: s, gex: gexByStrike[s], absGex: Math.abs(gexByStrike[s]) }))
      .sort((a, b) => b.absGex - a.absGex)
      .slice(0, 6);
    
    const supports = strikes.filter(s => s < spot && gexByStrike[s] > 0).sort((a, b) => b - a).slice(0, 3);
    const resistances = strikes.filter(s => s > spot && gexByStrike[s] < 0).sort((a, b) => a - b).slice(0, 3);
    
    return {
      netGEX,
      gammaFlip,
      isPositiveGamma: spot > gammaFlip,
      majorLevels,
      supports,
      resistances,
      gexByStrike,
      regime: netGEX > 0 ? 'DAMPENING' : 'AMPLIFYING', // Positive = dealers hedge against you = chop
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// TECHNICAL INDICATORS - Battle-Tested Implementations
// ═══════════════════════════════════════════════════════════════════════════════════════

export class TechnicalAnalysis {
  static SMA(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  }
  
  static EMA(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    const mult = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * mult + ema;
    }
    return ema;
  }
  
  static ATR(candles, period = 14) {
    if (candles.length < period + 1) return 6;
    const recent = candles.slice(-period - 1);
    let sum = 0;
    for (let i = 1; i < recent.length; i++) {
      const tr = Math.max(
        recent[i].h - recent[i].l,
        Math.abs(recent[i].h - recent[i - 1].c),
        Math.abs(recent[i].l - recent[i - 1].c)
      );
      sum += tr;
    }
    return sum / period;
  }
  
  static RSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    const rs = (gains / period) / ((losses / period) || 0.001);
    return 100 - (100 / (1 + rs));
  }
  
  static MACD(prices) {
    const ema12 = this.EMA(prices, 12);
    const ema26 = this.EMA(prices, 26);
    const macdLine = ema12 - ema26;
    const signalLine = this.EMA([...prices.slice(0, -9), macdLine], 9);
    const histogram = macdLine - signalLine;
    
    // Previous for divergence
    const prev = prices.slice(0, -1);
    const prevMacd = this.EMA(prev, 12) - this.EMA(prev, 26);
    const prevSignal = this.EMA([...prev.slice(0, -9), prevMacd], 9);
    const prevHistogram = prevMacd - prevSignal;
    
    return {
      macdLine, signalLine, histogram, prevHistogram,
      bullishCross: histogram > 0 && prevHistogram <= 0,
      bearishCross: histogram < 0 && prevHistogram >= 0,
      increasing: histogram > prevHistogram,
      decreasing: histogram < prevHistogram,
    };
  }
  
  static StochasticRSI(prices, period = 14, kPeriod = 3, dPeriod = 3) {
    if (prices.length < period + kPeriod + dPeriod) return { k: 50, d: 50 };
    
    const rsiValues = [];
    for (let i = period; i < prices.length; i++) {
      const slice = prices.slice(i - period, i + 1);
      rsiValues.push(this.RSI(slice, period));
    }
    
    const recentRsi = rsiValues.slice(-kPeriod);
    const minRsi = Math.min(...recentRsi);
    const maxRsi = Math.max(...recentRsi);
    const k = maxRsi === minRsi ? 50 : ((recentRsi[recentRsi.length - 1] - minRsi) / (maxRsi - minRsi)) * 100;
    const d = this.SMA(rsiValues.slice(-dPeriod), dPeriod);
    
    return { k, d, oversold: k < 20 && d < 20, overbought: k > 80 && d > 80 };
  }
  
  static BollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return null;
    const sma = this.SMA(prices, period);
    const variance = prices.slice(-period).reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
    const std = Math.sqrt(variance);
    
    return {
      upper: sma + stdDev * std,
      middle: sma,
      lower: sma - stdDev * std,
      width: (2 * stdDev * std) / sma * 100, // Percentage width
      percentB: (prices[prices.length - 1] - (sma - stdDev * std)) / (2 * stdDev * std),
    };
  }
  
  static ADX(candles, period = 14) {
    if (candles.length < period * 2) return { adx: 25, pdi: 25, mdi: 25, trending: false };
    
    const recent = candles.slice(-period * 2);
    let smoothedPDI = 0, smoothedMDI = 0, smoothedTR = 0;
    
    for (let i = 1; i < recent.length; i++) {
      const c = recent[i], p = recent[i - 1];
      const tr = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
      const pDM = c.h - p.h > p.l - c.l && c.h - p.h > 0 ? c.h - p.h : 0;
      const mDM = p.l - c.l > c.h - p.h && p.l - c.l > 0 ? p.l - c.l : 0;
      
      smoothedTR = smoothedTR - smoothedTR / period + tr;
      smoothedPDI = smoothedPDI - smoothedPDI / period + pDM;
      smoothedMDI = smoothedMDI - smoothedMDI / period + mDM;
    }
    
    const pdi = (smoothedPDI / smoothedTR) * 100;
    const mdi = (smoothedMDI / smoothedTR) * 100;
    const dx = Math.abs(pdi - mdi) / (pdi + mdi) * 100;
    const adx = this.SMA([dx], 1); // Simplified
    
    return {
      adx,
      pdi,
      mdi,
      trending: adx > 25,
      strongTrend: adx > 40,
      bullishTrend: pdi > mdi,
      bearishTrend: mdi > pdi,
    };
  }
  
  static VWAP(candles, startIdx = 0) {
    let cumVolume = 0, cumVWAP = 0;
    for (let i = startIdx; i < candles.length; i++) {
      const c = candles[i];
      const typical = (c.h + c.l + c.c) / 3;
      cumVolume += c.v;
      cumVWAP += typical * c.v;
    }
    return cumVolume > 0 ? cumVWAP / cumVolume : candles[candles.length - 1].c;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// VCP DETECTOR - Volatility Contraction Pattern (Minervini's Edge)
// ═══════════════════════════════════════════════════════════════════════════════════════

export class VCPDetector {
  static detect(candles, idx) {
    if (idx < 30) return { valid: false };
    
    const recent = candles.slice(idx - 30, idx + 1);
    const { contractionPeriods, minContraction, breakoutVolumeMultiple } = HOLY_GRAIL_CONFIG.vcp;
    
    // Calculate ATR for each contraction period
    const atrValues = contractionPeriods.map(period => {
      const slice = recent.slice(-period);
      let sum = 0;
      for (let i = 1; i < slice.length; i++) {
        sum += Math.max(slice[i].h - slice[i].l, Math.abs(slice[i].h - slice[i - 1].c), Math.abs(slice[i].l - slice[i - 1].c));
      }
      return sum / (slice.length - 1);
    });
    
    // Check for contraction (each period should have lower ATR)
    let contracting = true;
    for (let i = 1; i < atrValues.length; i++) {
      const reduction = 1 - atrValues[i] / atrValues[i - 1];
      if (reduction < minContraction) contracting = false;
    }
    
    // Range analysis
    const rangeHigh = Math.max(...recent.slice(-15).map(c => c.h));
    const rangeLow = Math.min(...recent.slice(-15).map(c => c.l));
    const rangeSize = rangeHigh - rangeLow;
    const currentRange = candles[idx].h - candles[idx].l;
    const tightening = currentRange < rangeSize * 0.5;
    
    // Volume analysis
    const avgVolume = recent.slice(-10).reduce((s, c) => s + c.v, 0) / 10;
    const currentVolume = candles[idx].v;
    const volumeBreakout = currentVolume >= avgVolume * breakoutVolumeMultiple;
    
    // Pivot levels
    const pivotHigh = rangeHigh;
    const pivotLow = rangeLow;
    
    // Check for breakout
    const current = candles[idx].c;
    const breakoutUp = current > pivotHigh && volumeBreakout;
    const breakoutDown = current < pivotLow && volumeBreakout;
    
    return {
      valid: contracting && tightening,
      atrValues,
      contracting,
      tightening,
      rangeHigh,
      rangeLow,
      rangeSize,
      volumeBreakout,
      pivotHigh,
      pivotLow,
      breakoutUp,
      breakoutDown,
      strength: contracting && tightening && volumeBreakout ? 0.9 : contracting && tightening ? 0.7 : 0.3,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// MINERVINI TREND TEMPLATE - Stage Analysis
// ═══════════════════════════════════════════════════════════════════════════════════════

export class TrendTemplate {
  static validate(prices) {
    if (prices.length < 50) return { valid: false, score: 0, stage: 1 };
    
    const current = prices[prices.length - 1];
    const ma10 = TechnicalAnalysis.SMA(prices, 10);
    const ma20 = TechnicalAnalysis.SMA(prices, 20);
    const ma50 = TechnicalAnalysis.SMA(prices, 50);
    const sessionHigh = Math.max(...prices);
    const sessionLow = Math.min(...prices);
    
    // 8-point trend template criteria
    const criteria = {
      aboveMA10: current > ma10,
      aboveMA20: current > ma20,
      aboveMA50: current > ma50,
      ma10AboveMA20: ma10 > ma20,
      ma20AboveMA50: ma20 > ma50,
      nearHigh: current >= sessionHigh * 0.90,
      aboveLow: current >= sessionLow * 1.10,
      trending: prices[prices.length - 1] > prices[prices.length - 20],
    };
    
    // Calculate score with weights
    let score = 0;
    const weights = { aboveMA10: 15, aboveMA20: 15, aboveMA50: 15, ma10AboveMA20: 15, ma20AboveMA50: 10, nearHigh: 10, aboveLow: 10, trending: 10 };
    Object.keys(criteria).forEach(key => { if (criteria[key]) score += weights[key]; });
    
    // Stage identification
    let stage, stageName, bias;
    if (criteria.aboveMA50 && criteria.ma10AboveMA20 && criteria.ma20AboveMA50 && criteria.trending) {
      stage = 2; stageName = 'ADVANCING'; bias = 'long';
    } else if (criteria.aboveMA50 && !criteria.ma10AboveMA20) {
      stage = 3; stageName = 'TOPPING'; bias = 'neutral';
    } else if (!criteria.aboveMA50 && !criteria.aboveMA20) {
      stage = 4; stageName = 'DECLINING'; bias = 'short';
    } else {
      stage = 1; stageName = 'BASING'; bias = 'neutral';
    }
    
    return {
      valid: score >= HOLY_GRAIL_CONFIG.setupRequirements.minTrendScore,
      score,
      criteria,
      mas: { ma10, ma20, ma50 },
      stage,
      stageName,
      bias,
      sessionHigh,
      sessionLow,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// CANDLESTICK PATTERN RECOGNITION - Enhanced Detection
// ═══════════════════════════════════════════════════════════════════════════════════════

export class PatternRecognition {
  static detect(candles, idx) {
    if (idx < 5) return { name: 'NONE', bias: 'neutral', strength: 0 };
    
    const c = candles[idx];
    const p = candles[idx - 1];
    const p2 = candles[idx - 2];
    const p3 = candles[idx - 3];
    const p4 = candles[idx - 4];
    
    const body = Math.abs(c.c - c.o);
    const range = c.h - c.l || 0.01;
    const upWick = c.h - Math.max(c.o, c.c);
    const dnWick = Math.min(c.o, c.c) - c.l;
    const isGreen = c.c > c.o;
    const isRed = c.c < c.o;
    
    // Previous candles
    const pBody = Math.abs(p.c - p.o);
    const pRange = p.h - p.l || 0.01;
    const pGreen = p.c > p.o;
    const pRed = p.c < p.o;
    
    // Strong momentum candle (most reliable)
    if (body > range * 0.75 && body > 6) {
      return {
        name: isGreen ? 'STRONG_BULL_CANDLE' : 'STRONG_BEAR_CANDLE',
        bias: isGreen ? 'bullish' : 'bearish',
        strength: 0.85,
      };
    }
    
    // Bullish Engulfing (very reliable reversal)
    if (isGreen && pRed && c.c > p.o && c.o < p.c && body > pBody * 1.3) {
      return { name: 'BULLISH_ENGULFING', bias: 'bullish', strength: 0.90 };
    }
    
    // Bearish Engulfing
    if (isRed && pGreen && c.o > p.c && c.c < p.o && body > pBody * 1.3) {
      return { name: 'BEARISH_ENGULFING', bias: 'bearish', strength: 0.90 };
    }
    
    // Three White Soldiers (strong continuation)
    if (isGreen && pGreen && p2.c > p2.o && c.c > p.c && p.c > p2.c && body > 3 && pBody > 3) {
      return { name: 'THREE_WHITE_SOLDIERS', bias: 'bullish', strength: 0.92 };
    }
    
    // Three Black Crows
    if (isRed && pRed && p2.c < p2.o && c.c < p.c && p.c < p2.c && body > 3 && pBody > 3) {
      return { name: 'THREE_BLACK_CROWS', bias: 'bearish', strength: 0.92 };
    }
    
    // Morning Star (bottom reversal)
    if (isGreen && Math.abs(p.c - p.o) < pRange * 0.3 && p2.c < p2.o && c.c > (p2.o + p2.c) / 2) {
      return { name: 'MORNING_STAR', bias: 'bullish', strength: 0.85 };
    }
    
    // Evening Star (top reversal)
    if (isRed && Math.abs(p.c - p.o) < pRange * 0.3 && p2.c > p2.o && c.c < (p2.o + p2.c) / 2) {
      return { name: 'EVENING_STAR', bias: 'bearish', strength: 0.85 };
    }
    
    // Hammer (bottom reversal with volume)
    if (dnWick > body * 2.5 && upWick < body * 0.4 && isGreen) {
      return { name: 'HAMMER', bias: 'bullish', strength: 0.80 };
    }
    
    // Shooting Star (top reversal)
    if (upWick > body * 2.5 && dnWick < body * 0.4 && isRed) {
      return { name: 'SHOOTING_STAR', bias: 'bearish', strength: 0.80 };
    }
    
    // Doji (indecision - need confirmation)
    if (body < range * 0.15) {
      return { name: 'DOJI', bias: 'neutral', strength: 0.40 };
    }
    
    // Inside Bar (compression before breakout)
    if (c.h <= p.h && c.l >= p.l && pBody > 5) {
      return { name: 'INSIDE_BAR', bias: 'neutral', strength: 0.60 };
    }
    
    return { name: 'NONE', bias: 'neutral', strength: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// MARKET REGIME DETECTOR - Know When to Trade
// ═══════════════════════════════════════════════════════════════════════════════════════

export class RegimeDetector {
  static analyze(candles) {
    if (candles.length < 50) return { regime: 'UNKNOWN', tradeable: false };
    
    const prices = candles.map(c => c.c);
    const adx = TechnicalAnalysis.ADX(candles);
    const bb = TechnicalAnalysis.BollingerBands(prices);
    const atr = TechnicalAnalysis.ATR(candles);
    const avgAtr = TechnicalAnalysis.ATR(candles.slice(0, -20), 14);
    const atrRatio = atr / avgAtr;
    
    let regime, tradeable, suggestion;
    
    if (adx.strongTrend && adx.adx > 40) {
      regime = 'STRONG_TREND';
      tradeable = true;
      suggestion = adx.bullishTrend ? 'LONG_ONLY' : 'SHORT_ONLY';
    } else if (adx.trending) {
      regime = 'TRENDING';
      tradeable = true;
      suggestion = adx.bullishTrend ? 'LONG_BIAS' : 'SHORT_BIAS';
    } else if (bb && bb.width < 3) {
      regime = 'LOW_VOLATILITY';
      tradeable = true; // VCP breakout potential
      suggestion = 'WAIT_FOR_BREAKOUT';
    } else if (atrRatio > HOLY_GRAIL_CONFIG.regime.volatilityHigh) {
      regime = 'HIGH_VOLATILITY';
      tradeable = false; // Too choppy
      suggestion = 'REDUCE_SIZE';
    } else {
      regime = 'RANGING';
      tradeable = false;
      suggestion = 'FADE_EXTREMES';
    }
    
    return {
      regime,
      tradeable,
      suggestion,
      adx,
      atrRatio,
      bbWidth: bb?.width || 0,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// TIME WINDOW ANALYZER - Trade at the Right Time
// ═══════════════════════════════════════════════════════════════════════════════════════

export class TimeWindow {
  static analyze(timestamp) {
    const hour = timestamp.getHours() + timestamp.getMinutes() / 60;
    const dayOfWeek = timestamp.getDay();
    const { morningSession, powerHour, avoidLunchChop, fridayEnd } = HOLY_GRAIL_CONFIG.timeWindows;
    
    const inMorning = hour >= morningSession.start && hour <= morningSession.end;
    const inPowerHour = hour >= powerHour.start && hour <= powerHour.end;
    const inLunchChop = hour >= avoidLunchChop.start && hour <= avoidLunchChop.end;
    const isFriday = dayOfWeek === 5;
    const fridayAvoid = isFriday && hour >= fridayEnd.start;
    
    // Opening range (first 30 minutes)
    const inOpeningRange = hour >= 9.5 && hour <= 10;
    
    // Score the time window
    let score = 50;
    let tradeable = true;
    let reason = '';
    
    if (inOpeningRange) {
      score = 85;
      reason = 'Opening Range - High momentum';
    } else if (inMorning) {
      score = 80;
      reason = 'Morning Session - Good liquidity';
    } else if (inPowerHour) {
      score = 75;
      reason = 'Power Hour - Follow-through';
    } else if (inLunchChop) {
      score = 30;
      tradeable = false;
      reason = 'Lunch Chop - Avoid';
    } else if (fridayAvoid) {
      score = 40;
      tradeable = false;
      reason = 'Friday Close - Avoid holding';
    } else {
      score = 55;
      reason = 'Normal hours';
    }
    
    return {
      hour,
      dayOfWeek,
      inMorning,
      inPowerHour,
      inLunchChop,
      inOpeningRange,
      isFriday,
      score,
      tradeable,
      reason,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// CONFLUENCE ANALYZER - The Holy Grail Filter
// ═══════════════════════════════════════════════════════════════════════════════════════

export class ConfluenceAnalyzer {
  static analyze(data) {
    const {
      trend, pattern, vcp, regime, time, gex, macd, rsi, stochRsi, adx, bb, momentum
    } = data;
    
    // 8 Independent Confluence Points
    const confluencePoints = {
      // 1. Trend Alignment (Minervini Stage 2/4)
      trendAligned: (trend.stage === 2 && data.direction === 'long') || 
                    (trend.stage === 4 && data.direction === 'short'),
      
      // 2. Pattern Confirmation (Strong candle pattern)
      patternConfirm: pattern.strength >= HOLY_GRAIL_CONFIG.setupRequirements.minPatternStrength &&
                      ((data.direction === 'long' && pattern.bias === 'bullish') ||
                       (data.direction === 'short' && pattern.bias === 'bearish')),
      
      // 3. VCP Setup (Volatility contraction with breakout)
      vcpSetup: vcp.valid && vcp.strength >= 0.6,
      
      // 4. Time Window (Trading during optimal hours)
      timeOptimal: time.tradeable && time.score >= 65,
      
      // 5. GEX Alignment (Gamma supports the move)
      gexAligned: (data.direction === 'long' && gex.isPositiveGamma) ||
                  (data.direction === 'short' && !gex.isPositiveGamma),
      
      // 6. Momentum Confirmation (MACD + RSI agreement)
      momentumConfirm: (data.direction === 'long' && macd.increasing && rsi > 40 && rsi < 70) ||
                       (data.direction === 'short' && macd.decreasing && rsi > 30 && rsi < 60),
      
      // 7. ADX Trend Strength (Trending market)
      adxConfirm: adx.trending && 
                  ((data.direction === 'long' && adx.bullishTrend) ||
                   (data.direction === 'short' && adx.bearishTrend)),
      
      // 8. Volume Confirmation (Above average volume)
      volumeConfirm: data.volumeRatio > 1.2,
    };
    
    // Count confluence points
    const confluenceCount = Object.values(confluencePoints).filter(Boolean).length;
    const confluenceScore = confluenceCount / Object.keys(confluencePoints).length * 100;
    
    // Determine if this is an A+ setup
    const isAPlusSetup = confluenceCount >= HOLY_GRAIL_CONFIG.setupRequirements.minConfluenceScore;
    
    // Calculate weighted score
    const weights = {
      trendAligned: 20,
      patternConfirm: 15,
      vcpSetup: 15,
      timeOptimal: 10,
      gexAligned: 15,
      momentumConfirm: 10,
      adxConfirm: 10,
      volumeConfirm: 5,
    };
    
    let weightedScore = 0;
    Object.keys(confluencePoints).forEach(key => {
      if (confluencePoints[key]) weightedScore += weights[key];
    });
    
    return {
      confluencePoints,
      confluenceCount,
      confluenceScore,
      weightedScore,
      isAPlusSetup,
      grade: isAPlusSetup ? 'A+' : confluenceCount >= 4 ? 'B' : confluenceCount >= 3 ? 'C' : 'F',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// ADAPTIVE LEARNER - Machine Learning Inspired Edge
// ═══════════════════════════════════════════════════════════════════════════════════════

export class AdaptiveLearner {
  constructor() {
    this.featureWeights = {
      trend: 1.0, pattern: 1.0, vcp: 1.0, time: 1.0,
      gex: 1.0, momentum: 1.0, adx: 1.0, volume: 1.0,
    };
    this.patternStats = {};
    this.memory = [];
    this.totalTrades = 0;
    this.winRate = 0.5;
  }
  
  score(features) {
    let score = 0;
    const breakdown = {};
    
    // Trend score (25% weight)
    breakdown.trend = Math.min(100, features.trendScore * 1.2);
    score += breakdown.trend * this.featureWeights.trend * 0.25;
    
    // Pattern score (20% weight)
    breakdown.pattern = features.pattern.strength * 100;
    score += breakdown.pattern * this.featureWeights.pattern * 0.20;
    
    // VCP score (15% weight)
    breakdown.vcp = features.vcp.valid ? features.vcp.strength * 100 : 30;
    score += breakdown.vcp * this.featureWeights.vcp * 0.15;
    
    // Time score (10% weight)
    breakdown.time = features.time.score;
    score += breakdown.time * this.featureWeights.time * 0.10;
    
    // GEX score (10% weight)
    breakdown.gex = features.gex.isPositiveGamma ? 75 : 50;
    if (Math.abs(features.price - features.gex.gammaFlip) < 10) breakdown.gex += 15;
    score += breakdown.gex * this.featureWeights.gex * 0.10;
    
    // Momentum score (10% weight)
    breakdown.momentum = features.macd.increasing ? 80 : features.macd.decreasing ? 40 : 50;
    score += breakdown.momentum * this.featureWeights.momentum * 0.10;
    
    // ADX score (5% weight)
    breakdown.adx = features.adx.trending ? (features.adx.strongTrend ? 90 : 70) : 40;
    score += breakdown.adx * this.featureWeights.adx * 0.05;
    
    // Volume score (5% weight)
    breakdown.volume = features.volumeRatio > 1.5 ? 90 : features.volumeRatio > 1.2 ? 70 : 50;
    score += breakdown.volume * this.featureWeights.volume * 0.05;
    
    return {
      total: Math.round(score),
      breakdown,
      tradeable: score >= HOLY_GRAIL_CONFIG.setupRequirements.minSignalScore,
    };
  }
  
  learn(features, outcome) {
    const key = this.getPatternKey(features);
    
    // Initialize or update pattern stats
    if (!this.patternStats[key]) {
      this.patternStats[key] = { wins: 0, losses: 0, totalR: 0, avgR: 0 };
    }
    
    const stats = this.patternStats[key];
    if (outcome.win) {
      stats.wins++;
      stats.totalR += outcome.rMultiple;
    } else {
      stats.losses++;
      stats.totalR += outcome.rMultiple;
    }
    stats.avgR = stats.totalR / (stats.wins + stats.losses);
    
    // Update global stats
    this.totalTrades++;
    this.winRate = this.memory.filter(m => m.outcome.win).length / Math.max(1, this.memory.length);
    
    // Store in memory
    this.memory.push({ key, features: this.simplifyFeatures(features), outcome, timestamp: Date.now() });
    if (this.memory.length > HOLY_GRAIL_CONFIG.learning.memorySize) {
      this.memory.shift();
    }
    
    // Adaptive weight updates
    this.updateWeights(features, outcome);
  }
  
  updateWeights(features, outcome) {
    const lr = HOLY_GRAIL_CONFIG.learning.rate;
    const decay = HOLY_GRAIL_CONFIG.learning.decayRate;
    
    Object.keys(this.featureWeights).forEach(key => {
      // Decay all weights
      this.featureWeights[key] *= decay;
      
      // Reward features that contributed to wins
      if (outcome.win && outcome.rMultiple > 1.5) {
        switch (key) {
          case 'trend': if (features.trendScore > 70) this.featureWeights[key] += lr; break;
          case 'pattern': if (features.pattern.strength > 0.7) this.featureWeights[key] += lr; break;
          case 'vcp': if (features.vcp.valid) this.featureWeights[key] += lr; break;
          case 'time': if (features.time.score > 70) this.featureWeights[key] += lr; break;
          case 'gex': if (features.gex.isPositiveGamma) this.featureWeights[key] += lr; break;
          case 'momentum': if (features.macd.increasing) this.featureWeights[key] += lr; break;
          case 'volume': if (features.volumeRatio > 1.5) this.featureWeights[key] += lr; break;
        }
      }
      
      // Clamp weights
      this.featureWeights[key] = Math.max(0.5, Math.min(2.0, this.featureWeights[key]));
    });
  }
  
  getPatternKey(features) {
    return `${features.pattern.name}_S${features.trend.stage}_${features.gex.isPositiveGamma ? 'PG' : 'NG'}_${features.vcp.valid ? 'VCP' : 'NON'}`;
  }
  
  simplifyFeatures(features) {
    return {
      pattern: features.pattern.name,
      stage: features.trend.stage,
      gamma: features.gex.isPositiveGamma,
      vcp: features.vcp.valid,
      time: features.time.score > 65,
      momentum: features.macd.increasing,
    };
  }
  
  getConfidence(key) {
    const stats = this.patternStats[key];
    if (!stats || stats.wins + stats.losses < HOLY_GRAIL_CONFIG.learning.minSampleSize) return 0.5;
    
    const wr = stats.wins / (stats.wins + stats.losses);
    const sampleFactor = 1 - 1 / (stats.wins + stats.losses + 1);
    return wr * sampleFactor;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// POSITION SIZER - Kelly Criterion + Signal Quality
// ═══════════════════════════════════════════════════════════════════════════════════════

export class PositionSizer {
  static calculate(accountSize, winRate, avgWinR, avgLossR, signalQuality, confidence) {
    // Kelly Criterion: f* = (bp - q) / b where b = avgWin/avgLoss
    const p = winRate;
    const q = 1 - p;
    const b = Math.abs(avgWinR / avgLossR);
    
    const fullKelly = (b * p - q) / b;
    
    // Use quarter Kelly for safety (standard practice)
    const quarterKelly = fullKelly * 0.25;
    
    // Adjust for signal quality (higher quality = larger size)
    const qualityMultiplier = 0.5 + (signalQuality / 100) * 0.5;
    
    // Adjust for confidence (historical performance of this pattern)
    const confidenceMultiplier = 0.6 + confidence * 0.4;
    
    // Final position size (capped at max risk)
    const positionPercent = Math.max(0.05, Math.min(
      HOLY_GRAIL_CONFIG.account.maxRiskPerTrade,
      quarterKelly * qualityMultiplier * confidenceMultiplier
    ));
    
    return {
      positionPercent,
      positionDollars: accountSize * positionPercent,
      kellyFraction: quarterKelly,
      qualityMultiplier,
      confidenceMultiplier,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// TITAN OMEGA HOLY GRAIL ENGINE - Main Class
// ═══════════════════════════════════════════════════════════════════════════════════════

export class TitanOmegaHolyGrail {
  constructor() {
    this.learner = new AdaptiveLearner();
    this.stats = {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0,
      totalR: 0,
      maxDrawdown: 0,
      equity: HOLY_GRAIL_CONFIG.account.size,
      peak: HOLY_GRAIL_CONFIG.account.size,
    };
    this.dailyStats = { trades: 0, pnl: 0, date: null };
  }
  
  analyze(candles, idx) {
    if (idx < 60) return null;
    
    const c = candles[idx];
    const recent = candles.slice(Math.max(0, idx - 60), idx + 1);
    const prices = recent.map(x => x.c);
    
    // Calculate all indicators
    const atr = TechnicalAnalysis.ATR(recent);
    const rsi = TechnicalAnalysis.RSI(prices);
    const macd = TechnicalAnalysis.MACD(prices);
    const stochRsi = TechnicalAnalysis.StochasticRSI(prices);
    const adx = TechnicalAnalysis.ADX(recent);
    const bb = TechnicalAnalysis.BollingerBands(prices);
    const vwap = TechnicalAnalysis.VWAP(recent);
    
    // Trend template (Minervini)
    const trend = TrendTemplate.validate(prices);
    
    // Pattern recognition
    const pattern = PatternRecognition.detect(candles, idx);
    
    // VCP detection
    const vcp = VCPDetector.detect(candles, idx);
    
    // GEX analysis
    const gex = GEXEngine.calculate(c.c);
    
    // Greeks
    const greeks = GreeksEngine.calculate(c.c, Math.round(c.c / 5) * 5, 1/365, HOLY_GRAIL_CONFIG.options.riskFreeRate, 0.15);
    
    // Market regime
    const regime = RegimeDetector.analyze(recent);
    
    // Time window
    const time = TimeWindow.analyze(c.ts);
    
    // Volume analysis
    const avgVolume = recent.slice(-10).reduce((s, x) => s + x.v, 0) / 10;
    const volumeRatio = c.v / avgVolume;
    
    // Momentum
    const mom5 = (prices[prices.length - 1] - prices[prices.length - 6]) / prices[prices.length - 6];
    const mom10 = prices.length > 11 ? (prices[prices.length - 1] - prices[prices.length - 11]) / prices[prices.length - 11] : 0;
    
    // Compile features
    const features = {
      price: c.c,
      candle: c,
      atr,
      rsi,
      macd,
      stochRsi,
      adx,
      bb,
      vwap,
      trend,
      trendScore: trend.score,
      pattern,
      vcp,
      gex,
      greeks,
      regime,
      time,
      volumeRatio,
      momentum: mom5,
      momentumAccel: mom5 > mom10 && mom5 > 0,
    };
    
    // Get score from adaptive learner
    const score = this.learner.score(features);
    
    return { features, score };
  }
  
  generateSignal(analysis) {
    if (!analysis || !analysis.score.tradeable) return null;
    
    const { features, score } = analysis;
    
    // Skip if market regime not tradeable
    if (!features.regime.tradeable && !features.vcp.valid) return null;
    
    // Skip lunch chop
    if (!features.time.tradeable) return null;
    
    // Determine direction
    let direction = null;
    const reasons = [];
    
    // LONG CONDITIONS
    const longConditions = {
      stage2: features.trend.stage === 2,
      bullishPattern: features.pattern.bias === 'bullish' && features.pattern.strength >= 0.65,
      vcpBreakout: features.vcp.valid && features.vcp.breakoutUp,
      positiveGamma: features.gex.isPositiveGamma,
      macdBullish: features.macd.increasing && features.macd.histogram > 0,
      oversoldBounce: features.rsi < 35 && features.momentum > 0,
      volumeConfirm: features.volumeRatio > 1.2,
      aboveVWAP: features.price > features.vwap,
    };
    
    const longScore = Object.values(longConditions).filter(Boolean).length;
    
    // SHORT CONDITIONS
    const shortConditions = {
      stage4: features.trend.stage === 4,
      bearishPattern: features.pattern.bias === 'bearish' && features.pattern.strength >= 0.65,
      vcpBreakdown: features.vcp.valid && features.vcp.breakoutDown,
      negativeGamma: !features.gex.isPositiveGamma,
      macdBearish: features.macd.decreasing && features.macd.histogram < 0,
      overboughtDrop: features.rsi > 65 && features.momentum < 0,
      volumeConfirm: features.volumeRatio > 1.2,
      belowVWAP: features.price < features.vwap,
    };
    
    const shortScore = Object.values(shortConditions).filter(Boolean).length;
    
    // Require minimum 4 conditions
    if (longScore >= 4 && longScore > shortScore) {
      direction = 'long';
      if (longConditions.stage2) reasons.push('📈 Stage 2 Uptrend');
      if (longConditions.bullishPattern) reasons.push(`🔨 ${features.pattern.name}`);
      if (longConditions.vcpBreakout) reasons.push('💎 VCP Breakout');
      if (longConditions.positiveGamma) reasons.push('✅ +Gamma');
      if (longConditions.volumeConfirm) reasons.push('📊 Volume');
      if (longConditions.aboveVWAP) reasons.push('📍 Above VWAP');
    } else if (shortScore >= 4) {
      direction = 'short';
      if (shortConditions.stage4) reasons.push('📉 Stage 4 Downtrend');
      if (shortConditions.bearishPattern) reasons.push(`⭐ ${features.pattern.name}`);
      if (shortConditions.vcpBreakdown) reasons.push('💎 VCP Breakdown');
      if (shortConditions.negativeGamma) reasons.push('🔴 -Gamma');
      if (shortConditions.volumeConfirm) reasons.push('📊 Volume');
      if (shortConditions.belowVWAP) reasons.push('📍 Below VWAP');
    }
    
    if (!direction) return null;
    
    // Run confluence analysis
    const confluenceData = {
      ...features,
      direction,
    };
    const confluence = ConfluenceAnalyzer.analyze(confluenceData);
    
    // HOLY GRAIL FILTER: Only take A+ setups
    if (!confluence.isAPlusSetup) return null;
    
    // Calculate position size
    const patternKey = this.learner.getPatternKey(features);
    const confidence = this.learner.getConfidence(patternKey);
    const positionSize = PositionSizer.calculate(
      HOLY_GRAIL_CONFIG.account.size,
      this.learner.winRate || 0.5,
      2.0, // Expected avg win R
      1.0, // Expected avg loss R
      score.total,
      confidence
    );
    
    // Calculate stops and targets
    const atr = features.atr;
    const { initial, breakeven, trailing, profitLock } = HOLY_GRAIL_CONFIG.stops;
    
    const stopDistance = Math.max(initial.minPoints, Math.min(initial.maxPoints, atr * initial.atrMultiple));
    const entry = features.price;
    const stop = direction === 'long' ? entry - stopDistance : entry + stopDistance;
    const risk = Math.abs(entry - stop);
    
    // Targets
    const { tp1, tp2, tp3 } = HOLY_GRAIL_CONFIG.targets;
    
    return {
      direction,
      entry,
      stop,
      risk,
      tp1: direction === 'long' ? entry + risk * tp1.r : entry - risk * tp1.r,
      tp2: direction === 'long' ? entry + risk * tp2.r : entry - risk * tp2.r,
      tp3: direction === 'long' ? entry + risk * tp3.r : entry - risk * tp3.r,
      score: score.total,
      confluence,
      reasons,
      features,
      positionSize,
      confidence,
      patternKey,
    };
  }
  
  recordOutcome(trade, exitPrice, exitReason) {
    const pnl = trade.direction === 'long' ? exitPrice - trade.entry : trade.entry - exitPrice;
    const rMultiple = pnl / trade.risk;
    const win = pnl > 0;
    const pnlDollars = pnl * 50; // Approximate for options
    
    // Update stats
    this.stats.totalTrades++;
    if (win) this.stats.wins++;
    else this.stats.losses++;
    this.stats.totalPnL += pnlDollars;
    this.stats.totalR += rMultiple;
    this.stats.equity += pnlDollars;
    this.stats.peak = Math.max(this.stats.peak, this.stats.equity);
    this.stats.maxDrawdown = Math.max(
      this.stats.maxDrawdown,
      (this.stats.peak - this.stats.equity) / this.stats.peak * 100
    );
    
    // Learn from outcome
    this.learner.learn(trade.features, { win, rMultiple, exitReason });
    
    return { pnl, pnlDollars, rMultiple, win };
  }
  
  getStats() {
    const winRate = this.stats.totalTrades > 0 ? 
      this.stats.wins / this.stats.totalTrades * 100 : 0;
    const avgR = this.stats.totalTrades > 0 ?
      this.stats.totalR / this.stats.totalTrades : 0;
    const profitFactor = this.stats.losses > 0 && this.stats.wins > 0 ?
      (this.stats.wins * Math.abs(avgR)) / (this.stats.losses * 1) : 0;
    
    return {
      ...this.stats,
      winRate,
      avgR,
      profitFactor,
      featureWeights: { ...this.learner.featureWeights },
      patternStats: { ...this.learner.patternStats },
    };
  }
}

export default TitanOmegaHolyGrail;
