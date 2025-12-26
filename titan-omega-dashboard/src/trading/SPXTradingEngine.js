/**
 * TITAN OMEGA - SPX Intraday Trading Engine
 * Real Trader Logic for 15+ Point Moves
 * 
 * Account: $2,000 | Position Size: $500/trade
 * Target: 15-50 SPX points per winning trade
 * Dynamic stop-loss with real-time adaptation
 */

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  account: {
    size: 2000,
    positionSize: 500,
    maxDailyLoss: 400,      // 20% max daily drawdown
    maxOpenPositions: 1,
  },
  targets: {
    minMove: 15,            // Minimum SPX points for entry
    targetMove: 25,         // Primary target
    extendedTarget: 40,     // Extended target for runners
    maxTarget: 60,          // Maximum expected move
  },
  risk: {
    initialStopPoints: 8,   // Initial stop loss in SPX points
    trailingActivation: 10, // Activate trailing after X points profit
    trailingDistance: 6,    // Trailing stop distance
    breakEvenAt: 8,         // Move stop to breakeven at X points
  },
  // SPX 0DTE options approximate delta/leverage
  options: {
    avgDelta: 0.45,         // Average delta for ATM options
    contractMultiplier: 100,
    avgPremium: 5.00,       // Average premium per point at entry
  }
};

// ═══════════════════════════════════════════════════════════════════
// PHYSICS & MATH ENGINE
// ═══════════════════════════════════════════════════════════════════

class PhysicsEngine {
  /**
   * Calculate price momentum using physics principles
   * Momentum = mass (volume) × velocity (price change rate)
   */
  static calculateMomentum(candles, period = 10) {
    if (candles.length < period) return { value: 0, direction: 'neutral' };
    
    const recent = candles.slice(-period);
    const priceChange = recent[recent.length - 1].close - recent[0].close;
    const avgVolume = recent.reduce((s, c) => s + c.volume, 0) / period;
    const normalizedVolume = avgVolume / 1000000; // Normalize volume
    
    // Velocity = Δprice / Δtime
    const velocity = priceChange / period;
    
    // Momentum = mass × velocity
    const momentum = normalizedVolume * velocity;
    
    // Acceleration = Δvelocity / Δtime
    const midPoint = Math.floor(period / 2);
    const firstHalfVelocity = (recent[midPoint].close - recent[0].close) / midPoint;
    const secondHalfVelocity = (recent[recent.length - 1].close - recent[midPoint].close) / (period - midPoint);
    const acceleration = secondHalfVelocity - firstHalfVelocity;
    
    return {
      value: momentum,
      velocity,
      acceleration,
      direction: momentum > 0.5 ? 'bullish' : momentum < -0.5 ? 'bearish' : 'neutral',
      strength: Math.abs(momentum),
      isAccelerating: Math.sign(acceleration) === Math.sign(velocity) && Math.abs(acceleration) > 0.1,
    };
  }

  /**
   * Calculate energy levels (support/resistance) using price density
   * Higher trade density = stronger level (like gravitational wells)
   */
  static calculateEnergyLevels(candles, numLevels = 5) {
    const prices = [];
    candles.forEach(c => {
      // Weight OHLC by volume
      const weight = c.volume / 100000;
      for (let i = 0; i < weight; i++) {
        prices.push(c.high, c.low, c.close);
      }
    });
    
    if (prices.length === 0) return [];
    
    // K-means clustering to find price levels
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min;
    
    // Create price histogram
    const bins = 50;
    const histogram = new Array(bins).fill(0);
    prices.forEach(p => {
      const binIndex = Math.min(bins - 1, Math.floor((p - min) / range * bins));
      histogram[binIndex]++;
    });
    
    // Find peaks (energy levels)
    const levels = [];
    for (let i = 2; i < bins - 2; i++) {
      if (histogram[i] > histogram[i-1] && histogram[i] > histogram[i+1] &&
          histogram[i] > histogram[i-2] && histogram[i] > histogram[i+2]) {
        levels.push({
          price: min + (i + 0.5) * range / bins,
          strength: histogram[i] / Math.max(...histogram),
        });
      }
    }
    
    return levels.sort((a, b) => b.strength - a.strength).slice(0, numLevels);
  }

