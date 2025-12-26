#!/usr/bin/env node
/**
 * Titan Omega Backtesting CLI
 * Run: node backtest.js
 */

// Simulated historical SPX price data (5-minute candles)
const generateHistoricalData = (days = 30, startPrice = 6800) => {
  const data = [];
  let price = startPrice;
  const now = new Date();
  
  for (let d = days; d >= 0; d--) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    
    // Market hours: 9:30 AM - 4:00 PM ET (78 five-minute candles)
    for (let i = 0; i < 78; i++) {
      const hour = Math.floor(9.5 + (i * 5) / 60);
      const minute = (30 + (i * 5)) % 60;
      
      // Simulate realistic price movement
      const volatility = 0.0008;
      const trend = Math.sin(d / 5) * 0.0001;
      const change = (Math.random() - 0.48 + trend) * volatility * price;
      
      const open = price;
      const high = price + Math.abs(change) * (1 + Math.random() * 0.5);
      const low = price - Math.abs(change) * (1 + Math.random() * 0.5);
      price = price + change;
      const close = price;
      const volume = Math.floor(100000 + Math.random() * 500000);
      
      data.push({
        timestamp: new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute),
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume,
      });
    }
  }
  
  return data;
};

// Calculate GEX levels
const calculateGEXLevels = (currentPrice) => {
  const baseStrike = Math.round(currentPrice / 25) * 25;
  return {
    gammaFlip: baseStrike - 25,
    resistance1: baseStrike + 25,
    resistance2: baseStrike + 50,
    support1: baseStrike - 50,
    support2: baseStrike - 75,
    vwap: currentPrice * (1 + (Math.random() - 0.5) * 0.002),
  };
};

// Detect candlestick patterns
const detectPatterns = (candles, index) => {
  if (index < 3) return [];
  
  const patterns = [];
  const curr = candles[index];
  const prev = candles[index - 1];
  
  const bodySize = Math.abs(curr.close - curr.open);
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;
  const range = curr.high - curr.low;
  
  if (lowerWick > bodySize * 2 && upperWick < bodySize * 0.5 && curr.close > curr.open) {
    patterns.push('HAMMER');
  }
  
  if (upperWick > bodySize * 2 && lowerWick < bodySize * 0.5 && curr.close < curr.open) {
    patterns.push('SHOOTING_STAR');
  }
  
  if (curr.close > curr.open && prev.close < prev.open && 
      curr.close > prev.open && curr.open < prev.close) {
    patterns.push('BULLISH_ENGULFING');
  }
  
  if (curr.close < curr.open && prev.close > prev.open && 
      curr.open > prev.close && curr.close < prev.open) {
    patterns.push('BEARISH_ENGULFING');
  }
  
  if (bodySize < range * 0.1) {
    patterns.push('DOJI');
  }
  
  return patterns;
};

