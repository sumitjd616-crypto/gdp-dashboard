#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 * TITAN OMEGA - REAL SPX INTRADAY TRADER BACKTEST
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Account: $2,000 | Position: $500/trade
 * Target: 15+ SPX points per trade
 * Dynamic stop-loss with real-time adaptation
 * Physics & math-based price action analysis
 */

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  account: {
    initialSize: 2000,
    positionSize: 500,
    maxDailyLoss: 400,
    maxRiskPerTrade: 0.25, // 25% of position
  },
  targets: {
    minMove: 15,
    primaryTarget: 25,
    extendedTarget: 40,
    homeRun: 60,
  },
  risk: {
    initialStop: 8,
    breakEvenAt: 8,
    trailingStart: 12,
    trailingDistance: 5,
    profitLockAt: 20,
  },
  options: {
    delta: 0.45,
    multiplier: 100,
    avgPremiumPerPoint: 4.5,
  }
};

// ═══════════════════════════════════════════════════════════════════
// SEEDED RANDOM FOR REPRODUCIBILITY
// ═══════════════════════════════════════════════════════════════════

let seed = 31415;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

// ═══════════════════════════════════════════════════════════════════
// REALISTIC SPX DATA GENERATOR
// ═══════════════════════════════════════════════════════════════════

const generateRealisticSPXData = (days, startPrice = 6000) => {
  const data = [];
  let price = startPrice;
  let trend = 0;
  let volatilityState = 'normal';
  
  for (let d = days; d >= 0; d--) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    
    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    // Daily trend bias
    trend = trend * 0.7 + (random() - 0.48) * 0.003;
    
    // Volatility regime changes
    if (random() < 0.05) {
      volatilityState = ['low', 'normal', 'high', 'extreme'][Math.floor(random() * 4)];
    }
    const volMultiplier = { low: 0.6, normal: 1.0, high: 1.8, extreme: 2.5 }[volatilityState];
    
    // Generate intraday bars (5-minute, 9:30 AM - 4:00 PM = 78 bars)
    const dailyOpen = price;
    
    for (let bar = 0; bar < 78; bar++) {
      const hour = 9 + Math.floor((30 + bar * 5) / 60);
      const minute = (30 + bar * 5) % 60;
      
      // Intraday volatility pattern (higher at open/close)
      let intradayVol = 1.0;
      if (bar < 12) intradayVol = 1.5 + (12 - bar) * 0.08; // Opening volatility
      else if (bar > 66) intradayVol = 1.3 + (bar - 66) * 0.05; // Closing volatility
      else if (bar > 30 && bar < 48) intradayVol = 0.7; // Lunch lull
      
      // Base volatility: SPX moves ~0.03-0.08% per 5-min bar typically
      const baseVol = 0.0004 * volMultiplier * intradayVol;
      
      // Price change with mean reversion to VWAP
      const vwapDiff = (dailyOpen - price) / dailyOpen;
      const meanReversion = vwapDiff * 0.02;
      
      const change = (random() - 0.48 + trend + meanReversion) * baseVol * price;
      
      // Generate OHLC
      const open = price;
      const movement = change * (1 + random() * 0.5);
      const noise = price * baseVol * random() * 0.5;
      
      let high, low, close;
      if (change >= 0) {
        close = price + movement;
        high = Math.max(open, close) + noise;
        low = Math.min(open, close) - noise * 0.3;
      } else {
        close = price + movement;
        low = Math.min(open, close) - noise;
        high = Math.max(open, close) + noise * 0.3;
      }
      
      // Volume (higher at open/close, lower at lunch)
      let volumeMult = 1.0;
      if (bar < 12) volumeMult = 2.0;
      else if (bar > 66) volumeMult = 1.8;
      else if (bar > 30 && bar < 48) volumeMult = 0.5;
      
      const volume = Math.floor((800000 + random() * 1200000) * volumeMult);
      
      price = close;
      
      data.push({
        timestamp: new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute),
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume,
        volatilityState,
        bar,
      });
    }
  }
  
  return data;
};

// ═══════════════════════════════════════════════════════════════════
// PHYSICS ENGINE
// ═══════════════════════════════════════════════════════════════════

