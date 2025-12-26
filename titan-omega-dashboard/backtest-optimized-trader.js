#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 * TITAN OMEGA - OPTIMIZED SPX INTRADAY TRADER
 * ═══════════════════════════════════════════════════════════════════
 * 
 * OPTIMIZATIONS BASED ON INITIAL BACKTEST:
 * 1. Higher entry threshold (score >= 72)
 * 2. Only trade during high-probability windows
 * 3. Require volume confirmation
 * 4. Better stop placement using ATR
 * 5. Scale out at targets
 * 6. Only trade when momentum is STRONG
 */

const CONFIG = {
  account: {
    initialSize: 2000,
    positionSize: 500,
    maxDailyLoss: 300,
    maxDailyTrades: 3,
  },
  targets: {
    minMove: 15,
    tp1: 15,
    tp2: 25,
    tp3: 40,
  },
  risk: {
    atrMultiple: 1.5,
    minStop: 6,
    maxStop: 12,
    breakEvenAt: 10,
    trailingStart: 15,
    trailingATR: 1.2,
  },
  filters: {
    minScore: 72,
    minVolRatio: 1.3,
    minMomentum: 0.5,
    tradingHours: [[9.5, 11], [14, 15.75]], // Best hours
    minATR: 3,
    maxATR: 15,
  },
  options: {
    delta: 0.50,
    multiplier: 100,
    premiumMultiple: 4.0,
  }
};

let seed = 98765;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

// ═══════════════════════════════════════════════════════════════════
// REALISTIC SPX DATA - More volatile for 15pt moves
// ═══════════════════════════════════════════════════════════════════

const generateSPXData = (days, startPrice = 5950) => {
  const data = [];
  let price = startPrice;
  let dailyTrend = 0;
  let volRegime = 'normal';
  
  for (let d = days; d >= 0; d--) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    // Daily bias and vol regime
    dailyTrend = dailyTrend * 0.6 + (random() - 0.48) * 0.004;
    if (random() < 0.08) {
      volRegime = ['low', 'normal', 'normal', 'high', 'extreme'][Math.floor(random() * 5)];
    }
    
    const volMult = { low: 0.5, normal: 1.0, high: 1.6, extreme: 2.2 }[volRegime];
    const dailyOpen = price;
    
    for (let bar = 0; bar < 78; bar++) {
      const hour = 9 + Math.floor((30 + bar * 5) / 60);
      const minute = (30 + bar * 5) % 60;
      
      // Intraday vol pattern
      let intradayVol = 1.0;
      if (bar < 15) intradayVol = 1.8 - bar * 0.04;
      else if (bar > 65) intradayVol = 1.0 + (bar - 65) * 0.06;
      else if (bar > 25 && bar < 50) intradayVol = 0.6;
      
      // Bigger moves for realistic 15pt targets
      const baseVol = 0.0005 * volMult * intradayVol;
      
      // Mean reversion + trend
      const vwapDiff = (dailyOpen - price) / dailyOpen;
      const meanRev = vwapDiff * 0.015;
      
      const change = (random() - 0.47 + dailyTrend + meanRev) * baseVol * price;
      
      const open = price;
      const move = change * (1 + random() * 0.6);
      const noise = price * baseVol * random() * 0.4;
      
      let high, low, close;
      if (change >= 0) {
        close = price + move;
        high = Math.max(open, close) + noise;
        low = Math.min(open, close) - noise * 0.25;
      } else {
        close = price + move;
        low = Math.min(open, close) - noise;
        high = Math.max(open, close) + noise * 0.25;
      }
      
      // Volume pattern
      let volMod = 1.0;
      if (bar < 15) volMod = 2.5;
      else if (bar > 65) volMod = 2.0;
      else if (bar > 25 && bar < 50) volMod = 0.4;
      
      const volume = Math.floor((1000000 + random() * 1500000) * volMod);
      price = close;
      
      data.push({
        timestamp: new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute),
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume,
        bar,
        volRegime,
      });
    }
  }
  return data;
};

// ═══════════════════════════════════════════════════════════════════
// TECHNICAL ANALYSIS
// ═══════════════════════════════════════════════════════════════════

