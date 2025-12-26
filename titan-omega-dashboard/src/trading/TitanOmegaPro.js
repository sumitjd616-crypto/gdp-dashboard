/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA PRO - INSTITUTIONAL GRADE
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * PHILOSOPHY: Trade what you SEE, not what you THINK.
 * 
 * REMOVED (Noise/Lagging):
 * ❌ RSI - Lagging oscillator, gives false signals
 * ❌ MACD - Double lagged (EMA of EMA), too slow
 * ❌ Stochastic - More noise
 * ❌ Complex pattern names - Simplified to price action
 * 
 * FOCUS ON (What Institutions Use):
 * ✅ PRICE ACTION - The only leading indicator
 * ✅ VOLUME - Where real money moves
 * ✅ VWAP - Institutional benchmark price
 * ✅ KEY LEVELS - OR, PDH/PDL, Round numbers
 * ✅ TIME - Proven edge windows
 * ✅ GEX/OPTIONS FLOW - Dealer positioning
 * ✅ MARKET STRUCTURE - HH/HL or LH/LL
 * ✅ ATR - True volatility measure
 * 
 * CORE RULES:
 * 1. Trade WITH the structure, never against
 * 2. Enter at KEY LEVELS with volume confirmation
 * 3. Time your entries (opening drive, power hour)
 * 4. Let GEX tell you where dealers are trapped
 * 5. Cut losers fast, let winners run
 */

// ═══════════════════════════════════════════════════════════════════════════════════════
// INSTITUTIONAL CONFIG
// ═══════════════════════════════════════════════════════════════════════════════════════

