#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA - PRODUCTION V2 (COST-ADJUSTED STRATEGY)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * V1 PROBLEM: $4.30/trade costs destroyed the edge
 * 
 * V2 SOLUTION:
 * ✅ Only take HIGHEST conviction setups (reduce trade count)
 * ✅ Larger targets to overcome costs (need avg win > costs)
 * ✅ Tighter filters but more trades allowed in prime windows
 * ✅ Scale wins - partial at TP1, let rest run
 * ✅ Accept lower win rate, focus on R-multiple
 * 
 * MATH: If costs = $4.30/trade, need avg NET profit > $4.30/trade to be profitable
 *       If win rate = 35%, avg win must be > $17 after costs to break even
 */

const CONFIG = {
  account: { starting: 500 },
  
  // Same realistic costs
  costs: {
    slippagePerSide: 1.50,
    commissionPerContract: 0.65,
    get roundTrip() { return (this.slippagePerSide * 2) + (this.commissionPerContract * 2); },
  },
  
  position: {
    contracts: 1,
    pointValue: 5,
  },
  
  // ADJUSTED: Larger targets to beat costs
  targets: {
    tp1: 8,              // First scale: +8 pts = $40 (close 50%)
    tp2: 16,             // Second scale: +16 pts = $80 (close 30%)
    tp3: 25,             // Runner: +25 pts = $125 (let 20% run)
  },
  
  // ADJUSTED: Wider stop (8 pts) but better R:R
  risk: {
    maxStop: 8,
    beAt: 5,
    trail: 4,
    maxDailyLoss: 100,
    maxDailyTrades: 4,    // Allow more trades
    maxDrawdownPct: 15,
  },
  
  // ADJUSTED: Expanded prime windows
  time: {
    windows: [
      { start: 9.5, end: 10.5, name: 'OPENING' },    // Full opening hour
      { start: 14.5, end: 16, name: 'AFTERNOON' },   // Full afternoon
    ],
    blockedDays: [5],
    closeAllBy: 15.92,
  },
  
  // MINIMUM requirements for trade
  minimums: {
    volumeRatio: 1.2,        // Lowered from 1.3
    momentumBars: 3,         // Need 3+ bars in direction
    distToLevel: 12,         // Within 12 pts of key level
  },
};

let seed = 987654321;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// Economic calendar
const BLOCKED_DATES = new Set([
  '01-31', '03-20', '05-01', '06-12', '07-31', '09-18', '11-07', '12-18', // Fed
  '01-11', '02-13', '03-12', '04-10', '05-15', '06-12', '07-11', '08-14', '09-11', '10-10', '11-13', '12-11', // CPI
]);

const isBlocked = (d) => {
  const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return BLOCKED_DATES.has(mmdd) || d.getDay() === 5;
};