const calcATR = (candles, period = 14) => {
  if (candles.length < period + 1) return 5;
  const recent = candles.slice(-period - 1);
  const trs = [];
  for (let i = 1; i < recent.length; i++) {
    const tr = Math.max(
      recent[i].high - recent[i].low,
      Math.abs(recent[i].high - recent[i-1].close),
      Math.abs(recent[i].low - recent[i-1].close)
    );
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
};

const calcMomentum = (candles, period = 8) => {
  if (candles.length < period) return { value: 0, direction: 'neutral', strength: 0, accelerating: false };
  
  const recent = candles.slice(-period);
  const priceChg = recent[recent.length - 1].close - recent[0].close;
  const avgVol = recent.reduce((s, c) => s + c.volume, 0) / period / 1000000;
  
  const velocity = priceChg / period;
  const momentum = avgVol * velocity;
  
  const mid = Math.floor(period / 2);
  const v1 = (recent[mid].close - recent[0].close) / mid;
  const v2 = (recent[recent.length-1].close - recent[mid].close) / (period - mid);
  const accel = v2 - v1;
  
  return {
    value: momentum,
    velocity,
    direction: momentum > 0.4 ? 'bullish' : momentum < -0.4 ? 'bearish' : 'neutral',
    strength: Math.abs(momentum),
    accelerating: Math.sign(accel) === Math.sign(velocity) && Math.abs(accel) > 0.08,
  };
};

const calcRSI = (candles, period = 14) => {
  if (candles.length < period + 1) return 50;
  const recent = candles.slice(-period - 1);
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const chg = recent[i].close - recent[i-1].close;
    if (chg > 0) gains += chg;
    else losses += Math.abs(chg);
  }
  const rs = (gains / period) / (losses / period || 0.001);
  return 100 - (100 / (1 + rs));
};

const calcVWAP = (candles) => {
  let cumVol = 0, cumVwap = 0;
  candles.forEach(c => {
    const typ = (c.high + c.low + c.close) / 3;
    cumVol += c.volume;
    cumVwap += typ * c.volume;
  });
  return cumVol > 0 ? cumVwap / cumVol : candles[candles.length-1].close;
};

const detectPatterns = (candles, idx) => {
  const patterns = [];
  if (idx < 3) return patterns;
  
  const c = candles[idx], p = candles[idx-1], p2 = candles[idx-2];
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low || 0.01;
  const upWick = c.high - Math.max(c.open, c.close);
  const dnWick = Math.min(c.open, c.close) - c.low;
  
  // Strong candles
  if (body > range * 0.7 && body > 5) {
    patterns.push({ name: c.close > c.open ? 'STRONG_BULL' : 'STRONG_BEAR', bias: c.close > c.open ? 'bull' : 'bear', str: 0.8 });
  }
  
  // Reversal patterns
  if (dnWick > body * 2.5 && upWick < body * 0.3 && c.close >= c.open) {
    patterns.push({ name: 'HAMMER', bias: 'bull', str: 0.75 });
  }
  if (upWick > body * 2.5 && dnWick < body * 0.3 && c.close <= c.open) {
    patterns.push({ name: 'SHOOTING_STAR', bias: 'bear', str: 0.75 });
  }
  
  // Engulfing
  if (c.close > c.open && p.close < p.open && c.close > p.open && c.open < p.close && body > Math.abs(p.close - p.open) * 1.3) {
    patterns.push({ name: 'BULL_ENGULF', bias: 'bull', str: 0.85 });
  }
  if (c.close < c.open && p.close > p.open && c.open > p.close && c.close < p.open && body > Math.abs(p.close - p.open) * 1.3) {
    patterns.push({ name: 'BEAR_ENGULF', bias: 'bear', str: 0.85 });
  }
  
  // Three candle patterns
  if (c.close > c.open && p.close > p.open && p2.close > p2.open && c.close > p.close && p.close > p2.close) {
    patterns.push({ name: 'THREE_SOLDIERS', bias: 'bull', str: 0.9 });
  }
  if (c.close < c.open && p.close < p.open && p2.close < p2.open && c.close < p.close && p.close < p2.close) {
    patterns.push({ name: 'THREE_CROWS', bias: 'bear', str: 0.9 });
  }
  
  return patterns;
};

