/**
 * Titan Physics Engine (v2.5) - JS implementation
 *
 * Real-data-only interpretation layer.
 * - Consumes: spot, vix, minute bars, dealer nodes (from real options snapshots), options trades/quotes (WS), optional ES proxy.
 * - Produces: scenarios + warnings + position sizing suggestions.
 *
 * Notes:
 * - This module is intentionally dependency-free (besides built-in Math).
 * - It is designed to run at 1Hz without heavy CPU.
 */

export const CONFIG = {
  SIGMA_BASE: 10,
  SIGMA_MIN: 2,
  SIGMA_MAX: 30,
  VIX_BASELINE: 15,
  VIX_EXPONENT: 1.5,
  GEX_SIGNIFICANCE: 1e9,
  REPULSION_ZONE: 5,
  TOUCH_DECAY: 0.66,
  VACUUM_DISTANCE: 5,
  VACUUM_REPULSION: -1.2,
  FLIP_ZONE: 5,
  KILL_ZONE_KE: 30,
  EXPLOSION_MINUTES: 30,
  THETA_ACCEL: 2.5,
  SLIPPAGE_EXPLOSIVE: 0.6,
  SLIPPAGE_WICKY: 0.75,
  SLIPPAGE_KILL_ZONE: 0.5,
  ES_DIVERGENCE_THRESHOLD: 0.4,
  ES_MOMENTUM_THRESHOLD: 0.15,
  ES_CONFIDENCE_CUT: 0.6,
  VEGA_THETA_SAFE: 2.0,
  IV_CRUSH_HIGH: 70,
  KELLY_FRACTION: 0.25,
  MIN_KELLY: 0.02,
  MAX_KELLY: 0.1,
  MAX_RISK_PCT: 0.015,
  RV_WINDOW_BARS: 5,
  MAX_DATA_GAP_MS: 5000,
  STALE_DATA_PENALTY: 0.5,
  GAP_WARMUP_TICKS: 3,
};

export function createTickState() {
  return { lastUpdate: 0, prevKE: 0, prevVix: 15, quality: 'GOOD', warmupRemaining: 0, ticksSinceGap: 999 };
}

export function updateTickState(s, now, ke, vix) {
  const gap = s.lastUpdate > 0 ? now - s.lastUpdate : 0;
  if (gap > CONFIG.MAX_DATA_GAP_MS) {
    return { lastUpdate: now, prevKE: ke, prevVix: vix, quality: 'GAP', warmupRemaining: CONFIG.GAP_WARMUP_TICKS, ticksSinceGap: 0 };
  }
  if (s.warmupRemaining > 0) {
    return { lastUpdate: now, prevKE: ke, prevVix: vix, quality: 'WARMING', warmupRemaining: s.warmupRemaining - 1, ticksSinceGap: s.ticksSinceGap + 1 };
  }
  if (gap > CONFIG.MAX_DATA_GAP_MS / 2) {
    return { lastUpdate: now, prevKE: ke, prevVix: vix, quality: 'STALE', warmupRemaining: 0, ticksSinceGap: s.ticksSinceGap + 1 };
  }
  return { lastUpdate: now, prevKE: ke, prevVix: vix, quality: 'GOOD', warmupRemaining: 0, ticksSinceGap: s.ticksSinceGap + 1 };
}

function calcRV(bars) {
  if (!Array.isArray(bars) || bars.length < CONFIG.RV_WINDOW_BARS + 1) return 10;
  const recent = bars.slice(-CONFIG.RV_WINDOW_BARS - 1);
  let sum = 0;
  for (let i = 1; i < recent.length; i += 1) {
    const ret = Math.log(recent[i].close / recent[i - 1].close);
    sum += ret * ret;
  }
  return Math.max(5, Math.min(50, Math.sqrt(sum / CONFIG.RV_WINDOW_BARS) * 1000));
}

function calcSigma(minsToExp, vix, rv) {
  const time = Math.sqrt(Math.min(1, minsToExp / 390));
  const vol = Math.pow(vix / CONFIG.VIX_BASELINE, CONFIG.VIX_EXPONENT);
  const rvF = Math.max(0.5, Math.min(2, rv / 10));
  return Math.max(CONFIG.SIGMA_MIN, Math.min(CONFIG.SIGMA_MAX, CONFIG.SIGMA_BASE * time * vol * rvF));
}

function gaussianPDF(x, mu, sigma) {
  return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-Math.pow(x - mu, 2) / (2 * sigma * sigma));
}