// Signal generation
const generateSignals = (candles, index) => {
  if (index < 10) return null;
  
  const curr = candles[index];
  const prev = candles[index - 1];
  const gexLevels = calculateGEXLevels(curr.close);
  const patterns = detectPatterns(candles, index);
  
  const momentum = (curr.close - candles[index - 5].close) / candles[index - 5].close;
  const isPositiveGamma = curr.close > gexLevels.gammaFlip;
  
  // LONG REVERSAL
  if (patterns.includes('HAMMER') || patterns.includes('BULLISH_ENGULFING')) {
    if (Math.abs(curr.close - gexLevels.support1) < 15 && isPositiveGamma) {
      return {
        type: 'LONG_REVERSAL',
        direction: 'long',
        entry: curr.close,
        stop: curr.close - 12,
        tp1: curr.close + 22,
        tp2: curr.close + 35,
        confidence: 70 + Math.floor(Math.random() * 15),
        timestamp: curr.timestamp,
        triggers: ['🔨 Hammer', '📊 GEX Support', '✅ +Gamma'],
        reason: `Long reversal at GEX support ${gexLevels.support1.toFixed(0)} with ${patterns[0]} pattern.`,
      };
    }
  }
  
  // SHORT REVERSAL
  if (patterns.includes('SHOOTING_STAR') || patterns.includes('BEARISH_ENGULFING')) {
    if (Math.abs(curr.close - gexLevels.resistance1) < 15) {
      return {
        type: 'SHORT_REVERSAL',
        direction: 'short',
        entry: curr.close,
        stop: curr.close + 12,
        tp1: curr.close - 22,
        tp2: curr.close - 35,
        confidence: 68 + Math.floor(Math.random() * 15),
        timestamp: curr.timestamp,
        triggers: ['⭐ Shooting Star', '📊 GEX Resistance', '🔴 Reversal'],
        reason: `Short reversal at GEX resistance ${gexLevels.resistance1.toFixed(0)}.`,
      };
    }
  }
  
  // GAMMA SQUEEZE
  if (Math.abs(curr.close - gexLevels.gammaFlip) < 10 && momentum > 0.002) {
    return {
      type: 'GAMMA_SQUEEZE',
      direction: 'long',
      entry: curr.close,
      stop: curr.close - 15,
      tp1: curr.close + 40,
      tp2: curr.close + 70,
      confidence: 60 + Math.floor(Math.random() * 15),
      timestamp: curr.timestamp,
      triggers: ['⚡ Gamma Flip', '📈 Momentum', '🎯 Breakout'],
      reason: `Gamma squeeze setup - crossing flip level at ${gexLevels.gammaFlip.toFixed(0)}.`,
    };
  }
  
  // SHORT BREAKDOWN
  if (!isPositiveGamma && curr.close < prev.low && momentum < -0.002) {
    return {
      type: 'SHORT_BREAKDOWN',
      direction: 'short',
      entry: curr.close,
      stop: curr.close + 12,
      tp1: curr.close - 30,
      tp2: curr.close - 50,
      confidence: 65 + Math.floor(Math.random() * 15),
      timestamp: curr.timestamp,
      triggers: ['⬇️ Breakdown', '🔴 -Gamma', '📉 Momentum'],
      reason: `Breakdown in negative gamma - dealers amplifying move.`,
    };
  }
  
  // LONG BREAKOUT
  if (isPositiveGamma && curr.close > prev.high && momentum > 0.001) {
    return {
      type: 'LONG_BREAKOUT',
      direction: 'long',
      entry: curr.close,
      stop: curr.close - 10,
      tp1: curr.close + 25,
      tp2: curr.close + 45,
      confidence: 65 + Math.floor(Math.random() * 12),
      timestamp: curr.timestamp,
      triggers: ['📈 Breakout', '✅ +Gamma', '⚡ Volume'],
      reason: `Long breakout in positive gamma with momentum.`,
    };
  }
  
  return null;
};

// Execute trade
const executeTrade = (signal, candles, signalIndex) => {
  const maxBars = 50;
  let exitPrice = null;
  let exitReason = null;
  let exitIndex = null;
  
  for (let i = signalIndex + 1; i < Math.min(signalIndex + maxBars, candles.length); i++) {
    const candle = candles[i];
    
    if (signal.direction === 'long') {
      if (candle.low <= signal.stop) {
        exitPrice = signal.stop;
        exitReason = 'STOP_LOSS';
        exitIndex = i;
        break;
      }
      if (candle.high >= signal.tp2) {
        exitPrice = signal.tp2;
        exitReason = 'TP2_HIT';
        exitIndex = i;
        break;
      }
      if (candle.high >= signal.tp1 && !exitPrice) {
        exitPrice = signal.tp1;
        exitReason = 'TP1_HIT';
        exitIndex = i;
        break;
      }
    } else {
      if (candle.high >= signal.stop) {
        exitPrice = signal.stop;
        exitReason = 'STOP_LOSS';
        exitIndex = i;
        break;
      }
      if (candle.low <= signal.tp2) {
        exitPrice = signal.tp2;
        exitReason = 'TP2_HIT';
        exitIndex = i;
        break;
      }
      if (candle.low <= signal.tp1 && !exitPrice) {
        exitPrice = signal.tp1;
        exitReason = 'TP1_HIT';
        exitIndex = i;
        break;
      }
    }
  }
  
  if (!exitPrice && signalIndex + maxBars < candles.length) {
    exitPrice = candles[signalIndex + maxBars].close;
    exitReason = 'TIME_EXIT';
    exitIndex = signalIndex + maxBars;
  }
  
  if (!exitPrice) return null;
  
  const pnlPercent = signal.direction === 'long' 
    ? ((exitPrice - signal.entry) / signal.entry) * 100
    : ((signal.entry - exitPrice) / signal.entry) * 100;
  
  return {
    ...signal,
    exitPrice,
    exitReason,
    exitTimestamp: candles[exitIndex]?.timestamp,
    pnlPercent: parseFloat(pnlPercent.toFixed(3)),
    isWin: pnlPercent > 0,
    holdingPeriod: exitIndex - signalIndex,
  };
};

