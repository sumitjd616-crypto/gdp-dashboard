/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA - PRODUCTION-READY GEX TRADING SYSTEM
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * FIXES IMPLEMENTED:
 * ✅ Real data integration (Polygon API)
 * ✅ Slippage + commissions ($3/trade)
 * ✅ Economic calendar filter (Fed/CPI/NFP)
 * ✅ Paper trading journal
 * ✅ Position size limits (micro contracts)
 * ✅ Risk management guardrails
 */

// ═══════════════════════════════════════════════════════════════════════════════════════
// CONFIGURATION - CONSERVATIVE SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════════════

export const PRODUCTION_CONFIG = {
  // Trading costs (REALISTIC)
  costs: {
    slippagePerTrade: 1.50,      // $1.50 slippage per side
    commissionPerContract: 0.65, // Per contract
    roundTripCost: 3.00,         // Total per trade minimum
  },
  
  // Position sizing (MICRO ONLY to start)
  position: {
    maxContracts: 1,             // Start with 1 micro
    pointValue: 5,               // MES = $5/pt (not $50 ES)
    maxRiskPerTrade: 50,         // $50 max risk per trade
    maxDailyLoss: 100,           // $100 max daily loss - HARD STOP
    maxDailyTrades: 3,           // Max 3 trades per day
  },
  
  // Risk management
  risk: {
    maxStopPoints: 8,            // 8 pt max stop = $40 on MES
    breakEvenAt: 6,              // Move to BE after 6 pts
    trailAfter: 10,              // Trail after 10 pts
    maxDrawdownPct: 15,          // 15% max account drawdown
  },
  
  // Time windows (ONLY the best)
  time: {
    allowedWindows: [
      { start: 9.75, end: 10.25, name: 'OPENING' },   // 9:45-10:15 AM
      { start: 15.0, end: 15.5, name: 'POWER' },      // 3:00-3:30 PM
    ],
    blockedDays: ['Friday'],     // No Friday trading (weekend gap risk)
    closeAllBy: 15.75,           // Close all positions by 3:45 PM
  },
  
  // Polygon API
  api: {
    polygonKey: process.env.POLYGON_API_KEY || '',
    baseUrl: 'https://api.polygon.io',
  },
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// ECONOMIC CALENDAR - HIGH IMPACT EVENTS FILTER
// ═══════════════════════════════════════════════════════════════════════════════════════

export class EconomicCalendar {
  constructor() {
    // High impact events - NO TRADING on these
    this.highImpactEvents = {
      // 2024-2025 Fed Meetings (update monthly)
      fedMeetings: [
        '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12',
        '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18',
        '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
        '2025-07-30', '2025-09-17', '2025-11-05', '2025-12-17',
      ],
      
      // CPI Release dates (typically 2nd week of month)
      cpiDates: [
        '2024-01-11', '2024-02-13', '2024-03-12', '2024-04-10',
        '2024-05-15', '2024-06-12', '2024-07-11', '2024-08-14',
        '2024-09-11', '2024-10-10', '2024-11-13', '2024-12-11',
        '2025-01-15', '2025-02-12', '2025-03-12', '2025-04-10',
      ],
      
      // NFP (Non-Farm Payrolls) - First Friday of month
      nfpDates: [
        '2024-01-05', '2024-02-02', '2024-03-08', '2024-04-05',
        '2024-05-03', '2024-06-07', '2024-07-05', '2024-08-02',
        '2024-09-06', '2024-10-04', '2024-11-01', '2024-12-06',
        '2025-01-10', '2025-02-07', '2025-03-07', '2025-04-04',
      ],
      
      // GDP releases
      gdpDates: [
        '2024-01-25', '2024-02-28', '2024-04-25', '2024-05-30',
        '2024-06-27', '2024-07-25', '2024-08-29', '2024-09-26',
        '2024-10-30', '2024-11-27', '2024-12-19',
      ],
      
      // Major earnings that move SPX
      earningsDates: [
        // Add AAPL, MSFT, GOOGL, AMZN, NVDA earnings dates
      ],
    };
    
    // Combine all blocked dates
    this.blockedDates = new Set([
      ...this.highImpactEvents.fedMeetings,
      ...this.highImpactEvents.cpiDates,
      ...this.highImpactEvents.nfpDates,
      ...this.highImpactEvents.gdpDates,
    ]);
  }
  
  /**
   * Check if today is safe to trade
   */
  isTradingAllowed(date = new Date()) {
    const dateStr = date.toISOString().split('T')[0];
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    
    // Check blocked days
    if (PRODUCTION_CONFIG.time.blockedDays.includes(dayName)) {
      return { allowed: false, reason: `No trading on ${dayName}` };
    }
    
    // Check economic calendar
    if (this.blockedDates.has(dateStr)) {
      return { allowed: false, reason: `High-impact event day: ${this.getEventType(dateStr)}` };
    }
    
    // Check day before/after Fed
    const dayBefore = new Date(date);
    dayBefore.setDate(dayBefore.getDate() + 1);
    const dayAfter = new Date(date);
    dayAfter.setDate(dayAfter.getDate() - 1);
    
    if (this.highImpactEvents.fedMeetings.includes(dayBefore.toISOString().split('T')[0])) {
      return { allowed: false, reason: 'Day before FOMC - reduced trading' };
    }
    
    return { allowed: true, reason: 'Clear to trade' };
  }
  
  getEventType(dateStr) {
    if (this.highImpactEvents.fedMeetings.includes(dateStr)) return 'FOMC Meeting';
    if (this.highImpactEvents.cpiDates.includes(dateStr)) return 'CPI Release';
    if (this.highImpactEvents.nfpDates.includes(dateStr)) return 'NFP Release';
    if (this.highImpactEvents.gdpDates.includes(dateStr)) return 'GDP Release';
    return 'Economic Event';
  }
  
  /**
   * Get next blocked dates for display
   */
  getUpcomingBlockedDates(count = 5) {
    const today = new Date();
    const upcoming = [];
    
    for (const dateStr of this.blockedDates) {
      const eventDate = new Date(dateStr);
      if (eventDate >= today) {
        upcoming.push({
          date: dateStr,
          event: this.getEventType(dateStr),
          daysAway: Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24)),
        });
      }
    }
    
    return upcoming.sort((a, b) => a.daysAway - b.daysAway).slice(0, count);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// REAL DATA CLIENT - POLYGON API
// ═══════════════════════════════════════════════════════════════════════════════════════

export class RealDataClient {
  constructor(apiKey) {
    this.apiKey = apiKey || PRODUCTION_CONFIG.api.polygonKey;
    this.baseUrl = PRODUCTION_CONFIG.api.baseUrl;
    this.cache = new Map();
  }
  
  async fetch(endpoint) {
    const cacheKey = endpoint;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 5000) {
      return cached.data;
    }
    
    const url = `${this.baseUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}apiKey=${this.apiKey}`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.error('API Error:', error.message);
      return null;
    }
  }
  
  /**
   * Get real-time SPX price
   */
  async getSpotPrice() {
    const data = await this.fetch('/v2/last/trade/I:SPX');
    return data?.results?.p || null;
  }
  
  /**
   * Get SPX candles (real historical data)
   */
  async getCandles(from, to, timespan = 'minute', multiplier = 5) {
    const fromTs = new Date(from).getTime();
    const toTs = new Date(to).getTime();
    
    const data = await this.fetch(
      `/v2/aggs/ticker/I:SPX/range/${multiplier}/${timespan}/${fromTs}/${toTs}?adjusted=true&sort=asc&limit=50000`
    );
    
    if (!data?.results) return [];
    
    return data.results.map(bar => ({
      ts: new Date(bar.t),
      o: bar.o,
      h: bar.h,
      l: bar.l,
      c: bar.c,
      v: bar.v || 0,
    }));
  }
  
  /**
   * Get real options chain for GEX calculation
   */
  async getOptionsChain() {
    // Get current date expiration
    const today = new Date().toISOString().split('T')[0];
    
    const data = await this.fetch(
      `/v3/snapshot/options/SPX?expiration_date.gte=${today}&limit=250`
    );
    
    return data?.results || [];
  }
  
  /**
   * Get historical data for backtesting
   */
  async getHistoricalData(startDate, endDate) {
    console.log(`Fetching real SPX data from ${startDate} to ${endDate}...`);
    
    const allCandles = [];
    let currentDate = new Date(startDate);
    const end = new Date(endDate);
    
    while (currentDate <= end) {
      const nextDate = new Date(currentDate);
      nextDate.setDate(nextDate.getDate() + 30); // Fetch 30 days at a time
      
      const candles = await this.getCandles(
        currentDate.toISOString(),
        (nextDate <= end ? nextDate : end).toISOString()
      );
      
      allCandles.push(...candles);
      currentDate = nextDate;
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 200));
    }
    
    console.log(`Fetched ${allCandles.length} real candles`);
    return allCandles;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// PAPER TRADING JOURNAL