export function computeNodeHealth(n, spot, now, expiry) {
  const mins = Math.max(1, (expiry - now) / 60000);
  const dist = Math.abs(n.strike - spot);
  const decay = mins < 120 ? mins / 120 : 1;
  const touchPower = Math.pow(CONFIG.TOUCH_DECAY, n.touchCount || 0);

  let thetaMult = 1;
  let isVacuum = false;
  if (mins < CONFIG.EXPLOSION_MINUTES && dist < 15) {
    thetaMult = 1 + CONFIG.THETA_ACCEL * (1 - mins / CONFIG.EXPLOSION_MINUTES);
    if (dist > CONFIG.VACUUM_DISTANCE) isVacuum = true;
  }

  const remaining = touchPower * decay * (isVacuum ? 0.5 : thetaMult);
  let mass = (n.absGamma || 0) * remaining;
  if (isVacuum) mass *= CONFIG.VACUUM_REPULSION;

  const health =
    isVacuum
      ? 'VACUUM'
      : mins < CONFIG.EXPLOSION_MINUTES && dist < 15
        ? 'EXPLODING'
        : (n.touchCount || 0) === 0
          ? 'FRESH'
          : remaining > 0.6
            ? 'HEALTHY'
            : remaining > 0.3
              ? 'WEAK'
              : 'DYING';

  return { strike: n.strike, health, mass, isVacuum };
}

export function computeForce(spot, nodes, healthMap, sigma, vix) {
  let up = 0;
  let down = 0;
  let wSum = 0;
  let wTotal = 0;
  const visc = Math.log(Math.max(10, vix)) / Math.log(CONFIG.VIX_BASELINE);

  for (const n of nodes) {
    const h = healthMap.get(n.strike);
    let force = (n.absGamma / CONFIG.GEX_SIGNIFICANCE) * gaussianPDF(spot, n.strike, sigma) * sigma * Math.sqrt(2 * Math.PI) / visc;
    if (h?.isVacuum) force *= CONFIG.VACUUM_REPULSION;
    if (n.strike > spot) up += force;
    else down += force;
    wSum += n.strike * Math.abs(force);
    wTotal += Math.abs(force);
  }

  const total = Math.abs(up) + Math.abs(down);
  const diff = up - down;
  return {
    direction: diff > total * 0.1 ? 'UP' : diff < -total * 0.1 ? 'DOWN' : 'BALANCED',
    imbalance: total > 0 ? Math.abs(diff) / total : 0,
    equilibrium: wTotal > 0 ? wSum / wTotal : spot,
  };
}

export function computeMomentum(barsNewestFirst) {
  // bars in backend are newest-first; convert to oldest-first for this calc window
  const bars = Array.isArray(barsNewestFirst) ? [...barsNewestFirst].slice(0, 20).reverse() : [];
  if (bars.length < 7) return { vel: 0, vwVel: 0, acc: 0, ke: 0, dir: 'FLAT' };

  const r = bars.slice(-4);
  const vel = (r[3].close - r[0].close) / 3;

  let wC = 0;
  let tV = 0;
  for (let i = 1; i < r.length; i += 1) {
    wC += (r[i].close - r[i - 1].close) * (r[i].volume || 0);
    tV += r[i].volume || 0;
  }
  const vwVel = tV > 0 ? wC / tV : 0;

  const o = bars.slice(-7, -3);
  const oldVel = o.length >= 4 ? (o[3].close - o[0].close) / 3 : 0;
  const acc = vel - oldVel;

  const avgVol = bars.slice(-5).reduce((s, b) => s + (b.volume || 0), 0) / 5;
  const ke = 0.5 * (avgVol / 10000) * vel * vel;

  return { vel, vwVel, acc, ke, dir: vwVel > 0.3 ? 'UP' : vwVel < -0.3 ? 'DOWN' : 'FLAT' };
}

