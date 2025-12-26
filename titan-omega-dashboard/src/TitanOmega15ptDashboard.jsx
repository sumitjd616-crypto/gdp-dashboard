import React, { useState, useEffect, useCallback } from 'react';

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA - 15+ POINT MOVE DETECTOR DASHBOARD
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Identifies 15+ point SPX moves BEFORE they happen using:
 * • GEX levels (gamma flip, put/call walls)
 * • Momentum confirmation
 * • Prime time windows
 * • Volume surges
 */

// Black-Scholes
const normalCDF = (x) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1.0 / (1.0 + p * Math.abs(x) / Math.sqrt(2));
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1.0 + sign * y);
};
const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

// Build GEX Profile
const buildGEX = (spot, iv = 0.15) => {
  const T = 1 / 365;
  const profile = {
    spot, netGEX: 0, gammaFlip: spot,
    callWall: null, putWall: null,
    gexByStrike: {}, regime: 'NEUTRAL',
  };
  
  let minAbsGEX = Infinity, maxCallOI = 0, maxPutOI = 0;
  
  for (let i = -25; i <= 25; i++) {
    const K = Math.round(spot / 5) * 5 + i * 5;
    const dist = Math.abs(K - spot);
    const decay = Math.exp(-dist / 75);
    const isMajor = K % 50 === 0;
    const baseOI = isMajor ? 8000 : K % 25 === 0 ? 5000 : 2500;
    
    const callOI = Math.floor(baseOI * decay * (K >= spot ? 1.3 : 0.7) * (0.85 + Math.random() * 0.3));
    const putOI = Math.floor(baseOI * decay * (K <= spot ? 1.3 : 0.7) * (0.85 + Math.random() * 0.3));
    
    if (callOI > maxCallOI && K > spot) { maxCallOI = callOI; profile.callWall = K; }
    if (putOI > maxPutOI && K < spot) { maxPutOI = putOI; profile.putWall = K; }
    
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(spot / K) + (0.05 + 0.5 * iv * iv) * T) / (iv * sqrtT);
    const gamma = normalPDF(d1) / (spot * iv * sqrtT);
    
    const netGEX = (-gamma * callOI + gamma * putOI) * 100 * spot / 100;
    profile.gexByStrike[K] = netGEX / 1e9;
    profile.netGEX += netGEX;
    
    if (Math.abs(netGEX) < minAbsGEX && dist < 50) {
      minAbsGEX = Math.abs(netGEX);
      profile.gammaFlip = K;
    }
  }
  
  profile.netGEX /= 1e9;
  const aboveFlip = spot > profile.gammaFlip;
  profile.regime = profile.netGEX > 0.3 ? (aboveFlip ? '+γ' : '+γ<Flip') :
                   profile.netGEX < -0.3 ? (aboveFlip ? '-γ>Flip' : '-γ') : 'γ≈0';
  
  return profile;
};

// UI Components
const Card = ({ title, badge, color = 'blue', children, className = '' }) => (
  <div className={`bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden ${className}`}>
    {title && (
      <div className="px-4 py-2.5 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
        <span className="text-sm font-semibold text-gray-400">{title}</span>
        {badge && <span className={`px-2 py-0.5 bg-${color}-500/20 text-${color}-400 rounded-full text-xs font-bold`}>{badge}</span>}
      </div>
    )}
    <div className="flex-1 overflow-hidden">{children}</div>
  </div>
);

const StatBox = ({ label, value, color = 'white', large = false }) => (
  <div className="bg-gray-800 rounded-lg p-2.5 border border-gray-700">
    <div className={`font-mono font-bold ${large ? 'text-xl' : 'text-lg'} text-${color}`}>{value}</div>
    <div className="text-xs text-gray-500">{label}</div>
  </div>
);