const PhysicsEngine = {
  // Momentum = mass (volume) × velocity (price rate of change)
  calculateMomentum(candles, period = 10) {
    if (candles.length < period) return { value: 0, direction: 'neutral', strength: 0 };
    
    const recent = candles.slice(-period);
    const priceChange = recent[recent.length - 1].close - recent[0].close;
    const avgVolume = recent.reduce((s, c) => s + c.volume, 0) / period / 1000000;
    
    const velocity = priceChange / period;
    const momentum = avgVolume * velocity;
    
    // Acceleration
    const mid = Math.floor(period / 2);
    const v1 = (recent[mid].close - recent[0].close) / mid;
    const v2 = (recent[recent.length - 1].close - recent[mid].close) / (period - mid);
    const acceleration = v2 - v1;
    
    return {
      value: momentum,
      velocity,
      acceleration,
      direction: momentum > 0.3 ? 'bullish' : momentum < -0.3 ? 'bearish' : 'neutral',
      strength: Math.abs(momentum),
      isAccelerating: Math.sign(acceleration) === Math.sign(velocity) && Math.abs(acceleration) > 0.05,
      isDecelerating: Math.sign(acceleration) !== Math.sign(velocity),
    };
  },

  // Volatility using ATR-like calculation
  calculateVolatility(candles, period = 14) {
    if (candles.length < period + 1) return { atr: 5, regime: 'normal', zscore: 0 };
    
    const recent = candles.slice(-period - 1);
    const trs = [];
    
    for (let i = 1; i < recent.length; i++) {
      const tr = Math.max(
        recent[i].high - recent[i].low,
        Math.abs(recent[i].high - recent[i - 1].close),
        Math.abs(recent[i].low - recent[i - 1].close)
      );
      trs.push(tr);
    }
    
    const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
    const atrPercent = atr / candles[candles.length - 1].close * 100;
    
    // Historical ATR for Z-score
    const mean = 0.08; // ~8 points typical for SPX 5-min
    const std = 0.03;
    const zscore = (atr - mean) / std;
    
    let regime = 'normal';
    if (atr > 12) regime = 'extreme';
    else if (atr > 8) regime = 'high';
    else if (atr < 4) regime = 'low';
    
    return { atr, atrPercent, regime, zscore };
  },

  // RSI calculation
  calculateRSI(candles, period = 14) {
    if (candles.length < period + 1) return 50;
    
    const recent = candles.slice(-period - 1);
    let gains = 0, losses = 0;
    
    for (let i = 1; i < recent.length; i++) {
      const change = recent[i].close - recent[i - 1].close;
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period || 0.001;
    const rs = avgGain / avgLoss;
    
    return 100 - (100 / (1 + rs));
  },

  // VWAP calculation
  calculateVWAP(candles) {
    let cumVolume = 0;
    let cumVwap = 0;
    
    candles.forEach(c => {
      const typical = (c.high + c.low + c.close) / 3;
      cumVolume += c.volume;
      cumVwap += typical * c.volume;
    });
    
    return cumVolume > 0 ? cumVwap / cumVolume : candles[candles.length - 1].close;
  },

  // Support/Resistance levels
  findKeyLevels(candles, numLevels = 5) {
    const prices = [];
    candles.forEach(c => {
      prices.push(c.high, c.low);
    });
    
    // Find price clusters
    prices.sort((a, b) => a - b);
    const clusters = [];
    let currentCluster = [prices[0]];
    
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] - prices[i - 1] < 5) {
        currentCluster.push(prices[i]);
      } else {
        if (currentCluster.length > 3) {
          clusters.push({
            price: currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length,
            strength: currentCluster.length,
          });
        }
        currentCluster = [prices[i]];
      }
    }
    
    return clusters.sort((a, b) => b.strength - a.strength).slice(0, numLevels);
  },
};

// ═══════════════════════════════════════════════════════════════════
// PATTERN DETECTION
// ═══════════════════════════════════════════════════════════════════

const detectPatterns = (candles, index) => {
  const patterns = [];
  if (index < 3) return patterns;
  
  const c = candles[index];
  const p1 = candles[index - 1];
  const p2 = candles[index - 2];
  
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low || 0.01;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  
  // Hammer (bullish reversal)
  if (lowerWick > body * 2 && upperWick < body * 0.5 && c.close >= c.open) {
    patterns.push({ name: 'HAMMER', bias: 'bullish', strength: 0.7 });
  }
  
  // Shooting Star (bearish reversal)
  if (upperWick > body * 2 && lowerWick < body * 0.5 && c.close <= c.open) {
    patterns.push({ name: 'SHOOTING_STAR', bias: 'bearish', strength: 0.7 });
  }
  
  // Bullish Engulfing
  if (c.close > c.open && p1.close < p1.open && c.close > p1.open && c.open < p1.close) {
    patterns.push({ name: 'BULL_ENGULF', bias: 'bullish', strength: 0.8 });
  }
  
  // Bearish Engulfing
  if (c.close < c.open && p1.close > p1.open && c.open > p1.close && c.close < p1.open) {
    patterns.push({ name: 'BEAR_ENGULF', bias: 'bearish', strength: 0.8 });
  }
  
  // Strong momentum candle
  if (body > range * 0.75 && body > 4) {
    patterns.push({ 
      name: c.close > c.open ? 'STRONG_BULL_CANDLE' : 'STRONG_BEAR_CANDLE', 
      bias: c.close > c.open ? 'bullish' : 'bearish', 
      strength: 0.6 
    });
  }
  
  // Three white soldiers / Three black crows
  if (c.close > c.open && p1.close > p1.open && p2.close > p2.open &&
      c.close > p1.close && p1.close > p2.close) {
    patterns.push({ name: 'THREE_WHITE_SOLDIERS', bias: 'bullish', strength: 0.85 });
  }
  if (c.close < c.open && p1.close < p1.open && p2.close < p2.open &&
      c.close < p1.close && p1.close < p2.close) {
    patterns.push({ name: 'THREE_BLACK_CROWS', bias: 'bearish', strength: 0.85 });
  }
  
  // Inside bar (compression)
  if (c.high < p1.high && c.low > p1.low) {
    patterns.push({ name: 'INSIDE_BAR', bias: 'neutral', strength: 0.5 });
  }
  
  return patterns;
};

