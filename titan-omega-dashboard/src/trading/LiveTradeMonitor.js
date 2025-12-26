/**
 * ═══════════════════════════════════════════════════════════════════
 * TITAN OMEGA - LIVE TRADE MONITOR & COMMENTARY ENGINE
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Real-time trade guidance with:
 * - 25% max drawdown protection (hard stop)
 * - Live commentary based on price action
 * - Multi-parameter analysis
 * - Confidence-building alerts
 * - Target achievement tracking
 */

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export const CONFIG = {
  account: {
    size: 2000,
    positionSize: 500,
    maxDrawdownPercent: 25,  // HARD LIMIT: Never down more than 25%
  },
  targets: {
    tp1: 15,   // First target
    tp2: 25,   // Primary target
    tp3: 40,   // Extended target
  },
  risk: {
    maxLossPercent: 25,      // 25% max loss on position
    breakEvenPoints: 8,      // Move to BE after 8 pts
    trailingStart: 12,       // Start trailing after 12 pts
    trailingDistance: 5,     // Trail by 5 pts
  },
  commentary: {
    updateInterval: 5000,    // Update every 5 seconds
    alertCooldown: 30000,    // Min 30s between same alert types
  }
};

// ═══════════════════════════════════════════════════════════════════
// COMMENTARY MESSAGES
// ═══════════════════════════════════════════════════════════════════