const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const buildGEX = (spot) => {
  const T = 1 / 365, iv = 0.15;
  const profile = { spot, netGEX: 0, gammaFlip: spot, callWall: null, putWall: null };
  let minAbsGEX = Infinity, maxCallOI = 0, maxPutOI = 0;
  
  for (let i = -25; i <= 25; i++) {
    const K = Math.round(spot / 5) * 5 + i * 5;
    const dist = Math.abs(K - spot);
    const decay = Math.exp(-dist / 70);
    const baseOI = K % 50 === 0 ? 8000 : K % 25 === 0 ? 5000 : 2500;
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
  profile.regime = profile.netGEX > 0.3 ? '+γ' : profile.netGEX < -0.3 ? '-γ' : 'γ≈0';
  return profile;
};

const ATR = (c, n = 14) => {
  if (c.length < n + 1) return 5;
  let s = 0;
  for (let i = c.length - n; i < c.length; i++) {
    s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
  }
  return s / n;
};

const momentum = (c) => {
  if (c.length < 6) return { dir: 'FLAT', str: 0, bars: 0 };
  const last6 = c.slice(-6);
  let bullBars = 0, bearBars = 0;
  for (let i = 1; i < last6.length; i++) {
    if (last6[i].c > last6[i-1].c) bullBars++;
    else bearBars++;
  }
  const net = last6[5].c - last6[0].o;
  const atr = ATR(c);
  
  if (bullBars >= CONFIG.minimums.momentumBars && net > atr * 0.5) return { dir: 'UP', str: net / atr, bars: bullBars };
  if (bearBars >= CONFIG.minimums.momentumBars && net < -atr * 0.5) return { dir: 'DOWN', str: Math.abs(net) / atr, bars: bearBars };
  return { dir: 'FLAT', str: 0, bars: 0 };
};

const volume = (c) => {
  const recent = c.slice(-8);
  const avg = recent.slice(0, -1).reduce((s, x) => s + x.v, 0) / 7;
  const curr = c[c.length - 1].v;
  return { ratio: curr / avg, high: curr / avg >= CONFIG.minimums.volumeRatio };
};

const isInWindow = (ts) => {
  if (isBlocked(ts)) return false;
  const h = ts.getHours() + ts.getMinutes() / 60;
  for (const w of CONFIG.time.windows) {
    if (h >= w.start && h < w.end) return true;
  }
  return false;
};

const detect = (candles, i) => {
  if (i < 30) return null;
  const recent = candles.slice(Math.max(0, i - 30), i + 1);
  const c = candles[i];
  
  if (!isInWindow(c.ts)) return null;
  
  const gex = buildGEX(c.c);
  const mom = momentum(recent);
  const vol = volume(recent);
  const atr = ATR(recent);
  
  // STRICT: Need momentum AND volume
  if (mom.dir === 'FLAT' || !vol.high) return null;
  
  const distCall = gex.callWall ? gex.callWall - c.c : 999;
  const distPut = gex.putWall ? c.c - gex.putWall : 999;
  const distFlip = c.c - gex.gammaFlip;
  
  let signal = null;
  
  // LONG: At GEX support with momentum
  if (mom.dir === 'UP') {
    if (distPut < CONFIG.minimums.distToLevel) {
      signal = { type: 'PUT_WALL_BOUNCE', dir: 'LONG', conf: 70 + mom.str * 10 };
    } else if (distFlip > 0 && distFlip < CONFIG.minimums.distToLevel) {
      signal = { type: 'GAMMA_LONG', dir: 'LONG', conf: 65 + mom.str * 10 };
    }
  }
  
  // SHORT: At GEX resistance with momentum
  if (!signal && mom.dir === 'DOWN') {
    if (distCall < CONFIG.minimums.distToLevel) {
      signal = { type: 'CALL_WALL_REJECT', dir: 'SHORT', conf: 70 + mom.str * 10 };
    } else if (distFlip < 0 && distFlip > -CONFIG.minimums.distToLevel) {
      signal = { type: 'GAMMA_SHORT', dir: 'SHORT', conf: 65 + mom.str * 10 };
    }
  }
  
  if (!signal) return null;
  
  const stopDist = Math.min(CONFIG.risk.maxStop, atr * 1.2);
  
  return {
    ...signal,
    entry: c.c,
    stop: signal.dir === 'LONG' ? c.c - stopDist : c.c + stopDist,
    tp1: signal.dir === 'LONG' ? c.c + CONFIG.targets.tp1 : c.c - CONFIG.targets.tp1,
    tp2: signal.dir === 'LONG' ? c.c + CONFIG.targets.tp2 : c.c - CONFIG.targets.tp2,
    tp3: signal.dir === 'LONG' ? c.c + CONFIG.targets.tp3 : c.c - CONFIG.targets.tp3,
    risk: stopDist,
    gex,
    bar: c.bar,
  };
};

class Trade {
  constructor(s) {
    Object.assign(this, s);
    const slipDir = this.dir === 'LONG' ? 1 : -1;
    this.actualEntry = this.entry + (CONFIG.costs.slippagePerSide / CONFIG.position.pointValue * slipDir);
    this.phase = 'INIT';
    this.curStop = this.stop;
    this.maxPnL = 0;
    this.bars = 0;
    this.status = 'ACTIVE';
    this.partials = 0;
    this.log = [`🎯 ${this.type} ${this.dir} @ ${this.actualEntry.toFixed(2)}`];
  }
  
  update(c) {
    if (this.status !== 'ACTIVE') return this;
    this.bars++;
    
    const pnl = this.dir === 'LONG' ? c.c - this.actualEntry : this.actualEntry - c.c;
    const maxP = this.dir === 'LONG' ? c.h - this.actualEntry : this.actualEntry - c.l;
    if (maxP > this.maxPnL) this.maxPnL = maxP;
    
    // Stop
    const stopped = this.dir === 'LONG' ? c.l <= this.curStop : c.h >= this.curStop;
    if (stopped) {
      const stopPnL = this.dir === 'LONG' ? this.curStop - this.actualEntry : this.actualEntry - this.curStop;
      return this.close(this.curStop, `${this.phase}_STOP`, stopPnL);
    }
    
    // TP3 (runner)
    if (this.dir === 'LONG' ? c.h >= this.tp3 : c.l <= this.tp3) {
      return this.close(this.tp3, 'TP3_RUNNER', CONFIG.targets.tp3);
    }
    
    // TP2
    if (!this.tp2Hit && (this.dir === 'LONG' ? c.h >= this.tp2 : c.l <= this.tp2)) {
      this.tp2Hit = true;
      this.partials += 0.3;
      this.curStop = this.dir === 'LONG' ? this.actualEntry + 8 : this.actualEntry - 8;
      this.phase = 'RUNNER';
      this.log.push(`🎯 TP2 +${CONFIG.targets.tp2} - Lock +8`);
    }
    
    // TP1 (first scale)
    if (!this.tp1Hit && (this.dir === 'LONG' ? c.h >= this.tp1 : c.l <= this.tp1)) {
      this.tp1Hit = true;
      this.partials += 0.5;
      this.curStop = this.dir === 'LONG' ? this.actualEntry + 2 : this.actualEntry - 2;
      this.phase = 'SCALED';
      this.log.push(`✅ TP1 +${CONFIG.targets.tp1} - Lock +2`);
    }
    
    // BE
    if (this.maxPnL >= CONFIG.risk.beAt && this.phase === 'INIT') {
      this.curStop = this.actualEntry + (this.dir === 'LONG' ? 0.5 : -0.5);
      this.phase = 'BE';
      this.log.push(`🔒 BE`);
    }
    
    // Trail
    if (this.phase === 'SCALED' || this.phase === 'RUNNER') {
      const trailDist = this.phase === 'RUNNER' ? 6 : CONFIG.risk.trail;
      const trail = this.dir === 'LONG' ? c.c - trailDist : c.c + trailDist;
      if ((this.dir === 'LONG' && trail > this.curStop) || (this.dir === 'SHORT' && trail < this.curStop)) {
        this.curStop = trail;
      }
    }
    
    // Time/EOD
    if (this.bars >= 50) return this.close(c.c, 'TIME', pnl);
    const h = c.ts.getHours() + c.ts.getMinutes() / 60;
    if (h >= CONFIG.time.closeAllBy) return this.close(c.c, 'EOD', pnl);
    
    this.pnl = pnl;
    return this;
  }
  
  close(price, reason, pnlPts) {
    const slipDir = this.dir === 'LONG' ? -1 : 1;
    const actualExit = price + (CONFIG.costs.slippagePerSide / CONFIG.position.pointValue * slipDir);
    
    // Calculate weighted P&L based on partials
    let effectivePnL = pnlPts;
    if (this.partials > 0) {
      // Partial scaling: TP1 @ 50%, TP2 @ 30%, runner @ 20%
      if (this.tp2Hit) {
        effectivePnL = CONFIG.targets.tp1 * 0.5 + CONFIG.targets.tp2 * 0.3 + pnlPts * 0.2;
      } else if (this.tp1Hit) {
        effectivePnL = CONFIG.targets.tp1 * 0.5 + pnlPts * 0.5;
      }
    }
    
    const grossPnL = effectivePnL * CONFIG.position.pointValue * CONFIG.position.contracts;
    const costs = CONFIG.costs.roundTrip;
    const netPnL = grossPnL - costs;
    
    this.status = 'CLOSED';
    this.exit = actualExit;
    this.exitReason = reason;
    this.grossPnL = grossPnL;
    this.costs = costs;
    this.netPnL = netPnL;
    this.log.push(`${netPnL > 0 ? '✅' : '❌'} ${reason}: Net ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`);
    
    return this;
  }
}

const generateData = (days, start = 5950) => {
  const data = [];
  let price = start, trend = 0, vol = 'normal';
  
  for (let d = days; d >= 0; d--) {
    const date = new Date(); date.setDate(date.getDate() - d);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    trend = trend * 0.6 + (random() - 0.47) * 0.004;
    if (random() < 0.1) vol = ['low', 'normal', 'normal', 'high'][Math.floor(random() * 4)];
    const vm = { low: 0.4, normal: 1.0, high: 1.8 }[vol];
    const dayOpen = price;
    
    for (let bar = 0; bar < 78; bar++) {
      const h = 9 + Math.floor((30 + bar * 5) / 60);
      const m = (30 + bar * 5) % 60;
      
      let iv = bar < 12 ? 1.8 : bar > 65 ? 1.6 : bar > 28 && bar < 48 ? 0.4 : 1.0;
      const baseVol = 0.0006 * vm * iv;
      const vwapPull = (dayOpen - price) / dayOpen * 0.01;
      const change = (random() - 0.47 + trend + vwapPull) * baseVol * price;
      
      const open = price;
      const move = change * (1 + random() * 0.4);
      const noise = price * baseVol * random() * 0.25;
      
      let high, low, close;
      if (change >= 0) { close = price + move; high = Math.max(open, close) + noise; low = Math.min(open, close) - noise * 0.3; }
      else { close = price + move; low = Math.min(open, close) - noise; high = Math.max(open, close) + noise * 0.3; }
      
      price = close;
      data.push({
        ts: new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m),
        o: +open.toFixed(2), h: +high.toFixed(2), l: +low.toFixed(2), c: +close.toFixed(2),
        v: Math.floor((1.5e6 + random() * 2e6) * (bar < 12 ? 2.2 : bar > 65 ? 1.8 : bar > 28 && bar < 48 ? 0.3 : 1.0)),
        bar,
      });
    }
  }
  return data;
};

