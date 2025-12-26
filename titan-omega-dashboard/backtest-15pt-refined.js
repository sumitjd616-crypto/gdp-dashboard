#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA - 15+ POINT MOVE DETECTOR (REFINED)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * KEY INSIGHT: Big moves come from GEX IMBALANCE + MOMENTUM + TIME
 * 
 * SIGNAL LOGIC:
 * 1. GEX tells us WHERE dealers must hedge (support/resistance)
 * 2. MOMENTUM tells us which way the move is going
 * 3. TIME tells us when big moves happen (Open, Power Hour)
 * 4. VOLUME confirms institutional participation
 * 
 * ENTRY: When all align, enter with tight stop for high R:R
 * EXIT: Scale out at 15/25/40+ pts
 */

const CONFIG = {
  account: { size: 5000, riskPerTrade: 0.12 },
  targets: { tp1: 15, tp2: 25, tp3: 40 },
  risk: { maxStop: 7, beAt: 6, trailAt: 12 },
};

let seed = 77777;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// Greeks
const normalCDF = (x) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1.0 / (1.0 + p * Math.abs(x) / Math.sqrt(2));
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1.0 + sign * y);
};
const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

// GEX Profile Builder
const buildGEX = (spot, iv = 0.15) => {
  const T = 1 / 365;
  const profile = {
    spot, netGEX: 0, gammaFlip: spot,
    callWall: null, putWall: null,
    regime: 'NEUTRAL', gexByStrike: {},
  };
  
  let minAbsGEX = Infinity, maxCallOI = 0, maxPutOI = 0;
  
  for (let i = -30; i <= 30; i++) {
    const K = Math.round(spot / 5) * 5 + i * 5;
    const dist = Math.abs(K - spot);
    const decay = Math.exp(-dist / 75);
    const isRound = K % 25 === 0;
    const isMajor = K % 50 === 0;
    const baseOI = isMajor ? 9000 : isRound ? 5500 : 2500;
    
    const callOI = Math.floor(baseOI * decay * (K >= spot ? 1.4 : 0.7) * (0.8 + random() * 0.4));
    const putOI = Math.floor(baseOI * decay * (K <= spot ? 1.4 : 0.7) * (0.8 + random() * 0.4));
    
    if (callOI > maxCallOI && K > spot) { maxCallOI = callOI; profile.callWall = K; }
    if (putOI > maxPutOI && K < spot) { maxPutOI = putOI; profile.putWall = K; }
    
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(spot / K) + (0.05 + 0.5 * iv * iv) * T) / (iv * sqrtT);
    const gamma = normalPDF(d1) / (spot * iv * sqrtT);
    
    const callGEX = -gamma * callOI * 100 * spot / 100;
    const putGEX = gamma * putOI * 100 * spot / 100;
    const netGEX = callGEX + putGEX;
    
    profile.gexByStrike[K] = netGEX / 1e9;
    profile.netGEX += netGEX;
    
    if (Math.abs(netGEX) < minAbsGEX && dist < 60) {
      minAbsGEX = Math.abs(netGEX);
      profile.gammaFlip = K;
    }
  }
  
  profile.netGEX /= 1e9;
  const aboveFlip = spot > profile.gammaFlip;
  profile.regime = profile.netGEX > 0.3 ? (aboveFlip ? '+γ' : '+γ<Flip') :
                   profile.netGEX < -0.3 ? (aboveFlip ? '-γ>Flip' : '-γ') : 'γ=0';
  
  return profile;
};

// Price Action
const ATR = (c, n = 14) => {
  if (c.length < n + 1) return 6;
  let s = 0;
  for (let i = c.length - n; i < c.length; i++) {
    s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
  }
  return s / n;
};

const momentum = (c) => {
  if (c.length < 8) return { dir: 'FLAT', str: 0 };
  const last6 = c.slice(-6);
  const bulls = last6.filter(x => x.c > x.o).length;
  const net = last6[5].c - last6[0].o;
  const atr = ATR(c);
  
  if (bulls >= 5 && net > atr * 0.8) return { dir: 'STRONG_UP', str: 0.95 };
  if (bulls >= 4 && net > atr * 0.4) return { dir: 'UP', str: 0.7 };
  if (bulls <= 1 && net < -atr * 0.8) return { dir: 'STRONG_DOWN', str: 0.95 };
  if (bulls <= 2 && net < -atr * 0.4) return { dir: 'DOWN', str: 0.7 };
  return { dir: 'FLAT', str: 0 };
};

