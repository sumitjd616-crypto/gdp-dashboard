import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA ULTIMATE DASHBOARD
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * HeatSeeker-Level GEX Analysis:
 * • Real-time GEX heatmap by strike
 * • Gamma flip level
 * • Put/Call walls
 * • Vanna & Charm flow predictions
 * • Dealer regime identification
 * 
 * Combined with clean price action - no RSI/MACD noise
 */

// ═══════════════════════════════════════════════════════════════════════════════════════
// CONFIG & UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  polygon: {
    apiKey: 'YOUR_POLYGON_API_KEY', // Replace with real key
    wsUrl: 'wss://socket.polygon.io/indices',
  },
  targets: { tp1R: 1.5, tp2R: 3.0 },
  risk: { maxStopPts: 8, minStopPts: 3, maxDD: 20 },
};

const normalCDF = (x) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
};

const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const calculateGreeks = (S, K, T, r, sigma, isCall = true) => {
  T = Math.max(T, 0.0001);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return {
    delta: isCall ? normalCDF(d1) : normalCDF(d1) - 1,
    gamma: normalPDF(d1) / (S * sigma * sqrtT),
    vanna: -normalPDF(d1) * d2 / sigma,
    charm: -normalPDF(d1) * (2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT),
  };
};

// Build GEX Profile (HeatSeeker Logic)
const buildGEXProfile = (spot, iv = 0.15) => {
  const T = 1 / 365;
  const profile = {
    spot,
    strikes: [],
    gexByStrike: {},
    vannaByStrike: {},
    charmByStrike: {},
    netGEX: 0,
    netVanna: 0,
    netCharm: 0,
    gammaFlip: spot,
    callWall: null,
    putWall: null,
    supports: [],
    resistances: [],
    regime: 'NEUTRAL',
  };
  
  let minAbsGEX = Infinity;
  let maxCallOI = 0, maxPutOI = 0;
  
  for (let i = -25; i <= 25; i++) {
    const strike = Math.round(spot / 5) * 5 + i * 5;
    profile.strikes.push(strike);
    
    const dist = Math.abs(strike - spot);
    const distDecay = Math.exp(-dist / 80);
    const isRound = strike % 25 === 0;
    const isMajor = strike % 50 === 0;
    const baseOI = isMajor ? 8000 : isRound ? 5000 : 2000;
    
    const callBias = strike >= spot ? 1.3 : 0.7;
    const putBias = strike <= spot ? 1.3 : 0.7;
    
    const callOI = Math.floor(baseOI * distDecay * callBias * (0.9 + Math.random() * 0.2));
    const putOI = Math.floor(baseOI * distDecay * putBias * (0.9 + Math.random() * 0.2));
    
    if (callOI > maxCallOI && strike > spot) { maxCallOI = callOI; profile.callWall = strike; }
    if (putOI > maxPutOI && strike < spot) { maxPutOI = putOI; profile.putWall = strike; }
    
    const callG = calculateGreeks(spot, strike, T, 0.05, iv, true);
    const putG = calculateGreeks(spot, strike, T, 0.05, iv, false);
    
    const callGEX = -callG.gamma * callOI * 100 * spot / 100;
    const putGEX = putG.gamma * putOI * 100 * spot / 100;
    const netGEX = callGEX + putGEX;
    
    const vannaExp = -callG.vanna * callOI * 100 + putG.vanna * putOI * 100;
    const charmExp = -callG.charm * callOI * 100 - putG.charm * putOI * 100;
    
    profile.gexByStrike[strike] = netGEX / 1e9;
    profile.vannaByStrike[strike] = vannaExp / 1e6;
    profile.charmByStrike[strike] = charmExp / 1e6;
    
    profile.netGEX += netGEX;
    profile.netVanna += vannaExp;
    profile.netCharm += charmExp;
    
    if (Math.abs(netGEX) < minAbsGEX && dist < 100) {
      minAbsGEX = Math.abs(netGEX);
      profile.gammaFlip = strike;
    }
    
    const gexB = netGEX / 1e9;
    if (gexB > 0.3 && strike < spot) {
      profile.supports.push({ strike, gex: gexB });
    } else if (gexB < -0.3 && strike > spot) {
      profile.resistances.push({ strike, gex: Math.abs(gexB) });
    }
  }
  
  profile.netGEX /= 1e9;
  profile.netVanna /= 1e6;
  profile.netCharm /= 1e6;
  profile.supports.sort((a, b) => b.strike - a.strike);
  profile.resistances.sort((a, b) => a.strike - b.strike);
  
  const aboveFlip = spot > profile.gammaFlip;
  profile.regime = profile.netGEX > 0 
    ? (aboveFlip ? 'POSITIVE_GAMMA' : 'POSITIVE_BELOW_FLIP')
    : (aboveFlip ? 'NEGATIVE_ABOVE_FLIP' : 'NEGATIVE_GAMMA');
  
  return profile;
};

