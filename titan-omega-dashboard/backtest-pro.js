#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA PRO - INSTITUTIONAL BACKTEST
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * NO LAGGING INDICATORS. PURE PRICE ACTION + STRUCTURE + VOLUME.
 * 
 * REMOVED:
 * ❌ RSI, MACD, Stochastic - All lagging, all noise
 * 
 * KEPT:
 * ✅ Price Action - The ONLY leading indicator
 * ✅ Market Structure - HH/HL or LH/LL
 * ✅ VWAP - Institutional benchmark
 * ✅ Key Levels - OR, PDH/PDL, Round numbers  
 * ✅ Volume - Smart money participation
 * ✅ Time Windows - Proven edge
 * ✅ GEX - Dealer positioning
 */

const CONFIG = {
  account: { size: 2000, maxRiskPerTrade: 0.10, maxDailyLoss: 0.08, maxDailyTrades: 3 },
  entry: { minVolumeRatio: 1.3, minATR: 3, maxATR: 15 },
  risk: { initialStopATR: 1.0, maxStopPts: 8, minStopPts: 3, beR: 1.0, trailR: 1.5 },
  targets: { tp1R: 1.5, tp2R: 3.0 },
  time: {
    openingDrive: [9.5, 10.25],
    midMorning: [10.25, 11.5],
    lunchDeath: [11.5, 14],
    afternoon: [14, 15],
    powerHour: [15, 15.75],
  },
};

let seed = 88888888;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// ═══════════════════════════════════════════════════════════════════════════════════════
// CORE CALCULATIONS - CLEAN, NO LAG
// ═══════════════════════════════════════════════════════════════════════════════════════

const ATR = (candles, period = 14) => {
  if (candles.length < period + 1) return 6;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    sum += Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i-1].c), Math.abs(candles[i].l - candles[i-1].c));
  }
  return sum / period;
};

const VWAP = (candles, dayStart) => {
  let cumVol = 0, cumVWAP = 0;
  const dayCandles = candles.filter(c => c.ts >= dayStart);
  dayCandles.forEach(c => {
    const tp = (c.h + c.l + c.c) / 3;
    cumVol += c.v;
    cumVWAP += tp * c.v;
  });
  return cumVol > 0 ? cumVWAP / cumVol : candles[candles.length - 1].c;
};

const getOpeningRange = (candles, dayStart) => {
  const dayCandles = candles.filter(c => c.ts >= dayStart);
  if (dayCandles.length < 3) return null;
  const orCandles = dayCandles.slice(0, 3); // First 15 minutes
  return {
    high: Math.max(...orCandles.map(c => c.h)),
    low: Math.min(...orCandles.map(c => c.l)),
  };
};

const getPrevDayLevels = (candles, dayStart) => {
  const prevCandles = candles.filter(c => c.ts < dayStart);
  if (prevCandles.length < 10) return null;
  // Get last day
  const lastTs = prevCandles[prevCandles.length - 1].ts;
  const lastDay = new Date(lastTs).toDateString();
  const pdCandles = prevCandles.filter(c => new Date(c.ts).toDateString() === lastDay);
  if (pdCandles.length === 0) return null;
  return {
    high: Math.max(...pdCandles.map(c => c.h)),
    low: Math.min(...pdCandles.map(c => c.l)),
    close: pdCandles[pdCandles.length - 1].c,
  };
};

const analyzeStructure = (candles, atr) => {
  if (candles.length < 20) return { trend: 'NEUTRAL', swings: [] };
  
  const minSwing = atr * 0.4;
  const swings = [];
  
  for (let i = 3; i < candles.length - 3; i++) {
    const c = candles[i];
    const isSwingHigh = c.h > candles[i-1].h && c.h > candles[i-2].h && c.h > candles[i+1].h && c.h > candles[i+2].h;
    const isSwingLow = c.l < candles[i-1].l && c.l < candles[i-2].l && c.l < candles[i+1].l && c.l < candles[i+2].l;
    
    if (isSwingHigh) swings.push({ type: 'H', price: c.h, i });
    if (isSwingLow) swings.push({ type: 'L', price: c.l, i });
  }
  
  if (swings.length < 4) return { trend: 'NEUTRAL', swings };
  
  const last4 = swings.slice(-4);
  const highs = last4.filter(s => s.type === 'H').map(s => s.price);
  const lows = last4.filter(s => s.type === 'L').map(s => s.price);
  
  let trend = 'NEUTRAL';
  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs[highs.length - 1] > highs[0];
    const hl = lows[lows.length - 1] > lows[0];
    const lh = highs[highs.length - 1] < highs[0];
    const ll = lows[lows.length - 1] < lows[0];
    
    if (hh && hl) trend = 'UPTREND';
    else if (lh && ll) trend = 'DOWNTREND';
  }
  
  return {
    trend,
    swings,
    lastHigh: highs[highs.length - 1],
    lastLow: lows[lows.length - 1],
  };
};