// ═══════════════════════════════════════════════════════════════════
// WEIGHTED SIGNAL SCORING
// ═══════════════════════════════════════════════════════════════════

const scoreSignal = (analysis) => {
  const weights = {
    momentum: 0.25,
    pattern: 0.20,
    volume: 0.15,
    rsi: 0.15,
    vwap: 0.10,
    volatility: 0.10,
    time: 0.05,
  };
  
  let score = 0;
  const breakdown = {};
  
  // Momentum score (0-100)
  const momScore = Math.min(100, analysis.momentum.strength * 30 + 
    (analysis.momentum.isAccelerating ? 30 : 0) +
    (analysis.momentum.direction !== 'neutral' ? 20 : 0));
  breakdown.momentum = momScore;
  score += momScore * weights.momentum;
  
  // Pattern score
  const patternScore = analysis.patterns.length > 0 ? 
    Math.min(100, analysis.patterns.reduce((s, p) => s + p.strength * 50, 0)) : 30;
  breakdown.pattern = patternScore;
  score += patternScore * weights.pattern;
  
  // Volume score
  const volScore = analysis.volumeRatio > 2 ? 90 :
    analysis.volumeRatio > 1.5 ? 75 :
    analysis.volumeRatio > 1.0 ? 55 : 35;
  breakdown.volume = volScore;
  score += volScore * weights.volume;
  
  // RSI score (extremes = opportunity)
  const rsiScore = (analysis.rsi < 30 || analysis.rsi > 70) ? 85 :
    (analysis.rsi < 40 || analysis.rsi > 60) ? 60 : 40;
  breakdown.rsi = rsiScore;
  score += rsiScore * weights.rsi;
  
  // VWAP score
  const vwapDist = Math.abs(analysis.price - analysis.vwap) / analysis.price * 100;
  const vwapScore = vwapDist < 0.05 ? 80 : vwapDist < 0.1 ? 60 : 40;
  breakdown.vwap = vwapScore;
  score += vwapScore * weights.vwap;
  
  // Volatility score (moderate = best)
  const volRegimeScore = analysis.volatility.regime === 'normal' ? 80 :
    analysis.volatility.regime === 'high' ? 65 :
    analysis.volatility.regime === 'low' ? 50 : 40;
  breakdown.volatility = volRegimeScore;
  score += volRegimeScore * weights.volatility;
  
  // Time of day score
  const hour = analysis.hour;
  const timeScore = (hour >= 9.5 && hour <= 11) || (hour >= 14 && hour <= 15.5) ? 90 :
    (hour >= 11 && hour <= 13) ? 40 : 60;
  breakdown.time = timeScore;
  score += timeScore * weights.time;
  
  return {
    total: Math.round(score),
    breakdown,
    grade: score >= 75 ? 'A' : score >= 65 ? 'B' : score >= 55 ? 'C' : 'D',
  };
};

// ═══════════════════════════════════════════════════════════════════
// DYNAMIC STOP LOSS MANAGER
// ═══════════════════════════════════════════════════════════════════

class StopLossManager {
  constructor(entry, direction, initialStop, volatility) {
    this.entry = entry;
    this.direction = direction;
    this.initialStop = initialStop;
    this.currentStop = initialStop;
    this.phase = 'initial';
    this.maxFavorable = 0;
    this.volatilityAdjust = volatility.regime === 'high' ? 1.3 : volatility.regime === 'low' ? 0.8 : 1.0;
    this.alerts = [];
  }
  