export const PRO_CONFIG = {
  // Account
  account: {
    size: 2000,
    maxRiskPerTrade: 0.10,      // 10% max (conservative institutional)
    maxDailyLoss: 0.08,         // 8% daily stop - walk away
    maxDailyTrades: 3,          // Quality only
  },
  
  // Key Levels
  levels: {
    roundNumberInterval: 25,    // SPX trades around 25-point levels
    vwapBands: [0.5, 1.0, 1.5], // Standard deviation bands
    openingRangeMinutes: 15,    // First 15 min defines OR
  },
  
  // Time Windows (EST)
  time: {
    openingDrive: { start: 9.5, end: 10.25 },   // 9:30-10:15 - Best momentum
    midMorning: { start: 10.25, end: 11.5 },    // 10:15-11:30 - Good follow-through
    lunchDeath: { start: 11.5, end: 14 },       // 11:30-2:00 - AVOID
    afternoon: { start: 14, end: 15 },          // 2:00-3:00 - Position building
    powerHour: { start: 15, end: 15.75 },       // 3:00-3:45 - Last push
    closeAvoid: { start: 15.75, end: 16 },      // 3:45-4:00 - Too risky
  },
  
  // Entry Requirements
  entry: {
    minVolumeRatio: 1.3,        // Need above-average volume
    maxSpreadATR: 0.15,         // Tight spread vs ATR
    minATR: 3,                  // Need enough movement
    maxATR: 15,                 // Not too volatile
  },
  
  // Risk Management
  risk: {
    initialStopATR: 1.0,        // 1 ATR initial stop
    maxStopPoints: 8,           // Hard cap
    minStopPoints: 3,           // Minimum room
    breakEvenTrigger: 1.0,      // Move to BE at 1R
    trailTrigger: 1.5,          // Start trailing at 1.5R
    trailATR: 0.5,              // Trail by 0.5 ATR
  },
  
  // Targets (R-based)
  targets: {
    tp1: { r: 1.5, exit: 0.5 }, // Take half at 1.5R
    tp2: { r: 3.0, exit: 0.5 }, // Take rest at 3R or trail
  },
  
  // Structure Requirements
  structure: {
    minSwings: 3,               // Need 3 swings to confirm structure
    structureATRMultiple: 0.3,  // Swing must be > 0.3 ATR
  },
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// CORE CALCULATIONS - NO LAGGING INDICATORS
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * ATR - The only volatility measure you need
 */
export const calculateATR = (candles, period = 14) => {
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
};

/**
 * VWAP - Institutional benchmark
 * If price > VWAP, institutions are buying
 * If price < VWAP, institutions are selling
 */
export const calculateVWAP = (candles, fromIndex = 0) => {
  let cumVolume = 0;
  let cumVWAP = 0;
  const vwapData = [];
  
  for (let i = fromIndex; i < candles.length; i++) {
    const c = candles[i];
    const typicalPrice = (c.h + c.l + c.c) / 3;
    cumVolume += c.v;
    cumVWAP += typicalPrice * c.v;
    
    const vwap = cumVolume > 0 ? cumVWAP / cumVolume : c.c;
    
    // Calculate standard deviation for bands
    let sumSqDiff = 0;
    for (let j = fromIndex; j <= i; j++) {
      const tp = (candles[j].h + candles[j].l + candles[j].c) / 3;
      sumSqDiff += Math.pow(tp - vwap, 2) * candles[j].v;
    }
    const variance = cumVolume > 0 ? sumSqDiff / cumVolume : 0;
    const stdDev = Math.sqrt(variance);
    
    vwapData.push({
      vwap,
      upper1: vwap + stdDev,
      lower1: vwap - stdDev,
      upper2: vwap + 2 * stdDev,
      lower2: vwap - 2 * stdDev,
    });
  }
  
  return vwapData[vwapData.length - 1] || { vwap: candles[candles.length - 1].c };
};

/**
 * Opening Range - First 15 minutes defines the battlefield
 */
export const calculateOpeningRange = (candles, orMinutes = 15) => {
  // Find day start
  const lastCandle = candles[candles.length - 1];
  const dayStart = new Date(lastCandle.ts);
  dayStart.setHours(9, 30, 0, 0);
  
  // Get OR candles (first N minutes / 5 min bars)
  const orBars = Math.ceil(orMinutes / 5);
  const dayCandles = candles.filter(c => {
    const cTime = new Date(c.ts);
    return cTime >= dayStart;
  });
  
  if (dayCandles.length < orBars) return null;
  
  const orCandles = dayCandles.slice(0, orBars);
  const orHigh = Math.max(...orCandles.map(c => c.h));
  const orLow = Math.min(...orCandles.map(c => c.l));
  const orMid = (orHigh + orLow) / 2;
  const orRange = orHigh - orLow;
  
  return {
    high: orHigh,
    low: orLow,
    mid: orMid,
    range: orRange,
    isAbove: lastCandle.c > orHigh,
    isBelow: lastCandle.c < orLow,
    isInside: lastCandle.c >= orLow && lastCandle.c <= orHigh,
  };
};

/**
 * Previous Day Levels - Key support/resistance
 */
export const calculatePreviousDayLevels = (candles) => {
  const lastCandle = candles[candles.length - 1];
  const today = new Date(lastCandle.ts).toDateString();
  
  // Find previous day candles
  const prevDayCandles = candles.filter(c => {
    const cDay = new Date(c.ts).toDateString();
    return cDay !== today;
  });
  
  if (prevDayCandles.length === 0) return null;
  
  // Get the most recent previous day
  const lastPrevDay = new Date(prevDayCandles[prevDayCandles.length - 1].ts).toDateString();
  const pdCandles = prevDayCandles.filter(c => new Date(c.ts).toDateString() === lastPrevDay);
  
  return {
    high: Math.max(...pdCandles.map(c => c.h)),
    low: Math.min(...pdCandles.map(c => c.l)),
    close: pdCandles[pdCandles.length - 1].c,
    open: pdCandles[0].o,
  };
};

/**
 * Market Structure - The ONLY thing that matters
 * Uptrend: Higher Highs + Higher Lows
 * Downtrend: Lower Highs + Lower Lows
 */
export const analyzeStructure = (candles, atr) => {
  if (candles.length < 30) return { trend: 'NEUTRAL', swings: [] };
  
  const minSwingSize = atr * PRO_CONFIG.structure.structureATRMultiple;
  const swings = [];
  let lastSwingType = null;
  let lastSwingPrice = candles[0].c;
  let lastSwingIndex = 0;
  
  // Find swing points
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    const prev1 = candles[i - 1];
    const prev2 = candles[i - 2];
    const next1 = candles[i + 1];
    const next2 = candles[i + 2];
    
    // Swing High: Higher than 2 bars before and after
    if (c.h > prev1.h && c.h > prev2.h && c.h > next1.h && c.h > next2.h) {
      if (Math.abs(c.h - lastSwingPrice) >= minSwingSize) {
        swings.push({ type: 'HIGH', price: c.h, index: i });
        lastSwingType = 'HIGH';
        lastSwingPrice = c.h;
        lastSwingIndex = i;
      }
    }
    
    // Swing Low: Lower than 2 bars before and after
    if (c.l < prev1.l && c.l < prev2.l && c.l < next1.l && c.l < next2.l) {
      if (Math.abs(c.l - lastSwingPrice) >= minSwingSize) {
        swings.push({ type: 'LOW', price: c.l, index: i });
        lastSwingType = 'LOW';
        lastSwingPrice = c.l;
        lastSwingIndex = i;
      }
    }
  }
  
  if (swings.length < PRO_CONFIG.structure.minSwings) {
    return { trend: 'NEUTRAL', swings, strength: 0 };
  }
  
  // Analyze last 4 swings for structure
  const recentSwings = swings.slice(-4);
  const highs = recentSwings.filter(s => s.type === 'HIGH').map(s => s.price);
  const lows = recentSwings.filter(s => s.type === 'LOW').map(s => s.price);
  
  let trend = 'NEUTRAL';
  let strength = 0;
  
  // Check for Higher Highs and Higher Lows (Uptrend)
  if (highs.length >= 2 && lows.length >= 2) {
    const hhCount = highs.slice(1).filter((h, i) => h > highs[i]).length;
    const hlCount = lows.slice(1).filter((l, i) => l > lows[i]).length;
    const lhCount = highs.slice(1).filter((h, i) => h < highs[i]).length;
    const llCount = lows.slice(1).filter((l, i) => l < lows[i]).length;
    
    if (hhCount >= 1 && hlCount >= 1) {
      trend = 'UPTREND';
      strength = (hhCount + hlCount) / (highs.length + lows.length - 2);
    } else if (lhCount >= 1 && llCount >= 1) {
      trend = 'DOWNTREND';
      strength = (lhCount + llCount) / (highs.length + lows.length - 2);
    }
  }
  
  // Get key levels from swings
  const lastHigh = highs[highs.length - 1] || null;
  const lastLow = lows[lows.length - 1] || null;
  const prevHigh = highs[highs.length - 2] || null;
  const prevLow = lows[lows.length - 2] || null;
  
  return {
    trend,
    strength,
    swings,
    lastHigh,
    lastLow,
    prevHigh,
    prevLow,
    isBreakoutUp: candles[candles.length - 1].c > lastHigh,
    isBreakoutDown: candles[candles.length - 1].c < lastLow,
  };
};

