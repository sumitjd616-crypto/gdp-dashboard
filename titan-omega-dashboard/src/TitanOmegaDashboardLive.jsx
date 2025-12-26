import React, { useState, useEffect, useCallback } from 'react';

/**
 * TITAN OMEGA - LIVE TRADING DASHBOARD
 * With Real-Time Commentary & 25% Max Drawdown Protection
 */

const TitanOmegaDashboardLive = () => {
  // ═══════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════
  
  const [currentTime, setCurrentTime] = useState(new Date());
  const [spotPrice, setSpotPrice] = useState(6000.00);
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  
  // Active trade state
  const [activeTrade, setActiveTrade] = useState(null);
  const [tradeCommentary, setTradeCommentary] = useState([]);
  const [tradeAlerts, setTradeAlerts] = useState([]);
  const [tradeGuidance, setTradeGuidance] = useState(null);
  
  // Market data
  const [momentum, setMomentum] = useState({ direction: 'neutral', strength: 0, accelerating: false });
  const [volatility, setVolatility] = useState({ regime: 'normal', atr: 8 });
  const [volume, setVolume] = useState({ ratio: 1.0, spike: false });
  
  // Config
  const CONFIG = {
    account: { size: 2000, positionSize: 500, maxDrawdownPercent: 25 },
    targets: { tp1: 15, tp2: 25, tp3: 40 },
  };

  // ═══════════════════════════════════════════════════════════════════
  // COMMENTARY MESSAGES
  // ═══════════════════════════════════════════════════════════════════
  
  const MESSAGES = {
    entry: {
      long: "🟢 LONG ENTRY at {price}. Stop: {stop}. Target: {tp1}/{tp2}/{tp3}",
      short: "🔴 SHORT ENTRY at {price}. Stop: {stop}. Target: {tp1}/{tp2}/{tp3}",
    },
    priceAction: {
      favorable: ["📈 Price moving in our favor", "✨ Positive price action", "💪 Momentum supporting direction"],
      neutral: ["⏸️ Price consolidating", "📊 Sideways movement", "🔄 Market digesting"],
      adverse: ["⚠️ Minor pullback - normal", "🛡️ Within risk tolerance", "📉 Temporary weakness"],
    },
    stops: {
      breakeven: "🔒 STOP TO BREAKEVEN! Risk-free trade!",
      trailing: "📈 Trailing stop activated",
      profitLock: "💰 PROFIT LOCKED at {points} points",
    },
    targets: {
      tp1Near: "🎯 Approaching TP1 (+15 pts)",
      tp1Hit: "🎉 TP1 HIT! +15 points secured!",
      tp2Near: "🎯 Approaching TP2 (+25 pts)",
      tp2Hit: "🏆 TP2 HIT! +25 points!",
      tp3Near: "🌟 Approaching TP3 (+40 pts)",
      tp3Hit: "🏆🏆🏆 TP3 HIT! +40 POINTS!",
    },
    confidence: [
      "💎 Patience is key. Let it work.",
      "📋 Stick to the plan.",
      "✅ Trust the analysis.",
      "🧘 Stay calm and focused.",
      "💪 Discipline wins.",
    ],
  };

  // ═══════════════════════════════════════════════════════════════════
  // SIMULATE MARKET DATA
  // ═══════════════════════════════════════════════════════════════════
  
  useEffect(() => {
    // Price updates
    const priceInterval = setInterval(() => {
      setSpotPrice(prev => {
        const change = (Math.random() - 0.48) * 1.2;
        return parseFloat((prev + change).toFixed(2));
      });
      
      // Update momentum
      setMomentum(prev => {
        const newStrength = Math.max(0, prev.strength + (Math.random() - 0.5) * 0.3);
        const directions = ['bullish', 'neutral', 'bearish'];
        const newDir = Math.random() < 0.1 ? directions[Math.floor(Math.random() * 3)] : prev.direction;
        return {
          direction: newDir,
          strength: Math.min(3, newStrength),
          accelerating: Math.random() > 0.6,
        };
      });
      
      // Update volume
      setVolume({
        ratio: 0.8 + Math.random() * 0.8,
        spike: Math.random() > 0.85,
      });
    }, 2000);
    
    // Time updates
    const timeInterval = setInterval(() => setCurrentTime(new Date()), 1000);
    
    return () => {
      clearInterval(priceInterval);
      clearInterval(timeInterval);
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // TRADE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════
  
  const addCommentary = useCallback((message, type = 'info') => {
    setTradeCommentary(prev => [{
      id: Date.now(),
      time: new Date(),
      message,
      type,
    }, ...prev].slice(0, 30));
  }, []);
  
  const addTradeAlert = useCallback((message, type = 'info') => {
    const alert = { id: Date.now(), message, type, time: new Date() };
    setTradeAlerts(prev => [alert, ...prev].slice(0, 10));
    setAlertMessage(message);
    setShowAlert(true);
    setTimeout(() => setShowAlert(false), 5000);
  }, []);

  // Start a new trade
  const startTrade = useCallback((direction) => {
    const entry = spotPrice;
    const stopDistance = 10; // 10 points initial stop
    const stop = direction === 'long' ? entry - stopDistance : entry + stopDistance;
    
    const trade = {
      id: Date.now(),
      direction,
      entry,
      stop,
      currentStop: stop,
      tp1: direction === 'long' ? entry + 15 : entry - 15,
      tp2: direction === 'long' ? entry + 25 : entry - 25,
      tp3: direction === 'long' ? entry + 40 : entry - 40,
      status: 'ACTIVE',
      phase: 'INITIAL',
      openTime: new Date(),
      maxPnL: 0,
      minPnL: 0,
      tp1Hit: false,
      tp2Hit: false,
      tp3Hit: false,
    };
    
    setActiveTrade(trade);
    setTradeCommentary([]);
    setTradeAlerts([]);
    
    const entryMsg = MESSAGES.entry[direction]
      .replace('{price}', entry.toFixed(2))
      .replace('{stop}', stop.toFixed(2))
      .replace('{tp1}', trade.tp1.toFixed(0))
      .replace('{tp2}', trade.tp2.toFixed(0))
      .replace('{tp3}', trade.tp3.toFixed(0));
    
    addCommentary(entryMsg, 'entry');
    addTradeAlert(`NEW ${direction.toUpperCase()} TRADE @ ${entry.toFixed(2)}`, 'success');
  }, [spotPrice, addCommentary, addTradeAlert]);

  // Update active trade
  useEffect(() => {
    if (!activeTrade || activeTrade.status !== 'ACTIVE') return;
    
    const updateTrade = () => {
      setActiveTrade(prev => {
        if (!prev || prev.status !== 'ACTIVE') return prev;
        
        const currentPnL = prev.direction === 'long' ? 
          spotPrice - prev.entry : prev.entry - spotPrice;
        
        const drawdownPercent = Math.max(0, -currentPnL / prev.entry * 100);
        
        // Update max/min PnL
        const maxPnL = Math.max(prev.maxPnL, currentPnL);
        const minPnL = Math.min(prev.minPnL, currentPnL);
        
        let newPhase = prev.phase;
        let newStop = prev.currentStop;
        let tp1Hit = prev.tp1Hit;
        let tp2Hit = prev.tp2Hit;
        let tp3Hit = prev.tp3Hit;
        let status = prev.status;
        let exitReason = null;
        
        // ═══ 25% MAX DRAWDOWN CHECK ═══
        if (drawdownPercent >= CONFIG.account.maxDrawdownPercent) {
          addTradeAlert("🛑 25% MAX DRAWDOWN - Position closed!", 'danger');
          addCommentary("⛔ MAX DRAWDOWN LIMIT - Trade closed to protect capital", 'danger');
          status = 'CLOSED';
          exitReason = 'MAX_DRAWDOWN_25%';
        }
        
        // ═══ STOP CHECK ═══
        const stopHit = prev.direction === 'long' ? 
          spotPrice <= newStop : spotPrice >= newStop;
        
        if (stopHit && status === 'ACTIVE') {
          addTradeAlert(`🛑 Stop hit at ${newStop.toFixed(2)}`, 'warning');
          addCommentary(`🛑 ${newPhase} stop triggered. Trade closed.`, 'warning');
          status = 'CLOSED';
          exitReason = `${newPhase}_STOP`;
        }
        
        // ═══ TARGET CHECKS ═══
        if (status === 'ACTIVE') {
          if (!tp1Hit && currentPnL >= 15) {
            tp1Hit = true;
            addTradeAlert(MESSAGES.targets.tp1Hit, 'success');
            addCommentary(MESSAGES.targets.tp1Hit, 'success');
          }
          if (!tp2Hit && currentPnL >= 25) {
            tp2Hit = true;
            addTradeAlert(MESSAGES.targets.tp2Hit, 'success');
            addCommentary(MESSAGES.targets.tp2Hit, 'success');
          }
          if (!tp3Hit && currentPnL >= 40) {
            tp3Hit = true;
            addTradeAlert(MESSAGES.targets.tp3Hit, 'success');
            addCommentary(MESSAGES.targets.tp3Hit, 'success');
            status = 'CLOSED';
            exitReason = 'TP3_HIT';
          }
        }
        
        // ═══ STOP MANAGEMENT ═══
        if (status === 'ACTIVE') {
          // Breakeven
          if (newPhase === 'INITIAL' && currentPnL >= 8) {
            newPhase = 'BREAKEVEN';
            newStop = prev.entry + (prev.direction === 'long' ? 0.5 : -0.5);
            addTradeAlert(MESSAGES.stops.breakeven, 'success');
            addCommentary(MESSAGES.stops.breakeven, 'success');
          }
          
          // Trailing
          if (newPhase === 'BREAKEVEN' && currentPnL >= 12) {
            newPhase = 'TRAILING';
            addCommentary(MESSAGES.stops.trailing, 'info');
          }
          
          // Update trailing stop
          if (newPhase === 'TRAILING' || newPhase === 'PROFIT_LOCK') {
            const trailStop = prev.direction === 'long' ? 
              spotPrice - 5 : spotPrice + 5;
            
            if ((prev.direction === 'long' && trailStop > newStop) ||
                (prev.direction === 'short' && trailStop < newStop)) {
              newStop = trailStop;
            }
          }
          
          // Profit lock at TP1
          if (tp1Hit && newPhase !== 'PROFIT_LOCK') {
            newPhase = 'PROFIT_LOCK';
            const lockStop = prev.direction === 'long' ? spotPrice - 4 : spotPrice + 4;
            if ((prev.direction === 'long' && lockStop > newStop) ||
                (prev.direction === 'short' && lockStop < newStop)) {
              newStop = lockStop;
              addCommentary(MESSAGES.stops.profitLock.replace('{points}', currentPnL.toFixed(1)), 'success');
            }
          }
        }
        
        // ═══ DYNAMIC COMMENTARY ═══
        if (status === 'ACTIVE' && Math.random() < 0.08) {
          if (currentPnL > 3) {
            const msg = MESSAGES.priceAction.favorable[Math.floor(Math.random() * MESSAGES.priceAction.favorable.length)];
            addCommentary(msg, 'info');
          } else if (currentPnL < -3 && currentPnL > -8) {
            const msg = MESSAGES.priceAction.adverse[Math.floor(Math.random() * MESSAGES.priceAction.adverse.length)];
            addCommentary(msg, 'warning');
          } else {
            const msg = MESSAGES.priceAction.neutral[Math.floor(Math.random() * MESSAGES.priceAction.neutral.length)];
            addCommentary(msg, 'info');
          }
        }
        
        // Confidence messages
        if (status === 'ACTIVE' && Math.random() < 0.03) {
          const msg = MESSAGES.confidence[Math.floor(Math.random() * MESSAGES.confidence.length)];
          addCommentary(msg, 'info');
        }
        
        // Update guidance
        let guidance = { action: 'MONITOR', message: 'Watching price action...', confidence: 'medium' };
        if (currentPnL >= 25) {
          guidance = { action: 'HOLD_TP3', message: 'Excellent! Consider TP3 or exit.', confidence: 'high' };
        } else if (tp1Hit) {
          guidance = { action: 'PROFIT_LOCKED', message: 'TP1 hit! Stop locked. Let it run.', confidence: 'high' };
        } else if (currentPnL >= 8) {
          guidance = { action: 'BREAKEVEN', message: 'Good progress. Stop at BE.', confidence: 'high' };
        } else if (currentPnL > 0) {
          guidance = { action: 'HOLD', message: 'In profit. Monitoring.', confidence: 'medium' };
        } else if (currentPnL > -5) {
          guidance = { action: 'HOLD', message: 'Minor pullback. Normal.', confidence: 'medium' };
        } else {
          guidance = { action: 'MONITOR', message: 'Adverse but within limits.', confidence: 'low' };
        }
        setTradeGuidance(guidance);
        
        return {
          ...prev,
          currentStop: newStop,
          phase: newPhase,
          maxPnL,
          minPnL,
          tp1Hit,
          tp2Hit,
          tp3Hit,
          status,
          exitReason,
          currentPnL,
          drawdownPercent,
        };
      });
    };
    
    const interval = setInterval(updateTrade, 1000);
    return () => clearInterval(interval);
  }, [activeTrade, spotPrice, addCommentary, addTradeAlert]);

  // ═══════════════════════════════════════════════════════════════════
  // RENDER HELPERS
  // ═══════════════════════════════════════════════════════════════════
  
  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false 
    }) + ' ET';
  };

  const getPnLColor = (pnl) => {
    if (pnl > 0) return 'text-emerald-400';
    if (pnl < 0) return 'text-red-400';
    return 'text-gray-400';
  };

  const getPhaseColor = (phase) => {
    switch (phase) {
      case 'INITIAL': return 'bg-yellow-500/20 text-yellow-400';
      case 'BREAKEVEN': return 'bg-blue-500/20 text-blue-400';
      case 'TRAILING': return 'bg-emerald-500/20 text-emerald-400';
      case 'PROFIT_LOCK': return 'bg-purple-500/20 text-purple-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  const getCommentaryColor = (type) => {
    switch (type) {
      case 'entry': return 'border-blue-500 bg-blue-500/10';
      case 'success': return 'border-emerald-500 bg-emerald-500/10';
      case 'warning': return 'border-yellow-500 bg-yellow-500/10';
      case 'danger': return 'border-red-500 bg-red-500/10';
      case 'target': return 'border-purple-500 bg-purple-500/10';
      default: return 'border-gray-700 bg-gray-800/50';
    }
  };

  // Calculate current trade PnL
  const currentPnL = activeTrade ? 
    (activeTrade.direction === 'long' ? spotPrice - activeTrade.entry : activeTrade.entry - spotPrice) : 0;

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════
  
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      {/* Alert Banner */}
      {showAlert && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-gradient-to-r from-emerald-500 to-emerald-600 text-black px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-pulse">
          <span className="text-2xl">🔔</span>
          <div className="font-bold">{alertMessage}</div>
        </div>
      )}

      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex justify-between items-center sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center font-bold text-xl">Ω</div>
          <div>
            <div className="text-lg font-bold bg-gradient-to-r from-white to-blue-400 bg-clip-text text-transparent">TITAN OMEGA</div>
            <div className="text-xs text-gray-500 tracking-wider">LIVE TRADE MONITOR</div>
          </div>
        </div>
        
        <div className="flex gap-3">
          <div className="text-center px-4 py-2 bg-gray-800 rounded-lg border border-gray-700">
            <div className="font-mono font-bold text-xl text-white">{spotPrice.toFixed(2)}</div>
            <div className="text-xs text-gray-500">SPX SPOT</div>
          </div>
          <div className="text-center px-4 py-2 bg-gray-800 rounded-lg border border-gray-700">
            <div className={`font-mono font-bold ${momentum.direction === 'bullish' ? 'text-emerald-400' : momentum.direction === 'bearish' ? 'text-red-400' : 'text-gray-400'}`}>
              {momentum.direction.toUpperCase()}
            </div>
            <div className="text-xs text-gray-500">MOMENTUM</div>
          </div>
          <div className="text-center px-4 py-2 bg-gray-800 rounded-lg border border-gray-700">
            <div className="font-mono font-bold text-white">${CONFIG.account.size}</div>
            <div className="text-xs text-gray-500">ACCOUNT</div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded text-sm font-semibold">
            MAX DD: {CONFIG.account.maxDrawdownPercent}%
          </div>
          <div className="font-mono text-gray-400">{formatTime(currentTime)}</div>
          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-sm">Live</span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="grid grid-cols-12 gap-3 p-3 h-[calc(100vh-64px)]">
        
        {/* Left Panel - Trade Controls & Status */}
        <aside className="col-span-3 flex flex-col gap-3">
          {/* Trade Entry */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="text-sm font-semibold text-gray-400 mb-3">🎯 TRADE ENTRY</div>
            {!activeTrade || activeTrade.status !== 'ACTIVE' ? (
              <div className="flex gap-2">
                <button 
                  onClick={() => startTrade('long')}
                  className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg transition-colors"
                >
                  🟢 LONG
                </button>
                <button 
                  onClick={() => startTrade('short')}
                  className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-lg transition-colors"
                >
                  🔴 SHORT
                </button>
              </div>
            ) : (
              <div className="text-center py-3 bg-gray-800 rounded-lg text-gray-400">
                Trade Active - Monitoring...
              </div>
            )}
          </div>

          {/* Active Trade Status */}
          {activeTrade && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex-1">
              <div className="flex justify-between items-center mb-4">
                <span className="text-sm font-semibold text-gray-400">📊 ACTIVE TRADE</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${getPhaseColor(activeTrade.phase)}`}>
                  {activeTrade.phase}
                </span>
              </div>
              
              {/* P&L Display */}
              <div className="text-center py-4 bg-gray-800 rounded-lg mb-4">
                <div className={`text-3xl font-mono font-bold ${getPnLColor(currentPnL)}`}>
                  {currentPnL >= 0 ? '+' : ''}{currentPnL.toFixed(2)}
                </div>
                <div className="text-sm text-gray-500">POINTS P&L</div>
              </div>
              
              {/* Trade Details */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Direction</span>
                  <span className={activeTrade.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}>
                    {activeTrade.direction.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Entry</span>
                  <span className="font-mono">{activeTrade.entry.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Current Stop</span>
                  <span className="font-mono text-red-400">{activeTrade.currentStop?.toFixed(2) || activeTrade.stop.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Max Drawdown</span>
                  <span className="font-mono text-yellow-400">{CONFIG.account.maxDrawdownPercent}%</span>
                </div>
              </div>
              
              {/* Targets */}
              <div className="mt-4 pt-4 border-t border-gray-800">
                <div className="text-xs text-gray-500 mb-2">TARGETS</div>
                <div className="space-y-2">
                  <div className={`flex justify-between items-center px-2 py-1 rounded ${activeTrade.tp1Hit ? 'bg-emerald-500/20' : 'bg-gray-800'}`}>
                    <span className="text-sm">TP1 (+15)</span>
                    <span className="font-mono text-sm">{activeTrade.tp1.toFixed(0)}</span>
                    {activeTrade.tp1Hit && <span>✅</span>}
                  </div>
                  <div className={`flex justify-between items-center px-2 py-1 rounded ${activeTrade.tp2Hit ? 'bg-emerald-500/20' : 'bg-gray-800'}`}>
                    <span className="text-sm">TP2 (+25)</span>
                    <span className="font-mono text-sm">{activeTrade.tp2.toFixed(0)}</span>
                    {activeTrade.tp2Hit && <span>✅</span>}
                  </div>
                  <div className={`flex justify-between items-center px-2 py-1 rounded ${activeTrade.tp3Hit ? 'bg-emerald-500/20' : 'bg-gray-800'}`}>
                    <span className="text-sm">TP3 (+40)</span>
                    <span className="font-mono text-sm">{activeTrade.tp3.toFixed(0)}</span>
                    {activeTrade.tp3Hit && <span>✅</span>}
                  </div>
                </div>
              </div>
              
              {/* Drawdown Meter */}
              <div className="mt-4 pt-4 border-t border-gray-800">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>DRAWDOWN METER</span>
                  <span>{Math.max(0, -currentPnL / activeTrade.entry * 100).toFixed(1)}% / {CONFIG.account.maxDrawdownPercent}%</span>
                </div>
                <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all ${
                      Math.max(0, -currentPnL / activeTrade.entry * 100) > 20 ? 'bg-red-500' :
                      Math.max(0, -currentPnL / activeTrade.entry * 100) > 10 ? 'bg-yellow-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, -currentPnL / activeTrade.entry * 100) / CONFIG.account.maxDrawdownPercent * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Center Panel - Live Commentary */}
        <section className="col-span-6 flex flex-col gap-3">
          {/* Guidance Banner */}
          {tradeGuidance && activeTrade?.status === 'ACTIVE' && (
            <div className={`p-4 rounded-xl border ${
              tradeGuidance.confidence === 'high' ? 'bg-emerald-500/10 border-emerald-500/50' :
              tradeGuidance.confidence === 'low' ? 'bg-yellow-500/10 border-yellow-500/50' :
              'bg-blue-500/10 border-blue-500/50'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold">{tradeGuidance.action}</div>
                  <div className="text-sm text-gray-400">{tradeGuidance.message}</div>
                </div>
                <div className={`text-4xl ${
                  tradeGuidance.confidence === 'high' ? 'text-emerald-400' :
                  tradeGuidance.confidence === 'low' ? 'text-yellow-400' : 'text-blue-400'
                }`}>
                  {tradeGuidance.confidence === 'high' ? '✅' : tradeGuidance.confidence === 'low' ? '⚠️' : '📊'}
                </div>
              </div>
            </div>
          )}

          {/* Live Commentary Feed */}
          <div className="flex-1 bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden">
            <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-400">💬 LIVE TRADE COMMENTARY</span>
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full text-xs font-bold">
                Real-Time
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {tradeCommentary.length === 0 ? (
                <div className="text-center py-10 text-gray-500">
                  <div className="text-4xl mb-2">📊</div>
                  <div>Start a trade to see live commentary</div>
                </div>
              ) : (
                tradeCommentary.map(item => (
                  <div 
                    key={item.id}
                    className={`px-3 py-2 rounded-lg border-l-4 ${getCommentaryColor(item.type)}`}
                  >
                    <div className="flex justify-between items-start">
                      <span className="text-sm">{item.message}</span>
                      <span className="text-xs text-gray-500 ml-2">
                        {item.time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Price Chart Placeholder */}
          <div className="h-48 bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden">
            <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-400">📈 PRICE ACTION</span>
              <span className="text-xs text-gray-500">SPX 5-min</span>
            </div>
            <div className="flex-1 flex items-center justify-center text-gray-600">
              <div className="text-center">
                <div className="text-5xl font-mono font-bold">{spotPrice.toFixed(2)}</div>
                <div className="text-sm text-gray-500 mt-2">SPX SPOT PRICE</div>
                {activeTrade && (
                  <div className={`text-2xl font-bold mt-2 ${getPnLColor(currentPnL)}`}>
                    {currentPnL >= 0 ? '▲' : '▼'} {Math.abs(currentPnL).toFixed(2)} pts
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Right Panel - Alerts & Parameters */}
        <aside className="col-span-3 flex flex-col gap-3">
          {/* Active Alerts */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="text-sm font-semibold text-gray-400 mb-3">🔔 ALERTS</div>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {tradeAlerts.length === 0 ? (
                <div className="text-center py-4 text-gray-600 text-sm">No alerts</div>
              ) : (
                tradeAlerts.slice(0, 5).map(alert => (
                  <div 
                    key={alert.id}
                    className={`px-3 py-2 rounded-lg text-sm ${
                      alert.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                      alert.type === 'danger' ? 'bg-red-500/20 text-red-400' :
                      alert.type === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}
                  >
                    {alert.message}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Market Parameters */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex-1">
            <div className="text-sm font-semibold text-gray-400 mb-3">📊 MARKET PARAMETERS</div>
            <div className="space-y-3">
              <div className="p-3 bg-gray-800 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">MOMENTUM</div>
                <div className={`font-bold ${
                  momentum.direction === 'bullish' ? 'text-emerald-400' :
                  momentum.direction === 'bearish' ? 'text-red-400' : 'text-gray-400'
                }`}>
                  {momentum.direction.toUpperCase()} {momentum.accelerating && '⚡'}
                </div>
                <div className="h-1.5 bg-gray-700 rounded-full mt-2">
                  <div 
                    className={`h-full rounded-full ${
                      momentum.direction === 'bullish' ? 'bg-emerald-500' :
                      momentum.direction === 'bearish' ? 'bg-red-500' : 'bg-gray-500'
                    }`}
                    style={{ width: `${Math.min(100, momentum.strength * 33)}%` }}
                  />
                </div>
              </div>
              
              <div className="p-3 bg-gray-800 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">VOLUME</div>
                <div className="font-bold">
                  {volume.ratio.toFixed(2)}x {volume.spike && '🔊'}
                </div>
                <div className="h-1.5 bg-gray-700 rounded-full mt-2">
                  <div 
                    className={`h-full rounded-full ${volume.spike ? 'bg-purple-500' : 'bg-blue-500'}`}
                    style={{ width: `${Math.min(100, volume.ratio * 50)}%` }}
                  />
                </div>
              </div>
              
              <div className="p-3 bg-gray-800 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">VOLATILITY</div>
                <div className="font-bold text-yellow-400">{volatility.regime.toUpperCase()}</div>
                <div className="text-xs text-gray-500 mt-1">ATR: {volatility.atr.toFixed(1)}</div>
              </div>
            </div>
            
            {/* Risk Rules */}
            <div className="mt-4 pt-4 border-t border-gray-800">
              <div className="text-xs text-gray-500 mb-2">RISK RULES</div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-gray-400">Max Drawdown: 25%</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-gray-400">Breakeven @ +8 pts</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-gray-400">Trailing @ +12 pts</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-gray-400">Profit lock @ TP1</span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};

export default TitanOmegaDashboardLive;
