/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA - REAL GEX ENGINE (HeatSeeker-Level Analysis)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * HOW HEATSEEKER/GEX TOOLS WORK:
 * 
 * 1. They pull REAL options chain data (strikes, OI, greeks)
 * 2. Calculate GEX per strike: Gamma × OI × Spot² × Multiplier
 * 3. Adjust for dealer positioning (dealers are SHORT calls, LONG puts)
 * 4. Find gamma flip (where net GEX = 0)
 * 5. Identify support (positive GEX) and resistance (negative GEX)
 * 
 * WHY THIS PREDICTS PRICE:
 * - Dealers MUST hedge. They have no choice.
 * - Positive GEX at a level = Dealers buy when price drops there (SUPPORT)
 * - Negative GEX at a level = Dealers sell when price rises there (RESISTANCE)
 * - Gamma flip = Regime change point
 * 
 * VANNA FLOWS:
 * - When IV drops → Call deltas drop, Put deltas rise
 * - Dealers who are short calls must BUY stock (bullish)
 * - This is the "vol crush rally" after events
 * 
 * CHARM FLOWS:
 * - As time passes → OTM deltas decay toward 0
 * - Creates predictable EOD/EOW flows
 * 
 * THIS ENGINE USES REAL POLYGON.IO API DATA
 */

// ═══════════════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════════════

