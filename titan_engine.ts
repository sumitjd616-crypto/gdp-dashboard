/**
 * TITAN PHYSICS ENGINE v2.5 FINAL
 * 
 * Final Gemini Fixes:
 * 1. POST-GAP WARMUP - Disable scenarios for 3 ticks after data gap
 * 2. SURGICAL IV CRUSH - Vega-weighted, not binary penalty
 * 3. ES DEADZONE FIX - 0.15 threshold for grind detection
 * 4. THETA INTEGRATION - Vega/Theta ratio in position sizing
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

export const CONFIG = {
  SIGMA_BASE: 10, SIGMA_MIN: 2, SIGMA_MAX: 30,
  VIX_BASELINE: 15, VIX_EXPONENT: 1.5,
  GEX_SIGNIFICANCE: 1e9, REPULSION_ZONE: 5, TOUCH_DECAY: 0.66,
  VACUUM_DISTANCE: 5, VACUUM_REPULSION: -1.2,
  FLIP_ZONE: 5, KILL_ZONE_KE: 30,
  EXPLOSION_MINUTES: 30, THETA_ACCEL: 2.5,
  SWEEP_SIZE: 50, BLOCK_SIZE: 200,
  SLIPPAGE_EXPLOSIVE: 0.6, SLIPPAGE_WICKY: 0.75, SLIPPAGE_KILL_ZONE: 0.5,
  ES_DIVERGENCE_THRESHOLD: 0.4,
  ES_MOMENTUM_THRESHOLD: 0.15,  // FIX: Was 0.3, too wide
  ES_CONFIDENCE_CUT: 0.6,
  VEGA_THETA_SAFE: 2.0, IV_CRUSH_HIGH: 70,
  KELLY_FRACTION: 0.25, MIN_KELLY: 0.02, MAX_KELLY: 0.10, MAX_RISK_PCT: 0.015,
  RV_WINDOW_BARS: 5,
  MAX_DATA_GAP_MS: 5000, STALE_DATA_PENALTY: 0.5,
  GAP_WARMUP_TICKS: 3,  // NEW: Ticks to wait after gap
};

// ═══════════════════════════════════════════════════════════════════════════════
// RESULT TYPE
// ═══════════════════════════════════════════════════════════════════════════════

type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };
const Ok = <T>(v: T): Result<T> => ({ ok: true, value: v });
const Err = <E>(e: E): Result<never, E> => ({ ok: false, error: e });

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface Node { strike: number; gamma: number; absGamma: number; sign: 1 | -1; delta?: number; touchCount: number; }
export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number; }
export interface OptionsTrade { timestamp: number; strike: number; type: 'call' | 'put'; side: 'buy' | 'sell'; size: number; price: number; bid: number; ask: number; iv?: number; vega?: number; theta?: number; exchange?: string; }
export interface ESData { price: number; momentum: number; orderBookImbalance: number; }

// ═══════════════════════════════════════════════════════════════════════════════
// TICK STATE WITH WARMUP (Gemini Fix #1)
// ═══════════════════════════════════════════════════════════════════════════════

interface TickState {
  lastUpdate: number;
  prevKE: number;
  prevVix: number;
  quality: 'GOOD' | 'STALE' | 'GAP' | 'WARMING';  // NEW: WARMING state
  warmupRemaining: number;  // NEW: Ticks until stable
  ticksSinceGap: number;
}

function createTickState(): TickState {
  return { lastUpdate: 0, prevKE: 0, prevVix: 15, quality: 'GOOD', warmupRemaining: 0, ticksSinceGap: 999 };
}

function updateTickState(s: TickState, now: number, ke: number, vix: number): TickState {
  const gap = s.lastUpdate > 0 ? now - s.lastUpdate : 0;
  
  // Detect gap
  if (gap > CONFIG.MAX_DATA_GAP_MS) {
    return { lastUpdate: now, prevKE: ke, prevVix: vix, quality: 'GAP', warmupRemaining: CONFIG.GAP_WARMUP_TICKS, ticksSinceGap: 0 };
  }
  
  // In warmup period after gap
  if (s.warmupRemaining > 0) {
    return { lastUpdate: now, prevKE: ke, prevVix: vix, quality: 'WARMING', warmupRemaining: s.warmupRemaining - 1, ticksSinceGap: s.ticksSinceGap + 1 };
  }
  
  // Stale but not gap
  if (gap > CONFIG.MAX_DATA_GAP_MS / 2) {
    return { lastUpdate: now, prevKE: ke, prevVix: vix, quality: 'STALE', warmupRemaining: 0, ticksSinceGap: s.ticksSinceGap + 1 };
  }
  
  return { lastUpdate: now, prevKE: ke, prevVix: vix, quality: 'GOOD', warmupRemaining: 0, ticksSinceGap: s.ticksSinceGap + 1 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORE PHYSICS
// ═══════════════════════════════════════════════════════════════════════════════

function calcRV(bars: Bar[]): number {
  if (bars.length < CONFIG.RV_WINDOW_BARS + 1) return 10;
  const recent = bars.slice(-CONFIG.RV_WINDOW_BARS - 1);
  let sum = 0;
  for (let i = 1; i < recent.length; i++) {
    const ret = Math.log(recent[i].close / recent[i - 1].close);
    sum += ret * ret;
  }
  return Math.max(5, Math.min(50, Math.sqrt(sum / CONFIG.RV_WINDOW_BARS) * 1000));
}

function calcSigma(minsToExp: number, vix: number, rv: number): number {
  const time = Math.sqrt(Math.min(1, minsToExp / 390));
  const vol = Math.pow(vix / CONFIG.VIX_BASELINE, CONFIG.VIX_EXPONENT);
  const rvF = Math.max(0.5, Math.min(2, rv / 10));
  return Math.max(CONFIG.SIGMA_MIN, Math.min(CONFIG.SIGMA_MAX, CONFIG.SIGMA_BASE * time * vol * rvF));
}

function gaussianPDF(x: number, mu: number, sigma: number): number {
  return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-Math.pow(x - mu, 2) / (2 * sigma * sigma));
}

// ═══════════════════════════════════════════════════════════════════════════════
// NODE HEALTH
// ═══════════════════════════════════════════════════════════════════════════════

interface NodeHealth { strike: number; health: string; mass: number; isVacuum: boolean; }

function computeNodeHealth(n: Node, spot: number, now: number, expiry: number): NodeHealth {
  const mins = Math.max(1, (expiry - now) / 60000);
  const dist = Math.abs(n.strike - spot);
  const decay = mins < 120 ? mins / 120 : 1;
  const touchPower = Math.pow(CONFIG.TOUCH_DECAY, n.touchCount);
  
  let thetaMult = 1, isVacuum = false;
  if (mins < CONFIG.EXPLOSION_MINUTES && dist < 15) {
    thetaMult = 1 + CONFIG.THETA_ACCEL * (1 - mins / CONFIG.EXPLOSION_MINUTES);
    if (dist > CONFIG.VACUUM_DISTANCE) isVacuum = true;
  }
  
  const remaining = touchPower * decay * (isVacuum ? 0.5 : thetaMult);
  let mass = n.absGamma * remaining;
  if (isVacuum) mass *= CONFIG.VACUUM_REPULSION;
  
  const health = isVacuum ? 'VACUUM' : mins < CONFIG.EXPLOSION_MINUTES && dist < 15 ? 'EXPLODING' : 
    n.touchCount === 0 ? 'FRESH' : remaining > 0.6 ? 'HEALTHY' : remaining > 0.3 ? 'WEAK' : 'DYING';
  
  return { strike: n.strike, health, mass, isVacuum };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORCE VECTOR
// ═══════════════════════════════════════════════════════════════════════════════

interface ForceVector { direction: 'UP' | 'DOWN' | 'BALANCED'; imbalance: number; equilibrium: number; }

function computeForce(spot: number, nodes: Node[], healthMap: Map<number, NodeHealth>, sigma: number, vix: number): ForceVector {
  let up = 0, down = 0, wSum = 0, wTotal = 0;
  const visc = Math.log(Math.max(10, vix)) / Math.log(CONFIG.VIX_BASELINE);
  
  for (const n of nodes) {
    const h = healthMap.get(n.strike);
    let force = (n.absGamma / CONFIG.GEX_SIGNIFICANCE) * gaussianPDF(spot, n.strike, sigma) * sigma * Math.sqrt(2 * Math.PI) / visc;
    if (h?.isVacuum) force *= CONFIG.VACUUM_REPULSION;
    if (n.strike > spot) up += force; else down += force;
    wSum += n.strike * Math.abs(force);
    wTotal += Math.abs(force);
  }
  
  const total = Math.abs(up) + Math.abs(down), diff = up - down;
  return {
    direction: diff > total * 0.1 ? 'UP' : diff < -total * 0.1 ? 'DOWN' : 'BALANCED',
    imbalance: total > 0 ? Math.abs(diff) / total : 0,
    equilibrium: wTotal > 0 ? wSum / wTotal : spot
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOMENTUM
// ═══════════════════════════════════════════════════════════════════════════════

interface Momentum { vel: number; vwVel: number; acc: number; ke: number; dir: 'UP' | 'DOWN' | 'FLAT'; }

function computeMomentum(bars: Bar[]): Momentum {
  if (bars.length < 6) return { vel: 0, vwVel: 0, acc: 0, ke: 0, dir: 'FLAT' };
  
  const r = bars.slice(-4);
  const vel = (r[3].close - r[0].close) / 3;
  
  let wC = 0, tV = 0;
  for (let i = 1; i < r.length; i++) { wC += (r[i].close - r[i-1].close) * r[i].volume; tV += r[i].volume; }
  const vwVel = tV > 0 ? wC / tV : 0;
  
  const o = bars.slice(-7, -3);
  const oldVel = o.length >= 4 ? (o[3].close - o[0].close) / 3 : 0;
  const acc = vel - oldVel;
  
  const avgVol = bars.slice(-5).reduce((s, b) => s + b.volume, 0) / 5;
  const ke = 0.5 * (avgVol / 10000) * vel * vel;
  
  return { vel, vwVel, acc, ke, dir: vwVel > 0.3 ? 'UP' : vwVel < -0.3 ? 'DOWN' : 'FLAT' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGIME
// ═══════════════════════════════════════════════════════════════════════════════

interface Regime {
  type: 'POS' | 'NEG';
  flip: number; distToFlip: number;
  phase: boolean; killZone: boolean;
  char: 'SMOOTH' | 'CHOPPY' | 'WICKY' | 'EXPLOSIVE';
  slip: number; vcMult: number;
}

function computeRegime(spot: number, gex: number, flip: number, vix: number, vixD: number, priceDir: string, ke: number, prevKE: number): Regime {
  const pos = gex > 0, mag = Math.abs(gex) / CONFIG.GEX_SIGNIFICANCE;
  const dist = spot - flip;
  const approaching = (dist < 0 && priceDir === 'UP') || (dist > 0 && priceDir === 'DOWN');
  const phase = Math.abs(dist) < CONFIG.FLIP_ZONE;
  const killZone = approaching && ke > prevKE + 5 && Math.abs(dist) < 15 && ke > CONFIG.KILL_ZONE_KE;
  
  const char: Regime['char'] = killZone || phase ? 'EXPLOSIVE' : pos ? (mag > 1 ? 'SMOOTH' : 'CHOPPY') : (mag > 1 ? 'EXPLOSIVE' : 'WICKY');
  
  let slip = 1;
  if (char === 'EXPLOSIVE') slip = CONFIG.SLIPPAGE_EXPLOSIVE;
  else if (char === 'WICKY') slip = CONFIG.SLIPPAGE_WICKY;
  if (killZone) slip = Math.min(slip, CONFIG.SLIPPAGE_KILL_ZONE);
  
  const vixDir = vixD > 0.2 ? 'UP' : vixD < -0.2 ? 'DN' : 'FLAT';
  let vcMult = 1;
  if (!pos) {
    if (priceDir === 'DOWN' && vixDir === 'UP') vcMult = 1.5 + mag * 0.3;
    else if (priceDir === 'UP' && vixDir === 'DN') vcMult = 1.3 + mag * 0.2;
  } else vcMult = 0.7;
  
  return { type: pos ? 'POS' : 'NEG', flip, distToFlip: dist, phase, killZone, char, slip, vcMult };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ES CORRELATION (Gemini Fix #3 - Lower threshold)
// ═══════════════════════════════════════════════════════════════════════════════

interface ESCorr { corr: number; diverge: boolean; confMult: number; esDir: string; }

function computeES(es: ESData | null, spxDir: string): ESCorr {
  if (!es) return { corr: 1, diverge: false, confMult: 1, esDir: 'NONE' };
  
  // FIX: Lower threshold to catch grinding markets
  const esDir = es.momentum > CONFIG.ES_MOMENTUM_THRESHOLD ? 'UP' : 
                es.momentum < -CONFIG.ES_MOMENTUM_THRESHOLD ? 'DOWN' : 'FLAT';
  const bookBias = es.orderBookImbalance > 0.2 ? 'BUY' : es.orderBookImbalance < -0.2 ? 'SELL' : 'FLAT';
  
  let corr = 0.5;
  if ((spxDir === 'UP' && esDir === 'UP') || (spxDir === 'DOWN' && esDir === 'DOWN')) corr = 0.85;
  else if ((spxDir === 'UP' && esDir === 'DOWN') || (spxDir === 'DOWN' && esDir === 'UP')) corr = -0.4;
  else if (esDir === 'FLAT') corr = 0.6;  // FIX: Grinding is not divergence
  
  if ((spxDir === 'UP' && bookBias === 'SELL') || (spxDir === 'DOWN' && bookBias === 'BUY')) corr -= 0.25;
  
  corr = Math.max(-1, Math.min(1, corr));
  const diverge = corr < CONFIG.ES_DIVERGENCE_THRESHOLD;
  
  return { corr, diverge, confMult: diverge ? CONFIG.ES_CONFIDENCE_CUT : 1, esDir };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SURGICAL IV CRUSH (Gemini Fix #2 - Vega weighted)
// ═══════════════════════════════════════════════════════════════════════════════

interface IVCrush { 
  risk: number; 
  rec: 'GO' | 'CAUTION' | 'AVOID';
  vegaThetaRatio: number;  // NEW: Actual ratio from trades
  surgicalPenalty: number;  // NEW: Strike-specific penalty
}

function analyzeIVCrush(trades: OptionsTrade[], minsToExp: number, targetStrike?: number): IVCrush {
  const ivTrades = trades.filter(t => t.iv && t.iv > 0);
  if (ivTrades.length < 3) return { risk: 25, rec: 'GO', vegaThetaRatio: 3, surgicalPenalty: 0 };
  
  // Calculate actual Vega/Theta if available
  let totalVega = 0, totalTheta = 0;
  const strikeTrades = targetStrike ? ivTrades.filter(t => Math.abs(t.strike - targetStrike) < 10) : ivTrades;
  
  for (const t of strikeTrades) {
    if (t.vega) totalVega += Math.abs(t.vega) * t.size;
    if (t.theta) totalTheta += Math.abs(t.theta) * t.size;
  }
  
  const vegaThetaRatio = totalTheta > 0 ? totalVega / totalTheta : 3;
  
  // IV trend
  const mid = Math.floor(ivTrades.length / 2);
  const firstAvg = ivTrades.slice(0, mid).reduce((s, t) => s + (t.iv || 0), 0) / mid;
  const secondAvg = ivTrades.slice(mid).reduce((s, t) => s + (t.iv || 0), 0) / (ivTrades.length - mid);
  const ivFalling = secondAvg < firstAvg * 0.95;
  
  // Base risk
  let risk = 25;
  if (ivFalling) risk += 25;
  if (secondAvg > 30) risk += 15;
  if (minsToExp < 60) risk += 20;
  if (vegaThetaRatio < CONFIG.VEGA_THETA_SAFE) risk += 20;  // NEW: Use actual ratio
  risk = Math.min(100, risk);
  
  // SURGICAL PENALTY: Based on actual Vega/Theta, not binary
  // If ratio is 1.0 (theta = vega), penalty is 50%
  // If ratio is 3.0+, penalty is 0%
  const surgicalPenalty = vegaThetaRatio >= CONFIG.VEGA_THETA_SAFE ? 0 :
    Math.min(0.5, (CONFIG.VEGA_THETA_SAFE - vegaThetaRatio) / CONFIG.VEGA_THETA_SAFE * 0.5);
  
  return { 
    risk, 
    rec: risk > CONFIG.IV_CRUSH_HIGH ? 'AVOID' : risk > 50 ? 'CAUTION' : 'GO',
    vegaThetaRatio,
    surgicalPenalty
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// POSITION SIZING
// ═══════════════════════════════════════════════════════════════════════════════

interface Position { kelly: number; contracts: number; maxRisk: number; penalties: string[]; }

function calcPosition(
  conf: number, rr: number, regime: Regime, es: ESCorr, iv: IVCrush, 
  tickQuality: string, accountSize: number, stopDist: number
): Position {
  const penalties: string[] = [];
  let winP = conf / 100;
  
  // ES divergence
  winP *= es.confMult;
  if (es.diverge) penalties.push(`ES:-${((1 - es.confMult) * 100).toFixed(0)}%`);
  
  // SURGICAL IV (not binary)
  if (iv.surgicalPenalty > 0) {
    winP *= (1 - iv.surgicalPenalty);
    penalties.push(`IV:-${(iv.surgicalPenalty * 100).toFixed(0)}% (V/T:${iv.vegaThetaRatio.toFixed(1)})`);
  }
  
  // Regime
  if (regime.type === 'NEG') { winP *= 0.85; penalties.push('NEG_GAMMA:-15%'); }
  if (regime.phase) { winP *= 0.7; penalties.push('PHASE:-30%'); }
  if (regime.killZone) { winP *= 0.6; penalties.push('KILL:-40%'); }
  
  // Data quality
  if (tickQuality === 'WARMING') { winP *= 0.4; penalties.push('WARMING:-60%'); }
  else if (tickQuality === 'GAP') { winP *= 0.2; penalties.push('GAP:-80%'); }
  else if (tickQuality === 'STALE') { winP *= CONFIG.STALE_DATA_PENALTY; penalties.push('STALE:-50%'); }
  
  // Kelly
  const q = 1 - winP;
  let kelly = ((rr * winP) - q) / rr;
  kelly *= CONFIG.KELLY_FRACTION * regime.slip;
  kelly = Math.max(CONFIG.MIN_KELLY, Math.min(CONFIG.MAX_KELLY, kelly));
  
  const maxRisk = accountSize * Math.min(CONFIG.MAX_RISK_PCT, kelly);
  const contracts = Math.max(1, Math.floor(maxRisk / (stopDist * 50)));
  
  return { kelly, contracts, maxRisk, penalties };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

export interface Scenario {
  type: string; conf: number; dir: 'LONG' | 'SHORT';
  entry: { low: number; high: number }; stop: number; target: number;
  urgency: 'WAIT' | 'PREP' | 'READY' | 'NOW';
  pos: Position; warnings: string[];
}

function detectScenarios(
  spot: number, mom: Momentum, regime: Regime, nodes: NodeHealth[],
  force: ForceVector, es: ESCorr, iv: IVCrush, tick: TickState, acct: number, trades: OptionsTrade[]
): Scenario[] {
  const scenarios: Scenario[] = [];
  
  // BLOCK SCENARIOS DURING WARMUP (Gemini Fix #1)
  if (tick.quality === 'GAP' || tick.quality === 'WARMING') {
    return [];  // No trades until data stabilizes
  }
  
  // DIP BUY
  const sups = nodes.filter(n => n.strike < spot && n.strike > spot - 30 && n.mass > 0 && !n.isVacuum)
    .sort((a, b) => b.mass - a.mass);
  
  if (sups.length > 0) {
    const sup = sups[0], dist = spot - sup.strike;
    if (dist <= 20 || mom.dir === 'DOWN') {
      let conf = 0;
      if (dist < 5) conf += 30; else if (dist < 10) conf += 20; else if (dist < 15) conf += 10;
      if (sup.health === 'FRESH') conf += 25;
      else if (sup.health === 'EXPLODING') conf += 30;
      if (mom.vwVel < -1) conf += 15;
      if (force.direction === 'UP') conf += 10;
      if (regime.phase) conf -= 15;
      if (regime.killZone) conf -= 25;
      if (regime.vcMult > 1.3 && mom.dir === 'DOWN') conf -= 15;
      conf *= es.confMult;
      
      if (conf >= 50) {
        const wick = regime.type === 'NEG' ? 8 : 3;
        const stop = sup.strike - wick - 5;
        const target = force.equilibrium;
        const rr = Math.abs(target - sup.strike) / Math.abs(sup.strike - stop);
        
        // Surgical IV for this specific strike
        const ivStrike = analyzeIVCrush(trades, 60, sup.strike);
        
        let urgency: Scenario['urgency'] = dist < 5 ? 'NOW' : dist < 10 ? 'READY' : 'PREP';
        if (ivStrike.rec === 'AVOID') urgency = 'WAIT';
        else if (ivStrike.rec === 'CAUTION' && urgency === 'NOW') urgency = 'READY';
        
        // Vacuum nearby = breakout imminent
        const vacuum = nodes.find(n => n.isVacuum && Math.abs(n.strike - spot) < 10);
        if (vacuum && urgency !== 'WAIT') urgency = 'READY';
        
        const pos = calcPosition(conf, rr, regime, es, ivStrike, tick.quality, acct, Math.abs(sup.strike - stop));
        
        scenarios.push({
          type: 'DIP_BUY', conf: Math.round(conf), dir: 'LONG',
          entry: { low: sup.strike - wick, high: sup.strike + 3 },
          stop, target, urgency, pos,
          warnings: [
            ...pos.penalties,
            ...(vacuum ? ['⚡VACUUM_NEAR'] : []),
            ...(tick.quality !== 'GOOD' ? [`⚠️${tick.quality}`] : [])
          ]
        });
      }
    }
  }
  
  // GAMMA FLIP
  if (regime.phase) {
    const crossUp = regime.distToFlip < 0 && mom.dir === 'UP';
    const crossDn = regime.distToFlip > 0 && mom.dir === 'DOWN';
    
    if (crossUp || crossDn) {
      let conf = 50;
      if (Math.abs(regime.distToFlip) < 3) conf += 20;
      if (Math.abs(mom.vwVel) > 0.5) conf += 15;
      if (mom.ke > 50) conf += 10;
      if (regime.killZone) conf -= 20;
      conf *= es.confMult;
      
      if (conf >= 55) {
        const dir: 'LONG' | 'SHORT' = crossUp ? 'LONG' : 'SHORT';
        const stop = dir === 'LONG' ? regime.flip - 10 : regime.flip + 10;
        const target = dir === 'LONG' ? regime.flip + 15 : regime.flip - 15;
        
        let urgency: Scenario['urgency'] = 'NOW';
        if (iv.rec === 'AVOID') urgency = 'WAIT';
        
        const pos = calcPosition(conf, 1.5, regime, es, iv, tick.quality, acct, 10);
        
        scenarios.push({
          type: 'GAMMA_FLIP', conf: Math.round(conf), dir,
          entry: dir === 'LONG' ? { low: regime.flip - 2, high: regime.flip + 5 } : { low: regime.flip - 5, high: regime.flip + 2 },
          stop, target, urgency, pos,
          warnings: ['⚠️PHASE', ...pos.penalties, ...(regime.killZone ? ['🔴KILL'] : [])]
        });
      }
    }
  }
  
  return scenarios.sort((a, b) => b.conf - a.conf);
}

// ═══════════════════════════════════════════════════════════════════════════════
// WARNINGS
// ═══════════════════════════════════════════════════════════════════════════════

interface Warning { type: string; sev: 'INFO' | 'WARN' | 'CRIT'; msg: string; }

function genWarnings(regime: Regime, nodes: NodeHealth[], es: ESCorr, iv: IVCrush, tick: TickState): Warning[] {
  const w: Warning[] = [];
  
  if (tick.quality === 'GAP') w.push({ type: 'DATA_GAP', sev: 'CRIT', msg: 'Scenarios blocked' });
  else if (tick.quality === 'WARMING') w.push({ type: 'WARMING', sev: 'WARN', msg: `${tick.warmupRemaining} ticks remaining` });
  
  if (regime.killZone) w.push({ type: 'KILL_ZONE', sev: 'CRIT', msg: `Slip:${((1-regime.slip)*100).toFixed(0)}%` });
  if (regime.phase) w.push({ type: 'GAMMA_FLIP', sev: 'CRIT', msg: `${Math.abs(regime.distToFlip).toFixed(1)}pts` });
  
  const vacs = nodes.filter(n => n.isVacuum);
  if (vacs.length) w.push({ type: 'VACUUM', sev: 'WARN', msg: vacs.map(n => n.strike).join(',') });
  
  if (es.diverge) w.push({ type: 'ES_DIV', sev: 'WARN', msg: `Corr:${es.corr.toFixed(2)}` });
  if (iv.risk > 50) w.push({ type: 'IV_CRUSH', sev: iv.risk > 70 ? 'CRIT' : 'WARN', msg: `${iv.risk}% V/T:${iv.vegaThetaRatio.toFixed(1)}` });
  
  return w;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

export interface Analysis {
  ts: number; spot: number; sigma: number; rv: number;
  regime: Regime; mom: Momentum; force: ForceVector;
  es: ESCorr; iv: IVCrush;
  scenarios: Scenario[]; best: Scenario | null;
  warnings: Warning[]; dataQuality: string;
}

export class TitanEngine {
  private bars: Bar[] = [];
  private trades: OptionsTrade[] = [];
  private tick: TickState = createTickState();
  private es: ESData | null = null;
  private acct = 50000;

  setAccount(s: number) { this.acct = s; }
  setES(d: ESData) { this.es = d; }

  update(d: { spot: number; nodes: Node[]; bar?: Bar; trades?: OptionsTrade[]; gex: number; flip: number; vix: number; expiry?: number }): void {
    const now = Date.now();
    if (d.bar) { this.bars.push(d.bar); if (this.bars.length > 100) this.bars.shift(); }
    if (d.trades) { this.trades.push(...d.trades); this.trades = this.trades.filter(t => t.timestamp > now - 120000).slice(-500); }
  }

  analyze(d: { spot: number; nodes: Node[]; gex: number; flip: number; vix: number; expiry?: number }): Result<Analysis> {
    const now = Date.now();
    const expiry = d.expiry || this.defExp();
    const mins = Math.max(1, (expiry - now) / 60000);
    
    const rv = calcRV(this.bars);
    const sigma = calcSigma(mins, d.vix, rv);
    const mom = computeMomentum(this.bars);
    
    const vixD = d.vix - this.tick.prevVix;
    this.tick = updateTickState(this.tick, now, mom.ke, d.vix);
    
    const nodeHealth = d.nodes.map(n => computeNodeHealth(n, d.spot, now, expiry));
    const healthMap = new Map(nodeHealth.map(n => [n.strike, n]));
    const force = computeForce(d.spot, d.nodes, healthMap, sigma, d.vix);
    const regime = computeRegime(d.spot, d.gex, d.flip, d.vix, vixD, mom.dir, mom.ke, this.tick.prevKE);
    const es = computeES(this.es, force.direction);
    const iv = analyzeIVCrush(this.trades, mins);
    
    const scenarios = detectScenarios(d.spot, mom, regime, nodeHealth, force, es, iv, this.tick, this.acct, this.trades);
    const warnings = genWarnings(regime, nodeHealth, es, iv, this.tick);
    
    return Ok({
      ts: now, spot: d.spot, sigma, rv, regime, mom, force, es, iv,
      scenarios, best: scenarios[0] || null, warnings, dataQuality: this.tick.quality
    });
  }

  reset() { this.bars = []; this.trades = []; this.tick = createTickState(); this.es = null; }
  private defExp() { const d = new Date(); d.setHours(16,0,0,0); if (d <= new Date()) d.setDate(d.getDate()+1); return d.getTime(); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO
// ═══════════════════════════════════════════════════════════════════════════════

export function demo() {
  console.log('TITAN v2.5 FINAL\n');
  console.log('Fixes: GAP_WARMUP | SURGICAL_IV | ES_DEADZONE\n');

  const e = new TitanEngine();
  e.setAccount(50000);
  e.setES({ price: 6055, momentum: 0.1, orderBookImbalance: -0.1 });  // Grinding market

  const nodes: Node[] = [
    { strike: 6090, gamma: 4.2e9, absGamma: 4.2e9, sign: 1, delta: 0.35, touchCount: 0 },
    { strike: 6055, gamma: 3e9, absGamma: 3e9, sign: 1, delta: 0.5, touchCount: 0 },
    { strike: 6030, gamma: -1.8e9, absGamma: 1.8e9, sign: -1, delta: -0.4, touchCount: 0 },
  ];

  for (let i = 0; i < 12; i++) {
    const p = 6070 - i * 0.5;
    e.update({
      spot: p, nodes, gex: -1.5e9, flip: 6055, vix: 22,
      bar: { time: Date.now() - (12-i)*60000, open: p, high: p+0.5, low: p-0.5, close: p, volume: 3000 },
      trades: [{ timestamp: Date.now(), strike: 6050, type: 'call', side: 'buy', size: 50, price: 5, bid: 4.9, ask: 5.1, iv: 24, vega: 0.15, theta: -0.08 }]
    });
  }

  const r = e.analyze({ spot: 6058, nodes, gex: -1.5e9, flip: 6055, vix: 22 });
  if (!r.ok) { console.log('Error:', r.error); return; }
  
  const a = r.value;
  console.log('─'.repeat(50));
  console.log(`SPOT: ${a.spot} | σ: ${a.sigma.toFixed(1)} | DATA: ${a.dataQuality}`);
  console.log(`REGIME: ${a.regime.char} | ES: ${a.es.esDir} (${a.es.corr.toFixed(2)})`);
  console.log(`IV: ${a.iv.risk}% | V/T: ${a.iv.vegaThetaRatio.toFixed(2)}`);
  console.log('─'.repeat(50));
  
  if (a.warnings.length) {
    console.log('\nWARNINGS:');
    a.warnings.forEach(w => console.log(`  [${w.sev}] ${w.type}: ${w.msg}`));
  }
  
  if (a.best) {
    console.log(`\n${a.best.type} (${a.best.conf}%) ${a.best.dir}`);
    console.log(`  Kelly: ${(a.best.pos.kelly*100).toFixed(1)}% | ${a.best.pos.contracts} contracts`);
    console.log(`  Penalties: ${a.best.pos.penalties.join(' ')}`);
  } else {
    console.log('\nNo scenarios (data stabilizing or no setup)');
  }
}

if (typeof require !== 'undefined' && require.main === module) demo();