const GEXBar = ({ strike, gex, spot, gammaFlip, callWall, putWall, maxGEX }) => {
  const isSpot = Math.abs(strike - spot) < 3;
  const isFlip = strike === gammaFlip;
  const isCallWall = strike === callWall;
  const isPutWall = strike === putWall;
  const width = Math.min(100, Math.abs(gex) / maxGEX * 100);
  const isPos = gex >= 0;
  
  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded ${
      isSpot ? 'bg-blue-500/20' : isFlip ? 'bg-yellow-500/10' : isCallWall ? 'bg-red-500/10' : isPutWall ? 'bg-green-500/10' : ''
    }`}>
      <span className={`w-16 text-right font-mono text-xs ${
        isSpot ? 'text-blue-400 font-bold' : isFlip ? 'text-yellow-400' : isCallWall ? 'text-red-400' : isPutWall ? 'text-green-400' : 'text-gray-500'
      }`}>
        {strike}
        {isSpot && ' ◀'}{isFlip && ' ⚡'}{isCallWall && ' 🧱'}{isPutWall && ' 💎'}
      </span>
      <div className="flex-1 h-4 relative flex items-center">
        <div className="absolute left-1/2 w-px h-full bg-gray-700"></div>
        <div className="w-full flex justify-center">
          {isPos ? (
            <div className="h-3 bg-gradient-to-r from-emerald-500/40 to-emerald-500 rounded-sm" style={{ width: `${width}%`, marginLeft: '50%' }}/>
          ) : (
            <div className="h-3 bg-gradient-to-l from-red-500/40 to-red-500 rounded-sm" style={{ width: `${width}%`, marginRight: '50%' }}/>
          )}
        </div>
      </div>
      <span className={`w-10 font-mono text-xs ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
        {gex >= 0 ? '+' : ''}{gex.toFixed(1)}
      </span>
    </div>
  );
};

const MoveReadinessGauge = ({ value, potentialMove }) => {
  const color = value >= 80 ? 'emerald' : value >= 60 ? 'yellow' : value >= 40 ? 'orange' : 'gray';
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-gray-400">Move Readiness</span>
        <span className={`text-2xl font-bold text-${color}-400`}>{value}%</span>
      </div>
      <div className="h-3 bg-gray-700 rounded-full overflow-hidden mb-2">
        <div className={`h-full bg-gradient-to-r from-${color}-600 to-${color}-400 transition-all duration-500`} style={{ width: `${value}%` }}/>
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-gray-500">Low</span>
        <span className={`text-${color}-400 font-semibold`}>
          {value >= 80 ? '🔥 HIGH - Big Move Likely!' : value >= 60 ? '⚡ ELEVATED' : value >= 40 ? '👀 Watching' : '😴 Quiet'}
        </span>
        <span className="text-gray-500">High</span>
      </div>
      {potentialMove && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <div className="text-xs text-gray-500">Potential Move Direction</div>
          <div className={`text-lg font-bold ${potentialMove.dir === 'UP' ? 'text-emerald-400' : potentialMove.dir === 'DOWN' ? 'text-red-400' : 'text-gray-400'}`}>
            {potentialMove.dir === 'UP' ? '📈 BULLISH' : potentialMove.dir === 'DOWN' ? '📉 BEARISH' : '↔️ NEUTRAL'}
          </div>
          <div className="text-xs text-gray-400 mt-1">{potentialMove.reason}</div>
        </div>
      )}
    </div>
  );
};

