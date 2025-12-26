/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA ULTIMATE - MARKET PHYSICS + PRICE ACTION
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * THE TRUTH: Options market makers DRIVE SPX price action through hedging.
 * 
 * REMOVED (Lagging/Noise):
 * ❌ RSI, MACD, Stochastic - These FOLLOW price, don't predict it
 * 
 * KEPT (Market Physics - These CAUSE price movement):
 * ✅ GREEKS - Delta, Gamma, Vega, Theta, Charm, Vanna, Vomma
 * ✅ GEX - Gamma Exposure (dealer hedging pressure)
 * ✅ DEX - Delta Exposure (directional pressure)
 * ✅ VEX - Vega Exposure (volatility sensitivity)
 * ✅ VANNA FLOWS - IV change → Delta change → Forced buying/selling
 * ✅ CHARM DECAY - Time → Delta change → Forced hedging
 * 
 * COMBINED WITH:
 * ✅ PRICE ACTION - What price is actually doing
 * ✅ STRUCTURE - HH/HL or LH/LL
 * ✅ VOLUME - Smart money participation
 * ✅ KEY LEVELS - VWAP, OR, PDH/PDL
 * ✅ TIME WINDOWS - When to trade
 * 
 * WHY THIS WORKS:
 * - Dealers must hedge. They have no choice.
 * - GEX tells us HOW they must hedge.
 * - Vanna/Charm tell us WHEN they must hedge.
 * - Price action confirms the move is happening.
 */

// ═══════════════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════════════

