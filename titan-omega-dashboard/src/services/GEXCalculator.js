/**
 * GEX Calculator - Real-time Gamma Exposure Analysis
 * 
 * Calculates dealer positioning and predicts hedging flows
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

// Calculate option Greeks
export const calculateGreeks = (S, K, T, r, sigma, isCall) => {
  if (T <= 0) T = 1 / 365 / 24;
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

// Build GEX profile from options chain or simulated data
export const buildGEXProfile = (spot, optionsChain = null, iv = 0.15) => {
  const T = 1 / 365; // 1 day to expiry (0DTE focus)
  const r = 0.05;

  const profile = {
    spot,
    timestamp: new Date(),
    iv,
    
    // Key levels
    gammaFlip: spot,
    callWall: null,
    putWall: null,
    
    // Exposures
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

  // If we have real options data, use it
  if (optionsChain && optionsChain.length > 0) {
    for (const option of optionsChain) {
      const strike = option.details?.strike_price;
      if (!strike) continue;
      
      const scaledStrike = strike * 10; // SPY to SPX
      const dist = Math.abs(scaledStrike - spot);
      if (dist > 150) continue;

      const isCall = option.details?.contract_type === 'call';
      const oi = option.open_interest || 0;
      const gamma = option.greeks?.gamma || 0;
      
      const gex = isCall ? -gamma * oi * 100 * spot : gamma * oi * 100 * spot;
      
      profile.netGEX += gex;
      
      if (!profile.gexByStrike[scaledStrike]) {
        profile.gexByStrike[scaledStrike] = 0;
      }
      profile.gexByStrike[scaledStrike] += gex / 1e9;

      const absGEX = Math.abs(gex);
      if (absGEX < minAbsGEX && dist < 50) {
        minAbsGEX = absGEX;
        profile.gammaFlip = scaledStrike;
      }

      if (isCall && scaledStrike > spot && absGEX > profile.callWallGEX) {
        profile.callWallGEX = absGEX;
        profile.callWall = scaledStrike;
      }
      if (!isCall && scaledStrike < spot && absGEX > profile.putWallGEX) {
        profile.putWallGEX = absGEX;
        profile.putWall = scaledStrike;
      }
    }
  } else {
    // Simulate realistic GEX profile based on spot price
    // This models typical dealer positioning at major strikes
    
    const roundTo100 = Math.round(spot / 100) * 100;
    const roundTo50 = Math.round(spot / 50) * 50;
    
    for (let i = -30; i <= 30; i++) {
      const K = Math.round(spot / 5) * 5 + i * 5;
      const dist = Math.abs(K - spot);
      if (dist > 120) continue;

      // OI clustering at round numbers
      const is100 = K % 100 === 0;
      const is50 = K % 50 === 0;
      const is25 = K % 25 === 0;
      const decay = Math.exp(-dist / 80);
      
      let baseCallOI = is100 ? 25000 : is50 ? 15000 : is25 ? 8000 : 4000;
      let basePutOI = is100 ? 25000 : is50 ? 15000 : is25 ? 8000 : 4000;
      
      // Skew: more calls above spot, more puts below
      baseCallOI *= K > spot ? 1.5 : 0.5;
      basePutOI *= K < spot ? 1.5 : 0.5;
      
      const callOI = Math.floor(baseCallOI * decay * (0.8 + Math.random() * 0.4));
      const putOI = Math.floor(basePutOI * decay * (0.8 + Math.random() * 0.4));

      // Calculate Greeks
      const callGreeks = calculateGreeks(spot, K, T, r, iv, true);
      const putGreeks = calculateGreeks(spot, K, T, r, iv, false);

      // GEX: Dealers short options, must hedge
      const callGEX = -callGreeks.gamma * callOI * 100 * spot;
      const putGEX = putGreeks.gamma * putOI * 100 * spot;
      const strikeGEX = (callGEX + putGEX) / 1e9;

      // DEX
      const callDEX = -callGreeks.delta * callOI * 100;
      const putDEX = -putGreeks.delta * putOI * 100;

      // Vanna & Charm
      const callVanna = -callGreeks.vanna * callOI * 100;
      const putVanna = -putGreeks.vanna * putOI * 100;
      const callCharm = -callGreeks.charm * callOI * 100;
      const putCharm = -putGreeks.charm * putOI * 100;

      profile.netGEX += strikeGEX;
      profile.netDEX += (callDEX + putDEX) / 1e6;
      profile.netVanna += (callVanna + putVanna) / 1e6;
      profile.netCharm += (callCharm + putCharm) / 1e6;

      profile.gexByStrike[K] = strikeGEX;
      profile.strikes.push({
        strike: K,
        gex: strikeGEX,
        callOI,
        putOI,
        is100,
        is50,
      });

      // Find gamma flip
      if (Math.abs(strikeGEX) < minAbsGEX && dist < 50) {
        minAbsGEX = Math.abs(strikeGEX);
        profile.gammaFlip = K;
      }

      // Find walls
      const absGEX = Math.abs(strikeGEX);
      if (K > spot && callOI > putOI * 1.5 && absGEX > profile.callWallGEX) {
        profile.callWallGEX = absGEX;
        profile.callWall = K;
      }
      if (K < spot && putOI > callOI * 1.5 && absGEX > profile.putWallGEX) {
        profile.putWallGEX = absGEX;
        profile.putWall = K;
      }
    }
  }

  // Sort strikes
  profile.strikes.sort((a, b) => b.strike - a.strike);

  // Determine regime
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
  profile.charmFlow = profile.netCharm * (1 / 6.5); // Per hour

  return profile;
};

// Detect trading scenarios
export const detectScenarios = (profile, candle, prevCandle) => {
  const scenarios = [];
  const { spot, callWall, putWall, gammaFlip, regime } = profile;

  // Get time window
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  const dow = now.getDay();
  
  const isPrimeTime = (h >= 11 && h < 11.75) || (h >= 14.5 && h < 15.25);
  const isLunch = h >= 11.75 && h < 14;
  const isWeekend = dow === 0 || dow === 6;

  // Candle analysis
  const body = candle ? candle.close - candle.open : 0;
  const range = candle ? candle.high - candle.low : 1;
  const upperWick = candle ? candle.high - Math.max(candle.open, candle.close) : 0;
  const lowerWick = candle ? Math.min(candle.open, candle.close) - candle.low : 0;

  // Scenario 1: Call Wall Rejection
  if (callWall && profile.distToCallWall <= 8) {
    const isRejecting = upperWick > Math.abs(body) * 1.5 || (body < 0 && Math.abs(body) > range * 0.5);
    
    scenarios.push({
      id: 'CALL_WALL_REJECTION',
      name: 'Call Wall Rejection',
      icon: '🧱',
      direction: 'SHORT',
      active: profile.distToCallWall <= 5,
      alert: isRejecting && isPrimeTime && profile.distToCallWall <= 5,
      confidence: Math.min(95, 50 + (5 - Math.min(5, profile.distToCallWall)) * 10 + (isRejecting ? 20 : 0) + (isPrimeTime ? 15 : 0)),
      description: `Price ${profile.distToCallWall.toFixed(0)} pts from Call Wall (${callWall})`,
      target: gammaFlip,
      targetPts: spot - gammaFlip,
    });
  }

  // Scenario 2: Put Wall Bounce
  if (putWall && profile.distToPutWall <= 8) {
    const isBouncing = lowerWick > Math.abs(body) * 1.5 || (body > 0 && Math.abs(body) > range * 0.5);
    
    scenarios.push({
      id: 'PUT_WALL_BOUNCE',
      name: 'Put Wall Bounce',
      icon: '💎',
      direction: 'LONG',
      active: profile.distToPutWall <= 5,
      alert: isBouncing && isPrimeTime && profile.distToPutWall <= 5,
      confidence: Math.min(95, 50 + (5 - Math.min(5, profile.distToPutWall)) * 10 + (isBouncing ? 20 : 0) + (isPrimeTime ? 15 : 0)),
      description: `Price ${profile.distToPutWall.toFixed(0)} pts from Put Wall (${putWall})`,
      target: gammaFlip,
      targetPts: gammaFlip - spot,
    });
  }

  // Scenario 3: Gamma Flip Cross
  if (Math.abs(profile.distToFlip) <= 5) {
    const crossingUp = prevCandle && prevCandle.close < gammaFlip && candle?.close > gammaFlip;
    const crossingDown = prevCandle && prevCandle.close > gammaFlip && candle?.close < gammaFlip;
    
    scenarios.push({
      id: 'GAMMA_FLIP_CROSS',
      name: 'Gamma Flip Zone',
      icon: '⚡',
      direction: crossingUp ? 'LONG' : crossingDown ? 'SHORT' : 'WATCH',
      active: Math.abs(profile.distToFlip) <= 3,
      alert: (crossingUp || crossingDown) && !isLunch,
      confidence: Math.min(85, 40 + (3 - Math.min(3, Math.abs(profile.distToFlip))) * 15),
      description: `${profile.aboveFlip ? 'Above' : 'Below'} γ-Flip (${gammaFlip}) by ${Math.abs(profile.distToFlip).toFixed(0)} pts`,
      target: profile.aboveFlip ? callWall : putWall,
    });
  }

  // Scenario 4: Vanna Squeeze
  if (Math.abs(profile.vannaFlow) > 0.1) {
    scenarios.push({
      id: 'VANNA_SQUEEZE',
      name: 'Vanna Flow',
      icon: '🌊',
      direction: profile.vannaFlow > 0 ? 'LONG' : 'SHORT',
      active: Math.abs(profile.vannaFlow) > 0.2,
      alert: false,
      confidence: Math.min(70, 40 + Math.abs(profile.vannaFlow) * 100),
      description: `IV change → ${profile.vannaFlow > 0 ? 'BUY' : 'SELL'} pressure`,
    });
  }

  // Scenario 5: Charm Decay
  if (h >= 14 && Math.abs(profile.charmFlow) > 0.1) {
    scenarios.push({
      id: 'CHARM_DECAY',
      name: 'Charm Decay',
      icon: '⏰',
      direction: profile.charmFlow > 0 ? 'LONG' : 'SHORT',
      active: h >= 15,
      alert: false,
      confidence: Math.min(75, 40 + Math.abs(profile.charmFlow) * 50 + (h >= 15 ? 20 : 0)),
      description: `Time decay → ${profile.charmFlow > 0 ? 'BUY' : 'SELL'} into close`,
    });
  }

  // Scenario 6: Regime
  scenarios.push({
    id: 'REGIME',
    name: regime === 'POSITIVE_GAMMA' ? 'Positive Gamma' : regime === 'NEGATIVE_GAMMA' ? 'Negative Gamma' : 'Neutral',
    icon: regime === 'POSITIVE_GAMMA' ? '✅' : regime === 'NEGATIVE_GAMMA' ? '⚠️' : '➖',
    direction: regime === 'POSITIVE_GAMMA' ? 'FADE' : regime === 'NEGATIVE_GAMMA' ? 'TREND' : 'NEUTRAL',
    active: true,
    alert: false,
    confidence: Math.min(80, 50 + Math.abs(profile.netGEX) * 20),
    description: regime === 'POSITIVE_GAMMA' 
      ? 'Dealers DAMPEN moves (mean revert)' 
      : regime === 'NEGATIVE_GAMMA' 
        ? 'Dealers AMPLIFY moves (trends extend)' 
        : 'Balanced dealer positioning',
  });

  return scenarios.filter(s => s.confidence > 0).sort((a, b) => b.confidence - a.confidence);
};

export default { buildGEXProfile, detectScenarios, calculateGreeks };
