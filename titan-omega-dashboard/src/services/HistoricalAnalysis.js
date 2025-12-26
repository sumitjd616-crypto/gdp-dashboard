/**
 * Historical Data Analysis & Trading Guidance System
 * 
 * Fetches last week's data via REST API and provides:
 * - GEX level analysis
 * - Key level identification
 * - Trade setup detection
 * - Live commentary generation
 * - Performance backtesting
 */

const API_KEY = import.meta.env.VITE_MASSIVE_API_KEY;
const BASE_URL = 'https://api.polygon.io';

// ═══════════════════════════════════════════════════════════════════════════════════
// REST API DATA FETCHING
// ═══════════════════════════════════════════════════════════════════════════════════

export async function fetchHistoricalBars(ticker = 'I:SPX', days = 7, timeframe = 5) {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const url = `${BASE_URL}/v2/aggs/ticker/${ticker}/range/${timeframe}/minute/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${API_KEY}`;
  
  console.log(`📡 Fetching ${ticker} bars from ${from} to ${to}...`);
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK' || !data.results?.length) {
    console.warn(`No data for ${ticker}`);
    return [];
  }
  
  console.log(`✅ Loaded ${data.results.length} bars for ${ticker}`);
  
  return data.results.map(bar => ({
    timestamp: new Date(bar.t),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v || 0,
    vwap: bar.vw,
    trades: bar.n,
  }));
}

export async function fetchDailyBars(ticker = 'I:SPX', days = 30) {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const url = `${BASE_URL}/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&apiKey=${API_KEY}`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK') return [];
  
  return data.results?.map(bar => ({
    date: new Date(bar.t),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  })) || [];
}

// ═══════════════════════════════════════════════════════════════════════════════════
// TECHNICAL ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════════

export function calculateATR(bars, period = 14) {
  if (bars.length < period + 1) return 20; // Default ATR
  
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i-1].close),
      Math.abs(bars[i].low - bars[i-1].close)
    );
    trs.push(tr);
  }
  
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

export function detectCandlePattern(bar, prevBar) {
  if (!bar || !prevBar) return null;
  
  const body = bar.close - bar.open;
  const range = bar.high - bar.low;
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;
  const bodySize = Math.abs(body);
  
  // Shooting Star (bearish reversal)
  if (upperWick > bodySize * 2 && lowerWick < bodySize * 0.5 && body < 0) {
    return { type: 'SHOOTING_STAR', direction: 'BEARISH', strength: Math.min(100, upperWick / range * 100) };
  }
  
  // Hammer (bullish reversal)
  if (lowerWick > bodySize * 2 && upperWick < bodySize * 0.5 && body > 0) {
    return { type: 'HAMMER', direction: 'BULLISH', strength: Math.min(100, lowerWick / range * 100) };
  }
  
  // Bearish Engulfing
  if (body < 0 && prevBar.close > prevBar.open && 
      bar.open > prevBar.close && bar.close < prevBar.open) {
    return { type: 'BEARISH_ENGULFING', direction: 'BEARISH', strength: 85 };
  }
  
  // Bullish Engulfing
  if (body > 0 && prevBar.close < prevBar.open &&
      bar.open < prevBar.close && bar.close > prevBar.open) {
    return { type: 'BULLISH_ENGULFING', direction: 'BULLISH', strength: 85 };
  }
  
  // Strong momentum candle
  if (bodySize > range * 0.7) {
    return { 
      type: body > 0 ? 'BULLISH_MARUBOZU' : 'BEARISH_MARUBOZU', 
      direction: body > 0 ? 'BULLISH' : 'BEARISH',
      strength: 70
    };
  }
  
  // Doji (indecision)
  if (bodySize < range * 0.1 && range > 0) {
    return { type: 'DOJI', direction: 'NEUTRAL', strength: 50 };
  }
  
  return null;
}

export function detectSwingPoints(bars, lookback = 5) {
  const swings = { highs: [], lows: [] };
  
  for (let i = lookback; i < bars.length - lookback; i++) {
    const current = bars[i];
    let isSwingHigh = true;
    let isSwingLow = true;
    
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].high >= current.high) isSwingHigh = false;
      if (bars[j].low <= current.low) isSwingLow = false;
    }
    
    if (isSwingHigh) swings.highs.push({ index: i, price: current.high, time: current.timestamp });
    if (isSwingLow) swings.lows.push({ index: i, price: current.low, time: current.timestamp });
  }
  
  return swings;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// GEX MODEL LEVELS (Based on price structure)