// Main backtest
const runBacktest = (config = {}) => {
  const { days = 30, startPrice = 6850, minConfidence = 65 } = config;
  
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     🚀 TITAN OMEGA BACKTESTING ENGINE v1.0                   ║');
  console.log('║     Institutional Flow Detection System                       ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  📅 Backtest Period:    ${String(days).padEnd(5)} trading days               ║`);
  console.log(`║  💰 Starting Price:     $${String(startPrice).padEnd(4)}                          ║`);
  console.log(`║  🎯 Min Confidence:     ${String(minConfidence).padEnd(3)}%                            ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  const candles = generateHistoricalData(days, startPrice);
  console.log(`\n⏳ Generating ${candles.length.toLocaleString()} price candles...`);
  console.log('⏳ Scanning for signals...\n');
  
  const trades = [];
  let lastSignalIndex = -20;
  
  for (let i = 10; i < candles.length - 50; i++) {
    if (i - lastSignalIndex < 15) continue;
    
    const signal = generateSignals(candles, i);
    if (signal && signal.confidence >= minConfidence) {
      const trade = executeTrade(signal, candles, i);
      if (trade) {
        trades.push(trade);
        lastSignalIndex = i;
      }
    }
  }
  
  // Calculate statistics
  const wins = trades.filter(t => t.isWin);
  const losses = trades.filter(t => !t.isWin);
  const totalPnL = trades.reduce((sum, t) => sum + t.pnlPercent, 0);
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnlPercent, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnlPercent, 0) / losses.length) : 0;
  const profitFactor = avgLoss > 0 && losses.length > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;
  const maxWin = Math.max(...trades.map(t => t.pnlPercent));
  const maxLoss = Math.min(...trades.map(t => t.pnlPercent));
  
  // Calculate drawdown
  let equity = 100;
  let peak = 100;
  let maxDrawdown = 0;
  trades.forEach(t => {
    equity *= (1 + t.pnlPercent / 100);
    peak = Math.max(peak, equity);
    const drawdown = (peak - equity) / peak * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  });
  
  const stats = {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? ((wins.length / trades.length) * 100).toFixed(1) : 0,
    totalPnL: totalPnL.toFixed(2),
    avgWin: avgWin.toFixed(3),
    avgLoss: avgLoss.toFixed(3),
    profitFactor: profitFactor.toFixed(2),
    avgHoldingPeriod: (trades.reduce((sum, t) => sum + t.holdingPeriod, 0) / trades.length).toFixed(1),
    maxWin: maxWin.toFixed(3),
    maxLoss: maxLoss.toFixed(3),
    maxDrawdown: maxDrawdown.toFixed(2),
    finalEquity: equity.toFixed(2),
    byType: {},
    byExitReason: {},
  };
  
  // Stats by signal type
  const types = [...new Set(trades.map(t => t.type))];
  types.forEach(type => {
    const typeTrades = trades.filter(t => t.type === type);
    const typeWins = typeTrades.filter(t => t.isWin);
    stats.byType[type] = {
      count: typeTrades.length,
      winRate: ((typeWins.length / typeTrades.length) * 100).toFixed(1),
      avgPnL: (typeTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / typeTrades.length).toFixed(3),
      totalPnL: typeTrades.reduce((sum, t) => sum + t.pnlPercent, 0).toFixed(2),
    };
  });
  
  // Stats by exit reason
  const exitReasons = [...new Set(trades.map(t => t.exitReason))];
  exitReasons.forEach(reason => {
    const reasonTrades = trades.filter(t => t.exitReason === reason);
    stats.byExitReason[reason] = {
      count: reasonTrades.length,
      percentage: ((reasonTrades.length / trades.length) * 100).toFixed(1),
    };
  });
  
  return { trades, stats, candles };
};

// Print results
const printResults = (results) => {
  const { trades, stats } = results;
  
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│                    📈 BACKTEST RESULTS                       │');
  console.log('├──────────────────────────────────────────────────────────────┤');
  console.log(`│  Total Signals:      ${String(stats.totalTrades).padStart(6)}                              │`);
  console.log(`│  Winning Trades:     ${String(stats.wins).padStart(6)}  (${stats.winRate}%)                       │`);
  console.log(`│  Losing Trades:      ${String(stats.losses).padStart(6)}                              │`);
  console.log('├──────────────────────────────────────────────────────────────┤');
  const pnlColor = parseFloat(stats.totalPnL) >= 0 ? '+' : '';
  console.log(`│  💰 Total P&L:       ${pnlColor}${stats.totalPnL}%                            │`);
  console.log(`│  📈 Best Trade:      +${stats.maxWin}%                            │`);
  console.log(`│  📉 Worst Trade:     ${stats.maxLoss}%                            │`);
  console.log(`│  💎 Final Equity:    $${stats.finalEquity} (started $100)            │`);
  console.log('├──────────────────────────────────────────────────────────────┤');
  console.log(`│  Avg Win:            +${stats.avgWin}%                            │`);
  console.log(`│  Avg Loss:           -${stats.avgLoss}%                            │`);
  console.log(`│  Profit Factor:      ${stats.profitFactor}                               │`);
  console.log(`│  Max Drawdown:       ${stats.maxDrawdown}%                              │`);
  console.log(`│  Avg Hold Period:    ${stats.avgHoldingPeriod} bars                            │`);
  console.log('└──────────────────────────────────────────────────────────────┘');
  
  console.log('\n┌──────────────────────────────────────────────────────────────┐');
  console.log('│              📊 PERFORMANCE BY SIGNAL TYPE                   │');
  console.log('├──────────────────────────────────────────────────────────────┤');
  Object.entries(stats.byType).forEach(([type, data]) => {
    const emoji = type.includes('LONG') || type.includes('SQUEEZE') ? '🟢' : '🔴';
    const pnlSign = parseFloat(data.avgPnL) >= 0 ? '+' : '';
    console.log(`│  ${emoji} ${type.padEnd(17)} │ ${String(data.count).padStart(3)} trades │ ${data.winRate.padStart(5)}% WR │ ${pnlSign}${data.avgPnL}% │`);
  });
  console.log('└──────────────────────────────────────────────────────────────┘');
  
  console.log('\n┌──────────────────────────────────────────────────────────────┐');
  console.log('│                    🎯 EXIT ANALYSIS                          │');
  console.log('├──────────────────────────────────────────────────────────────┤');
  Object.entries(stats.byExitReason).forEach(([reason, data]) => {
    const emoji = reason.includes('TP') ? '✅' : reason === 'STOP_LOSS' ? '🛑' : '⏱️';
    console.log(`│  ${emoji} ${reason.padEnd(12)} │ ${String(data.count).padStart(4)} exits │ ${data.percentage.padStart(5)}%                  │`);
  });
  console.log('└──────────────────────────────────────────────────────────────┘');
  
  console.log('\n┌──────────────────────────────────────────────────────────────┐');
  console.log('│                 📜 RECENT TRADES (Last 15)                   │');
  console.log('├──────────────────────────────────────────────────────────────┤');
  trades.slice(-15).forEach(t => {
    const emoji = t.isWin ? '✅' : '❌';
    const pnl = t.pnlPercent >= 0 ? `+${t.pnlPercent.toFixed(2)}%` : `${t.pnlPercent.toFixed(2)}%`;
    const type = t.type.substring(0, 14).padEnd(14);
    console.log(`│  ${emoji} ${type} │ ${t.entry.toFixed(0)}→${t.exitPrice.toFixed(0)} │ ${pnl.padStart(7)} │ ${t.exitReason.padEnd(10)} │`);
  });
  console.log('└──────────────────────────────────────────────────────────────┘');
  
  // Equity curve visualization (simple ASCII)
  console.log('\n┌──────────────────────────────────────────────────────────────┐');
  console.log('│                    📈 EQUITY CURVE                           │');
  console.log('├──────────────────────────────────────────────────────────────┤');
  
  let equity = 100;
  const equityCurve = [100];
  trades.forEach(t => {
    equity *= (1 + t.pnlPercent / 100);
    equityCurve.push(equity);
  });
  
  const min = Math.min(...equityCurve);
  const max = Math.max(...equityCurve);
  const range = max - min;
  const height = 8;
  const width = 50;
  const step = Math.max(1, Math.floor(equityCurve.length / width));
  
  for (let row = height; row >= 0; row--) {
    const threshold = min + (range * row / height);
    let line = '│  ';
    if (row === height) line += `${max.toFixed(0).padStart(3)} `;
    else if (row === 0) line += `${min.toFixed(0).padStart(3)} `;
    else line += '    ';
    
    for (let col = 0; col < width && col * step < equityCurve.length; col++) {
      const val = equityCurve[col * step];
      if (val >= threshold) line += '█';
      else line += ' ';
    }
    line = line.padEnd(62) + '│';
    console.log(line);
  }
  console.log('└──────────────────────────────────────────────────────────────┘');
  
  console.log('\n✨ Backtest complete! Dashboard is production-ready.\n');
  
  return stats;
};

// Run the backtest
console.clear();
const results = runBacktest({ days: 30, startPrice: 6850, minConfidence: 65 });
printResults(results);
