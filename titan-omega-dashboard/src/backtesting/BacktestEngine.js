/**
 * Titan Omega Backtesting Engine
 * Simulates trading signals against historical price data
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
      const volatility = 0.0008; // ~0.08% per 5 min
      const trend = Math.sin(d / 5) * 0.0001; // Slight trend bias
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

// Calculate GEX levels from price
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
  const prev2 = candles[index - 2];
  
  const bodySize = Math.abs(curr.close - curr.open);
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;
  const range = curr.high - curr.low;
  
  // Hammer (bullish reversal)
  if (lowerWick > bodySize * 2 && upperWick < bodySize * 0.5 && curr.close > curr.open) {
    patterns.push('HAMMER');
  }
  
  // Shooting Star (bearish reversal)
  if (upperWick > bodySize * 2 && lowerWick < bodySize * 0.5 && curr.close < curr.open) {
    patterns.push('SHOOTING_STAR');
  }
  
  // Engulfing patterns
  if (curr.close > curr.open && prev.close < prev.open && 
      curr.close > prev.open && curr.open < prev.close) {
    patterns.push('BULLISH_ENGULFING');
  }
  
  if (curr.close < curr.open && prev.close > prev.open && 
      curr.open > prev.close && curr.close < prev.open) {
    patterns.push('BEARISH_ENGULFING');
  }
  
  // Doji
  if (bodySize < range * 0.1) {
    patterns.push('DOJI');
  }
  
  return patterns;
};

// Signal generation logic
const generateSignals = (candles, index) => {
  if (index < 10) return null;
  
  const curr = candles[index];
  const prev = candles[index - 1];
  const gexLevels = calculateGEXLevels(curr.close);
  const patterns = detectPatterns(candles, index);
  
  // Calculate short-term momentum
  const momentum = (curr.close - candles[index - 5].close) / candles[index - 5].close;
  const isPositiveGamma = curr.close > gexLevels.gammaFlip;
  const isBelowVWAP = curr.close < gexLevels.vwap;
  
  // LONG REVERSAL - Price near support with bullish pattern in positive gamma
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
  
  // SHORT REVERSAL - Price near resistance with bearish pattern
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
        reason: `Short reversal at GEX resistance ${gexLevels.resistance1.toFixed(0)} with ${patterns[0]} pattern.`,
      };
    }
  }
  
  // GAMMA SQUEEZE - Price crossing gamma flip with momentum
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
      reason: `Gamma squeeze setup - crossing flip level at ${gexLevels.gammaFlip.toFixed(0)} with momentum.`,
    };
  }
  
  // BREAKDOWN - Price breaking support in negative gamma
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
  
  return null;
};

// Simulate trade execution
const executeTrade = (signal, candles, signalIndex) => {
  const maxBars = 50; // Max holding period
  let exitPrice = null;
  let exitReason = null;
  let exitIndex = null;
  
  for (let i = signalIndex + 1; i < Math.min(signalIndex + maxBars, candles.length); i++) {
    const candle = candles[i];
    
    if (signal.direction === 'long') {
      // Check stop loss
      if (candle.low <= signal.stop) {
        exitPrice = signal.stop;
        exitReason = 'STOP_LOSS';
        exitIndex = i;
        break;
      }
      // Check TP2
      if (candle.high >= signal.tp2) {
        exitPrice = signal.tp2;
        exitReason = 'TP2_HIT';
        exitIndex = i;
        break;
      }
      // Check TP1 (partial - we'll use full exit for simplicity)
      if (candle.high >= signal.tp1 && !exitPrice) {
        exitPrice = signal.tp1;
        exitReason = 'TP1_HIT';
        exitIndex = i;
        break;
      }
    } else {
      // Short position
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
  
  // Time-based exit if no target/stop hit
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

// Main backtest function
export const runBacktest = (config = {}) => {
  const { days = 30, startPrice = 6850, minConfidence = 65 } = config;
  
  console.log('\n🚀 TITAN OMEGA BACKTESTING ENGINE');
  console.log('═'.repeat(50));
  console.log(`📅 Period: ${days} days`);
  console.log(`💰 Starting Price: $${startPrice}`);
  console.log(`🎯 Min Confidence: ${minConfidence}%`);
  console.log('═'.repeat(50));
  
  // Generate historical data
  const candles = generateHistoricalData(days, startPrice);
  console.log(`\n📊 Generated ${candles.length} candles`);
  
  // Generate and execute signals
  const trades = [];
  let lastSignalIndex = -20; // Prevent overlapping signals
  
  for (let i = 10; i < candles.length - 50; i++) {
    if (i - lastSignalIndex < 15) continue; // Min 15 bars between signals
    
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
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;
  
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
    byType: {},
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
    };
  });
  
  return { trades, stats, candles };
};

// Print results
export const printResults = (results) => {
  const { trades, stats } = results;
  
  console.log('\n📈 BACKTEST RESULTS');
  console.log('═'.repeat(50));
  console.log(`Total Trades:     ${stats.totalTrades}`);
  console.log(`Wins:             ${stats.wins} (${stats.winRate}%)`);
  console.log(`Losses:           ${stats.losses}`);
  console.log(`Total P&L:        ${parseFloat(stats.totalPnL) >= 0 ? '+' : ''}${stats.totalPnL}%`);
  console.log(`Avg Win:          +${stats.avgWin}%`);
  console.log(`Avg Loss:         -${stats.avgLoss}%`);
  console.log(`Profit Factor:    ${stats.profitFactor}`);
  console.log(`Avg Hold Period:  ${stats.avgHoldingPeriod} bars`);
  
  console.log('\n📊 PERFORMANCE BY SIGNAL TYPE');
  console.log('─'.repeat(50));
  Object.entries(stats.byType).forEach(([type, data]) => {
    console.log(`${type}:`);
    console.log(`  Trades: ${data.count} | Win Rate: ${data.winRate}% | Avg P&L: ${data.avgPnL}%`);
  });
  
  console.log('\n📜 RECENT TRADES (Last 10)');
  console.log('─'.repeat(50));
  trades.slice(-10).forEach(t => {
    const emoji = t.isWin ? '✅' : '❌';
    const pnl = t.pnlPercent >= 0 ? `+${t.pnlPercent}%` : `${t.pnlPercent}%`;
    console.log(`${emoji} ${t.type.padEnd(16)} | Entry: ${t.entry.toFixed(2)} → Exit: ${t.exitPrice.toFixed(2)} | ${pnl.padStart(8)} | ${t.exitReason}`);
  });
  
  return stats;
};

export default { runBacktest, printResults };