export const CONFIG = {
  account: {
    size: 2000,
    maxRiskPerTrade: 0.12,
    maxDailyLoss: 0.08,
    maxDailyTrades: 3,
  },
  
  targets: {
    tp1: { r: 1.5, size: 0.5 },
    tp2: { r: 3.0, size: 0.5 },
  },
  
  risk: {
    initialStopATR: 1.0,
    maxStopPts: 8,
    minStopPts: 3,
    beR: 1.0,
    trailR: 1.5,
    trailATR: 0.4,
    maxDD: 20,
  },
  
  time: {
    openingDrive: [9.5, 10.25],
    midMorning: [10.25, 11.5],
    lunchAvoid: [11.5, 14],
    afternoon: [14, 15],
    powerHour: [15, 15.75],
  },
  
  options: {
    riskFreeRate: 0.05,
    defaultIV: 0.15,
    daysToExpiry: 1, // 0DTE focus
    strikeInterval: 5,
  },
  
  // GEX thresholds
  gex: {
    highGamma: 0.05,
    gammaFlipBuffer: 10,
    significantLevel: 0.3,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// BLACK-SCHOLES MATHEMATICS - The Foundation
// ═══════════════════════════════════════════════════════════════════════════════════════

const normalCDF = (x) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
};

const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

// ═══════════════════════════════════════════════════════════════════════════════════════
// COMPLETE GREEKS ENGINE
// ═══════════════════════════════════════════════════════════════════════════════════════

export class GreeksEngine {
  /**
   * Calculate ALL Greeks for an option
   * S = Spot, K = Strike, T = Time to expiry (years), r = risk-free rate, σ = IV
   */
  static calculate(S, K, T, r, sigma) {
    T = Math.max(T, 0.0001); // Prevent division by zero
    const sqrtT = Math.sqrt(T);
    
    // d1 and d2
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    
    // First-order Greeks
    const delta = normalCDF(d1);
    const gamma = normalPDF(d1) / (S * sigma * sqrtT);
    const vega = S * normalPDF(d1) * sqrtT / 100; // Per 1% IV move
    const theta = (-S * normalPDF(d1) * sigma / (2 * sqrtT) - r * K * Math.exp(-r * T) * normalCDF(d2)) / 365;
    
    // Second-order Greeks (THE REAL DRIVERS)
    
    // CHARM (Delta Bleed) - How delta changes with time
    // As time passes, OTM options lose delta, ITM options gain delta
    // This FORCES dealers to rehedge
    const charm = -normalPDF(d1) * (2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT);
    
    // VANNA - How delta changes with IV
    // When IV drops, calls lose delta (dealers buy spot), puts gain delta (dealers sell spot)
    // This creates the "vol crush rally" after events
    const vanna = -normalPDF(d1) * d2 / sigma;
    
    // VOMMA (Volga) - How vega changes with IV
    // High vomma = vega increases as IV rises (convexity in vol)
    const vomma = vega * d1 * d2 / sigma;
    
    // SPEED - How gamma changes with spot
    // Tells us if gamma is accelerating or decelerating
    const speed = -gamma / S * (d1 / (sigma * sqrtT) + 1);
    
    // ZOMMA - How gamma changes with IV
    const zomma = gamma * (d1 * d2 - 1) / sigma;
    
    // COLOR - How charm changes with spot (gamma decay)
    const color = -normalPDF(d1) / (2 * S * T * sigma * sqrtT) * 
                  (2 * r * T - d2 * sigma * sqrtT + (2 * d1 * T + 1) / (sigma * sqrtT));
    
    // Option price (for reference)
    const callPrice = S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
    const putPrice = K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
    
    return {
      // First-order
      delta,
      gamma,
      vega,
      theta,
      
      // Second-order (THE DRIVERS)
      charm,
      vanna,
      vomma,
      speed,
      zomma,
      color,
      
      // Helpers
      d1,
      d2,
      callPrice,
      putPrice,
      
      // Put greeks (by put-call parity)
      putDelta: delta - 1,
      putGamma: gamma, // Same as call
      putVanna: vanna, // Same magnitude, drives opposite
    };
  }
  
  /**
   * Calculate Greeks for ATM option
   */
  static getATMGreeks(spot, iv, daysToExpiry = 1) {
    const strike = Math.round(spot / CONFIG.options.strikeInterval) * CONFIG.options.strikeInterval;
    const T = daysToExpiry / 365;
    return this.calculate(spot, strike, T, CONFIG.options.riskFreeRate, iv);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// GEX ENGINE - Gamma Exposure Analysis
// ═══════════════════════════════════════════════════════════════════════════════════════

export class GEXEngine {
  /**
   * Calculate complete options exposure profile
   * 
   * KEY INSIGHT:
   * - Dealers are typically SHORT calls (sold to retail)
   * - Dealers are typically LONG puts (bought from retail hedgers)
   * - Short gamma = Must buy high, sell low (AMPLIFIES moves)
   * - Long gamma = Must buy low, sell high (DAMPENS moves)
   */
  static calculateProfile(spot, iv = CONFIG.options.defaultIV, daysToExpiry = 1) {
    const T = daysToExpiry / 365;
    const strikes = [];
    const profile = {
      strikes: [],
      gexByStrike: {},
      dexByStrike: {},
      vannaByStrike: {},
      charmByStrike: {},
      
      // Aggregates
      netGEX: 0,
      netDEX: 0,
      netVanna: 0,
      netCharm: 0,
      
      // Key levels
      gammaFlip: spot,
      maxGammaStrike: spot,
      putWall: null,
      callWall: null,
      
      // Regime
      regime: 'NEUTRAL',
    };
    
    const interval = CONFIG.options.strikeInterval;
    const numStrikes = 20;
    let maxGEX = 0;
    let maxCallOI = 0, maxPutOI = 0;
    let callWallStrike = null, putWallStrike = null;
    
    // Build options chain
    for (let i = -numStrikes; i <= numStrikes; i++) {
      const strike = Math.round(spot / interval) * interval + i * interval;
      strikes.push(strike);
      
      // Get Greeks for this strike
      const greeks = GreeksEngine.calculate(spot, strike, T, CONFIG.options.riskFreeRate, iv);
      
      // Simulate open interest (higher at round numbers, decays with distance)
      const isRound = strike % 25 === 0;
      const isMajor = strike % 50 === 0;
      const baseOI = isMajor ? 8000 : isRound ? 5000 : 1500;
      const distanceDecay = Math.exp(-Math.abs(strike - spot) / 80);
      
      // Calls have more OI above spot, puts below
      const callBias = strike >= spot ? 1.2 : 0.8;
      const putBias = strike <= spot ? 1.2 : 0.8;
      
      const callOI = Math.floor(baseOI * distanceDecay * callBias);
      const putOI = Math.floor(baseOI * distanceDecay * putBias);
      
      // Track walls
      if (callOI > maxCallOI && strike > spot) { maxCallOI = callOI; callWallStrike = strike; }
      if (putOI > maxPutOI && strike < spot) { maxPutOI = putOI; putWallStrike = strike; }
      
      // GEX Calculation
      // Dealers SHORT calls: -gamma * callOI
      // Dealers LONG puts: +gamma * putOI
      // Net effect on spot hedging
      const callGEX = -greeks.gamma * callOI * 100 * spot / 100;
      const putGEX = greeks.gamma * putOI * 100 * spot / 100;
      const netStrikeGEX = callGEX + putGEX;
      
      // DEX (Delta Exposure) - Directional bias
      const callDEX = -greeks.delta * callOI * 100;
      const putDEX = greeks.putDelta * putOI * 100;
      const netStrikeDEX = callDEX + putDEX;
      
      // Vanna Exposure - IV sensitivity of delta
      const vannaExp = -greeks.vanna * (callOI - putOI) * 100;
      
      // Charm Exposure - Time sensitivity of delta
      const charmExp = -greeks.charm * (callOI + putOI) * 100;
      
      profile.gexByStrike[strike] = netStrikeGEX;
      profile.dexByStrike[strike] = netStrikeDEX;
      profile.vannaByStrike[strike] = vannaExp;
      profile.charmByStrike[strike] = charmExp;
      
      profile.netGEX += netStrikeGEX;
      profile.netDEX += netStrikeDEX;
      profile.netVanna += vannaExp;
      profile.netCharm += charmExp;
      
      if (Math.abs(netStrikeGEX) > maxGEX) {
        maxGEX = Math.abs(netStrikeGEX);
        profile.maxGammaStrike = strike;
      }
    }
    
    profile.strikes = strikes;
    profile.callWall = callWallStrike;
    profile.putWall = putWallStrike;
    
    // Find Gamma Flip (where net GEX = 0)
    let minAbsGEX = Infinity;
    strikes.forEach(strike => {
      const absGEX = Math.abs(profile.gexByStrike[strike] || 0);
      if (absGEX < minAbsGEX) {
        minAbsGEX = absGEX;
        profile.gammaFlip = strike;
      }
    });
    
    // Determine regime
    const isPositiveGamma = spot > profile.gammaFlip;
    if (profile.netGEX > 0 && isPositiveGamma) {
      profile.regime = 'POSITIVE_GAMMA'; // Moves dampened, mean reversion works
    } else if (profile.netGEX < 0 || !isPositiveGamma) {
      profile.regime = 'NEGATIVE_GAMMA'; // Moves amplified, breakouts work
    }
    
    // Support/Resistance from GEX
    profile.supports = strikes
      .filter(s => s < spot && profile.gexByStrike[s] > 0)
      .sort((a, b) => b - a)
      .slice(0, 3);
    
    profile.resistances = strikes
      .filter(s => s > spot && profile.gexByStrike[s] < 0)
      .sort((a, b) => a - b)
      .slice(0, 3);
    
    return profile;
  }
  
  /**
   * Predict dealer hedging flow based on current positioning
   * 
   * CRITICAL INSIGHT:
   * - High Vanna + IV dropping = Dealers must BUY spot (bullish)
   * - High Vanna + IV rising = Dealers must SELL spot (bearish)
   * - Charm as expiry approaches = Delta moves toward 0 (OTM) or 1 (ITM)
   */
  static predictFlow(profile, ivChange, timeDecay) {
    // Vanna flow: When IV changes, delta changes, dealers must hedge
    const vannaFlow = -profile.netVanna * ivChange; // Positive = buying pressure
    
    // Charm flow: As time passes, delta changes
    const charmFlow = -profile.netCharm * timeDecay; // Positive = buying pressure
    
    // Total expected dealer flow
    const totalFlow = vannaFlow + charmFlow;
    
    return {
      vannaFlow,
      charmFlow,
      totalFlow,
      bias: totalFlow > 0 ? 'BULLISH' : totalFlow < 0 ? 'BEARISH' : 'NEUTRAL',
      strength: Math.abs(totalFlow),
    };
  }
  
  /**
   * Get simplified GEX analysis
   */
  static analyze(spot, iv = 0.15) {
    const profile = this.calculateProfile(spot, iv);
    
    return {
      // Key levels
      gammaFlip: profile.gammaFlip,
      callWall: profile.callWall,
      putWall: profile.putWall,
      
      // Regime
      isPositiveGamma: spot > profile.gammaFlip,
      regime: profile.regime,
      
      // Net exposures
      netGEX: profile.netGEX,
      netDEX: profile.netDEX,
      netVanna: profile.netVanna,
      netCharm: profile.netCharm,
      
      // Support/Resistance
      supports: profile.supports,
      resistances: profile.resistances,
      
      // Distance to key levels
      distToGammaFlip: spot - profile.gammaFlip,
      distToCallWall: profile.callWall ? profile.callWall - spot : null,
      distToPutWall: profile.putWall ? spot - profile.putWall : null,
      
      // Trading implications
      implication: profile.regime === 'POSITIVE_GAMMA' 
        ? 'MEAN_REVERSION' // Fade moves, expect chop
        : 'TREND_FOLLOW',  // Follow breakouts, expect extension
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// PRICE ACTION ANALYSIS (Clean, No Lagging Indicators)
// ═══════════════════════════════════════════════════════════════════════════════════════

export class PriceAction {
  static ATR(candles, period = 14) {
    if (candles.length < period + 1) return 6;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      sum += Math.max(
        candles[i].h - candles[i].l,
        Math.abs(candles[i].h - candles[i - 1].c),
        Math.abs(candles[i].l - candles[i - 1].c)
      );
    }
    return sum / period;
  }
  
  static VWAP(candles, dayStart) {
    let cumVol = 0, cumVWAP = 0;
    const dayCandles = candles.filter(c => c.ts >= dayStart);
    dayCandles.forEach(c => {
      const tp = (c.h + c.l + c.c) / 3;
      cumVol += c.v;
      cumVWAP += tp * c.v;
    });
    return cumVol > 0 ? cumVWAP / cumVol : candles[candles.length - 1].c;
  }
  
  static analyzeStructure(candles, atr) {
    if (candles.length < 20) return { trend: 'NEUTRAL' };
    
    const minSwing = atr * 0.4;
    const swings = [];
    
    for (let i = 3; i < candles.length - 3; i++) {
      const c = candles[i];
      const isHigh = c.h > candles[i-1].h && c.h > candles[i-2].h && c.h > candles[i+1].h && c.h > candles[i+2].h;
      const isLow = c.l < candles[i-1].l && c.l < candles[i-2].l && c.l < candles[i+1].l && c.l < candles[i+2].l;
      
      if (isHigh) swings.push({ type: 'H', price: c.h });
      if (isLow) swings.push({ type: 'L', price: c.l });
    }
    
    if (swings.length < 4) return { trend: 'NEUTRAL', swings };
    
    const recent = swings.slice(-4);
    const highs = recent.filter(s => s.type === 'H').map(s => s.price);
    const lows = recent.filter(s => s.type === 'L').map(s => s.price);
    
    let trend = 'NEUTRAL';
    if (highs.length >= 2 && lows.length >= 2) {
      if (highs[highs.length-1] > highs[0] && lows[lows.length-1] > lows[0]) trend = 'UPTREND';
      else if (highs[highs.length-1] < highs[0] && lows[lows.length-1] < lows[0]) trend = 'DOWNTREND';
    }
    
    return { trend, swings, lastHigh: highs[highs.length-1], lastLow: lows[lows.length-1] };
  }
  
  static analyzeCandle(candles) {
    if (candles.length < 4) return null;
    
    const c = candles[candles.length - 1];
    const p1 = candles[candles.length - 2];
    const p2 = candles[candles.length - 3];
    
    const body = c.c - c.o;
    const absBody = Math.abs(body);
    const range = c.h - c.l || 0.01;
    const upperWick = c.h - Math.max(c.o, c.c);
    const lowerWick = Math.min(c.o, c.c) - c.l;
    
    const isBull = body > 0;
    const isBear = body < 0;
    const isStrong = absBody / range > 0.6 && absBody > 3;
    
    // Patterns
    const bullEngulf = isBull && p1.c < p1.o && c.c > p1.o && c.o < p1.c;
    const bearEngulf = isBear && p1.c > p1.o && c.c < p1.o && c.o > p1.c;
    const bullMom = isBull && p1.c > p1.o && p2.c > p2.o;
    const bearMom = isBear && p1.c < p1.o && p2.c < p2.o;
    const hammer = lowerWick > absBody * 2 && isBull;
    const shooter = upperWick > absBody * 2 && isBear;
    
    let bias = 'NEUTRAL', strength = 0, setup = 'NONE';
    
    if (bullEngulf) { bias = 'BULL'; strength = 0.9; setup = 'ENGULF'; }
    else if (bearEngulf) { bias = 'BEAR'; strength = 0.9; setup = 'ENGULF'; }
    else if (bullMom && isStrong) { bias = 'BULL'; strength = 0.8; setup = 'MOMENTUM'; }
    else if (bearMom && isStrong) { bias = 'BEAR'; strength = 0.8; setup = 'MOMENTUM'; }
    else if (hammer) { bias = 'BULL'; strength = 0.7; setup = 'HAMMER'; }
    else if (shooter) { bias = 'BEAR'; strength = 0.7; setup = 'SHOOTER'; }
    
    return { bias, strength, setup, isStrong };
  }
  
  static analyzeVolume(candles) {
    const recent = candles.slice(-15);
    const current = candles[candles.length - 1];
    const avgVol = recent.slice(0, -1).reduce((s, c) => s + c.v, 0) / (recent.length - 1);
    const ratio = current.v / avgVol;
    
    const priceUp = current.c > current.o;
    let signal = 'NEUTRAL';
    if (priceUp && ratio > 1.3) signal = 'BULL_CONFIRM';
    else if (!priceUp && ratio > 1.3) signal = 'BEAR_CONFIRM';
    
    return { ratio, signal, isGood: ratio >= 1.3 };
  }
  
  static analyzeTime(ts) {
    const hour = ts.getHours() + ts.getMinutes() / 60;
    
    let window = 'AVOID', quality = 0;
    if (hour >= CONFIG.time.openingDrive[0] && hour < CONFIG.time.openingDrive[1]) { window = 'OPENING'; quality = 100; }
    else if (hour >= CONFIG.time.midMorning[0] && hour < CONFIG.time.midMorning[1]) { window = 'MID_MORN'; quality = 80; }
    else if (hour >= CONFIG.time.lunchAvoid[0] && hour < CONFIG.time.lunchAvoid[1]) { window = 'LUNCH'; quality = 0; }
    else if (hour >= CONFIG.time.afternoon[0] && hour < CONFIG.time.afternoon[1]) { window = 'AFTERNOON'; quality = 60; }
    else if (hour >= CONFIG.time.powerHour[0] && hour < CONFIG.time.powerHour[1]) { window = 'POWER'; quality = 85; }
    
    return { window, quality, canTrade: quality >= 60 };
  }
  
  static getKeyLevels(candles, dayStart) {
    const dayCandles = candles.filter(c => c.ts >= dayStart);
    const orCandles = dayCandles.slice(0, 3);
    const or = orCandles.length >= 3 ? {
      high: Math.max(...orCandles.map(c => c.h)),
      low: Math.min(...orCandles.map(c => c.l)),
    } : null;
    
    // Previous day
    const prevCandles = candles.filter(c => c.ts < dayStart);
    const lastDay = prevCandles.length > 0 ? new Date(prevCandles[prevCandles.length-1].ts).toDateString() : null;
    const pdCandles = prevCandles.filter(c => new Date(c.ts).toDateString() === lastDay);
    const pd = pdCandles.length > 0 ? {
      high: Math.max(...pdCandles.map(c => c.h)),
      low: Math.min(...pdCandles.map(c => c.l)),
      close: pdCandles[pdCandles.length-1].c,
    } : null;
    
    return { or, pd };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// TITAN OMEGA ULTIMATE - THE COMPLETE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════════════

export class TitanOmegaUltimate {
  constructor() {
    this.stats = { trades: 0, wins: 0, losses: 0, totalPnL: 0, totalR: 0 };
    this.dailyTrades = 0;
    this.dailyPnL = 0;
  }
  
  /**
   * Complete Analysis - Market Physics + Price Action
   */
  analyze(candles, iv = 0.15) {
    if (candles.length < 50) return null;
    
    const current = candles[candles.length - 1];
    const recent = candles.slice(-60);
    const dayStart = new Date(current.ts); dayStart.setHours(9, 30, 0, 0);
    
    // Price Action Analysis
    const atr = PriceAction.ATR(recent);
    const vwap = PriceAction.VWAP(candles, dayStart);
    const structure = PriceAction.analyzeStructure(recent, atr);
    const candle = PriceAction.analyzeCandle(recent);
    const volume = PriceAction.analyzeVolume(recent);
    const time = PriceAction.analyzeTime(current.ts);
    const levels = PriceAction.getKeyLevels(candles, dayStart);
    
    // Market Physics - Options Greeks & GEX
    const gex = GEXEngine.analyze(current.c, iv);
    const atm = GreeksEngine.getATMGreeks(current.c, iv);
    
    // Predict dealer flows
    const ivChange = 0; // Would come from real IV data
    const timeDecay = 1 / 78; // One 5-min bar out of 78 in a day
    const flow = GEXEngine.predictFlow(
      GEXEngine.calculateProfile(current.c, iv),
      ivChange,
      timeDecay
    );
    
    return {
      price: current.c,
      candle: current,
      
      // Price Action
      atr,
      vwap,
      structure,
      priceAction: candle,
      volume,
      time,
      levels,
      
      // Position relative to levels
      aboveVWAP: current.c > vwap,
      aboveOR: levels.or && current.c > levels.or.high,
      belowOR: levels.or && current.c < levels.or.low,
      abovePDH: levels.pd && current.c > levels.pd.high,
      belowPDL: levels.pd && current.c < levels.pd.low,
      
      // Market Physics
      gex,
      greeks: atm,
      flow,
      
      // Combined regime
      regime: this.determineRegime(structure, gex, candle),
    };
  }
  
  determineRegime(structure, gex, candle) {
    // Combine structure + GEX for optimal strategy
    if (structure.trend === 'UPTREND' && gex.regime === 'NEGATIVE_GAMMA') {
      return { mode: 'AGGRESSIVE_LONG', reason: 'Uptrend + Amplifying gamma = Strong rallies' };
    }
    if (structure.trend === 'DOWNTREND' && gex.regime === 'NEGATIVE_GAMMA') {
      return { mode: 'AGGRESSIVE_SHORT', reason: 'Downtrend + Amplifying gamma = Strong selloffs' };
    }
    if (structure.trend === 'UPTREND' && gex.regime === 'POSITIVE_GAMMA') {
      return { mode: 'CAUTIOUS_LONG', reason: 'Uptrend but dampened = Buy dips' };
    }
    if (structure.trend === 'DOWNTREND' && gex.regime === 'POSITIVE_GAMMA') {
      return { mode: 'CAUTIOUS_SHORT', reason: 'Downtrend but dampened = Sell rips' };
    }
    return { mode: 'WAIT', reason: 'No clear edge' };
  }
  
  /**
   * Generate Signal - Only when Physics + Price Action align
   */
  generateSignal(analysis) {
    if (!analysis) return null;
    
    const { price, atr, structure, priceAction, volume, time, gex, flow, regime, aboveVWAP, aboveOR, belowOR, abovePDH, belowPDL, levels } = analysis;
    
    // FILTER 1: Time must be tradeable
    if (!time.canTrade) return null;
    
    // FILTER 2: Need volume
    if (!volume.isGood) return null;
    
    // FILTER 3: Regime must have edge
    if (regime.mode === 'WAIT') return null;
    
    let dir = null;
    const reasons = [];
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // LONG CONDITIONS - Physics + Price Action must align
    // ═══════════════════════════════════════════════════════════════════════════════
    
    const longPhysics = {
      positiveGamma: gex.isPositiveGamma,
      aboveGammaFlip: price > gex.gammaFlip,
      bullishFlow: flow.bias === 'BULLISH',
      nearPutWall: gex.putWall && Math.abs(price - gex.putWall) < atr * 1.5,
      belowCallWall: gex.callWall && price < gex.callWall,
    };
    
    const longPA = {
      uptrend: structure.trend === 'UPTREND',
      bullCandle: priceAction?.bias === 'BULL' && priceAction.strength >= 0.7,
      aboveVWAP,
      orBreakout: aboveOR,
      pdBreakout: abovePDH,
      volumeConfirm: volume.signal === 'BULL_CONFIRM',
    };
    
    const longPhysicsScore = Object.values(longPhysics).filter(Boolean).length;
    const longPAScore = Object.values(longPA).filter(Boolean).length;
    
    // Need both physics AND price action alignment
    if (longPhysicsScore >= 2 && longPAScore >= 3) {
      dir = 'LONG';
      
      // Physics reasons
      if (longPhysics.aboveGammaFlip) reasons.push('📊 >GammaFlip');
      if (longPhysics.bullishFlow) reasons.push('⚡ BullFlow');
      if (longPhysics.nearPutWall) reasons.push('🛡️ PutWall');
      
      // PA reasons
      if (longPA.uptrend) reasons.push('📈 Uptrend');
      if (longPA.bullCandle) reasons.push(`🔨 ${priceAction.setup}`);
      if (longPA.orBreakout) reasons.push('🚀 OR Break');
      if (longPA.pdBreakout) reasons.push('📊 PDH Break');
      if (longPA.aboveVWAP) reasons.push('📍 >VWAP');
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // SHORT CONDITIONS
    // ═══════════════════════════════════════════════════════════════════════════════
    
    if (!dir) {
      const shortPhysics = {
        negativeGamma: !gex.isPositiveGamma,
        belowGammaFlip: price < gex.gammaFlip,
        bearishFlow: flow.bias === 'BEARISH',
        nearCallWall: gex.callWall && Math.abs(price - gex.callWall) < atr * 1.5,
        abovePutWall: gex.putWall && price > gex.putWall,
      };
      
      const shortPA = {
        downtrend: structure.trend === 'DOWNTREND',
        bearCandle: priceAction?.bias === 'BEAR' && priceAction.strength >= 0.7,
        belowVWAP: !aboveVWAP,
        orBreakdown: belowOR,
        pdBreakdown: belowPDL,
        volumeConfirm: volume.signal === 'BEAR_CONFIRM',
      };
      
      const shortPhysicsScore = Object.values(shortPhysics).filter(Boolean).length;
      const shortPAScore = Object.values(shortPA).filter(Boolean).length;
      
      if (shortPhysicsScore >= 2 && shortPAScore >= 3) {
        dir = 'SHORT';
        
        if (shortPhysics.belowGammaFlip) reasons.push('📊 <GammaFlip');
        if (shortPhysics.bearishFlow) reasons.push('⚡ BearFlow');
        if (shortPhysics.nearCallWall) reasons.push('🔴 CallWall');
        
        if (shortPA.downtrend) reasons.push('📉 Downtrend');
        if (shortPA.bearCandle) reasons.push(`⭐ ${priceAction.setup}`);
        if (shortPA.orBreakdown) reasons.push('🔻 OR Break');
        if (shortPA.pdBreakdown) reasons.push('📊 PDL Break');
        if (shortPA.belowVWAP) reasons.push('📍 <VWAP');
      }
    }
    
    if (!dir) return null;
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // STOPS & TARGETS
    // ═══════════════════════════════════════════════════════════════════════════════
    
    const stopDist = Math.max(CONFIG.risk.minStopPts, Math.min(CONFIG.risk.maxStopPts, atr * CONFIG.risk.initialStopATR));
    const entry = price;
    const stop = dir === 'LONG' ? entry - stopDist : entry + stopDist;
    const risk = Math.abs(entry - stop);
    
    return {
      dir,
      entry,
      stop,
      risk,
      tp1: dir === 'LONG' ? entry + risk * CONFIG.targets.tp1.r : entry - risk * CONFIG.targets.tp1.r,
      tp2: dir === 'LONG' ? entry + risk * CONFIG.targets.tp2.r : entry - risk * CONFIG.targets.tp2.r,
      reasons,
      regime: regime.mode,
      gexRegime: gex.regime,
      structure: structure.trend,
      time: time.window,
    };
  }
  
  recordTrade(signal, exitPrice, reason) {
    const pnl = signal.dir === 'LONG' ? exitPrice - signal.entry : signal.entry - exitPrice;
    const r = pnl / signal.risk;
    const win = pnl > 0;
    const pnl$ = pnl * 50;
    
    this.stats.trades++;
    if (win) this.stats.wins++;
    else this.stats.losses++;
    this.stats.totalPnL += pnl$;
    this.stats.totalR += r;
    
    return { pnl, pnl$, r, win, reason };
  }
  
  getStats() {
    const wr = this.stats.trades > 0 ? this.stats.wins / this.stats.trades : 0;
    const avgR = this.stats.trades > 0 ? this.stats.totalR / this.stats.trades : 0;
    return { ...this.stats, winRate: (wr * 100).toFixed(1) + '%', avgR: avgR.toFixed(2) };
  }
}

export default TitanOmegaUltimate;