export function computeRegime({ spot, gex, flip, vix, vixDelta, priceDir, ke, prevKE }) {
  const pos = gex > 0;
  const mag = Math.abs(gex) / CONFIG.GEX_SIGNIFICANCE;
  const dist = spot - flip;
  const approaching = (dist < 0 && priceDir === 'UP') || (dist > 0 && priceDir === 'DOWN');
  const phase = Math.abs(dist) < CONFIG.FLIP_ZONE;
  const killZone = approaching && ke > prevKE + 5 && Math.abs(dist) < 15 && ke > CONFIG.KILL_ZONE_KE;

  const char = killZone || phase ? 'EXPLOSIVE' : pos ? (mag > 1 ? 'SMOOTH' : 'CHOPPY') : mag > 1 ? 'EXPLOSIVE' : 'WICKY';

  let slip = 1;
  if (char === 'EXPLOSIVE') slip = CONFIG.SLIPPAGE_EXPLOSIVE;
  else if (char === 'WICKY') slip = CONFIG.SLIPPAGE_WICKY;
  if (killZone) slip = Math.min(slip, CONFIG.SLIPPAGE_KILL_ZONE);

  const vixDir = vixDelta > 0.2 ? 'UP' : vixDelta < -0.2 ? 'DN' : 'FLAT';
  let vcMult = 1;
  if (!pos) {
    if (priceDir === 'DOWN' && vixDir === 'UP') vcMult = 1.5 + mag * 0.3;
    else if (priceDir === 'UP' && vixDir === 'DN') vcMult = 1.3 + mag * 0.2;
  } else {
    vcMult = 0.7;
  }

  return { type: pos ? 'POS' : 'NEG', flip, distToFlip: dist, phase, killZone, char, slip, vcMult };
}

export function computeES(es, spxDir) {
  if (!es) return { corr: 1, diverge: false, confMult: 1, esDir: 'NONE' };
  const esDir = es.momentum > CONFIG.ES_MOMENTUM_THRESHOLD ? 'UP' : es.momentum < -CONFIG.ES_MOMENTUM_THRESHOLD ? 'DOWN' : 'FLAT';
  const bookBias = es.orderBookImbalance > 0.2 ? 'BUY' : es.orderBookImbalance < -0.2 ? 'SELL' : 'FLAT';

  let corr = 0.5;
  if ((spxDir === 'UP' && esDir === 'UP') || (spxDir === 'DOWN' && esDir === 'DOWN')) corr = 0.85;
  else if ((spxDir === 'UP' && esDir === 'DOWN') || (spxDir === 'DOWN' && esDir === 'UP')) corr = -0.4;
  else if (esDir === 'FLAT') corr = 0.6;
  if ((spxDir === 'UP' && bookBias === 'SELL') || (spxDir === 'DOWN' && bookBias === 'BUY')) corr -= 0.25;

  corr = Math.max(-1, Math.min(1, corr));
  const diverge = corr < CONFIG.ES_DIVERGENCE_THRESHOLD;
  return { corr, diverge, confMult: diverge ? CONFIG.ES_CONFIDENCE_CUT : 1, esDir };
}

export function analyzeIVCrush(trades, minsToExp, targetStrike) {
  const ivTrades = (trades || []).filter((t) => Number.isFinite(t.iv) && t.iv > 0);
  if (ivTrades.length < 3) return { risk: 25, rec: 'GO', vegaThetaRatio: 3, surgicalPenalty: 0 };

  let totalVega = 0;
  let totalTheta = 0;
  const strikeTrades = targetStrike ? ivTrades.filter((t) => Math.abs(t.strike - targetStrike) < 10) : ivTrades;
  for (const t of strikeTrades) {
    if (Number.isFinite(t.vega)) totalVega += Math.abs(t.vega) * (t.size || 0);
    if (Number.isFinite(t.theta)) totalTheta += Math.abs(t.theta) * (t.size || 0);
  }
  const vegaThetaRatio = totalTheta > 0 ? totalVega / totalTheta : 3;

  const mid = Math.floor(ivTrades.length / 2);
  const firstAvg = ivTrades.slice(0, mid).reduce((s, t) => s + (t.iv || 0), 0) / Math.max(1, mid);
  const secondAvg = ivTrades.slice(mid).reduce((s, t) => s + (t.iv || 0), 0) / Math.max(1, ivTrades.length - mid);
  const ivFalling = secondAvg < firstAvg * 0.95;

  let risk = 25;
  if (ivFalling) risk += 25;
  if (secondAvg > 0.3) risk += 15;
  if (minsToExp < 60) risk += 20;
  if (vegaThetaRatio < CONFIG.VEGA_THETA_SAFE) risk += 20;
  risk = Math.min(100, risk);

  const surgicalPenalty =
    vegaThetaRatio >= CONFIG.VEGA_THETA_SAFE ? 0 : Math.min(0.5, ((CONFIG.VEGA_THETA_SAFE - vegaThetaRatio) / CONFIG.VEGA_THETA_SAFE) * 0.5);

  return { risk, rec: risk > CONFIG.IV_CRUSH_HIGH ? 'AVOID' : risk > 50 ? 'CAUTION' : 'GO', vegaThetaRatio, surgicalPenalty };
}

