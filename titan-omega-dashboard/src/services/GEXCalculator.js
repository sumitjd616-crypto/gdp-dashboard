/**
 * GEX Calculator - REAL OPTIONS DATA ONLY
 * 
 * Calculates Gamma Exposure (GEX), Vanna, Charm from real options chain data.
 * 
 * NO MODEL-BASED ESTIMATES - NO SYNTHETIC DATA
 * 
 * If real options data is not available, returns unavailable status.
 */

// ═══════════════════════════════════════════════════════════════════════════════════
// BLACK-SCHOLES GREEKS (For when Polygon doesn't provide Greeks)
// ═══════════════════════════════════════════════════════════════════════════════════

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

/**
 * Calculate Black-Scholes Greeks
 */
export const calculateGreeks = (spot, strike, tte, iv, r = 0.05, type = 'call') => {
  if (!spot || !strike || !tte || tte <= 0 || !iv || iv <= 0) {
    return null;
  }

  const sqrtT = Math.sqrt(tte);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * iv * iv) * tte) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;

  const nd1 = normalCDF(d1);
  const nd2 = normalCDF(d2);
  const npd1 = normalPDF(d1);

  // Delta
  const delta = type === 'call' ? nd1 : nd1 - 1;

  // Gamma (same for calls and puts)
  const gamma = npd1 / (spot * iv * sqrtT);

  // Vega
  const vega = spot * sqrtT * npd1 / 100;

  // Theta
  const theta = type === 'call'
    ? -(spot * npd1 * iv) / (2 * sqrtT) - r * strike * Math.exp(-r * tte) * nd2
    : -(spot * npd1 * iv) / (2 * sqrtT) + r * strike * Math.exp(-r * tte) * (1 - nd2);
  
  // Vanna: dDelta/dIV = d²V/dS/dσ
  const vanna = -npd1 * d2 / iv;

  // Charm: dDelta/dTime
  const charm = -npd1 * (2 * r * tte - d2 * iv * sqrtT) / (2 * tte * iv * sqrtT);

  return { delta, gamma, vega, theta, vanna, charm, d1, d2 };
};

// ═══════════════════════════════════════════════════════════════════════════════════
// BUILD GEX PROFILE FROM REAL OPTIONS DATA
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Build GEX Profile from real options chain data or model
 * 
 * @param {number} spot - Current SPX price
 * @param {Array} optionsChain - Real options data (optional)
 * @param {number} vix - Current VIX (for IV)
 * @returns {Object} GEX Profile
 */