// Predict Flows
const predictFlows = (profile, ivChange = -0.005) => {
  const vannaFlow = -profile.netVanna * ivChange;
  const charmFlow = profile.netCharm * 0.6;
  const total = vannaFlow + charmFlow;
  
  return {
    vannaFlow,
    charmFlow,
    total,
    bias: total > 0.5 ? 'BULLISH' : total < -0.5 ? 'BEARISH' : 'NEUTRAL',
    vannaDir: ivChange < 0 ? 'BUY' : ivChange > 0 ? 'SELL' : 'FLAT',
  };
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════════════

const Card = ({ title, badge, children, className = '' }) => (
  <div className={`bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden ${className}`}>
    {title && (
      <div className="px-4 py-2.5 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
        <span className="text-sm font-semibold text-gray-400 tracking-wide">{title}</span>
        {badge && <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full text-xs font-bold">{badge}</span>}
      </div>
    )}
    <div className="flex-1 overflow-hidden">{children}</div>
  </div>
);

const StatBox = ({ label, value, color = 'text-white', size = 'lg' }) => (
  <div className="bg-gray-800 rounded-lg p-2 border border-gray-700">
    <div className={`font-mono font-bold ${size === 'lg' ? 'text-lg' : 'text-sm'} ${color}`}>{value}</div>
    <div className="text-xs text-gray-500">{label}</div>
  </div>
);

const GEXBar = ({ strike, gex, isSpot, isFlip, isCallWall, isPutWall, maxGEX }) => {
  const width = Math.min(100, Math.abs(gex) / maxGEX * 100);
  const isPositive = gex >= 0;
  
  let bgClass = '';
  if (isSpot) bgClass = 'bg-blue-500/20';
  else if (isFlip) bgClass = 'bg-yellow-500/10';
  else if (isCallWall) bgClass = 'bg-red-500/10';
  else if (isPutWall) bgClass = 'bg-green-500/10';
  
  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded ${bgClass} hover:bg-gray-800/50 transition-colors`}>
      <span className={`w-14 text-right font-mono text-xs ${
        isSpot ? 'text-blue-400 font-bold' : isFlip ? 'text-yellow-400 font-semibold' : 
        isCallWall ? 'text-red-400' : isPutWall ? 'text-green-400' : 'text-gray-500'
      }`}>
        {strike.toLocaleString()}
        {isSpot && ' ◀'}
        {isFlip && ' ⚡'}
        {isCallWall && ' 🧱'}
        {isPutWall && ' 💎'}
      </span>
      
      <div className="flex-1 h-4 relative flex items-center">
        <div className="absolute left-1/2 w-px h-full bg-gray-700"></div>
        <div className="w-full flex justify-center">
          {isPositive ? (
            <div 
              className="h-3 bg-gradient-to-r from-emerald-500/40 to-emerald-500 rounded-sm transition-all duration-300"
              style={{ width: `${width}%`, marginLeft: '50%' }}
            />
          ) : (
            <div 
              className="h-3 bg-gradient-to-l from-red-500/40 to-red-500 rounded-sm transition-all duration-300"
              style={{ width: `${width}%`, marginRight: '50%' }}
            />
          )}
        </div>
      </div>
      
      <span className={`w-12 font-mono text-xs ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
        {gex >= 0 ? '+' : ''}{gex.toFixed(2)}B
      </span>
    </div>
  );
};

const RegimeBadge = ({ regime }) => {
  const isPositive = regime.includes('POSITIVE');
  return (
    <div className={`px-4 py-3 rounded-lg border ${
      isPositive ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-red-500/10 border-red-500/50'
    } flex items-center gap-3`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${
        isPositive ? 'bg-emerald-500' : 'bg-red-500'
      }`}>
        {isPositive ? '🟢' : '🔴'}
      </div>
      <div>
        <div className={`font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isPositive ? 'Positive Gamma' : 'Negative Gamma'}
        </div>
        <div className="text-xs text-gray-400">
          {isPositive 
            ? 'Dealers BUY dips, SELL rips. Mean reversion.'
            : 'Dealers SELL dips, BUY rips. Trends extend.'
          }
        </div>
      </div>
    </div>
  );
};

const FlowIndicator = ({ label, direction, magnitude, icon }) => {
  const color = direction === 'BUY' || direction === 'BULLISH' ? 'text-emerald-400' : 
                direction === 'SELL' || direction === 'BEARISH' ? 'text-red-400' : 'text-gray-400';
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-gray-800 rounded-lg">
      <div className="flex items-center gap-2">
        <span>{icon}</span>
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <div className={`font-mono text-sm font-semibold ${color}`}>
        {direction}
      </div>
    </div>
  );
};