export function calcPosition({ conf, rr, regime, es, iv, tickQuality, accountSize, stopDist }) {
  const penalties = [];
  let winP = Math.max(0, Math.min(1, conf / 100));

  winP *= es.confMult;
  if (es.diverge) penalties.push(`ES:-${((1 - es.confMult) * 100).toFixed(0)}%`);

  if (iv.surgicalPenalty > 0) {
    winP *= 1 - iv.surgicalPenalty;
    penalties.push(`IV:-${(iv.surgicalPenalty * 100).toFixed(0)}% (V/T:${iv.vegaThetaRatio.toFixed(1)})`);
  }

  if (regime.type === 'NEG') {
    winP *= 0.85;
    penalties.push('NEG_GAMMA:-15%');
  }
  if (regime.phase) {
    winP *= 0.7;
    penalties.push('PHASE:-30%');
  }
  if (regime.killZone) {
    winP *= 0.6;
    penalties.push('KILL:-40%');
  }

  if (tickQuality === 'WARMING') {
    winP *= 0.4;
    penalties.push('WARMING:-60%');
  } else if (tickQuality === 'GAP') {
    winP *= 0.2;
    penalties.push('GAP:-80%');
  } else if (tickQuality === 'STALE') {
    winP *= CONFIG.STALE_DATA_PENALTY;
    penalties.push('STALE:-50%');
  }

  const q = 1 - winP;
  let kelly = ((rr * winP - q) / rr) * CONFIG.KELLY_FRACTION * (regime.slip || 1);
  kelly = Math.max(CONFIG.MIN_KELLY, Math.min(CONFIG.MAX_KELLY, kelly));

  const maxRisk = accountSize * Math.min(CONFIG.MAX_RISK_PCT, kelly);
  const contracts = Math.max(1, Math.floor(maxRisk / Math.max(1, stopDist) / 50));

  return { kelly, contracts, maxRisk, penalties };
}

export function detectScenarios({ spot, mom, regime, nodeHealth, force, es, iv, tick, accountSize, trades }) {
  if (tick.quality === 'GAP' || tick.quality === 'WARMING') return [];
  const scenarios = [];

  // DIP BUY (support magnet)
  const sups = nodeHealth
    .filter((n) => n.strike < spot && n.strike > spot - 30 && n.mass > 0 && !n.isVacuum)
    .sort((a, b) => b.mass - a.mass);

  if (sups.length) {
    const sup = sups[0];
    const dist = spot - sup.strike;
    if (dist <= 20 || mom.dir === 'DOWN') {
      let conf = 0;
      if (dist < 5) conf += 30;
      else if (dist < 10) conf += 20;
      else if (dist < 15) conf += 10;
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
        const rr = Math.abs(target - sup.strike) / Math.max(1, Math.abs(sup.strike - stop));
        const ivStrike = analyzeIVCrush(trades, 60, sup.strike);

        let urgency = dist < 5 ? 'NOW' : dist < 10 ? 'READY' : 'PREP';
        if (ivStrike.rec === 'AVOID') urgency = 'WAIT';
        else if (ivStrike.rec === 'CAUTION' && urgency === 'NOW') urgency = 'READY';

        const vacuum = nodeHealth.find((n) => n.isVacuum && Math.abs(n.strike - spot) < 10);
        if (vacuum && urgency !== 'WAIT') urgency = 'READY';

        const pos = calcPosition({ conf, rr, regime, es, iv: ivStrike, tickQuality: tick.quality, accountSize, stopDist: Math.abs(sup.strike - stop) });

        scenarios.push({
          type: 'DIP_BUY',
          conf: Math.round(conf),
          dir: 'LONG',
          entry: { low: sup.strike - wick, high: sup.strike + 3 },
          stop,
          target,
          urgency,
          pos,
          warnings: [...pos.penalties, ...(vacuum ? ['VACUUM_NEAR'] : []), ...(tick.quality !== 'GOOD' ? [tick.quality] : [])],
        });
      }
    }
  }

  // GAMMA FLIP (phase-cross)
  if (regime.phase && Number.isFinite(regime.flip)) {
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
        const dir = crossUp ? 'LONG' : 'SHORT';
        const stop = dir === 'LONG' ? regime.flip - 10 : regime.flip + 10;
        const target = dir === 'LONG' ? regime.flip + 15 : regime.flip - 15;
        let urgency = 'NOW';
        if (iv.rec === 'AVOID') urgency = 'WAIT';
        const pos = calcPosition({ conf, rr: 1.5, regime, es, iv, tickQuality: tick.quality, accountSize, stopDist: 10 });
        scenarios.push({
          type: 'GAMMA_FLIP',
          conf: Math.round(conf),
          dir,
          entry: dir === 'LONG' ? { low: regime.flip - 2, high: regime.flip + 5 } : { low: regime.flip - 5, high: regime.flip + 2 },
          stop,
          target,
          urgency,
          pos,
          warnings: ['PHASE', ...pos.penalties, ...(regime.killZone ? ['KILL_ZONE'] : [])],
        });
      }
    }
  }

  return scenarios.sort((a, b) => b.conf - a.conf);
}