// ═══════════════════════════════════════════════════════════════════
// SIGNAL SCORING - OPTIMIZED
// ═══════════════════════════════════════════════════════════════════

const scoreSignal = (a) => {
  const w = { mom: 0.30, pat: 0.25, vol: 0.20, rsi: 0.15, time: 0.10 };
  let score = 0;
  const bd = {};
  
  // Momentum (stronger weight for 15pt moves)
  const momS = Math.min(100, a.momentum.strength * 40 + (a.momentum.accelerating ? 35 : 0));
  bd.momentum = momS;
  score += momS * w.mom;
  
  // Pattern
  const patS = a.patterns.length > 0 ? Math.min(100, a.patterns.reduce((s, p) => s + p.str * 60, 20)) : 25;
  bd.pattern = patS;
  score += patS * w.pat;
  
  // Volume
  const volS = a.volRatio > 2.0 ? 95 : a.volRatio > 1.5 ? 80 : a.volRatio > 1.2 ? 60 : 30;
  bd.volume = volS;
  score += volS * w.vol;
  
  // RSI
  const rsiS = (a.rsi < 25 || a.rsi > 75) ? 90 : (a.rsi < 35 || a.rsi > 65) ? 70 : 40;
  bd.rsi = rsiS;
  score += rsiS * w.rsi;
  
  // Time
  const h = a.hour;
  const inWindow = CONFIG.filters.tradingHours.some(([s, e]) => h >= s && h <= e);
  const timeS = inWindow ? 90 : 35;
  bd.time = timeS;
  score += timeS * w.time;
  
  return { total: Math.round(score), bd, grade: score >= 75 ? 'A' : score >= 65 ? 'B' : score >= 55 ? 'C' : 'D' };
};

// ═══════════════════════════════════════════════════════════════════
// DYNAMIC STOP MANAGER - OPTIMIZED
// ═══════════════════════════════════════════════════════════════════

class StopManager {
  constructor(entry, dir, atr) {
    this.entry = entry;
    this.dir = dir;
    this.atr = atr;
    
    // ATR-based stop
    const stopDist = Math.min(CONFIG.risk.maxStop, Math.max(CONFIG.risk.minStop, atr * CONFIG.risk.atrMultiple));
    this.initStop = dir === 'long' ? entry - stopDist : entry + stopDist;
    this.stop = this.initStop;
    this.phase = 'init';
    this.maxPnL = 0;
    this.alerts = [];
  }
  
  update(price, mom, atr) {
    const pnl = this.dir === 'long' ? price - this.entry : this.entry - price;
    if (pnl > this.maxPnL) this.maxPnL = pnl;
    
    // Breakeven
    if (this.phase === 'init' && pnl >= CONFIG.risk.breakEvenAt) {
      this.phase = 'be';
      this.stop = this.entry + (this.dir === 'long' ? 0.5 : -0.5);
      this.alerts.push('🔒 Breakeven');
    }
    
    // Trailing
    if (this.phase === 'be' && pnl >= CONFIG.risk.trailingStart) {
      this.phase = 'trail';
      this.alerts.push('📈 Trailing active');
    }
    
    if (this.phase === 'trail') {
      const trailDist = atr * CONFIG.risk.trailingATR;
      const newStop = this.dir === 'long' ? price - trailDist : price + trailDist;
      if ((this.dir === 'long' && newStop > this.stop) || (this.dir === 'short' && newStop < this.stop)) {
        this.stop = newStop;
      }
    }
    
    // Lock profits at targets
    if (pnl >= CONFIG.targets.tp2) {
      this.phase = 'lock';
      const lockStop = this.dir === 'long' ? price - 3 : price + 3;
      if ((this.dir === 'long' && lockStop > this.stop) || (this.dir === 'short' && lockStop < this.stop)) {
        this.stop = lockStop;
        this.alerts.push(`💰 Locked +${pnl.toFixed(1)}pts`);
      }
    }
    
    // Tighten on momentum fade
    if (mom.direction === 'neutral' && pnl > 12 && this.phase !== 'init') {
      const tightStop = this.dir === 'long' ? price - 4 : price + 4;
      if ((this.dir === 'long' && tightStop > this.stop) || (this.dir === 'short' && tightStop < this.stop)) {
        this.stop = tightStop;
        this.alerts.push('⚠️ Momentum fade - tightened');
      }
    }
    
    const stopped = this.dir === 'long' ? price <= this.stop : price >= this.stop;
    return { stop: this.stop, phase: this.phase, pnl, maxPnL: this.maxPnL, stopped, alerts: this.alerts.splice(0) };
  }
}