  /**
   * Calculate volatility regime using statistical mechanics
   */
  static calculateVolatilityRegime(candles, period = 20) {
    if (candles.length < period) return { regime: 'normal', value: 1 };
    
    const recent = candles.slice(-period);
    const returns = [];
    
    for (let i = 1; i < recent.length; i++) {
      returns.push((recent[i].close - recent[i-1].close) / recent[i-1].close);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const annualizedVol = stdDev * Math.sqrt(252 * 78); // 78 5-min bars per day
    
    // VIX-like calculation
    const impliedVol = annualizedVol * 100;
    
    let regime = 'normal';
    if (impliedVol > 25) regime = 'high';
    else if (impliedVol > 35) regime = 'extreme';
    else if (impliedVol < 12) regime = 'low';
    
    return {
      regime,
      value: impliedVol,
      stdDev,
      mean,
      // Kurtosis - fat tails indicator
      kurtosis: returns.reduce((s, r) => s + Math.pow((r - mean) / stdDev, 4), 0) / returns.length,
    };
  }

  /**
   * Harmonic analysis - detect price wave patterns
   */
  static analyzeHarmonics(candles, period = 30) {
    if (candles.length < period) return null;
    
    const prices = candles.slice(-period).map(c => c.close);
    const highs = [];
    const lows = [];
    
    // Find swing points
    for (let i = 2; i < prices.length - 2; i++) {
      if (prices[i] > prices[i-1] && prices[i] > prices[i+1] &&
          prices[i] > prices[i-2] && prices[i] > prices[i+2]) {
        highs.push({ index: i, price: prices[i] });
      }
      if (prices[i] < prices[i-1] && prices[i] < prices[i+1] &&
          prices[i] < prices[i-2] && prices[i] < prices[i+2]) {
        lows.push({ index: i, price: prices[i] });
      }
    }
    
    // Calculate wave ratios (Fibonacci)
    const fibLevels = [0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618];
    let pattern = null;
    
    if (highs.length >= 2 && lows.length >= 2) {
      const lastHigh = highs[highs.length - 1];
      const lastLow = lows[lows.length - 1];
      const prevHigh = highs.length > 1 ? highs[highs.length - 2] : null;
      const prevLow = lows.length > 1 ? lows[lows.length - 2] : null;
      
      if (prevLow && lastHigh.index > lastLow.index) {
        // Potential bullish pattern
        const wave1 = lastHigh.price - prevLow.price;
        const retracement = (lastHigh.price - lastLow.price) / wave1;
        
        const nearestFib = fibLevels.reduce((nearest, fib) => 
          Math.abs(fib - retracement) < Math.abs(nearest - retracement) ? fib : nearest
        );
        
        if (Math.abs(nearestFib - retracement) < 0.05) {
          pattern = {
            type: nearestFib <= 0.618 ? 'bullish_continuation' : 'potential_reversal',
            fibLevel: nearestFib,
            projectedTarget: lastLow.price + wave1 * (nearestFib === 0.618 ? 1.618 : 1.272),
            confidence: 1 - Math.abs(nearestFib - retracement) / nearestFib,
          };
        }
      }
    }
    
    return {
      swingHighs: highs,
      swingLows: lows,
      pattern,
      trend: highs.length > 0 && lows.length > 0 ? 
        (highs[highs.length-1].price > lows[lows.length-1].price ? 'up' : 'down') : 'unclear',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// WEIGHTED SIGNAL SCORING SYSTEM
// ═══════════════════════════════════════════════════════════════════

class SignalScorer {
  static weights = {
    momentum: 0.20,
    volumeProfile: 0.15,
    priceAction: 0.20,
    gexLevels: 0.15,
    volatility: 0.10,
    harmonics: 0.10,
    timeOfDay: 0.10,
  };

  static scoreSignal(analysis) {
    let totalScore = 0;
    const breakdown = {};

    // Momentum score (0-100)
    const momScore = Math.min(100, Math.abs(analysis.momentum.value) * 20 + 
      (analysis.momentum.isAccelerating ? 20 : 0));
    breakdown.momentum = momScore;
    totalScore += momScore * this.weights.momentum;

    // Volume profile score
    const volScore = analysis.volumeSpike ? 80 : 
      analysis.volumeRatio > 1.2 ? 60 : 
      analysis.volumeRatio > 0.8 ? 40 : 20;
    breakdown.volumeProfile = volScore;
    totalScore += volScore * this.weights.volumeProfile;

    // Price action score
    let paScore = 50;
    if (analysis.patterns.length > 0) paScore += 25;
    if (analysis.nearSupport || analysis.nearResistance) paScore += 15;
    if (analysis.breakout) paScore += 10;
    breakdown.priceAction = Math.min(100, paScore);
    totalScore += breakdown.priceAction * this.weights.priceAction;

    // GEX levels score
    const gexScore = analysis.atGexLevel ? 85 : 
      analysis.nearGammaFlip ? 75 : 50;
    breakdown.gexLevels = gexScore;
    totalScore += gexScore * this.weights.gexLevels;

    // Volatility score (prefer moderate vol)
    const volRegime = analysis.volatility.regime;
    const volatilityScore = volRegime === 'normal' ? 80 : 
      volRegime === 'high' ? 60 : 
      volRegime === 'low' ? 40 : 30;
    breakdown.volatility = volatilityScore;
    totalScore += volatilityScore * this.weights.volatility;

    // Harmonics score
    const harmScore = analysis.harmonics?.pattern ? 
      analysis.harmonics.pattern.confidence * 100 : 40;
    breakdown.harmonics = harmScore;
    totalScore += harmScore * this.weights.harmonics;

    // Time of day score (best: 9:45-11:00, 14:00-15:30)
    const hour = analysis.hour || 10;
    const todScore = (hour >= 9.75 && hour <= 11) || (hour >= 14 && hour <= 15.5) ? 90 :
      (hour >= 11 && hour <= 12) ? 50 : 60;
    breakdown.timeOfDay = todScore;
    totalScore += todScore * this.weights.timeOfDay;

    return {
      total: Math.round(totalScore),
      breakdown,
      grade: totalScore >= 75 ? 'A' : totalScore >= 65 ? 'B' : totalScore >= 55 ? 'C' : 'D',
      tradeable: totalScore >= 65,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// DYNAMIC STOP LOSS ENGINE
// ═══════════════════════════════════════════════════════════════════

class DynamicStopLoss {
  constructor(entry, direction, initialStop) {
    this.entry = entry;
    this.direction = direction;
    this.initialStop = initialStop;
    this.currentStop = initialStop;
    this.maxFavorable = 0;
    this.phase = 'initial'; // initial, breakeven, trailing, profit_lock
    this.alerts = [];
  }

  update(currentPrice, candle, analysis) {
    const pnlPoints = this.direction === 'long' ? 
      currentPrice - this.entry : this.entry - currentPrice;
    
    // Track max favorable
    if (pnlPoints > this.maxFavorable) {
      this.maxFavorable = pnlPoints;
    }

    // Phase transitions
    if (this.phase === 'initial' && pnlPoints >= CONFIG.risk.breakEvenAt) {
      this.phase = 'breakeven';
      this.currentStop = this.entry + (this.direction === 'long' ? 0.5 : -0.5);
      this.alerts.push({ type: 'BREAKEVEN', message: 'Stop moved to breakeven' });
    }

    if (this.phase === 'breakeven' && pnlPoints >= CONFIG.risk.trailingActivation) {
      this.phase = 'trailing';
      this.alerts.push({ type: 'TRAILING', message: 'Trailing stop activated' });
    }

    if (this.phase === 'trailing') {
      const newStop = this.direction === 'long' ?
        currentPrice - CONFIG.risk.trailingDistance :
        currentPrice + CONFIG.risk.trailingDistance;
      
      if ((this.direction === 'long' && newStop > this.currentStop) ||
          (this.direction === 'short' && newStop < this.currentStop)) {
        this.currentStop = newStop;
      }
    }

    // Profit lock at major targets
    if (pnlPoints >= CONFIG.targets.targetMove) {
      this.phase = 'profit_lock';
      const lockStop = this.direction === 'long' ?
        currentPrice - 4 : currentPrice + 4;
      
      if ((this.direction === 'long' && lockStop > this.currentStop) ||
          (this.direction === 'short' && lockStop < this.currentStop)) {
        this.currentStop = lockStop;
        this.alerts.push({ type: 'PROFIT_LOCK', message: `Locked ${pnlPoints.toFixed(1)} points profit` });
      }
    }

    // Dynamic adjustment based on volatility
    if (analysis && analysis.volatility.regime === 'high') {
      // Widen stop in high volatility
      const volAdjustment = this.direction === 'long' ? -2 : 2;
      if (this.phase === 'initial') {
        this.currentStop = this.initialStop + volAdjustment;
      }
    }

    // Alert on adverse momentum shift
    if (analysis && analysis.momentum) {
      const adverseMomentum = 
        (this.direction === 'long' && analysis.momentum.direction === 'bearish' && analysis.momentum.isAccelerating) ||
        (this.direction === 'short' && analysis.momentum.direction === 'bullish' && analysis.momentum.isAccelerating);
      
      if (adverseMomentum && pnlPoints > 5) {
        this.alerts.push({ 
          type: 'MOMENTUM_SHIFT', 
          message: 'Adverse momentum detected - consider tightening stop',
          severity: 'warning'
        });
      }
    }

    // Check for stop hit
    const stopped = this.direction === 'long' ? 
      currentPrice <= this.currentStop : currentPrice >= this.currentStop;

    return {
      currentStop: this.currentStop,
      phase: this.phase,
      pnlPoints,
      maxFavorable: this.maxFavorable,
      stopped,
      alerts: this.alerts.splice(0), // Return and clear alerts
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN TRADING ENGINE
// ═══════════════════════════════════════════════════════════════════

class SPXTradingEngine {
  constructor() {
    this.account = { ...CONFIG.account };
    this.currentPosition = null;
    this.trades = [];
    this.dailyPnL = 0;
    this.alerts = [];
  }

  analyze(candles, index) {
    if (index < 30) return null;
    
    const curr = candles[index];
    const recent = candles.slice(Math.max(0, index - 50), index + 1);
    
    // Physics-based analysis
    const momentum = PhysicsEngine.calculateMomentum(recent, 10);
    const volatility = PhysicsEngine.calculateVolatilityRegime(recent, 20);
    const energyLevels = PhysicsEngine.calculateEnergyLevels(recent);
    const harmonics = PhysicsEngine.analyzeHarmonics(recent, 30);
    
    // Volume analysis
    const avgVolume = recent.slice(-10).reduce((s, c) => s + c.volume, 0) / 10;
    const volumeRatio = curr.volume / avgVolume;
    const volumeSpike = volumeRatio > 1.5;
    
    // GEX levels (simplified)
    const baseStrike = Math.round(curr.close / 25) * 25;
    const gammaFlip = baseStrike - 25;
    const nearGammaFlip = Math.abs(curr.close - gammaFlip) < 10;
    const isPositiveGamma = curr.close > gammaFlip;
    
    // Price action patterns
    const patterns = this.detectPatterns(candles, index);
    
    // Support/Resistance proximity
    const nearSupport = energyLevels.some(l => l.price < curr.close && curr.close - l.price < 15);
    const nearResistance = energyLevels.some(l => l.price > curr.close && l.price - curr.close < 15);
    const atGexLevel = nearGammaFlip || energyLevels.some(l => Math.abs(l.price - curr.close) < 5);
    
    // Breakout detection
    const recentHigh = Math.max(...recent.slice(-20).map(c => c.high));
    const recentLow = Math.min(...recent.slice(-20).map(c => c.low));
    const breakout = curr.close > recentHigh || curr.close < recentLow;
    
    // Time analysis
    const hour = curr.timestamp.getHours() + curr.timestamp.getMinutes() / 60;
    
    return {
      price: curr.close,
      momentum,
      volatility,
      energyLevels,
      harmonics,
      volumeRatio,
      volumeSpike,
      gammaFlip,
      nearGammaFlip,
      isPositiveGamma,
      patterns,
      nearSupport,
      nearResistance,
      atGexLevel,
      breakout,
      recentHigh,
      recentLow,
      hour,
      candle: curr,
    };
  }

  detectPatterns(candles, index) {
    const patterns = [];
    if (index < 3) return patterns;
    
    const curr = candles[index];
    const prev = candles[index - 1];
    const prev2 = candles[index - 2];
    
    const bodySize = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low || 0.01;
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    
    // Strong momentum candle
    if (bodySize > range * 0.7 && bodySize > 3) {
      patterns.push(curr.close > curr.open ? 'STRONG_BULL' : 'STRONG_BEAR');
    }
    
    // Reversal patterns
    if (lowerWick > bodySize * 2 && upperWick < bodySize * 0.3) {
      patterns.push('HAMMER');
    }
    if (upperWick > bodySize * 2 && lowerWick < bodySize * 0.3) {
      patterns.push('SHOOTING_STAR');
    }
    
    // Engulfing
    if (Math.abs(curr.close - curr.open) > Math.abs(prev.close - prev.open) * 1.5) {
      if (curr.close > curr.open && prev.close < prev.open) patterns.push('BULL_ENGULF');
      if (curr.close < curr.open && prev.close > prev.open) patterns.push('BEAR_ENGULF');
    }
    
    // Inside bar (compression before move)
    if (curr.high < prev.high && curr.low > prev.low) {
      patterns.push('INSIDE_BAR');
    }
    
    return patterns;
  }

  generateSignal(analysis) {
    if (!analysis) return null;
    
    // Score the setup
    const score = SignalScorer.scoreSignal(analysis);
    if (!score.tradeable) return null;
    
    // Determine direction
    let direction = null;
    let reason = [];
    
    // LONG conditions
    if (analysis.momentum.direction === 'bullish' && 
        analysis.momentum.isAccelerating &&
        (analysis.nearSupport || analysis.patterns.includes('HAMMER') || analysis.patterns.includes('BULL_ENGULF')) &&
        analysis.isPositiveGamma) {
      direction = 'long';
      reason.push('Bullish momentum accelerating');
      if (analysis.nearSupport) reason.push('At support level');
      if (analysis.patterns.length) reason.push(`Pattern: ${analysis.patterns[0]}`);
    }
    
    // SHORT conditions
    if (analysis.momentum.direction === 'bearish' && 
        analysis.momentum.isAccelerating &&
        (analysis.nearResistance || analysis.patterns.includes('SHOOTING_STAR') || analysis.patterns.includes('BEAR_ENGULF')) &&
        !analysis.isPositiveGamma) {
      direction = 'short';
      reason.push('Bearish momentum accelerating');
      if (analysis.nearResistance) reason.push('At resistance level');
      if (analysis.patterns.length) reason.push(`Pattern: ${analysis.patterns[0]}`);
    }
    
    // Breakout signals (higher conviction)
    if (analysis.breakout && analysis.volumeSpike) {
      if (analysis.price > analysis.recentHigh && analysis.momentum.direction === 'bullish') {
        direction = 'long';
        reason = ['Breakout above resistance', 'Volume confirmed'];
        score.total = Math.min(95, score.total + 10);
      }
      if (analysis.price < analysis.recentLow && analysis.momentum.direction === 'bearish') {
        direction = 'short';
        reason = ['Breakdown below support', 'Volume confirmed'];
        score.total = Math.min(95, score.total + 10);
      }
    }
    
    // Gamma squeeze setup
    if (analysis.nearGammaFlip && analysis.momentum.strength > 3 && analysis.volumeSpike) {
      if (analysis.momentum.direction === 'bullish' && analysis.price > analysis.gammaFlip) {
        direction = 'long';
        reason = ['Gamma squeeze setup', 'Breaking above flip level'];
        score.total = Math.min(95, score.total + 15);
      }
    }
    
    if (!direction) return null;
    
    // Calculate targets based on volatility
    const volMultiplier = analysis.volatility.regime === 'high' ? 1.3 : 
                          analysis.volatility.regime === 'low' ? 0.8 : 1.0;
    
    const entry = analysis.price;
    const stopDistance = CONFIG.risk.initialStopPoints * volMultiplier;
    const target1 = CONFIG.targets.minMove * volMultiplier;
    const target2 = CONFIG.targets.targetMove * volMultiplier;
    const target3 = CONFIG.targets.extendedTarget * volMultiplier;
    
    return {
      direction,
      entry,
      stop: direction === 'long' ? entry - stopDistance : entry + stopDistance,
      targets: {
        tp1: direction === 'long' ? entry + target1 : entry - target1,
        tp2: direction === 'long' ? entry + target2 : entry - target2,
        tp3: direction === 'long' ? entry + target3 : entry - target3,
      },
      score,
      reason,
      analysis,
      timestamp: analysis.candle.timestamp,
    };
  }

  enterTrade(signal) {
    if (this.currentPosition) return null;
    if (this.dailyPnL <= -CONFIG.account.maxDailyLoss) {
      this.alerts.push({ type: 'RISK', message: 'Daily loss limit reached - no new trades' });
      return null;
    }
    
    // Calculate position size in contracts
    // $500 position / (premium × 100 shares per contract)
    const premium = CONFIG.options.avgPremium * Math.abs(signal.targets.tp1 - signal.entry);
    const contracts = Math.max(1, Math.floor(CONFIG.account.positionSize / (premium * 100)));
    
    this.currentPosition = {
      ...signal,
      contracts,
      stopLoss: new DynamicStopLoss(signal.entry, signal.direction, signal.stop),
      openTime: signal.timestamp,
      maxPnL: 0,
      status: 'open',
    };
    
    return this.currentPosition;
  }

  updatePosition(candle, analysis) {
    if (!this.currentPosition) return null;
    
    const currentPrice = candle.close;
    const stopUpdate = this.currentPosition.stopLoss.update(currentPrice, candle, analysis);
    
    // Collect alerts
    if (stopUpdate.alerts.length > 0) {
      this.alerts.push(...stopUpdate.alerts);
    }
    
    // Check exit conditions
    let exitReason = null;
    let exitPrice = null;
    
    // Stop loss hit
    if (stopUpdate.stopped) {
      exitReason = stopUpdate.phase === 'initial' ? 'STOP_LOSS' : 
                   stopUpdate.phase === 'breakeven' ? 'BREAKEVEN_STOP' :
                   stopUpdate.phase === 'trailing' ? 'TRAILING_STOP' : 'PROFIT_LOCK_STOP';
      exitPrice = stopUpdate.currentStop;
    }
    
    // Target hits
    if (!exitReason) {
      const { tp1, tp2, tp3 } = this.currentPosition.targets;
      
      if (this.currentPosition.direction === 'long') {
        if (candle.high >= tp3) { exitReason = 'TP3_HIT'; exitPrice = tp3; }
        else if (candle.high >= tp2) { exitReason = 'TP2_HIT'; exitPrice = tp2; }
        else if (candle.high >= tp1) { exitReason = 'TP1_HIT'; exitPrice = tp1; }
      } else {
        if (candle.low <= tp3) { exitReason = 'TP3_HIT'; exitPrice = tp3; }
        else if (candle.low <= tp2) { exitReason = 'TP2_HIT'; exitPrice = tp2; }
        else if (candle.low <= tp1) { exitReason = 'TP1_HIT'; exitPrice = tp1; }
      }
    }
    
    // Exit on adverse momentum shift (optional aggressive exit)
    if (!exitReason && analysis) {
      const strongAdverse = 
        (this.currentPosition.direction === 'long' && 
         analysis.momentum.direction === 'bearish' && 
         analysis.momentum.strength > 5 &&
         stopUpdate.pnlPoints > 10) ||
        (this.currentPosition.direction === 'short' && 
         analysis.momentum.direction === 'bullish' && 
         analysis.momentum.strength > 5 &&
         stopUpdate.pnlPoints > 10);
      
      if (strongAdverse) {
        exitReason = 'MOMENTUM_EXIT';
        exitPrice = currentPrice;
      }
    }
    
    // Track max P&L
    if (stopUpdate.pnlPoints > this.currentPosition.maxPnL) {
      this.currentPosition.maxPnL = stopUpdate.pnlPoints;
    }
    
    // Execute exit
    if (exitReason) {
      return this.exitTrade(exitPrice, exitReason, candle.timestamp);
    }
    
    return {
      position: this.currentPosition,
      currentPrice,
      pnlPoints: stopUpdate.pnlPoints,
      currentStop: stopUpdate.currentStop,
      phase: stopUpdate.phase,
      alerts: this.alerts.splice(0),
    };
  }

  exitTrade(exitPrice, reason, timestamp) {
    if (!this.currentPosition) return null;
    
    const position = this.currentPosition;
    const pnlPoints = position.direction === 'long' ? 
      exitPrice - position.entry : position.entry - exitPrice;
    
    // Calculate $ P&L
    // Simplified: Each point ≈ $5 per contract for 0DTE options with ~0.5 delta
    const pnlPerContract = pnlPoints * CONFIG.options.avgDelta * CONFIG.options.contractMultiplier;
    const totalPnL = pnlPerContract * position.contracts;
    
    const trade = {
      ...position,
      exitPrice,
      exitReason: reason,
      closeTime: timestamp,
      pnlPoints,
      pnlDollars: totalPnL,
      maxPnL: position.maxPnL,
      holdingBars: 0, // Would calculate from timestamps
      rMultiple: pnlPoints / CONFIG.risk.initialStopPoints,
    };
    
    this.trades.push(trade);
    this.dailyPnL += totalPnL;
    this.account.size += totalPnL;
    this.currentPosition = null;
    
    return trade;
  }

  getStats() {
    const wins = this.trades.filter(t => t.pnlDollars > 0);
    const losses = this.trades.filter(t => t.pnlDollars <= 0);
    
    const totalPnL = this.trades.reduce((s, t) => s + t.pnlDollars, 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlDollars, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnlDollars, 0) / losses.length) : 0;
    
    return {
      totalTrades: this.trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: this.trades.length > 0 ? (wins.length / this.trades.length * 100).toFixed(1) : 0,
      totalPnL: totalPnL.toFixed(2),
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      profitFactor: avgLoss > 0 ? ((avgWin * wins.length) / (avgLoss * losses.length)).toFixed(2) : 'N/A',
      avgPointsWon: wins.length > 0 ? (wins.reduce((s, t) => s + t.pnlPoints, 0) / wins.length).toFixed(1) : 0,
      avgPointsLost: losses.length > 0 ? (losses.reduce((s, t) => s + t.pnlPoints, 0) / losses.length).toFixed(1) : 0,
      accountSize: this.account.size.toFixed(2),
      accountGrowth: ((this.account.size - CONFIG.account.size) / CONFIG.account.size * 100).toFixed(1),
    };
  }
}

export { SPXTradingEngine, PhysicsEngine, SignalScorer, DynamicStopLoss, CONFIG };