/**
 * GEX Analysis - Where are dealers positioned?
 */
export const calculateGEX = (spot) => {
  const interval = PRO_CONFIG.levels.roundNumberInterval;
  const roundLevel = Math.round(spot / interval) * interval;
  
  // Key GEX levels (simplified - real would come from options chain)
  const levels = [];
  for (let i = -4; i <= 4; i++) {
    const strike = roundLevel + i * interval;
    const distance = Math.abs(spot - strike);
    const gex = Math.exp(-distance / 100) * (i % 2 === 0 ? 1 : 0.5);
    levels.push({ strike, gex, isSupport: gex > 0.5, isResistance: gex < -0.5 });
  }
  
  // Gamma flip is typically at a round number near spot
  const gammaFlip = roundLevel;
  const isPositiveGamma = spot > gammaFlip;
  
  // In positive gamma: moves are dampened (good for mean reversion)
  // In negative gamma: moves are amplified (good for breakouts)
  
  return {
    gammaFlip,
    isPositiveGamma,
    regime: isPositiveGamma ? 'DAMPENING' : 'AMPLIFYING',
    keyLevels: levels.filter(l => l.isSupport || l.isResistance),
    nearestSupport: levels.filter(l => l.strike < spot).sort((a, b) => b.strike - a.strike)[0]?.strike,
    nearestResistance: levels.filter(l => l.strike > spot).sort((a, b) => a.strike - b.strike)[0]?.strike,
  };
};