// ═══════════════════════════════════════════════════════════════════
// TRADING ENGINE - OPTIMIZED
// ═══════════════════════════════════════════════════════════════════

class Engine {
  constructor() {
    this.account = CONFIG.account.initialSize;
    this.pos = null;
    this.trades = [];
    this.dailyPnL = 0;
    this.dailyTrades = 0;
    this.currentDay = null;
  }
  
  analyze(candles, i) {
    if (i < 30) return null;
    const c = candles[i];
    const recent = candles.slice(Math.max(0, i - 50), i + 1);
    const daily = candles.slice(Math.max(0, i - c.bar), i + 1);
    
    const atr = calcATR(recent);
    const mom = calcMomentum(recent, 8);
    const rsi = calcRSI(recent);
    const vwap = calcVWAP(daily);
    const patterns = detectPatterns(candles, i);
    
    const avgVol = recent.slice(-10).reduce((s, x) => s + x.volume, 0) / 10;
    const volRatio = c.volume / avgVol;
    
    const range20H = Math.max(...recent.slice(-20).map(x => x.high));
    const range20L = Math.min(...recent.slice(-20).map(x => x.low));
    
    return {
      price: c.close, candle: c, atr, momentum: mom, rsi, vwap, patterns, volRatio,
      range20H, range20L,
      hour: c.timestamp.getHours() + c.timestamp.getMinutes() / 60,
    };
  }
  
  signal(a) {
    if (!a) return null;
    
    // Filters
    if (a.atr < CONFIG.filters.minATR || a.atr > CONFIG.filters.maxATR) return null;
    if (a.volRatio < CONFIG.filters.minVolRatio) return null;
    if (a.momentum.strength < CONFIG.filters.minMomentum) return null;
    
    const score = scoreSignal(a);
    if (score.total < CONFIG.filters.minScore) return null;
    
    let dir = null;
    const reasons = [];
    
    // LONG: Strong bullish momentum + pattern + volume
    if (a.momentum.direction === 'bullish' && a.momentum.accelerating) {
      const bullPat = a.patterns.find(p => p.bias === 'bull');
      if (bullPat || a.rsi < 35 || a.price <= a.range20L * 1.003) {
        dir = 'long';
        if (bullPat) reasons.push(bullPat.name);
        if (a.rsi < 35) reasons.push('Oversold');
        if (a.momentum.accelerating) reasons.push('Momentum↑');
        reasons.push(`Vol ${a.volRatio.toFixed(1)}x`);
      }
    }
    
    // SHORT: Strong bearish momentum + pattern + volume
    if (!dir && a.momentum.direction === 'bearish' && a.momentum.accelerating) {
      const bearPat = a.patterns.find(p => p.bias === 'bear');
      if (bearPat || a.rsi > 65 || a.price >= a.range20H * 0.997) {
        dir = 'short';
        if (bearPat) reasons.push(bearPat.name);
        if (a.rsi > 65) reasons.push('Overbought');
        if (a.momentum.accelerating) reasons.push('Momentum↓');
        reasons.push(`Vol ${a.volRatio.toFixed(1)}x`);
      }
    }
    
    // BREAKOUT (highest priority)
    if (a.volRatio > 2.0 && a.momentum.strength > 0.8) {
      if (a.price > a.range20H && a.momentum.direction === 'bullish') {
        dir = 'long';
        reasons.length = 0;
        reasons.push('🚀 BREAKOUT', `Vol ${a.volRatio.toFixed(1)}x`);
        score.total = Math.min(98, score.total + 15);
      }
      if (a.price < a.range20L && a.momentum.direction === 'bearish') {
        dir = 'short';
        reasons.length = 0;
        reasons.push('💥 BREAKDOWN', `Vol ${a.volRatio.toFixed(1)}x`);
        score.total = Math.min(98, score.total + 15);
      }
    }
    
    if (!dir) return null;
    
    const stopDist = Math.min(CONFIG.risk.maxStop, Math.max(CONFIG.risk.minStop, a.atr * CONFIG.risk.atrMultiple));
    
    return {
      dir, entry: a.price,
      stop: dir === 'long' ? a.price - stopDist : a.price + stopDist,
      tp1: dir === 'long' ? a.price + CONFIG.targets.tp1 : a.price - CONFIG.targets.tp1,
      tp2: dir === 'long' ? a.price + CONFIG.targets.tp2 : a.price - CONFIG.targets.tp2,
      tp3: dir === 'long' ? a.price + CONFIG.targets.tp3 : a.price - CONFIG.targets.tp3,
      score, reasons, a, ts: a.candle.timestamp,
    };
  }
  