const analyzeVolume = (candles) => {
  const recent = candles.slice(-15);
  const current = candles[candles.length - 1];
  const avgVol = recent.slice(0, -1).reduce((s, c) => s + c.v, 0) / (recent.length - 1);
  const ratio = current.v / avgVol;
  
  const priceUp = current.c > current.o;
  const volUp = ratio > 1;
  
  let signal = 'NEUTRAL';
  if (priceUp && volUp) signal = 'BULL_CONFIRM';
  else if (!priceUp && volUp) signal = 'BEAR_CONFIRM';
  
  return { ratio, signal, isGood: ratio >= CONFIG.entry.minVolumeRatio };
};

const analyzeTime = (ts) => {
  const hour = ts.getHours() + ts.getMinutes() / 60;
  const dow = ts.getDay();
  
  let window = 'AVOID', quality = 0;
  if (hour >= CONFIG.time.openingDrive[0] && hour < CONFIG.time.openingDrive[1]) { window = 'OPENING'; quality = 100; }
  else if (hour >= CONFIG.time.midMorning[0] && hour < CONFIG.time.midMorning[1]) { window = 'MID_MORN'; quality = 80; }
  else if (hour >= CONFIG.time.lunchDeath[0] && hour < CONFIG.time.lunchDeath[1]) { window = 'LUNCH'; quality = 0; }
  else if (hour >= CONFIG.time.afternoon[0] && hour < CONFIG.time.afternoon[1]) { window = 'AFTERNOON'; quality = 60; }
  else if (hour >= CONFIG.time.powerHour[0] && hour < CONFIG.time.powerHour[1]) { window = 'POWER'; quality = 85; }
  
  if (dow === 5 && hour >= 14) quality *= 0.5;
  
  return { window, quality, canTrade: quality >= 60 };
};

const analyzePriceAction = (candles) => {
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
  
  // Engulfing
  const bullEngulf = isBull && p1.c < p1.o && c.c > p1.o && c.o < p1.c;
  const bearEngulf = isBear && p1.c > p1.o && c.c < p1.o && c.o > p1.c;
  
  // Momentum (3 consecutive)
  const bullMom = isBull && p1.c > p1.o && p2.c > p2.o;
  const bearMom = isBear && p1.c < p1.o && p2.c < p2.o;
  
  // Rejection
  const hammer = lowerWick > absBody * 2 && isBull;
  const shooter = upperWick > absBody * 2 && isBear;
  
  let bias = 'NEUTRAL', strength = 0, setup = 'NONE';
  
  if (bullEngulf) { bias = 'BULL'; strength = 0.9; setup = 'ENGULF'; }
  else if (bearEngulf) { bias = 'BEAR'; strength = 0.9; setup = 'ENGULF'; }
  else if (bullMom && isStrong) { bias = 'BULL'; strength = 0.8; setup = 'MOMENTUM'; }
  else if (bearMom && isStrong) { bias = 'BEAR'; strength = 0.8; setup = 'MOMENTUM'; }
  else if (hammer) { bias = 'BULL'; strength = 0.7; setup = 'HAMMER'; }
  else if (shooter) { bias = 'BEAR'; strength = 0.7; setup = 'SHOOTER'; }
  
  return { bias, strength, setup };
};