const volume = (c) => {
  const recent = c.slice(-10);
  const avg = recent.slice(0, -1).reduce((s, x) => s + x.v, 0) / 9;
  const curr = c[c.length - 1].v;
  return { ratio: curr / avg, high: curr / avg > 1.4, surge: curr / avg > 2 };
};

const time = (ts) => {
  const h = ts.getHours() + ts.getMinutes() / 60;
  if (h >= 9.5 && h < 10.25) return { w: 'OPEN', q: 100, prime: true };
  if (h >= 10.25 && h < 11.25) return { w: 'MID_MORN', q: 70, prime: true };
  if (h >= 11.25 && h < 14) return { w: 'LUNCH', q: 0, prime: false };
  if (h >= 14 && h < 15) return { w: 'AFTERNOON', q: 60, prime: true };
  if (h >= 15 && h < 15.75) return { w: 'POWER', q: 95, prime: true };
  return { w: 'CLOSE', q: 50, prime: false };
};

// Signal Detection
const detect = (candles, i, iv = 0.15) => {
  if (i < 40) return null;
  const recent = candles.slice(Math.max(0, i - 40), i + 1);
  const c = candles[i];
  
  const gex = buildGEX(c.c, iv);
  const mom = momentum(recent);
  const vol = volume(recent);
  const t = time(c.ts);
  const atr = ATR(recent);
  
  // Skip lunch and low quality times
  if (!t.prime || t.q < 50) return null;
  
  let signal = null;
  const tags = [];
  let conf = 0;
  
  const distFlip = c.c - gex.gammaFlip;
  const distCall = gex.callWall ? gex.callWall - c.c : 999;
  const distPut = gex.putWall ? c.c - gex.putWall : 999;
  const negGamma = gex.regime.includes('-γ');
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // LONG SETUPS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // 1. Gamma Squeeze Long: Near/above flip + momentum + volume
  if (distFlip > -5 && distFlip < 15 && mom.dir.includes('UP') && vol.high) {
    signal = { type: 'GAMMA_SQUEEZE_LONG', dir: 'LONG', reason: `Above γ-flip ${gex.gammaFlip}, momentum up` };
    tags.push('⚡ γ-Squeeze');
    conf = 70 + (mom.str * 15) + (vol.surge ? 10 : 0);
  }
  
  // 2. Call Wall Approach: Breaking toward call wall
  if (!signal && distCall < 12 && distCall > 3 && mom.dir.includes('UP') && vol.high) {
    signal = { type: 'CALL_WALL_BREAK', dir: 'LONG', reason: `Breaking to call wall ${gex.callWall}` };
    tags.push('🧱 Wall Break');
    conf = 65 + (mom.str * 15) + (vol.surge ? 10 : 0);
  }
  
  // 3. Negative Gamma Melt-Up: Strong trend in -γ
  if (!signal && negGamma && mom.dir === 'STRONG_UP' && t.q >= 70) {
    signal = { type: 'MELT_UP', dir: 'LONG', reason: `-γ regime + strong momentum = melt-up` };
    tags.push('🔥 Melt-Up');
    conf = 75 + (vol.surge ? 15 : 0);
  }
  
  // 4. Put Wall Bounce: At support with reversal
  if (!signal && distPut < 8 && mom.dir.includes('UP') && vol.high) {
    signal = { type: 'PUT_WALL_BOUNCE', dir: 'LONG', reason: `Bouncing off put wall ${gex.putWall}` };
    tags.push('💎 Support Bounce');
    conf = 68 + (mom.str * 12);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // SHORT SETUPS  
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // 5. Gamma Squeeze Short: Below flip + momentum down
  if (!signal && distFlip < 5 && distFlip > -15 && mom.dir.includes('DOWN') && vol.high) {
    signal = { type: 'GAMMA_SQUEEZE_SHORT', dir: 'SHORT', reason: `Below γ-flip ${gex.gammaFlip}, momentum down` };
    tags.push('⚡ γ-Squeeze');
    conf = 70 + (mom.str * 15) + (vol.surge ? 10 : 0);
  }
  
  // 6. Put Wall Break: Breaking through put wall
  if (!signal && distPut < 12 && distPut > 3 && mom.dir.includes('DOWN') && vol.high) {
    signal = { type: 'PUT_WALL_BREAK', dir: 'SHORT', reason: `Breaking put wall ${gex.putWall}` };
    tags.push('💎 Wall Break');
    conf = 65 + (mom.str * 15) + (vol.surge ? 10 : 0);
  }
  
  // 7. Negative Gamma Waterfall: Strong selling in -γ
  if (!signal && negGamma && mom.dir === 'STRONG_DOWN' && t.q >= 70) {
    signal = { type: 'WATERFALL', dir: 'SHORT', reason: `-γ regime + strong selling = waterfall` };
    tags.push('💧 Waterfall');
    conf = 75 + (vol.surge ? 15 : 0);
  }
  
  // 8. Call Wall Rejection: At resistance with reversal
  if (!signal && distCall < 8 && mom.dir.includes('DOWN') && vol.high) {
    signal = { type: 'CALL_WALL_REJECT', dir: 'SHORT', reason: `Rejecting call wall ${gex.callWall}` };
    tags.push('🧱 Resistance Reject');
    conf = 68 + (mom.str * 12);
  }
  
  if (!signal || conf < 60) return null;
  
  // Add common tags
  tags.push(`📊 ${gex.regime}`);
  if (vol.surge) tags.push('🔊 Surge');
  else if (vol.high) tags.push('📈 Vol');
  tags.push(`⏰ ${t.w}`);
  
  const stopDist = Math.min(CONFIG.risk.maxStop, atr * 1.1);
  const entry = c.c;
  
  return {
    ...signal,
    entry,
    stop: signal.dir === 'LONG' ? entry - stopDist : entry + stopDist,
    tp1: signal.dir === 'LONG' ? entry + CONFIG.targets.tp1 : entry - CONFIG.targets.tp1,
    tp2: signal.dir === 'LONG' ? entry + CONFIG.targets.tp2 : entry - CONFIG.targets.tp2,
    tp3: signal.dir === 'LONG' ? entry + CONFIG.targets.tp3 : entry - CONFIG.targets.tp3,
    risk: stopDist,
    rr: (CONFIG.targets.tp1 / stopDist).toFixed(1),
    conf,
    tags,
    gex,
    bar: c.bar,
  };
};

// Trade Class
class Trade {
  constructor(s) {
    Object.assign(this, s);
    this.phase = 'INIT';
    this.curStop = this.stop;
    this.maxPnL = 0;
    this.bars = 0;
    this.status = 'ACTIVE';
    this.hits = { tp1: false, tp2: false };
    this.log = [`🎯 ${this.type} ${this.dir} @ ${this.entry.toFixed(2)}`];
    this.log.push(`   ${this.reason}`);
    this.log.push(`   ${this.tags.join(' ')}`);
  }
  
  update(c) {
    if (this.status !== 'ACTIVE') return this;
    this.bars++;
    
    const pnl = this.dir === 'LONG' ? c.c - this.entry : this.entry - c.c;
    const maxP = this.dir === 'LONG' ? c.h - this.entry : this.entry - c.l;
    if (maxP > this.maxPnL) this.maxPnL = maxP;
    
    // Stop check
    const stopped = this.dir === 'LONG' ? c.l <= this.curStop : c.h >= this.curStop;
    if (stopped) return this.close(this.curStop, `${this.phase}_STOP`, this.dir === 'LONG' ? this.curStop - this.entry : this.entry - this.curStop);
    
    // TP3 (40 pts)
    if (this.dir === 'LONG' ? c.h >= this.tp3 : c.l <= this.tp3) {
      this.log.push('🏆 TP3 HIT! +40pts FULL TARGET');
      return this.close(this.tp3, 'TP3_FULL', CONFIG.targets.tp3);
    }
    
    // TP2 (25 pts)
    if (!this.hits.tp2 && (this.dir === 'LONG' ? c.h >= this.tp2 : c.l <= this.tp2)) {
      this.hits.tp2 = true;
      this.curStop = this.dir === 'LONG' ? this.entry + 10 : this.entry - 10;
      this.phase = 'RUNNER';
      this.log.push('🎯 TP2 +25pts - Lock +10');
    }
    
    // TP1 (15 pts)
    if (!this.hits.tp1 && (this.dir === 'LONG' ? c.h >= this.tp1 : c.l <= this.tp1)) {
      this.hits.tp1 = true;
      this.curStop = this.dir === 'LONG' ? this.entry + 4 : this.entry - 4;
      this.phase = 'TRAIL';
      this.log.push('✅ TP1 +15pts - Lock +4');
    }
    
    // BE
    if (this.maxPnL >= CONFIG.risk.beAt && this.phase === 'INIT') {
      this.curStop = this.entry + (this.dir === 'LONG' ? 0.5 : -0.5);
      this.phase = 'BE';
      this.log.push(`🔒 BE @ +${this.maxPnL.toFixed(1)}`);
    }
    
    // Trail
    if (this.phase === 'TRAIL' || this.phase === 'RUNNER') {
      const trail = this.dir === 'LONG' ? c.c - (this.phase === 'RUNNER' ? 8 : 5) : c.c + (this.phase === 'RUNNER' ? 8 : 5);
      if ((this.dir === 'LONG' && trail > this.curStop) || (this.dir === 'SHORT' && trail < this.curStop)) this.curStop = trail;
    }
    
    // Time/EOD exit
    if (this.bars >= 45 || c.bar >= 76) return this.close(c.c, this.bars >= 45 ? 'TIME' : 'EOD', pnl);
    
    this.pnl = pnl;
    return this;
  }
  
  close(price, reason, pnl) {
    this.status = 'CLOSED';
    this.exit = price;
    this.exitReason = reason;
    this.finalPnL = pnl;
    this.pnl$ = pnl * 50;
    this.log.push(`${pnl >= 15 ? '🏆' : pnl > 0 ? '✅' : '❌'} ${reason}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}pts ($${this.pnl$.toFixed(0)})`);
    return this;
  }
}

// Data Generation with realistic big moves
const generateData = (days, start = 5950) => {
  const data = [];
  let price = start, trend = 0, vol = 'normal';
  
  for (let d = days; d >= 0; d--) {
    const date = new Date(); date.setDate(date.getDate() - d);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    trend = trend * 0.65 + (random() - 0.47) * 0.004;
    if (random() < 0.12) vol = ['low', 'normal', 'high', 'high'][Math.floor(random() * 4)];
    const vm = { low: 0.4, normal: 1.0, high: 2.2 }[vol];
    const dayOpen = price;
    
    // Daily bias (trending days have bigger moves)
    const dailyBias = (random() - 0.5) * 0.003;
    
    for (let bar = 0; bar < 78; bar++) {
      const h = 9 + Math.floor((30 + bar * 5) / 60);
      const m = (30 + bar * 5) % 60;
      
      // Intraday pattern - Opening and Power Hour have bigger moves
      let iv = 1.0;
      if (bar < 15) iv = 2.2;        // Opening 
      else if (bar > 65) iv = 2.0;   // Power hour
      else if (bar > 58) iv = 1.6;   // Pre-power
      else if (bar > 30 && bar < 48) iv = 0.35; // Lunch dead
      
      // Occasional big moves (10% chance during prime time)
      let bigMove = 1;
      if ((bar < 12 || bar > 60) && random() < 0.08) bigMove = 2.5 + random() * 2;
      
      const baseVol = 0.0007 * vm * iv * bigMove;
      const vwapPull = (dayOpen - price) / dayOpen * 0.01;
      const change = (random() - 0.47 + trend + dailyBias + vwapPull) * baseVol * price;
      
      const open = price;
      const move = change * (1 + random() * 0.4);
      const noise = price * baseVol * random() * 0.25;
      
      let high, low, close;
      if (change >= 0) { close = price + move; high = Math.max(open, close) + noise; low = Math.min(open, close) - noise * 0.3; }
      else { close = price + move; low = Math.min(open, close) - noise; high = Math.max(open, close) + noise * 0.3; }
      
      const volMod = bar < 15 ? 2.8 : bar > 65 ? 2.2 : bar > 30 && bar < 48 ? 0.25 : 1.0;
      price = close;
      
      data.push({
        ts: new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m),
        o: +open.toFixed(2), h: +high.toFixed(2), l: +low.toFixed(2), c: +close.toFixed(2),
        v: Math.floor((1.8e6 + random() * 2.5e6) * volMod * (bigMove > 1 ? 3 : 1)),
        bar,
      });
    }
  }
  return data;
};

