import React, { useState, useEffect, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// TITAN OMEGA ENHANCED DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
// Combining: Karpathy (ML) + Page (Systems) + Minervini (Trading)

// Black-Scholes Greeks Calculator
const normalCDF = (x) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
};

const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const calculateGreeks = (S, K, T, r, sigma) => {
  T = Math.max(T, 0.0001);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const sqrtT = Math.sqrt(T);
  return {
    delta: normalCDF(d1),
    gamma: normalPDF(d1) / (S * sigma * sqrtT),
    vega: S * normalPDF(d1) * sqrtT / 100,
    theta: (-S * normalPDF(d1) * sigma / (2 * sqrtT) - r * K * Math.exp(-r * T) * normalCDF(d2)) / 365,
    charm: -normalPDF(d1) * (2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT),
    vanna: -normalPDF(d1) * d2 / sigma,
  };
};

// Config
const CONFIG = {
  account: { size: 2000, maxRisk: 0.25, maxDD: 25 },
  targets: { tp1R: 2.0, tp2R: 3.5, tp3R: 5.0 },
};

// Components
const Card = ({ children, className = '', glow = false }) => (
  <div className={`bg-gray-900/80 border border-gray-700/50 rounded-xl p-4 backdrop-blur-sm ${glow ? 'ring-1 ring-cyan-500/30' : ''} ${className}`}>
    {children}
  </div>
);

const ProgressBar = ({ value, max, color = 'cyan', showLabel = true }) => {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="w-full">
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full bg-${color}-500 transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
      {showLabel && <div className="text-xs text-gray-500 mt-1">{pct.toFixed(0)}%</div>}
    </div>
  );
};

const StatCard = ({ label, value, unit, trend, color = 'cyan' }) => (
  <div className="text-center">
    <div className={`text-2xl font-bold text-${color}-400`}>{value}<span className="text-sm text-gray-500 ml-1">{unit}</span></div>
    <div className="text-xs text-gray-500">{label}</div>
    {trend && <div className={`text-xs ${trend > 0 ? 'text-green-400' : trend < 0 ? 'text-red-400' : 'text-gray-500'}`}>{trend > 0 ? '▲' : trend < 0 ? '▼' : '–'}</div>}
  </div>
);

const GreeksPanel = ({ greeks }) => (
  <Card>
    <h3 className="text-sm font-semibold text-purple-400 mb-3 flex items-center gap-2">
      <span>⚛️</span> Options Greeks (Black-Scholes)
    </h3>
    <div className="grid grid-cols-3 gap-3">
      <div className="bg-gray-800/50 rounded-lg p-2">
        <div className="text-xs text-gray-500">Delta (Δ)</div>
        <div className="text-lg font-bold text-blue-400">{greeks.delta.toFixed(3)}</div>
        <div className="text-xs text-gray-600">Price sensitivity</div>
      </div>
      <div className="bg-gray-800/50 rounded-lg p-2">
        <div className="text-xs text-gray-500">Gamma (Γ)</div>
        <div className="text-lg font-bold text-green-400">{(greeks.gamma * 1000).toFixed(3)}</div>
        <div className="text-xs text-gray-600">Delta rate (×1000)</div>
      </div>
      <div className="bg-gray-800/50 rounded-lg p-2">
        <div className="text-xs text-gray-500">Vega (ν)</div>
        <div className="text-lg font-bold text-yellow-400">{greeks.vega.toFixed(3)}</div>
        <div className="text-xs text-gray-600">Vol sensitivity</div>
      </div>
      <div className="bg-gray-800/50 rounded-lg p-2">
        <div className="text-xs text-gray-500">Theta (θ)</div>
        <div className="text-lg font-bold text-red-400">{greeks.theta.toFixed(4)}</div>
        <div className="text-xs text-gray-600">Time decay/day</div>
      </div>
      <div className="bg-gray-800/50 rounded-lg p-2">
        <div className="text-xs text-gray-500">Charm</div>
        <div className="text-lg font-bold text-orange-400">{(greeks.charm * 1000).toFixed(3)}</div>
        <div className="text-xs text-gray-600">Delta decay</div>
      </div>
      <div className="bg-gray-800/50 rounded-lg p-2">
        <div className="text-xs text-gray-500">Vanna</div>
        <div className="text-lg font-bold text-pink-400">{greeks.vanna.toFixed(4)}</div>
        <div className="text-xs text-gray-600">Δ/Vol cross</div>
      </div>
    </div>
  </Card>
);

