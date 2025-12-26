#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA - 15+ POINT MOVE DETECTOR
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Identify 15+ point SPX moves BEFORE they happen
 * 
 * HOW LARGE MOVES HAPPEN:
 * 
 * 1. GEX IMBALANCE - When gamma is heavily skewed, moves accelerate
 * 2. GAMMA FLIP BREACH - Crossing the flip triggers regime change cascade
 * 3. WALL BREAKOUT - Breaking put/call walls triggers forced dealer hedging
 * 4. VANNA SQUEEZE - IV compression/expansion forces large dealer flows
 * 5. CHARM UNWIND - End of day/week creates predictable large flows
 * 
 * SIGNAL TYPES:
 * • GAMMA_SQUEEZE: Price near gamma flip, about to break through
 * • WALL_BREAK: Approaching major put/call wall for breakout
 * • VANNA_CATALYST: IV change setup for large flow
 * • MOMENTUM_CASCADE: Structure + GEX aligned for waterfall/melt-up
 */

const CONFIG = {
  account: { size: 5000, riskPerTrade: 0.15 },
  targets: { 
    minMove: 15,      // Minimum 15 pt target
    tp1Pts: 15,       // First target
    tp2Pts: 25,       // Second target  
    tp3Pts: 40,       // Runner target
  },
  risk: { 
    maxStopPts: 8,    // Tight stop for high R:R
    beThreshold: 8,   // Move to BE after 8 pts
    trailAfter: 15,   // Trail after 15 pts
  },
  time: {
    primeWindows: [[9.5, 10.5], [14.5, 16]], // Best for big moves
    avoidWindows: [[11.5, 14]],              // Lunch = no big moves
  },
};

let seed = 42424242;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// ═══════════════════════════════════════════════════════════════════════════════════════
// BLACK-SCHOLES GREEKS
// ═══════════════════════════════════════════════════════════════════════════════════════

const normalCDF = (x) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1.0 / (1.0 + p * Math.abs(x) / Math.sqrt(2));
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1.0 + sign * y);
};

