#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA - PRODUCTION BACKTEST WITH ALL FIXES
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * FIXES IMPLEMENTED:
 * ✅ Realistic slippage ($1.50/side = $3 round trip)
 * ✅ Commission costs ($0.65/contract)
 * ✅ Economic calendar filter (Fed/CPI/NFP days excluded)
 * ✅ Conservative time windows only (9:45-10:15, 3:00-3:30)
 * ✅ Friday exclusion (weekend gap risk)
 * ✅ Micro position sizing ($5/pt MES)
 * ✅ Hard daily loss limit ($100)
 * ✅ Max 3 trades per day
 * ✅ 15% max account drawdown lock
 * 
 * This backtest shows REALISTIC expectations, not fantasy returns.
 */

// ═══════════════════════════════════════════════════════════════════════════════════════
// PRODUCTION CONFIGURATION (Same as ProductionGEXSystem.js)
// ═══════════════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Starting capital - MICRO ACCOUNT
  account: {
    starting: 500,
    currency: 'USD',
  },
  
  // REALISTIC COSTS
  costs: {
    slippagePerSide: 1.50,       // $1.50 slippage each way
    commissionPerContract: 0.65, // Per contract per side
    get roundTrip() {
      return (this.slippagePerSide * 2) + (this.commissionPerContract * 2);
    },
  },
  
  // Position sizing - MICRO ONLY
  position: {
    contracts: 1,               // 1 micro contract
    pointValue: 5,              // MES = $5/pt
    maxRiskPerTrade: 50,        // $50 max risk
  },
  
  // Risk management - CONSERVATIVE
  risk: {
    maxStopPoints: 8,           // 8 pt max stop
    breakEvenAt: 6,             // Move to BE at +6
    trailAfter: 10,             // Trail after +10
    maxDailyLoss: 100,          // HARD $100 daily loss limit
    maxDailyTrades: 3,          // Max 3 trades per day
    maxDrawdownPct: 15,         // Lock account at 15% DD
  },
  
  // Targets - REALISTIC
  targets: {
    tp1: 12,                    // +12 pts = $60 gross
    tp2: 20,                    // +20 pts = $100 gross
    tp3: 30,                    // +30 pts = $150 gross
  },
  
  // Time windows - ONLY THE BEST
  time: {
    windows: [
      { start: 9.75, end: 10.25, name: 'OPENING', quality: 100 },
      { start: 15.0, end: 15.5, name: 'POWER', quality: 95 },
    ],
    blockedDays: [5],           // Friday = day 5
    closeAllBy: 15.75,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// ECONOMIC CALENDAR - HIGH IMPACT EVENTS (BLOCKED)
// ═══════════════════════════════════════════════════════════════════════════════════════

const BLOCKED_EVENTS = {
  // These dates are examples - in production, fetch from API
  // Format: 'MM-DD' for recurring, 'YYYY-MM-DD' for specific
  fed: ['01-31', '03-20', '05-01', '06-12', '07-31', '09-18', '11-07', '12-18'],
  cpi: ['01-11', '02-13', '03-12', '04-10', '05-15', '06-12', '07-11', '08-14', '09-11', '10-10', '11-13', '12-11'],
  nfp: ['01-05', '02-02', '03-08', '04-05', '05-03', '06-07', '07-05', '08-02', '09-06', '10-04', '11-01', '12-06'],
};

const isBlockedDate = (date) => {
  const mmdd = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return BLOCKED_EVENTS.fed.includes(mmdd) || 
         BLOCKED_EVENTS.cpi.includes(mmdd) || 
         BLOCKED_EVENTS.nfp.includes(mmdd);
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// RANDOM WITH SEED (for reproducibility)
// ═══════════════════════════════════════════════════════════════════════════════════════

let seed = 123456789;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// ═══════════════════════════════════════════════════════════════════════════════════════
// GEX CALCULATION (Simplified for backtest)
// ═══════════════════════════════════════════════════════════════════════════════════════

const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const buildGEX = (spot, iv = 0.15) => {
  const T = 1 / 365;
  const profile = { spot, netGEX: 0, gammaFlip: spot, callWall: null, putWall: null, regime: 'NEUTRAL' };
  
  let minAbsGEX = Infinity, maxCallOI = 0, maxPutOI = 0;
  
  for (let i = -25; i <= 25; i++) {
    const K = Math.round(spot / 5) * 5 + i * 5;
    const dist = Math.abs(K - spot);
    const decay = Math.exp(-dist / 70);
    const isMajor = K % 50 === 0;
    const baseOI = isMajor ? 8000 : K % 25 === 0 ? 5000 : 2500;
    
    const callOI = Math.floor(baseOI * decay * (K >= spot ? 1.3 : 0.7) * (0.85 + random() * 0.3));
    const putOI = Math.floor(baseOI * decay * (K <= spot ? 1.3 : 0.7) * (0.85 + random() * 0.3));
    
    if (callOI > maxCallOI && K > spot) { maxCallOI = callOI; profile.callWall = K; }
    if (putOI > maxPutOI && K < spot) { maxPutOI = putOI; profile.putWall = K; }
    
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(spot / K) + (0.05 + 0.5 * iv * iv) * T) / (iv * sqrtT);
    const gamma = normalPDF(d1) / (spot * iv * sqrtT);
    
    const netGEX = (-gamma * callOI + gamma * putOI) * 100 * spot / 100;
    profile.netGEX += netGEX;
    
    if (Math.abs(netGEX) < minAbsGEX && dist < 50) {
      minAbsGEX = Math.abs(netGEX);
      profile.gammaFlip = K;
    }
  }
  
  profile.netGEX /= 1e9;
  const aboveFlip = spot > profile.gammaFlip;
  profile.regime = profile.netGEX > 0.3 ? (aboveFlip ? '+γ' : '+γ<') : profile.netGEX < -0.3 ? (aboveFlip ? '-γ>' : '-γ') : 'γ≈0';
  
  return profile;
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// PRICE ACTION (Minimal - no lagging indicators)
// ═══════════════════════════════════════════════════════════════════════════════════════

const ATR = (c, n = 14) => {
  if (c.length < n + 1) return 5;
  let s = 0;
  for (let i = c.length - n; i < c.length; i++) {
    s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
  }
  return s / n;
};

const momentum = (c) => {
  if (c.length < 6) return { dir: 'FLAT', str: 0 };
  const last5 = c.slice(-5);
  const bulls = last5.filter(x => x.c > x.o).length;
  const net = last5[4].c - last5[0].o;
  const atr = ATR(c);
  
  if (bulls >= 4 && net > atr * 0.6) return { dir: 'UP', str: 0.8 };
  if (bulls <= 1 && net < -atr * 0.6) return { dir: 'DOWN', str: 0.8 };
  return { dir: 'FLAT', str: 0 };
};

const volume = (c) => {
  const recent = c.slice(-8);
  const avg = recent.slice(0, -1).reduce((s, x) => s + x.v, 0) / 7;
  const curr = c[c.length - 1].v;
  return { ratio: curr / avg, high: curr / avg > 1.3 };
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// TIME WINDOW CHECK
// ═══════════════════════════════════════════════════════════════════════════════════════

const isInTradingWindow = (ts) => {
  const hour = ts.getHours() + ts.getMinutes() / 60;
  const dayOfWeek = ts.getDay();
  
  // Check blocked days (Friday)
  if (CONFIG.time.blockedDays.includes(dayOfWeek)) return false;
  
  // Check economic calendar
  if (isBlockedDate(ts)) return false;
  
  // Check time windows
  for (const w of CONFIG.time.windows) {
    if (hour >= w.start && hour < w.end) return true;
  }
  
  return false;
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// SIGNAL DETECTION
// ═══════════════════════════════════════════════════════════════════════════════════════

const detect = (candles, i) => {
  if (i < 30) return null;
  const recent = candles.slice(Math.max(0, i - 30), i + 1);
  const c = candles[i];
  
  // TIME FILTER FIRST
  if (!isInTradingWindow(c.ts)) return null;
  
  const gex = buildGEX(c.c);
  const mom = momentum(recent);
  const vol = volume(recent);
  const atr = ATR(recent);
  
  // Need momentum + volume
  if (mom.dir === 'FLAT' || !vol.high) return null;
  
  let signal = null;
  const tags = [];
  
  const distCall = gex.callWall ? gex.callWall - c.c : 999;
  const distPut = gex.putWall ? c.c - gex.putWall : 999;
  const distFlip = c.c - gex.gammaFlip;
  
  // LONG: Near put wall + momentum up + volume
  if (mom.dir === 'UP' && (distPut < 10 || (distFlip > 0 && distFlip < 12))) {
    signal = { type: distPut < 10 ? 'PUT_WALL_BOUNCE' : 'GAMMA_LONG', dir: 'LONG' };
    tags.push(distPut < 10 ? '💎 PutWall' : '⚡ γ-Flip', '📈 Mom', '📊 Vol');
  }
  
  // SHORT: Near call wall + momentum down + volume  
  if (!signal && mom.dir === 'DOWN' && (distCall < 10 || (distFlip < 0 && distFlip > -12))) {
    signal = { type: distCall < 10 ? 'CALL_WALL_REJECT' : 'GAMMA_SHORT', dir: 'SHORT' };
    tags.push(distCall < 10 ? '🧱 CallWall' : '⚡ γ-Flip', '📉 Mom', '📊 Vol');
  }
  
  if (!signal) return null;
  
  const stopDist = Math.min(CONFIG.risk.maxStopPoints, atr * 1.2);
  
  return {
    ...signal,
    entry: c.c,
    stop: signal.dir === 'LONG' ? c.c - stopDist : c.c + stopDist,
    tp1: signal.dir === 'LONG' ? c.c + CONFIG.targets.tp1 : c.c - CONFIG.targets.tp1,
    tp2: signal.dir === 'LONG' ? c.c + CONFIG.targets.tp2 : c.c - CONFIG.targets.tp2,
    risk: stopDist,
    tags,
    gex,
    bar: c.bar,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// TRADE CLASS WITH COSTS
// ═══════════════════════════════════════════════════════════════════════════════════════

class Trade {
  constructor(s) {
    Object.assign(this, s);
    
    // Apply entry slippage
    const slipDir = this.dir === 'LONG' ? 1 : -1;
    this.actualEntry = this.entry + (CONFIG.costs.slippagePerSide / CONFIG.position.pointValue * slipDir);
    
    this.phase = 'INIT';
    this.curStop = this.stop;
    this.maxPnL = 0;
    this.bars = 0;
    this.status = 'ACTIVE';
    this.log = [`🎯 ${this.type} ${this.dir} @ ${this.actualEntry.toFixed(2)} (slip: ${(this.actualEntry - this.entry).toFixed(2)})`];
  }
  
  update(c) {
    if (this.status !== 'ACTIVE') return this;
    this.bars++;
    
    const pnl = this.dir === 'LONG' ? c.c - this.actualEntry : this.actualEntry - c.c;
    const maxP = this.dir === 'LONG' ? c.h - this.actualEntry : this.actualEntry - c.l;
    if (maxP > this.maxPnL) this.maxPnL = maxP;
    
    // Stop hit
    const stopped = this.dir === 'LONG' ? c.l <= this.curStop : c.h >= this.curStop;
    if (stopped) return this.close(this.curStop, `${this.phase}_STOP`, this.dir === 'LONG' ? this.curStop - this.actualEntry : this.actualEntry - this.curStop);
    
    // TP2
    if (this.dir === 'LONG' ? c.h >= this.tp2 : c.l <= this.tp2) {
      return this.close(this.tp2, 'TP2', CONFIG.targets.tp2);
    }
    
    // TP1 - move stop
    if (!this.tp1Hit && (this.dir === 'LONG' ? c.h >= this.tp1 : c.l <= this.tp1)) {
      this.tp1Hit = true;
      this.curStop = this.dir === 'LONG' ? this.actualEntry + 3 : this.actualEntry - 3;
      this.phase = 'TRAIL';
      this.log.push(`✅ TP1 +${CONFIG.targets.tp1} - Lock +3`);
    }
    
    // BE
    if (this.maxPnL >= CONFIG.risk.breakEvenAt && this.phase === 'INIT') {
      this.curStop = this.actualEntry + (this.dir === 'LONG' ? 0.5 : -0.5);
      this.phase = 'BE';
      this.log.push(`🔒 BE @ +${this.maxPnL.toFixed(1)}`);
    }
    
    // Trail
    if (this.phase === 'TRAIL') {
      const trail = this.dir === 'LONG' ? c.c - 4 : c.c + 4;
      if ((this.dir === 'LONG' && trail > this.curStop) || (this.dir === 'SHORT' && trail < this.curStop)) this.curStop = trail;
    }
    
    // Time exit
    if (this.bars >= 35) return this.close(c.c, 'TIME', pnl);
    
    // Must close by 3:45
    const hour = c.ts.getHours() + c.ts.getMinutes() / 60;
    if (hour >= CONFIG.time.closeAllBy) return this.close(c.c, 'EOD', pnl);
    
    this.pnl = pnl;
    return this;
  }
  
  close(price, reason, pnlPoints) {
    // Apply exit slippage
    const slipDir = this.dir === 'LONG' ? -1 : 1;
    const actualExit = price + (CONFIG.costs.slippagePerSide / CONFIG.position.pointValue * slipDir);
    
    const grossPnL = pnlPoints * CONFIG.position.pointValue * CONFIG.position.contracts;
    const costs = CONFIG.costs.roundTrip;
    const netPnL = grossPnL - costs;
    
    this.status = 'CLOSED';
    this.exit = actualExit;
    this.exitReason = reason;
    this.grossPnL = grossPnL;
    this.costs = costs;
    this.netPnL = netPnL;
    
    this.log.push(`${netPnL > 0 ? '✅' : '❌'} ${reason}: Gross ${grossPnL >= 0 ? '+' : ''}$${grossPnL.toFixed(2)} | Costs -$${costs.toFixed(2)} | Net ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`);
    
    return this;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// DATA GENERATION (Simulated - replace with real data in production)
// ═══════════════════════════════════════════════════════════════════════════════════════

const generateData = (days, start = 5950) => {
  const data = [];
  let price = start, trend = 0, vol = 'normal';
  
  for (let d = days; d >= 0; d--) {
    const date = new Date(); date.setDate(date.getDate() - d);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    trend = trend * 0.6 + (random() - 0.48) * 0.003;
    if (random() < 0.1) vol = ['low', 'normal', 'normal', 'high'][Math.floor(random() * 4)];
    const vm = { low: 0.4, normal: 1.0, high: 1.8 }[vol];
    const dayOpen = price;
    
    for (let bar = 0; bar < 78; bar++) {
      const h = 9 + Math.floor((30 + bar * 5) / 60);
      const m = (30 + bar * 5) % 60;
      
      let iv = 1.0;
      if (bar < 12) iv = 1.8;
      else if (bar > 65) iv = 1.6;
      else if (bar > 28 && bar < 48) iv = 0.4;
      
      const baseVol = 0.0005 * vm * iv;
      const vwapPull = (dayOpen - price) / dayOpen * 0.01;
      const change = (random() - 0.48 + trend + vwapPull) * baseVol * price;
      
      const open = price;
      const move = change * (1 + random() * 0.4);
      const noise = price * baseVol * random() * 0.25;
      
      let high, low, close;
      if (change >= 0) { close = price + move; high = Math.max(open, close) + noise; low = Math.min(open, close) - noise * 0.3; }
      else { close = price + move; low = Math.min(open, close) - noise; high = Math.max(open, close) + noise * 0.3; }
      
      const volMod = bar < 12 ? 2.2 : bar > 65 ? 1.8 : bar > 28 && bar < 48 ? 0.3 : 1.0;
      price = close;
      
      data.push({
        ts: new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m),
        o: +open.toFixed(2), h: +high.toFixed(2), l: +low.toFixed(2), c: +close.toFixed(2),
        v: Math.floor((1.5e6 + random() * 2e6) * volMod),
        bar,
      });
    }
  }
  return data;
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// RUN PRODUCTION BACKTEST
// ═══════════════════════════════════════════════════════════════════════════════════════

const run = (days = 180) => {
  console.clear();
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║          🏭 PRODUCTION BACKTEST - WITH ALL REALISTIC FIXES                            ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  ✅ FIXES APPLIED:                                                                    ║
║     • Slippage: $${CONFIG.costs.slippagePerSide}/side ($${CONFIG.costs.roundTrip.toFixed(2)} round-trip)                                   ║
║     • Commission: $${CONFIG.costs.commissionPerContract}/contract                                                   ║
║     • Position: ${CONFIG.position.contracts} MES contract ($${CONFIG.position.pointValue}/pt)                                          ║
║     • Max Stop: ${CONFIG.risk.maxStopPoints} pts ($${CONFIG.risk.maxStopPoints * CONFIG.position.pointValue} risk)                                               ║
║     • Daily Loss Limit: $${CONFIG.risk.maxDailyLoss}                                                        ║
║     • Max Trades/Day: ${CONFIG.risk.maxDailyTrades}                                                            ║
║     • Time Windows: 9:45-10:15 AM, 3:00-3:30 PM only                                  ║
║     • Blocked: Fridays, Fed days, CPI days, NFP days                                  ║
║     • Account Drawdown Lock: ${CONFIG.risk.maxDrawdownPct}%                                                    ║
║                                                                                       ║
║  💰 Starting Capital: $${CONFIG.account.starting}                                                          ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝
`);
  
  console.log('⏳ Generating market data...');
  const candles = generateData(days);
  console.log(`✅ ${candles.length.toLocaleString()} candles | ⏳ Running backtest...\n`);
  
  const trades = [];
  let current = null;
  let lastTradeBar = -20;
  let dailyTrades = 0, dailyPnL = 0, curDay = null;
  let capital = CONFIG.account.starting;
  let isLocked = false;
  let blockedDays = 0, windowSkips = 0, limitSkips = 0;
  
  for (let i = 30; i < candles.length - 5; i++) {
    const c = candles[i];
    const day = c.ts.toDateString();
    
    // Daily reset
    if (day !== curDay) {
      curDay = day;
      dailyTrades = 0;
      dailyPnL = 0;
      isLocked = false;
    }
    
    // Update active trade
    if (current?.status === 'ACTIVE') {
      current.update(c);
      if (current.status === 'CLOSED') {
        trades.push(current);
        capital += current.netPnL;
        dailyPnL += current.netPnL;
        lastTradeBar = i;
        current = null;
        
        // Check daily loss limit
        if (dailyPnL <= -CONFIG.risk.maxDailyLoss) {
          isLocked = true;
        }
        
        // Check account drawdown
        const dd = (CONFIG.account.starting - capital) / CONFIG.account.starting * 100;
        if (dd >= CONFIG.risk.maxDrawdownPct) {
          isLocked = true;
          break; // Stop entire backtest
        }
      }
      continue;
    }
    
    // Skip if locked
    if (isLocked) continue;
    
    // Skip if max daily trades
    if (dailyTrades >= CONFIG.risk.maxDailyTrades) {
      limitSkips++;
      continue;
    }
    
    // Skip if too soon after last trade
    if (i - lastTradeBar < 15) continue;
    
    // Skip blocked dates
    if (isBlockedDate(c.ts)) {
      blockedDays++;
      continue;
    }
    
    // Skip Fridays
    if (c.ts.getDay() === 5) {
      blockedDays++;
      continue;
    }
    
    // Skip outside time windows
    if (!isInTradingWindow(c.ts)) {
      windowSkips++;
      continue;
    }
    
    // Look for signal
    const sig = detect(candles, i);
    if (sig) {
      current = new Trade(sig);
      dailyTrades++;
    }
  }
  
  // Calculate statistics
  const wins = trades.filter(t => t.netPnL > 0);
  const losses = trades.filter(t => t.netPnL <= 0);
  
  const grossTotal = trades.reduce((s, t) => s + t.grossPnL, 0);
  const costsTotal = trades.reduce((s, t) => s + t.costs, 0);
  const netTotal = trades.reduce((s, t) => s + t.netPnL, 0);
  
  const avgWinGross = wins.length ? wins.reduce((s, t) => s + t.grossPnL, 0) / wins.length : 0;
  const avgWinNet = wins.length ? wins.reduce((s, t) => s + t.netPnL, 0) / wins.length : 0;
  const avgLossGross = losses.length ? Math.abs(losses.reduce((s, t) => s + t.grossPnL, 0) / losses.length) : 0;
  const avgLossNet = losses.length ? Math.abs(losses.reduce((s, t) => s + t.netPnL, 0) / losses.length) : 0;
  
  const wr = trades.length ? wins.length / trades.length * 100 : 0;
  const pfGross = avgLossGross > 0 ? (avgWinGross * wins.length) / (avgLossGross * losses.length) : 0;
  const pfNet = avgLossNet > 0 ? (avgWinNet * wins.length) / (avgLossNet * losses.length) : 0;
  
  // Equity curve and drawdown
  let equity = CONFIG.account.starting, peak = equity, maxDD = 0;
  const eqCurve = [equity];
  trades.forEach(t => {
    equity += t.netPnL;
    eqCurve.push(equity);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
  });
  
  // By exit reason
  const byExit = {};
  trades.forEach(t => {
    if (!byExit[t.exitReason]) byExit[t.exitReason] = { n: 0, gross: 0, net: 0 };
    byExit[t.exitReason].n++;
    byExit[t.exitReason].gross += t.grossPnL;
    byExit[t.exitReason].net += t.netPnL;
  });
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║                         📊 PRODUCTION BACKTEST RESULTS                                ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  📈 TRADE STATISTICS                                                                  ║
║  ─────────────────────────────────────────────────────────────────────────────────── ║
║  Total Trades:          ${String(trades.length).padStart(8)}                                                  ║
║  Wins:                  ${String(wins.length).padStart(8)}  (${wr.toFixed(1)}%)                                       ║
║  Losses:                ${String(losses.length).padStart(8)}                                                  ║
║                                                                                       ║
║  💰 P&L ANALYSIS (WITH ALL COSTS)                                                     ║
║  ─────────────────────────────────────────────────────────────────────────────────── ║
║  Gross P&L:             ${(grossTotal >= 0 ? '+$' : '-$') + Math.abs(grossTotal).toFixed(2).padStart(8)}                                        ║
║  Total Costs:           ${('-$' + costsTotal.toFixed(2)).padStart(10)}  (slippage + commission)                ║
║  NET P&L:               ${(netTotal >= 0 ? '+$' : '-$') + Math.abs(netTotal).toFixed(2).padStart(8)}  ← REAL PROFIT                         ║
║                                                                                       ║
║  Final Capital:         $${capital.toFixed(2).padStart(9)}                                               ║
║  Return:                ${((capital / CONFIG.account.starting - 1) * 100).toFixed(1).padStart(8)}%                                               ║
║                                                                                       ║
║  📊 PERFORMANCE METRICS                                                               ║
║  ─────────────────────────────────────────────────────────────────────────────────── ║
║  Avg Win (Net):         +$${avgWinNet.toFixed(2).padStart(7)}                                               ║
║  Avg Loss (Net):        -$${avgLossNet.toFixed(2).padStart(7)}                                               ║
║  Profit Factor (Gross): ${pfGross.toFixed(2).padStart(9)}                                                  ║
║  Profit Factor (Net):   ${pfNet.toFixed(2).padStart(9)}  ← AFTER COSTS                              ║
║  Max Drawdown:          ${maxDD.toFixed(1).padStart(8)}%                                                  ║
║                                                                                       ║
║  🔒 FILTER STATISTICS                                                                 ║
║  ─────────────────────────────────────────────────────────────────────────────────── ║
║  Blocked Days Skipped:  ${String(blockedDays).padStart(8)}  (Fed/CPI/NFP/Friday)                         ║
║  Window Skips:          ${String(windowSkips).padStart(8)}  (outside 9:45-10:15, 3:00-3:30)              ║
║  Limit Skips:           ${String(limitSkips).padStart(8)}  (max 3 trades/day)                            ║
║                                                                                       ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  📋 EXIT REASON BREAKDOWN                                                             ║
║  ─────────────────────────────────────────────────────────────────────────────────── ║`);

  Object.entries(byExit).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => {
    console.log(`║  ${k.padEnd(18)} │ ${String(v.n).padStart(4)} trades │ Gross: ${(v.gross >= 0 ? '+$' : '-$') + Math.abs(v.gross).toFixed(0).padStart(4)} │ Net: ${(v.net >= 0 ? '+$' : '-$') + Math.abs(v.net).toFixed(0).padStart(4)} │`);
  });

  console.log(`║                                                                                       ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  📜 SAMPLE TRADES                                                                     ║
║  ─────────────────────────────────────────────────────────────────────────────────── ║`);

  const samples = [wins[0], losses[0]].filter(Boolean);
  samples.forEach(s => s.log.forEach(l => console.log(`║  ${l.padEnd(83)} ║`)));

  // Determine grade
  const grade = netTotal > 0 && pfNet >= 1.5 && maxDD < 15 ? '🌟 A' :
                netTotal > 0 && pfNet >= 1.2 && maxDD < 20 ? '✨ B' :
                netTotal > 0 && pfNet >= 1.0 ? '👍 C' : '⚠️ D';

  console.log(`║                                                                                       ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  🏆 SYSTEM GRADE: ${grade}                                                                ║
║                                                                                       ║
║  ${netTotal > 0 ? '✅' : '❌'} Net Profitable: ${netTotal >= 0 ? 'Yes' : 'NO'}                                                             ║
║  ${pfNet >= 1.2 ? '✅' : '❌'} Profit Factor ≥1.2: ${pfNet >= 1.2 ? 'Yes' : 'NO'} (${pfNet.toFixed(2)})                                              ║
║  ${maxDD < 20 ? '✅' : '❌'} Max DD < 20%: ${maxDD < 20 ? 'Yes' : 'NO'} (${maxDD.toFixed(1)}%)                                                  ║
║  ${wr >= 40 ? '✅' : '❌'} Win Rate ≥ 40%: ${wr >= 40 ? 'Yes' : 'NO'} (${wr.toFixed(1)}%)                                                 ║
║                                                                                       ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  📋 NEXT STEPS:                                                                       ║
║                                                                                       ║
║  ${netTotal > 0 ? '1. ✅ System is NET profitable after costs' : '1. ❌ System is NOT profitable - DO NOT TRADE'}                                     ║
║  ${netTotal > 0 ? '2. Paper trade for 30 days to verify' : '2. Review entry/exit criteria'}                                            ║
║  ${netTotal > 0 ? '3. If paper trading profitable, start with 1 MES' : '3. Consider different approach'}                                 ║
║  ${netTotal > 0 ? '4. Trade only during approved windows' : ''}                                                 ║
║                                                                                       ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝

💡 COST IMPACT: $${costsTotal.toFixed(2)} in costs reduced gross profit by ${grossTotal > 0 ? ((costsTotal / grossTotal) * 100).toFixed(0) : 'N/A'}%
   This is why realistic backtesting matters!
`);
};

run(180);