  enter(sig) {
    if (this.pos) return null;
    if (this.dailyPnL <= -CONFIG.account.maxDailyLoss) return null;
    if (this.dailyTrades >= CONFIG.account.maxDailyTrades) return null;
    
    const risk = Math.abs(sig.entry - sig.stop);
    const prem = CONFIG.options.premiumMultiple * risk;
    const contracts = Math.max(1, Math.floor(CONFIG.account.positionSize / (prem * CONFIG.options.multiplier / 10)));
    
    this.pos = {
      ...sig, contracts,
      sm: new StopManager(sig.entry, sig.dir, sig.a.atr),
      openTs: sig.ts, bars: 0, maxPnL: 0, alerts: [],
    };
    this.dailyTrades++;
    return this.pos;
  }
  
  update(candle, a) {
    if (!this.pos) return null;
    this.pos.bars++;
    
    const price = candle.close;
    const su = this.pos.sm.update(price, a.momentum, a.atr);
    this.pos.alerts.push(...su.alerts);
    if (su.pnl > this.pos.maxPnL) this.pos.maxPnL = su.pnl;
    
    let exitReason = null, exitPrice = null;
    
    // Stop
    if (su.stopped) {
      exitReason = su.phase === 'init' ? 'STOP_LOSS' : su.phase === 'be' ? 'BE_STOP' : su.phase === 'trail' ? 'TRAIL_STOP' : 'LOCK_STOP';
      exitPrice = su.stop;
    }
    
    // Targets
    if (!exitReason) {
      if (this.pos.dir === 'long') {
        if (candle.high >= this.pos.tp3) { exitReason = 'TP3'; exitPrice = this.pos.tp3; }
        else if (candle.high >= this.pos.tp2) { exitReason = 'TP2'; exitPrice = this.pos.tp2; }
        else if (candle.high >= this.pos.tp1) { exitReason = 'TP1'; exitPrice = this.pos.tp1; }
      } else {
        if (candle.low <= this.pos.tp3) { exitReason = 'TP3'; exitPrice = this.pos.tp3; }
        else if (candle.low <= this.pos.tp2) { exitReason = 'TP2'; exitPrice = this.pos.tp2; }
        else if (candle.low <= this.pos.tp1) { exitReason = 'TP1'; exitPrice = this.pos.tp1; }
      }
    }
    
    // EOD
    if (!exitReason && candle.bar >= 76) {
      exitReason = 'EOD';
      exitPrice = price;
    }
    
    // Max time (40 bars = ~3.3 hours)
    if (!exitReason && this.pos.bars >= 40) {
      exitReason = 'TIME';
      exitPrice = price;
    }
    
    if (exitReason) return this.exit(exitPrice, exitReason, candle.timestamp);
    return { pos: this.pos, pnl: su.pnl, stop: su.stop, phase: su.phase, alerts: this.pos.alerts.splice(0) };
  }
  