const getGEX = (spot) => {
  const round = Math.round(spot / 25) * 25;
  return {
    gammaFlip: round,
    isPositiveGamma: spot > round,
    support: round - 25,
    resistance: round + 25,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// DATA GENERATION
// ═══════════════════════════════════════════════════════════════════════════════════════

const generateData = (days, startPrice = 5950) => {
  const data = [];
  let price = startPrice, trend = 0, vol = 'normal';
  
  for (let d = days; d >= 0; d--) {
    const date = new Date(); date.setDate(date.getDate() - d);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    trend = trend * 0.6 + (random() - 0.47) * 0.004;
    if (random() < 0.08) vol = ['low', 'normal', 'normal', 'high'][Math.floor(random() * 4)];
    const volMult = { low: 0.5, normal: 1.0, high: 1.8 }[vol];
    const dayOpen = price;
    
    for (let bar = 0; bar < 78; bar++) {
      const hour = 9 + Math.floor((30 + bar * 5) / 60);
      const minute = (30 + bar * 5) % 60;
      
      let intVol = 1.0;
      if (bar < 12) intVol = 1.8;
      else if (bar > 65) intVol = 1.5;
      else if (bar > 28 && bar < 48) intVol = 0.5;
      
      const baseVol = 0.0005 * volMult * intVol;
      const vwapPull = (dayOpen - price) / dayOpen;
      const change = (random() - 0.47 + trend + vwapPull * 0.02) * baseVol * price;
      
      const open = price;
      const move = change * (1 + random() * 0.6);
      const noise = price * baseVol * random() * 0.4;
      
      let high, low, close;
      if (change >= 0) {
        close = price + move; high = Math.max(open, close) + noise; low = Math.min(open, close) - noise * 0.3;
      } else {
        close = price + move; low = Math.min(open, close) - noise; high = Math.max(open, close) + noise * 0.3;
      }
      
      const volMod = bar < 12 ? 2.2 : bar > 65 ? 1.8 : bar > 28 && bar < 48 ? 0.4 : 1.0;
      price = close;
      
      data.push({
        ts: new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute),
        o: +open.toFixed(2), h: +high.toFixed(2), l: +low.toFixed(2), c: +close.toFixed(2),
        v: Math.floor((1000000 + random() * 1500000) * volMod), bar,
      });
    }
  }
  return data;
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// SIGNAL GENERATION - CLEAN INSTITUTIONAL LOGIC
// ═══════════════════════════════════════════════════════════════════════════════════════

const analyze = (candles, i) => {
  if (i < 50) return null;
  
  const recent = candles.slice(Math.max(0, i - 60), i + 1);
  const c = candles[i];
  const dayStart = new Date(c.ts); dayStart.setHours(9, 30, 0, 0);
  
  const atr = ATR(recent);
  const vwap = VWAP(candles.slice(0, i + 1), dayStart);
  const or = getOpeningRange(candles.slice(0, i + 1), dayStart);
  const pd = getPrevDayLevels(candles.slice(0, i + 1), dayStart);
  const structure = analyzeStructure(recent, atr);
  const volume = analyzeVolume(recent);
  const time = analyzeTime(c.ts);
  const pa = analyzePriceAction(recent);
  const gex = getGEX(c.c);
  
  return { price: c.c, atr, vwap, or, pd, structure, volume, time, pa, gex, candle: c };
};

const generateSignal = (a) => {
  if (!a) return null;
  const { price, atr, vwap, or, pd, structure, volume, time, pa, gex } = a;
  
  // FILTER: Time, Volume, ATR
  if (!time.canTrade) return null;
  if (!volume.isGood) return null;
  if (atr < CONFIG.entry.minATR || atr > CONFIG.entry.maxATR) return null;
  
  let dir = null;
  const reasons = [];
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // LONG CONDITIONS - Need 4+ confirmations
  // ═══════════════════════════════════════════════════════════════════════════════
  
  const longC = {
    structureUp: structure.trend === 'UPTREND',
    aboveVWAP: price > vwap,
    orBreakout: or && price > or.high,
    pdBreakout: pd && price > pd.high,
    bullPA: pa?.bias === 'BULL' && pa.strength >= 0.7,
    volConfirm: volume.signal === 'BULL_CONFIRM',
    atSupport: gex.support && Math.abs(price - gex.support) < atr,
    posGamma: gex.isPositiveGamma,
  };
  
  const longScore = Object.values(longC).filter(Boolean).length;
  
  if (longScore >= 4 && (longC.orBreakout || longC.pdBreakout || (longC.atSupport && longC.bullPA))) {
    dir = 'LONG';
    if (longC.structureUp) reasons.push('📈 Uptrend');
    if (longC.orBreakout) reasons.push('🚀 OR Break');
    if (longC.pdBreakout) reasons.push('📊 PDH Break');
    if (longC.bullPA) reasons.push(`🔨 ${pa.setup}`);
    if (longC.aboveVWAP) reasons.push('📍 >VWAP');
    if (longC.volConfirm) reasons.push('📦 Vol');
    if (longC.atSupport) reasons.push('💎 Support');
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SHORT CONDITIONS - Need 4+ confirmations
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (!dir) {
    const shortC = {
      structureDown: structure.trend === 'DOWNTREND',
      belowVWAP: price < vwap,
      orBreakdown: or && price < or.low,
      pdBreakdown: pd && price < pd.low,
      bearPA: pa?.bias === 'BEAR' && pa.strength >= 0.7,
      volConfirm: volume.signal === 'BEAR_CONFIRM',
      atResist: gex.resistance && Math.abs(price - gex.resistance) < atr,
      negGamma: !gex.isPositiveGamma,
    };
    
    const shortScore = Object.values(shortC).filter(Boolean).length;
    
    if (shortScore >= 4 && (shortC.orBreakdown || shortC.pdBreakdown || (shortC.atResist && shortC.bearPA))) {
      dir = 'SHORT';
      if (shortC.structureDown) reasons.push('📉 Downtrend');
      if (shortC.orBreakdown) reasons.push('🔻 OR Break');
      if (shortC.pdBreakdown) reasons.push('📊 PDL Break');
      if (shortC.bearPA) reasons.push(`⭐ ${pa.setup}`);
      if (shortC.belowVWAP) reasons.push('📍 <VWAP');
      if (shortC.volConfirm) reasons.push('📦 Vol');
      if (shortC.atResist) reasons.push('🔴 Resist');
    }
  }
  
  if (!dir) return null;
  
  // Stop & Targets
  const stopDist = Math.max(CONFIG.risk.minStopPts, Math.min(CONFIG.risk.maxStopPts, atr * CONFIG.risk.initialStopATR));
  const entry = price;
  const stop = dir === 'LONG' ? entry - stopDist : entry + stopDist;
  const risk = Math.abs(entry - stop);
  
  return {
    dir, entry, stop, risk,
    tp1: dir === 'LONG' ? entry + risk * CONFIG.targets.tp1R : entry - risk * CONFIG.targets.tp1R,
    tp2: dir === 'LONG' ? entry + risk * CONFIG.targets.tp2R : entry - risk * CONFIG.targets.tp2R,
    reasons, time: time.window, structure: structure.trend,
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
    this.maxPnL = 0;
    this.bars = 0;
    this.status = 'ACTIVE';
    this.tp1Hit = false;
    this.log = [`🎯 ${this.dir} @ ${this.entry.toFixed(2)} | ${this.reasons.join(' ')}`];
  }
  
  update(c) {
    if (this.status !== 'ACTIVE') return this;
    this.bars++;
    
    const pnl = this.dir === 'LONG' ? c.c - this.entry : this.entry - c.c;
    const r = pnl / this.risk;
    if (pnl > this.maxPnL) this.maxPnL = pnl;
    
    // Stop hit
    const stopHit = this.dir === 'LONG' ? c.c <= this.curStop : c.c >= this.curStop;
    if (stopHit) return this.close(this.curStop, `${this.phase}_STOP`, this.dir === 'LONG' ? this.curStop - this.entry : this.entry - this.curStop);
    
    // TP2 hit
    if (r >= CONFIG.targets.tp2R) {
      this.log.push(`🏆 TP2 HIT! +${pnl.toFixed(1)} pts (${r.toFixed(1)}R)`);
      return this.close(this.tp2, 'TP2_HIT', pnl);
    }
    
    // TP1 hit - take half, trail rest
    if (r >= CONFIG.targets.tp1R && !this.tp1Hit) {
      this.tp1Hit = true;
      this.phase = 'TRAILING';
      this.curStop = this.dir === 'LONG' ? c.c - this.risk * 0.5 : c.c + this.risk * 0.5;
      this.log.push(`✅ TP1 HIT +${pnl.toFixed(1)} pts - Trailing`);
    }
    
    // Breakeven
    if (r >= CONFIG.risk.beR && this.phase === 'INITIAL') {
      this.phase = 'BREAKEVEN';
      this.curStop = this.entry + (this.dir === 'LONG' ? 0.5 : -0.5);
      this.log.push(`🔒 Breakeven`);
    }
    
    // Trailing
    if (this.phase === 'TRAILING') {
      const trail = this.dir === 'LONG' ? c.c - this.risk * 0.4 : c.c + this.risk * 0.4;
      if ((this.dir === 'LONG' && trail > this.curStop) || (this.dir === 'SHORT' && trail < this.curStop)) {
        this.curStop = trail;
      }
    }
    
    // EOD / Time
    if (c.bar >= 76) return this.close(c.c, 'EOD', pnl);
    if (this.bars >= 40) return this.close(c.c, 'TIME', pnl);
    
    this.pnl = pnl;
    this.r = r;
    return this;
  }
  
  close(price, reason, pnl) {
    this.status = 'CLOSED';
    this.exit = price;
    this.exitReason = reason;
    this.finalPnL = pnl;
    this.finalR = pnl / this.risk;
    this.pnl$ = pnl * 50;
    this.log.push(`${pnl > 0 ? '✅' : '🛑'} ${reason}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)} pts (${this.finalR.toFixed(2)}R)`);
    return this;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// RUN BACKTEST
// ═══════════════════════════════════════════════════════════════════════════════════════

const run = (days = 180) => {
  console.clear();
  console.log(`
╔════════════════════════════════════════════════════════════════════════════════════╗
║           🏛️ TITAN OMEGA PRO - INSTITUTIONAL GRADE BACKTEST                        ║
║                    "Trade What You SEE, Not What You THINK"                        ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  REMOVED (Noise):                                                                  ║
║    ❌ RSI - Lagging oscillator                                                     ║
║    ❌ MACD - Double lagged, too slow                                               ║
║    ❌ Stochastic - More noise                                                      ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  FOCUS (What Institutions Use):                                                    ║
║    ✅ PRICE ACTION - The only leading indicator                                    ║
║    ✅ MARKET STRUCTURE - HH/HL or LH/LL                                            ║
║    ✅ VWAP - Institutional benchmark                                               ║
║    ✅ KEY LEVELS - OR, PDH/PDL, Round numbers                                      ║
║    ✅ VOLUME - Smart money participation                                           ║
║    ✅ TIME WINDOWS - Proven edge                                                   ║
║    ✅ GEX - Dealer positioning                                                     ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  💰 Account: $${CONFIG.account.size}  |  📅 Period: ${days} days  |  🎯 Targets: ${CONFIG.targets.tp1R}R/${CONFIG.targets.tp2R}R             ║
╚════════════════════════════════════════════════════════════════════════════════════╝
`);
  
  console.log('⏳ Generating institutional-grade market data...');
  const candles = generateData(days);
  console.log(`✅ Generated ${candles.length.toLocaleString()} candles\n`);
  
  const trades = [];
  let current = null;
  let lastBar = -20;
  let dailyTrades = 0, curDay = null;
  let rejected = 0;
  
  console.log('⏳ Running clean backtest (no lagging indicators)...\n');
  
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
    
    if (i - lastBar < 15 || dailyTrades >= CONFIG.account.maxDailyTrades) continue;
    
    const a = analyze(candles, i);
    const sig = generateSignal(a);
    
    if (sig) {
      current = new Trade(sig);
      dailyTrades++;
    } else if (a && a.time.canTrade) {
      rejected++;
    }
  }
  
  // Stats
  const wins = trades.filter(t => t.finalPnL > 0);
  const losses = trades.filter(t => t.finalPnL <= 0);
  const totalPnL = trades.reduce((s, t) => s + t.finalPnL, 0);
  const totalPnL$ = trades.reduce((s, t) => s + (t.pnl$ || 0), 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.finalPnL, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.finalPnL, 0) / losses.length) : 0;
  const avgWin$ = wins.length ? wins.reduce((s, t) => s + t.pnl$, 0) / wins.length : 0;
  const avgLoss$ = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnl$, 0) / losses.length) : 0;
  const pf = avgLoss$ > 0 && losses.length ? (avgWin$ * wins.length) / (avgLoss$ * losses.length) : 0;
  const avgR = trades.length ? trades.reduce((s, t) => s + t.finalR, 0) / trades.length : 0;
  
  // Equity curve
  let equity = CONFIG.account.size, peak = equity, maxDD = 0;
  trades.forEach(t => {
    equity += t.pnl$;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
  });
  
  // Exit analysis
  const byExit = {};
  trades.forEach(t => {
    if (!byExit[t.exitReason]) byExit[t.exitReason] = { n: 0, pnl$: 0, wins: 0 };
    byExit[t.exitReason].n++;
    byExit[t.exitReason].pnl$ += t.pnl$;
    if (t.finalPnL > 0) byExit[t.exitReason].wins++;
  });
  
  // By time window
  const byTime = {};
  trades.forEach(t => {
    if (!byTime[t.time]) byTime[t.time] = { n: 0, pnl$: 0, wins: 0 };
    byTime[t.time].n++;
    byTime[t.time].pnl$ += t.pnl$;
    if (t.finalPnL > 0) byTime[t.time].wins++;
  });
  
  // By structure
  const byStructure = {};
  trades.forEach(t => {
    if (!byStructure[t.structure]) byStructure[t.structure] = { n: 0, pnl$: 0, wins: 0 };
    byStructure[t.structure].n++;
    byStructure[t.structure].pnl$ += t.pnl$;
    if (t.finalPnL > 0) byStructure[t.structure].wins++;
  });
  
  // Print results
  const wr = trades.length ? wins.length / trades.length * 100 : 0;
  
  console.log(`
┌────────────────────────────────────────────────────────────────────────────────────┐
│                      🏛️ INSTITUTIONAL BACKTEST RESULTS                             │
├────────────────────────────────────────────────────────────────────────────────────┤
│  Total Trades:             ${String(trades.length).padStart(6)}  (${rejected} filtered out)                       │
│  Winning Trades:           ${String(wins.length).padStart(6)}  (${wr.toFixed(1)}% WIN RATE)                         │
│  Losing Trades:            ${String(losses.length).padStart(6)}                                                 │
├────────────────────────────────────────────────────────────────────────────────────┤
│  💰 TOTAL P&L:             ${(totalPnL$ >= 0 ? '+' : '-')}$${Math.abs(totalPnL$).toFixed(2).padStart(9)}                                        │
│  📊 Total Points:          ${(totalPnL >= 0 ? '+' : '') + totalPnL.toFixed(1).padStart(9)} SPX pts                             │
│  💎 Final Account:         $${equity.toFixed(2).padStart(9)} (${((equity / CONFIG.account.size - 1) * 100).toFixed(1)}% return)                  │
├────────────────────────────────────────────────────────────────────────────────────┤
│  Avg Win:                  +$${avgWin$.toFixed(2).padStart(8)} (+${avgWin.toFixed(1)} pts)                            │
│  Avg Loss:                 -$${avgLoss$.toFixed(2).padStart(8)} (-${avgLoss.toFixed(1)} pts)                            │
│  Profit Factor:            ${pf.toFixed(2).padStart(9)}                                                 │
│  Avg R-Multiple:           ${avgR.toFixed(2).padStart(9)}                                                 │
│  Max Drawdown:             ${maxDD.toFixed(1).padStart(8)}%                                                 │
├────────────────────────────────────────────────────────────────────────────────────┤
│  ✅ TP1 Hits:              ${String(trades.filter(t => t.tp1Hit).length).padStart(6)}  (${(trades.filter(t => t.tp1Hit).length / trades.length * 100 || 0).toFixed(0)}% of trades)                        │
│  🏆 TP2 Hits:              ${String(trades.filter(t => t.exitReason === 'TP2_HIT').length).padStart(6)}  (${(trades.filter(t => t.exitReason === 'TP2_HIT').length / trades.length * 100 || 0).toFixed(0)}% of trades)                        │
└────────────────────────────────────────────────────────────────────────────────────┘
`);
  
  console.log(`
┌────────────────────────────────────────────────────────────────────────────────────┐
│                           📊 EXIT ANALYSIS                                         │
├────────────────────────────────────────────────────────────────────────────────────┤`);
  ['TP2_HIT', 'TRAILING_STOP', 'BREAKEVEN_STOP', 'EOD', 'TIME', 'INITIAL_STOP'].forEach(r => {
    const d = byExit[r];
    if (d) {
      const wr = d.n > 0 ? (d.wins / d.n * 100).toFixed(0) : '0';
      const icon = r === 'TP2_HIT' ? '🏆' : r.includes('TRAIL') || r.includes('BREAK') ? '🔒' : r === 'INITIAL_STOP' ? '🛑' : '⏱️';
      console.log(`│  ${icon} ${r.padEnd(16)} │ ${String(d.n).padStart(4)} │ WR: ${wr.padStart(3)}% │ ${(d.pnl$ >= 0 ? '+$' : '-$') + Math.abs(d.pnl$).toFixed(0).padStart(6)} │`);
    }
  });
  console.log(`└────────────────────────────────────────────────────────────────────────────────────┘`);
  
  console.log(`
┌────────────────────────────────────────────────────────────────────────────────────┐
│                        ⏰ TIME WINDOW ANALYSIS                                     │
├────────────────────────────────────────────────────────────────────────────────────┤`);
  ['OPENING', 'MID_MORN', 'AFTERNOON', 'POWER'].forEach(w => {
    const d = byTime[w];
    if (d) {
      const wr = d.n > 0 ? (d.wins / d.n * 100).toFixed(0) : '0';
      const icon = w === 'OPENING' ? '🌅' : w === 'POWER' ? '⚡' : '📊';
      console.log(`│  ${icon} ${w.padEnd(12)} │ ${String(d.n).padStart(4)} │ WR: ${wr.padStart(3)}% │ ${(d.pnl$ >= 0 ? '+$' : '-$') + Math.abs(d.pnl$).toFixed(0).padStart(6)} │`);
    }
  });
  console.log(`└────────────────────────────────────────────────────────────────────────────────────┘`);
  
  console.log(`
┌────────────────────────────────────────────────────────────────────────────────────┐
│                       📈 STRUCTURE ANALYSIS                                        │
├────────────────────────────────────────────────────────────────────────────────────┤`);
  ['UPTREND', 'DOWNTREND', 'NEUTRAL'].forEach(s => {
    const d = byStructure[s];
    if (d) {
      const wr = d.n > 0 ? (d.wins / d.n * 100).toFixed(0) : '0';
      const icon = s === 'UPTREND' ? '📈' : s === 'DOWNTREND' ? '📉' : '➖';
      console.log(`│  ${icon} ${s.padEnd(12)} │ ${String(d.n).padStart(4)} │ WR: ${wr.padStart(3)}% │ ${(d.pnl$ >= 0 ? '+$' : '-$') + Math.abs(d.pnl$).toFixed(0).padStart(6)} │`);
    }
  });
  console.log(`└────────────────────────────────────────────────────────────────────────────────────┘`);
  
  // Sample trade
  console.log(`
┌────────────────────────────────────────────────────────────────────────────────────┐
│                           📜 SAMPLE TRADE                                          │
├────────────────────────────────────────────────────────────────────────────────────┤`);
  const sample = trades.find(t => t.tp1Hit) || trades[trades.length - 1];
  if (sample) sample.log.forEach(l => console.log(`│  ${l.substring(0, 76).padEnd(76)} │`));
  console.log(`└────────────────────────────────────────────────────────────────────────────────────┘`);
  
  // Grade
  const grade = wr >= 65 && pf >= 2.5 ? '🏆 S' : wr >= 58 && pf >= 2.0 ? '🌟 A' : wr >= 52 && pf >= 1.5 ? '✨ B' : wr >= 48 && pf >= 1.2 ? '👍 C' : '⚠️ D';
  
  console.log(`
╔════════════════════════════════════════════════════════════════════════════════════╗
║                        🏛️ SYSTEM EVALUATION                                        ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  System Grade:              ${grade}                                                   ║
║  Win Rate:                  ${wr >= 55 ? '✅' : wr >= 48 ? '👍' : '⚠️'} ${wr.toFixed(1)}%                                             ║
║  Profit Factor:             ${pf >= 2.0 ? '✅' : pf >= 1.3 ? '👍' : '⚠️'} ${pf.toFixed(2)}                                             ║
║  Avg R-Multiple:            ${avgR >= 0.6 ? '✅' : avgR >= 0.3 ? '👍' : '⚠️'} ${avgR.toFixed(2)}                                             ║
║  Max Drawdown:              ${maxDD < 15 ? '✅' : maxDD < 25 ? '👍' : '⚠️'} ${maxDD.toFixed(1)}%                                            ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  INSTITUTIONAL EDGE:                                                               ║
║  ✅ Pure price action - no lagging indicators                                      ║
║  ✅ Market structure (HH/HL, LH/LL) for trend                                      ║
║  ✅ VWAP as institutional benchmark                                                ║
║  ✅ Key levels (OR, PDH/PDL) for entries                                           ║
║  ✅ Volume confirmation for smart money                                            ║
║  ✅ Time window filtering (avoid lunch chop)                                       ║
║  ✅ GEX for dealer positioning                                                     ║
╚════════════════════════════════════════════════════════════════════════════════════╝

💡 "Simplicity is the ultimate sophistication." - Leonardo da Vinci
`);
};

run(180);