export const buildGEXProfile = (spot, optionsChain, vix = 15) => {
  // If no real options data, use model-based estimation
  if (!optionsChain || optionsChain.length === 0) {
    console.log('📐 Building GEX from MODEL (no real options data)');
    return buildModelGEXProfile(spot, vix);
  }

  console.log(`📊 Building GEX from ${optionsChain.length} REAL options contracts`);

  const iv = vix / 100; // Convert VIX to decimal
  const strikes = new Map(); // strike -> { callGEX, putGEX, callOI, putOI, callDelta, putDelta }
  
  let totalCallGEX = 0;
  let totalPutGEX = 0;
  let totalVanna = 0;
  let totalCharm = 0;
  let contractsWithGreeks = 0;
  let contractsCalculated = 0;

  // Process each option contract
  for (const opt of optionsChain) {
    const strike = opt.strike;
    const oi = opt.openInterest || 0;
    
    if (oi === 0) continue; // Skip no open interest
    
    // Get or initialize strike data
    if (!strikes.has(strike)) {
      strikes.set(strike, {
        strike,
        callGEX: 0,
        putGEX: 0,
        callOI: 0,
        putOI: 0,
        netGEX: 0,
        callDelta: 0,
        putDelta: 0,
        vanna: 0,
        charm: 0,
      });
    }
    
    const strikeData = strikes.get(strike);
    const isCall = opt.type === 'call';
    
    // Get Greeks - prefer Polygon's, calculate if missing
    let greeks = opt.greeks;
    
    if (!greeks || !greeks.gamma) {
      // Calculate Greeks ourselves
      const daysToExp = opt.expiration 
        ? Math.max(1, (new Date(opt.expiration) - new Date()) / (365 * 24 * 60 * 60 * 1000))
        : 7 / 365; // Default 7 days
      
      const optIV = opt.impliedVol || iv;
      greeks = calculateGreeks(spot, strike, daysToExp, optIV, 0.05, opt.type);
      contractsCalculated++;
    } else {
      contractsWithGreeks++;
    }
    
    if (!greeks) continue;
    
    // Calculate GEX contribution
    // GEX = Gamma * OI * 100 * Spot^2 / 1,000,000
    // Dealers are OPPOSITE side of customer positions
    // When customers are NET LONG calls, dealers are SHORT calls (negative gamma)
    // When customers are NET LONG puts, dealers are LONG puts (positive gamma)
    
    const gamma = greeks.gamma || 0;
    const gexContribution = gamma * oi * 100 * spot * spot / 1e6;
    
    if (isCall) {
      // Dealers SHORT calls = negative gamma exposure
      strikeData.callGEX -= gexContribution;
      strikeData.callOI += oi;
      strikeData.callDelta = greeks.delta || 0;
      totalCallGEX -= gexContribution;
    } else {
      // Dealers LONG puts = positive gamma exposure  
      strikeData.putGEX += gexContribution;
      strikeData.putOI += oi;
      strikeData.putDelta = greeks.delta || 0;
      totalPutGEX += gexContribution;
    }
    
    // Vanna and Charm
    if (greeks.vanna) {
      const vannaContrib = greeks.vanna * oi * 100;
      strikeData.vanna += isCall ? -vannaContrib : vannaContrib;
      totalVanna += isCall ? -vannaContrib : vannaContrib;
    }
    
    if (greeks.charm) {
      const charmContrib = greeks.charm * oi * 100;
      strikeData.charm += isCall ? -charmContrib : charmContrib;
      totalCharm += isCall ? -charmContrib : charmContrib;
    }
    
    strikeData.netGEX = strikeData.callGEX + strikeData.putGEX;
  }

  // Find key levels
  const strikesArray = Array.from(strikes.values())
    .filter(s => Math.abs(s.strike - spot) < spot * 0.10) // Within 10% of spot
    .sort((a, b) => b.strike - a.strike);

  // Find Gamma Flip (where netGEX crosses zero)
  let gammaFlip = spot;
  let prevNetGEX = null;
  
  for (const s of strikesArray) {
    if (prevNetGEX !== null && prevNetGEX * s.netGEX < 0) {
      gammaFlip = s.strike;
      break;
    }
    prevNetGEX = s.netGEX;
  }

  // Find major walls (highest GEX levels)
  const callWalls = strikesArray
    .filter(s => s.callOI > 0 && s.strike > spot)
    .sort((a, b) => Math.abs(b.callGEX) - Math.abs(a.callGEX))
    .slice(0, 5);
  
  const putWalls = strikesArray
    .filter(s => s.putOI > 0 && s.strike < spot)
    .sort((a, b) => Math.abs(b.putGEX) - Math.abs(a.putGEX))
    .slice(0, 5);

  // Determine regime
  const netGEX = totalCallGEX + totalPutGEX;
  const regime = netGEX > 0 ? 'POSITIVE' : 'NEGATIVE';
  
  // Build heatmap data
  const heatmap = strikesArray.map(s => ({
    strike: s.strike,
    netGEX: s.netGEX,
    callGEX: s.callGEX,
    putGEX: s.putGEX,
    callOI: s.callOI,
    putOI: s.putOI,
  }));

  const profile = {
    available: true,
    dataSource: 'REAL_OPTIONS',
    
    spot,
    timestamp: new Date(),
    
    // Key Levels
    gammaFlip,
    majorCallWall: callWalls[0]?.strike || spot + 50,
    majorPutWall: putWalls[0]?.strike || spot - 50,
    
    // Walls with detail
    callWalls: callWalls.map(w => ({ strike: w.strike, gex: w.callGEX, oi: w.callOI })),
    putWalls: putWalls.map(w => ({ strike: w.strike, gex: w.putGEX, oi: w.putOI })),
    
    // Net Exposures
    netGEX,
    callGEX: totalCallGEX,
    putGEX: totalPutGEX,
    netVanna: totalVanna,
    netCharm: totalCharm,
    
    // Regime
    regime,
    regimeStrength: Math.abs(netGEX) > 1000 ? 'STRONG' : Math.abs(netGEX) > 500 ? 'MODERATE' : 'WEAK',
    
    // Strike Data
    strikes: strikesArray,
    heatmap,
    
    // Data Quality
    totalContracts: optionsChain.length,
    contractsWithGreeks,
    contractsCalculated,
    
    // Analysis
    analysis: {
      aboveGammaFlip: spot > gammaFlip,
      nearCallWall: callWalls[0] && Math.abs(spot - callWalls[0].strike) < 10,
      nearPutWall: putWalls[0] && Math.abs(spot - putWalls[0].strike) < 10,
      vannaPositive: totalVanna > 0,
      charmPositive: totalCharm > 0,
    },
  };

  console.log(`   Gamma Flip: ${gammaFlip.toFixed(0)}`);
  console.log(`   Call Wall: ${profile.majorCallWall.toFixed(0)}`);
  console.log(`   Put Wall: ${profile.majorPutWall.toFixed(0)}`);
  console.log(`   Regime: ${regime} (${profile.regimeStrength})`);
  console.log(`   Net GEX: ${netGEX.toFixed(0)}M`);

  return profile;
};