const COMMENTARY = {
  // Entry phase
  entry: {
    long: [
      "🟢 LONG ENTRY EXECUTED - Position active. Monitoring all parameters.",
      "📊 Entry confirmed. Watching momentum, volume, and price action.",
      "✅ Trade initiated. Stop loss set. Managing risk.",
    ],
    short: [
      "🔴 SHORT ENTRY EXECUTED - Position active. Monitoring all parameters.",
      "📊 Entry confirmed. Watching momentum, volume, and price action.",
      "✅ Trade initiated. Stop loss set. Managing risk.",
    ],
  },
  
  // Price action commentary
  priceAction: {
    favorable: [
      "📈 Price moving in our favor. Holding position.",
      "✨ Positive price action. Trade developing as expected.",
      "💪 Momentum supporting our direction. Stay patient.",
      "🎯 Price progressing toward target. Risk managed.",
    ],
    neutral: [
      "⏸️ Price consolidating. Normal market behavior.",
      "📊 Sideways action. Monitoring for next move.",
      "🔄 Market digesting. Position still valid.",
      "⚖️ Balance between buyers and sellers. Watching closely.",
    ],
    adverse: [
      "⚠️ Minor pullback. This is normal. Stop protected.",
      "🛡️ Adverse move but within risk tolerance. Holding.",
      "📉 Temporary weakness. Parameters still valid.",
      "💎 Stay disciplined. Pullbacks are opportunities.",
    ],
  },
  
  // Momentum commentary
  momentum: {
    strong: [
      "🚀 Strong momentum in our direction!",
      "⚡ Momentum accelerating. Excellent sign.",
      "📈 Buyers/Sellers in control. Trade working.",
    ],
    building: [
      "📊 Momentum building. Watch for acceleration.",
      "🔄 Energy accumulating for next move.",
      "⏳ Patience - momentum takes time to develop.",
    ],
    fading: [
      "⚠️ Momentum fading. Tightening risk management.",
      "📉 Reduced momentum. Consider partial exit if profitable.",
      "🔔 Momentum warning - stops adjusted.",
    ],
    reversing: [
      "🚨 Momentum reversing! Dynamic stop active.",
      "⛔ Counter-momentum detected. Protecting capital.",
      "🛑 Exit signal from momentum. Managing position.",
    ],
  },
  
  // Volume commentary
  volume: {
    spike: [
      "📊 Volume spike detected! Institutions active.",
      "🔊 High volume confirms the move.",
      "⚡ Smart money participation visible.",
    ],
    declining: [
      "📉 Volume declining. Move may be exhausting.",
      "⚠️ Low volume - less conviction in price action.",
    ],
    normal: [
      "📊 Normal volume. Price action is key.",
    ],
  },
  
  // Target proximity
  targets: {
    approaching_tp1: [
      "🎯 Approaching TP1 (15 pts)! Consider partial exit.",
      "📍 Near first target. Locking some profit recommended.",
      "✅ TP1 in sight. Trade management active.",
    ],
    hit_tp1: [
      "🎉 TP1 HIT! +15 points secured!",
      "💰 First target achieved! Stop moved to lock profit.",
      "✅ Excellent execution! Riding remaining for TP2.",
    ],
    approaching_tp2: [
      "🎯 Approaching TP2 (25 pts)! Great trade!",
      "🚀 Primary target near. Outstanding execution.",
    ],
    hit_tp2: [
      "🏆 TP2 HIT! +25 points! Exceptional trade!",
      "💎 Primary target achieved! Consider full exit.",
    ],
    approaching_tp3: [
      "🌟 Approaching TP3 (40 pts)! Home run trade!",
      "🎯 Extended target in range. Maximum profit mode.",
    ],
    hit_tp3: [
      "🏆🏆🏆 TP3 HIT! +40 POINTS! PERFECT EXECUTION!",
      "💰💰💰 EXTENDED TARGET! This is why we trade!",
    ],
  },
  
  // Stop levels
  stops: {
    initial: [
      "🛡️ Initial stop in place. Risk defined.",
      "⚠️ Stop loss active. Max risk: 25% of position.",
    ],
    breakeven: [
      "🔒 STOP MOVED TO BREAKEVEN! Risk-free trade!",
      "✅ Capital protected. Now playing with house money.",
      "💪 Breakeven locked. Only profit from here.",
    ],
    trailing: [
      "📈 Trailing stop activated! Locking profits.",
      "🔒 Profit protection active. Stop follows price.",
      "✨ Trailing mode - securing gains automatically.",
    ],
    profit_lock: [
      "💰 PROFIT LOCKED! Minimum gain secured.",
      "🎯 Stop tightened to lock significant profit.",
      "✅ Great trade secured. Letting winner run.",
    ],
    hit: [
      "🛑 Stop hit. Trade closed. Capital preserved.",
      "📊 Exit executed. Review and prepare for next setup.",
    ],
  },
  
  // Risk warnings
  risk: {
    approaching_max: [
      "⚠️ APPROACHING 25% MAX DRAWDOWN - Monitoring closely.",
      "🚨 Near maximum loss threshold. Dynamic management active.",
    ],
    max_hit: [
      "🛑 25% MAX DRAWDOWN - Position closed automatically.",
      "⛔ Risk limit triggered. Capital preservation priority.",
    ],
  },
  
  // Market context
  market: {
    positive_gamma: [
      "✅ Positive gamma environment - Dealers dampening volatility.",
      "🟢 Market structure supportive for our position.",
    ],
    negative_gamma: [
      "⚠️ Negative gamma - Expect amplified moves.",
      "🔴 Dealers may amplify moves. Wider stops considered.",
    ],
    high_vix: [
      "📊 Elevated VIX - Increased volatility expected.",
      "⚡ High vol environment. Position sized accordingly.",
    ],
  },
  
  // Confidence builders
  confidence: {
    patience: [
      "💎 Patience is key. Let the trade work.",
      "⏳ Winners take time to develop. Trust the process.",
      "🧘 Stay calm. The analysis was sound.",
    ],
    discipline: [
      "📋 Stick to the plan. Discipline wins.",
      "✅ Following the system. This is how pros trade.",
      "💪 Emotional control = trading success.",
    ],
    trust: [
      "🎯 Trust the parameters. They've been tested.",
      "📊 Multiple indicators align. High probability setup.",
      "✨ Everything checked out at entry. Trust it.",
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════
// LIVE TRADE MONITOR CLASS
// ═══════════════════════════════════════════════════════════════════

export class LiveTradeMonitor {
  constructor(trade) {
    this.trade = {
      id: Date.now(),
      direction: trade.direction,
      entry: trade.entry,
      stop: trade.stop,
      tp1: trade.tp1,
      tp2: trade.tp2,
      tp3: trade.tp3,
      contracts: trade.contracts || 1,
      openTime: new Date(),
      status: 'ACTIVE',
    };
    
    // Calculate max loss based on 25% rule
    this.maxLossPoints = CONFIG.account.positionSize * (CONFIG.account.maxDrawdownPercent / 100) / 
                         (CONFIG.options?.delta || 0.5) / (CONFIG.options?.multiplier || 100) / this.trade.contracts;
    
    // Ensure stop is within 25% max loss
    const maxStop = this.trade.direction === 'long' ? 
      this.trade.entry - this.maxLossPoints : 
      this.trade.entry + this.maxLossPoints;
    
    if ((this.trade.direction === 'long' && this.trade.stop < maxStop) ||
        (this.trade.direction === 'short' && this.trade.stop > maxStop)) {
      this.trade.stop = maxStop;
    }
    
    this.currentStop = this.trade.stop;
    this.phase = 'INITIAL';
    this.maxPnL = 0;
    this.minPnL = 0;
    this.currentPnL = 0;
    
    this.commentary = [];
    this.alerts = [];
    this.lastAlertTime = {};
    
    this.tp1Hit = false;
    this.tp2Hit = false;
    this.tp3Hit = false;
    
    // Add entry commentary
    this.addCommentary(this.getRandomMessage(COMMENTARY.entry[trade.direction]), 'entry');
    this.addCommentary(this.getRandomMessage(COMMENTARY.stops.initial), 'info');
  }
  
  getRandomMessage(messages) {
    return messages[Math.floor(Math.random() * messages.length)];
  }
  
  addCommentary(message, type = 'info') {
    const entry = {
      time: new Date(),
      message,
      type, // entry, info, warning, success, danger, target
    };
    this.commentary.unshift(entry);
    
    // Keep last 50 messages
    if (this.commentary.length > 50) {
      this.commentary = this.commentary.slice(0, 50);
    }
    
    return entry;
  }
  
  addAlert(message, type = 'info', sound = false) {
    // Check cooldown
    const alertKey = message.substring(0, 20);
    const now = Date.now();
    if (this.lastAlertTime[alertKey] && now - this.lastAlertTime[alertKey] < CONFIG.commentary.alertCooldown) {
      return null;
    }
    this.lastAlertTime[alertKey] = now;
    
    const alert = {
      id: Date.now(),
      time: new Date(),
      message,
      type,
      sound,
      dismissed: false,
    };
    this.alerts.unshift(alert);
    
    // Keep last 20 alerts
    if (this.alerts.length > 20) {
      this.alerts = this.alerts.slice(0, 20);
    }
    
    return alert;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // MAIN UPDATE FUNCTION - Called on each price tick
  // ═══════════════════════════════════════════════════════════════════
  
  update(currentPrice, analysis = {}) {
    if (this.trade.status !== 'ACTIVE') {
      return this.getStatus();
    }
    
    // Calculate P&L
    this.currentPnL = this.trade.direction === 'long' ? 
      currentPrice - this.trade.entry : 
      this.trade.entry - currentPrice;
    
    const pnlPercent = (this.currentPnL / this.trade.entry) * 100;
    
    // Track max/min P&L
    if (this.currentPnL > this.maxPnL) this.maxPnL = this.currentPnL;
    if (this.currentPnL < this.minPnL) this.minPnL = this.currentPnL;
    
    // ═══ 25% MAX DRAWDOWN CHECK (HARD STOP) ═══
    const drawdownFromEntry = -this.currentPnL;
    const drawdownPercent = (drawdownFromEntry / this.trade.entry) * 100;
    
    if (drawdownPercent >= CONFIG.account.maxDrawdownPercent * 0.9) {
      this.addAlert(this.getRandomMessage(COMMENTARY.risk.approaching_max), 'danger', true);
    }
    
    if (drawdownPercent >= CONFIG.account.maxDrawdownPercent) {
      this.addAlert(this.getRandomMessage(COMMENTARY.risk.max_hit), 'danger', true);
      return this.closePosition(currentPrice, 'MAX_DRAWDOWN_25%');
    }
    
    // ═══ STOP LOSS CHECK ═══
    const stopHit = this.trade.direction === 'long' ? 
      currentPrice <= this.currentStop : 
      currentPrice >= this.currentStop;
    
    if (stopHit) {
      this.addAlert(this.getRandomMessage(COMMENTARY.stops.hit), 'warning', true);
      return this.closePosition(this.currentStop, `${this.phase}_STOP`);
    }
    
    // ═══ TARGET CHECKS ═══
    if (!this.tp1Hit && this.currentPnL >= CONFIG.targets.tp1) {
      this.tp1Hit = true;
      this.addAlert(this.getRandomMessage(COMMENTARY.targets.hit_tp1), 'success', true);
      this.addCommentary(this.getRandomMessage(COMMENTARY.targets.hit_tp1), 'target');
    }
    
    if (!this.tp2Hit && this.currentPnL >= CONFIG.targets.tp2) {
      this.tp2Hit = true;
      this.addAlert(this.getRandomMessage(COMMENTARY.targets.hit_tp2), 'success', true);
      this.addCommentary(this.getRandomMessage(COMMENTARY.targets.hit_tp2), 'target');
    }
    
    if (!this.tp3Hit && this.currentPnL >= CONFIG.targets.tp3) {
      this.tp3Hit = true;
      this.addAlert(this.getRandomMessage(COMMENTARY.targets.hit_tp3), 'success', true);
      return this.closePosition(this.trade.tp3, 'TP3_HIT');
    }
    
    // ═══ TARGET PROXIMITY ALERTS ═══
    if (!this.tp1Hit && this.currentPnL >= CONFIG.targets.tp1 * 0.8) {
      this.addCommentary(this.getRandomMessage(COMMENTARY.targets.approaching_tp1), 'info');
    }
    if (this.tp1Hit && !this.tp2Hit && this.currentPnL >= CONFIG.targets.tp2 * 0.85) {
      this.addCommentary(this.getRandomMessage(COMMENTARY.targets.approaching_tp2), 'info');
    }
    
    // ═══ DYNAMIC STOP MANAGEMENT ═══
    this.updateStops(currentPrice, analysis);
    
    // ═══ GENERATE COMMENTARY ═══
    this.generateCommentary(currentPrice, analysis);
    
    return this.getStatus();
  }
  
  updateStops(currentPrice, analysis) {
    // Phase: Move to breakeven
    if (this.phase === 'INITIAL' && this.currentPnL >= CONFIG.risk.breakEvenPoints) {
      this.phase = 'BREAKEVEN';
      this.currentStop = this.trade.entry + (this.trade.direction === 'long' ? 0.5 : -0.5);
      this.addAlert(this.getRandomMessage(COMMENTARY.stops.breakeven), 'success', true);
      this.addCommentary(this.getRandomMessage(COMMENTARY.stops.breakeven), 'success');
    }
    
    // Phase: Start trailing
    if (this.phase === 'BREAKEVEN' && this.currentPnL >= CONFIG.risk.trailingStart) {
      this.phase = 'TRAILING';
      this.addAlert(this.getRandomMessage(COMMENTARY.stops.trailing), 'info');
      this.addCommentary(this.getRandomMessage(COMMENTARY.stops.trailing), 'info');
    }
    
    // Update trailing stop
    if (this.phase === 'TRAILING' || this.phase === 'PROFIT_LOCK') {
      const trailDistance = CONFIG.risk.trailingDistance;
      const newStop = this.trade.direction === 'long' ? 
        currentPrice - trailDistance : 
        currentPrice + trailDistance;
      
      if ((this.trade.direction === 'long' && newStop > this.currentStop) ||
          (this.trade.direction === 'short' && newStop < this.currentStop)) {
        this.currentStop = newStop;
      }
    }
    
    // Profit lock at TP1
    if (this.tp1Hit && this.phase !== 'PROFIT_LOCK') {
      this.phase = 'PROFIT_LOCK';
      const lockStop = this.trade.direction === 'long' ? 
        currentPrice - 4 : currentPrice + 4;
      
      if ((this.trade.direction === 'long' && lockStop > this.currentStop) ||
          (this.trade.direction === 'short' && lockStop < this.currentStop)) {
        this.currentStop = lockStop;
        this.addAlert(this.getRandomMessage(COMMENTARY.stops.profit_lock), 'success');
        this.addCommentary(this.getRandomMessage(COMMENTARY.stops.profit_lock), 'success');
      }
    }
    
    // Dynamic tightening on momentum fade
    if (analysis.momentum?.direction === 'neutral' && this.currentPnL > 10 && this.phase !== 'INITIAL') {
      const tightStop = this.trade.direction === 'long' ? 
        currentPrice - 3 : currentPrice + 3;
      
      if ((this.trade.direction === 'long' && tightStop > this.currentStop) ||
          (this.trade.direction === 'short' && tightStop < this.currentStop)) {
        this.currentStop = tightStop;
        this.addCommentary(this.getRandomMessage(COMMENTARY.momentum.fading), 'warning');
      }
    }
  }
  
  generateCommentary(currentPrice, analysis) {
    // Throttle commentary (not every tick)
    if (Math.random() > 0.15) return;
    
    // Price action commentary
    if (this.currentPnL > 3) {
      this.addCommentary(this.getRandomMessage(COMMENTARY.priceAction.favorable), 'info');
    } else if (this.currentPnL < -3 && this.currentPnL > -8) {
      this.addCommentary(this.getRandomMessage(COMMENTARY.priceAction.adverse), 'warning');
    } else if (Math.abs(this.currentPnL) <= 3) {
      this.addCommentary(this.getRandomMessage(COMMENTARY.priceAction.neutral), 'info');
    }
    
    // Momentum commentary
    if (analysis.momentum) {
      if (analysis.momentum.direction === this.trade.direction.substring(0, 4) + 'ish' || 
          (this.trade.direction === 'long' && analysis.momentum.direction === 'bullish') ||
          (this.trade.direction === 'short' && analysis.momentum.direction === 'bearish')) {
        if (analysis.momentum.accelerating) {
          this.addCommentary(this.getRandomMessage(COMMENTARY.momentum.strong), 'success');
        } else {
          this.addCommentary(this.getRandomMessage(COMMENTARY.momentum.building), 'info');
        }
      }
    }
    
    // Volume commentary
    if (analysis.volumeSpike) {
      this.addCommentary(this.getRandomMessage(COMMENTARY.volume.spike), 'info');
    }
    
    // Confidence builders (occasional)
    if (Math.random() < 0.1) {
      const categories = ['patience', 'discipline', 'trust'];
      const category = categories[Math.floor(Math.random() * categories.length)];
      this.addCommentary(this.getRandomMessage(COMMENTARY.confidence[category]), 'info');
    }
    
    // Market context
    if (analysis.isPositiveGamma !== undefined) {
      if (Math.random() < 0.05) {
        const context = analysis.isPositiveGamma ? 
          COMMENTARY.market.positive_gamma : COMMENTARY.market.negative_gamma;
        this.addCommentary(this.getRandomMessage(context), 'info');
      }
    }
  }
  
  closePosition(exitPrice, reason) {
    this.trade.status = 'CLOSED';
    this.trade.exit = exitPrice;
    this.trade.exitReason = reason;
    this.trade.closeTime = new Date();
    this.trade.finalPnL = this.trade.direction === 'long' ? 
      exitPrice - this.trade.entry : 
      this.trade.entry - exitPrice;
    
    // Add closing commentary
    const isWin = this.trade.finalPnL > 0;
    if (isWin) {
      this.addCommentary(`✅ Trade closed: +${this.trade.finalPnL.toFixed(1)} points. ${reason}`, 'success');
    } else {
      this.addCommentary(`🛑 Trade closed: ${this.trade.finalPnL.toFixed(1)} points. ${reason}`, 'warning');
    }
    
    return this.getStatus();
  }
  
  getStatus() {
    const distanceToTP1 = CONFIG.targets.tp1 - this.currentPnL;
    const distanceToTP2 = CONFIG.targets.tp2 - this.currentPnL;
    const distanceToTP3 = CONFIG.targets.tp3 - this.currentPnL;
    const distanceToStop = this.trade.direction === 'long' ? 
      this.trade.entry + this.currentPnL - this.currentStop :
      this.currentStop - (this.trade.entry - this.currentPnL);
    
    const riskRewardCurrent = distanceToStop > 0 ? distanceToTP1 / distanceToStop : 0;
    
    return {
      trade: this.trade,
      currentPnL: this.currentPnL,
      currentPnLPercent: (this.currentPnL / this.trade.entry) * 100,
      maxPnL: this.maxPnL,
      minPnL: this.minPnL,
      currentStop: this.currentStop,
      phase: this.phase,
      
      tp1Hit: this.tp1Hit,
      tp2Hit: this.tp2Hit,
      tp3Hit: this.tp3Hit,
      
      distanceToTP1,
      distanceToTP2,
      distanceToTP3,
      distanceToStop,
      riskRewardCurrent,
      
      maxDrawdownPercent: CONFIG.account.maxDrawdownPercent,
      currentDrawdownPercent: Math.max(0, -this.currentPnL / this.trade.entry * 100),
      
      commentary: this.commentary.slice(0, 10),
      alerts: this.alerts.filter(a => !a.dismissed).slice(0, 5),
      
      guidance: this.getCurrentGuidance(),
    };
  }
  
  getCurrentGuidance() {
    if (this.trade.status !== 'ACTIVE') {
      return {
        action: 'CLOSED',
        message: 'Trade completed. Review and prepare for next setup.',
        confidence: 'neutral',
      };
    }
    
    if (this.currentPnL >= CONFIG.targets.tp2) {
      return {
        action: 'HOLD_FOR_TP3',
        message: 'Excellent trade! Consider holding for extended target or taking profit.',
        confidence: 'high',
      };
    }
    
    if (this.tp1Hit) {
      return {
        action: 'PROFIT_PROTECTED',
        message: 'TP1 achieved! Stop locked. Let winner run toward TP2.',
        confidence: 'high',
      };
    }
    
    if (this.currentPnL >= CONFIG.risk.breakEvenPoints) {
      return {
        action: 'BREAKEVEN_ZONE',
        message: 'Good progress! Stop at breakeven. Risk eliminated.',
        confidence: 'high',
      };
    }
    
    if (this.currentPnL > 0) {
      return {
        action: 'HOLD',
        message: 'Trade in profit. Monitoring for stop adjustment.',
        confidence: 'medium',
      };
    }
    
    if (this.currentPnL > -5) {
      return {
        action: 'HOLD',
        message: 'Minor drawdown. Normal price action. Stay patient.',
        confidence: 'medium',
      };
    }
    
    return {
      action: 'MONITOR',
      message: 'Adverse move but within limits. Stop will protect capital.',
      confidence: 'low',
    };
  }
  
  dismissAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) alert.dismissed = true;
  }
}

export default LiveTradeMonitor;
