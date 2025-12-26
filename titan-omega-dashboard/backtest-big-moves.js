#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA - BIG MOVE DETECTOR (15+ Points)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * GOAL: Identify 15+ point SPX moves BEFORE they happen
 * 
 * HOW BIG MOVES HAPPEN IN SPX:
 * 
 * 1. GEX IMBALANCE creates directional pressure
 *    • Heavy put OI below = dealers must buy on drops = support
 *    • Heavy call OI above = dealers must sell on rallies = resistance
 *    • When price breaks these levels, dealers CHASE = CASCADE
 * 
 * 2. GAMMA FLIP is the regime change point
 *    • Above flip: Dealers dampen moves (mean reversion)
 *    • Below flip: Dealers amplify moves (trends extend)
 *    • CROSSING the flip = ACCELERATION
 * 
 * 3. TIME matters - big moves happen at specific times
 *    • 9:30-10:30: Opening imbalances clear (biggest moves)
 *    • 14:30-16:00: Institutional rebalancing (second biggest)
 *    • Avoid 11:30-14:00 (lunch = no follow-through)
 * 
 * STRATEGY: Wait for GEX setup + momentum ignition + prime time
 */

const CONFIG = {
  // SPX Trading (not micro)
  spx: {
    pointValue: 50,           // SPX mini options = $50/pt
    targetPoints: 15,         // Minimum target
    maxStop: 6,               // Tight stop for good R:R (6 pts = $300)
  },
  
  // Realistic costs for SPX options
  costs: {
    slippage: 0.50,           // $0.50 SPX options slippage
    commission: 1.30,         // Round trip commission
    total: 1.80,              // Total per trade
  },
  
  // Risk management
  risk: {
    maxDailyLoss: 500,        // $500 max daily loss
    maxTrades: 4,             // Max 4 setups per day
  },
  
  // Targets for 15+ pt moves
  targets: {
    tp1: 10,                  // First scale +10 pts ($500)
    tp2: 18,                  // Second scale +18 pts ($900)
    tp3: 30,                  // Runner target +30 pts ($1500)
  },
};

let seed = 31415926;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// ═══════════════════════════════════════════════════════════════════════════════════════
// GEX PROFILE - Identify key levels for big moves
// ═══════════════════════════════════════════════════════════════════════════════════════