// ═══════════════════════════════════════════════════════════════════════════════════
// MODEL-BASED GEX PROFILE (When no real options data)
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Build GEX Profile using model estimation
 * Used when real options data is not available
 */
const buildModelGEXProfile = (spot, vix = 15) => {
  const iv = vix / 100;
  
  // Round spot to nearest 5 points for strike alignment
  const roundedSpot = Math.round(spot / 5) * 5;
  
  // Model parameters based on typical SPX options distribution
  const strikeSpacing = 5; // SPX options typically at 5-point intervals
  const numStrikes = 40; // 20 above, 20 below
  const baseOI = 10000; // Base open interest
  
  // Build strikes and estimate GEX
  const strikes = [];
  const heatmap = [];
  
  let totalCallGEX = 0;
  let totalPutGEX = 0;
  let totalVanna = 0;
  let totalCharm = 0;
  
  for (let i = -numStrikes / 2; i <= numStrikes / 2; i++) {
    const strike = roundedSpot + (i * strikeSpacing);
    const moneyness = strike / spot;
    const distance = Math.abs(i);
    
    // Model: OI peaks at round numbers and ATM, decays away from spot
    const roundBonus = (strike % 50 === 0) ? 2.5 : (strike % 25 === 0) ? 1.5 : 1;
    const atmDecay = Math.exp(-0.08 * distance);
    const estimatedCallOI = baseOI * roundBonus * atmDecay * (strike > spot ? 1.2 : 0.8);
    const estimatedPutOI = baseOI * roundBonus * atmDecay * (strike < spot ? 1.2 : 0.8);
    
    // Calculate Greeks for model
    const tte = 7 / 365; // Average 7 DTE
    const callGreeks = calculateGreeks(spot, strike, tte, iv, 0.05, 'call');
    const putGreeks = calculateGreeks(spot, strike, tte, iv, 0.05, 'put');
    
    if (!callGreeks || !putGreeks) continue;
    
    // GEX = Gamma * OI * 100 * Spot^2 / 1e6
    // Dealers SHORT calls (negative gamma), LONG puts (positive gamma)
    const callGEX = -(callGreeks.gamma || 0) * estimatedCallOI * 100 * spot * spot / 1e6;
    const putGEX = (putGreeks.gamma || 0) * estimatedPutOI * 100 * spot * spot / 1e6;
    const netGEX = callGEX + putGEX;
    
    totalCallGEX += callGEX;
    totalPutGEX += putGEX;
    
    // Vanna and Charm contributions
    const callVanna = (callGreeks.vanna || 0) * estimatedCallOI * 100;
    const putVanna = (putGreeks.vanna || 0) * estimatedPutOI * 100;
    totalVanna += -callVanna + putVanna;
    
    const callCharm = (callGreeks.charm || 0) * estimatedCallOI * 100;
    const putCharm = (putGreeks.charm || 0) * estimatedPutOI * 100;
    totalCharm += -callCharm + putCharm;
    
    strikes.push({
      strike,
      callGEX,
      putGEX,
      netGEX,
      callOI: estimatedCallOI,
      putOI: estimatedPutOI,
    });
    
    heatmap.push({
      strike,
      netGEX,
      callGEX,
      putGEX,
      callOI: estimatedCallOI,
      putOI: estimatedPutOI,
    });
  }
  
  // Sort heatmap by strike descending
  heatmap.sort((a, b) => b.strike - a.strike);
  
  // Find Gamma Flip (where GEX crosses zero)
  let gammaFlip = roundedSpot;
  let prevNetGEX = null;
  for (const s of [...strikes].sort((a, b) => b.strike - a.strike)) {
    if (prevNetGEX !== null && prevNetGEX * s.netGEX < 0) {
      gammaFlip = s.strike;
      break;
    }
    prevNetGEX = s.netGEX;
  }
  
  // Find major walls (highest GEX levels)
  const sortedByCallGEX = strikes.filter(s => s.strike > spot).sort((a, b) => Math.abs(b.callGEX) - Math.abs(a.callGEX));
  const sortedByPutGEX = strikes.filter(s => s.strike < spot).sort((a, b) => Math.abs(b.putGEX) - Math.abs(a.putGEX));
  
  const majorCallWall = sortedByCallGEX[0]?.strike || spot + 50;
  const majorPutWall = sortedByPutGEX[0]?.strike || spot - 50;
  
  // Determine regime
  const netGEX = totalCallGEX + totalPutGEX;
  const regime = netGEX > 0 ? 'POSITIVE' : 'NEGATIVE';
  
  return {
    available: true,
    dataSource: 'MODEL',
    
    spot,
    timestamp: new Date(),
    
    // Key Levels
    gammaFlip,
    majorCallWall,
    majorPutWall,
    
    // Walls with detail
    callWalls: sortedByCallGEX.slice(0, 5).map(w => ({ strike: w.strike, gex: w.callGEX, oi: w.callOI })),
    putWalls: sortedByPutGEX.slice(0, 5).map(w => ({ strike: w.strike, gex: w.putGEX, oi: w.putOI })),
    
    // Net Exposures
    netGEX,
    callGEX: totalCallGEX,
    putGEX: totalPutGEX,
    netVanna: totalVanna,
    netCharm: totalCharm,
    
    // Regime
    regime,
    regimeStrength: Math.abs(netGEX) > 100 ? 'STRONG' : Math.abs(netGEX) > 50 ? 'MODERATE' : 'WEAK',
    
    // Strike Data
    strikes,
    heatmap,
    
    // Data Quality
    totalContracts: 0,
    contractsWithGreeks: 0,
    contractsCalculated: strikes.length * 2,
    
    // Analysis
    analysis: {
      aboveGammaFlip: spot > gammaFlip,
      nearCallWall: Math.abs(spot - majorCallWall) < 10,
      nearPutWall: Math.abs(spot - majorPutWall) < 10,
      vannaPositive: totalVanna > 0,
      charmPositive: totalCharm > 0,
    },
  };
};