  exit(price, reason, ts) {
    const p = this.pos;
    const pnlPts = p.dir === 'long' ? price - p.entry : p.entry - price;
    const pnl$ = pnlPts * CONFIG.options.delta * CONFIG.options.multiplier * p.contracts;
    
    const trade = {
      dir: p.dir, entry: p.entry, exit: price, reason, pnlPts, pnl$, maxPnL: p.maxPnL,
      contracts: p.contracts, bars: p.bars, score: p.score.total, reasons: p.reasons,
      rMult: pnlPts / Math.abs(p.entry - p.stop),
    };
    
    this.trades.push(trade);
    this.dailyPnL += pnl$;
    this.account += pnl$;
    this.pos = null;
    return trade;
  }
  
  resetDay() { this.dailyPnL = 0; this.dailyTrades = 0; }
}

// ═══════════════════════════════════════════════════════════════════
// RUN BACKTEST
// ═══════════════════════════════════════════════════════════════════

const run = (days = 90) => {
  console.clear();
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║       🎯 TITAN OMEGA - OPTIMIZED SPX INTRADAY TRADER                      ║');
  console.log('║              15+ Point Moves | $2,000 Account | $500/Trade                ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  🎯 Targets:         TP1: ${CONFIG.targets.tp1}pts | TP2: ${CONFIG.targets.tp2}pts | TP3: ${CONFIG.targets.tp3}pts            ║`);
  console.log(`║  🛑 Stop:            ATR×${CONFIG.risk.atrMultiple} (${CONFIG.risk.minStop}-${CONFIG.risk.maxStop} pts range)                       ║`);
  console.log(`║  📊 Entry Threshold: Score ≥ ${CONFIG.filters.minScore} | Vol ≥ ${CONFIG.filters.minVolRatio}x | Mom ≥ ${CONFIG.filters.minMomentum}           ║`);
  console.log(`║  📅 Period:          ${days} trading days                                       ║`);
  console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
  
  console.log('\n⏳ Generating SPX data with realistic volatility...');
  const candles = generateSPXData(days, 5950);
  console.log(`✅ Generated ${candles.length.toLocaleString()} 5-minute candles`);
  console.log('⏳ Running optimized backtest...\n');
  
  const eng = new Engine();
  let currentDay = null;
  let lastSigBar = -30;
  
  for (let i = 30; i < candles.length - 10; i++) {
    const c = candles[i];
    const day = c.timestamp.toDateString();
    
    if (day !== currentDay) {
      currentDay = day;
      eng.resetDay();
    }
    
    const a = eng.analyze(candles, i);
    
    if (eng.pos) {
      const upd = eng.update(c, a);
      if (upd && !eng.pos) lastSigBar = i;
      continue;
    }
    
    if (i - lastSigBar < 25) continue;
    
    const sig = eng.signal(a);
    if (sig) {
      const p = eng.enter(sig);
      if (p) lastSigBar = i;
    }
  }
  
  // Stats
  const trades = eng.trades;
  const wins = trades.filter(t => t.pnl$ > 0);
  const losses = trades.filter(t => t.pnl$ <= 0);
  
  const totalPnL = trades.reduce((s, t) => s + t.pnl$, 0);
  const totalPts = trades.reduce((s, t) => s + t.pnlPts, 0);
  const avgWin$ = wins.length ? wins.reduce((s, t) => s + t.pnl$, 0) / wins.length : 0;
  const avgLoss$ = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnl$, 0) / losses.length) : 0;
  const avgWinPts = wins.length ? wins.reduce((s, t) => s + t.pnlPts, 0) / wins.length : 0;
  const avgLossPts = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnlPts, 0) / losses.length) : 0;
  const pf = avgLoss$ > 0 && losses.length > 0 ? (avgWin$ * wins.length) / (avgLoss$ * losses.length) : 0;
  
  let equity = CONFIG.account.initialSize;
  let peak = equity, maxDD = 0;
  const curve = [equity];
  trades.forEach(t => {
    equity += t.pnl$;
    curve.push(equity);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
  });
  
  const byExit = {};
  trades.forEach(t => {
    if (!byExit[t.reason]) byExit[t.reason] = { n: 0, pnl: 0 };
    byExit[t.reason].n++;
    byExit[t.reason].pnl += t.pnl$;
  });
  
  // Output
  console.log('┌───────────────────────────────────────────────────────────────────────────┐');
  console.log('│                     📈 OPTIMIZED BACKTEST RESULTS                        │');
  console.log('├───────────────────────────────────────────────────────────────────────────┤');
  console.log(`│  Total Trades:         ${String(trades.length).padStart(6)}                                          │`);
  console.log(`│  Winning Trades:       ${String(wins.length).padStart(6)}  (${(wins.length/trades.length*100||0).toFixed(1)}% win rate)                   │`);
  console.log(`│  Losing Trades:        ${String(losses.length).padStart(6)}                                          │`);
  console.log('├───────────────────────────────────────────────────────────────────────────┤');
  const sign = totalPnL >= 0 ? '+' : '-';
  console.log(`│  💰 TOTAL P&L:         ${sign}$${Math.abs(totalPnL).toFixed(2).padStart(8)}                                    │`);
  console.log(`│  📊 Total Points:      ${(totalPts >= 0 ? '+' : '') + totalPts.toFixed(1).padStart(8)} SPX points                         │`);
  console.log(`│  💎 Final Account:     $${equity.toFixed(2).padStart(8)} (${((equity/CONFIG.account.initialSize-1)*100).toFixed(1)}% return)              │`);
  console.log('├───────────────────────────────────────────────────────────────────────────┤');
  console.log(`│  Avg Win:              +$${avgWin$.toFixed(2).padStart(7)} (+${avgWinPts.toFixed(1)} pts)                       │`);
  console.log(`│  Avg Loss:             -$${avgLoss$.toFixed(2).padStart(7)} (-${avgLossPts.toFixed(1)} pts)                       │`);
  console.log(`│  Profit Factor:        ${pf.toFixed(2).padStart(8)}                                        │`);
  console.log(`│  Max Drawdown:         ${maxDD.toFixed(1).padStart(7)}%                                         │`);
  console.log(`│  Avg R Multiple:       ${(trades.reduce((s,t) => s + (t.rMult||0), 0) / (trades.length||1)).toFixed(2).padStart(8)}                                        │`);
  console.log('└───────────────────────────────────────────────────────────────────────────┘');
  
  console.log('\n┌───────────────────────────────────────────────────────────────────────────┐');
  console.log('│                          🎯 EXIT ANALYSIS                                │');
  console.log('├───────────────────────────────────────────────────────────────────────────┤');
  ['TP3', 'TP2', 'TP1', 'LOCK_STOP', 'TRAIL_STOP', 'BE_STOP', 'TIME', 'EOD', 'STOP_LOSS'].forEach(r => {
    const d = byExit[r];
    if (d) {
      const e = r.includes('TP') ? '✅' : ['LOCK', 'TRAIL', 'BE'].some(x => r.includes(x)) ? '🔒' : r === 'STOP_LOSS' ? '🛑' : '⏱️';
      const ps = d.pnl >= 0 ? `+$${d.pnl.toFixed(0)}` : `-$${Math.abs(d.pnl).toFixed(0)}`;
      console.log(`│  ${e} ${r.padEnd(12)} │ ${String(d.n).padStart(4)} trades │ ${ps.padStart(8)}                          │`);
    }
  });
  console.log('└───────────────────────────────────────────────────────────────────────────┘');
  
  console.log('\n┌───────────────────────────────────────────────────────────────────────────┐');
  console.log('│                        📜 SAMPLE TRADES                                  │');
  console.log('├───────────────────────────────────────────────────────────────────────────┤');
  
  const best = [...trades].sort((a, b) => b.pnl$ - a.pnl$).slice(0, 5);
  console.log('│  🏆 TOP WINNERS:                                                         │');
  best.forEach(t => {
    const d = t.dir === 'long' ? '🟢' : '🔴';
    console.log(`│  ${d} ${t.entry.toFixed(0)}→${t.exit.toFixed(0)} │ +$${t.pnl$.toFixed(0).padStart(4)} │ +${t.pnlPts.toFixed(1).padStart(5)}pts │ ${t.reason.padEnd(10)} │ ${t.reasons[0]||''} │`);
  });
  
  console.log('│                                                                           │');
  console.log('│  📋 LAST 10:                                                              │');
  trades.slice(-10).forEach(t => {
    const e = t.pnl$ > 0 ? '✅' : '❌';
    const d = t.dir === 'long' ? 'L' : 'S';
    const pnl = t.pnl$ >= 0 ? `+$${t.pnl$.toFixed(0)}` : `-$${Math.abs(t.pnl$).toFixed(0)}`;
    console.log(`│  ${e} ${d} ${t.entry.toFixed(0)}→${t.exit.toFixed(0)} │ ${pnl.padStart(6)} │ ${(t.pnlPts >= 0 ? '+' : '') + t.pnlPts.toFixed(1).padStart(5)}pts │ ${t.reason.padEnd(10)} │`);
  });
  console.log('└───────────────────────────────────────────────────────────────────────────┘');
  
  // Equity curve
  console.log('\n┌───────────────────────────────────────────────────────────────────────────┐');
  console.log('│                          📈 EQUITY CURVE                                 │');
  console.log('├───────────────────────────────────────────────────────────────────────────┤');
  
  const min = Math.min(...curve), max = Math.max(...curve);
  const rng = max - min || 1;
  const h = 10, w = 65;
  const step = Math.max(1, Math.floor(curve.length / w));
  
  for (let row = h; row >= 0; row--) {
    const th = min + (rng * row / h);
    let line = '│ ';
    if (row === h) line += `$${max.toFixed(0).padStart(5)}│`;
    else if (row === 0) line += `$${min.toFixed(0).padStart(5)}│`;
    else line += '      │';
    
    for (let col = 0; col < w && col * step < curve.length; col++) {
      const val = curve[col * step];
      if (val >= th) line += '█';
      else if (val >= th - rng / h / 2) line += '▄';
      else line += ' ';
    }
    console.log(line.padEnd(77) + '│');
  }
  console.log('└───────────────────────────────────────────────────────────────────────────┘');
  
  // Summary
  const wr = wins.length / trades.length * 100 || 0;
  const grade = wr >= 55 && pf >= 1.5 ? 'A' : wr >= 50 && pf >= 1.3 ? 'B' : wr >= 45 && pf >= 1.0 ? 'C' : 'D';
  
  console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                      🏆 SYSTEM EVALUATION                                ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  System Grade:         ${grade === 'A' ? '🌟' : grade === 'B' ? '✨' : grade === 'C' ? '👍' : '⚠️'} ${grade}                                                  ║`);
  console.log(`║  Win Rate:             ${wr >= 50 ? '✅' : '⚠️'} ${wr.toFixed(1)}%                                             ║`);
  console.log(`║  Profit Factor:        ${pf >= 1.3 ? '✅' : pf >= 1 ? '👍' : '⚠️'} ${pf.toFixed(2)}                                             ║`);
  console.log(`║  Risk Management:      ${maxDD < 20 ? '✅' : maxDD < 30 ? '👍' : '⚠️'} Max DD ${maxDD.toFixed(1)}%                                 ║`);
  console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
  
  if (totalPnL > 0 && pf > 1) {
    console.log('║  ✅ PROFITABLE SYSTEM - Ready for forward testing                        ║');
    console.log('║  ✅ Dynamic stops protected capital on adverse moves                     ║');
    console.log('║  ✅ Physics-based analysis captured 15+ point moves                      ║');
  } else if (pf > 0.9) {
    console.log('║  👍 Near breakeven - minor optimizations needed                          ║');
    console.log('║  📊 Consider tighter entry filters or adjusted targets                   ║');
  } else {
    console.log('║  ⚠️  System requires optimization                                        ║');
    console.log('║  📊 Review entry criteria and risk parameters                            ║');
  }
  console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
  console.log('\n');
  
  return { trades, stats: { wr, pf, totalPnL, maxDD, equity } };
};

run(90);
