/**
 * GEX Calculator - Real-time Gamma Exposure Analysis
 * 
 * Calculates dealer positioning from REAL options data
 * Falls back to model-based estimates only when real data unavailable
 */

// Black-Scholes helpers
const normalCDF = (x) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
};

const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

// Calculate option Greeks using Black-Scholes
export const calculateGreeks = (S, K, T, r, sigma, isCall) => {
  if (T <= 0) T = 1 / 365 / 24;
  if (sigma <= 0) sigma = 0.15;
  
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const nd1 = normalPDF(d1);

  return {
    delta: isCall ? normalCDF(d1) : normalCDF(d1) - 1,
    gamma: nd1 / (S * sigma * sqrtT),
    vega: S * sqrtT * nd1 / 100,
    theta: isCall
      ? (-S * nd1 * sigma / (2 * sqrtT) - r * K * Math.exp(-r * T) * normalCDF(d2)) / 365
      : (-S * nd1 * sigma / (2 * sqrtT) + r * K * Math.exp(-r * T) * (1 - normalCDF(d2))) / 365,
    vanna: (nd1 / S) * (1 - d1 / (sigma * sqrtT)),
    charm: -nd1 * (2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT),
  };
};

/**
 * Build GEX profile from real options data or model estimates
 * 
 * @param {number} spot - Current SPX spot price
 * @param {Array} optionsChain - Real options chain from Polygon (if available)
 * @param {number} iv - Implied volatility (from VIX)
 * @returns {Object} GEX profile with all key levels
 */