const GEXPanel = ({ gex, spot }) => (
  <Card glow={gex.isPositiveGamma}>
    <h3 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
      <span>📊</span> GEX Analysis
      <span className={`ml-auto text-xs px-2 py-0.5 rounded ${gex.isPositiveGamma ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
        {gex.isPositiveGamma ? '+Gamma (Support)' : '-Gamma (Amplify)'}
      </span>
    </h3>
    <div className="space-y-3">
      <div className="flex justify-between text-sm">
        <span className="text-gray-400">Net GEX:</span>
        <span className={gex.netGEX > 0 ? 'text-green-400' : 'text-red-400'}>{(gex.netGEX / 1e9).toFixed(2)}B</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-gray-400">Gamma Flip:</span>
        <span className="text-cyan-400">{gex.gammaFlip.toFixed(0)}</span>
      </div>
      <div className="text-xs space-y-1">
        <div className="text-gray-500">Major Levels:</div>
        {gex.majorLevels.slice(0, 3).map((l, i) => (
          <div key={i} className="flex justify-between">
            <span className={l.strike > spot ? 'text-red-400' : 'text-green-400'}>{l.strike}</span>
            <span className="text-gray-500">{(l.gex / 1e9).toFixed(2)}B</span>
          </div>
        ))}
      </div>
    </div>
  </Card>
);

const MinerviniPanel = ({ stage, template }) => {
  const stageColors = { 1: 'gray', 2: 'green', 3: 'yellow', 4: 'red' };
  const stageIcons = { 1: '🔄', 2: '🚀', 3: '⚠️', 4: '📉' };
  return (
    <Card>
      <h3 className="text-sm font-semibold text-yellow-400 mb-3 flex items-center gap-2">
        <span>📈</span> Minervini SEPA Analysis
      </h3>
      <div className="text-center mb-3">
        <div className={`text-3xl font-bold text-${stageColors[stage.stage]}-400`}>
          {stageIcons[stage.stage]} Stage {stage.stage}
        </div>
        <div className="text-sm text-gray-400">{stage.name}</div>
        <div className={`text-xs mt-1 ${stage.bias === 'long' ? 'text-green-400' : stage.bias === 'short' ? 'text-red-400' : 'text-gray-500'}`}>
          Bias: {stage.bias.toUpperCase()}
        </div>
      </div>
      <div className="text-xs space-y-1">
        <div className="flex justify-between">
          <span className="text-gray-500">Trend Score:</span>
          <span className={template.score >= 70 ? 'text-green-400' : 'text-yellow-400'}>{template.score}/100</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Template Valid:</span>
          <span className={template.valid ? 'text-green-400' : 'text-red-400'}>{template.valid ? '✓' : '✗'}</span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1 text-xs">
        {Object.entries(template.criteria || {}).map(([k, v]) => (
          <div key={k} className={`p-1 rounded text-center ${v ? 'bg-green-500/20 text-green-400' : 'bg-gray-800 text-gray-600'}`}>
            {k.replace(/([A-Z])/g, ' $1').slice(0, 8)}
          </div>
        ))}
      </div>
    </Card>
  );
};

const SignalPanel = ({ signal, onTrade }) => {
  if (!signal) return (
    <Card>
      <div className="text-center text-gray-500 py-8">
        <div className="text-4xl mb-2">🔍</div>
        <div>Scanning for high-probability setups...</div>
      </div>
    </Card>
  );
  
  return (
    <Card glow>
      <h3 className="text-sm font-semibold text-cyan-400 mb-3">🎯 Signal Detected</h3>
      <div className={`text-center py-4 rounded-lg mb-4 ${signal.dir === 'long' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
        <div className={`text-4xl font-bold ${signal.dir === 'long' ? 'text-green-400' : 'text-red-400'}`}>
          {signal.dir === 'long' ? '📈 LONG' : '📉 SHORT'}
        </div>
        <div className="text-lg text-gray-300">@ {signal.entry.toFixed(2)}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm mb-4">
        <div className="bg-red-500/10 rounded p-2">
          <div className="text-xs text-gray-500">Stop Loss</div>
          <div className="text-red-400 font-bold">{signal.stop.toFixed(2)}</div>
        </div>
        <div className="bg-green-500/10 rounded p-2">
          <div className="text-xs text-gray-500">TP1 (2R)</div>
          <div className="text-green-400 font-bold">{signal.tp1.toFixed(2)}</div>
        </div>
        <div className="bg-green-500/10 rounded p-2">
          <div className="text-xs text-gray-500">TP2 (3.5R)</div>
          <div className="text-green-400 font-bold">{signal.tp2.toFixed(2)}</div>
        </div>
        <div className="bg-green-500/10 rounded p-2">
          <div className="text-xs text-gray-500">TP3 (5R)</div>
          <div className="text-green-400 font-bold">{signal.tp3.toFixed(2)}</div>
        </div>
      </div>
      <div className="text-xs text-gray-400 mb-2">Reasons: {signal.reasons.join(' • ')}</div>
      <div className="flex justify-between text-xs text-gray-500 mb-3">
        <span>Score: {signal.score}/100</span>
        <span>Confidence: {(signal.confidence * 100).toFixed(0)}%</span>
      </div>
      <button onClick={onTrade} className={`w-full py-3 rounded-lg font-bold transition ${signal.dir === 'long' ? 'bg-green-500 hover:bg-green-400' : 'bg-red-500 hover:bg-red-400'} text-white`}>
        EXECUTE {signal.dir.toUpperCase()}
      </button>
    </Card>
  );
};

const ActiveTradePanel = ({ trade, onClose }) => {
  const pnl = trade.pnl || 0;
  const rMult = trade.rMult || 0;
  const ddPct = Math.max(0, -pnl / trade.entry * 100);
  
  return (
    <Card glow>
      <h3 className="text-sm font-semibold text-orange-400 mb-3 flex items-center gap-2">
        <span className="animate-pulse">🔴</span> Active Trade
        <span className={`ml-auto text-xs px-2 py-0.5 rounded ${trade.phase === 'PROFIT_LOCK' ? 'bg-green-500/20' : trade.phase === 'TRAILING' ? 'bg-blue-500/20' : trade.phase === 'BREAKEVEN' ? 'bg-yellow-500/20' : 'bg-gray-500/20'}`}>
          {trade.phase}
        </span>
      </h3>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-xs text-gray-500">Direction</div>
          <div className={`text-xl font-bold ${trade.dir === 'long' ? 'text-green-400' : 'text-red-400'}`}>
            {trade.dir.toUpperCase()}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Entry</div>
          <div className="text-xl font-bold text-white">{trade.entry.toFixed(2)}</div>
        </div>
      </div>
      <div className={`text-center py-4 rounded-lg mb-4 ${pnl >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
        <div className={`text-3xl font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} pts
        </div>
        <div className="text-sm text-gray-400">{rMult.toFixed(2)}R</div>
        <div className="text-sm text-gray-400">${(pnl * 50).toFixed(2)}</div>
      </div>
      <div className="space-y-2 mb-4">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Current Stop:</span>
          <span className="text-red-400">{trade.currentStop.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Risk (pts):</span>
          <span className="text-gray-300">{trade.risk.toFixed(2)}</span>
        </div>
      </div>
      <div className="mb-4">
        <div className="text-xs text-gray-500 mb-1">Drawdown ({ddPct.toFixed(1)}% / 25% max)</div>
        <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
          <div className={`h-full transition-all duration-300 ${ddPct > 20 ? 'bg-red-500' : ddPct > 10 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, ddPct / 25 * 100)}%` }} />
        </div>
      </div>
      <div className="bg-gray-800/50 rounded-lg p-2 mb-4 max-h-32 overflow-y-auto">
        <div className="text-xs text-gray-500 mb-1">Live Commentary:</div>
        {trade.commentary.slice(-5).map((c, i) => (
          <div key={i} className="text-xs text-gray-300 py-0.5">{c}</div>
        ))}
      </div>
      <button onClick={onClose} className="w-full py-2 rounded-lg font-bold bg-gray-700 hover:bg-gray-600 text-gray-300">
        CLOSE TRADE
      </button>
    </Card>
  );
};

const MLInsightsPanel = ({ weights, patterns }) => (
  <Card>
    <h3 className="text-sm font-semibold text-pink-400 mb-3 flex items-center gap-2">
      <span>🧠</span> ML Adaptive Insights
    </h3>
    <div className="text-xs text-gray-500 mb-2">Feature Weights (Learned):</div>
    <div className="space-y-1 mb-3">
      {Object.entries(weights).slice(0, 6).map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="w-16 text-xs text-gray-500 truncate">{k}</span>
          <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-pink-500 to-purple-500" style={{ width: `${(v / 2) * 100}%` }} />
          </div>
          <span className="text-xs text-gray-400 w-8">{v.toFixed(2)}</span>
        </div>
      ))}
    </div>
    {patterns.length > 0 && (
      <>
        <div className="text-xs text-gray-500 mb-2">Top Patterns:</div>
        {patterns.slice(0, 3).map((p, i) => (
          <div key={i} className="text-xs flex justify-between py-1 border-t border-gray-800">
            <span className="text-gray-400 truncate" style={{maxWidth: '120px'}}>{p.name}</span>
            <span className={p.wr >= 60 ? 'text-green-400' : 'text-yellow-400'}>{p.wr}%</span>
          </div>
        ))}
      </>
    )}
  </Card>
);