const SignalAlert = ({ signal, onDismiss }) => {
  if (!signal) return null;
  const isLong = signal.dir === 'LONG';
  
  return (
    <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-6 py-4 rounded-xl shadow-2xl border-2 max-w-lg ${
      isLong ? 'bg-emerald-900/95 border-emerald-500' : 'bg-red-900/95 border-red-500'
    }`}>
      <div className="flex items-start gap-4">
        <div className="text-4xl">{isLong ? '🟢' : '🔴'}</div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xl font-bold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
              {signal.type.replace(/_/g, ' ')}
            </span>
            <span className="text-xs px-2 py-0.5 bg-white/10 rounded">{signal.conf}% conf</span>
          </div>
          <div className="text-sm text-gray-300 mb-3">{signal.reason}</div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="text-center">
              <div className="text-xs text-gray-400">Entry</div>
              <div className="font-mono font-bold text-white">{signal.entry.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">Stop</div>
              <div className="font-mono font-bold text-red-400">{signal.stop.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">TP1 (15pt)</div>
              <div className="font-mono font-bold text-emerald-400">{signal.tp1.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">TP2 (25pt)</div>
              <div className="font-mono font-bold text-emerald-400/70">{signal.tp2.toFixed(2)}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {signal.tags.map((t, i) => (
              <span key={i} className="px-2 py-0.5 bg-white/10 rounded text-xs">{t}</span>
            ))}
          </div>
        </div>
        <button onClick={onDismiss} className="text-gray-400 hover:text-white text-xl">×</button>
      </div>
    </div>
  );
};

const LevelCard = ({ icon, name, value, dist, type }) => {
  const colors = {
    spot: 'blue', flip: 'yellow', callWall: 'red', putWall: 'green', support: 'emerald', resist: 'red'
  };
  const c = colors[type] || 'gray';
  
  return (
    <div className={`flex justify-between items-center px-3 py-2.5 rounded-lg bg-${c}-500/10 border border-${c}-500/30`}>
      <div className="flex items-center gap-2">
        <span>{icon}</span>
        <span className="text-sm text-gray-400">{name}</span>
      </div>
      <div className="text-right">
        <div className={`font-mono font-semibold text-${c}-400`}>{value}</div>
        {dist !== undefined && <div className="text-xs text-gray-500">{dist > 0 ? '+' : ''}{dist.toFixed(1)} pts</div>}
      </div>
    </div>
  );
};

// Main Dashboard
const TitanOmega15ptDashboard = () => {
  const [time, setTime] = useState(new Date());
  const [spot, setSpot] = useState(5985);
  const [iv, setIV] = useState(0.15);
  const [gex, setGex] = useState(null);
  const [momentum, setMomentum] = useState({ dir: 'FLAT', bars: 0 });
  const [volume, setVolume] = useState({ ratio: 1.0, surge: false });
  const [moveReadiness, setMoveReadiness] = useState(45);
  const [potentialMove, setPotentialMove] = useState(null);
  const [signal, setSignal] = useState(null);
  const [commentary, setCommentary] = useState([]);
  const [stats, setStats] = useState({ signals: 12, wins: 7, bigWins: 2, pnl: 892 });
  
  const addComment = useCallback((text, type = 'info') => {
    setCommentary(prev => [{
      text, type,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }, ...prev].slice(0, 15));
  }, []);
  
  // Update GEX on spot change
  useEffect(() => {
    const profile = buildGEX(spot, iv);
    setGex(profile);
    
    // Calculate move readiness
    const distFlip = Math.abs(spot - profile.gammaFlip);
    const distCallWall = profile.callWall ? profile.callWall - spot : 999;
    const distPutWall = profile.putWall ? spot - profile.putWall : 999;
    
    let readiness = 30;
    if (distFlip < 10) readiness += 25;
    else if (distFlip < 20) readiness += 15;
    if (distCallWall < 15 || distPutWall < 15) readiness += 20;
    if (profile.netGEX < -0.3) readiness += 15;
    if (volume.surge) readiness += 15;
    if (momentum.dir.includes('STRONG')) readiness += 10;
    
    setMoveReadiness(Math.min(100, readiness));
    
    // Determine potential move direction
    let dir = 'NEUTRAL', reason = 'Awaiting momentum confirmation';
    if (spot > profile.gammaFlip && momentum.dir.includes('UP')) {
      dir = 'UP';
      reason = `Above γ-flip ${profile.gammaFlip}, momentum bullish`;
    } else if (spot < profile.gammaFlip && momentum.dir.includes('DOWN')) {
      dir = 'DOWN';
      reason = `Below γ-flip ${profile.gammaFlip}, momentum bearish`;
    } else if (distCallWall < 10 && momentum.dir.includes('UP')) {
      dir = 'UP';
      reason = `Approaching call wall ${profile.callWall}, breakout setup`;
    } else if (distPutWall < 10 && momentum.dir.includes('DOWN')) {
      dir = 'DOWN';
      reason = `Approaching put wall ${profile.putWall}, breakdown setup`;
    }
    setPotentialMove({ dir, reason });
  }, [spot, iv, momentum, volume]);
  
  // Simulate updates
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    
    const priceTimer = setInterval(() => {
      setSpot(prev => {
        const change = (Math.random() - 0.48) * 0.8;
        return +(prev + change).toFixed(2);
      });
    }, 1500);
    
    const momentumTimer = setInterval(() => {
      const dirs = ['STRONG_UP', 'UP', 'FLAT', 'FLAT', 'DOWN', 'STRONG_DOWN'];
      const newDir = Math.random() < 0.15 ? dirs[Math.floor(Math.random() * dirs.length)] : momentum.dir;
      setMomentum({ dir: newDir, bars: Math.floor(Math.random() * 6) + 1 });
    }, 3000);
    
    const volumeTimer = setInterval(() => {
      const ratio = 0.8 + Math.random() * 1.5;
      setVolume({ ratio, surge: ratio > 2, high: ratio > 1.4 });
    }, 4000);
    
    return () => {
      clearInterval(timer);
      clearInterval(priceTimer);
      clearInterval(momentumTimer);
      clearInterval(volumeTimer);
    };
  }, [momentum.dir]);
  
  // Generate signals
  useEffect(() => {
    if (!gex || moveReadiness < 70) return;
    
    const distCallWall = gex.callWall ? gex.callWall - spot : 999;
    const distPutWall = gex.putWall ? spot - gex.putWall : 999;
    const distFlip = spot - gex.gammaFlip;
    
    // Check for signal conditions
    if (momentum.dir.includes('UP') && volume.high) {
      if (distCallWall < 12 && distCallWall > 3) {
        setSignal({
          type: 'CALL_WALL_BREAK',
          dir: 'LONG',
          entry: spot,
          stop: spot - 7,
          tp1: spot + 15,
          tp2: spot + 25,
          conf: 72,
          reason: `Breaking toward call wall ${gex.callWall} - dealer buying cascade`,
          tags: ['🧱 Wall Break', `📊 ${gex.regime}`, '📈 Momentum', volume.surge ? '🔊 Surge' : '📈 Vol'],
        });
        addComment(`🟢 SIGNAL: Call Wall Break - Entry ${spot.toFixed(2)}`, 'signal');
      } else if (distPutWall < 8) {
        setSignal({
          type: 'PUT_WALL_BOUNCE',
          dir: 'LONG',
          entry: spot,
          stop: spot - 7,
          tp1: spot + 15,
          tp2: spot + 25,
          conf: 68,
          reason: `Bouncing off put wall ${gex.putWall} - GEX support`,
          tags: ['💎 Support', `📊 ${gex.regime}`, '📈 Momentum'],
        });
        addComment(`🟢 SIGNAL: Put Wall Bounce - Entry ${spot.toFixed(2)}`, 'signal');
      }
    }
    
    if (momentum.dir.includes('DOWN') && volume.high) {
      if (distPutWall < 12 && distPutWall > 3) {
        setSignal({
          type: 'PUT_WALL_BREAK',
          dir: 'SHORT',
          entry: spot,
          stop: spot + 7,
          tp1: spot - 15,
          tp2: spot - 25,
          conf: 65,
          reason: `Breaking put wall ${gex.putWall} - dealer selling cascade`,
          tags: ['💎 Wall Break', `📊 ${gex.regime}`, '📉 Momentum'],
        });
        addComment(`🔴 SIGNAL: Put Wall Break - Entry ${spot.toFixed(2)}`, 'signal');
      }
    }
  }, [gex, spot, momentum, volume, moveReadiness, addComment]);
  
  // Periodic commentary
  useEffect(() => {
    if (!gex) return;
    const timer = setInterval(() => {
      const comments = [
        `📊 GEX Regime: ${gex.regime} | Net: ${gex.netGEX.toFixed(2)}B`,
        `⚡ Gamma Flip: ${gex.gammaFlip} | Spot ${spot > gex.gammaFlip ? 'ABOVE' : 'BELOW'}`,
        `🧱 Call Wall: ${gex.callWall} (${(gex.callWall - spot).toFixed(1)} pts away)`,
        `💎 Put Wall: ${gex.putWall} (${(spot - gex.putWall).toFixed(1)} pts away)`,
        `🔥 Move Readiness: ${moveReadiness}%`,
        `📈 Momentum: ${momentum.dir} | Volume: ${volume.ratio.toFixed(1)}x`,
      ];
      addComment(comments[Math.floor(Math.random() * comments.length)]);
    }, 6000);
    return () => clearInterval(timer);
  }, [gex, spot, moveReadiness, momentum, volume, addComment]);
  
  // Initial commentary
  useEffect(() => {
    addComment('🎯 Titan Omega 15pt Move Detector initialized');
    addComment('📊 Building GEX profile from options data...');
    addComment('⏳ Scanning for big move setups...');
  }, [addComment]);
  
  const getTimeWindow = () => {
    const h = time.getHours() + time.getMinutes() / 60;
    if (h >= 9.5 && h < 10.25) return { name: 'OPENING DRIVE', quality: 100, icon: '🌅' };
    if (h >= 10.25 && h < 11.25) return { name: 'MID-MORNING', quality: 70, icon: '☀️' };
    if (h >= 11.25 && h < 14) return { name: 'LUNCH (Avoid)', quality: 0, icon: '😴' };
    if (h >= 14 && h < 15) return { name: 'AFTERNOON', quality: 60, icon: '🌤️' };
    if (h >= 15 && h < 15.75) return { name: 'POWER HOUR', quality: 95, icon: '⚡' };
    return { name: 'CLOSE', quality: 50, icon: '🌙' };
  };
  
  const timeWindow = getTimeWindow();
  if (!gex) return <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">Loading...</div>;
  
  const maxGEX = Math.max(...Object.values(gex.gexByStrike).map(Math.abs), 0.1);
  const strikes = Object.keys(gex.gexByStrike).map(Number).sort((a, b) => b - a);
  
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <SignalAlert signal={signal} onDismiss={() => setSignal(null)} />
      
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex justify-between items-center sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center font-bold text-xl">🎯</div>
          <div>
            <div className="text-lg font-bold bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-transparent">TITAN OMEGA 15pt</div>
            <div className="text-xs text-gray-500">BIG MOVE DETECTOR</div>
          </div>
        </div>
        
        <div className="flex gap-3">
          <StatBox label="SPX" value={spot.toFixed(2)} />
          <StatBox label="Net GEX" value={`${gex.netGEX >= 0 ? '+' : ''}${gex.netGEX.toFixed(2)}B`} color={gex.netGEX >= 0 ? 'emerald-400' : 'red-400'} />
          <StatBox label="γ Flip" value={gex.gammaFlip} color="yellow-400" />
          <StatBox label="Readiness" value={`${moveReadiness}%`} color={moveReadiness >= 70 ? 'emerald-400' : moveReadiness >= 50 ? 'yellow-400' : 'gray-400'} />
        </div>
        
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded text-sm font-semibold ${
            timeWindow.quality >= 70 ? 'bg-emerald-500/20 text-emerald-400' : 
            timeWindow.quality >= 40 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {timeWindow.icon} {timeWindow.name}
          </div>
          <div className="font-mono text-gray-400">
            {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-sm">Live</span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="grid grid-cols-12 gap-3 p-3 h-[calc(100vh-64px)]">
        {/* Left - Move Readiness */}
        <aside className="col-span-3 flex flex-col gap-3">
          <Card title="🎯 MOVE READINESS">
            <div className="p-3">
              <MoveReadinessGauge value={moveReadiness} potentialMove={potentialMove} />
            </div>
          </Card>
          
          <Card title="📈 MOMENTUM" className="flex-1">
            <div className="p-3 space-y-3">
              <div className={`text-center py-4 rounded-lg ${
                momentum.dir.includes('UP') ? 'bg-emerald-500/10 border border-emerald-500/30' :
                momentum.dir.includes('DOWN') ? 'bg-red-500/10 border border-red-500/30' : 'bg-gray-800'
              }`}>
                <div className="text-3xl mb-1">
                  {momentum.dir === 'STRONG_UP' ? '🚀' : momentum.dir === 'UP' ? '📈' :
                   momentum.dir === 'STRONG_DOWN' ? '💧' : momentum.dir === 'DOWN' ? '📉' : '➖'}
                </div>
                <div className={`text-lg font-bold ${
                  momentum.dir.includes('UP') ? 'text-emerald-400' :
                  momentum.dir.includes('DOWN') ? 'text-red-400' : 'text-gray-400'
                }`}>
                  {momentum.dir.replace('_', ' ')}
                </div>
                <div className="text-xs text-gray-500">{momentum.bars} consecutive bars</div>
              </div>
              
              <div className={`text-center py-3 rounded-lg ${
                volume.surge ? 'bg-orange-500/10 border border-orange-500/30' :
                volume.high ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-gray-800'
              }`}>
                <div className="text-xs text-gray-500 mb-1">Volume</div>
                <div className={`text-xl font-bold font-mono ${
                  volume.surge ? 'text-orange-400' : volume.high ? 'text-blue-400' : 'text-gray-400'
                }`}>
                  {volume.ratio.toFixed(1)}x {volume.surge && '🔊'}
                </div>
                <div className="text-xs text-gray-500">
                  {volume.surge ? 'SURGE!' : volume.high ? 'Above Avg' : 'Normal'}
                </div>
              </div>
            </div>
          </Card>
        </aside>

        {/* Center - GEX Heatmap */}
        <section className="col-span-6 flex flex-col gap-3">
          <Card title="📊 GEX HEATMAP - Key Levels for 15pt Moves" badge="Live" className="flex-1">
            <div className="p-2 overflow-y-auto h-full space-y-0.5">
              {strikes.slice(0, 25).map(strike => (
                <GEXBar
                  key={strike}
                  strike={strike}
                  gex={gex.gexByStrike[strike]}
                  spot={spot}
                  gammaFlip={gex.gammaFlip}
                  callWall={gex.callWall}
                  putWall={gex.putWall}
                  maxGEX={maxGEX}
                />
              ))}
            </div>
            <div className="px-4 py-2 border-t border-gray-800 flex justify-center gap-6 text-xs">
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-500 rounded"></div> Support</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-red-500 rounded"></div> Resistance</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-yellow-500 rounded"></div> γ Flip</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-500 rounded"></div> Spot</div>
            </div>
          </Card>
          
          <Card title="💬 LIVE ANALYSIS">
            <div className="p-2 h-36 overflow-y-auto space-y-1">
              {commentary.map((c, i) => (
                <div key={i} className={`text-xs px-2 py-1 rounded ${
                  c.type === 'signal' ? 'bg-emerald-500/10 text-emerald-400' :
                  c.type === 'alert' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-gray-800 text-gray-400'
                }`}>
                  <span className="text-gray-500 mr-2">{c.time}</span>{c.text}
                </div>
              ))}
            </div>
          </Card>
        </section>

        {/* Right - Key Levels & Stats */}
        <aside className="col-span-3 flex flex-col gap-3">
          <Card title="🎯 KEY LEVELS">
            <div className="p-3 space-y-2">
              <LevelCard icon="📍" name="Spot Price" value={spot.toFixed(2)} type="spot" />
              <LevelCard icon="⚡" name="Gamma Flip" value={gex.gammaFlip} dist={spot - gex.gammaFlip} type="flip" />
              <LevelCard icon="🧱" name="Call Wall" value={gex.callWall || 'N/A'} dist={gex.callWall ? gex.callWall - spot : undefined} type="callWall" />
              <LevelCard icon="💎" name="Put Wall" value={gex.putWall || 'N/A'} dist={gex.putWall ? spot - gex.putWall : undefined} type="putWall" />
            </div>
          </Card>
          
          <Card title="📊 SESSION STATS">
            <div className="p-3 grid grid-cols-2 gap-2">
              <StatBox label="Signals" value={stats.signals} />
              <StatBox label="Wins" value={stats.wins} color="emerald-400" />
              <StatBox label="15pt Wins" value={stats.bigWins} color="yellow-400" />
              <StatBox label="P&L" value={`+$${stats.pnl}`} color="emerald-400" />
            </div>
          </Card>
          
          <Card title="💡 HOW IT WORKS" className="flex-1">
            <div className="p-3 text-xs space-y-2 text-gray-400">
              <div className="flex items-start gap-2">
                <span className="text-emerald-400">✓</span>
                <span><b className="text-white">GEX</b> shows WHERE dealers must hedge</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-400">✓</span>
                <span><b className="text-white">Gamma Flip</b> = regime boundary</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-400">✓</span>
                <span><b className="text-white">Call/Put Walls</b> = major S/R</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-400">✓</span>
                <span><b className="text-white">Momentum + Volume</b> = timing</span>
              </div>
              <div className="pt-2 border-t border-gray-800 mt-2">
                <div className="text-yellow-400 font-semibold">🎯 15pt Setup:</div>
                <div>Wall break + Momentum + Volume</div>
                <div>= Dealer cascade = BIG MOVE</div>
              </div>
            </div>
          </Card>
        </aside>
      </main>
    </div>
  );
};

export default TitanOmega15ptDashboard;
