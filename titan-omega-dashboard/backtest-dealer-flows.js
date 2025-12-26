#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA - DEALER FLOW DETECTOR
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * UNDERSTANDING DEALER POSITIONING & FLOWS
 * 
 * Market makers (dealers) are FORCED to hedge their options positions.
 * Their hedging creates predictable flows that move SPX.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * THE 6 SCENARIOS THAT CREATE BIG MOVES (15-50+ points):
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * SCENARIO 1: CALL WALL REJECTION (Short at resistance)
 * ─────────────────────────────────────────────────────
 * Setup: Price rallies INTO the Call Wall
 * Why: Dealers are SHORT calls → Must SELL stock to hedge delta
 * Effect: Massive selling pressure → Price reverses DOWN
 * Signal: Price near Call Wall + Rejection candle + High volume
 * Target: 15-40 pts down to gamma flip or put wall
 * 
 * SCENARIO 2: PUT WALL BOUNCE (Long at support)
 * ─────────────────────────────────────────────
 * Setup: Price drops INTO the Put Wall
 * Why: Dealers are LONG puts → Must BUY stock to hedge delta
 * Effect: Massive buying pressure → Price reverses UP
 * Signal: Price near Put Wall + Hammer/Engulfing + Volume exhaustion
 * Target: 15-40 pts up to gamma flip or call wall
 * 
 * SCENARIO 3: GAMMA FLIP ACCELERATION (Trend continuation)
 * ────────────────────────────────────────────────────────
 * Setup: Price BREAKS through Gamma Flip level
 * Why: Regime change from +gamma (dampening) to -gamma (amplifying)
 * Effect: Dealers now CHASE price instead of fading it
 * Signal: Strong break of gamma flip + Volume + Momentum
 * Target: Extended move to next major GEX level
 * 
 * SCENARIO 4: VANNA SQUEEZE (IV change drives delta hedging)
 * ──────────────────────────────────────────────────────────
 * Setup: Implied Volatility drops significantly (VIX crush)
 * Why: Lower IV → Call deltas INCREASE → Dealers must SELL more
 *      Lower IV → Put deltas DECREASE → Dealers BUY back hedges
 * Effect: Net selling flow if call-heavy, net buying if put-heavy
 * Signal: VIX dropping + Above gamma flip + Positive vanna exposure
 * Target: Accelerated move in direction of vanna flow
 * 
 * SCENARIO 5: CHARM DECAY (Time decay drives delta hedging)
 * ─────────────────────────────────────────────────────────
 * Setup: Approaching expiration (especially 0DTE)
 * Why: OTM options lose delta rapidly → Dealers unwind hedges
 *      ITM options gain delta → Dealers add hedges
 * Effect: Predictable flows into close, especially on OPEX
 * Signal: 0DTE heavy volume + Near major strikes + Last 2 hours
 * Target: Move toward max pain or dominant strike
 * 
 * SCENARIO 6: DEALER POSITIONING FLIP (Regime change)
 * ───────────────────────────────────────────────────
 * Setup: Net GEX flips from positive to negative (or vice versa)
 * Why: Complete change in how dealers will respond to moves
 * Effect: Old support/resistance levels may not hold
 * Signal: Net GEX crossing zero + Break of key level
 * Target: Extended directional move in new regime
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

const CONFIG = {
  spx: { pointValue: 50 },
  costs: { total: 2.00 },
};

let seed = 42424242;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// Black-Scholes helpers
const normalCDF = (x) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
};
const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

// ═══════════════════════════════════════════════════════════════════════════════════════
// FULL GREEKS ENGINE
// ═══════════════════════════════════════════════════════════════════════════════════════