const CommentaryFeed = ({ messages }) => (
  <Card>
    <h3 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
      <span>💬</span> Real-Time Commentary
    </h3>
    <div className="space-y-2 max-h-48 overflow-y-auto">
      {messages.slice(-10).map((m, i) => (
        <div key={i} className="text-xs p-2 bg-gray-800/50 rounded border-l-2 border-blue-500/50">
          <span className="text-gray-500">{m.time}</span>
          <span className="text-gray-300 ml-2">{m.text}</span>
        </div>
      ))}
    </div>
  </Card>
);

// Main Dashboard
const TitanOmegaDashboardEnhanced = () => {
  const [spot, setSpot] = useState(5980);
  const [iv, setIv] = useState(0.15);
  const [signal, setSignal] = useState(null);
  const [trade, setTrade] = useState(null);
  const [commentary, setCommentary] = useState([]);
  const [pnlHistory, setPnlHistory] = useState([]);
  const [stats, setStats] = useState({ wins: 0, losses: 0, totalPnL: 0 });
  const [tick, setTick] = useState(0);
  
  // Calculate Greeks and GEX
  const strike = Math.round(spot / 5) * 5;
  const greeks = calculateGreeks(spot, strike, 1/365, 0.05, iv);
  
  // Simple GEX calculation
  const gammaFlip = Math.round(spot / 50) * 50;
  const gex = {
    netGEX: (spot - gammaFlip) * 1e8 + Math.random() * 1e8,
    gammaFlip,
    isPositiveGamma: spot > gammaFlip,
    majorLevels: [
      { strike: gammaFlip, gex: 2e9 },
      { strike: gammaFlip + 25, gex: -1.5e9 },
      { strike: gammaFlip - 25, gex: 1.2e9 },
    ],
  };
  
  // Minervini analysis
  const trendScore = 65 + Math.sin(tick / 10) * 15;
  const stage = trendScore >= 70 ? { stage: 2, name: 'ADVANCING', bias: 'long' } :
                trendScore >= 50 ? { stage: 3, name: 'TOPPING', bias: 'neutral' } :
                { stage: 4, name: 'DECLINING', bias: 'short' };
  const template = {
    valid: trendScore >= 70,
    score: Math.round(trendScore),
    criteria: {
      aboveMA10: trendScore > 60, aboveMA20: trendScore > 55, aboveMA50: trendScore > 50,
      ma10AboveMA20: trendScore > 65, ma20AboveMA50: trendScore > 60,
      nearHigh: trendScore > 70, aboveLow: true, trending: trendScore > 55,
    },
  };
  
  // ML weights (simulated adaptive)
  const mlWeights = {
    momentum: 0.8 + Math.sin(tick / 20) * 0.2,
    volume: 1.1 - Math.sin(tick / 15) * 0.1,
    trend: 1.3 + Math.cos(tick / 25) * 0.2,
    gex: 0.9, pattern: 1.2, time: 0.7,
  };
  
  const mlPatterns = [
    { name: 'THREE_SOLDIERS_2_PG', wr: 68 },
    { name: 'BULL_ENGULF_2_PG', wr: 62 },
    { name: 'HAMMER_2_PG', wr: 58 },
  ];
  
  // Simulate market
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
      setSpot(s => {
        const change = (Math.random() - 0.48) * 3;
        return Math.max(5800, Math.min(6200, s + change));
      });
      setIv(v => Math.max(0.10, Math.min(0.30, v + (Math.random() - 0.5) * 0.01)));
      
      // Generate signals occasionally
      if (Math.random() < 0.02 && !signal && !trade) {
        const dir = Math.random() > 0.5 ? 'long' : 'short';
        const entry = spot;
        const risk = 5 + Math.random() * 3;
        setSignal({
          dir, entry,
          stop: dir === 'long' ? entry - risk : entry + risk,
          tp1: dir === 'long' ? entry + risk * 2 : entry - risk * 2,
          tp2: dir === 'long' ? entry + risk * 3.5 : entry - risk * 3.5,
          tp3: dir === 'long' ? entry + risk * 5 : entry - risk * 5,
          risk, score: 68 + Math.floor(Math.random() * 15),
          confidence: 0.5 + Math.random() * 0.3,
          reasons: ['📈 Stage 2', '🔨 HAMMER', '✅ +Gamma'],
        });
        addCommentary('🎯 New signal detected!');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [spot, signal, trade]);
  
  // Update active trade
  useEffect(() => {
    if (!trade || trade.status !== 'ACTIVE') return;
    
    const pnl = trade.dir === 'long' ? spot - trade.entry : trade.entry - spot;
    const rMult = pnl / trade.risk;
    const ddPct = Math.max(0, -pnl / trade.entry * 100);
    
    let newPhase = trade.phase;
    const newCommentary = [...trade.commentary];
    
    // Check 25% max DD
    if (ddPct >= CONFIG.account.maxDD) {
      addCommentary(`🛑 MAX DD ${CONFIG.account.maxDD}% REACHED - Closing trade`);
      closeTrade(trade, spot, 'MAX_DD');
      return;
    }
    
    // Check stop
    const stopHit = trade.dir === 'long' ? spot <= trade.currentStop : spot >= trade.currentStop;
    if (stopHit) {
      addCommentary(`🛑 Stop hit @ ${trade.currentStop.toFixed(2)}`);
      closeTrade(trade, trade.currentStop, 'STOP');
      return;
    }
    
    // Check targets
    if (rMult >= CONFIG.targets.tp3R) {
      addCommentary('🏆🏆🏆 TP3 HIT! OUTSTANDING!');
      closeTrade(trade, trade.tp3, 'TP3');
      return;
    }
    
    // Update phase
    if (newPhase === 'INITIAL' && rMult >= 1.0) {
      newPhase = 'BREAKEVEN';
      newCommentary.push('🔒 Moved to breakeven!');
      addCommentary('🔒 Risk eliminated - at breakeven');
    }
    if (newPhase === 'BREAKEVEN' && rMult >= 1.5) {
      newPhase = 'TRAILING';
      newCommentary.push('📈 Trailing stop activated');
      addCommentary('📈 Trailing stop now active');
    }
    
    // Update stop
    let newStop = trade.currentStop;
    if (newPhase === 'BREAKEVEN') {
      newStop = trade.entry + (trade.dir === 'long' ? 0.5 : -0.5);
    }
    if (newPhase === 'TRAILING' || newPhase === 'PROFIT_LOCK') {
      const trailStop = trade.dir === 'long' ? spot - trade.risk * 0.5 : spot + trade.risk * 0.5;
      if ((trade.dir === 'long' && trailStop > newStop) || (trade.dir === 'short' && trailStop < newStop)) {
        newStop = trailStop;
      }
    }
    
    setTrade({
      ...trade,
      pnl, rMult, phase: newPhase,
      currentStop: newStop,
      commentary: newCommentary,
    });
  }, [spot, trade]);
  
  const addCommentary = useCallback((text) => {
    setCommentary(c => [...c, { time: new Date().toLocaleTimeString(), text }]);
  }, []);
  
  const executeTrade = () => {
    if (!signal) return;
    const newTrade = {
      ...signal,
      status: 'ACTIVE',
      phase: 'INITIAL',
      currentStop: signal.stop,
      pnl: 0, rMult: 0,
      commentary: [`📊 Entered ${signal.dir.toUpperCase()} @ ${signal.entry.toFixed(2)}`],
    };
    setTrade(newTrade);
    setSignal(null);
    addCommentary(`🚀 Trade executed: ${signal.dir.toUpperCase()} @ ${signal.entry.toFixed(2)}`);
  };
  
  const closeTrade = (t, exitPrice, reason) => {
    const pnl = t.dir === 'long' ? exitPrice - t.entry : t.entry - exitPrice;
    const pnl$ = pnl * 50;
    
    setPnlHistory(h => [...h, { pnl: pnl$, time: new Date() }]);
    setStats(s => ({
      wins: s.wins + (pnl > 0 ? 1 : 0),
      losses: s.losses + (pnl <= 0 ? 1 : 0),
      totalPnL: s.totalPnL + pnl$,
    }));
    
    addCommentary(`${pnl > 0 ? '✅' : '🛑'} Closed ${reason}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} pts ($${pnl$.toFixed(0)})`);
    setTrade(null);
  };
  
  const winRate = stats.wins + stats.losses > 0 ? (stats.wins / (stats.wins + stats.losses) * 100).toFixed(1) : '0.0';
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white p-4">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
          🧠 TITAN OMEGA ENHANCED
        </h1>
        <p className="text-gray-500 text-sm">Karpathy (ML) × Page (Systems) × Minervini (Trading)</p>
      </div>
      
      {/* Top Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <Card>
          <StatCard label="SPX Spot" value={spot.toFixed(2)} color="cyan" />
        </Card>
        <Card>
          <StatCard label="IV" value={(iv * 100).toFixed(1)} unit="%" color="yellow" />
        </Card>
        <Card>
          <StatCard label="Account" value={'$' + (CONFIG.account.size + stats.totalPnL).toFixed(0)} color={stats.totalPnL >= 0 ? 'green' : 'red'} />
        </Card>
        <Card>
          <StatCard label="Day P&L" value={(stats.totalPnL >= 0 ? '+$' : '-$') + Math.abs(stats.totalPnL).toFixed(0)} color={stats.totalPnL >= 0 ? 'green' : 'red'} />
        </Card>
        <Card>
          <StatCard label="Win Rate" value={winRate} unit="%" color="purple" />
        </Card>
        <Card>
          <StatCard label="Trades" value={`${stats.wins}/${stats.losses}`} color="blue" />
        </Card>
      </div>
      
      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column */}
        <div className="space-y-4">
          <GreeksPanel greeks={greeks} />
          <GEXPanel gex={gex} spot={spot} />
        </div>
        
        {/* Middle Column */}
        <div className="space-y-4">
          <MinerviniPanel stage={stage} template={template} />
          {trade ? (
            <ActiveTradePanel trade={trade} onClose={() => closeTrade(trade, spot, 'MANUAL')} />
          ) : (
            <SignalPanel signal={signal} onTrade={executeTrade} />
          )}
        </div>
        
        {/* Right Column */}
        <div className="space-y-4">
          <MLInsightsPanel weights={mlWeights} patterns={mlPatterns} />
          <CommentaryFeed messages={commentary} />
        </div>
      </div>
      
      {/* Footer */}
      <div className="mt-6 text-center text-xs text-gray-600">
        <div>Real Greeks: Δ={greeks.delta.toFixed(3)} | Γ={greeks.gamma.toFixed(5)} | ν={greeks.vega.toFixed(3)} | θ={greeks.theta.toFixed(4)}</div>
        <div>25% Max DD Protection • R-Multiple Targets (2R/3.5R/5R) • Adaptive ML Weights • GEX Analysis</div>
      </div>
    </div>
  );
};

export default TitanOmegaDashboardEnhanced;