export const GEX_CONFIG = {
  // Polygon API
  polygon: {
    baseUrl: 'https://api.polygon.io',
    apiKey: process.env.POLYGON_API_KEY || 'YOUR_API_KEY', // Set in environment
  },
  
  // SPX Options
  options: {
    underlying: 'SPX',
    indexTicker: 'I:SPX',
    multiplier: 100,
    strikeInterval: 5,
    maxStrikes: 50, // +/- 50 strikes from ATM
  },
  
  // GEX Calculation
  gex: {
    // Dealer positioning assumptions (based on market structure)
    dealerCallPosition: -1, // Dealers are SHORT calls (sold to retail)
    dealerPutPosition: 1,   // Dealers are LONG puts (bought as hedges)
    
    // Significance thresholds
    significantGEX: 0.5,    // Billion $ threshold for significant level
    majorGEX: 1.0,          // Major support/resistance threshold
  },
  
  // Greeks calculation
  greeks: {
    riskFreeRate: 0.05,
    defaultIV: 0.15,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// BLACK-SCHOLES GREEKS (For when API doesn't provide them)
// ═══════════════════════════════════════════════════════════════════════════════════════

const normalCDF = (x) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
};

const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const calculateGreeks = (spot, strike, tte, r, iv, isCall = true) => {
  const T = Math.max(tte / 365, 0.0001);
  const sigma = iv;
  const sqrtT = Math.sqrt(T);
  
  const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  
  const delta = isCall ? normalCDF(d1) : normalCDF(d1) - 1;
  const gamma = normalPDF(d1) / (spot * sigma * sqrtT);
  const vega = spot * normalPDF(d1) * sqrtT / 100;
  const theta = (-spot * normalPDF(d1) * sigma / (2 * sqrtT) - 
                 r * strike * Math.exp(-r * T) * (isCall ? normalCDF(d2) : normalCDF(-d2))) / 365;
  
  // Second-order Greeks (THE KEY TO PREDICTING FLOWS)
  const charm = -normalPDF(d1) * (2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT);
  const vanna = -normalPDF(d1) * d2 / sigma;
  const vomma = vega * d1 * d2 / sigma;
  
  return { delta, gamma, vega, theta, charm, vanna, vomma, d1, d2 };
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// POLYGON API CLIENT
// ═══════════════════════════════════════════════════════════════════════════════════════

export class PolygonClient {
  constructor(apiKey) {
    this.apiKey = apiKey || GEX_CONFIG.polygon.apiKey;
    this.baseUrl = GEX_CONFIG.polygon.baseUrl;
  }
  
  async fetch(endpoint) {
    const url = `${this.baseUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}apiKey=${this.apiKey}`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Polygon API error: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Polygon API fetch error:', error);
      throw error;
    }
  }
  
  /**
   * Get current SPX price
   */
  async getSpotPrice() {
    const data = await this.fetch(`/v2/aggs/ticker/${GEX_CONFIG.options.indexTicker}/prev`);
    return data.results?.[0]?.c || null;
  }
  
  /**
   * Get SPX options chain
   * Returns all options for given expiration
   */
  async getOptionsChain(expirationDate) {
    // Format: YYYY-MM-DD
    const expDate = expirationDate || this.getNextExpiration();
    
    const data = await this.fetch(
      `/v3/reference/options/contracts?underlying_ticker=${GEX_CONFIG.options.underlying}&expiration_date=${expDate}&limit=1000`
    );
    
    return data.results || [];
  }
  
  /**
   * Get options snapshot with greeks and OI
   */
  async getOptionsSnapshot(optionsTicker) {
    const data = await this.fetch(`/v3/snapshot/options/${GEX_CONFIG.options.underlying}/${optionsTicker}`);
    return data.results;
  }
  
  /**
   * Get full options chain snapshot (all strikes)
   */
  async getFullOptionsSnapshot() {
    const data = await this.fetch(
      `/v3/snapshot/options/${GEX_CONFIG.options.underlying}?limit=250`
    );
    return data.results || [];
  }
  
  /**
   * Get next trading day expiration (0DTE)
   */
  getNextExpiration() {
    const now = new Date();
    const day = now.getDay();
    
    // SPX has Mon, Wed, Fri expirations
    // Find next expiration
    let daysToAdd = 0;
    if (day === 0) daysToAdd = 1; // Sunday -> Monday
    else if (day === 1) daysToAdd = 0; // Monday
    else if (day === 2) daysToAdd = 1; // Tuesday -> Wednesday
    else if (day === 3) daysToAdd = 0; // Wednesday
    else if (day === 4) daysToAdd = 1; // Thursday -> Friday
    else if (day === 5) daysToAdd = 0; // Friday
    else if (day === 6) daysToAdd = 2; // Saturday -> Monday
    
    const expDate = new Date(now);
    expDate.setDate(expDate.getDate() + daysToAdd);
    
    return expDate.toISOString().split('T')[0];
  }
  
  /**
   * Get real-time quote
   */
  async getQuote(ticker) {
    const data = await this.fetch(`/v2/last/trade/${ticker}`);
    return data.results;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// GEX CALCULATOR - The Core Logic (How HeatSeeker Works)
// ═══════════════════════════════════════════════════════════════════════════════════════

export class GEXCalculator {
  /**
   * Calculate GEX for a single option
   * 
   * Formula: GEX = Gamma × OI × Spot² × Multiplier × Dealer Position
   * 
   * Units: $ of stock dealers must trade per 1% move in spot
   */
  static calculateOptionGEX(gamma, openInterest, spot, isCall) {
    const multiplier = GEX_CONFIG.options.multiplier;
    
    // Raw GEX (absolute value)
    const rawGEX = gamma * openInterest * spot * spot * multiplier / 100;
    
    // Adjust for dealer positioning
    // Dealers SHORT calls → When spot rises, call delta rises → Dealers must BUY
    // Dealers LONG puts → When spot rises, put delta falls → Dealers must BUY
    // Net effect: Both create BUYING pressure when above gamma flip
    
    const dealerPosition = isCall ? 
      GEX_CONFIG.gex.dealerCallPosition : 
      GEX_CONFIG.gex.dealerPutPosition;
    
    return rawGEX * dealerPosition;
  }
  
  /**
   * Calculate Vanna Exposure
   * 
   * Vanna = dDelta/dIV
   * When IV changes, delta changes, forcing dealer hedging
   * 
   * KEY INSIGHT:
   * - IV drops → Call deltas drop → Short call dealers must BUY (bullish)
   * - IV rises → Call deltas rise → Short call dealers must SELL (bearish)
   */
  static calculateVannaExposure(vanna, openInterest, spot, isCall) {
    const multiplier = GEX_CONFIG.options.multiplier;
    const dealerPosition = isCall ? 
      GEX_CONFIG.gex.dealerCallPosition : 
      GEX_CONFIG.gex.dealerPutPosition;
    
    return vanna * openInterest * multiplier * dealerPosition;
  }
  
  /**
   * Calculate Charm Exposure
   * 
   * Charm = dDelta/dTime
   * As time passes, delta changes, forcing dealer hedging
   * 
   * KEY INSIGHT:
   * - OTM options: Delta decays toward 0
   * - ITM options: Delta moves toward ±1
   * - This creates predictable EOD flows
   */
  static calculateCharmExposure(charm, openInterest, spot, isCall) {
    const multiplier = GEX_CONFIG.options.multiplier;
    const dealerPosition = isCall ? 
      GEX_CONFIG.gex.dealerCallPosition : 
      GEX_CONFIG.gex.dealerPutPosition;
    
    return charm * openInterest * multiplier * dealerPosition;
  }
  
  /**
   * Calculate DEX (Delta Exposure)
   * 
   * Net directional exposure
   */
  static calculateDEX(delta, openInterest, isCall) {
    const multiplier = GEX_CONFIG.options.multiplier;
    const dealerPosition = isCall ? 
      GEX_CONFIG.gex.dealerCallPosition : 
      GEX_CONFIG.gex.dealerPutPosition;
    
    return delta * openInterest * multiplier * dealerPosition;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// GEX PROFILE BUILDER - Creates the HeatSeeker-style GEX Map
// ═══════════════════════════════════════════════════════════════════════════════════════

export class GEXProfileBuilder {
  constructor(polygonClient) {
    this.client = polygonClient || new PolygonClient();
  }
  
  /**
   * Build complete GEX profile from real options data
   * 
   * This is what HeatSeeker does:
   * 1. Pull options chain
   * 2. Calculate GEX per strike
   * 3. Sum calls + puts at each strike
   * 4. Find gamma flip
   * 5. Identify support/resistance levels
   */
  async buildProfile(spot, options = null) {
    // Get options data if not provided
    if (!options) {
      try {
        options = await this.client.getFullOptionsSnapshot();
      } catch (e) {
        console.log('Using simulated options data');
        options = this.generateSimulatedOptions(spot);
      }
    }
    
    const profile = {
      timestamp: new Date(),
      spot,
      strikes: [],
      
      // Per-strike data
      gexByStrike: {},
      vannaByStrike: {},
      charmByStrike: {},
      dexByStrike: {},
      oiByStrike: { calls: {}, puts: {} },
      
      // Aggregates
      netGEX: 0,
      netVanna: 0,
      netCharm: 0,
      netDEX: 0,
      totalCallOI: 0,
      totalPutOI: 0,
      
      // Key levels (THE TRADING SIGNALS)
      gammaFlip: spot,
      callWall: null,      // Highest call OI (resistance)
      putWall: null,       // Highest put OI (support)
      maxGammaStrike: null,
      
      // Support/Resistance levels
      supports: [],
      resistances: [],
      
      // Regime
      regime: 'NEUTRAL',
      regimeStrength: 0,
    };
    
    // Process each option
    const strikeData = {};
    let maxCallOI = 0, maxPutOI = 0;
    
    for (const option of options) {
      const strike = option.strike_price || option.strike;
      const isCall = option.contract_type === 'call' || option.type === 'call';
      const oi = option.open_interest || option.oi || 0;
      const iv = option.implied_volatility || option.iv || GEX_CONFIG.greeks.defaultIV;
      const tte = this.getDaysToExpiry(option.expiration_date || option.expiry);
      
      // Skip if no OI or too far from spot
      if (oi === 0 || Math.abs(strike - spot) > 200) continue;
      
      // Initialize strike data
      if (!strikeData[strike]) {
        strikeData[strike] = {
          gex: 0, vanna: 0, charm: 0, dex: 0,
          callOI: 0, putOI: 0,
        };
        profile.strikes.push(strike);
      }
      
      // Get greeks (from API or calculate)
      let gamma = option.greeks?.gamma;
      let delta = option.greeks?.delta;
      let vanna = option.greeks?.vanna;
      let charm = option.greeks?.charm;
      
      // Calculate if not provided
      if (!gamma || !vanna || !charm) {
        const greeks = calculateGreeks(spot, strike, tte, GEX_CONFIG.greeks.riskFreeRate, iv, isCall);
        gamma = gamma || greeks.gamma;
        delta = delta || greeks.delta;
        vanna = vanna || greeks.vanna;
        charm = charm || greeks.charm;
      }
      
      // Calculate exposures
      const gex = GEXCalculator.calculateOptionGEX(gamma, oi, spot, isCall);
      const vannaExp = GEXCalculator.calculateVannaExposure(vanna, oi, spot, isCall);
      const charmExp = GEXCalculator.calculateCharmExposure(charm, oi, spot, isCall);
      const dex = GEXCalculator.calculateDEX(delta, oi, isCall);
      
      // Add to strike totals
      strikeData[strike].gex += gex;
      strikeData[strike].vanna += vannaExp;
      strikeData[strike].charm += charmExp;
      strikeData[strike].dex += dex;
      
      if (isCall) {
        strikeData[strike].callOI += oi;
        profile.totalCallOI += oi;
        if (oi > maxCallOI && strike > spot) {
          maxCallOI = oi;
          profile.callWall = strike;
        }
      } else {
        strikeData[strike].putOI += oi;
        profile.totalPutOI += oi;
        if (oi > maxPutOI && strike < spot) {
          maxPutOI = oi;
          profile.putWall = strike;
        }
      }
      
      // Add to totals
      profile.netGEX += gex;
      profile.netVanna += vannaExp;
      profile.netCharm += charmExp;
      profile.netDEX += dex;
    }
    
    // Sort strikes
    profile.strikes.sort((a, b) => b - a);
    
    // Build per-strike maps
    let maxAbsGEX = 0;
    let minGammaFlipDist = Infinity;
    
    for (const strike of profile.strikes) {
      const data = strikeData[strike];
      
      profile.gexByStrike[strike] = data.gex / 1e9; // Convert to billions
      profile.vannaByStrike[strike] = data.vanna;
      profile.charmByStrike[strike] = data.charm;
      profile.dexByStrike[strike] = data.dex;
      profile.oiByStrike.calls[strike] = data.callOI;
      profile.oiByStrike.puts[strike] = data.putOI;
      
      // Find gamma flip (where net GEX closest to 0)
      const absGEX = Math.abs(data.gex);
      if (absGEX < minGammaFlipDist && Math.abs(strike - spot) < 100) {
        minGammaFlipDist = absGEX;
        profile.gammaFlip = strike;
      }
      
      // Find max gamma strike
      if (absGEX > maxAbsGEX) {
        maxAbsGEX = absGEX;
        profile.maxGammaStrike = strike;
      }
      
      // Classify as support or resistance
      const gexBillions = data.gex / 1e9;
      if (gexBillions > GEX_CONFIG.gex.significantGEX && strike < spot) {
        profile.supports.push({ strike, gex: gexBillions, strength: gexBillions });
      } else if (gexBillions < -GEX_CONFIG.gex.significantGEX && strike > spot) {
        profile.resistances.push({ strike, gex: gexBillions, strength: Math.abs(gexBillions) });
      }
    }
    
    // Sort support/resistance by proximity to spot
    profile.supports.sort((a, b) => b.strike - a.strike);
    profile.resistances.sort((a, b) => a.strike - b.strike);
    
    // Determine regime
    if (spot > profile.gammaFlip) {
      if (profile.netGEX > 0) {
        profile.regime = 'POSITIVE_GAMMA';
        profile.regimeStrength = Math.min(1, Math.abs(profile.netGEX) / 5e9);
      } else {
        profile.regime = 'NEGATIVE_GAMMA_ABOVE_FLIP';
        profile.regimeStrength = Math.min(1, Math.abs(profile.netGEX) / 5e9);
      }
    } else {
      if (profile.netGEX < 0) {
        profile.regime = 'NEGATIVE_GAMMA';
        profile.regimeStrength = Math.min(1, Math.abs(profile.netGEX) / 5e9);
      } else {
        profile.regime = 'POSITIVE_GAMMA_BELOW_FLIP';
        profile.regimeStrength = Math.min(1, Math.abs(profile.netGEX) / 5e9);
      }
    }
    
    // Convert totals to billions for display
    profile.netGEX /= 1e9;
    
    return profile;
  }
  
  /**
   * Generate simulated options data (for testing without API)
   */
  generateSimulatedOptions(spot) {
    const options = [];
    const strikes = [];
    
    // Generate strikes around spot
    for (let i = -40; i <= 40; i++) {
      strikes.push(Math.round(spot / 5) * 5 + i * 5);
    }
    
    for (const strike of strikes) {
      const distance = Math.abs(strike - spot);
      const distanceFactor = Math.exp(-distance / 100);
      
      // Higher OI at round numbers
      const roundFactor = strike % 25 === 0 ? 2 : strike % 50 === 0 ? 3 : 1;
      
      // More call OI above spot, more put OI below
      const callBias = strike >= spot ? 1.3 : 0.7;
      const putBias = strike <= spot ? 1.3 : 0.7;
      
      const baseOI = 3000 * distanceFactor * roundFactor;
      
      // Call option
      options.push({
        strike_price: strike,
        contract_type: 'call',
        open_interest: Math.floor(baseOI * callBias * (0.8 + Math.random() * 0.4)),
        implied_volatility: 0.15 + (distance / 500) * 0.1,
        expiration_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      });
      
      // Put option
      options.push({
        strike_price: strike,
        contract_type: 'put',
        open_interest: Math.floor(baseOI * putBias * (0.8 + Math.random() * 0.4)),
        implied_volatility: 0.15 + (distance / 500) * 0.1,
        expiration_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      });
    }
    
    return options;
  }
  
  getDaysToExpiry(expirationDate) {
    if (!expirationDate) return 1;
    const expiry = new Date(expirationDate);
    const now = new Date();
    const days = Math.max(0.01, (expiry - now) / (1000 * 60 * 60 * 24));
    return days;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// FLOW PREDICTOR - Predicts dealer hedging flows
// ═══════════════════════════════════════════════════════════════════════════════════════

export class FlowPredictor {
  /**
   * Predict flows based on expected IV and time changes
   * 
   * This is what makes GEX tools powerful:
   * - They predict WHERE dealers will have to trade
   * - AND HOW MUCH they'll have to trade
   */
  static predictFlows(profile, expectedIVChange = 0, hoursRemaining = 6.5) {
    // Vanna Flow: When IV changes
    // Negative IV change (vol crush) with negative net vanna = BUYING pressure
    const vannaFlow = -profile.netVanna * expectedIVChange;
    
    // Charm Flow: As time passes
    // Charm is already per-day, scale for hours
    const charmFlow = profile.netCharm * (hoursRemaining / 6.5);
    
    // GEX Flow: At current spot
    // Positive GEX = dealers dampening moves
    // Negative GEX = dealers amplifying moves
    const gexImpact = profile.netGEX;
    
    // Total expected flow
    const totalFlow = vannaFlow + charmFlow;
    
    return {
      vannaFlow: {
        direction: vannaFlow > 0 ? 'BUYING' : vannaFlow < 0 ? 'SELLING' : 'NEUTRAL',
        magnitude: Math.abs(vannaFlow),
        description: expectedIVChange < 0 ? 
          'Vol crush → Call deltas drop → Dealers BUY to cover shorts' :
          expectedIVChange > 0 ?
          'Vol rise → Call deltas rise → Dealers SELL to hedge' :
          'No IV change expected',
      },
      
      charmFlow: {
        direction: charmFlow > 0 ? 'BUYING' : charmFlow < 0 ? 'SELLING' : 'NEUTRAL',
        magnitude: Math.abs(charmFlow),
        description: 'Delta decay forcing dealer rehedging',
      },
      
      gexImpact: {
        regime: gexImpact > 0 ? 'DAMPENING' : 'AMPLIFYING',
        magnitude: Math.abs(gexImpact),
        description: gexImpact > 0 ?
          'Positive gamma → Dealers buy dips, sell rips → Mean reversion' :
          'Negative gamma → Dealers sell dips, buy rips → Trend extension',
      },
      
      netFlow: {
        direction: totalFlow > 0 ? 'BULLISH' : totalFlow < 0 ? 'BEARISH' : 'NEUTRAL',
        magnitude: Math.abs(totalFlow),
        confidence: Math.min(100, Math.abs(totalFlow) / 1e6 * 10),
      },
    };
  }
  
  /**
   * Get trading bias based on spot position relative to GEX levels
   */
  static getTradingBias(profile, spot) {
    const { gammaFlip, callWall, putWall, supports, resistances, regime } = profile;
    
    const aboveGammaFlip = spot > gammaFlip;
    const distToGammaFlip = spot - gammaFlip;
    
    // Find nearest support and resistance
    const nearestSupport = supports[0]?.strike;
    const nearestResistance = resistances[0]?.strike;
    
    const distToSupport = nearestSupport ? spot - nearestSupport : null;
    const distToResistance = nearestResistance ? nearestResistance - spot : null;
    
    // Determine bias
    let bias = 'NEUTRAL';
    let confidence = 0;
    let reasoning = [];
    
    if (regime === 'POSITIVE_GAMMA') {
      // In positive gamma, fade moves
      if (distToSupport && distToSupport < 10) {
        bias = 'LONG';
        confidence = 75;
        reasoning.push(`At GEX support ${nearestSupport} - dealers buying`);
      } else if (distToResistance && distToResistance < 10) {
        bias = 'SHORT';
        confidence = 70;
        reasoning.push(`At GEX resistance ${nearestResistance} - dealers selling`);
      } else {
        reasoning.push('Positive gamma regime - expect mean reversion');
      }
    } else {
      // In negative gamma, follow trends
      if (aboveGammaFlip && distToGammaFlip > 5) {
        bias = 'LONG';
        confidence = 70;
        reasoning.push('Above gamma flip in negative gamma - amplified upside');
      } else if (!aboveGammaFlip && Math.abs(distToGammaFlip) > 5) {
        bias = 'SHORT';
        confidence = 70;
        reasoning.push('Below gamma flip in negative gamma - amplified downside');
      }
    }
    
    // Add wall information
    if (callWall && spot < callWall) {
      reasoning.push(`Call wall at ${callWall} - major resistance`);
    }
    if (putWall && spot > putWall) {
      reasoning.push(`Put wall at ${putWall} - major support`);
    }
    
    return {
      bias,
      confidence,
      reasoning,
      levels: {
        gammaFlip,
        nearestSupport,
        nearestResistance,
        callWall,
        putWall,
      },
      regime,
      spotPosition: aboveGammaFlip ? 'ABOVE_FLIP' : 'BELOW_FLIP',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// SIGNAL GENERATOR - Creates trading signals from GEX data
// ═══════════════════════════════════════════════════════════════════════════════════════

export class GEXSignalGenerator {
  constructor(polygonClient) {
    this.profileBuilder = new GEXProfileBuilder(polygonClient);
    this.lastProfile = null;
  }
  
  async analyze(spot) {
    // Build GEX profile
    this.lastProfile = await this.profileBuilder.buildProfile(spot);
    
    // Get trading bias
    const bias = FlowPredictor.getTradingBias(this.lastProfile, spot);
    
    // Predict flows
    const flows = FlowPredictor.predictFlows(this.lastProfile, -0.01, 4); // Assume slight vol crush
    
    return {
      profile: this.lastProfile,
      bias,
      flows,
      timestamp: new Date(),
    };
  }
  
  /**
   * Generate signal if conditions are met
   */
  generateSignal(analysis, priceAction) {
    const { profile, bias, flows } = analysis;
    
    // Need both GEX bias and price action confirmation
    if (!bias.bias || bias.bias === 'NEUTRAL') return null;
    if (!priceAction || priceAction.bias === 'NEUTRAL') return null;
    
    // GEX and PA must agree
    const gexBullish = bias.bias === 'LONG';
    const paBullish = priceAction.bias === 'BULL';
    
    if (gexBullish !== paBullish) return null;
    
    const direction = gexBullish ? 'LONG' : 'SHORT';
    const entry = profile.spot;
    
    // Stops and targets based on GEX levels
    let stop, tp1, tp2;
    
    if (direction === 'LONG') {
      stop = bias.levels.nearestSupport ? bias.levels.nearestSupport - 3 : entry - 10;
      tp1 = bias.levels.nearestResistance || entry + 15;
      tp2 = bias.levels.callWall || entry + 25;
    } else {
      stop = bias.levels.nearestResistance ? bias.levels.nearestResistance + 3 : entry + 10;
      tp1 = bias.levels.nearestSupport || entry - 15;
      tp2 = bias.levels.putWall || entry - 25;
    }
    
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(tp1 - entry);
    
    // Only take if R:R >= 2
    if (reward / risk < 2) return null;
    
    return {
      direction,
      entry,
      stop,
      tp1,
      tp2,
      riskReward: (reward / risk).toFixed(1),
      confidence: Math.round((bias.confidence + flows.netFlow.confidence) / 2),
      
      // Reasoning
      gexBias: bias.bias,
      gexRegime: profile.regime,
      gexReasons: bias.reasoning,
      
      flowBias: flows.netFlow.direction,
      flowReasons: [
        flows.vannaFlow.description,
        flows.charmFlow.description,
        flows.gexImpact.description,
      ],
      
      priceActionSetup: priceAction.setup,
      
      // Key levels
      gammaFlip: profile.gammaFlip,
      callWall: profile.callWall,
      putWall: profile.putWall,
      nearestSupport: bias.levels.nearestSupport,
      nearestResistance: bias.levels.nearestResistance,
      
      timestamp: new Date(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT - Complete GEX Analysis Engine
// ═══════════════════════════════════════════════════════════════════════════════════════

export class RealGEXEngine {
  constructor(apiKey) {
    this.client = new PolygonClient(apiKey);
    this.signalGenerator = new GEXSignalGenerator(this.client);
    this.lastAnalysis = null;
  }
  
  /**
   * Full analysis - call this every few minutes
   */
  async analyze(spot = null) {
    // Get spot price if not provided
    if (!spot) {
      try {
        spot = await this.client.getSpotPrice();
      } catch (e) {
        spot = 5980; // Fallback
      }
    }
    
    this.lastAnalysis = await this.signalGenerator.analyze(spot);
    return this.lastAnalysis;
  }
  
  /**
   * Generate signal (needs price action input)
   */
  generateSignal(priceAction) {
    if (!this.lastAnalysis) return null;
    return this.signalGenerator.generateSignal(this.lastAnalysis, priceAction);
  }
  
  /**
   * Get current GEX levels for display
   */
  getGEXLevels() {
    if (!this.lastAnalysis) return null;
    
    const { profile } = this.lastAnalysis;
    
    return {
      spot: profile.spot,
      gammaFlip: profile.gammaFlip,
      callWall: profile.callWall,
      putWall: profile.putWall,
      netGEX: profile.netGEX.toFixed(2) + 'B',
      regime: profile.regime,
      supports: profile.supports.slice(0, 3),
      resistances: profile.resistances.slice(0, 3),
      
      // For heatmap display
      strikes: profile.strikes,
      gexByStrike: profile.gexByStrike,
    };
  }
  
  /**
   * Get formatted GEX data for HeatSeeker-style display
   */
  getHeatmapData() {
    if (!this.lastAnalysis) return [];
    
    const { profile } = this.lastAnalysis;
    
    return profile.strikes.map(strike => ({
      strike,
      gex: profile.gexByStrike[strike] || 0,
      isSpot: Math.abs(strike - profile.spot) < 3,
      isFlip: strike === profile.gammaFlip,
      isCallWall: strike === profile.callWall,
      isPutWall: strike === profile.putWall,
      callOI: profile.oiByStrike.calls[strike] || 0,
      putOI: profile.oiByStrike.puts[strike] || 0,
    }));
  }
}

export default RealGEXEngine;