export function genWarnings({ regime, nodeHealth, es, iv, tick }) {
  const w = [];
  if (tick.quality === 'GAP') w.push({ type: 'DATA_GAP', sev: 'CRIT', msg: 'Data gap detected; scenarios blocked.' });
  if (tick.quality === 'WARMING') w.push({ type: 'WARMUP', sev: 'WARN', msg: 'Post-gap warmup; scenarios blocked.' });
  if (tick.quality === 'STALE') w.push({ type: 'STALE', sev: 'WARN', msg: 'Stale ticks; reduce size and require confirmations.' });
  if (es.diverge) w.push({ type: 'ES_DIVERGENCE', sev: 'WARN', msg: 'ES proxy diverging; reduce confidence.' });
  if (iv.rec === 'AVOID') w.push({ type: 'IV_CRUSH', sev: 'WARN', msg: `IV crush risk high (V/T ${iv.vegaThetaRatio.toFixed(1)}).` });
  if (regime.killZone) w.push({ type: 'KILL_ZONE', sev: 'CRIT', msg: 'Kill-zone conditions: high KE into flip; slippage risk elevated.' });
  if (nodeHealth.some((n) => n.isVacuum)) w.push({ type: 'VACUUM', sev: 'INFO', msg: 'Vacuum node detected; expect fast delivery / air pockets.' });
  return w;
}

export function createPhysicsEngine() {
  const tick = createTickState();
  const state = { tick };

  return {
    step(input) {
      const now = input.now;
      const spot = input.spot;
      const vix = input.vix ?? 15;
      const expiry = input.expiryTs ?? now + 6 * 60 * 60 * 1000;
      const accountSize = input.accountSize ?? 50_000;
      const bars = input.bars || [];
      const nodes = input.nodes || [];
      const trades = input.trades || [];
      const es = input.es || null;
      const flip = input.flip ?? spot;
      const gex = input.netGex ?? 0;

      const mom = computeMomentum(bars);
      const rv = calcRV([...bars].slice(0, 30).reverse());
      const minsToExp = Math.max(1, (expiry - now) / 60000);
      const sigma = calcSigma(minsToExp, vix, rv);

      state.tick = updateTickState(state.tick, now, mom.ke, vix);
      const vixD = vix - (state.tick.prevVix || vix);

      const healthMap = new Map();
      const nodeHealth = [];
      for (const n of nodes) {
        const h = computeNodeHealth(n, spot, now, expiry);
        healthMap.set(n.strike, h);
        nodeHealth.push(h);
      }

      const force = computeForce(spot, nodes, healthMap, sigma, vix);
      const esCorr = computeES(es, mom.dir);
      const iv = analyzeIVCrush(trades, minsToExp);

      const regime = computeRegime({
        spot,
        gex,
        flip,
        vix,
        vixDelta: vixD,
        priceDir: mom.dir,
        ke: mom.ke,
        prevKE: state.tick.prevKE || 0,
      });

      const scenarios = detectScenarios({
        spot,
        mom,
        regime,
        nodeHealth,
        force,
        es: esCorr,
        iv,
        tick: state.tick,
        accountSize,
        trades,
      });

      const warnings = genWarnings({ regime, nodeHealth, es: esCorr, iv, tick: state.tick });

      return {
        ok: true,
        ts: now,
        tick: { quality: state.tick.quality, warmupRemaining: state.tick.warmupRemaining },
        sigma,
        rv,
        force,
        momentum: mom,
        regime,
        es: esCorr,
        iv,
        warnings,
        scenarios,
      };
    },
  };
}