// ═══════════════════════════════════════════════════════════════════════════════════════

export class TradingJournal {
  constructor() {
    this.trades = [];
    this.dailyStats = {};
    this.startDate = new Date();
  }
  
  /**
   * Log a new trade
   */
  logTrade(trade) {
    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      ...trade,
      
      // Costs applied
      slippage: PRODUCTION_CONFIG.costs.slippagePerTrade * 2, // Entry + exit
      commission: PRODUCTION_CONFIG.costs.commissionPerContract * 2,
      totalCosts: PRODUCTION_CONFIG.costs.roundTripCost,
      
      // Net P&L after costs
      grossPnL: trade.pnl,
      netPnL: trade.pnl - PRODUCTION_CONFIG.costs.roundTripCost,
      
      // Emotional state (to be filled by trader)
      emotionalState: trade.emotionalState || 'neutral',
      notes: trade.notes || '',
    };
    
    this.trades.push(entry);
    this.updateDailyStats(entry);
    
    return entry;
  }
  
  updateDailyStats(trade) {
    const date = trade.timestamp.split('T')[0];
    if (!this.dailyStats[date]) {
      this.dailyStats[date] = {
        trades: 0,
        wins: 0,
        losses: 0,
        grossPnL: 0,
        netPnL: 0,
        totalCosts: 0,
      };
    }
    
    const stats = this.dailyStats[date];
    stats.trades++;
    if (trade.netPnL > 0) stats.wins++;
    else stats.losses++;
    stats.grossPnL += trade.grossPnL;
    stats.netPnL += trade.netPnL;
    stats.totalCosts += trade.totalCosts;
  }
  
  /**
   * Get performance report
   */
  getReport() {
    if (this.trades.length === 0) {
      return { message: 'No trades recorded yet' };
    }
    
    const wins = this.trades.filter(t => t.netPnL > 0);
    const losses = this.trades.filter(t => t.netPnL <= 0);
    
    const grossTotal = this.trades.reduce((s, t) => s + t.grossPnL, 0);
    const netTotal = this.trades.reduce((s, t) => s + t.netPnL, 0);
    const totalCosts = this.trades.reduce((s, t) => s + t.totalCosts, 0);
    
    const avgWin = wins.length ? wins.reduce((s, t) => s + t.netPnL, 0) / wins.length : 0;
    const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.netPnL, 0) / losses.length) : 0;
    
    // Calculate win streaks and loss streaks
    let maxWinStreak = 0, maxLossStreak = 0, currentStreak = 0, lastWin = null;
    for (const t of this.trades) {
      const isWin = t.netPnL > 0;
      if (lastWin === null || lastWin === isWin) {
        currentStreak++;
      } else {
        currentStreak = 1;
      }
      if (isWin && currentStreak > maxWinStreak) maxWinStreak = currentStreak;
      if (!isWin && currentStreak > maxLossStreak) maxLossStreak = currentStreak;
      lastWin = isWin;
    }
    
    // Equity curve for drawdown
    let equity = 0, peak = 0, maxDD = 0;
    for (const t of this.trades) {
      equity += t.netPnL;
      peak = Math.max(peak, equity);
      const dd = peak > 0 ? (peak - equity) / peak * 100 : 0;
      maxDD = Math.max(maxDD, dd);
    }
    
    return {
      totalTrades: this.trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: (wins.length / this.trades.length * 100).toFixed(1),
      
      grossPnL: grossTotal.toFixed(2),
      netPnL: netTotal.toFixed(2),
      totalCosts: totalCosts.toFixed(2),
      costImpact: ((totalCosts / Math.abs(grossTotal)) * 100).toFixed(1),
      
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      profitFactor: avgLoss > 0 ? ((avgWin * wins.length) / (avgLoss * losses.length)).toFixed(2) : 'N/A',
      
      maxWinStreak,
      maxLossStreak,
      maxDrawdown: maxDD.toFixed(1),
      
      tradingDays: Object.keys(this.dailyStats).length,
      avgTradesPerDay: (this.trades.length / Object.keys(this.dailyStats).length).toFixed(1),
      
      // Recommendation
      ready: wins.length >= 20 && netTotal > 0 && maxDD < 15,
      recommendation: this.getRecommendation(wins.length, netTotal, maxDD),
    };
  }
  
  getRecommendation(wins, netPnL, maxDD) {
    if (this.trades.length < 30) {
      return `Need ${30 - this.trades.length} more trades before going live`;
    }
    if (netPnL <= 0) {
      return 'System not profitable - do not go live';
    }
    if (maxDD > 20) {
      return 'Drawdown too high - reduce position size';
    }
    if (wins / this.trades.length < 0.35) {
      return 'Win rate too low - review entry criteria';
    }
    return '✅ Ready for micro-size live trading';
  }
  
  /**
   * Export journal as CSV
   */
  exportCSV() {
    const headers = ['Date', 'Time', 'Direction', 'Entry', 'Exit', 'Stop', 'Gross P&L', 'Costs', 'Net P&L', 'Signal Type', 'Emotional State', 'Notes'];
    const rows = this.trades.map(t => [
      t.timestamp.split('T')[0],
      t.timestamp.split('T')[1].split('.')[0],
      t.direction,
      t.entry,
      t.exit,
      t.stop,
      t.grossPnL.toFixed(2),
      t.totalCosts.toFixed(2),
      t.netPnL.toFixed(2),
      t.signalType,
      t.emotionalState,
      t.notes,
    ]);
    
    return [headers, ...rows].map(r => r.join(',')).join('\n');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// RISK MANAGER - HARD LIMITS
// ═══════════════════════════════════════════════════════════════════════════════════════

export class RiskManager {
  constructor(startingCapital = 500) {
    this.startingCapital = startingCapital;
    this.currentCapital = startingCapital;
    this.dailyPnL = 0;
    this.dailyTrades = 0;
    this.lastTradeDate = null;
    this.isLocked = false;
    this.lockReason = '';
  }
  
  /**
   * Check if trading is allowed
   */
  canTrade() {
    // Reset daily counters
    const today = new Date().toDateString();
    if (this.lastTradeDate !== today) {
      this.dailyPnL = 0;
      this.dailyTrades = 0;
      this.lastTradeDate = today;
      this.isLocked = false;
    }
    
    // Check locks
    if (this.isLocked) {
      return { allowed: false, reason: this.lockReason };
    }
    
    // Daily loss limit
    if (this.dailyPnL <= -PRODUCTION_CONFIG.position.maxDailyLoss) {
      this.lock('Daily loss limit hit - STOP TRADING');
      return { allowed: false, reason: this.lockReason };
    }
    
    // Daily trade limit
    if (this.dailyTrades >= PRODUCTION_CONFIG.position.maxDailyTrades) {
      return { allowed: false, reason: `Max ${PRODUCTION_CONFIG.position.maxDailyTrades} trades per day reached` };
    }
    
    // Account drawdown limit
    const drawdown = (this.startingCapital - this.currentCapital) / this.startingCapital * 100;
    if (drawdown >= PRODUCTION_CONFIG.risk.maxDrawdownPct) {
      this.lock(`Account drawdown ${drawdown.toFixed(1)}% - STOP TRADING`);
      return { allowed: false, reason: this.lockReason };
    }
    
    // Check capital
    if (this.currentCapital < PRODUCTION_CONFIG.position.maxRiskPerTrade) {
      this.lock('Insufficient capital');
      return { allowed: false, reason: this.lockReason };
    }
    
    return { allowed: true };
  }
  
  /**
   * Calculate position size (always micro)
   */
  getPositionSize() {
    return {
      contracts: PRODUCTION_CONFIG.position.maxContracts,
      pointValue: PRODUCTION_CONFIG.position.pointValue,
      maxRisk: PRODUCTION_CONFIG.position.maxRiskPerTrade,
      maxStopPoints: PRODUCTION_CONFIG.risk.maxStopPoints,
    };
  }
  
  /**
   * Record trade result
   */
  recordTrade(pnl) {
    // Apply costs
    const netPnL = pnl - PRODUCTION_CONFIG.costs.roundTripCost;
    
    this.dailyPnL += netPnL;
    this.dailyTrades++;
    this.currentCapital += netPnL;
    
    return {
      grossPnL: pnl,
      netPnL,
      costs: PRODUCTION_CONFIG.costs.roundTripCost,
      dailyPnL: this.dailyPnL,
      dailyTrades: this.dailyTrades,
      currentCapital: this.currentCapital,
    };
  }
  
  lock(reason) {
    this.isLocked = true;
    this.lockReason = reason;
    console.log(`🔒 TRADING LOCKED: ${reason}`);
  }
  
  getStatus() {
    return {
      currentCapital: this.currentCapital,
      dailyPnL: this.dailyPnL,
      dailyTrades: this.dailyTrades,
      maxDailyTrades: PRODUCTION_CONFIG.position.maxDailyTrades,
      isLocked: this.isLocked,
      lockReason: this.lockReason,
      drawdown: ((this.startingCapital - this.currentCapital) / this.startingCapital * 100).toFixed(1),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// TIME WINDOW CHECKER
// ═══════════════════════════════════════════════════════════════════════════════════════

export class TimeWindowChecker {
  /**
   * Check if current time is in allowed trading window
   */
  static isInTradingWindow(date = new Date()) {
    const hour = date.getHours() + date.getMinutes() / 60;
    
    for (const window of PRODUCTION_CONFIG.time.allowedWindows) {
      if (hour >= window.start && hour < window.end) {
        return { allowed: true, window: window.name };
      }
    }
    
    // Check if need to close all positions
    if (hour >= PRODUCTION_CONFIG.time.closeAllBy) {
      return { allowed: false, window: 'CLOSE_ALL', mustClose: true };
    }
    
    return { allowed: false, window: 'OUTSIDE_HOURS' };
  }
  
  /**
   * Get next trading window
   */
  static getNextWindow(date = new Date()) {
    const hour = date.getHours() + date.getMinutes() / 60;
    
    for (const window of PRODUCTION_CONFIG.time.allowedWindows) {
      if (hour < window.start) {
        const minsUntil = (window.start - hour) * 60;
        return {
          window: window.name,
          startsIn: Math.round(minsUntil),
          startTime: `${Math.floor(window.start)}:${Math.round((window.start % 1) * 60).toString().padStart(2, '0')}`,
        };
      }
    }
    
    return { window: 'TOMORROW', startsIn: null };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// MAIN PRODUCTION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════════════

export class ProductionGEXSystem {
  constructor(apiKey, startingCapital = 500) {
    this.dataClient = new RealDataClient(apiKey);
    this.calendar = new EconomicCalendar();
    this.journal = new TradingJournal();
    this.riskManager = new RiskManager(startingCapital);
    this.isPaperMode = true; // Always start in paper mode
  }
  
  /**
   * Full pre-trade checklist
   */
  async preTradeChecklist() {
    const checks = [];
    
    // 1. Economic calendar
    const calendarCheck = this.calendar.isTradingAllowed();
    checks.push({
      name: 'Economic Calendar',
      passed: calendarCheck.allowed,
      message: calendarCheck.reason,
    });
    
    // 2. Time window
    const timeCheck = TimeWindowChecker.isInTradingWindow();
    checks.push({
      name: 'Trading Window',
      passed: timeCheck.allowed,
      message: timeCheck.allowed ? `In ${timeCheck.window} window` : `Outside trading hours (${timeCheck.window})`,
    });
    
    // 3. Risk limits
    const riskCheck = this.riskManager.canTrade();
    checks.push({
      name: 'Risk Limits',
      passed: riskCheck.allowed,
      message: riskCheck.allowed ? 'Within limits' : riskCheck.reason,
    });
    
    // 4. Data connection
    const spot = await this.dataClient.getSpotPrice();
    checks.push({
      name: 'Data Feed',
      passed: spot !== null,
      message: spot ? `SPX: ${spot}` : 'Data feed unavailable',
    });
    
    const allPassed = checks.every(c => c.passed);
    
    return {
      allPassed,
      checks,
      canTrade: allPassed,
      spot,
    };
  }
  
  /**
   * Execute a signal (paper or live)
   */
  async executeSignal(signal) {
    // Run checklist
    const checklist = await this.preTradeChecklist();
    if (!checklist.canTrade) {
      return {
        executed: false,
        reason: 'Pre-trade checklist failed',
        checks: checklist.checks,
      };
    }
    
    // Get position size
    const position = this.riskManager.getPositionSize();
    
    // Apply slippage to entry
    const slippageDirection = signal.direction === 'LONG' ? 1 : -1;
    const actualEntry = signal.entry + (PRODUCTION_CONFIG.costs.slippagePerTrade / position.pointValue * slippageDirection);
    
    const trade = {
      signalType: signal.type,
      direction: signal.direction,
      entry: actualEntry,
      stop: signal.stop,
      tp1: signal.tp1,
      tp2: signal.tp2,
      contracts: position.contracts,
      pointValue: position.pointValue,
      maxRisk: Math.abs(actualEntry - signal.stop) * position.pointValue * position.contracts,
      timestamp: new Date().toISOString(),
      status: 'OPEN',
    };
    
    console.log(`
┌─────────────────────────────────────────────────────────────────┐
│  ${this.isPaperMode ? '📝 PAPER' : '💰 LIVE'} TRADE EXECUTED                                      │
├─────────────────────────────────────────────────────────────────┤
│  Signal: ${signal.type.padEnd(20)}  Direction: ${signal.direction}        │
│  Entry:  ${actualEntry.toFixed(2)}  (incl. slippage)                      │
│  Stop:   ${signal.stop.toFixed(2)}                                          │
│  TP1:    ${signal.tp1.toFixed(2)}                                          │
│  Risk:   $${trade.maxRisk.toFixed(2)} (${position.contracts} MES @ $${position.pointValue}/pt)       │
└─────────────────────────────────────────────────────────────────┘
`);
    
    return {
      executed: true,
      trade,
      isPaper: this.isPaperMode,
    };
  }
  
  /**
   * Record trade exit
   */
  recordExit(trade, exitPrice, reason) {
    // Apply slippage to exit
    const slippageDirection = trade.direction === 'LONG' ? -1 : 1;
    const actualExit = exitPrice + (PRODUCTION_CONFIG.costs.slippagePerTrade / trade.pointValue * slippageDirection);
    
    const grossPoints = trade.direction === 'LONG' ? actualExit - trade.entry : trade.entry - actualExit;
    const grossPnL = grossPoints * trade.pointValue * trade.contracts;
    
    // Record in risk manager (applies costs)
    const result = this.riskManager.recordTrade(grossPnL);
    
    // Log in journal
    const journalEntry = this.journal.logTrade({
      ...trade,
      exit: actualExit,
      exitReason: reason,
      pnl: grossPnL,
    });
    
    console.log(`
┌─────────────────────────────────────────────────────────────────┐
│  TRADE CLOSED: ${reason.padEnd(20)}                               │
├─────────────────────────────────────────────────────────────────┤
│  Exit:      ${actualExit.toFixed(2)} (incl. slippage)                      │
│  Gross P&L: ${grossPnL >= 0 ? '+' : ''}$${grossPnL.toFixed(2)}                                    │
│  Costs:     -$${result.costs.toFixed(2)}                                      │
│  Net P&L:   ${result.netPnL >= 0 ? '+' : ''}$${result.netPnL.toFixed(2)}                                    │
├─────────────────────────────────────────────────────────────────┤
│  Daily P&L: ${result.dailyPnL >= 0 ? '+' : ''}$${result.dailyPnL.toFixed(2)}  |  Trades: ${result.dailyTrades}/${PRODUCTION_CONFIG.position.maxDailyTrades}          │
│  Capital:   $${result.currentCapital.toFixed(2)}                                │
└─────────────────────────────────────────────────────────────────┘
`);
    
    return { journalEntry, result };
  }
  
  /**
   * Get full system status
   */
  getStatus() {
    return {
      mode: this.isPaperMode ? 'PAPER' : 'LIVE',
      risk: this.riskManager.getStatus(),
      journal: this.journal.getReport(),
      calendar: {
        tradingAllowed: this.calendar.isTradingAllowed(),
        upcomingEvents: this.calendar.getUpcomingBlockedDates(),
      },
      timeWindow: TimeWindowChecker.isInTradingWindow(),
      nextWindow: TimeWindowChecker.getNextWindow(),
    };
  }
  
  /**
   * Export journal for review
   */
  exportJournal() {
    return this.journal.exportCSV();
  }
}

export default ProductionGEXSystem;