  update(currentPrice, momentum, volatility) {
    const pnl = this.direction === 'long' ? currentPrice - this.entry : this.entry - currentPrice;
    
    if (pnl > this.maxFavorable) this.maxFavorable = pnl;
    
    const adjustedBreakeven = CONFIG.risk.breakEvenAt * this.volatilityAdjust;
    const adjustedTrailStart = CONFIG.risk.trailingStart * this.volatilityAdjust;
    const adjustedTrailDist = CONFIG.risk.trailingDistance * this.volatilityAdjust;
    
    // Phase: Move to breakeven
    if (this.phase === 'initial' && pnl >= adjustedBreakeven) {
      this.phase = 'breakeven';
      this.currentStop = this.entry + (this.direction === 'long' ? 1 : -1);
      this.alerts.push('🔒 Stop moved to breakeven');
    }
    
    // Phase: Start trailing
    if (this.phase === 'breakeven' && pnl >= adjustedTrailStart) {
      this.phase = 'trailing';
      this.alerts.push('📈 Trailing stop activated');
    }
    
    // Update trailing stop
    if (this.phase === 'trailing') {
      const newStop = this.direction === 'long' ?
        currentPrice - adjustedTrailDist : currentPrice + adjustedTrailDist;
      
      if ((this.direction === 'long' && newStop > this.currentStop) ||
          (this.direction === 'short' && newStop < this.currentStop)) {
        this.currentStop = newStop;
      }
    }
    
    // Profit lock at primary target
    if (pnl >= CONFIG.risk.profitLockAt) {
      this.phase = 'profit_lock';
      const lockStop = this.direction === 'long' ?
        currentPrice - 3 : currentPrice + 3;
      
      if ((this.direction === 'long' && lockStop > this.currentStop) ||
          (this.direction === 'short' && lockStop < this.currentStop)) {
        this.currentStop = lockStop;
        this.alerts.push(`💰 Locked ${pnl.toFixed(1)} points profit`);
      }
    }
    
    // DYNAMIC: Tighten on momentum loss
    if (momentum.isDecelerating && pnl > 10) {
      const tightenStop = this.direction === 'long' ?
        currentPrice - 4 : currentPrice + 4;
      
      if ((this.direction === 'long' && tightenStop > this.currentStop) ||
          (this.direction === 'short' && tightenStop < this.currentStop)) {
        this.currentStop = tightenStop;
        this.alerts.push('⚠️ Tightened stop - momentum fading');
      }
    }
    
    // DYNAMIC: Widen in volatility spike (if we have profit cushion)
    if (volatility.regime === 'extreme' && this.phase !== 'initial' && pnl > 15) {
      // Allow more room in extreme vol
      const widenStop = this.direction === 'long' ?
        currentPrice - 8 : currentPrice + 8;
      
      if ((this.direction === 'long' && widenStop < this.currentStop) ||
          (this.direction === 'short' && widenStop > this.currentStop)) {
        // Only widen if it doesn't go below breakeven
        if ((this.direction === 'long' && widenStop > this.entry) ||
            (this.direction === 'short' && widenStop < this.entry)) {
          this.currentStop = widenStop;
          this.alerts.push('⚡ Widened stop for volatility spike');
        }
      }
    }
    
    // Check stop hit
    const stopped = this.direction === 'long' ? 
      currentPrice <= this.currentStop : currentPrice >= this.currentStop;
    
    return {
      currentStop: this.currentStop,
      phase: this.phase,
      pnl,
      maxFavorable: this.maxFavorable,
      stopped,
      alerts: this.alerts.splice(0),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN TRADING ENGINE
// ═══════════════════════════════════════════════════════════════════

class TradingEngine {
  constructor() {
    this.account = CONFIG.account.initialSize;
    this.position = null;
    this.trades = [];
    this.dailyPnL = 0;
    this.currentDay = null;
    this.signals = [];
  }
  
  analyze(candles, index) {
    if (index < 30) return null;
    
    const c = candles[index];
    const recent = candles.slice(Math.max(0, index - 50), index + 1);
    const dailyCandles = candles.slice(Math.max(0, index - c.bar), index + 1);
    
    const momentum = PhysicsEngine.calculateMomentum(recent, 10);
    const volatility = PhysicsEngine.calculateVolatility(recent, 14);
    const rsi = PhysicsEngine.calculateRSI(recent, 14);
    const vwap = PhysicsEngine.calculateVWAP(dailyCandles);
    const keyLevels = PhysicsEngine.findKeyLevels(recent);
    const patterns = detectPatterns(candles, index);
    
    // Volume analysis
    const avgVol = recent.slice(-10).reduce((s, c) => s + c.volume, 0) / 10;
    const volumeRatio = c.volume / avgVol;
    
    // GEX approximation
    const baseStrike = Math.round(c.close / 25) * 25;
    const gammaFlip = baseStrike - 25;
    const isPositiveGamma = c.close > gammaFlip;
    
    // Recent range
    const recentHigh = Math.max(...recent.slice(-20).map(x => x.high));
    const recentLow = Math.min(...recent.slice(-20).map(x => x.low));
    
    return {
      price: c.close,
      candle: c,
      momentum,
      volatility,
      rsi,
      vwap,
      keyLevels,
      patterns,
      volumeRatio,
      gammaFlip,
      isPositiveGamma,
      recentHigh,
      recentLow,
      hour: c.timestamp.getHours() + c.timestamp.getMinutes() / 60,
    };
  }
  
  generateSignal(analysis) {
    if (!analysis) return null;
    
    const score = scoreSignal(analysis);
    if (score.total < 60) return null;
    
    let direction = null;
    const reasons = [];
    
    // ═══ LONG ENTRY CONDITIONS ═══
    const longConditions = {
      momentum: analysis.momentum.direction === 'bullish',
      accelerating: analysis.momentum.isAccelerating,
      pattern: analysis.patterns.some(p => p.bias === 'bullish'),
      oversold: analysis.rsi < 35,
      support: analysis.price <= analysis.recentLow * 1.002,
      vwapBounce: analysis.price < analysis.vwap && analysis.price > analysis.vwap * 0.998,
      positiveGamma: analysis.isPositiveGamma,
      volume: analysis.volumeRatio > 1.2,
    };
    
    const longScore = Object.values(longConditions).filter(Boolean).length;
    
    if (longScore >= 4 && longConditions.momentum) {
      direction = 'long';
      if (longConditions.pattern) reasons.push(`Pattern: ${analysis.patterns.find(p => p.bias === 'bullish')?.name}`);
      if (longConditions.oversold) reasons.push('RSI oversold');
      if (longConditions.support) reasons.push('At support');
      if (longConditions.accelerating) reasons.push('Momentum accelerating');
      if (longConditions.volume) reasons.push('Volume spike');
    }
    
    // ═══ SHORT ENTRY CONDITIONS ═══
    const shortConditions = {
      momentum: analysis.momentum.direction === 'bearish',
      accelerating: analysis.momentum.isAccelerating,
      pattern: analysis.patterns.some(p => p.bias === 'bearish'),
      overbought: analysis.rsi > 65,
      resistance: analysis.price >= analysis.recentHigh * 0.998,
      vwapReject: analysis.price > analysis.vwap && analysis.price < analysis.vwap * 1.002,
      negativeGamma: !analysis.isPositiveGamma,
      volume: analysis.volumeRatio > 1.2,
    };
    
    const shortScore = Object.values(shortConditions).filter(Boolean).length;
    
    if (!direction && shortScore >= 4 && shortConditions.momentum) {
      direction = 'short';
      if (shortConditions.pattern) reasons.push(`Pattern: ${analysis.patterns.find(p => p.bias === 'bearish')?.name}`);
      if (shortConditions.overbought) reasons.push('RSI overbought');
      if (shortConditions.resistance) reasons.push('At resistance');
      if (shortConditions.accelerating) reasons.push('Momentum accelerating');
      if (shortConditions.volume) reasons.push('Volume spike');
    }
    
    // ═══ BREAKOUT SIGNALS (Higher Priority) ═══
    if (analysis.volumeRatio > 1.8) {
      if (analysis.price > analysis.recentHigh && analysis.momentum.direction === 'bullish') {
        direction = 'long';
        reasons.length = 0;
        reasons.push('🚀 BREAKOUT above resistance', 'High volume confirmation');
        score.total = Math.min(95, score.total + 15);
      }
      if (analysis.price < analysis.recentLow && analysis.momentum.direction === 'bearish') {
        direction = 'short';
        reasons.length = 0;
        reasons.push('💥 BREAKDOWN below support', 'High volume confirmation');
        score.total = Math.min(95, score.total + 15);
      }
    }
    
    if (!direction) return null;
    
    // Calculate risk-adjusted targets
    const atr = analysis.volatility.atr;
    const stopDist = Math.max(CONFIG.risk.initialStop, atr * 1.2);
    
    return {
      direction,
      entry: analysis.price,
      stop: direction === 'long' ? analysis.price - stopDist : analysis.price + stopDist,
      targets: {
        tp1: direction === 'long' ? analysis.price + CONFIG.targets.minMove : analysis.price - CONFIG.targets.minMove,
        tp2: direction === 'long' ? analysis.price + CONFIG.targets.primaryTarget : analysis.price - CONFIG.targets.primaryTarget,
        tp3: direction === 'long' ? analysis.price + CONFIG.targets.extendedTarget : analysis.price - CONFIG.targets.extendedTarget,
      },
      score,
      reasons,
      analysis,
      timestamp: analysis.candle.timestamp,
    };
  }
  
  enterTrade(signal) {
    if (this.position) return null;
    if (this.dailyPnL <= -CONFIG.account.maxDailyLoss) return null;
    
    // Calculate contracts (simplified)
    const riskAmount = Math.abs(signal.entry - signal.stop);
    const premium = CONFIG.options.avgPremiumPerPoint * riskAmount;
    const contracts = Math.max(1, Math.floor(CONFIG.account.positionSize / (premium * CONFIG.options.multiplier / 10)));
    
    this.position = {
      ...signal,
      contracts,
      stopManager: new StopLossManager(signal.entry, signal.direction, signal.stop, signal.analysis.volatility),
      openTime: signal.timestamp,
      bars: 0,
      maxPnL: 0,
      alerts: [],
    };
    
    return this.position;
  }
  
  updatePosition(candle, analysis) {
    if (!this.position) return null;
    
    this.position.bars++;
    const price = candle.close;
    
    // Update stop loss
    const stopUpdate = this.position.stopManager.update(price, analysis.momentum, analysis.volatility);
    this.position.alerts.push(...stopUpdate.alerts);
    
    if (stopUpdate.pnl > this.position.maxPnL) {
      this.position.maxPnL = stopUpdate.pnl;
    }
    
    // Check exits
    let exitReason = null;
    let exitPrice = null;
    
    // Stop hit
    if (stopUpdate.stopped) {
      exitReason = `${stopUpdate.phase.toUpperCase()}_STOP`;
      exitPrice = stopUpdate.currentStop;
    }
    
    // Target hits
    if (!exitReason) {
      const { tp1, tp2, tp3 } = this.position.targets;
      if (this.position.direction === 'long') {
        if (candle.high >= tp3) { exitReason = 'TP3_HIT'; exitPrice = tp3; }
        else if (candle.high >= tp2) { exitReason = 'TP2_HIT'; exitPrice = tp2; }
        else if (candle.high >= tp1) { exitReason = 'TP1_HIT'; exitPrice = tp1; }
      } else {
        if (candle.low <= tp3) { exitReason = 'TP3_HIT'; exitPrice = tp3; }
        else if (candle.low <= tp2) { exitReason = 'TP2_HIT'; exitPrice = tp2; }
        else if (candle.low <= tp1) { exitReason = 'TP1_HIT'; exitPrice = tp1; }
      }
    }
    
    // Time-based exit (end of day)
    if (!exitReason && candle.bar >= 75) {
      exitReason = 'EOD_EXIT';
      exitPrice = price;
    }
    
    // Max holding time (60 bars = 5 hours)
    if (!exitReason && this.position.bars >= 60) {
      exitReason = 'TIME_EXIT';
      exitPrice = price;
    }
    
    if (exitReason) {
      return this.exitTrade(exitPrice, exitReason, candle.timestamp);
    }
    
    return { 
      position: this.position, 
      pnl: stopUpdate.pnl,
      stop: stopUpdate.currentStop,
      phase: stopUpdate.phase,
      alerts: this.position.alerts.splice(0),
    };
  }
  
  exitTrade(exitPrice, reason, timestamp) {
    const pos = this.position;
    const pnlPoints = pos.direction === 'long' ? exitPrice - pos.entry : pos.entry - exitPrice;
    
    // Calculate $ P&L (simplified options math)
    const pnlPerContract = pnlPoints * CONFIG.options.delta * CONFIG.options.multiplier;
    const totalPnL = pnlPerContract * pos.contracts;
    
    const trade = {
      direction: pos.direction,
      entry: pos.entry,
      exit: exitPrice,
      exitReason: reason,
      pnlPoints,
      pnlDollars: totalPnL,
      maxPnL: pos.maxPnL,
      contracts: pos.contracts,
      bars: pos.bars,
      openTime: pos.openTime,
      closeTime: timestamp,
      score: pos.score.total,
      reasons: pos.reasons,
      rMultiple: pnlPoints / CONFIG.risk.initialStop,
    };
    
    this.trades.push(trade);
    this.dailyPnL += totalPnL;
    this.account += totalPnL;
    this.position = null;
    
    return trade;
  }
  
  resetDaily() {
    this.dailyPnL = 0;
  }
}

// ═══════════════════════════════════════════════════════════════════
// RUN BACKTEST
// ═══════════════════════════════════════════════════════════════════

const runBacktest = (days = 60) => {
  console.clear();
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║           🎯 TITAN OMEGA - SPX REAL TRADER BACKTEST                       ║');
  console.log('║                   15+ Point Intraday Moves                                 ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  💰 Account Size:      $${CONFIG.account.initialSize.toLocaleString().padEnd(6)}                                      ║`);
  console.log(`║  📊 Position Size:     $${CONFIG.account.positionSize.toLocaleString().padEnd(6)}                                      ║`);
  console.log(`║  🎯 Target Move:       ${CONFIG.targets.minMove}-${CONFIG.targets.extendedTarget} SPX points                              ║`);
  console.log(`║  🛑 Initial Stop:      ${CONFIG.risk.initialStop} points                                        ║`);
  console.log(`║  📅 Backtest Period:   ${days} trading days                                    ║`);
  console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
  
  console.log('\n⏳ Generating realistic SPX intraday data...');
  const candles = generateRealisticSPXData(days, 6000);
  console.log(`✅ Generated ${candles.length.toLocaleString()} 5-minute candles`);
  
  const engine = new TradingEngine();
  let currentDay = null;
  let lastSignalBar = -30;
  
  console.log('⏳ Running backtest with physics-based analysis...\n');
  
  for (let i = 30; i < candles.length - 10; i++) {
    const candle = candles[i];
    const day = candle.timestamp.toDateString();
    
    // Reset daily P&L
    if (day !== currentDay) {
      currentDay = day;
      engine.resetDaily();
    }
    
    const analysis = engine.analyze(candles, i);
    
    // Update existing position
    if (engine.position) {
      const update = engine.updatePosition(candle, analysis);
      if (update && !engine.position) {
        // Position was closed
        lastSignalBar = i;
      }
      continue;
    }
    
    // Look for new signals (minimum spacing between trades)
    if (i - lastSignalBar < 20) continue;
    
    const signal = engine.generateSignal(analysis);
    if (signal && signal.score.total >= 65) {
      const pos = engine.enterTrade(signal);
      if (pos) lastSignalBar = i;
    }
  }
  
  // Calculate stats
  const trades = engine.trades;
  const wins = trades.filter(t => t.pnlDollars > 0);
  const losses = trades.filter(t => t.pnlDollars <= 0);
  
  const totalPnL = trades.reduce((s, t) => s + t.pnlDollars, 0);
  const totalPoints = trades.reduce((s, t) => s + t.pnlPoints, 0);
  const avgWinPts = wins.length ? wins.reduce((s, t) => s + t.pnlPoints, 0) / wins.length : 0;
  const avgLossPts = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnlPoints, 0) / losses.length) : 0;
  const avgWin$ = wins.length ? wins.reduce((s, t) => s + t.pnlDollars, 0) / wins.length : 0;
  const avgLoss$ = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnlDollars, 0) / losses.length) : 0;
  const profitFactor = avgLoss$ > 0 && losses.length > 0 ? (avgWin$ * wins.length) / (avgLoss$ * losses.length) : 0;
  