/**
 * Volume Analysis - Is smart money participating?
 */
export const analyzeVolume = (candles) => {
  const recent = candles.slice(-20);
  const current = candles[candles.length - 1];
  
  // Average volume
  const avgVolume = recent.slice(0, -1).reduce((s, c) => s + c.v, 0) / (recent.length - 1);
  const volumeRatio = current.v / avgVolume;
  
  // Volume trend
  const recentAvg = recent.slice(-5).reduce((s, c) => s + c.v, 0) / 5;
  const priorAvg = recent.slice(-10, -5).reduce((s, c) => s + c.v, 0) / 5;
  const volumeTrend = recentAvg > priorAvg ? 'INCREASING' : 'DECREASING';
  
  // Price-volume relationship
  const priceUp = current.c > current.o;
  const volumeUp = volumeRatio > 1;
  
  let signal = 'NEUTRAL';
  if (priceUp && volumeUp) signal = 'BULLISH_CONFIRMATION';
  else if (!priceUp && volumeUp) signal = 'BEARISH_CONFIRMATION';
  else if (priceUp && !volumeUp) signal = 'WEAK_RALLY';
  else if (!priceUp && !volumeUp) signal = 'WEAK_DECLINE';
  
  return {
    current: current.v,
    average: avgVolume,
    ratio: volumeRatio,
    trend: volumeTrend,
    signal,
    isAboveAverage: volumeRatio >= PRO_CONFIG.entry.minVolumeRatio,
    isSpike: volumeRatio >= 2.0,
  };
};

/**
 * Time Window Analysis - When to trade
 */
export const analyzeTimeWindow = (timestamp) => {
  const hour = timestamp.getHours() + timestamp.getMinutes() / 60;
  const dayOfWeek = timestamp.getDay();
  const { openingDrive, midMorning, lunchDeath, afternoon, powerHour, closeAvoid } = PRO_CONFIG.time;
  
  let window = 'AVOID';
  let quality = 0;
  let reason = '';
  
  if (hour >= openingDrive.start && hour < openingDrive.end) {
    window = 'OPENING_DRIVE';
    quality = 100;
    reason = 'Best momentum, institutions establishing positions';
  } else if (hour >= midMorning.start && hour < midMorning.end) {
    window = 'MID_MORNING';
    quality = 80;
    reason = 'Good follow-through from opening';
  } else if (hour >= lunchDeath.start && hour < lunchDeath.end) {
    window = 'LUNCH_DEATH';
    quality = 0;
    reason = 'Low volume, choppy, AVOID';
  } else if (hour >= afternoon.start && hour < afternoon.end) {
    window = 'AFTERNOON';
    quality = 60;
    reason = 'Position building before close';
  } else if (hour >= powerHour.start && hour < powerHour.end) {
    window = 'POWER_HOUR';
    quality = 85;
    reason = 'Final institutional push';
  } else if (hour >= closeAvoid.start && hour <= 16) {
    window = 'CLOSE_AVOID';
    quality = 0;
    reason = 'Too risky, wide spreads';
  }
  
  // Friday afternoon penalty
  if (dayOfWeek === 5 && hour >= 14) {
    quality *= 0.5;
    reason += ' (Friday risk)';
  }
  
  return {
    hour,
    window,
    quality,
    reason,
    canTrade: quality >= 60,
  };
};

/**
 * Price Action - What is price DOING right now?
 */