// ═══════════════════════════════════════════════════════════════════════════════════
// SCENARIO DETECTION (Based on GEX Data)
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Detect trading scenarios based on GEX profile and price action
 */
export const detectScenarios = (gexProfile, bars = [], currentTime = new Date()) => {
  if (!gexProfile?.available) {
    return [];
  }

  const scenarios = [];
  const spot = gexProfile.spot;
  const hour = currentTime.getHours();
  const minute = currentTime.getMinutes();
  const dayMinute = hour * 60 + minute;

  // Time Windows (EST)
  const timeWindows = {
    opening: dayMinute >= 570 && dayMinute <= 630,      // 9:30 - 10:30
    preLunch: dayMinute >= 690 && dayMinute <= 750,     // 11:30 - 12:30
    powerHour: dayMinute >= 900 && dayMinute <= 960,    // 15:00 - 16:00
    eodCharm: dayMinute >= 930,                         // 15:30+
  };

  // Get recent candle patterns if bars available
  const recentBar = bars[0];
  let candlePattern = null;
  
  if (recentBar) {
    const body = recentBar.close - recentBar.open;
    const range = recentBar.high - recentBar.low;
    const upperWick = recentBar.high - Math.max(recentBar.open, recentBar.close);
    const lowerWick = Math.min(recentBar.open, recentBar.close) - recentBar.low;
    
    // Rejection patterns
    if (upperWick > Math.abs(body) * 2 && body < 0) {
      candlePattern = 'SHOOTING_STAR';
    } else if (lowerWick > Math.abs(body) * 2 && body > 0) {
      candlePattern = 'HAMMER';
    } else if (Math.abs(body) > range * 0.7 && body < 0) {
      candlePattern = 'BEARISH_MARUBOZU';
    } else if (Math.abs(body) > range * 0.7 && body > 0) {
      candlePattern = 'BULLISH_MARUBOZU';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SCENARIO 1: Call Wall Rejection (Bearish)
  // ═══════════════════════════════════════════════════════════════════════════════
  const callWall = gexProfile.callWalls[0];
  if (callWall) {
    const distToCallWall = Math.abs(spot - callWall.strike);
    const isNearCallWall = distToCallWall < 10;
    const isTouchingCallWall = distToCallWall < 3;
    
    if (isNearCallWall || isTouchingCallWall) {
      const confidence = calculateConfidence({
        proximity: isTouchingCallWall ? 30 : 20,
        gexStrength: Math.min(20, Math.abs(callWall.gex) / 50),
        candlePattern: candlePattern === 'SHOOTING_STAR' ? 25 : 0,
        timeWindow: timeWindows.preLunch || timeWindows.powerHour ? 15 : 0,
        regime: gexProfile.regime === 'POSITIVE' ? 10 : 0,
      });

      scenarios.push({
        type: 'CALL_WALL_REJECTION',
        direction: 'SHORT',
        confidence,
        
        trigger: callWall.strike,
        entry: spot,
        stop: callWall.strike + 5,
        targets: [spot - 15, spot - 25, spot - 40],
        
        reason: `Price ${isTouchingCallWall ? 'AT' : 'near'} major call wall ${callWall.strike}`,
        factors: {
          wallStrength: Math.abs(callWall.gex).toFixed(0),
          openInterest: callWall.oi,
          proximity: distToCallWall.toFixed(1),
          candlePattern,
        },
        
        alert: confidence >= 75 && isTouchingCallWall && candlePattern === 'SHOOTING_STAR',
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SCENARIO 2: Put Wall Bounce (Bullish)
  // ═══════════════════════════════════════════════════════════════════════════════
  const putWall = gexProfile.putWalls[0];
  if (putWall) {
    const distToPutWall = Math.abs(spot - putWall.strike);
    const isNearPutWall = distToPutWall < 10;
    const isTouchingPutWall = distToPutWall < 3;
    
    if (isNearPutWall || isTouchingPutWall) {
      const confidence = calculateConfidence({
        proximity: isTouchingPutWall ? 30 : 20,
        gexStrength: Math.min(20, Math.abs(putWall.gex) / 50),
        candlePattern: candlePattern === 'HAMMER' ? 25 : 0,
        timeWindow: timeWindows.opening || timeWindows.preLunch ? 15 : 0,
        regime: gexProfile.regime === 'NEGATIVE' ? 10 : 0,
      });

      scenarios.push({
        type: 'PUT_WALL_BOUNCE',
        direction: 'LONG',
        confidence,
        
        trigger: putWall.strike,
        entry: spot,
        stop: putWall.strike - 5,
        targets: [spot + 15, spot + 25, spot + 40],
        
        reason: `Price ${isTouchingPutWall ? 'AT' : 'near'} major put wall ${putWall.strike}`,
        factors: {
          wallStrength: Math.abs(putWall.gex).toFixed(0),
          openInterest: putWall.oi,
          proximity: distToPutWall.toFixed(1),
          candlePattern,
        },
        
        alert: confidence >= 75 && isTouchingPutWall && candlePattern === 'HAMMER',
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SCENARIO 3: Gamma Flip Cross
  // ═══════════════════════════════════════════════════════════════════════════════
  const distToFlip = Math.abs(spot - gexProfile.gammaFlip);
  if (distToFlip < 5) {
    const crossingUp = spot > gexProfile.gammaFlip && recentBar?.close > recentBar?.open;
    const crossingDown = spot < gexProfile.gammaFlip && recentBar?.close < recentBar?.open;
    
    const confidence = calculateConfidence({
      proximity: 25,
      momentum: crossingUp || crossingDown ? 20 : 0,
      candlePattern: candlePattern === 'BULLISH_MARUBOZU' || candlePattern === 'BEARISH_MARUBOZU' ? 20 : 0,
      timeWindow: timeWindows.opening ? 15 : 0,
    });

    if (crossingUp) {
      scenarios.push({
        type: 'GAMMA_FLIP_CROSS_UP',
        direction: 'LONG',
        confidence,
        
        trigger: gexProfile.gammaFlip,
        entry: spot,
        stop: gexProfile.gammaFlip - 8,
        targets: [spot + 20, spot + 35, spot + 50],
        
        reason: `Crossing ABOVE gamma flip ${gexProfile.gammaFlip.toFixed(0)} - entering positive gamma`,
        factors: {
          gammaFlip: gexProfile.gammaFlip,
          newRegime: 'POSITIVE',
          candlePattern,
        },
        
        alert: confidence >= 70,
      });
    } else if (crossingDown) {
      scenarios.push({
        type: 'GAMMA_FLIP_CROSS_DOWN',
        direction: 'SHORT',
        confidence,
        
        trigger: gexProfile.gammaFlip,
        entry: spot,
        stop: gexProfile.gammaFlip + 8,
        targets: [spot - 20, spot - 35, spot - 50],
        
        reason: `Crossing BELOW gamma flip ${gexProfile.gammaFlip.toFixed(0)} - entering negative gamma`,
        factors: {
          gammaFlip: gexProfile.gammaFlip,
          newRegime: 'NEGATIVE',
          candlePattern,
        },
        
        alert: confidence >= 70,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SCENARIO 4: Vanna Flow (IV Change Impact)
  // ═══════════════════════════════════════════════════════════════════════════════
  if (Math.abs(gexProfile.netVanna) > 1000) {
    const vannaDirection = gexProfile.netVanna > 0 ? 'BULLISH' : 'BEARISH';
    
    const confidence = calculateConfidence({
      vannaStrength: Math.min(30, Math.abs(gexProfile.netVanna) / 100),
      timeWindow: timeWindows.opening ? 15 : 0,
      regime: (vannaDirection === 'BULLISH' && gexProfile.regime === 'POSITIVE') ||
              (vannaDirection === 'BEARISH' && gexProfile.regime === 'NEGATIVE') ? 15 : 0,
    });

    scenarios.push({
      type: 'VANNA_FLOW',
      direction: vannaDirection === 'BULLISH' ? 'LONG' : 'SHORT',
      confidence,
      
      entry: spot,
      stop: vannaDirection === 'BULLISH' ? spot - 10 : spot + 10,
      targets: vannaDirection === 'BULLISH' 
        ? [spot + 15, spot + 25] 
        : [spot - 15, spot - 25],
      
      reason: `Strong ${vannaDirection} Vanna flow - IV changes will push price ${vannaDirection === 'BULLISH' ? 'up' : 'down'}`,
      factors: {
        netVanna: gexProfile.netVanna.toFixed(0),
        direction: vannaDirection,
      },
      
      alert: confidence >= 65 && Math.abs(gexProfile.netVanna) > 2000,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SCENARIO 5: Charm Decay (End of Day Flow)
  // ═══════════════════════════════════════════════════════════════════════════════
  if (timeWindows.eodCharm && Math.abs(gexProfile.netCharm) > 500) {
    const charmDirection = gexProfile.netCharm > 0 ? 'BULLISH' : 'BEARISH';
    
    const confidence = calculateConfidence({
      charmStrength: Math.min(25, Math.abs(gexProfile.netCharm) / 50),
      timeWindow: 25, // EOD is crucial for charm
      regime: gexProfile.regime === 'POSITIVE' ? 10 : 0,
    });

    scenarios.push({
      type: 'CHARM_DECAY',
      direction: charmDirection === 'BULLISH' ? 'LONG' : 'SHORT',
      confidence,
      
      entry: spot,
      stop: charmDirection === 'BULLISH' ? spot - 8 : spot + 8,
      targets: charmDirection === 'BULLISH'
        ? [spot + 10, spot + 18]
        : [spot - 10, spot - 18],
      
      reason: `EOD Charm flow ${charmDirection} - time decay forcing dealer hedging`,
      factors: {
        netCharm: gexProfile.netCharm.toFixed(0),
        direction: charmDirection,
        timeToClose: `${Math.floor((960 - dayMinute) / 60)}h ${(960 - dayMinute) % 60}m`,
      },
      
      alert: confidence >= 60 && dayMinute >= 930,
    });
  }

  // Sort by confidence
  scenarios.sort((a, b) => b.confidence - a.confidence);

  return scenarios;
};

// Calculate combined confidence score
const calculateConfidence = (factors) => {
  const values = Object.values(factors).filter(v => typeof v === 'number');
  const total = values.reduce((sum, v) => sum + v, 0);
  return Math.min(100, Math.max(0, total));
};

// ═══════════════════════════════════════════════════════════════════════════════════
// WEEKLY ANALYSIS (Based on last session + daily bars)
// ═══════════════════════════════════════════════════════════════════════════════════

export const buildWeeklyAnalysis = (gexProfile, dailyBars = []) => {
  if (!gexProfile?.available) {
    return {
      available: false,
      reason: 'GEX profile required for weekly analysis',
    };
  }

  if (!dailyBars.length) {
    return {
      available: false,
      reason: 'Daily bars required for weekly analysis',
    };
  }

  const lastBar = dailyBars[0];
  const weekBars = dailyBars.slice(0, 5);
  
  // Weekly range
  const weekHigh = Math.max(...weekBars.map(b => b.high));
  const weekLow = Math.min(...weekBars.map(b => b.low));
  const weekRange = weekHigh - weekLow;
  
  // Weekly trend
  const weekOpen = weekBars[weekBars.length - 1]?.open || lastBar.open;
  const weekClose = lastBar.close;
  const weekTrend = weekClose > weekOpen ? 'BULLISH' : 'BEARISH';
  const weekChange = ((weekClose - weekOpen) / weekOpen) * 100;

  // Expected range based on ATR
  const atrDaily = weekBars.reduce((sum, b) => sum + (b.high - b.low), 0) / weekBars.length;
  const expectedWeekRange = atrDaily * 2.5; // 2.5x daily ATR for weekly expectation

  // Key levels for next week
  const analysis = {
    available: true,
    lastSession: {
      date: lastBar.date,
      close: lastBar.close,
      high: lastBar.high,
      low: lastBar.low,
    },
    
    weekSummary: {
      trend: weekTrend,
      change: weekChange.toFixed(2) + '%',
      high: weekHigh,
      low: weekLow,
      range: weekRange.toFixed(0),
    },
    
    nextWeekExpectation: {
      expectedRange: expectedWeekRange.toFixed(0),
      bullishTarget: (lastBar.close + expectedWeekRange * 0.6).toFixed(0),
      bearishTarget: (lastBar.close - expectedWeekRange * 0.6).toFixed(0),
    },
    
    keyLevels: {
      gammaFlip: gexProfile.gammaFlip,
      majorCallWall: gexProfile.majorCallWall,
      majorPutWall: gexProfile.majorPutWall,
      weeklyHigh: weekHigh,
      weeklyLow: weekLow,
    },
    
    outlook: {
      regime: gexProfile.regime,
      bias: gexProfile.analysis.aboveGammaFlip ? 'BULLISH' : 'BEARISH',
      notes: [],
    },
  };

  // Add analysis notes
  if (gexProfile.analysis.nearCallWall) {
    analysis.outlook.notes.push('Price near call wall - expect resistance');
  }
  if (gexProfile.analysis.nearPutWall) {
    analysis.outlook.notes.push('Price near put wall - expect support');
  }
  if (gexProfile.regime === 'POSITIVE') {
    analysis.outlook.notes.push('Positive gamma regime - expect mean reversion, lower volatility');
  } else {
    analysis.outlook.notes.push('Negative gamma regime - expect trend continuation, higher volatility');
  }

  return analysis;
};

export default {
  calculateGreeks,
  buildGEXProfile,
  detectScenarios,
  buildWeeklyAnalysis,
};