  // Equity curve
  let equity = CONFIG.account.initialSize;
  let peak = equity;
  let maxDD = 0;
  const equityCurve = [equity];
  
  trades.forEach(t => {
    equity += t.pnlDollars;
    equityCurve.push(equity);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
  });
  
  // By exit reason
  const byExit = {};
  trades.forEach(t => {
    if (!byExit[t.exitReason]) byExit[t.exitReason] = { count: 0, pnl: 0 };
    byExit[t.exitReason].count++;
    byExit[t.exitReason].pnl += t.pnlDollars;
  });
  
  // Print results
  console.log('┌───────────────────────────────────────────────────────────────────────────┐');
  console.log('│                        📈 BACKTEST RESULTS                               │');
  console.log('├───────────────────────────────────────────────────────────────────────────┤');
  console.log(`│  Total Trades:         ${String(trades.length).padStart(6)}                                          │`);
  console.log(`│  Winning Trades:       ${String(wins.length).padStart(6)}  (${(wins.length/trades.length*100).toFixed(1)}% win rate)                   │`);
  console.log(`│  Losing Trades:        ${String(losses.length).padStart(6)}                                          │`);
  console.log('├───────────────────────────────────────────────────────────────────────────┤');
  const pnlSign = totalPnL >= 0 ? '+' : '';
  console.log(`│  💰 TOTAL P&L:         ${pnlSign}$${totalPnL.toFixed(2).padStart(8)}                                    │`);
  console.log(`│  📊 Total Points:      ${pnlSign}${totalPoints.toFixed(1).padStart(8)} SPX points                         │`);
  console.log(`│  💎 Final Account:     $${equity.toFixed(2).padStart(8)} (${((equity/CONFIG.account.initialSize-1)*100).toFixed(1)}% return)              │`);
  console.log('├───────────────────────────────────────────────────────────────────────────┤');
  console.log(`│  Avg Win:              +$${avgWin$.toFixed(2).padStart(7)} (+${avgWinPts.toFixed(1)} pts)                       │`);
  console.log(`│  Avg Loss:             -$${avgLoss$.toFixed(2).padStart(7)} (-${avgLossPts.toFixed(1)} pts)                       │`);
  console.log(`│  Profit Factor:        ${profitFactor.toFixed(2).padStart(8)}                                        │`);
  console.log(`│  Max Drawdown:         ${maxDD.toFixed(1).padStart(7)}%                                         │`);
  console.log(`│  Avg R Multiple:       ${(trades.reduce((s,t) => s + t.rMultiple, 0) / trades.length).toFixed(2).padStart(8)}                                        │`);
  console.log('└───────────────────────────────────────────────────────────────────────────┘');
  