export const analyzePriceAction = (candles) => {
  if (candles.length < 5) return null;
  
  const c = candles[candles.length - 1];      // Current
  const p1 = candles[candles.length - 2];     // Previous
  const p2 = candles[candles.length - 3];     // 2 bars ago
  
  const body = c.c - c.o;
  const absBody = Math.abs(body);
  const range = c.h - c.l || 0.01;
  const upperWick = c.h - Math.max(c.o, c.c);
  const lowerWick = Math.min(c.o, c.c) - c.l;
  
  const isBullish = body > 0;
  const isBearish = body < 0;
  
  // Candle strength
  const bodyRatio = absBody / range;
  const isStrongCandle = bodyRatio > 0.6 && absBody > 3;
  const isWeakCandle = bodyRatio < 0.3;
  
  // Rejection
  const hasUpperRejection = upperWick > absBody * 1.5;
  const hasLowerRejection = lowerWick > absBody * 1.5;
  
  // Momentum (consecutive candles)
  const bullMomentum = c.c > c.o && p1.c > p1.o && p2.c > p2.o;
  const bearMomentum = c.c < c.o && p1.c < p1.o && p2.c < p2.o;
  
  // Engulfing
  const bullEngulf = isBullish && p1.c < p1.o && c.c > p1.o && c.o < p1.c;
  const bearEngulf = isBearish && p1.c > p1.o && c.c < p1.o && c.o > p1.c;
  
  // Inside bar (compression before expansion)
  const isInsideBar = c.h < p1.h && c.l > p1.l;
  
  // Outside bar (expansion/volatility)
  const isOutsideBar = c.h > p1.h && c.l < p1.l;
  
  let bias = 'NEUTRAL';
  let strength = 0;
  let setup = null;
  
  if (bullEngulf) {
    bias = 'BULLISH';
    strength = 0.9;
    setup = 'BULLISH_ENGULF';
  } else if (bearEngulf) {
    bias = 'BEARISH';
    strength = 0.9;
    setup = 'BEARISH_ENGULF';
  } else if (bullMomentum && isStrongCandle) {
    bias = 'BULLISH';
    strength = 0.8;
    setup = 'BULL_MOMENTUM';
  } else if (bearMomentum && isStrongCandle) {
    bias = 'BEARISH';
    strength = 0.8;
    setup = 'BEAR_MOMENTUM';
  } else if (hasLowerRejection && isBullish) {
    bias = 'BULLISH';
    strength = 0.7;
    setup = 'HAMMER';
  } else if (hasUpperRejection && isBearish) {
    bias = 'BEARISH';
    strength = 0.7;
    setup = 'SHOOTER';
  } else if (isInsideBar) {
    bias = 'NEUTRAL';
    strength = 0.5;
    setup = 'INSIDE_BAR';
  }
  
  return {
    bias,
    strength,
    setup,
    isStrongCandle,
    isWeakCandle,
    hasUpperRejection,
    hasLowerRejection,
    bullMomentum,
    bearMomentum,
    isInsideBar,
    isOutsideBar,
    bodyRatio,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// SIGNAL GENERATION - CLEAN, INSTITUTIONAL LOGIC
// ═══════════════════════════════════════════════════════════════════════════════════════

export class TitanOmegaPro {
  constructor() {
    this.stats = { trades: 0, wins: 0, losses: 0, totalPnL: 0, totalR: 0 };
    this.dailyTrades = 0;
    this.dailyPnL = 0;
  }
  
  /**
   * Full Analysis - Everything we need to make a decision
   */
  analyze(candles) {
    if (candles.length < 50) return null;
    
    const current = candles[candles.length - 1];
    const atr = calculateATR(candles);
    
    // Core analysis
    const vwap = calculateVWAP(candles);
    const or = calculateOpeningRange(candles);
    const pd = calculatePreviousDayLevels(candles);
    const structure = analyzeStructure(candles, atr);
    const gex = calculateGEX(current.c);
    const volume = analyzeVolume(candles);
    const time = analyzeTimeWindow(current.ts);
    const priceAction = analyzePriceAction(candles);
    
    // Key levels
    const keyLevels = {
      vwap: vwap.vwap,
      vwapUpper: vwap.upper1,
      vwapLower: vwap.lower1,
      orHigh: or?.high,
      orLow: or?.low,
      pdHigh: pd?.high,
      pdLow: pd?.low,
      pdClose: pd?.close,
      structureHigh: structure.lastHigh,
      structureLow: structure.lastLow,
      gammaFlip: gex.gammaFlip,
      nearestSupport: gex.nearestSupport,
      nearestResistance: gex.nearestResistance,
    };
    
    // Position relative to key levels
    const position = {
      aboveVWAP: current.c > vwap.vwap,
      aboveOR: or?.isAbove,
      belowOR: or?.isBelow,
      abovePDHigh: pd ? current.c > pd.high : null,
      belowPDLow: pd ? current.c < pd.low : null,
      aboveStructureHigh: structure.isBreakoutUp,
      belowStructureLow: structure.isBreakoutDown,
      nearSupport: gex.nearestSupport && Math.abs(current.c - gex.nearestSupport) < atr,
      nearResistance: gex.nearestResistance && Math.abs(current.c - gex.nearestResistance) < atr,
    };
    
    return {
      price: current.c,
      atr,
      vwap,
      or,
      pd,
      structure,
      gex,
      volume,
      time,
      priceAction,
      keyLevels,
      position,
    };
  }
  
  /**
   * Generate Signal - Only when we have EDGE
   */
  generateSignal(analysis) {
    if (!analysis) return null;
    
    const { price, atr, structure, gex, volume, time, priceAction, position, or, pd, vwap } = analysis;
    
    // FILTER 1: Time window must be tradeable
    if (!time.canTrade) return null;
    
    // FILTER 2: Need volume confirmation
    if (!volume.isAboveAverage) return null;
    
    // FILTER 3: ATR in acceptable range
    if (atr < PRO_CONFIG.entry.minATR || atr > PRO_CONFIG.entry.maxATR) return null;
    
    // FILTER 4: Daily limits
    if (this.dailyTrades >= PRO_CONFIG.account.maxDailyTrades) return null;
    if (this.dailyPnL <= -PRO_CONFIG.account.size * PRO_CONFIG.account.maxDailyLoss) return null;
    
    let direction = null;
    let entry = price;
    let confidence = 0;
    const reasons = [];
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // LONG SETUPS
    // ═══════════════════════════════════════════════════════════════════════════════
    
    const longConditions = {
      // Structure: Must be in uptrend or at support
      structureUp: structure.trend === 'UPTREND',
      atSupport: position.nearSupport,
      
      // Price action: Bullish signal
      bullishPA: priceAction?.bias === 'BULLISH' && priceAction.strength >= 0.7,
      
      // Key level breakout
      orBreakout: or?.isAbove && volume.isSpike,
      pdBreakout: position.abovePDHigh && volume.isAboveAverage,
      
      // VWAP confirmation
      aboveVWAP: position.aboveVWAP,
      
      // GEX support
      gammaSupport: gex.isPositiveGamma || position.nearSupport,
      
      // Volume
      volumeConfirm: volume.signal === 'BULLISH_CONFIRMATION',
    };
    
    // Count confirmations
    const longScore = Object.values(longConditions).filter(Boolean).length;
    
    // Need minimum 4 confirmations for LONG
    if (longScore >= 4) {
      // Prefer breakout setups
      if (longConditions.orBreakout || longConditions.pdBreakout) {
        direction = 'LONG';
        confidence = Math.min(1, longScore / 6);
        if (longConditions.structureUp) reasons.push('📈 Uptrend');
        if (longConditions.orBreakout) reasons.push('🚀 OR Breakout');
        if (longConditions.pdBreakout) reasons.push('📊 PD High Break');
        if (longConditions.bullishPA) reasons.push(`🔨 ${priceAction.setup}`);
        if (longConditions.aboveVWAP) reasons.push('📍 >VWAP');
        if (longConditions.volumeConfirm) reasons.push('📦 Volume');
      }
      // Or support bounce
      else if (longConditions.atSupport && longConditions.bullishPA) {
        direction = 'LONG';
        confidence = Math.min(1, longScore / 6);
        reasons.push('💎 Support Bounce');
        if (longConditions.bullishPA) reasons.push(`🔨 ${priceAction.setup}`);
        if (longConditions.aboveVWAP) reasons.push('📍 >VWAP');
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // SHORT SETUPS
    // ═══════════════════════════════════════════════════════════════════════════════
    
    if (!direction) {
      const shortConditions = {
        // Structure: Must be in downtrend or at resistance
        structureDown: structure.trend === 'DOWNTREND',
        atResistance: position.nearResistance,
        
        // Price action: Bearish signal
        bearishPA: priceAction?.bias === 'BEARISH' && priceAction.strength >= 0.7,
        
        // Key level breakdown
        orBreakdown: or?.isBelow && volume.isSpike,
        pdBreakdown: position.belowPDLow && volume.isAboveAverage,
        
        // VWAP confirmation
        belowVWAP: !position.aboveVWAP,
        
        // GEX resistance
        gammaResist: !gex.isPositiveGamma || position.nearResistance,
        
        // Volume
        volumeConfirm: volume.signal === 'BEARISH_CONFIRMATION',
      };
      
      const shortScore = Object.values(shortConditions).filter(Boolean).length;
      
      // Need minimum 4 confirmations for SHORT
      if (shortScore >= 4) {
        if (shortConditions.orBreakdown || shortConditions.pdBreakdown) {
          direction = 'SHORT';
          confidence = Math.min(1, shortScore / 6);
          if (shortConditions.structureDown) reasons.push('📉 Downtrend');
          if (shortConditions.orBreakdown) reasons.push('🔻 OR Breakdown');
          if (shortConditions.pdBreakdown) reasons.push('📊 PD Low Break');
          if (shortConditions.bearishPA) reasons.push(`⭐ ${priceAction.setup}`);
          if (shortConditions.belowVWAP) reasons.push('📍 <VWAP');
          if (shortConditions.volumeConfirm) reasons.push('📦 Volume');
        }
        else if (shortConditions.atResistance && shortConditions.bearishPA) {
          direction = 'SHORT';
          confidence = Math.min(1, shortScore / 6);
          reasons.push('🔴 Resistance Reject');
          if (shortConditions.bearishPA) reasons.push(`⭐ ${priceAction.setup}`);
          if (shortConditions.belowVWAP) reasons.push('📍 <VWAP');
        }
      }
    }
    
    if (!direction) return null;
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // POSITION SIZING & TARGETS
    // ═══════════════════════════════════════════════════════════════════════════════
    
    // Stop based on ATR
    const stopDistance = Math.max(
      PRO_CONFIG.risk.minStopPoints,
      Math.min(PRO_CONFIG.risk.maxStopPoints, atr * PRO_CONFIG.risk.initialStopATR)
    );
    
    const stop = direction === 'LONG' ? entry - stopDistance : entry + stopDistance;
    const risk = Math.abs(entry - stop);
    
    // Targets
    const tp1 = direction === 'LONG' ? entry + risk * PRO_CONFIG.targets.tp1.r : entry - risk * PRO_CONFIG.targets.tp1.r;
    const tp2 = direction === 'LONG' ? entry + risk * PRO_CONFIG.targets.tp2.r : entry - risk * PRO_CONFIG.targets.tp2.r;
    
    // Risk amount (conservative)
    const riskPercent = PRO_CONFIG.account.maxRiskPerTrade * confidence;
    
    return {
      direction,
      entry,
      stop,
      risk,
      tp1,
      tp2,
      confidence,
      reasons,
      timeWindow: time.window,
      structure: structure.trend,
      volumeSignal: volume.signal,
    };
  }
  
  /**
   * Record trade outcome
   */
  recordTrade(signal, exitPrice, exitReason) {
    const pnl = signal.direction === 'LONG' ? exitPrice - signal.entry : signal.entry - exitPrice;
    const rMultiple = pnl / signal.risk;
    const win = pnl > 0;
    const pnl$ = pnl * 50;
    
    this.stats.trades++;
    if (win) this.stats.wins++;
    else this.stats.losses++;
    this.stats.totalPnL += pnl$;
    this.stats.totalR += rMultiple;
    
    this.dailyTrades++;
    this.dailyPnL += pnl$;
    
    return { pnl, pnl$, rMultiple, win, exitReason };
  }
  
  /**
   * Reset daily stats
   */
  resetDaily() {
    this.dailyTrades = 0;
    this.dailyPnL = 0;
  }
  
  /**
   * Get performance stats
   */
  getStats() {
    const winRate = this.stats.trades > 0 ? this.stats.wins / this.stats.trades : 0;
    const avgR = this.stats.trades > 0 ? this.stats.totalR / this.stats.trades : 0;
    
    return {
      ...this.stats,
      winRate: (winRate * 100).toFixed(1) + '%',
      avgR: avgR.toFixed(2),
    };
  }
}

export default TitanOmegaPro;