const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const buildGEX = (spot) => {
  const T = 1 / 365, iv = 0.15;
  const profile = {
    spot,
    gammaFlip: spot,
    callWall: null,
    putWall: null,
    netGEX: 0,
    regime: 'NEUTRAL',
    
    // Key levels for big moves
    majorResistance: [],
    majorSupport: [],
    
    // Move potential
    upPotential: 0,
    downPotential: 0,
  };
  
  let minAbsGEX = Infinity;
  let maxCallOI = 0, maxPutOI = 0;
  const gexByStrike = {};
  
  for (let i = -40; i <= 40; i++) {
    const K = Math.round(spot / 5) * 5 + i * 5;
    const dist = Math.abs(K - spot);
    const decay = Math.exp(-dist / 80);
    
    // More realistic OI distribution - clusters at round numbers
    const is100 = K % 100 === 0;
    const is50 = K % 50 === 0;
    const is25 = K % 25 === 0;
    const baseOI = is100 ? 15000 : is50 ? 10000 : is25 ? 6000 : 3000;
    
    const callOI = Math.floor(baseOI * decay * (K >= spot ? 1.5 : 0.5) * (0.8 + random() * 0.4));
    const putOI = Math.floor(baseOI * decay * (K <= spot ? 1.5 : 0.5) * (0.8 + random() * 0.4));
    
    if (callOI > maxCallOI && K > spot) { maxCallOI = callOI; profile.callWall = K; }
    if (putOI > maxPutOI && K < spot) { maxPutOI = putOI; profile.putWall = K; }
    
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(spot / K) + (0.05 + 0.5 * iv * iv) * T) / (iv * sqrtT);
    const gamma = normalPDF(d1) / (spot * iv * sqrtT);
    
    // GEX: Dealers short calls, long puts
    const callGEX = -gamma * callOI * 100 * spot / 100;
    const putGEX = gamma * putOI * 100 * spot / 100;
    const netGEX = callGEX + putGEX;
    
    gexByStrike[K] = netGEX / 1e9;
    profile.netGEX += netGEX;
    
    // Find gamma flip
    if (Math.abs(netGEX) < minAbsGEX && dist < 60) {
      minAbsGEX = Math.abs(netGEX);
      profile.gammaFlip = K;
    }
    
    // Identify major levels (where big moves stall or accelerate)
    const gexB = Math.abs(netGEX / 1e9);
    if (gexB > 1.0) {
      if (K > spot) {
        profile.majorResistance.push({ strike: K, gex: gexB, dist: K - spot });
      } else {
        profile.majorSupport.push({ strike: K, gex: gexB, dist: spot - K });
      }
    }
  }
  
  profile.netGEX /= 1e9;
  profile.majorResistance.sort((a, b) => a.dist - b.dist);
  profile.majorSupport.sort((a, b) => a.dist - b.dist);
  
  // Determine regime
  const aboveFlip = spot > profile.gammaFlip;
  if (profile.netGEX > 0.5) {
    profile.regime = 'POSITIVE_GAMMA';
  } else if (profile.netGEX < -0.5) {
    profile.regime = 'NEGATIVE_GAMMA';
  } else {
    profile.regime = 'NEUTRAL';
  }
  
  // Calculate move potential
  // Upside: Distance to call wall, less if positive gamma (dampening)
  const toCallWall = profile.callWall ? profile.callWall - spot : 50;
  const toResist = profile.majorResistance[0]?.dist || 50;
  profile.upPotential = Math.min(toCallWall, toResist) * (profile.netGEX < 0 ? 1.3 : 0.8);
  
  // Downside: Distance to put wall, more if negative gamma (amplifying)
  const toPutWall = profile.putWall ? spot - profile.putWall : 50;
  const toSupport = profile.majorSupport[0]?.dist || 50;
  profile.downPotential = Math.min(toPutWall, toSupport) * (profile.netGEX < 0 ? 1.3 : 0.8);
  
  return profile;
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// MOMENTUM DETECTION - Identify when big move is STARTING
// ═══════════════════════════════════════════════════════════════════════════════════════