const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const calcGreeks = (S, K, T, r, sigma, isCall = true) => {
  T = Math.max(T, 0.0001);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return {
    gamma: normalPDF(d1) / (S * sigma * sqrtT),
    vanna: -normalPDF(d1) * d2 / sigma,
    charm: -normalPDF(d1) * (2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT),
  };
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// GEX PROFILE - Enhanced for Move Detection
// ═══════════════════════════════════════════════════════════════════════════════════════

const buildGEXProfile = (spot, iv = 0.15, dayProgress = 0.5) => {
  const T = Math.max(0.5, 1 - dayProgress * 0.8) / 365; // Decreases through day
  const profile = {
    spot,
    strikes: [],
    gexByStrike: {},
    netGEX: 0,
    gammaFlip: spot,
    callWall: null,
    putWall: null,
    majorSupports: [],
    majorResistances: [],
    
    // Move prediction metrics
    gexImbalance: 0,        // How skewed is GEX
    distToGammaFlip: 0,     // How close to flip
    distToCallWall: null,   // Distance to call wall
    distToPutWall: null,    // Distance to put wall
    nearestMajorLevel: null,
    
    // Regime
    regime: 'NEUTRAL',
    moveReadiness: 0,       // 0-100 score for move potential
  };
  
  let minAbsGEX = Infinity, maxCallOI = 0, maxPutOI = 0;
  let totalPosGEX = 0, totalNegGEX = 0;
  
  for (let i = -35; i <= 35; i++) {
    const strike = Math.round(spot / 5) * 5 + i * 5;
    profile.strikes.push(strike);
    
    const dist = Math.abs(strike - spot);
    const distDecay = Math.exp(-dist / 70);
    const isRound = strike % 25 === 0;
    const isMajor = strike % 50 === 0;
    const is100 = strike % 100 === 0;
    
    // OI clustering at round numbers (realistic)
    const baseOI = is100 ? 12000 : isMajor ? 8000 : isRound ? 5000 : 2000;
    const callBias = strike >= spot ? 1.4 : 0.6;
    const putBias = strike <= spot ? 1.4 : 0.6;
    
    const callOI = Math.floor(baseOI * distDecay * callBias * (0.85 + random() * 0.3));
    const putOI = Math.floor(baseOI * distDecay * putBias * (0.85 + random() * 0.3));
    
    // Track walls
    if (callOI > maxCallOI && strike > spot) { maxCallOI = callOI; profile.callWall = strike; }
    if (putOI > maxPutOI && strike < spot) { maxPutOI = putOI; profile.putWall = strike; }
    
    // Calculate Greeks
    const callG = calcGreeks(spot, strike, T, 0.05, iv, true);
    const putG = calcGreeks(spot, strike, T, 0.05, iv, false);
    
    // GEX: Dealers SHORT calls, LONG puts
    const callGEX = -callG.gamma * callOI * 100 * spot / 100;
    const putGEX = putG.gamma * putOI * 100 * spot / 100;
    const netGEX = callGEX + putGEX;
    
    profile.gexByStrike[strike] = netGEX / 1e9;
    profile.netGEX += netGEX;
    
    if (netGEX > 0) totalPosGEX += netGEX;
    else totalNegGEX += Math.abs(netGEX);
    
    // Find gamma flip
    if (Math.abs(netGEX) < minAbsGEX && dist < 80) {
      minAbsGEX = Math.abs(netGEX);
      profile.gammaFlip = strike;
    }
    
    // Classify major levels (for 15+ pt moves)
    const gexB = Math.abs(netGEX / 1e9);
    if (gexB > 0.8) { // Only MAJOR levels
      if (netGEX > 0 && strike < spot) {
        profile.majorSupports.push({ strike, gex: gexB, dist: spot - strike });
      } else if (netGEX < 0 && strike > spot) {
        profile.majorResistances.push({ strike, gex: gexB, dist: strike - spot });
      }
    }
  }
  
  profile.netGEX /= 1e9;
  profile.majorSupports.sort((a, b) => a.dist - b.dist);
  profile.majorResistances.sort((a, b) => a.dist - b.dist);
  
  // Calculate move prediction metrics
  profile.distToGammaFlip = spot - profile.gammaFlip;
  profile.distToCallWall = profile.callWall ? profile.callWall - spot : null;
  profile.distToPutWall = profile.putWall ? spot - profile.putWall : null;
  
  // GEX Imbalance (key for big moves)
  const totalGEX = totalPosGEX + totalNegGEX;
  profile.gexImbalance = totalGEX > 0 ? (totalPosGEX - totalNegGEX) / totalGEX : 0;
  
  // Determine regime
  const aboveFlip = spot > profile.gammaFlip;
  if (profile.netGEX > 0.5) {
    profile.regime = aboveFlip ? 'STRONG_POSITIVE' : 'POSITIVE_BELOW_FLIP';
  } else if (profile.netGEX < -0.5) {
    profile.regime = aboveFlip ? 'NEGATIVE_ABOVE_FLIP' : 'STRONG_NEGATIVE';
  } else {
    profile.regime = 'TRANSITION'; // Near gamma flip = volatile
  }
  
  // Move Readiness Score (0-100)
  let readiness = 0;
  
  // Near gamma flip = high move potential
  if (Math.abs(profile.distToGammaFlip) < 10) readiness += 30;
  else if (Math.abs(profile.distToGammaFlip) < 20) readiness += 15;
  
  // High GEX imbalance = directional pressure
  readiness += Math.abs(profile.gexImbalance) * 25;
  
  // Near major wall = breakout potential
  if (profile.distToCallWall && profile.distToCallWall < 15) readiness += 20;
  if (profile.distToPutWall && profile.distToPutWall < 15) readiness += 20;
  
  // Negative gamma = moves extend
  if (profile.netGEX < -0.3) readiness += 15;
  
  profile.moveReadiness = Math.min(100, readiness);
  
  // Find nearest major level
  const nearestSupport = profile.majorSupports[0];
  const nearestResist = profile.majorResistances[0];
  if (nearestSupport && (!nearestResist || nearestSupport.dist < nearestResist.dist)) {
    profile.nearestMajorLevel = { ...nearestSupport, type: 'SUPPORT' };
  } else if (nearestResist) {
    profile.nearestMajorLevel = { ...nearestResist, type: 'RESISTANCE' };
  }
  
  return profile;
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// PRICE ACTION ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════════════

const ATR = (candles, period = 14) => {
  if (candles.length < period + 1) return 8;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c),
      Math.abs(candles[i].l - candles[i-1].c)
    );
    sum += tr;
  }
  return sum / period;
};