const run = (days = 180) => {
  console.clear();
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║          🏭 PRODUCTION V2 - COST-ADJUSTED STRATEGY                                    ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  Changes from V1:                                                                     ║
║  • Expanded time windows (more opportunities)                                         ║
║  • Larger targets: TP1=+8, TP2=+16, TP3=+25                                           ║
║  • Partial scaling: 50% @ TP1, 30% @ TP2, 20% runner                                 ║
║  • 4 trades/day allowed                                                               ║
║  • Need avg win > $${CONFIG.costs.roundTrip.toFixed(2)} costs to be profitable                                    ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝
`);
  
  const candles = generateData(days);
  console.log(`✅ ${candles.length.toLocaleString()} candles | Running...\n`);
  
  const trades = [];
  let current = null, lastBar = -15, dailyTrades = 0, dailyPnL = 0, curDay = null;
  let capital = CONFIG.account.starting, isLocked = false;
  
  for (let i = 30; i < candles.length - 5; i++) {
    const c = candles[i];
    const day = c.ts.toDateString();
    
    if (day !== curDay) { curDay = day; dailyTrades = 0; dailyPnL = 0; isLocked = false; }
    
    if (current?.status === 'ACTIVE') {
      current.update(c);
      if (current.status === 'CLOSED') {
        trades.push(current);
        capital += current.netPnL;
        dailyPnL += current.netPnL;
        lastBar = i;
        current = null;
        if (dailyPnL <= -CONFIG.risk.maxDailyLoss) isLocked = true;
        const dd = (CONFIG.account.starting - capital) / CONFIG.account.starting * 100;
        if (dd >= CONFIG.risk.maxDrawdownPct) break;
      }
      continue;
    }
    
    if (isLocked || dailyTrades >= CONFIG.risk.maxDailyTrades || i - lastBar < 12) continue;
    
    const sig = detect(candles, i);
    if (sig) { current = new Trade(sig); dailyTrades++; }
  }
  
  // Stats
  const wins = trades.filter(t => t.netPnL > 0);
  const losses = trades.filter(t => t.netPnL <= 0);
  const grossTotal = trades.reduce((s, t) => s + t.grossPnL, 0);
  const costsTotal = trades.reduce((s, t) => s + t.costs, 0);
  const netTotal = trades.reduce((s, t) => s + t.netPnL, 0);
  
  const avgWinNet = wins.length ? wins.reduce((s, t) => s + t.netPnL, 0) / wins.length : 0;
  const avgLossNet = losses.length ? Math.abs(losses.reduce((s, t) => s + t.netPnL, 0) / losses.length) : 0;
  const wr = trades.length ? wins.length / trades.length * 100 : 0;
  const pfNet = avgLossNet > 0 ? (avgWinNet * wins.length) / (avgLossNet * losses.length) : 0;
  
  let equity = CONFIG.account.starting, peak = equity, maxDD = 0;
  trades.forEach(t => { equity += t.netPnL; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, (peak - equity) / peak * 100); });
  
  const byExit = {};
  trades.forEach(t => {
    if (!byExit[t.exitReason]) byExit[t.exitReason] = { n: 0, net: 0 };
    byExit[t.exitReason].n++;
    byExit[t.exitReason].net += t.netPnL;
  });
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║                         📊 PRODUCTION V2 RESULTS                                      ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  Total Trades:          ${String(trades.length).padStart(8)}                                                  ║
║  Wins:                  ${String(wins.length).padStart(8)}  (${wr.toFixed(1)}%)                                       ║
║  Losses:                ${String(losses.length).padStart(8)}                                                  ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  Gross P&L:             ${(grossTotal >= 0 ? '+$' : '-$') + Math.abs(grossTotal).toFixed(2).padStart(8)}                                        ║
║  Total Costs:           ${('-$' + costsTotal.toFixed(2)).padStart(10)}                                              ║
║  NET P&L:               ${(netTotal >= 0 ? '+$' : '-$') + Math.abs(netTotal).toFixed(2).padStart(8)}  ← REAL RESULT                       ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  Final Capital:         $${capital.toFixed(2).padStart(9)}                                               ║
║  Return:                ${((capital / CONFIG.account.starting - 1) * 100).toFixed(1).padStart(8)}%                                               ║
║  Max Drawdown:          ${maxDD.toFixed(1).padStart(8)}%                                                  ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  Avg Win (Net):         +$${avgWinNet.toFixed(2).padStart(7)}                                               ║
║  Avg Loss (Net):        -$${avgLossNet.toFixed(2).padStart(7)}                                               ║
║  Profit Factor (Net):   ${pfNet.toFixed(2).padStart(9)}                                                  ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  EXIT BREAKDOWN:                                                                      ║`);
  
  Object.entries(byExit).sort((a, b) => b[1].net - a[1].net).forEach(([k, v]) => {
    console.log(`║  ${k.padEnd(18)} │ ${String(v.n).padStart(4)} │ Net: ${(v.net >= 0 ? '+$' : '-$') + Math.abs(v.net).toFixed(0).padStart(4)} │`);
  });
  
  const grade = netTotal > 50 && pfNet >= 1.3 ? '🌟 A' : netTotal > 0 && pfNet >= 1.0 ? '✨ B' : netTotal > -25 ? '👍 C' : '⚠️ D';
  
  console.log(`╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  GRADE: ${grade}                                                                          ║
║  ${netTotal > 0 ? '✅' : '❌'} Profitable: ${netTotal > 0 ? 'YES' : 'NO'}   ${pfNet >= 1.0 ? '✅' : '❌'} PF ≥ 1.0: ${pfNet >= 1.0 ? 'YES' : 'NO'}   ${maxDD < 15 ? '✅' : '❌'} DD < 15%: ${maxDD < 15 ? 'YES' : 'NO'}          ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝

${netTotal > 0 ? '✅ SYSTEM IS NET PROFITABLE AFTER ALL COSTS!' : '⚠️ System needs further optimization'}
Cost per trade: $${CONFIG.costs.roundTrip.toFixed(2)} | Total costs: $${costsTotal.toFixed(2)} | Cost impact: ${grossTotal > 0 ? ((costsTotal / grossTotal) * 100).toFixed(0) : 'N/A'}%
`);
  
  // Sample trades
  console.log('📜 SAMPLE WINNING TRADE:');
  const sample = wins.find(w => w.tp1Hit) || wins[0];
  if (sample) sample.log.forEach(l => console.log(`   ${l}`));
};

run(180);