// Run
const run = (days = 180) => {
  console.clear();
  console.log(`
╔════════════════════════════════════════════════════════════════════════════════════╗
║       🎯 TITAN OMEGA - 15+ POINT MOVE DETECTOR (REFINED)                           ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  HOW IT WORKS:                                                                     ║
║    📊 GEX = WHERE dealers must hedge (support/resistance)                          ║
║    🔥 MOMENTUM = Which direction the move is going                                 ║
║    ⏰ TIME = When big moves happen (Open, Power Hour)                              ║
║    📈 VOLUME = Confirms institutional participation                                ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  SIGNAL TYPES:                                                                     ║
║    ⚡ Gamma Squeeze  - Near flip + momentum = accelerated move                     ║
║    🧱 Wall Break     - Breaking call/put wall = cascade                            ║
║    🔥 Melt-Up        - -γ + strong buying = dealers chase                          ║
║    💧 Waterfall      - -γ + strong selling = dealers pile on                       ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  TARGETS: TP1=15pts | TP2=25pts | TP3=40pts | Stop=7pts max                        ║
╚════════════════════════════════════════════════════════════════════════════════════╝
`);
  
  console.log('⏳ Generating market data...');
  const candles = generateData(days);
  console.log(`✅ ${candles.length.toLocaleString()} candles | ⏳ Scanning for setups...\n`);
  
  const trades = [];
  let current = null, lastBar = -15, dailyTrades = 0, curDay = null;
  
  for (let i = 40; i < candles.length - 5; i++) {
    const c = candles[i];
    const day = c.ts.toDateString();
    if (day !== curDay) { curDay = day; dailyTrades = 0; }
    
    if (current?.status === 'ACTIVE') {
      current.update(c);
      if (current.status === 'CLOSED') { trades.push(current); lastBar = i; current = null; }
      continue;
    }
    
    if (i - lastBar < 12 || dailyTrades >= 3) continue;
    
    const sig = detect(candles, i);
    if (sig && sig.conf >= 60) { current = new Trade(sig); dailyTrades++; }
  }
  
  // Stats
  const bigWins = trades.filter(t => t.finalPnL >= 15);
  const wins = trades.filter(t => t.finalPnL > 0);
  const losses = trades.filter(t => t.finalPnL <= 0);
  const totalPnL = trades.reduce((s, t) => s + t.finalPnL, 0);
  const totalPnL$ = trades.reduce((s, t) => s + (t.pnl$ || 0), 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.finalPnL, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.finalPnL, 0) / losses.length) : 0;
  const avgBig = bigWins.length ? bigWins.reduce((s, t) => s + t.finalPnL, 0) / bigWins.length : 0;
  const pf = avgLoss > 0 && losses.length ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;
  const wr = trades.length ? wins.length / trades.length * 100 : 0;
  const bigRate = trades.length ? bigWins.length / trades.length * 100 : 0;
  
  let equity = CONFIG.account.size, peak = equity, maxDD = 0;
  const eqCurve = [equity];
  trades.forEach(t => {
    equity += t.pnl$ || 0;
    eqCurve.push(equity);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
  });
  
  // By type
  const byType = {};
  trades.forEach(t => {
    if (!byType[t.type]) byType[t.type] = { n: 0, pnl: 0, wins: 0, big: 0 };
    byType[t.type].n++; byType[t.type].pnl += t.finalPnL;
    if (t.finalPnL > 0) byType[t.type].wins++;
    if (t.finalPnL >= 15) byType[t.type].big++;
  });
  
  console.log(`
┌────────────────────────────────────────────────────────────────────────────────────┐
│                    🎯 15+ POINT MOVE DETECTION RESULTS                             │
├────────────────────────────────────────────────────────────────────────────────────┤
│  Total Signals:            ${String(trades.length).padStart(6)}                                                 │
│  Winning Trades:           ${String(wins.length).padStart(6)}  (${wr.toFixed(1)}% win rate)                         │
│  15+ Point Winners:        ${String(bigWins.length).padStart(6)}  (${bigRate.toFixed(1)}% hit 15pt target)              │
├────────────────────────────────────────────────────────────────────────────────────┤
│  💰 TOTAL P&L:             ${(totalPnL >= 0 ? '+' : '') + totalPnL.toFixed(1).padStart(8)} SPX points                        │
│  💵 DOLLAR P&L:            ${(totalPnL$ >= 0 ? '+$' : '-$') + Math.abs(totalPnL$).toFixed(0).padStart(8)}                                        │
│  💎 Final Account:         $${equity.toFixed(0).padStart(9)} (${((equity / CONFIG.account.size - 1) * 100).toFixed(0)}% return)                  │
├────────────────────────────────────────────────────────────────────────────────────┤
│  Avg Win:                  +${avgWin.toFixed(1).padStart(7)} pts                                         │
│  Avg 15+ pt Win:           +${avgBig.toFixed(1).padStart(7)} pts                                         │
│  Avg Loss:                 -${avgLoss.toFixed(1).padStart(7)} pts                                         │
│  Profit Factor:            ${pf.toFixed(2).padStart(9)}                                                 │
│  Max Drawdown:             ${maxDD.toFixed(1).padStart(8)}%                                                 │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│                         📊 SIGNAL TYPE PERFORMANCE                                 │
├────────────────────────────────────────────────────────────────────────────────────┤`);
  
  const icons = { GAMMA_SQUEEZE_LONG: '⚡📈', GAMMA_SQUEEZE_SHORT: '⚡📉', CALL_WALL_BREAK: '🧱📈', PUT_WALL_BREAK: '💎📉', MELT_UP: '🔥📈', WATERFALL: '💧📉', PUT_WALL_BOUNCE: '💎📈', CALL_WALL_REJECT: '🧱📉' };
  
  Object.entries(byType).sort((a, b) => b[1].pnl - a[1].pnl).forEach(([k, v]) => {
    const icon = icons[k] || '📊';
    const wr = v.n > 0 ? (v.wins / v.n * 100).toFixed(0) : '0';
    const br = v.n > 0 ? (v.big / v.n * 100).toFixed(0) : '0';
    console.log(`│  ${icon} ${k.padEnd(22)} │ ${String(v.n).padStart(3)} │ WR ${wr.padStart(3)}% │ 15pt ${br.padStart(3)}% │ ${(v.pnl >= 0 ? '+' : '') + v.pnl.toFixed(0).padStart(5)}pts │`);
  });
  
  console.log(`└────────────────────────────────────────────────────────────────────────────────────┘`);
  
  // Sample trades
  console.log(`
┌────────────────────────────────────────────────────────────────────────────────────┐
│                           📜 SAMPLE TRADES                                         │
├────────────────────────────────────────────────────────────────────────────────────┤`);
  
  const sample1 = bigWins[0] || wins[0] || trades[0];
  const sample2 = bigWins[1] || wins[1] || trades[1];
  
  if (sample1) sample1.log.forEach(l => console.log(`│  ${l.substring(0, 76).padEnd(76)} │`));
  console.log(`│${'─'.repeat(78)}│`);
  if (sample2) sample2.log.forEach(l => console.log(`│  ${l.substring(0, 76).padEnd(76)} │`));
  
  console.log(`└────────────────────────────────────────────────────────────────────────────────────┘`);
  
  const grade = bigRate >= 35 && pf >= 2.5 ? '🏆 S' : bigRate >= 25 && pf >= 1.8 ? '🌟 A' : bigRate >= 18 && pf >= 1.4 ? '✨ B' : wr >= 40 && pf >= 1.0 ? '👍 C' : '⚠️ D';
  
  console.log(`
╔════════════════════════════════════════════════════════════════════════════════════╗
║                        🎯 SYSTEM GRADE: ${grade}                                       ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  Win Rate:                  ${wr >= 50 ? '✅' : wr >= 40 ? '👍' : '⚠️'} ${wr.toFixed(1)}%                                             ║
║  15+ pt Rate:               ${bigRate >= 25 ? '✅' : bigRate >= 15 ? '👍' : '⚠️'} ${bigRate.toFixed(1)}%                                             ║
║  Profit Factor:             ${pf >= 1.8 ? '✅' : pf >= 1.2 ? '👍' : '⚠️'} ${pf.toFixed(2)}                                             ║
║  Max Drawdown:              ${maxDD < 20 ? '✅' : maxDD < 30 ? '👍' : '⚠️'} ${maxDD.toFixed(1)}%                                            ║
╠════════════════════════════════════════════════════════════════════════════════════╣
║  💡 KEY INSIGHT: GEX tells you WHERE. Momentum tells you WHEN.                     ║
║     When both align during prime time with volume, big moves happen.               ║
╚════════════════════════════════════════════════════════════════════════════════════╝
`);
};

run(180);