const analyzeStructure = (candles) => {
  if (candles.length < 25) return { trend: 'NEUTRAL', strength: 0 };
  
  const recent = candles.slice(-20);
  const older = candles.slice(-40, -20);
  
  const recentHigh = Math.max(...recent.map(c => c.h));
  const recentLow = Math.min(...recent.map(c => c.l));
  const olderHigh = older.length > 0 ? Math.max(...older.map(c => c.h)) : recentHigh;
  const olderLow = older.length > 0 ? Math.min(...older.map(c => c.l)) : recentLow;
  
  const range = recentHigh - recentLow;
  const current = candles[candles.length - 1].c;
  
  // Detect trend and momentum
  let trend = 'NEUTRAL', strength = 0;
  
  if (recentHigh > olderHigh && recentLow > olderLow) {
    trend = 'UPTREND';
    strength = Math.min(1, (current - recentLow) / range);
  } else if (recentLow < olderLow && recentHigh < olderHigh) {
    trend = 'DOWNTREND';
    strength = Math.min(1, (recentHigh - current) / range);
  } else if (range < ATR(candles) * 1.5) {
    trend = 'CONSOLIDATING'; // Breakout imminent
    strength = 0.5;
  }
  
  return { trend, strength, recentHigh, recentLow };
};

const analyzeMomentum = (candles) => {
  if (candles.length < 6) return { direction: 'NEUTRAL', strength: 0 };
  
  const last5 = candles.slice(-5);
  const bullBars = last5.filter(c => c.c > c.o).length;
  const avgBody = last5.reduce((s, c) => s + Math.abs(c.c - c.o), 0) / 5;
  const avgRange = last5.reduce((s, c) => s + (c.h - c.l), 0) / 5;
  const bodyRatio = avgBody / (avgRange || 1);
  
  let direction = 'NEUTRAL', strength = 0;
  
  if (bullBars >= 4 && bodyRatio > 0.5) {
    direction = 'STRONG_BULL';
    strength = 0.9;
  } else if (bullBars >= 3) {
    direction = 'BULL';
    strength = 0.6;
  } else if (bullBars <= 1 && bodyRatio > 0.5) {
    direction = 'STRONG_BEAR';
    strength = 0.9;
  } else if (bullBars <= 2) {
    direction = 'BEAR';
    strength = 0.6;
  }
  
  return { direction, strength };
};

const analyzeVolume = (candles) => {
  const recent = candles.slice(-10);
  const current = candles[candles.length - 1];
  const avg = recent.slice(0, -1).reduce((s, c) => s + c.v, 0) / (recent.length - 1);
  const ratio = current.v / avg;
  
  return {
    ratio,
    isHigh: ratio > 1.5,
    isVeryHigh: ratio > 2.0,
    isSurge: ratio > 2.5, // Big move indicator
  };
};