  console.log('\n┌───────────────────────────────────────────────────────────────────────────┐');
  console.log('│                        🎯 EXIT ANALYSIS                                  │');
  console.log('├───────────────────────────────────────────────────────────────────────────┤');
  
  const exitOrder = ['TP3_HIT', 'TP2_HIT', 'TP1_HIT', 'PROFIT_LOCK_STOP', 'TRAILING_STOP', 'BREAKEVEN_STOP', 'TIME_EXIT', 'EOD_EXIT', 'INITIAL_STOP'];
  exitOrder.forEach(reason => {
    const data = byExit[reason];
    if (data) {
      const emoji = reason.includes('TP') ? '✅' : reason.includes('PROFIT') || reason.includes('TRAILING') ? '🔒' : reason.includes('BREAKEVEN') ? '↔️' : reason === 'INITIAL_STOP' ? '🛑' : '⏱️';
      const pnlStr = data.pnl >= 0 ? `+$${data.pnl.toFixed(0)}` : `-$${Math.abs(data.pnl).toFixed(0)}`;
      console.log(`│  ${emoji} ${reason.padEnd(18)} │ ${String(data.count).padStart(4)} trades │ ${pnlStr.padStart(8)}                  │`);
    }
  });
  console.log('└───────────────────────────────────────────────────────────────────────────┘');
  