const detectMomentumIgnition = (candles) => {
  if (candles.length < 10) return null;
  
  const last8 = candles.slice(-8);
  const last3 = candles.slice(-3);
  const c = candles[candles.length - 1];
  
  // Calculate ATR
  let atrSum = 0;
  for (let i = candles.length - 14; i < candles.length && i > 0; i++) {
    atrSum += Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c),
      Math.abs(candles[i].l - candles[i-1].c)
    );
  }
  const atr = atrSum / 14;
  
  // Current bar analysis
  const body = c.c - c.o;
  const range = c.h - c.l || 0.01;
  const bodyRatio = Math.abs(body) / range;
  const isStrongBar = bodyRatio > 0.65 && range > atr * 0.8;
  
  // Last 3 bars momentum
  const last3Net = last3[2].c - last3[0].o;
  const last3Range = Math.max(...last3.map(x => x.h)) - Math.min(...last3.map(x => x.l));
  const isMomentumBurst = Math.abs(last3Net) > atr * 1.2;
  
  // Volume surge
  const avgVol = last8.slice(0, 5).reduce((s, x) => s + x.v, 0) / 5;
  const recentVol = (last3[1].v + last3[2].v) / 2;
  const volSurge = recentVol / avgVol;
  
  // Breakout detection (breaking recent range)
  const recentHigh = Math.max(...last8.slice(0, -1).map(x => x.h));
  const recentLow = Math.min(...last8.slice(0, -1).map(x => x.l));
  const isBreakoutUp = c.c > recentHigh && body > 0;
  const isBreakoutDown = c.c < recentLow && body < 0;
  
  // Determine ignition
  let direction = null;
  let strength = 0;
  let type = null;
  
  if (body > 0 && isStrongBar && isMomentumBurst && last3Net > 0) {
    direction = 'UP';
    strength = Math.min(100, 50 + volSurge * 15 + (isBreakoutUp ? 20 : 0));
    type = isBreakoutUp ? 'BREAKOUT' : 'MOMENTUM';
  } else if (body < 0 && isStrongBar && isMomentumBurst && last3Net < 0) {
    direction = 'DOWN';
    strength = Math.min(100, 50 + volSurge * 15 + (isBreakoutDown ? 20 : 0));
    type = isBreakoutDown ? 'BREAKDOWN' : 'MOMENTUM';
  }
  
  if (!direction || strength < 60) return null;
  
  return {
    direction,
    strength,
    type,
    volSurge,
    atr,
    isBreakout: isBreakoutUp || isBreakoutDown,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// TIME WINDOW - When big moves happen
// ═══════════════════════════════════════════════════════════════════════════════════════

const getTimeQuality = (ts) => {
  const h = ts.getHours() + ts.getMinutes() / 60;
  const dow = ts.getDay();
  
  // No Fridays (weekend gap risk)
  if (dow === 5) return { quality: 0, window: 'FRIDAY', canTrade: false };
  
  // Prime windows for big moves
  if (h >= 9.5 && h < 10.5) return { quality: 100, window: 'OPENING', canTrade: true };
  if (h >= 10.5 && h < 11.5) return { quality: 70, window: 'MID_MORN', canTrade: true };
  if (h >= 11.5 && h < 14) return { quality: 0, window: 'LUNCH', canTrade: false };
  if (h >= 14 && h < 14.5) return { quality: 60, window: 'EARLY_PM', canTrade: true };
  if (h >= 14.5 && h < 15.75) return { quality: 90, window: 'POWER', canTrade: true };
  
  return { quality: 0, window: 'CLOSED', canTrade: false };
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// BIG MOVE SIGNAL DETECTION
// ═══════════════════════════════════════════════════════════════════════════════════════

const detectBigMoveSetup = (candles, i) => {
  if (i < 30) return null;
  
  const recent = candles.slice(Math.max(0, i - 30), i + 1);
  const c = candles[i];
  
  // Check time first
  const time = getTimeQuality(c.ts);
  if (!time.canTrade) return null;
  
  // Build GEX profile
  const gex = buildGEX(c.c);
  
  // Check for momentum ignition
  const ignition = detectMomentumIgnition(recent);
  if (!ignition) return null;
  
  // Validate GEX supports the move
  let signal = null;
  const reasons = [];
  
  if (ignition.direction === 'UP') {
    // Need upside potential
    if (gex.upPotential < CONFIG.targets.tp1) return null;
    
    // Best setups:
    // 1. Breaking above gamma flip (dealers start chasing)
    // 2. Bouncing off put wall (GEX support)
    // 3. Negative gamma regime (moves extend)
    
    const distToFlip = c.c - gex.gammaFlip;
    const distToPutWall = gex.putWall ? c.c - gex.putWall : 999;
    
    let conf = ignition.strength;
    
    if (distToFlip > 0 && distToFlip < 15) {
      // Just broke above gamma flip
      reasons.push('⚡ Above γ-Flip');
      conf += 15;
    }
    
    if (distToPutWall < 12) {
      // Near put wall support
      reasons.push('💎 Put Wall Support');
      conf += 10;
    }
    
    if (gex.regime === 'NEGATIVE_GAMMA') {
      // Negative gamma = moves extend
      reasons.push('🔴 -γ Amplify');
      conf += 10;
    }
    
    if (ignition.isBreakout) {
      reasons.push('🚀 Breakout');
      conf += 10;
    }
    
    if (ignition.volSurge > 1.5) {
      reasons.push('🔊 Volume');
    }
    
    reasons.push(`⏰ ${time.window}`);
    
    if (conf >= 70) {
      signal = {
        type: ignition.type + '_LONG',
        dir: 'LONG',
        entry: c.c,
        conf: Math.min(95, conf),
        reasons,
        potential: gex.upPotential,
        gex,
        time,
        atr: ignition.atr,
      };
    }
  }
  
  if (!signal && ignition.direction === 'DOWN') {
    // Need downside potential
    if (gex.downPotential < CONFIG.targets.tp1) return null;
    
    const distToFlip = gex.gammaFlip - c.c;
    const distToCallWall = gex.callWall ? gex.callWall - c.c : 999;
    
    let conf = ignition.strength;
    
    if (distToFlip > 0 && distToFlip < 15) {
      // Just broke below gamma flip
      reasons.push('⚡ Below γ-Flip');
      conf += 15;
    }
    
    if (distToCallWall < 12) {
      // Rejected from call wall
      reasons.push('🧱 Call Wall Reject');
      conf += 10;
    }
    
    if (gex.regime === 'NEGATIVE_GAMMA') {
      reasons.push('🔴 -γ Amplify');
      conf += 10;
    }
    
    if (ignition.isBreakout) {
      reasons.push('💧 Breakdown');
      conf += 10;
    }
    
    if (ignition.volSurge > 1.5) {
      reasons.push('🔊 Volume');
    }
    
    reasons.push(`⏰ ${time.window}`);
    
    if (conf >= 70) {
      signal = {
        type: ignition.type + '_SHORT',
        dir: 'SHORT',
        entry: c.c,
        conf: Math.min(95, conf),
        reasons,
        potential: gex.downPotential,
        gex,
        time,
        atr: ignition.atr,
      };
    }
  }
  
  if (!signal) return null;
  
  // Set stops and targets
  const stopDist = Math.min(CONFIG.spx.maxStop, signal.atr * 1.0);
  
  return {
    ...signal,
    stop: signal.dir === 'LONG' ? signal.entry - stopDist : signal.entry + stopDist,
    tp1: signal.dir === 'LONG' ? signal.entry + CONFIG.targets.tp1 : signal.entry - CONFIG.targets.tp1,
    tp2: signal.dir === 'LONG' ? signal.entry + CONFIG.targets.tp2 : signal.entry - CONFIG.targets.tp2,
    tp3: signal.dir === 'LONG' ? signal.entry + CONFIG.targets.tp3 : signal.entry - CONFIG.targets.tp3,
    risk: stopDist,
    rr: (CONFIG.targets.tp1 / stopDist).toFixed(1),
    bar: c.bar,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// TRADE EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════════════

class Trade {
  constructor(sig) {
    Object.assign(this, sig);
    this.actualEntry = this.entry + (this.dir === 'LONG' ? 0.25 : -0.25); // Small slippage
    this.curStop = this.stop;
    this.maxPnL = 0;
    this.bars = 0;
    this.status = 'ACTIVE';
    this.scales = { tp1: false, tp2: false };
    this.log = [
      `🎯 ${this.type} @ ${this.actualEntry.toFixed(2)} | Conf: ${this.conf}%`,
      `   ${this.reasons.join(' ')}`,
      `   Stop: ${this.stop.toFixed(2)} | TP1: ${this.tp1.toFixed(2)} | TP2: ${this.tp2.toFixed(2)} | R:R ${this.rr}`,
    ];
  }
  
  update(c) {
    if (this.status !== 'ACTIVE') return this;
    this.bars++;
    
    const pnl = this.dir === 'LONG' ? c.c - this.actualEntry : this.actualEntry - c.c;
    const maxP = this.dir === 'LONG' ? c.h - this.actualEntry : this.actualEntry - c.l;
    if (maxP > this.maxPnL) this.maxPnL = maxP;
    
    // Stop check
    const stopped = this.dir === 'LONG' ? c.l <= this.curStop : c.h >= this.curStop;
    if (stopped) {
      const exitPnL = this.dir === 'LONG' ? this.curStop - this.actualEntry : this.actualEntry - this.curStop;
      return this.close(this.curStop, 'STOP', exitPnL);
    }
    
    // TP2 (18+ pts - big move confirmed!)
    if (!this.scales.tp2 && (this.dir === 'LONG' ? c.h >= this.tp2 : c.l <= this.tp2)) {
      this.scales.tp2 = true;
      this.curStop = this.dir === 'LONG' ? this.actualEntry + 12 : this.actualEntry - 12;
      this.log.push(`🎯 TP2 +${CONFIG.targets.tp2}pts! Lock +12`);
    }
    
    // TP1 (10+ pts)
    if (!this.scales.tp1 && (this.dir === 'LONG' ? c.h >= this.tp1 : c.l <= this.tp1)) {
      this.scales.tp1 = true;
      this.curStop = this.dir === 'LONG' ? this.actualEntry + 4 : this.actualEntry - 4;
      this.log.push(`✅ TP1 +${CONFIG.targets.tp1}pts - Lock +4`);
    }
    
    // BE at +5
    if (this.maxPnL >= 5 && !this.scales.tp1) {
      this.curStop = this.actualEntry + (this.dir === 'LONG' ? 0.5 : -0.5);
    }
    
    // Trail after TP2
    if (this.scales.tp2) {
      const trail = this.dir === 'LONG' ? c.c - 6 : c.c + 6;
      if ((this.dir === 'LONG' && trail > this.curStop) || (this.dir === 'SHORT' && trail < this.curStop)) {
        this.curStop = trail;
      }
    }
    
    // Time exit (max 60 bars = 5 hours)
    if (this.bars >= 60) return this.close(c.c, 'TIME', pnl);
    
    // EOD exit
    const h = c.ts.getHours() + c.ts.getMinutes() / 60;
    if (h >= 15.92) return this.close(c.c, 'EOD', pnl);
    
    return this;
  }
  
  close(price, reason, pnlPts) {
    this.status = 'CLOSED';
    this.exit = price;
    this.exitReason = reason;
    this.finalPnL = pnlPts;
    this.pnl$ = (pnlPts * CONFIG.spx.pointValue) - CONFIG.costs.total;
    this.isBigWin = pnlPts >= 15;
    
    const icon = pnlPts >= 15 ? '🏆' : pnlPts > 0 ? '✅' : '❌';
    this.log.push(`${icon} ${reason}: ${pnlPts >= 0 ? '+' : ''}${pnlPts.toFixed(1)}pts ($${this.pnl$.toFixed(0)})`);
    
    return this;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// DATA GENERATION (More volatile to simulate real SPX)
// ═══════════════════════════════════════════════════════════════════════════════════════

const generateData = (days, start = 5950) => {
  const data = [];
  let price = start, trend = 0, vol = 'normal';
  
  for (let d = days; d >= 0; d--) {
    const date = new Date(); date.setDate(date.getDate() - d);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    // Daily trend with more persistence
    trend = trend * 0.7 + (random() - 0.47) * 0.005;
    
    // Volatility regimes
    if (random() < 0.08) {
      vol = random() < 0.3 ? 'low' : random() < 0.7 ? 'normal' : 'high';
    }
    const vm = { low: 0.4, normal: 1.0, high: 2.5 }[vol];
    
    const dayOpen = price;
    
    for (let bar = 0; bar < 78; bar++) {
      const h = 9 + Math.floor((30 + bar * 5) / 60);
      const m = (30 + bar * 5) % 60;
      
      // Intraday volatility - much higher at open and close
      let iv = 1.0;
      if (bar < 6) iv = 2.5;          // First 30 min - very volatile
      else if (bar < 12) iv = 1.8;    // Next 30 min
      else if (bar > 66) iv = 2.0;    // Last 60 min
      else if (bar > 60) iv = 1.5;    // Power hour start
      else if (bar > 28 && bar < 48) iv = 0.3; // Lunch
      
      // Occasional big moves (what we want to catch!)
      let bigMove = 1;
      if (random() < 0.03 && (bar < 15 || bar > 60)) {
        bigMove = 2 + random() * 3; // 2-5x normal move
      }
      
      const baseVol = 0.0007 * vm * iv * bigMove;
      const vwapPull = (dayOpen - price) / dayOpen * 0.008;
      const change = (random() - 0.47 + trend + vwapPull) * baseVol * price;
      
      const open = price;
      const move = change * (1 + random() * 0.5);
      const noise = price * baseVol * random() * 0.2;
      
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
      
      // Volume spikes on big moves
      const volMod = bar < 12 ? 2.5 : bar > 65 ? 2.0 : bar > 28 && bar < 48 ? 0.25 : 1.0;
      price = close;
      
      data.push({
        ts: new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m),
        o: +open.toFixed(2),
        h: +high.toFixed(2),
        l: +low.toFixed(2),
        c: +close.toFixed(2),
        v: Math.floor((2e6 + random() * 3e6) * volMod * (bigMove > 1 ? 4 : 1)),
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
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║         🎯 TITAN OMEGA - BIG MOVE DETECTOR (15+ Points)                               ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  GOAL: Identify SPX moves of 15+ points BEFORE they happen                            ║
║                                                                                       ║
║  HOW IT WORKS:                                                                        ║
║  1. GEX Analysis → WHERE the move will go (walls, gamma flip)                         ║
║  2. Momentum Ignition → WHEN the move is starting (breakouts, volume)                 ║
║  3. Time Filter → Only trade during big-move windows (Open, Power Hour)               ║
║                                                                                       ║
║  TARGETS: TP1=+10pts | TP2=+18pts | TP3=+30pts | Stop=6pts max                        ║
║  SPX: $50/point | Stop=$300 | TP1=$500 | TP2=$900 | TP3=$1500                         ║
║                                                                                       ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝
`);
  
  console.log('⏳ Generating SPX data with realistic volatility...');
  const candles = generateData(days);
  console.log(`✅ ${candles.length.toLocaleString()} candles | Scanning for big move setups...\n`);
  
  const trades = [];
  let current = null;
  let lastBar = -20;
  let dailyTrades = 0, curDay = null;
  
  for (let i = 30; i < candles.length - 5; i++) {
    const c = candles[i];
    const day = c.ts.toDateString();
    
    if (day !== curDay) {
      curDay = day;
      dailyTrades = 0;
    }
    
    // Update active trade
    if (current?.status === 'ACTIVE') {
      current.update(c);
      if (current.status === 'CLOSED') {
        trades.push(current);
        lastBar = i;
        current = null;
      }
      continue;
    }
    
    // Look for new setup
    if (dailyTrades >= CONFIG.risk.maxTrades) continue;
    if (i - lastBar < 15) continue;
    
    const sig = detectBigMoveSetup(candles, i);
    if (sig) {
      current = new Trade(sig);
      dailyTrades++;
    }
  }
  
  // Calculate stats
  const bigWins = trades.filter(t => t.isBigWin);
  const wins = trades.filter(t => t.finalPnL > 0);
  const losses = trades.filter(t => t.finalPnL <= 0);
  
  const totalPts = trades.reduce((s, t) => s + t.finalPnL, 0);
  const total$ = trades.reduce((s, t) => s + t.pnl$, 0);
  
  const avgWinPts = wins.length ? wins.reduce((s, t) => s + t.finalPnL, 0) / wins.length : 0;
  const avgLossPts = losses.length ? Math.abs(losses.reduce((s, t) => s + t.finalPnL, 0) / losses.length) : 0;
  const avgBigWin = bigWins.length ? bigWins.reduce((s, t) => s + t.finalPnL, 0) / bigWins.length : 0;
  
  const wr = trades.length ? wins.length / trades.length * 100 : 0;
  const bigWinRate = trades.length ? bigWins.length / trades.length * 100 : 0;
  const pf = avgLossPts > 0 ? (avgWinPts * wins.length) / (avgLossPts * losses.length) : 0;
  
  // By signal type
  const byType = {};
  trades.forEach(t => {
    if (!byType[t.type]) byType[t.type] = { n: 0, pts: 0, big: 0 };
    byType[t.type].n++;
    byType[t.type].pts += t.finalPnL;
    if (t.isBigWin) byType[t.type].big++;
  });
  
  // By time window
  const byTime = {};
  trades.forEach(t => {
    if (!byTime[t.time.window]) byTime[t.time.window] = { n: 0, pts: 0, big: 0 };
    byTime[t.time.window].n++;
    byTime[t.time.window].pts += t.finalPnL;
    if (t.isBigWin) byTime[t.time.window].big++;
  });
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║                         🎯 BIG MOVE DETECTION RESULTS                                 ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  Total Setups:          ${String(trades.length).padStart(8)}                                                  ║
║  Wins:                  ${String(wins.length).padStart(8)}  (${wr.toFixed(1)}% win rate)                          ║
║  15+ Point Winners:     ${String(bigWins.length).padStart(8)}  (${bigWinRate.toFixed(1)}% hit big target)              ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  Total Points:          ${(totalPts >= 0 ? '+' : '') + totalPts.toFixed(1).padStart(8)} SPX points                        ║
║  Total P&L:             ${(total$ >= 0 ? '+$' : '-$') + Math.abs(total$).toFixed(0).padStart(8)} (after costs)                       ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  Avg Win:               +${avgWinPts.toFixed(1).padStart(7)} pts  (+$${(avgWinPts * 50).toFixed(0)})                       ║
║  Avg 15+ Win:           +${avgBigWin.toFixed(1).padStart(7)} pts  (+$${(avgBigWin * 50).toFixed(0)})                       ║
║  Avg Loss:              -${avgLossPts.toFixed(1).padStart(7)} pts  (-$${(avgLossPts * 50).toFixed(0)})                       ║
║  Profit Factor:         ${pf.toFixed(2).padStart(9)}                                                  ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  📊 BY SIGNAL TYPE:                                                                   ║`);

  Object.entries(byType).sort((a, b) => b[1].pts - a[1].pts).forEach(([k, v]) => {
    const icon = k.includes('LONG') ? '📈' : '📉';
    console.log(`║  ${icon} ${k.padEnd(20)} │ ${String(v.n).padStart(3)} │ ${(v.pts >= 0 ? '+' : '') + v.pts.toFixed(0).padStart(5)}pts │ ${v.big} big wins │`);
  });

  console.log(`║                                                                                       ║
║  ⏰ BY TIME WINDOW:                                                                   ║`);

  Object.entries(byTime).sort((a, b) => b[1].pts - a[1].pts).forEach(([k, v]) => {
    console.log(`║  ${k.padEnd(12)} │ ${String(v.n).padStart(3)} │ ${(v.pts >= 0 ? '+' : '') + v.pts.toFixed(0).padStart(5)}pts │ ${v.big} big wins │`);
  });

  console.log(`║                                                                                       ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  📜 SAMPLE BIG WIN:                                                                   ║
║  ─────────────────────────────────────────────────────────────────────────────────── ║`);

  const sample = bigWins[0] || wins[0] || trades[0];
  if (sample) sample.log.forEach(l => console.log(`║  ${l.padEnd(83)} ║`));

  const grade = bigWinRate >= 25 && pf >= 2.0 ? '🏆 S' : bigWinRate >= 18 && pf >= 1.5 ? '🌟 A' : bigWinRate >= 12 && pf >= 1.2 ? '✨ B' : wr >= 35 ? '👍 C' : '⚠️ D';

  console.log(`║                                                                                       ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  SYSTEM GRADE: ${grade}                                                                   ║
║                                                                                       ║
║  ${bigWinRate >= 15 ? '✅' : '❌'} 15pt Hit Rate ≥15%: ${bigWinRate >= 15 ? 'YES' : 'NO'} (${bigWinRate.toFixed(1)}%)                                     ║
║  ${pf >= 1.5 ? '✅' : '❌'} Profit Factor ≥1.5: ${pf >= 1.5 ? 'YES' : 'NO'} (${pf.toFixed(2)})                                        ║
║  ${wr >= 40 ? '✅' : '❌'} Win Rate ≥40%: ${wr >= 40 ? 'YES' : 'NO'} (${wr.toFixed(1)}%)                                           ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝

💡 KEY: GEX shows WHERE. Momentum shows WHEN. Time shows IF.
   When all 3 align → Big move is starting.
`);
};

run(180);