const analyzeTime = (ts) => {
  const hour = ts.getHours() + ts.getMinutes() / 60;
  
  // Prime windows for 15+ pt moves
  const isPrime = (hour >= 9.5 && hour < 10.5) || (hour >= 14.5 && hour < 16);
  const isAvoid = hour >= 11.5 && hour < 14;
  
  let window = 'NORMAL', quality = 50;
  if (hour >= 9.5 && hour < 10) { window = 'OPENING_DRIVE'; quality = 100; }
  else if (hour >= 10 && hour < 10.5) { window = 'MOMENTUM_FOLLOW'; quality = 85; }
  else if (hour >= 10.5 && hour < 11.5) { window = 'MID_MORN'; quality = 60; }
  else if (hour >= 11.5 && hour < 14) { window = 'LUNCH_AVOID'; quality = 0; }
  else if (hour >= 14 && hour < 14.5) { window = 'AFTERNOON_SETUP'; quality = 70; }
  else if (hour >= 14.5 && hour < 15.5) { window = 'POWER_HOUR'; quality = 95; }
  else if (hour >= 15.5 && hour < 15.9) { window = 'FINAL_PUSH'; quality = 80; }
  
  return { window, quality, isPrime, isAvoid };
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// MOVE DETECTION SIGNALS
// ═══════════════════════════════════════════════════════════════════════════════════════

const detectMoveSetup = (candles, i, iv = 0.15) => {
  if (i < 50) return null;
  
  const recent = candles.slice(Math.max(0, i - 50), i + 1);
  const c = candles[i];
  const dayProgress = c.bar / 78;
  
  // Build analysis
  const gex = buildGEXProfile(c.c, iv, dayProgress);
  const structure = analyzeStructure(recent);
  const momentum = analyzeMomentum(recent);
  const volume = analyzeVolume(recent);
  const time = analyzeTime(c.ts);
  const atr = ATR(recent);
  
  // Skip if not prime time or low move readiness
  if (time.isAvoid || gex.moveReadiness < 40) return null;
  
  let signal = null;
  const reasons = [];
  let confidence = 0;
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SIGNAL TYPE 1: GAMMA SQUEEZE (Near flip, about to break through)
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (Math.abs(gex.distToGammaFlip) < 12 && gex.regime === 'TRANSITION') {
    const breakingUp = momentum.direction.includes('BULL') && c.c > gex.gammaFlip - 3;
    const breakingDown = momentum.direction.includes('BEAR') && c.c < gex.gammaFlip + 3;
    
    if (breakingUp && volume.isHigh) {
      signal = {
        type: 'GAMMA_SQUEEZE_LONG',
        dir: 'LONG',
        entry: c.c,
        reason: `Breaking above γ-flip ${gex.gammaFlip} → Negative gamma = move extends`,
      };
      reasons.push('⚡ γ-Flip Breakout', '🚀 Squeeze Setup');
      confidence = 75 + (volume.isSurge ? 15 : 0);
    } else if (breakingDown && volume.isHigh) {
      signal = {
        type: 'GAMMA_SQUEEZE_SHORT',
        dir: 'SHORT',
        entry: c.c,
        reason: `Breaking below γ-flip ${gex.gammaFlip} → Negative gamma = waterfall`,
      };
      reasons.push('⚡ γ-Flip Breakdown', '💧 Waterfall Setup');
      confidence = 75 + (volume.isSurge ? 15 : 0);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SIGNAL TYPE 2: WALL BREAKOUT (Near major wall, volume surge)
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (!signal && gex.distToCallWall && gex.distToCallWall < 12) {
    if (momentum.direction.includes('BULL') && volume.isHigh && structure.trend !== 'DOWNTREND') {
      signal = {
        type: 'CALL_WALL_BREAK',
        dir: 'LONG',
        entry: c.c,
        target: gex.callWall + 20,
        reason: `Approaching call wall ${gex.callWall} → Break triggers dealer buying cascade`,
      };
      reasons.push(`🧱 Call Wall ${gex.callWall}`, '📈 Breakout Setup');
      confidence = 70 + (structure.trend === 'UPTREND' ? 10 : 0);
    }
  }
  
  if (!signal && gex.distToPutWall && gex.distToPutWall < 12) {
    if (momentum.direction.includes('BEAR') && volume.isHigh && structure.trend !== 'UPTREND') {
      signal = {
        type: 'PUT_WALL_BREAK',
        dir: 'SHORT',
        entry: c.c,
        target: gex.putWall - 20,
        reason: `Approaching put wall ${gex.putWall} → Break triggers dealer selling cascade`,
      };
      reasons.push(`💎 Put Wall ${gex.putWall}`, '📉 Breakdown Setup');
      confidence = 70 + (structure.trend === 'DOWNTREND' ? 10 : 0);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SIGNAL TYPE 3: MOMENTUM CASCADE (Strong trend + negative gamma)
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (!signal && (gex.regime === 'STRONG_NEGATIVE' || gex.regime === 'NEGATIVE_ABOVE_FLIP')) {
    if (momentum.direction === 'STRONG_BULL' && structure.trend === 'UPTREND' && time.isPrime) {
      signal = {
        type: 'MELT_UP',
        dir: 'LONG',
        entry: c.c,
        reason: `Strong momentum + negative gamma = dealers chase → Melt-up`,
      };
      reasons.push('🔴 -γ Regime', '🔥 Melt-Up', '📈 Strong Trend');
      confidence = 80;
    } else if (momentum.direction === 'STRONG_BEAR' && structure.trend === 'DOWNTREND' && time.isPrime) {
      signal = {
        type: 'WATERFALL',
        dir: 'SHORT',
        entry: c.c,
        reason: `Strong selling + negative gamma = dealers pile on → Waterfall`,
      };
      reasons.push('🔴 -γ Regime', '💧 Waterfall', '📉 Strong Trend');
      confidence = 80;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SIGNAL TYPE 4: CONSOLIDATION BREAKOUT (Tight range + GEX setup)
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (!signal && structure.trend === 'CONSOLIDATING' && gex.moveReadiness > 60) {
    const breakUp = c.c > structure.recentHigh - atr * 0.3;
    const breakDown = c.c < structure.recentLow + atr * 0.3;
    
    if (breakUp && volume.isHigh && momentum.direction.includes('BULL')) {
      signal = {
        type: 'RANGE_BREAKOUT_LONG',
        dir: 'LONG',
        entry: c.c,
        reason: `Breaking consolidation range ${structure.recentHigh.toFixed(0)} with GEX support`,
      };
      reasons.push('📦 Range Break', '⬆️ Upside');
      confidence = 65 + (volume.isSurge ? 10 : 0);
    } else if (breakDown && volume.isHigh && momentum.direction.includes('BEAR')) {
      signal = {
        type: 'RANGE_BREAKOUT_SHORT',
        dir: 'SHORT',
        entry: c.c,
        reason: `Breaking consolidation range ${structure.recentLow.toFixed(0)} with GEX pressure`,
      };
      reasons.push('📦 Range Break', '⬇️ Downside');
      confidence = 65 + (volume.isSurge ? 10 : 0);
    }
  }
  
  if (!signal) return null;
  
  // Add common tags
  if (time.isPrime) reasons.push(`⏰ ${time.window}`);
  if (volume.isSurge) reasons.push('🔊 Volume Surge');
  else if (volume.isVeryHigh) reasons.push('📊 High Volume');
  if (gex.moveReadiness > 70) reasons.push(`🎯 ${gex.moveReadiness}% Ready`);
  
  // Calculate stops and targets for 15+ pt move
  const stopDist = Math.min(CONFIG.risk.maxStopPts, atr * 1.2);
  
  return {
    ...signal,
    stop: signal.dir === 'LONG' ? signal.entry - stopDist : signal.entry + stopDist,
    tp1: signal.dir === 'LONG' ? signal.entry + CONFIG.targets.tp1Pts : signal.entry - CONFIG.targets.tp1Pts,
    tp2: signal.dir === 'LONG' ? signal.entry + CONFIG.targets.tp2Pts : signal.entry - CONFIG.targets.tp2Pts,
    tp3: signal.dir === 'LONG' ? signal.entry + CONFIG.targets.tp3Pts : signal.entry - CONFIG.targets.tp3Pts,
    risk: stopDist,
    rr: (CONFIG.targets.tp1Pts / stopDist).toFixed(1),
    confidence,
    reasons,
    gex: {
      regime: gex.regime,
      flip: gex.gammaFlip,
      netGEX: gex.netGEX.toFixed(2),
      readiness: gex.moveReadiness,
      callWall: gex.callWall,
      putWall: gex.putWall,
    },
    time: time.window,
    bar: c.bar,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// TRADE EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════════════

class Trade {
  constructor(sig) {
    Object.assign(this, sig);
    this.phase = 'INITIAL';
    this.curStop = this.stop;
    this.maxPrice = this.dir === 'LONG' ? this.entry : 99999;
    this.minPrice = this.dir === 'LONG' ? 0 : this.entry;
    this.bars = 0;
    this.status = 'ACTIVE';
    this.hits = { tp1: false, tp2: false, tp3: false };
    this.partials = 0;
    this.log = [`🎯 ${this.type}: ${this.dir} @ ${this.entry.toFixed(2)}`];
    this.log.push(`   ${this.reason}`);
    this.log.push(`   ${this.reasons.join(' ')}`);
  }
  
  update(c) {
    if (this.status !== 'ACTIVE') return this;
    this.bars++;
    
    // Track extremes
    if (this.dir === 'LONG') {
      this.maxPrice = Math.max(this.maxPrice, c.h);
    } else {
      this.minPrice = Math.min(this.minPrice, c.l);
    }
    
    const pnl = this.dir === 'LONG' ? c.c - this.entry : this.entry - c.c;
    const maxPnL = this.dir === 'LONG' ? this.maxPrice - this.entry : this.entry - this.minPrice;
    
    // Check stop
    const stopHit = this.dir === 'LONG' ? c.l <= this.curStop : c.h >= this.curStop;
    if (stopHit) {
      const exitPrice = this.curStop;
      const exitPnL = this.dir === 'LONG' ? exitPrice - this.entry : this.entry - exitPrice;
      return this.close(exitPrice, `${this.phase}_STOP`, exitPnL);
    }
    
    // TP3 (Full target - 40 pts)
    if (!this.hits.tp3) {
      const tp3Hit = this.dir === 'LONG' ? c.h >= this.tp3 : c.l <= this.tp3;
      if (tp3Hit) {
        this.hits.tp3 = true;
        this.log.push(`🏆 TP3 HIT! +${CONFIG.targets.tp3Pts} pts - FULL TARGET`);
        return this.close(this.tp3, 'TP3_FULL_TARGET', CONFIG.targets.tp3Pts);
      }
    }
    
    // TP2 (25 pts)
    if (!this.hits.tp2) {
      const tp2Hit = this.dir === 'LONG' ? c.h >= this.tp2 : c.l <= this.tp2;
      if (tp2Hit) {
        this.hits.tp2 = true;
        this.partials += 0.3;
        this.curStop = this.dir === 'LONG' ? this.entry + 12 : this.entry - 12;
        this.phase = 'RUNNER';
        this.log.push(`🎯 TP2 +25pts - Lock +12, running for TP3`);
      }
    }
    
    // TP1 (15 pts - primary target)
    if (!this.hits.tp1) {
      const tp1Hit = this.dir === 'LONG' ? c.h >= this.tp1 : c.l <= this.tp1;
      if (tp1Hit) {
        this.hits.tp1 = true;
        this.partials += 0.5;
        this.curStop = this.dir === 'LONG' ? this.entry + 5 : this.entry - 5;
        this.phase = 'TRAILING';
        this.log.push(`✅ TP1 +15pts - Lock +5, trailing`);
      }
    }
    
    // BE after 8 pts
    if (maxPnL >= CONFIG.risk.beThreshold && this.phase === 'INITIAL') {
      this.curStop = this.entry + (this.dir === 'LONG' ? 1 : -1);
      this.phase = 'BREAKEVEN';
      this.log.push(`🔒 BE @ +${maxPnL.toFixed(1)}`);
    }
    
    // Trail after 15 pts
    if (this.phase === 'TRAILING' || this.phase === 'RUNNER') {
      const trailDist = this.phase === 'RUNNER' ? 8 : 6;
      const newStop = this.dir === 'LONG' ? c.c - trailDist : c.c + trailDist;
      if ((this.dir === 'LONG' && newStop > this.curStop) || (this.dir === 'SHORT' && newStop < this.curStop)) {
        this.curStop = newStop;
      }
    }
    
    // Time stop (max 50 bars = ~4 hours)
    if (this.bars >= 50) {
      return this.close(c.c, 'TIME_EXIT', pnl);
    }
    
    // EOD
    if (c.bar >= 76) {
      return this.close(c.c, 'EOD', pnl);
    }
    
    this.pnl = pnl;
    this.maxPnL = maxPnL;
    return this;
  }
  
  close(price, reason, pnl) {
    this.status = 'CLOSED';
    this.exit = price;
    this.exitReason = reason;
    this.finalPnL = pnl;
    this.pnl$ = pnl * 50; // SPX multiplier
    this.log.push(`${pnl >= 15 ? '🏆' : pnl > 0 ? '✅' : '❌'} ${reason}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)} pts ($${this.pnl$.toFixed(0)})`);
    return this;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// DATA GENERATION
// ═══════════════════════════════════════════════════════════════════════════════════════

const generateData = (days, startPrice = 5950) => {
  const data = [];
  let price = startPrice, trend = 0, vol = 'normal';
  
  for (let d = days; d >= 0; d--) {
    const date = new Date(); date.setDate(date.getDate() - d);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    // Daily trend persistence
    trend = trend * 0.7 + (random() - 0.48) * 0.003;
    if (random() < 0.1) vol = ['low', 'normal', 'normal', 'high', 'high'][Math.floor(random() * 5)];
    const volMult = { low: 0.5, normal: 1.0, high: 2.0 }[vol];
    const dayOpen = price;
    
    for (let bar = 0; bar < 78; bar++) {
      const hour = 9 + Math.floor((30 + bar * 5) / 60);
      const minute = (30 + bar * 5) % 60;
      
      // Intraday volatility pattern (higher open/close)
      let intVol = 1.0;
      if (bar < 12) intVol = 2.0;      // Opening 
      else if (bar > 65) intVol = 1.8;  // Close
      else if (bar > 28 && bar < 48) intVol = 0.4; // Lunch
      else if (bar > 60) intVol = 1.5;  // Power hour
      
      const baseVol = 0.0006 * volMult * intVol;
      const vwapPull = (dayOpen - price) / dayOpen * 0.015;
      
      // Occasional large moves (what we're trying to catch!)
      let moveBoost = 1;
      if (random() < 0.02 && (bar < 15 || bar > 60)) moveBoost = 3; // 2% chance of big move
      
      const change = (random() - 0.48 + trend + vwapPull) * baseVol * price * moveBoost;
      
      const open = price;
      const move = change * (1 + random() * 0.5);
      const noise = price * baseVol * random() * 0.3;
      
      let high, low, close;
      if (change >= 0) {
        close = price + move;
        high = Math.max(open, close) + noise;
        low = Math.min(open, close) - noise * 0.3;
      } else {
        close = price + move;
        low = Math.min(open, close) - noise;
        high = Math.max(open, close) + noise * 0.3;
      }
      
      const volMod = bar < 12 ? 2.5 : bar > 65 ? 2.0 : bar > 28 && bar < 48 ? 0.3 : 1.0;
      price = close;
      
      data.push({
        ts: new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute),
        o: +open.toFixed(2),
        h: +high.toFixed(2),
        l: +low.toFixed(2),
        c: +close.toFixed(2),
        v: Math.floor((1.5e6 + random() * 2e6) * volMod * (moveBoost > 1 ? 3 : 1)),
        bar,
      });
    }
  }
  return data;
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// RUN BACKTEST
// ═══════════════════════════════════════════════════════════════════════════════════════

const run = (days = 180) => {
  console.clear();
  console.log(`
╔════════════════════════════════════════════════════════════════════════════════════╗
║       🎯 TITAN OMEGA - 15+ POINT MOVE DETECTOR                                     ║
║                Identify Big SPX Moves BEFORE They Happen                           ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  SIGNAL TYPES:                                                                     ║
║    ⚡ GAMMA_SQUEEZE   - Breaking through gamma flip → Move accelerates             ║
║    🧱 WALL_BREAK      - Breaking call/put wall → Dealer cascade                    ║
║    🔥 MELT_UP/FALL    - Strong trend + negative gamma → Waterfall/Melt-up          ║
║    📦 RANGE_BREAKOUT  - Consolidation break + GEX setup                            ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  TARGETS: TP1 = 15pts | TP2 = 25pts | TP3 = 40pts                                  ║
║  💰 Account: $${CONFIG.account.size}  |  📅 ${days} days                                              ║
╚════════════════════════════════════════════════════════════════════════════════════╝
`);
  
  console.log('⏳ Generating market data with realistic big moves...');
  const candles = generateData(days);
  console.log(`✅ ${candles.length.toLocaleString()} candles\n⏳ Scanning for 15+ pt setups...\n`);
  
  const trades = [];
  let current = null, lastBar = -20, dailyTrades = 0, curDay = null;
  
  for (let i = 50; i < candles.length - 10; i++) {
    const c = candles[i];
    const day = c.ts.toDateString();
    if (day !== curDay) { curDay = day; dailyTrades = 0; }
    
    if (current?.status === 'ACTIVE') {
      current.update(c);
      if (current.status === 'CLOSED') {
        trades.push(current);
        lastBar = i;
        current = null;
      }
      continue;
    }
    
    if (i - lastBar < 20 || dailyTrades >= 2) continue;
    
    const sig = detectMoveSetup(candles, i);
    if (sig && sig.confidence >= 65) {
      current = new Trade(sig);
      dailyTrades++;
    }
  }
  
  // Stats
  const bigWins = trades.filter(t => t.finalPnL >= 15);
  const wins = trades.filter(t => t.finalPnL > 0);
  const losses = trades.filter(t => t.finalPnL <= 0);
  const totalPnL = trades.reduce((s, t) => s + t.finalPnL, 0);
  const totalPnL$ = trades.reduce((s, t) => s + (t.pnl$ || 0), 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.finalPnL, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.finalPnL, 0) / losses.length) : 0;
  const avgBigWin = bigWins.length ? bigWins.reduce((s, t) => s + t.finalPnL, 0) / bigWins.length : 0;
  const pf = avgLoss > 0 && losses.length ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;
  const wr = trades.length ? wins.length / trades.length * 100 : 0;
  const bigWinRate = trades.length ? bigWins.length / trades.length * 100 : 0;
  
  let equity = CONFIG.account.size, peak = equity, maxDD = 0;
  trades.forEach(t => {
    equity += t.pnl$ || 0;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
  });
  
  // Analysis by signal type
  const byType = {};
  trades.forEach(t => {
    if (!byType[t.type]) byType[t.type] = { n: 0, pnl: 0, wins: 0, big: 0 };
    byType[t.type].n++;
    byType[t.type].pnl += t.finalPnL;
    if (t.finalPnL > 0) byType[t.type].wins++;
    if (t.finalPnL >= 15) byType[t.type].big++;
  });
  
  // Print results
  console.log(`
┌────────────────────────────────────────────────────────────────────────────────────┐
│                    🎯 15+ POINT MOVE DETECTION RESULTS                             │
├────────────────────────────────────────────────────────────────────────────────────┤
│  Total Signals:            ${String(trades.length).padStart(6)}                                                 │
│  Winning Trades:           ${String(wins.length).padStart(6)}  (${wr.toFixed(1)}% WIN RATE)                         │
│  15+ Point Winners:        ${String(bigWins.length).padStart(6)}  (${bigWinRate.toFixed(1)}% of trades hit target)     │
├────────────────────────────────────────────────────────────────────────────────────┤
│  💰 TOTAL P&L:             ${(totalPnL >= 0 ? '+' : '') + totalPnL.toFixed(1).padStart(8)} SPX points                        │
│  💵 DOLLAR P&L:            ${(totalPnL$ >= 0 ? '+$' : '-$') + Math.abs(totalPnL$).toFixed(0).padStart(8)}                                        │
│  💎 Final Account:         $${equity.toFixed(0).padStart(9)} (${((equity / CONFIG.account.size - 1) * 100).toFixed(0)}% return)                  │
├────────────────────────────────────────────────────────────────────────────────────┤
│  Avg Winning Trade:        +${avgWin.toFixed(1).padStart(7)} pts                                         │
│  Avg 15+ pt Winner:        +${avgBigWin.toFixed(1).padStart(7)} pts                                         │
│  Avg Losing Trade:         -${avgLoss.toFixed(1).padStart(7)} pts                                         │
│  Profit Factor:            ${pf.toFixed(2).padStart(9)}                                                 │
│  Max Drawdown:             ${maxDD.toFixed(1).padStart(8)}%                                                 │
└────────────────────────────────────────────────────────────────────────────────────┘
`);
  
  console.log(`
┌────────────────────────────────────────────────────────────────────────────────────┐
│                         📊 SIGNAL TYPE ANALYSIS                                    │
├────────────────────────────────────────────────────────────────────────────────────┤`);
  
  const typeIcons = {
    'GAMMA_SQUEEZE_LONG': '⚡📈', 'GAMMA_SQUEEZE_SHORT': '⚡📉',
    'CALL_WALL_BREAK': '🧱📈', 'PUT_WALL_BREAK': '💎📉',
    'MELT_UP': '🔥📈', 'WATERFALL': '💧📉',
    'RANGE_BREAKOUT_LONG': '📦📈', 'RANGE_BREAKOUT_SHORT': '📦📉',
  };
  
  Object.entries(byType).sort((a, b) => b[1].pnl - a[1].pnl).forEach(([type, v]) => {
    const icon = typeIcons[type] || '📊';
    const wr = v.n > 0 ? (v.wins / v.n * 100).toFixed(0) : '0';
    const bigRate = v.n > 0 ? (v.big / v.n * 100).toFixed(0) : '0';
    console.log(`│  ${icon} ${type.padEnd(22)} │ ${String(v.n).padStart(3)} │ WR ${wr.padStart(3)}% │ 15pt ${bigRate.padStart(3)}% │ ${(v.pnl >= 0 ? '+' : '') + v.pnl.toFixed(0).padStart(5)}pts │`);
  });
  console.log(`└────────────────────────────────────────────────────────────────────────────────────┘`);
  
  // Sample trades
  console.log(`
┌────────────────────────────────────────────────────────────────────────────────────┐
│                           📜 SAMPLE BIG WINNER                                     │
├────────────────────────────────────────────────────────────────────────────────────┤`);
  const sample = bigWins.find(t => t.hits.tp2) || bigWins[0] || trades[0];
  if (sample) sample.log.forEach(l => console.log(`│  ${l.substring(0, 76).padEnd(76)} │`));
  console.log(`└────────────────────────────────────────────────────────────────────────────────────┘`);
  
  const grade = bigWinRate >= 30 && pf >= 2.5 ? '🏆 S' : bigWinRate >= 25 && pf >= 2.0 ? '🌟 A' : bigWinRate >= 20 && pf >= 1.5 ? '✨ B' : '👍 C';
  
  console.log(`
╔════════════════════════════════════════════════════════════════════════════════════╗
║                        🎯 SYSTEM EVALUATION                                        ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  System Grade:              ${grade}                                                   ║
║  Win Rate:                  ${wr >= 50 ? '✅' : '👍'} ${wr.toFixed(1)}%                                             ║
║  15+ pt Hit Rate:           ${bigWinRate >= 25 ? '✅' : '👍'} ${bigWinRate.toFixed(1)}%                                             ║
║  Profit Factor:             ${pf >= 2.0 ? '✅' : '👍'} ${pf.toFixed(2)}                                             ║
║  Max Drawdown:              ${maxDD < 15 ? '✅' : '👍'} ${maxDD.toFixed(1)}%                                            ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  💡 KEY: Trading 15+ pt moves requires PATIENCE + PRECISION                        ║
║     • Wait for gamma flip breaks, wall breaks, or strong momentum                  ║
║     • Trade only during prime windows (Opening, Power Hour)                        ║
║     • Use tight stops - if wrong, get out fast                                     ║
║     • Let winners run - these setups can go 25-40+ pts                            ║
╚════════════════════════════════════════════════════════════════════════════════════╝
`);
};

run(180);