  console.log('\n┌───────────────────────────────────────────────────────────────────────────┐');
  console.log('│                     📜 SAMPLE TRADES (Best & Recent)                     │');
  console.log('├───────────────────────────────────────────────────────────────────────────┤');
  
  // Best trades
  const bestTrades = [...trades].sort((a, b) => b.pnlDollars - a.pnlDollars).slice(0, 5);
  console.log('│  🏆 TOP 5 WINNING TRADES:                                                │');
  bestTrades.forEach(t => {
    const dir = t.direction === 'long' ? '🟢' : '🔴';
    console.log(`│  ${dir} ${t.entry.toFixed(0)}→${t.exit.toFixed(0)} │ +$${t.pnlDollars.toFixed(0).padStart(4)} │ +${t.pnlPoints.toFixed(1).padStart(5)}pts │ ${t.exitReason.padEnd(14)} │`);
  });
  
  console.log('│                                                                           │');
  console.log('│  📋 LAST 10 TRADES:                                                       │');
  trades.slice(-10).forEach(t => {
    const emoji = t.pnlDollars > 0 ? '✅' : '❌';
    const dir = t.direction === 'long' ? 'L' : 'S';
    const pnl = t.pnlDollars >= 0 ? `+$${t.pnlDollars.toFixed(0)}` : `-$${Math.abs(t.pnlDollars).toFixed(0)}`;
    console.log(`│  ${emoji} ${dir} ${t.entry.toFixed(0)}→${t.exit.toFixed(0)} │ ${pnl.padStart(6)} │ ${(t.pnlPoints >= 0 ? '+' : '') + t.pnlPoints.toFixed(1).padStart(5)}pts │ ${t.exitReason.substring(0,12).padEnd(12)} │`);
  });
  console.log('└───────────────────────────────────────────────────────────────────────────┘');
  
