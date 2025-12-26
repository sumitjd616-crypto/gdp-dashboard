/**
 * TITAN OMEGA - Full Historical Analysis Runner
 * 
 * Fetches last week's SPX data and runs complete analysis
 */

const API_KEY = 'jnPOfM0gm3j6m9LJLQWGJo2PZd2gVBxa';
const BASE_URL = 'https://api.polygon.io';

// ═══════════════════════════════════════════════════════════════════════════════════
// DATA FETCHING
// ═══════════════════════════════════════════════════════════════════════════════════

async function fetchBars(ticker, days, timeframe) {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const url = `${BASE_URL}/v2/aggs/ticker/${ticker}/range/${timeframe}/minute/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${API_KEY}`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK' || !data.results?.length) {
    console.warn(`No data for ${ticker}`);
    return [];
  }
  
  return data.results.map(bar => ({
    timestamp: new Date(bar.t),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v || 0,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════════
// TECHNICAL ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════════

function calculateATR(bars, period = 14) {
  if (bars.length < period + 1) return 20;
  
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

function detectCandlePattern(bar, prevBar) {
  if (!bar || !prevBar) return null;
  
  const body = bar.close - bar.open;
  const range = bar.high - bar.low;
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;
  const bodySize = Math.abs(body);
  
  if (upperWick > bodySize * 2 && lowerWick < bodySize * 0.5 && body < 0) {
    return { type: 'SHOOTING_STAR', direction: 'BEARISH', strength: 85 };
  }
  if (lowerWick > bodySize * 2 && upperWick < bodySize * 0.5 && body > 0) {
    return { type: 'HAMMER', direction: 'BULLISH', strength: 85 };
  }
  if (body < 0 && prevBar.close > prevBar.open && bar.open > prevBar.close && bar.close < prevBar.open) {
    return { type: 'BEARISH_ENGULFING', direction: 'BEARISH', strength: 80 };
  }
  if (body > 0 && prevBar.close < prevBar.open && bar.open < prevBar.close && bar.close > prevBar.open) {
    return { type: 'BULLISH_ENGULFING', direction: 'BULLISH', strength: 80 };
  }
  if (bodySize > range * 0.7) {
    return { type: body > 0 ? 'BULLISH_MARUBOZU' : 'BEARISH_MARUBOZU', direction: body > 0 ? 'BULLISH' : 'BEARISH', strength: 70 };
  }
  
  return null;
}

function detectSwingPoints(bars, lookback = 5) {
  const swings = { highs: [], lows: [] };
  
  for (let i = lookback; i < bars.length - lookback; i++) {
    const current = bars[i];
    let isHigh = true, isLow = true;
    
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].high >= current.high) isHigh = false;
      if (bars[j].low <= current.low) isLow = false;
    }
    
    if (isHigh) swings.highs.push({ price: current.high, time: current.timestamp });
    if (isLow) swings.lows.push({ price: current.low, time: current.timestamp });
  }
  
  return swings;
}

function calculateGEXLevels(bars, currentPrice) {
  const recentBars = bars.slice(-100);
  const swings = detectSwingPoints(recentBars, 3);
  const round5 = p => Math.round(p / 5) * 5;
  const atr = calculateATR(recentBars);
  
  const resistances = swings.highs.map(s => s.price).filter(p => p > currentPrice).sort((a, b) => a - b);
  const supports = swings.lows.map(s => s.price).filter(p => p < currentPrice).sort((a, b) => b - a);
  
  const last20 = recentBars.slice(-20);
  const midHigh = Math.max(...last20.map(b => b.high));
  const midLow = Math.min(...last20.map(b => b.low));
  const gammaFlip = round5((midHigh + midLow) / 2);
  
  const callWall = resistances.length > 0 ? round5(resistances[0]) : round5(currentPrice + atr * 2);
  const putWall = supports.length > 0 ? round5(supports[0]) : round5(currentPrice - atr * 2);
  
  return { gammaFlip, callWall, putWall, atr, regime: currentPrice > gammaFlip ? 'POSITIVE' : 'NEGATIVE' };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// SETUP DETECTION & BACKTEST
// ═══════════════════════════════════════════════════════════════════════════════════

function detectSetups(bars, gex) {
  const setups = [];
  
  for (let i = 5; i < bars.length; i++) {
    const bar = bars[i];
    const prevBar = bars[i-1];
    const price = bar.close;
    const pattern = detectCandlePattern(bar, prevBar);
    
    const hour = bar.timestamp.getUTCHours() - 5; // EST
    const isPrimeTime = (hour >= 9 && hour < 11) || (hour >= 14 && hour < 16);
    
    // Call wall rejection
    if (Math.abs(price - gex.callWall) < 8 && pattern?.direction === 'BEARISH') {
      const conf = Math.min(95, 55 + (Math.abs(price - gex.callWall) < 3 ? 20 : 0) + (isPrimeTime ? 15 : 0));
      setups.push({
        type: 'CALL_WALL_REJECTION', direction: 'SHORT', timestamp: bar.timestamp,
        entry: price, stop: gex.callWall + 5, target: price - 15, confidence: conf,
        pattern: pattern?.type, barIndex: i
      });
    }
    
    // Put wall bounce
    if (Math.abs(price - gex.putWall) < 8 && pattern?.direction === 'BULLISH') {
      const conf = Math.min(95, 55 + (Math.abs(price - gex.putWall) < 3 ? 20 : 0) + (isPrimeTime ? 15 : 0));
      setups.push({
        type: 'PUT_WALL_BOUNCE', direction: 'LONG', timestamp: bar.timestamp,
        entry: price, stop: gex.putWall - 5, target: price + 15, confidence: conf,
        pattern: pattern?.type, barIndex: i
      });
    }
    
    // Gamma flip cross
    if (prevBar.close < gex.gammaFlip && bar.close > gex.gammaFlip) {
      setups.push({
        type: 'GAMMA_FLIP_CROSS_UP', direction: 'LONG', timestamp: bar.timestamp,
        entry: price, stop: gex.gammaFlip - 8, target: gex.callWall, confidence: 70,
        barIndex: i
      });
    }
    if (prevBar.close > gex.gammaFlip && bar.close < gex.gammaFlip) {
      setups.push({
        type: 'GAMMA_FLIP_CROSS_DOWN', direction: 'SHORT', timestamp: bar.timestamp,
        entry: price, stop: gex.gammaFlip + 8, target: gex.putWall, confidence: 70,
        barIndex: i
      });
    }
  }
  
  return setups;
}

function backtestSetups(setups, bars) {
  const results = [];
  
  for (const setup of setups) {
    const startIdx = setup.barIndex;
    if (startIdx === undefined) continue;
    
    const futureBars = bars.slice(startIdx, startIdx + 30);
    if (futureBars.length < 5) continue;
    
    let pnl = 0, exitReason = 'TIME', maxFavorable = 0, maxAdverse = 0;
    
    for (let i = 1; i < futureBars.length; i++) {
      const bar = futureBars[i];
      
      if (setup.direction === 'LONG') {
        maxFavorable = Math.max(maxFavorable, bar.high - setup.entry);
        maxAdverse = Math.min(maxAdverse, bar.low - setup.entry);
        
        if (bar.low <= setup.stop) { pnl = setup.stop - setup.entry; exitReason = 'STOP'; break; }
        if (bar.high >= setup.target) { pnl = setup.target - setup.entry; exitReason = 'TARGET'; break; }
      } else {
        maxFavorable = Math.max(maxFavorable, setup.entry - bar.low);
        maxAdverse = Math.min(maxAdverse, setup.entry - bar.high);
        
        if (bar.high >= setup.stop) { pnl = setup.entry - setup.stop; exitReason = 'STOP'; break; }
        if (bar.low <= setup.target) { pnl = setup.entry - setup.target; exitReason = 'TARGET'; break; }
      }
    }
    
    if (exitReason === 'TIME') {
      const lastBar = futureBars[futureBars.length - 1];
      pnl = setup.direction === 'LONG' ? lastBar.close - setup.entry : setup.entry - lastBar.close;
    }
    
    results.push({ ...setup, pnl, exitReason, win: pnl > 0, maxFavorable, maxAdverse });
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// MAIN ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('   🎯 TITAN OMEGA - HOLY GRAIL ANALYSIS');
  console.log('   Last Week SPX Data Analysis with GEX-Based Trade Detection');
  console.log('═'.repeat(70) + '\n');
  
  // Fetch data
  console.log('📡 Fetching last 7 days of SPX 5-minute bars...');
  const spxBars = await fetchBars('I:SPX', 7, 5);
  
  if (!spxBars.length) {
    console.log('❌ No SPX data available');
    return;
  }
  
  console.log(`✅ Loaded ${spxBars.length} bars\n`);
  
  // Get VIX
  console.log('📡 Fetching VIX data...');
  const vixBars = await fetchBars('I:VIX', 7, 5);
  const currentVix = vixBars.length > 0 ? vixBars[vixBars.length - 1].close : 15;
  
  // Current state
  const currentPrice = spxBars[spxBars.length - 1].close;
  const dayHigh = Math.max(...spxBars.slice(-78).map(b => b.high)); // Last day
  const dayLow = Math.min(...spxBars.slice(-78).map(b => b.low));
  
  console.log('\n' + '─'.repeat(70));
  console.log('   📊 CURRENT MARKET STATE');
  console.log('─'.repeat(70));
  console.log(`   SPX Price:    ${currentPrice.toFixed(2)}`);
  console.log(`   Day High:     ${dayHigh.toFixed(2)}`);
  console.log(`   Day Low:      ${dayLow.toFixed(2)}`);
  console.log(`   Day Range:    ${(dayHigh - dayLow).toFixed(2)} pts`);
  console.log(`   VIX:          ${currentVix.toFixed(2)}`);
  
  // Calculate GEX levels
  const gex = calculateGEXLevels(spxBars, currentPrice);
  const atr = calculateATR(spxBars.slice(-100));
  
  console.log('\n' + '─'.repeat(70));
  console.log('   ⚡ GEX LEVELS (Model-Based)');
  console.log('─'.repeat(70));
  console.log(`   Gamma Flip:   ${gex.gammaFlip} ${currentPrice > gex.gammaFlip ? '(ABOVE ✅)' : '(BELOW ⚠️)'}`);
  console.log(`   Call Wall:    ${gex.callWall} (${(gex.callWall - currentPrice).toFixed(1)} pts away)`);
  console.log(`   Put Wall:     ${gex.putWall} (${(currentPrice - gex.putWall).toFixed(1)} pts away)`);
  console.log(`   Regime:       ${gex.regime} GAMMA`);
  console.log(`   ATR (14):     ${atr.toFixed(2)} pts`);
  
  // Detect setups
  const setups = detectSetups(spxBars, gex);
  const highConfSetups = setups.filter(s => s.confidence >= 70);
  
  console.log('\n' + '─'.repeat(70));
  console.log('   🎯 TRADE SETUPS DETECTED');
  console.log('─'.repeat(70));
  console.log(`   Total Setups:      ${setups.length}`);
  console.log(`   High Conf (≥70%):  ${highConfSetups.length}`);
  
  // Backtest
  const results = backtestSetups(setups, spxBars);
  const highConfResults = backtestSetups(highConfSetups, spxBars);
  
  const calcStats = (r) => {
    const wins = r.filter(x => x.win).length;
    const total = r.length;
    const totalPnl = r.reduce((s, x) => s + x.pnl, 0);
    const avgPnl = total > 0 ? totalPnl / total : 0;
    const winRate = total > 0 ? (wins / total * 100) : 0;
    return { wins, total, totalPnl, avgPnl, winRate };
  };
  
  const allStats = calcStats(results);
  const highStats = calcStats(highConfResults);
  
  console.log('\n' + '─'.repeat(70));
  console.log('   📈 BACKTEST RESULTS');
  console.log('─'.repeat(70));
  console.log('\n   ALL SETUPS:');
  console.log(`   ├─ Trades:     ${allStats.total}`);
  console.log(`   ├─ Wins:       ${allStats.wins} (${allStats.winRate.toFixed(1)}%)`);
  console.log(`   ├─ Total P&L:  ${allStats.totalPnl.toFixed(1)} pts`);
  console.log(`   └─ Avg P&L:    ${allStats.avgPnl.toFixed(2)} pts/trade`);
  
  console.log('\n   HIGH CONFIDENCE (≥70%):');
  console.log(`   ├─ Trades:     ${highStats.total}`);
  console.log(`   ├─ Wins:       ${highStats.wins} (${highStats.winRate.toFixed(1)}%)`);
  console.log(`   ├─ Total P&L:  ${highStats.totalPnl.toFixed(1)} pts`);
  console.log(`   └─ Avg P&L:    ${highStats.avgPnl.toFixed(2)} pts/trade`);
  
  // Breakdown by type
  console.log('\n   BY SETUP TYPE:');
  const types = ['CALL_WALL_REJECTION', 'PUT_WALL_BOUNCE', 'GAMMA_FLIP_CROSS_UP', 'GAMMA_FLIP_CROSS_DOWN'];
  for (const type of types) {
    const typeResults = results.filter(r => r.type === type);
    if (typeResults.length > 0) {
      const stats = calcStats(typeResults);
      const icon = type.includes('LONG') || type.includes('BOUNCE') || type.includes('UP') ? '🟢' : '🔴';
      console.log(`   ${icon} ${type.replace(/_/g, ' ')}`);
      console.log(`      Trades: ${stats.total} | Win: ${stats.winRate.toFixed(0)}% | P&L: ${stats.totalPnl.toFixed(1)} pts`);
    }
  }
  
  // Recent high-confidence setups
  const recentHigh = highConfSetups.slice(-5);
  if (recentHigh.length > 0) {
    console.log('\n' + '─'.repeat(70));
    console.log('   🎯 RECENT HIGH-CONFIDENCE SETUPS');
    console.log('─'.repeat(70));
    for (const setup of recentHigh) {
      const time = setup.timestamp.toLocaleString('en-US', { 
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
      });
      const dir = setup.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
      console.log(`\n   ${dir} @ ${setup.entry.toFixed(2)} | ${time}`);
      console.log(`   Type: ${setup.type.replace(/_/g, ' ')}`);
      console.log(`   Confidence: ${setup.confidence}%${setup.pattern ? ` | Pattern: ${setup.pattern}` : ''}`);
      console.log(`   Stop: ${setup.stop.toFixed(2)} | Target: ${setup.target.toFixed(2)}`);
    }
  }
  
  // Live commentary
  console.log('\n' + '─'.repeat(70));
  console.log('   💬 LIVE COMMENTARY');
  console.log('─'.repeat(70));
  
  const distToFlip = currentPrice - gex.gammaFlip;
  const distToCall = gex.callWall - currentPrice;
  const distToPut = currentPrice - gex.putWall;
  
  if (gex.regime === 'POSITIVE') {
    console.log('\n   ✅ POSITIVE GAMMA REGIME');
    console.log('   Dealers will SELL rallies and BUY dips.');
    console.log('   → Expect mean reversion, lower volatility');
    console.log('   → Fade moves to extremes');
  } else {
    console.log('\n   ⚠️ NEGATIVE GAMMA REGIME');
    console.log('   Dealers will BUY rallies and SELL dips.');
    console.log('   → Expect trend acceleration, higher volatility');
    console.log('   → Ride momentum, don\'t fade');
  }
  
  if (distToCall < 15) {
    console.log(`\n   🧱 APPROACHING CALL WALL (${gex.callWall})`);
    console.log(`   Only ${distToCall.toFixed(1)} pts away!`);
    console.log('   → Watch for rejection SHORT setup');
    console.log('   → Look for shooting star, bearish engulfing');
  }
  
  if (distToPut < 15) {
    console.log(`\n   💎 APPROACHING PUT WALL (${gex.putWall})`);
    console.log(`   Only ${distToPut.toFixed(1)} pts away!`);
    console.log('   → Watch for bounce LONG setup');
    console.log('   → Look for hammer, bullish engulfing');
  }
  
  if (Math.abs(distToFlip) < 5) {
    console.log(`\n   ⚡ AT GAMMA FLIP (${gex.gammaFlip})`);
    console.log('   Regime change zone!');
    console.log('   → Momentum will accelerate on break');
    console.log('   → Trade the direction of the cross');
  }
  
  // Trading guidance
  console.log('\n' + '─'.repeat(70));
  console.log('   📍 TRADING GUIDANCE');
  console.log('─'.repeat(70));
  
  if (distToFlip > 0) {
    console.log('\n   BIAS: BULLISH (above gamma flip)');
    console.log(`   • Look for pullbacks to ${gex.gammaFlip} for LONG entries`);
    console.log(`   • Target: ${gex.callWall} (call wall)`);
    console.log(`   • Stop: ${(gex.gammaFlip - 8).toFixed(0)} (below flip)`);
  } else {
    console.log('\n   BIAS: BEARISH (below gamma flip)');
    console.log(`   • Look for rallies to ${gex.gammaFlip} for SHORT entries`);
    console.log(`   • Target: ${gex.putWall} (put wall)`);
    console.log(`   • Stop: ${(gex.gammaFlip + 8).toFixed(0)} (above flip)`);
  }
  
  console.log('\n   RISK MANAGEMENT:');
  console.log(`   • Max risk per trade: ${(atr * 0.5).toFixed(1)} pts (0.5 ATR)`);
  console.log(`   • First target: ${(atr * 1).toFixed(1)} pts (1 ATR)`);
  console.log(`   • Runner target: ${(atr * 2).toFixed(1)} pts (2 ATR)`);
  console.log('   • Max daily loss: 25 pts');
  console.log('   • Max drawdown per trade: 25%');
  
  console.log('\n' + '═'.repeat(70));
  console.log('   🎯 HOLY GRAIL SUMMARY');
  console.log('═'.repeat(70));
  console.log(`\n   SPX: ${currentPrice.toFixed(2)} | VIX: ${currentVix.toFixed(2)} | Regime: ${gex.regime}`);
  console.log(`   γ-Flip: ${gex.gammaFlip} | Call: ${gex.callWall} | Put: ${gex.putWall}`);
  console.log(`   High-Conf Win Rate: ${highStats.winRate.toFixed(1)}% over ${highStats.total} trades`);
  console.log(`   Avg P&L: ${highStats.avgPnl.toFixed(2)} pts/trade\n`);
  
  if (highStats.winRate >= 60) {
    console.log('   ✅ EDGE CONFIRMED - System showing positive expectancy!');
  } else {
    console.log('   ⚠️ Refine filters - Need higher selectivity for setups');
  }
  
  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