export const buildGEXProfile = (spot, optionsChain = null, iv = 0.15) => {
  const T = 1 / 365; // Focus on 0DTE
  const r = 0.05;

  const profile = {
    spot,
    timestamp: new Date(),
    iv,
    dataSource: optionsChain?.length > 0 ? 'REAL' : 'MODEL',
    
    // Key levels
    gammaFlip: spot,
    callWall: null,
    putWall: null,
    
    // Exposures (in billions/millions)
    netGEX: 0,
    netDEX: 0,
    netVEX: 0,
    netVanna: 0,
    netCharm: 0,
    
    // Wall strengths
    callWallGEX: 0,
    putWallGEX: 0,
    
    // Strike data for heatmap
    strikes: [],
    gexByStrike: {},
    
    // Derived
    regime: 'NEUTRAL',
    vannaFlow: 0,
    charmFlow: 0,
  };

  let minAbsGEX = Infinity;

  // ═══════════════════════════════════════════════════════════════════════════════════
  // USE REAL OPTIONS DATA IF AVAILABLE
  // ═══════════════════════════════════════════════════════════════════════════════════
  
  if (optionsChain && optionsChain.length > 0) {
    console.log(`📊 Building GEX from ${optionsChain.length} REAL options contracts`);
    
    for (const opt of optionsChain) {
      const strike = opt.strike;
      if (!strike) continue;
      
      // Convert SPY strikes to SPX (SPY * 10)
      const scaledStrike = strike * 10;
      const dist = Math.abs(scaledStrike - spot);
      if (dist > 150) continue;

      const isCall = opt.type === 'call';
      const oi = opt.openInterest || 0;
      
      // Use real Greeks if available, otherwise calculate
      let gamma = opt.greeks?.gamma;
      let delta = opt.greeks?.delta;
      let vega = opt.greeks?.vega;
      let vanna = opt.greeks?.vanna;
      let charm = opt.greeks?.charm;
      
      if (!gamma) {
        const optIv = opt.impliedVol || iv;
        const greeks = calculateGreeks(spot, scaledStrike, T, r, optIv, isCall);
        gamma = greeks.gamma;
        delta = greeks.delta;
        vega = greeks.vega;
        vanna = greeks.vanna;
        charm = greeks.charm;
      }
      
      // GEX: Dealers are SHORT retail options
      const gex = isCall 
        ? -gamma * oi * 100 * spot  // Short calls = negative gamma
        : gamma * oi * 100 * spot;   // Short puts = positive gamma (they hedge by buying)
      
      const dex = isCall ? -delta * oi * 100 : -delta * oi * 100;
      const vex = -vega * oi * 100;
      const vannaExp = vanna ? -vanna * oi * 100 : 0;
      const charmExp = charm ? -charm * oi * 100 : 0;

      // Accumulate
      profile.netGEX += gex / 1e9;
      profile.netDEX += dex / 1e6;
      profile.netVEX += vex / 1e6;
      profile.netVanna += vannaExp / 1e6;
      profile.netCharm += charmExp / 1e6;

      // Track by strike
      if (!profile.gexByStrike[scaledStrike]) {
        profile.gexByStrike[scaledStrike] = 0;
      }
      profile.gexByStrike[scaledStrike] += gex / 1e9;

      // Find gamma flip
      const strikeGEX = profile.gexByStrike[scaledStrike];
      if (Math.abs(strikeGEX) < minAbsGEX && dist < 50) {
        minAbsGEX = Math.abs(strikeGEX);
        profile.gammaFlip = scaledStrike;
      }

      // Find walls
      const absGEX = Math.abs(gex);
      if (isCall && scaledStrike > spot && absGEX > profile.callWallGEX) {
        profile.callWallGEX = absGEX / 1e9;
        profile.callWall = scaledStrike;
      }
      if (!isCall && scaledStrike < spot && absGEX > profile.putWallGEX) {
        profile.putWallGEX = absGEX / 1e9;
        profile.putWall = scaledStrike;
      }
      
      profile.strikes.push({
        strike: scaledStrike,
        gex: gex / 1e9,
        callOI: isCall ? oi : 0,
        putOI: isCall ? 0 : oi,
        is100: scaledStrike % 100 === 0,
        is50: scaledStrike % 50 === 0,
        real: true,
      });
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════
  // MODEL-BASED ESTIMATES (when real data not available)
  // ═══════════════════════════════════════════════════════════════════════════════════
  
  else {
    console.log('📊 Building GEX from MODEL (real options data not available)');
    
    // Model based on typical dealer positioning at major strikes
    // This is based on observed patterns from SpotGamma/GEX research
    
    for (let i = -30; i <= 30; i++) {
      const K = Math.round(spot / 5) * 5 + i * 5;
      const dist = Math.abs(K - spot);
      if (dist > 120) continue;

      // OI clustering at round numbers
      const is100 = K % 100 === 0;
      const is50 = K % 50 === 0;
      const is25 = K % 25 === 0;
      const decay = Math.exp(-dist / 80);
      
      // Typical OI patterns (based on real market observations)
      let baseCallOI = is100 ? 25000 : is50 ? 15000 : is25 ? 8000 : 4000;
      let basePutOI = is100 ? 25000 : is50 ? 15000 : is25 ? 8000 : 4000;
      
      // Skew: more calls above spot, more puts below
      baseCallOI *= K > spot ? 1.5 : 0.5;
      basePutOI *= K < spot ? 1.5 : 0.5;
      
      // Add some realistic variation
      const seed = K * 31 + Math.floor(spot);
      const variation = 0.8 + ((seed % 100) / 250);
      
      const callOI = Math.floor(baseCallOI * decay * variation);
      const putOI = Math.floor(basePutOI * decay * variation);

      // Calculate Greeks
      const callGreeks = calculateGreeks(spot, K, T, r, iv, true);
      const putGreeks = calculateGreeks(spot, K, T, r, iv, false);

      // GEX calculation
      const callGEX = -callGreeks.gamma * callOI * 100 * spot;
      const putGEX = putGreeks.gamma * putOI * 100 * spot;
      const strikeGEX = (callGEX + putGEX) / 1e9;

      // Other exposures
      const dex = (-callGreeks.delta * callOI - putGreeks.delta * putOI) * 100 / 1e6;
      const vanna = (-callGreeks.vanna * callOI - putGreeks.vanna * putOI) * 100 / 1e6;
      const charm = (-callGreeks.charm * callOI - putGreeks.charm * putOI) * 100 / 1e6;

      profile.netGEX += strikeGEX;
      profile.netDEX += dex;
      profile.netVanna += vanna;
      profile.netCharm += charm;

      profile.gexByStrike[K] = strikeGEX;
      
      profile.strikes.push({
        strike: K,
        gex: strikeGEX,
        callOI,
        putOI,
        is100,
        is50,
        real: false,
      });

      // Find gamma flip
      if (Math.abs(strikeGEX) < minAbsGEX && dist < 50) {
        minAbsGEX = Math.abs(strikeGEX);
        profile.gammaFlip = K;
      }

      // Find walls
      if (K > spot && callOI > putOI * 1.5 && Math.abs(strikeGEX) > profile.callWallGEX) {
        profile.callWallGEX = Math.abs(strikeGEX);
        profile.callWall = K;
      }
      if (K < spot && putOI > callOI * 1.5 && Math.abs(strikeGEX) > profile.putWallGEX) {
        profile.putWallGEX = Math.abs(strikeGEX);
        profile.putWall = K;
      }
    }
  }

  // Sort strikes high to low
  profile.strikes.sort((a, b) => b.strike - a.strike);

  // Determine gamma regime
  if (profile.netGEX > 0.5) {
    profile.regime = 'POSITIVE_GAMMA';
  } else if (profile.netGEX < -0.5) {
    profile.regime = 'NEGATIVE_GAMMA';
  } else {
    profile.regime = 'NEUTRAL';
  }

  // Calculate distances
  profile.distToCallWall = profile.callWall ? profile.callWall - spot : 999;
  profile.distToPutWall = profile.putWall ? spot - profile.putWall : 999;
  profile.distToFlip = spot - profile.gammaFlip;
  profile.aboveFlip = spot > profile.gammaFlip;

  // Predict flows
  profile.vannaFlow = profile.netVanna * 0.01; // Per 1% IV change
  profile.charmFlow = profile.netCharm * (1 / 6.5); // Per hour of trading

  return profile;
};

/**
 * Detect trading scenarios based on GEX profile
 */
export const detectScenarios = (profile, candle, prevCandle) => {
  const scenarios = [];
  const { spot, callWall, putWall, gammaFlip, regime } = profile;

  // Get current time info
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  const dow = now.getDay();
  
  const isPrimeTime = (h >= 11 && h < 11.75) || (h >= 14.5 && h < 15.25);
  const isLunch = h >= 11.75 && h < 14;
  const isWeekend = dow === 0 || dow === 6;
  const isFriday = dow === 5;

  // Candle analysis
  const body = candle ? candle.close - candle.open : 0;
  const range = candle ? Math.max(candle.high - candle.low, 0.01) : 1;
  const upperWick = candle ? candle.high - Math.max(candle.open, candle.close) : 0;
  const lowerWick = candle ? Math.min(candle.open, candle.close) - candle.low : 0;

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SCENARIO 1: CALL WALL REJECTION (SHORT)
  // ═══════════════════════════════════════════════════════════════════════════════════
  if (callWall && profile.distToCallWall <= 10) {
    const isRejecting = upperWick > Math.abs(body) * 1.5 || (body < 0 && Math.abs(body) > range * 0.5);
    const isTouching = profile.distToCallWall <= 3;
    
    let confidence = 40;
    if (isTouching) confidence += 25;
    else if (profile.distToCallWall <= 6) confidence += 15;
    if (isRejecting) confidence += 20;
    if (isPrimeTime) confidence += 15;
    if (regime === 'POSITIVE_GAMMA') confidence += 5;
    
    scenarios.push({
      id: 'CALL_WALL_REJECTION',
      name: 'Call Wall Rejection',
      icon: '🧱',
      direction: 'SHORT',
      active: profile.distToCallWall <= 5,
      alert: isRejecting && isPrimeTime && isTouching && confidence >= 80,
      confidence: Math.min(98, confidence),
      description: `Price ${profile.distToCallWall.toFixed(1)} pts from Call Wall (${callWall})`,
      target: gammaFlip,
      targetPts: spot - gammaFlip,
      entry: spot,
      stop: callWall + 3,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SCENARIO 2: PUT WALL BOUNCE (LONG)
  // ═══════════════════════════════════════════════════════════════════════════════════
  if (putWall && profile.distToPutWall <= 10) {
    const isBouncing = lowerWick > Math.abs(body) * 1.5 || (body > 0 && Math.abs(body) > range * 0.5);
    const isTouching = profile.distToPutWall <= 3;
    
    let confidence = 40;
    if (isTouching) confidence += 25;
    else if (profile.distToPutWall <= 6) confidence += 15;
    if (isBouncing) confidence += 20;
    if (isPrimeTime) confidence += 15;
    if (regime === 'POSITIVE_GAMMA') confidence += 5;
    
    scenarios.push({
      id: 'PUT_WALL_BOUNCE',
      name: 'Put Wall Bounce',
      icon: '💎',
      direction: 'LONG',
      active: profile.distToPutWall <= 5,
      alert: isBouncing && isPrimeTime && isTouching && confidence >= 80,
      confidence: Math.min(98, confidence),
      description: `Price ${profile.distToPutWall.toFixed(1)} pts from Put Wall (${putWall})`,
      target: gammaFlip,
      targetPts: gammaFlip - spot,
      entry: spot,
      stop: putWall - 3,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SCENARIO 3: GAMMA FLIP CROSS
  // ═══════════════════════════════════════════════════════════════════════════════════
  if (Math.abs(profile.distToFlip) <= 8) {
    const crossingUp = prevCandle && prevCandle.close < gammaFlip && candle?.close > gammaFlip;
    const crossingDown = prevCandle && prevCandle.close > gammaFlip && candle?.close < gammaFlip;
    
    let confidence = 35;
    if (Math.abs(profile.distToFlip) <= 3) confidence += 20;
    if (crossingUp || crossingDown) confidence += 25;
    if (!isLunch) confidence += 10;
    
    scenarios.push({
      id: 'GAMMA_FLIP_CROSS',
      name: 'Gamma Flip Zone',
      icon: '⚡',
      direction: crossingUp ? 'LONG' : crossingDown ? 'SHORT' : 'WATCH',
      active: Math.abs(profile.distToFlip) <= 3,
      alert: (crossingUp || crossingDown) && !isLunch && confidence >= 70,
      confidence: Math.min(90, confidence),
      description: `${profile.aboveFlip ? 'Above' : 'Below'} γ-Flip (${gammaFlip}) by ${Math.abs(profile.distToFlip).toFixed(1)} pts`,
      target: profile.aboveFlip ? callWall : putWall,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SCENARIO 4: VANNA SQUEEZE
  // ═══════════════════════════════════════════════════════════════════════════════════
  if (Math.abs(profile.vannaFlow) > 0.1) {
    scenarios.push({
      id: 'VANNA_SQUEEZE',
      name: 'Vanna Flow',
      icon: '🌊',
      direction: profile.vannaFlow > 0 ? 'LONG' : 'SHORT',
      active: Math.abs(profile.vannaFlow) > 0.2,
      alert: false,
      confidence: Math.min(75, 40 + Math.abs(profile.vannaFlow) * 100),
      description: `IV change → ${profile.vannaFlow > 0 ? 'BUY' : 'SELL'} pressure from delta hedging`,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SCENARIO 5: CHARM DECAY (EOD flows)
  // ═══════════════════════════════════════════════════════════════════════════════════
  if (h >= 14 && Math.abs(profile.charmFlow) > 0.1) {
    const isLastHour = h >= 15;
    
    scenarios.push({
      id: 'CHARM_DECAY',
      name: 'Charm Decay',
      icon: '⏰',
      direction: profile.charmFlow > 0 ? 'LONG' : 'SHORT',
      active: isLastHour,
      alert: false,
      confidence: Math.min(80, 40 + Math.abs(profile.charmFlow) * 50 + (isLastHour ? 20 : 0)),
      description: `Time decay → ${profile.charmFlow > 0 ? 'BUY' : 'SELL'} flow into close`,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SCENARIO 6: REGIME
  // ═══════════════════════════════════════════════════════════════════════════════════
  scenarios.push({
    id: 'REGIME',
    name: regime === 'POSITIVE_GAMMA' ? 'Positive Gamma' : regime === 'NEGATIVE_GAMMA' ? 'Negative Gamma' : 'Neutral Gamma',
    icon: regime === 'POSITIVE_GAMMA' ? '✅' : regime === 'NEGATIVE_GAMMA' ? '⚠️' : '➖',
    direction: regime === 'POSITIVE_GAMMA' ? 'FADE' : regime === 'NEGATIVE_GAMMA' ? 'TREND' : 'NEUTRAL',
    active: true,
    alert: false,
    confidence: Math.min(85, 50 + Math.abs(profile.netGEX) * 20),
    description: regime === 'POSITIVE_GAMMA' 
      ? 'Dealers DAMPEN moves → Fade extremes, mean reversion' 
      : regime === 'NEGATIVE_GAMMA' 
        ? 'Dealers AMPLIFY moves → Trends extend, breakouts run' 
        : 'Balanced positioning → Watch for regime change',
  });

  // Sort by confidence
  return scenarios.filter(s => s.confidence > 0).sort((a, b) => b.confidence - a.confidence);
};

export default { buildGEXProfile, detectScenarios, calculateGreeks };