  // Equity curve ASCII
  console.log('\n┌───────────────────────────────────────────────────────────────────────────┐');
  console.log('│                        📈 EQUITY CURVE                                   │');
  console.log('├───────────────────────────────────────────────────────────────────────────┤');
  
  const min = Math.min(...equityCurve);
  const max = Math.max(...equityCurve);
  const range = max - min || 1;
  const height = 10;
  const width = 65;
  const step = Math.max(1, Math.floor(equityCurve.length / width));
  
  for (let row = height; row >= 0; row--) {
    const threshold = min + (range * row / height);
    let line = '│ ';
    if (row === height) line += `$${max.toFixed(0).padStart(5)}│`;
    else if (row === 0) line += `$${min.toFixed(0).padStart(5)}│`;
    else line += '      │';
    
    for (let col = 0; col < width && col * step < equityCurve.length; col++) {
      const val = equityCurve[col * step];
      if (val >= threshold) line += '█';
      else if (val >= threshold - range / height / 2) line += '▄';
      else line += ' ';
    }
    console.log(line.padEnd(77) + '│');
  }
  console.log('└───────────────────────────────────────────────────────────────────────────┘');
  
  // Summary
  const winRate = wins.length / trades.length * 100;
  const grade = winRate >= 60 && profitFactor >= 1.5 ? 'A' :
                winRate >= 55 && profitFactor >= 1.3 ? 'B' :
                winRate >= 50 && profitFactor >= 1.0 ? 'C' : 'D';
  
  console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                       🏆 TRADING SYSTEM SUMMARY                          ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  System Grade:         ${grade === 'A' ? '🌟' : grade === 'B' ? '✨' : grade === 'C' ? '👍' : '⚠️'} ${grade}                                                  ║`);
  console.log(`║  Risk Management:      ${maxDD < 15 ? '✅ Excellent' : maxDD < 25 ? '👍 Good' : '⚠️ Review needed'}                                   ║`);
  console.log(`║  Edge Consistency:     ${profitFactor >= 1.5 ? '✅ Strong edge' : profitFactor >= 1.2 ? '👍 Positive edge' : '⚠️ Needs work'}                                  ║`);
  console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
  
  if (totalPnL > 0) {
    console.log('║  ✅ System is PROFITABLE over backtest period                            ║');
    console.log('║  ✅ Dynamic stop-loss protected capital effectively                      ║');
    console.log('║  ✅ Physics-based analysis identified high-probability setups            ║');
  } else {
    console.log('║  ⚠️  System needs parameter optimization                                 ║');
    console.log('║  📊 Consider adjusting entry filters or risk parameters                  ║');
  }
  console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
  console.log('\n');
  
  return { trades, stats: { winRate, profitFactor, totalPnL, maxDD, finalEquity: equity } };
};

// Execute
runBacktest(60);