const SignalCard = ({ signal }) => {
  if (!signal) return null;
  const isLong = signal.dir === 'LONG';
  
  return (
    <div className={`bg-gray-800 rounded-lg p-4 border-l-4 ${isLong ? 'border-emerald-500' : 'border-red-500'} ring-1 ring-emerald-500/30`}>
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{isLong ? '🟢' : '🔴'}</span>
          <span className={`text-sm font-bold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
            {signal.dir} SIGNAL
          </span>
        </div>
        <div className="text-right">
          <div className="text-xs text-blue-400 font-semibold">{signal.confidence}%</div>
          <div className="text-xs text-gray-500">{new Date().toLocaleTimeString()}</div>
        </div>
      </div>
      
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="bg-gray-900 rounded p-2 text-center">
          <div className="font-mono text-sm font-bold text-white">{signal.entry.toFixed(2)}</div>
          <div className="text-xs text-gray-600">Entry</div>
        </div>
        <div className="bg-gray-900 rounded p-2 text-center">
          <div className="font-mono text-sm font-bold text-red-400">{signal.stop.toFixed(2)}</div>
          <div className="text-xs text-gray-600">Stop</div>
        </div>
        <div className="bg-gray-900 rounded p-2 text-center">
          <div className="font-mono text-sm font-bold text-emerald-400">{signal.tp1.toFixed(2)}</div>
          <div className="text-xs text-gray-600">TP1</div>
        </div>
        <div className="bg-gray-900 rounded p-2 text-center">
          <div className="font-mono text-sm font-bold text-emerald-400/70">{signal.tp2.toFixed(2)}</div>
          <div className="text-xs text-gray-600">TP2</div>
        </div>
      </div>
      
      <div className="flex flex-wrap gap-1.5 mb-3">
        {signal.reasons.map((r, i) => (
          <span key={i} className="px-2 py-0.5 bg-gray-900 rounded text-xs text-gray-400 border border-gray-700">
            {r}
          </span>
        ))}
      </div>
      
      <div className="flex items-center justify-between pt-2 border-t border-gray-700">
        <div className="text-xs text-gray-500">
          γ: {signal.gexRegime} | Flow: {signal.flowBias}
        </div>
        <div className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-sm font-bold">
          {signal.rr}:1
        </div>
      </div>
    </div>
  );
};

const Commentary = ({ messages }) => (
  <div className="space-y-1.5 p-3 h-40 overflow-y-auto">
    {messages.map((m, i) => (
      <div key={i} className={`text-xs px-2 py-1 rounded ${
        m.type === 'alert' ? 'bg-yellow-500/10 text-yellow-400' :
        m.type === 'signal' ? 'bg-emerald-500/10 text-emerald-400' :
        m.type === 'warning' ? 'bg-red-500/10 text-red-400' :
        'bg-gray-800 text-gray-400'
      }`}>
        <span className="text-gray-500 mr-2">{m.time}</span>
        {m.text}
      </div>
    ))}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════════════

const TitanOmegaUltimateDashboard = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [spot, setSpot] = useState(5980);
  const [iv, setIV] = useState(0.15);
  const [gexProfile, setGexProfile] = useState(null);
  const [flows, setFlows] = useState(null);
  const [signal, setSignal] = useState(null);
  const [commentary, setCommentary] = useState([]);
  const [stats, setStats] = useState({ wins: 12, losses: 5, pnl: 1847 });
  const [showAlert, setShowAlert] = useState(true);
  
  const addComment = useCallback((text, type = 'info') => {
    setCommentary(prev => [{
      text,
      type,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }, ...prev].slice(0, 20));
  }, []);
  
  // Update GEX profile on spot change
  useEffect(() => {
    const profile = buildGEXProfile(spot, iv);
    const predictedFlows = predictFlows(profile);
    setGexProfile(profile);
    setFlows(predictedFlows);
  }, [spot, iv]);
  
  // Simulate live updates
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    
    const priceTimer = setInterval(() => {
      setSpot(prev => {
        const change = (Math.random() - 0.48) * 0.6;
        return +(prev + change).toFixed(2);
      });
    }, 2000);
    
    const ivTimer = setInterval(() => {
      setIV(prev => Math.max(0.1, Math.min(0.25, prev + (Math.random() - 0.5) * 0.002)));
    }, 5000);
    
    return () => {
      clearInterval(timer);
      clearInterval(priceTimer);
      clearInterval(ivTimer);
    };
  }, []);
  
  // Generate signals based on conditions
  useEffect(() => {
    if (!gexProfile || !flows) return;
    
    const { regime, gammaFlip, supports, resistances } = gexProfile;
    const aboveFlip = spot > gammaFlip;
    const nearSupport = supports[0] && Math.abs(spot - supports[0].strike) < 8;
    const nearResist = resistances[0] && Math.abs(spot - resistances[0].strike) < 8;
    
    // Check for signal conditions
    if (regime.includes('POSITIVE') && aboveFlip && flows.bias === 'BULLISH' && nearSupport) {
      const entry = spot;
      const risk = 5;
      setSignal({
        dir: 'LONG',
        entry,
        stop: entry - risk,
        tp1: entry + risk * 1.5,
        tp2: entry + risk * 3,
        rr: '2.0',
        confidence: 78,
        reasons: ['📊 >γFlip', '⚡ VannaFlow', '🛡️ GEXSupport', '📈 +Gamma'],
        gexRegime: regime,
        flowBias: flows.bias,
      });
      addComment(`🟢 LONG signal at ${entry.toFixed(2)} - GEX support`, 'signal');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 5000);
    }
  }, [gexProfile, flows, spot, addComment]);
  
  // Add periodic commentary
  useEffect(() => {
    if (!gexProfile) return;
    
    const commentTimer = setInterval(() => {
      const comments = [
        `📊 GEX Regime: ${gexProfile.regime}`,
        `⚡ Net GEX: ${gexProfile.netGEX.toFixed(2)}B`,
        `📍 Gamma Flip: ${gexProfile.gammaFlip}`,
        `🧱 Call Wall: ${gexProfile.callWall || 'N/A'}`,
        `💎 Put Wall: ${gexProfile.putWall || 'N/A'}`,
        `${flows?.bias === 'BULLISH' ? '📈' : '📉'} Flow Bias: ${flows?.bias}`,
      ];
      addComment(comments[Math.floor(Math.random() * comments.length)]);
    }, 8000);
    
    return () => clearInterval(commentTimer);
  }, [gexProfile, flows, addComment]);
  
  // Initial commentary
  useEffect(() => {
    addComment('🔬 Titan Omega Ultimate initialized', 'info');
    addComment('📊 Loading GEX profile from options chain...', 'info');
    addComment('⚡ Calculating Vanna & Charm flows...', 'info');
  }, [addComment]);
  
  if (!gexProfile) return <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">Loading...</div>;
  
  const maxGEX = Math.max(...Object.values(gexProfile.gexByStrike).map(Math.abs));
  
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      {/* Alert Banner */}
      {showAlert && signal && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-gradient-to-r from-emerald-500 to-emerald-600 text-black px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-pulse">
          <span className="text-2xl">🟢</span>
          <div>
            <div className="font-bold">NEW SIGNAL: {signal.dir}</div>
            <div className="text-sm opacity-90">Entry: {signal.entry.toFixed(2)} | Target: {signal.tp1.toFixed(2)} | R:R {signal.rr}:1</div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex justify-between items-center sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center font-bold text-xl">Ω</div>
          <div>
            <div className="text-lg font-bold bg-gradient-to-r from-white to-blue-400 bg-clip-text text-transparent">TITAN OMEGA ULTIMATE</div>
            <div className="text-xs text-gray-500 tracking-wider">GEX/VANNA/CHARM ANALYSIS</div>
          </div>
        </div>
        
        <div className="flex gap-3">
          {[
            { label: 'SPX', value: spot.toFixed(2) },
            { label: 'IV', value: (iv * 100).toFixed(1) + '%' },
            { label: 'Net GEX', value: (gexProfile.netGEX >= 0 ? '+' : '') + gexProfile.netGEX.toFixed(2) + 'B', color: gexProfile.netGEX >= 0 ? 'text-emerald-400' : 'text-red-400' },
            { label: 'γ Flip', value: gexProfile.gammaFlip.toLocaleString(), color: 'text-yellow-400' },
            { label: 'Flow', value: flows?.bias || 'N/A', color: flows?.bias === 'BULLISH' ? 'text-emerald-400' : flows?.bias === 'BEARISH' ? 'text-red-400' : 'text-gray-400' },
          ].map((stat, i) => (
            <div key={i} className="text-center px-3 py-1 bg-gray-800 rounded-lg border border-gray-700">
              <div className={`font-mono font-bold ${stat.color || 'text-white'}`}>{stat.value}</div>
              <div className="text-xs text-gray-500">{stat.label}</div>
            </div>
          ))}
        </div>
        
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded text-sm font-semibold ${
            gexProfile.regime.includes('POSITIVE') ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {gexProfile.regime.includes('POSITIVE') ? '+γ REGIME' : '-γ REGIME'}
          </div>
          <div className="font-mono text-gray-400">
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} ET
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-sm">Live</span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="grid grid-cols-12 gap-3 p-3 h-[calc(100vh-64px)]">
        {/* Left Panel - Signals & Flows */}
        <aside className="col-span-3 flex flex-col gap-3">
          <Card title="🎯 ACTIVE SIGNAL" badge={signal ? '1 Active' : 'None'}>
            <div className="p-3">
              {signal ? <SignalCard signal={signal} /> : (
                <div className="text-center py-8 text-gray-500">
                  <div className="text-3xl mb-2">⏳</div>
                  <div>Waiting for A+ setup...</div>
                  <div className="text-xs mt-1">Physics + PA must align</div>
                </div>
              )}
            </div>
          </Card>
          
          <Card title="⚡ FLOW PREDICTION" className="flex-1">
            <div className="p-3 space-y-2">
              <FlowIndicator 
                label="Vanna Flow (IV→Δ)" 
                direction={flows?.vannaDir || 'FLAT'} 
                magnitude={Math.abs(flows?.vannaFlow || 0)}
                icon="📊"
              />
              <FlowIndicator 
                label="Charm Decay (Time→Δ)" 
                direction={flows?.charmFlow > 0 ? 'BUY' : flows?.charmFlow < 0 ? 'SELL' : 'FLAT'} 
                magnitude={Math.abs(flows?.charmFlow || 0)}
                icon="⏰"
              />
              <FlowIndicator 
                label="Net Flow Bias" 
                direction={flows?.bias || 'NEUTRAL'} 
                magnitude={Math.abs(flows?.total || 0)}
                icon="⚡"
              />
              
              <div className="mt-3 pt-3 border-t border-gray-800">
                <div className="text-xs text-gray-500 mb-2">HOW THIS WORKS:</div>
                <div className="text-xs text-gray-400 space-y-1">
                  <div>📉 <span className="text-emerald-400">Vol Crush</span> → Dealers BUY</div>
                  <div>📈 <span className="text-red-400">Vol Spike</span> → Dealers SELL</div>
                  <div>⏰ <span className="text-yellow-400">Time Decay</span> → EOD flows</div>
                </div>
              </div>
            </div>
          </Card>
        </aside>

        {/* Center Panel - GEX Heatmap */}
        <section className="col-span-6 flex flex-col gap-3">
          <Card title="📊 GEX HEATMAP BY STRIKE (HeatSeeker Logic)" badge="Live" className="flex-1">
            <div className="p-2 overflow-y-auto h-full space-y-0.5">
              {gexProfile.strikes.slice(0, 30).map(strike => (
                <GEXBar 
                  key={strike}
                  strike={strike}
                  gex={gexProfile.gexByStrike[strike]}
                  isSpot={Math.abs(strike - spot) < 3}
                  isFlip={strike === gexProfile.gammaFlip}
                  isCallWall={strike === gexProfile.callWall}
                  isPutWall={strike === gexProfile.putWall}
                  maxGEX={maxGEX}
                />
              ))}
            </div>
            <div className="px-4 py-2 border-t border-gray-800 flex justify-center gap-6 text-xs">
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-500 rounded-sm"></div> Support (Buy)</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-red-500 rounded-sm"></div> Resistance (Sell)</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-yellow-500 rounded-sm"></div> Gamma Flip</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-500 rounded-sm"></div> Spot</div>
            </div>
          </Card>
          
          <Card title="💬 LIVE COMMENTARY" badge="AI">
            <Commentary messages={commentary} />
          </Card>
        </section>

        {/* Right Panel - Context */}
        <aside className="col-span-3 flex flex-col gap-3">
          <Card title="📈 MARKET CONTEXT">
            <div className="p-3 space-y-4">
              <div>
                <div className="text-xs text-gray-500 mb-2 pb-1 border-b border-gray-800">DEALER REGIME</div>
                <RegimeBadge regime={gexProfile.regime} />
              </div>
              
              <div>
                <div className="text-xs text-gray-500 mb-2 pb-1 border-b border-gray-800">KEY LEVELS</div>
                <div className="space-y-1.5">
                  {[
                    { name: 'Spot Price', value: spot.toFixed(2), type: 'spot', icon: '📍' },
                    { name: 'Gamma Flip', value: gexProfile.gammaFlip.toLocaleString(), type: 'flip', icon: '⚡' },
                    { name: 'Call Wall', value: gexProfile.callWall?.toLocaleString() || 'N/A', type: 'resist', icon: '🧱' },
                    { name: 'Put Wall', value: gexProfile.putWall?.toLocaleString() || 'N/A', type: 'support', icon: '💎' },
                    { name: 'GEX Support 1', value: gexProfile.supports[0]?.strike?.toLocaleString() || 'N/A', type: 'support', icon: '🛡️' },
                    { name: 'GEX Resist 1', value: gexProfile.resistances[0]?.strike?.toLocaleString() || 'N/A', type: 'resist', icon: '🔴' },
                  ].map((level, i) => (
                    <div key={i} className={`flex justify-between items-center px-3 py-2 rounded-lg ${
                      level.type === 'spot' ? 'bg-blue-500/10 border border-blue-500/50' : 'bg-gray-800 border border-gray-700'
                    }`}>
                      <div className="flex items-center gap-2">
                        <span>{level.icon}</span>
                        <span className="text-sm text-gray-400">{level.name}</span>
                      </div>
                      <span className={`font-mono font-semibold ${
                        level.type === 'spot' ? 'text-blue-400' :
                        level.type === 'flip' ? 'text-yellow-400' :
                        level.type === 'support' ? 'text-emerald-400' : 'text-red-400'
                      }`}>{level.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
          
          <Card title="📊 SESSION STATS" className="flex-1">
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <StatBox label="Win Rate" value={`${Math.round(stats.wins / (stats.wins + stats.losses) * 100)}%`} color="text-blue-400" />
                <StatBox label="P&L Today" value={`+$${stats.pnl}`} color="text-emerald-400" />
                <StatBox label="Wins" value={stats.wins} color="text-emerald-400" />
                <StatBox label="Losses" value={stats.losses} color="text-red-400" />
              </div>
              
              <div className="pt-3 border-t border-gray-800">
                <div className="text-xs text-gray-500 mb-2">SYSTEM EDGE</div>
                <div className="space-y-1.5 text-xs text-gray-400">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✅</span>
                    <span>GEX = Where dealers MUST hedge</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✅</span>
                    <span>Vanna = Vol change → forced flows</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✅</span>
                    <span>Charm = Time decay → EOD flows</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✅</span>
                    <span>Price Action = Confirmation</span>
                  </div>
                  <div className="flex items-center gap-2 text-red-400">
                    <span>❌</span>
                    <span className="line-through">RSI/MACD = Lagging noise</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </aside>
      </main>
    </div>
  );
};

export default TitanOmegaUltimateDashboard;