// ═══════════════════════════════════════════════════════════════════════════════════

export function calculateDynamicGEXLevels(bars, currentPrice) {
  if (!bars.length) return null;
  
  const recentBars = bars.slice(-100);
  const swings = detectSwingPoints(recentBars, 3);
  
  // Find key resistance levels (potential call walls)
  const resistanceLevels = swings.highs
    .map(s => s.price)
    .filter(p => p > currentPrice)
    .sort((a, b) => a - b);
  
  // Find key support levels (potential put walls)
  const supportLevels = swings.lows
    .map(s => s.price)
    .filter(p => p < currentPrice)
    .sort((a, b) => b - a);
  
  // Round to nearest 5 for SPX
  const round5 = p => Math.round(p / 5) * 5;
  
  // ATR for volatility context
  const atr = calculateATR(recentBars);
  
  // Gamma flip estimate: recent consolidation midpoint
  const last20 = recentBars.slice(-20);
  const midHigh = Math.max(...last20.map(b => b.high));
  const midLow = Math.min(...last20.map(b => b.low));
  const gammaFlip = round5((midHigh + midLow) / 2);
  
  // Call wall: first major resistance
  const callWall = resistanceLevels.length > 0 
    ? round5(resistanceLevels[0])
    : round5(currentPrice + atr * 2);
  
  // Put wall: first major support
  const putWall = supportLevels.length > 0
    ? round5(supportLevels[0])
    : round5(currentPrice - atr * 2);
  
  return {
    gammaFlip,
    callWall,
    putWall,
    atr,
    regime: currentPrice > gammaFlip ? 'POSITIVE' : 'NEGATIVE',
    resistanceLevels: resistanceLevels.slice(0, 5).map(round5),
    supportLevels: supportLevels.slice(0, 5).map(round5),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// TRADE SETUP DETECTION
// ═══════════════════════════════════════════════════════════════════════════════════

export function detectTradeSetups(bars, gexLevels) {
  const setups = [];
  const recentBars = bars.slice(-50);
  
  for (let i = 5; i < recentBars.length; i++) {
    const bar = recentBars[i];
    const prevBar = recentBars[i-1];
    const price = bar.close;
    const pattern = detectCandlePattern(bar, prevBar);
    
    // Time filter (EST market hours)
    const hour = bar.timestamp.getHours();
    const minute = bar.timestamp.getMinutes();
    const dayMinute = hour * 60 + minute;
    
    const isPrimeTime = 
      (dayMinute >= 570 && dayMinute <= 630) ||  // 9:30-10:30 Opening
      (dayMinute >= 660 && dayMinute <= 720) ||  // 11:00-12:00 Pre-lunch
      (dayMinute >= 870 && dayMinute <= 960);    // 14:30-16:00 Power hour
    
    // CALL WALL REJECTION (Short setup)
    if (gexLevels?.callWall) {
      const distToCallWall = Math.abs(price - gexLevels.callWall);
      if (distToCallWall < 8 && pattern?.direction === 'BEARISH') {
        const confidence = Math.min(95, 50 + 
          (distToCallWall < 3 ? 25 : 10) +
          (pattern.strength / 5) +
          (isPrimeTime ? 15 : 0)
        );
        
        setups.push({
          type: 'CALL_WALL_REJECTION',
          direction: 'SHORT',
          timestamp: bar.timestamp,
          entry: price,
          stop: gexLevels.callWall + 5,
          target1: price - 15,
          target2: price - 25,
          target3: gexLevels.gammaFlip,
          confidence,
          pattern: pattern.type,
          reason: `Price rejected at call wall ${gexLevels.callWall} with ${pattern.type}`,
        });
      }
    }
    
    // PUT WALL BOUNCE (Long setup)
    if (gexLevels?.putWall) {
      const distToPutWall = Math.abs(price - gexLevels.putWall);
      if (distToPutWall < 8 && pattern?.direction === 'BULLISH') {
        const confidence = Math.min(95, 50 +
          (distToPutWall < 3 ? 25 : 10) +
          (pattern.strength / 5) +
          (isPrimeTime ? 15 : 0)
        );
        
        setups.push({
          type: 'PUT_WALL_BOUNCE',
          direction: 'LONG',
          timestamp: bar.timestamp,
          entry: price,
          stop: gexLevels.putWall - 5,
          target1: price + 15,
          target2: price + 25,
          target3: gexLevels.gammaFlip,
          confidence,
          pattern: pattern.type,
          reason: `Price bounced at put wall ${gexLevels.putWall} with ${pattern.type}`,
        });
      }
    }
    
    // GAMMA FLIP CROSS
    if (gexLevels?.gammaFlip) {
      const crossUp = prevBar.close < gexLevels.gammaFlip && bar.close > gexLevels.gammaFlip;
      const crossDown = prevBar.close > gexLevels.gammaFlip && bar.close < gexLevels.gammaFlip;
      
      if (crossUp && pattern?.direction !== 'BEARISH') {
        setups.push({
          type: 'GAMMA_FLIP_CROSS_UP',
          direction: 'LONG',
          timestamp: bar.timestamp,
          entry: price,
          stop: gexLevels.gammaFlip - 8,
          target1: gexLevels.callWall,
          confidence: 70 + (isPrimeTime ? 10 : 0),
          reason: `Crossed ABOVE gamma flip ${gexLevels.gammaFlip} - entering +γ regime`,
        });
      }
      
      if (crossDown && pattern?.direction !== 'BULLISH') {
        setups.push({
          type: 'GAMMA_FLIP_CROSS_DOWN',
          direction: 'SHORT',
          timestamp: bar.timestamp,
          entry: price,
          stop: gexLevels.gammaFlip + 8,
          target1: gexLevels.putWall,
          confidence: 70 + (isPrimeTime ? 10 : 0),
          reason: `Crossed BELOW gamma flip ${gexLevels.gammaFlip} - entering -γ regime`,
        });
      }
    }
  }
  
  return setups;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// BACKTEST ENGINE
// ═══════════════════════════════════════════════════════════════════════════════════

export function backtestSetups(setups, bars) {
  const results = [];
  
  for (const setup of setups) {
    // Find bars after setup
    const entryIndex = bars.findIndex(b => b.timestamp >= setup.timestamp);
    if (entryIndex === -1) continue;
    
    const futureBars = bars.slice(entryIndex, entryIndex + 30); // 30 bars = ~2.5 hours
    if (futureBars.length < 5) continue;
    
    let maxMove = 0;
    let minMove = 0;
    let exitPrice = setup.entry;
    let exitReason = 'TIME_EXIT';
    let pnl = 0;
    
    for (let i = 1; i < futureBars.length; i++) {
      const bar = futureBars[i];
      
      if (setup.direction === 'LONG') {
        maxMove = Math.max(maxMove, bar.high - setup.entry);
        minMove = Math.min(minMove, bar.low - setup.entry);
        
        // Check stop
        if (bar.low <= setup.stop) {
          exitPrice = setup.stop;
          exitReason = 'STOPPED';
          pnl = setup.stop - setup.entry;
          break;
        }
        
        // Check target 1
        if (bar.high >= setup.target1) {
          exitPrice = setup.target1;
          exitReason = 'TARGET_1';
          pnl = setup.target1 - setup.entry;
          break;
        }
      } else { // SHORT
        maxMove = Math.max(maxMove, setup.entry - bar.low);
        minMove = Math.min(minMove, setup.entry - bar.high);
        
        // Check stop
        if (bar.high >= setup.stop) {
          exitPrice = setup.stop;
          exitReason = 'STOPPED';
          pnl = setup.entry - setup.stop;
          break;
        }
        
        // Check target 1
        if (bar.low <= setup.target1) {
          exitPrice = setup.target1;
          exitReason = 'TARGET_1';
          pnl = setup.entry - setup.target1;
          break;
        }
      }
    }
    
    // If no exit, use last bar
    if (exitReason === 'TIME_EXIT') {
      exitPrice = futureBars[futureBars.length - 1].close;
      pnl = setup.direction === 'LONG' 
        ? exitPrice - setup.entry 
        : setup.entry - exitPrice;
    }
    
    results.push({
      ...setup,
      exitPrice,
      exitReason,
      pnl,
      maxMove,
      minMove,
      win: pnl > 0,
    });
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// LIVE COMMENTARY GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════════

export function generateCommentary(price, gexLevels, vix, recentSetups = []) {
  const comments = [];
  const now = new Date();
  
  if (!gexLevels) {
    comments.push({ type: 'info', text: '📊 Analyzing market structure...' });
    return comments;
  }
  
  const distToFlip = price - gexLevels.gammaFlip;
  const distToCallWall = gexLevels.callWall - price;
  const distToPutWall = price - gexLevels.putWall;
  
  // Regime commentary
  if (gexLevels.regime === 'POSITIVE') {
    comments.push({
      type: 'info',
      text: `✅ POSITIVE GAMMA: Dealers will SELL rallies and BUY dips. Expect mean reversion, lower volatility.`,
    });
  } else {
    comments.push({
      type: 'warning',
      text: `⚠️ NEGATIVE GAMMA: Dealers will BUY rallies and SELL dips. Expect trend acceleration, higher volatility!`,
    });
  }
  
  // Proximity alerts
  if (distToCallWall < 10) {
    comments.push({
      type: 'alert',
      text: `🧱 APPROACHING CALL WALL at ${gexLevels.callWall}! Only ${distToCallWall.toFixed(1)} pts away. Watch for rejection SHORT setup.`,
    });
  }
  
  if (distToPutWall < 10) {
    comments.push({
      type: 'alert',
      text: `💎 APPROACHING PUT WALL at ${gexLevels.putWall}! Only ${distToPutWall.toFixed(1)} pts away. Watch for bounce LONG setup.`,
    });
  }
  
  if (Math.abs(distToFlip) < 5) {
    comments.push({
      type: 'alert',
      text: `⚡ AT GAMMA FLIP ${gexLevels.gammaFlip}! Regime change imminent. Momentum will accelerate on break.`,
    });
  }
  
  // VIX context
  if (vix) {
    if (vix > 25) {
      comments.push({ type: 'warning', text: `🔥 HIGH VIX (${vix.toFixed(1)}): Wide stops required. Consider reducing size.` });
    } else if (vix < 15) {
      comments.push({ type: 'info', text: `😌 LOW VIX (${vix.toFixed(1)}): Calm conditions. Walls should hold firmly.` });
    }
  }
  
  // Recent setups commentary
  const recentHigh = recentSetups.filter(s => s.confidence >= 75);
  if (recentHigh.length > 0) {
    const latest = recentHigh[recentHigh.length - 1];
    comments.push({
      type: 'signal',
      text: `🎯 RECENT ${latest.confidence}% SETUP: ${latest.type.replace(/_/g, ' ')} at ${latest.entry.toFixed(2)} → Target ${latest.target1.toFixed(0)}`,
    });
  }
  
  // Position guidance
  if (distToFlip > 0 && distToCallWall > 20) {
    comments.push({
      type: 'guidance',
      text: `📈 BIAS: Bullish above γ-flip. Look for pullbacks to ${gexLevels.gammaFlip} for LONG entries.`,
    });
  } else if (distToFlip < 0 && distToPutWall > 20) {
    comments.push({
      type: 'guidance',
      text: `📉 BIAS: Bearish below γ-flip. Look for rallies to ${gexLevels.gammaFlip} for SHORT entries.`,
    });
  }
  
  return comments;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// TRADE GUIDANCE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════════

export function generateTradeGuidance(activeSetup, currentPrice, bars) {
  if (!activeSetup) return null;
  
  const entryPrice = activeSetup.entry;
  const direction = activeSetup.direction;
  const pnlPoints = direction === 'LONG' 
    ? currentPrice - entryPrice 
    : entryPrice - currentPrice;
  const pnlPercent = (pnlPoints / entryPrice) * 100;
  
  const guidance = {
    setup: activeSetup,
    currentPrice,
    pnlPoints,
    pnlPercent,
    status: 'ACTIVE',
    action: 'HOLD',
    messages: [],
  };
  
  // Check stop hit
  if (direction === 'LONG' && currentPrice <= activeSetup.stop) {
    guidance.status = 'STOPPED';
    guidance.action = 'EXIT';
    guidance.messages.push(`❌ STOP HIT at ${activeSetup.stop}. Exit trade.`);
    return guidance;
  }
  if (direction === 'SHORT' && currentPrice >= activeSetup.stop) {
    guidance.status = 'STOPPED';
    guidance.action = 'EXIT';
    guidance.messages.push(`❌ STOP HIT at ${activeSetup.stop}. Exit trade.`);
    return guidance;
  }
  
  // Check targets
  if (direction === 'LONG') {
    if (currentPrice >= activeSetup.target1) {
      guidance.status = 'TARGET_1_HIT';
      guidance.action = 'PARTIAL_EXIT';
      guidance.messages.push(`🎯 TARGET 1 HIT! Take 50% profit at ${activeSetup.target1}. Move stop to breakeven.`);
    }
    if (activeSetup.target2 && currentPrice >= activeSetup.target2) {
      guidance.status = 'TARGET_2_HIT';
      guidance.action = 'PARTIAL_EXIT';
      guidance.messages.push(`🎯 TARGET 2 HIT! Take another 25% at ${activeSetup.target2}. Trail stop.`);
    }
  } else { // SHORT
    if (currentPrice <= activeSetup.target1) {
      guidance.status = 'TARGET_1_HIT';
      guidance.action = 'PARTIAL_EXIT';
      guidance.messages.push(`🎯 TARGET 1 HIT! Take 50% profit at ${activeSetup.target1}. Move stop to breakeven.`);
    }
    if (activeSetup.target2 && currentPrice <= activeSetup.target2) {
      guidance.status = 'TARGET_2_HIT';
      guidance.action = 'PARTIAL_EXIT';
      guidance.messages.push(`🎯 TARGET 2 HIT! Take another 25% at ${activeSetup.target2}. Trail stop.`);
    }
  }
  
  // Active trade guidance
  if (guidance.status === 'ACTIVE') {
    if (pnlPoints > 5) {
      guidance.messages.push(`✅ Trade in profit (+${pnlPoints.toFixed(1)} pts). Consider moving stop to breakeven.`);
    } else if (pnlPoints < -3) {
      guidance.messages.push(`⚠️ Trade underwater (${pnlPoints.toFixed(1)} pts). Hold if thesis intact, stop at ${activeSetup.stop}.`);
    } else {
      guidance.messages.push(`📊 Trade near entry. Patience - let the setup play out.`);
    }
    
    // Drawdown warning
    if (pnlPercent < -0.25) {
      guidance.messages.push(`🚨 MAX DRAWDOWN WARNING: -${Math.abs(pnlPercent).toFixed(2)}% - Consider exiting if > -0.4%`);
    }
  }
  
  return guidance;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// FULL ANALYSIS RUNNER
// ═══════════════════════════════════════════════════════════════════════════════════

export async function runFullAnalysis() {
  console.log('\n🚀 Running Full Historical Analysis...\n');
  
  // Fetch data
  const spxBars = await fetchHistoricalBars('I:SPX', 7, 5);
  const vixBars = await fetchHistoricalBars('I:VIX', 7, 5);
  const spxDaily = await fetchDailyBars('I:SPX', 30);
  
  if (!spxBars.length) {
    return { error: 'No SPX data available' };
  }
  
  const currentPrice = spxBars[spxBars.length - 1].close;
  const currentVix = vixBars.length > 0 ? vixBars[vixBars.length - 1].close : 15;
  
  console.log(`📊 Current SPX: ${currentPrice}`);
  console.log(`📊 Current VIX: ${currentVix}`);
  
  // Calculate GEX levels
  const gexLevels = calculateDynamicGEXLevels(spxBars, currentPrice);
  console.log(`\n⚡ Gamma Flip: ${gexLevels.gammaFlip}`);
  console.log(`🧱 Call Wall: ${gexLevels.callWall}`);
  console.log(`💎 Put Wall: ${gexLevels.putWall}`);
  console.log(`📊 Regime: ${gexLevels.regime}`);
  console.log(`📏 ATR: ${gexLevels.atr.toFixed(2)}`);
  
  // Detect setups
  const setups = detectTradeSetups(spxBars, gexLevels);
  console.log(`\n🎯 Found ${setups.length} trade setups`);
  
  // Backtest
  const backtestResults = backtestSetups(setups, spxBars);
  const wins = backtestResults.filter(r => r.win).length;
  const winRate = backtestResults.length > 0 ? (wins / backtestResults.length * 100).toFixed(1) : 0;
  const totalPnl = backtestResults.reduce((sum, r) => sum + r.pnl, 0);
  
  console.log(`\n📈 BACKTEST RESULTS:`);
  console.log(`   Trades: ${backtestResults.length}`);
  console.log(`   Wins: ${wins} (${winRate}%)`);
  console.log(`   Total P&L: ${totalPnl.toFixed(1)} pts`);
  
  // Generate commentary
  const commentary = generateCommentary(currentPrice, gexLevels, currentVix, setups);
  
  return {
    currentPrice,
    currentVix,
    gexLevels,
    setups,
    backtestResults,
    stats: {
      trades: backtestResults.length,
      wins,
      winRate: parseFloat(winRate),
      totalPnl,
      avgPnl: backtestResults.length > 0 ? totalPnl / backtestResults.length : 0,
    },
    commentary,
    bars: spxBars,
    dailyBars: spxDaily,
  };
}

export default {
  fetchHistoricalBars,
  fetchDailyBars,
  calculateATR,
  detectCandlePattern,
  detectSwingPoints,
  calculateDynamicGEXLevels,
  detectTradeSetups,
  backtestSetups,
  generateCommentary,
  generateTradeGuidance,
  runFullAnalysis,
};