class GreeksEngine {
  static calculate(S, K, T, r, sigma, isCall) {
    if (T <= 0) T = 1/365/24; // Minimum time
    
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    
    const Nd1 = normalCDF(d1);
    const Nd2 = normalCDF(d2);
    const nd1 = normalPDF(d1);
    
    // Delta
    const delta = isCall ? Nd1 : Nd1 - 1;
    
    // Gamma (same for calls and puts)
    const gamma = nd1 / (S * sigma * sqrtT);
    
    // Vega (same for calls and puts)
    const vega = S * sqrtT * nd1 / 100; // Per 1% IV change
    
    // Theta
    const theta = isCall
      ? (-S * nd1 * sigma / (2 * sqrtT) - r * K * Math.exp(-r * T) * Nd2) / 365
      : (-S * nd1 * sigma / (2 * sqrtT) + r * K * Math.exp(-r * T) * (1 - Nd2)) / 365;
    
    // Vanna: dDelta/dVol = dVega/dSpot
    const vanna = (vega / S) * (1 - d1 / (sigma * sqrtT));
    
    // Charm: dDelta/dTime (negative of dDelta/dT)
    const charm = -nd1 * (2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT);
    
    // Vomma: dVega/dVol
    const vomma = vega * d1 * d2 / sigma;
    
    return { delta, gamma, vega, theta, vanna, charm, vomma, d1, d2 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// DEALER POSITIONING MODEL
// ═══════════════════════════════════════════════════════════════════════════════════════

class DealerPositioning {
  static buildProfile(spot, iv = 0.15, tte = 1/365) {
    const r = 0.05;
    const profile = {
      spot,
      iv,
      tte,
      
      // GEX levels
      gammaFlip: spot,
      callWall: null,
      putWall: null,
      callWallGEX: 0,
      putWallGEX: 0,
      
      // Net exposures
      netGEX: 0,      // Gamma Exposure (hedging pressure)
      netDEX: 0,      // Delta Exposure (directional)
      netVEX: 0,      // Vega Exposure (vol sensitivity)
      netVanna: 0,    // Vanna (IV change → delta change)
      netCharm: 0,    // Charm (time → delta change)
      
      // Derived signals
      regime: 'NEUTRAL',
      vannaFlow: 0,   // Expected flow from IV change
      charmFlow: 0,   // Expected flow from time decay
      
      // Key strikes data
      strikes: {},
    };
    
    let minAbsGEX = Infinity;
    let maxCallGEX = 0, maxPutGEX = 0;
    
    // Build options chain
    for (let i = -50; i <= 50; i++) {
      const K = Math.round(spot / 5) * 5 + i * 5;
      const dist = Math.abs(K - spot);
      const decay = Math.exp(-dist / 100);
      
      // Realistic OI - heavier at round numbers, skewed by moneyness
      const is100 = K % 100 === 0;
      const is50 = K % 50 === 0;
      const baseOI = is100 ? 25000 : is50 ? 15000 : 5000;
      
      // Calls heavier OTM (above spot), Puts heavier OTM (below spot)
      const callSkew = K > spot ? 1.5 : 0.4;
      const putSkew = K < spot ? 1.5 : 0.4;
      
      const callOI = Math.floor(baseOI * decay * callSkew * (0.7 + random() * 0.6));
      const putOI = Math.floor(baseOI * decay * putSkew * (0.7 + random() * 0.6));
      
      // Calculate Greeks
      const callGreeks = GreeksEngine.calculate(spot, K, tte, r, iv, true);
      const putGreeks = GreeksEngine.calculate(spot, K, tte, r, iv, false);
      
      // Dealer positions (they are typically short options to retail)
      // Short calls → negative gamma, negative vega, positive theta
      // Short puts → negative gamma, negative vega, positive theta
      // But for delta hedging: short call = must sell delta, short put = must buy delta
      
      const contractMult = 100; // SPX options = $100 per point
      
      // GEX: Dealers short both, so they have negative gamma
      // When price moves, they must chase (buy high, sell low)
      const callGEX = -callGreeks.gamma * callOI * contractMult * spot;
      const putGEX = putGreeks.gamma * putOI * contractMult * spot; // Puts flip sign
      
      // DEX: Net delta exposure
      const callDEX = -callGreeks.delta * callOI * contractMult;
      const putDEX = -putGreeks.delta * putOI * contractMult;
      
      // VEX: Vega exposure
      const callVEX = -callGreeks.vega * callOI * contractMult;
      const putVEX = -putGreeks.vega * putOI * contractMult;
      
      // Vanna exposure (how IV change affects delta hedging)
      const callVanna = -callGreeks.vanna * callOI * contractMult;
      const putVanna = -putGreeks.vanna * putOI * contractMult;
      
      // Charm exposure (how time decay affects delta hedging)
      const callCharm = -callGreeks.charm * callOI * contractMult;
      const putCharm = -putGreeks.charm * putOI * contractMult;
      
      // Store strike data
      profile.strikes[K] = {
        callOI, putOI,
        callGEX: callGEX / 1e9, putGEX: putGEX / 1e9,
        netGEX: (callGEX + putGEX) / 1e9,
        callDEX, putDEX,
        callVanna, putVanna,
        callCharm, putCharm,
      };
      
      // Accumulate totals
      profile.netGEX += callGEX + putGEX;
      profile.netDEX += callDEX + putDEX;
      profile.netVEX += callVEX + putVEX;
      profile.netVanna += callVanna + putVanna;
      profile.netCharm += callCharm + putCharm;
      
      // Find walls and flip
      const absGEX = Math.abs(callGEX + putGEX);
      if (absGEX < minAbsGEX && dist < 60) {
        minAbsGEX = absGEX;
        profile.gammaFlip = K;
      }
      
      if (K > spot && Math.abs(callGEX) > maxCallGEX) {
        maxCallGEX = Math.abs(callGEX);
        profile.callWall = K;
        profile.callWallGEX = Math.abs(callGEX) / 1e9;
      }
      
      if (K < spot && Math.abs(putGEX) > maxPutGEX) {
        maxPutGEX = Math.abs(putGEX);
        profile.putWall = K;
        profile.putWallGEX = Math.abs(putGEX) / 1e9;
      }
    }
    
    // Normalize
    profile.netGEX /= 1e9;
    profile.netVEX /= 1e6;
    profile.netVanna /= 1e6;
    profile.netCharm /= 1e6;
    
    // Determine regime
    if (profile.netGEX > 0.5) profile.regime = 'POSITIVE_GAMMA';
    else if (profile.netGEX < -0.5) profile.regime = 'NEGATIVE_GAMMA';
    else profile.regime = 'NEUTRAL';
    
    // Calculate expected flows from IV/time changes
    // Vanna flow: If IV drops 1%, how much will dealers need to hedge?
    profile.vannaFlow = profile.netVanna * 0.01; // Per 1% IV drop
    
    // Charm flow: How much delta hedging needed in next hour?
    profile.charmFlow = profile.netCharm * (1/6.5); // Per hour of trading
    
    // Key distances
    profile.distToCallWall = profile.callWall ? profile.callWall - spot : 999;
    profile.distToPutWall = profile.putWall ? spot - profile.putWall : 999;
    profile.distToFlip = spot - profile.gammaFlip;
    
    return profile;
  }
  
  // Predict flow direction from positioning
  static predictFlow(profile, ivChange = 0, hoursElapsed = 0) {
    let flow = 0;
    const reasons = [];
    
    // 1. Vanna flow from IV change
    if (ivChange !== 0) {
      const vannaEffect = profile.netVanna * ivChange;
      flow += vannaEffect;
      if (Math.abs(vannaEffect) > 0.5) {
        reasons.push(`Vanna: ${ivChange > 0 ? 'IV↑' : 'IV↓'} → ${vannaEffect > 0 ? 'BUY' : 'SELL'} flow`);
      }
    }
    
    // 2. Charm flow from time decay
    if (hoursElapsed > 0) {
      const charmEffect = profile.netCharm * (hoursElapsed / 6.5);
      flow += charmEffect;
      if (Math.abs(charmEffect) > 0.3) {
        reasons.push(`Charm: Time decay → ${charmEffect > 0 ? 'BUY' : 'SELL'} flow`);
      }
    }
    
    // 3. GEX regime effect
    if (profile.regime === 'NEGATIVE_GAMMA') {
      reasons.push('⚠️ -γ: Moves will EXTEND');
    } else if (profile.regime === 'POSITIVE_GAMMA') {
      reasons.push('✓ +γ: Moves will DAMPEN');
    }
    
    return { flow, reasons, direction: flow > 0 ? 'BUY' : flow < 0 ? 'SELL' : 'NEUTRAL' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SCENARIO DETECTION
// ═══════════════════════════════════════════════════════════════════════════════════════

class ScenarioDetector {
  
  // SCENARIO 1: Call Wall Rejection
  static detectCallWallRejection(candles, i, profile) {
    if (profile.distToCallWall > 12) return null;
    
    const c = candles[i];
    const prev = candles[i - 1];
    
    // Need rejection candle
    const body = c.c - c.o;
    const range = c.h - c.l || 0.01;
    const upperWick = c.h - Math.max(c.o, c.c);
    
    // Shooting star or bearish candle near wall
    const isRejection = (upperWick > Math.abs(body) * 1.5 && upperWick > range * 0.5) ||
                        (body < 0 && Math.abs(body) > range * 0.5 && prev.c > prev.o);
    
    if (!isRejection) return null;
    
    // Check volume
    const avgVol = candles.slice(i - 10, i).reduce((s, x) => s + x.v, 0) / 10;
    const volRatio = c.v / avgVol;
    
    let conf = 50;
    const reasons = [];
    
    // Distance to wall
    if (profile.distToCallWall <= 5) { conf += 25; reasons.push(`🧱 AT Call Wall (${profile.callWall})`); }
    else if (profile.distToCallWall <= 10) { conf += 15; reasons.push(`🧱 Near Call Wall`); }
    
    // Wall strength
    if (profile.callWallGEX > 1.5) { conf += 10; reasons.push(`💪 Strong Wall (${profile.callWallGEX.toFixed(1)}B GEX)`); }
    
    // Rejection type
    if (upperWick > range * 0.6) { conf += 15; reasons.push('🔴 Shooting Star'); }
    else if (body < 0) { conf += 10; reasons.push('🔴 Bearish Close'); }
    
    // Volume
    if (volRatio > 1.8) { conf += 10; reasons.push(`💥 Vol Spike (${volRatio.toFixed(1)}x)`); }
    
    // Regime
    if (profile.regime === 'POSITIVE_GAMMA') { conf += 5; reasons.push('+γ Mean Revert'); }
    
    if (conf < 70) return null;
    
    return {
      scenario: 'CALL_WALL_REJECTION',
      dir: 'SHORT',
      conf: Math.min(95, conf),
      reasons,
      target: Math.min(profile.gammaFlip, profile.putWall || profile.gammaFlip) - c.c,
      wallLevel: profile.callWall,
    };
  }
  
  // SCENARIO 2: Put Wall Bounce
  static detectPutWallBounce(candles, i, profile) {
    if (profile.distToPutWall > 12) return null;
    
    const c = candles[i];
    const prev = candles[i - 1];
    
    const body = c.c - c.o;
    const range = c.h - c.l || 0.01;
    const lowerWick = Math.min(c.o, c.c) - c.l;
    
    // Hammer or bullish candle near wall
    const isRejection = (lowerWick > Math.abs(body) * 1.5 && lowerWick > range * 0.5) ||
                        (body > 0 && Math.abs(body) > range * 0.5 && prev.c < prev.o);
    
    if (!isRejection) return null;
    
    const avgVol = candles.slice(i - 10, i).reduce((s, x) => s + x.v, 0) / 10;
    const volRatio = c.v / avgVol;
    
    let conf = 50;
    const reasons = [];
    
    if (profile.distToPutWall <= 5) { conf += 25; reasons.push(`💎 AT Put Wall (${profile.putWall})`); }
    else if (profile.distToPutWall <= 10) { conf += 15; reasons.push(`💎 Near Put Wall`); }
    
    if (profile.putWallGEX > 1.5) { conf += 10; reasons.push(`💪 Strong Wall (${profile.putWallGEX.toFixed(1)}B GEX)`); }
    
    if (lowerWick > range * 0.6) { conf += 15; reasons.push('🟢 Hammer'); }
    else if (body > 0) { conf += 10; reasons.push('🟢 Bullish Close'); }
    
    if (volRatio > 1.8) { conf += 10; reasons.push(`💥 Vol Spike (${volRatio.toFixed(1)}x)`); }
    
    if (conf < 70) return null;
    
    return {
      scenario: 'PUT_WALL_BOUNCE',
      dir: 'LONG',
      conf: Math.min(95, conf),
      reasons,
      target: Math.max(profile.gammaFlip, profile.callWall || profile.gammaFlip) - c.c,
      wallLevel: profile.putWall,
    };
  }
  
  // SCENARIO 3: Gamma Flip Break
  static detectGammaFlipBreak(candles, i, profile, prevProfile) {
    if (!prevProfile) return null;
    
    const c = candles[i];
    const prev = candles[i - 1];
    
    // Check if we crossed the flip
    const crossedUp = prev.c < profile.gammaFlip && c.c > profile.gammaFlip;
    const crossedDown = prev.c > profile.gammaFlip && c.c < profile.gammaFlip;
    
    if (!crossedUp && !crossedDown) return null;
    
    // Need momentum
    const body = c.c - c.o;
    const range = c.h - c.l || 0.01;
    if (Math.abs(body) < range * 0.5) return null;
    
    const avgVol = candles.slice(i - 10, i).reduce((s, x) => s + x.v, 0) / 10;
    const volRatio = c.v / avgVol;
    
    let conf = 55;
    const reasons = [];
    
    reasons.push(`⚡ Crossed γ-Flip (${profile.gammaFlip})`);
    
    if (crossedUp) {
      conf += 10;
      reasons.push('↗️ Now in +γ territory');
      // In positive gamma, we expect mean reversion, so this might NOT be a continuation
      // But the initial break often has momentum
    } else {
      conf += 15;
      reasons.push('↘️ Now in -γ territory (moves extend!)');
    }
    
    if (Math.abs(body) > range * 0.7) { conf += 10; reasons.push('Strong bar'); }
    if (volRatio > 1.5) { conf += 10; reasons.push(`Vol ${volRatio.toFixed(1)}x`); }
    
    // Check momentum of last 3 bars
    const last3Net = c.c - candles[i-2].o;
    if (Math.abs(last3Net) > 5) { conf += 10; reasons.push(`Momentum ${last3Net > 0 ? '+' : ''}${last3Net.toFixed(0)}`); }
    
    if (conf < 68) return null;
    
    return {
      scenario: 'GAMMA_FLIP_BREAK',
      dir: crossedUp ? 'LONG' : 'SHORT',
      conf: Math.min(95, conf),
      reasons,
      target: crossedUp ? profile.distToCallWall : profile.distToPutWall,
      flipLevel: profile.gammaFlip,
    };
  }
  
  // SCENARIO 4: Vanna Squeeze
  static detectVannaFlow(candles, i, profile, ivChange) {
    if (Math.abs(ivChange) < 0.005) return null; // Need significant IV change
    
    const c = candles[i];
    
    // Predict dealer flow from IV change
    const vannaEffect = profile.netVanna * ivChange * 100; // Scale up
    if (Math.abs(vannaEffect) < 0.5) return null;
    
    // Confirm price is moving in direction of expected flow
    const body = c.c - c.o;
    const expectedDir = vannaEffect > 0 ? 'UP' : 'DOWN';
    const actualDir = body > 0 ? 'UP' : 'DOWN';
    
    if (expectedDir !== actualDir) return null;
    
    let conf = 55;
    const reasons = [];
    
    if (ivChange < -0.01) {
      reasons.push(`📉 IV Crush (${(ivChange * 100).toFixed(1)}%)`);
      conf += 10;
    } else if (ivChange > 0.01) {
      reasons.push(`📈 IV Spike (${(ivChange * 100).toFixed(1)}%)`);
      conf += 10;
    } else {
      reasons.push(`IV Change: ${(ivChange * 100).toFixed(2)}%`);
    }
    
    reasons.push(`Vanna Flow: ${vannaEffect > 0 ? 'BUY' : 'SELL'}`);
    
    // Confirm with price action
    const avgVol = candles.slice(i - 10, i).reduce((s, x) => s + x.v, 0) / 10;
    const volRatio = c.v / avgVol;
    
    if (Math.abs(body) > 2) { conf += 10; reasons.push('Price confirms'); }
    if (volRatio > 1.3) { conf += 5; reasons.push(`Vol ${volRatio.toFixed(1)}x`); }
    
    // Stronger in negative gamma
    if (profile.regime === 'NEGATIVE_GAMMA') { conf += 10; reasons.push('-γ Amplifies'); }
    
    if (conf < 65) return null;
    
    return {
      scenario: 'VANNA_SQUEEZE',
      dir: vannaEffect > 0 ? 'LONG' : 'SHORT',
      conf: Math.min(90, conf),
      reasons,
      target: Math.abs(vannaEffect) * 5, // Rough estimate
      ivChange,
    };
  }
  
  // SCENARIO 5: Charm Decay Flow
  static detectCharmFlow(candles, i, profile, isApproachingClose) {
    if (!isApproachingClose) return null;
    
    const c = candles[i];
    
    // Charm effect - how much delta hedging is needed
    const charmEffect = profile.netCharm * 0.5; // Per 30 min
    if (Math.abs(charmEffect) < 0.3) return null;
    
    const body = c.c - c.o;
    const expectedDir = charmEffect > 0 ? 'UP' : 'DOWN';
    const actualDir = body > 0.5 ? 'UP' : body < -0.5 ? 'DOWN' : 'FLAT';
    
    // Early confirmation or already moving
    let conf = 50;
    const reasons = [];
    
    reasons.push(`⏰ Charm Flow: ${charmEffect > 0 ? 'BUY' : 'SELL'} into close`);
    
    if (actualDir === expectedDir) {
      conf += 15;
      reasons.push('Price confirming');
    }
    
    // Check if near a major strike (pin potential)
    const nearestStrike = Math.round(c.c / 5) * 5;
    const distToStrike = Math.abs(c.c - nearestStrike);
    if (distToStrike < 3) {
      conf += 10;
      reasons.push(`📌 Near ${nearestStrike} (pin risk)`);
    }
    
    // Time bonus
    const h = c.ts.getHours() + c.ts.getMinutes() / 60;
    if (h >= 15) { conf += 10; reasons.push('Last hour'); }
    else if (h >= 14.5) { conf += 5; reasons.push('Power hour'); }
    
    if (conf < 60) return null;
    
    return {
      scenario: 'CHARM_DECAY',
      dir: charmEffect > 0 ? 'LONG' : 'SHORT',
      conf: Math.min(85, conf),
      reasons,
      target: 10, // Charm moves tend to be smaller
      charmEffect,
    };
  }
  
  // SCENARIO 6: Dealer Flip
  static detectDealerFlip(profile, prevProfile) {
    if (!prevProfile) return null;
    
    // Check if net GEX flipped sign
    const flipped = (prevProfile.netGEX > 0.3 && profile.netGEX < -0.3) ||
                    (prevProfile.netGEX < -0.3 && profile.netGEX > 0.3);
    
    if (!flipped) return null;
    
    const reasons = [];
    let conf = 60;
    
    const newRegime = profile.netGEX > 0 ? 'POSITIVE' : 'NEGATIVE';
    reasons.push(`🔄 Dealer Flip → ${newRegime} γ`);
    
    if (newRegime === 'NEGATIVE') {
      conf += 15;
      reasons.push('⚠️ Expect extended moves');
    } else {
      conf += 10;
      reasons.push('Expect mean reversion');
    }
    
    return {
      scenario: 'DEALER_FLIP',
      dir: 'TREND', // Follow the prevailing trend
      conf,
      reasons,
      target: 20,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SIGNAL GENERATOR (Combines all scenarios)
// ═══════════════════════════════════════════════════════════════════════════════════════

const detectSignal = (candles, i, iv = 0.15, prevIV = 0.15, prevProfile = null) => {
  if (i < 15) return null;
  
  const c = candles[i];
  const h = c.ts.getHours() + c.ts.getMinutes() / 60;
  const dow = c.ts.getDay();
  
  // Time filters
  if (dow === 0 || dow === 6) return null;
  if (dow === 5 && h > 14) return null;
  if (h >= 11.75 && h < 14.25) return null; // Lunch
  
  // Build dealer profile
  const profile = DealerPositioning.buildProfile(c.c, iv, 1/365);
  const ivChange = iv - prevIV;
  const isApproachingClose = h >= 14.5;
  
  // Check all scenarios (priority order)
  let signal = null;
  
  // 1. Wall rejections (highest probability)
  signal = ScenarioDetector.detectCallWallRejection(candles, i, profile);
  if (signal?.conf >= 75) {
    return { ...signal, profile, entry: c.c, bar: i };
  }
  
  signal = ScenarioDetector.detectPutWallBounce(candles, i, profile);
  if (signal?.conf >= 75) {
    return { ...signal, profile, entry: c.c, bar: i };
  }
  
  // 2. Gamma flip breaks
  signal = ScenarioDetector.detectGammaFlipBreak(candles, i, profile, prevProfile);
  if (signal?.conf >= 72) {
    return { ...signal, profile, entry: c.c, bar: i };
  }
  
  // 3. Vanna squeeze
  signal = ScenarioDetector.detectVannaFlow(candles, i, profile, ivChange);
  if (signal?.conf >= 70) {
    return { ...signal, profile, entry: c.c, bar: i };
  }
  
  // 4. Charm decay
  signal = ScenarioDetector.detectCharmFlow(candles, i, profile, isApproachingClose);
  if (signal?.conf >= 68) {
    return { ...signal, profile, entry: c.c, bar: i };
  }
  
  return null;
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// TRADE CLASS
// ═══════════════════════════════════════════════════════════════════════════════════════

class Trade {
  constructor(sig) {
    Object.assign(this, sig);
    this.actualEntry = this.entry + (this.dir === 'LONG' ? 0.35 : -0.35);
    this.stop = this.dir === 'LONG' ? this.actualEntry - 8 : this.actualEntry + 8;
    this.tp1 = this.dir === 'LONG' ? this.actualEntry + 15 : this.actualEntry - 15;
    this.tp2 = this.dir === 'LONG' ? this.actualEntry + 30 : this.actualEntry - 30;
    this.curStop = this.stop;
    this.maxFav = 0;
    this.bars = 0;
    this.status = 'ACTIVE';
    this.scales = { tp1: false };
    this.log = [
      `${this.dir === 'LONG' ? '🟢' : '🔴'} ${this.scenario} @ ${this.actualEntry.toFixed(2)} | ${this.conf}%`,
      `   ${this.reasons.join(' | ')}`,
    ];
  }
  
  update(c) {
    if (this.status !== 'ACTIVE') return this;
    this.bars++;
    
    const pnl = this.dir === 'LONG' ? c.c - this.actualEntry : this.actualEntry - c.c;
    const maxP = this.dir === 'LONG' ? c.h - this.actualEntry : this.actualEntry - c.l;
    if (maxP > this.maxFav) this.maxFav = maxP;
    
    // Stop
    const stopped = this.dir === 'LONG' ? c.l <= this.curStop : c.h >= this.curStop;
    if (stopped) {
      const exitPnL = this.scales.tp1 ? Math.max(8, this.curStop - (this.dir === 'LONG' ? 1 : -1) * this.actualEntry) 
                                      : (this.dir === 'LONG' ? this.curStop - this.actualEntry : this.actualEntry - this.curStop);
      return this.close(this.curStop, this.scales.tp1 ? 'TRAIL' : 'STOP', exitPnL);
    }
    
    // TP1
    const tp1Hit = this.dir === 'LONG' ? c.h >= this.tp1 : c.l <= this.tp1;
    if (!this.scales.tp1 && tp1Hit) {
      this.scales.tp1 = true;
      this.curStop = this.dir === 'LONG' ? this.actualEntry + 8 : this.actualEntry - 8;
      this.log.push(`✅ TP1 +15pts | Lock +8`);
    }
    
    // BE at +7
    if (this.maxFav >= 7 && !this.scales.tp1) {
      const newStop = this.dir === 'LONG' ? this.actualEntry + 1 : this.actualEntry - 1;
      if ((this.dir === 'LONG' && newStop > this.curStop) || (this.dir === 'SHORT' && newStop < this.curStop)) {
        this.curStop = newStop;
      }
    }
    
    // Trail after TP1
    if (this.scales.tp1) {
      const trail = this.dir === 'LONG' ? c.c - 6 : c.c + 6;
      if ((this.dir === 'LONG' && trail > this.curStop) || (this.dir === 'SHORT' && trail < this.curStop)) {
        this.curStop = trail;
      }
    }
    
    // Time/EOD
    if (this.bars >= 35) return this.close(c.c, 'TIME', pnl);
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
    
    const icon = pnlPts >= 25 ? '💎' : pnlPts >= 15 ? '🏆' : pnlPts > 0 ? '✅' : '❌';
    this.log.push(`${icon} ${reason}: ${pnlPts >= 0 ? '+' : ''}${pnlPts.toFixed(1)}pts ($${this.pnl$.toFixed(0)})`);
    return this;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// DATA GENERATION
// ═══════════════════════════════════════════════════════════════════════════════════════

const generateData = (days, start = 6000) => {
  const data = [];
  let price = start, trend = 0;
  
  for (let d = days; d >= 0; d--) {
    const date = new Date(); date.setDate(date.getDate() - d);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    trend = trend * 0.6 + (random() - 0.5) * 0.006;
    const dayOpen = price;
    let dayTrend = (random() - 0.5) * 0.003;
    
    for (let bar = 0; bar < 78; bar++) {
      const h = 9 + Math.floor((30 + bar * 5) / 60);
      const m = (30 + bar * 5) % 60;
      
      let iv = 1.0;
      if (bar < 12) iv = 2.2;
      else if (bar >= 18 && bar < 27) { iv = 1.8; if (bar === 22 && random() < 0.35) dayTrend = -dayTrend * 1.5; }
      else if (bar >= 27 && bar < 60) iv = 0.25;
      else if (bar >= 60) { iv = 1.6; if (bar === 65 && random() < 0.25) dayTrend = -dayTrend; }
      
      const vol = 0.0007 * iv;
      const change = (random() - 0.48 + trend + dayTrend) * vol * price;
      
      const open = price;
      const move = change * (1 + random() * 0.5);
      const noise = price * vol * random() * 0.2;
      
      let high, low, close;
      if (change >= 0) {
        close = price + move; high = Math.max(open, close) + noise; low = Math.min(open, close) - noise * 0.2;
      } else {
        close = price + move; low = Math.min(open, close) - noise; high = Math.max(open, close) + noise * 0.2;
      }
      
      price = close;
      data.push({
        ts: new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m),
        o: +open.toFixed(2), h: +high.toFixed(2), l: +low.toFixed(2), c: +close.toFixed(2),
        v: Math.floor((2e6 + random() * 3e6) * (bar < 12 ? 2.5 : bar > 60 ? 1.8 : bar > 27 && bar < 60 ? 0.3 : 1)),
        bar,
      });
    }
  }
  return data;
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════════════════════════════════

const run = (days = 180) => {
  console.clear();
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║         🎯 TITAN OMEGA - DEALER FLOW DETECTOR                                         ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  DETECTS 6 SCENARIOS BASED ON DEALER POSITIONING:                                     ║
║                                                                                       ║
║  1️⃣  CALL_WALL_REJECTION  │ Price at call wall → Dealers sell → Reversal DOWN         ║
║  2️⃣  PUT_WALL_BOUNCE      │ Price at put wall  → Dealers buy  → Reversal UP           ║
║  3️⃣  GAMMA_FLIP_BREAK     │ Cross γ-flip       → Regime change → Acceleration         ║
║  4️⃣  VANNA_SQUEEZE        │ IV change          → Delta cascade → Trend extend         ║
║  5️⃣  CHARM_DECAY          │ Time decay         → EOD hedging   → Pin/Move             ║
║  6️⃣  DEALER_FLIP          │ Net GEX flips      → New regime    → Directional          ║
║                                                                                       ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝
`);
  
  console.log('⏳ Generating data with dealer flow patterns...');
  const candles = generateData(days);
  console.log(`✅ ${candles.length.toLocaleString()} candles\n`);
  
  const trades = [];
  let current = null;
  let lastBar = -10;
  let prevProfile = null;
  let iv = 0.15, prevIV = 0.15;
  
  for (let i = 15; i < candles.length - 5; i++) {
    const c = candles[i];
    
    // Simulate IV changes
    if (random() < 0.1) {
      prevIV = iv;
      iv = Math.max(0.10, Math.min(0.25, iv + (random() - 0.5) * 0.02));
    }
    
    if (current?.status === 'ACTIVE') {
      current.update(c);
      if (current.status === 'CLOSED') {
        trades.push(current);
        prevProfile = current.profile;
        lastBar = i;
        current = null;
      }
      continue;
    }
    
    if (i - lastBar < 8) continue;
    
    const sig = detectSignal(candles, i, iv, prevIV, prevProfile);
    if (sig) {
      current = new Trade(sig);
      prevProfile = sig.profile;
    }
  }
  
  // Stats
  const byScenario = {};
  trades.forEach(t => {
    if (!byScenario[t.scenario]) byScenario[t.scenario] = { n: 0, pts: 0, wins: 0, big: 0 };
    byScenario[t.scenario].n++;
    byScenario[t.scenario].pts += t.finalPnL;
    if (t.finalPnL > 0) byScenario[t.scenario].wins++;
    if (t.isBigWin) byScenario[t.scenario].big++;
  });
  
  const wins = trades.filter(t => t.finalPnL > 0);
  const bigWins = trades.filter(t => t.isBigWin);
  const totalPts = trades.reduce((s, t) => s + t.finalPnL, 0);
  const total$ = trades.reduce((s, t) => s + t.pnl$, 0);
  const wr = trades.length ? wins.length / trades.length * 100 : 0;
  const bigRate = trades.length ? bigWins.length / trades.length * 100 : 0;
  
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.finalPnL, 0) / wins.length : 0;
  const losses = trades.filter(t => t.finalPnL <= 0);
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.finalPnL, 0) / losses.length) : 0;
  const pf = avgLoss > 0 && losses.length ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║                         📊 DEALER FLOW RESULTS                                        ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  Total Signals:         ${String(trades.length).padStart(8)}                                                  ║
║  Win Rate:              ${wr.toFixed(1).padStart(8)}%                                                 ║
║  15+ Point Rate:        ${bigRate.toFixed(1).padStart(8)}%                                                 ║
║  Profit Factor:         ${pf.toFixed(2).padStart(9)}                                                  ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  Total Points:          ${(totalPts >= 0 ? '+' : '') + totalPts.toFixed(1).padStart(8)}                                                ║
║  Total P&L:             ${(total$ >= 0 ? '+$' : '-$') + Math.abs(total$).toFixed(0).padStart(7)}                                                 ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  📊 BY SCENARIO:                                                                      ║`);

  Object.entries(byScenario).sort((a, b) => b[1].pts - a[1].pts).forEach(([k, v]) => {
    const sWR = v.n ? (v.wins / v.n * 100).toFixed(0) : 0;
    console.log(`║  ${k.padEnd(22)} │ ${String(v.n).padStart(3)} │ ${(v.pts >= 0 ? '+' : '') + v.pts.toFixed(0).padStart(5)}pts │ ${sWR}% WR │ ${v.big} big │`);
  });

  console.log(`║                                                                                       ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  📜 SAMPLE TRADES:                                                                    ║`);

  bigWins.slice(0, 4).forEach(t => t.log.forEach(l => console.log(`║  ${l.slice(0, 80).padEnd(83)} ║`)));

  const grade = wr >= 65 && pf >= 2.5 ? '🏆 S' : wr >= 55 && pf >= 2.0 ? '🌟 A' : wr >= 45 && pf >= 1.5 ? '✨ B' : '👍 C';

  console.log(`║                                                                                       ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║  GRADE: ${grade}                                                                          ║
║                                                                                       ║
║  ${wr >= 60 ? '✅' : '⚠️'} Win Rate: ${wr.toFixed(1)}%    ${pf >= 2.0 ? '✅' : '⚠️'} PF: ${pf.toFixed(2)}    ${bigRate >= 15 ? '✅' : '⚠️'} 15pt: ${bigRate.toFixed(1)}%                  ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝

💡 BEST SETUPS: Wall rejections in prime time windows
🎯 KEY: Dealer positioning FORCES them to hedge → Creates predictable flows
`);
};

run(180);
