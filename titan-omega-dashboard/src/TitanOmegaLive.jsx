import React, { useState, useEffect, useCallback, useRef } from 'react';
import polygonService from './services/PolygonService';
import { buildGEXProfile, detectScenarios } from './services/GEXCalculator';

/**
 * TITAN OMEGA - Live GEX Dashboard
 * 
 * Real-time dealer positioning and 15+ point move detection
 */

// ═══════════════════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════════════

const GEXHeatmapBar = ({ strike, gex, spot, gammaFlip, callWall, putWall, maxGEX }) => {
  const isSpot = Math.abs(strike - spot) < 3;
  const isFlip = strike === gammaFlip;
  const isCallWall = strike === callWall;
  const isPutWall = strike === putWall;
  const width = Math.min(100, Math.abs(gex) / (maxGEX || 0.1) * 100);
  const isPositive = gex >= 0;

  return (
    <div className={`flex items-center gap-2 px-2 py-0.5 rounded transition-all ${
      isSpot ? 'bg-blue-500/30 ring-2 ring-blue-500 scale-105' : 
      isFlip ? 'bg-yellow-500/20 ring-1 ring-yellow-500/50' : 
      isCallWall ? 'bg-red-500/20' : 
      isPutWall ? 'bg-emerald-500/20' : 
      'hover:bg-gray-800/50'
    }`}>
      <div className={`w-16 text-right font-mono text-sm ${
        isSpot ? 'text-blue-400 font-bold' : 
        isFlip ? 'text-yellow-400 font-semibold' : 
        isCallWall ? 'text-red-400 font-semibold' : 
        isPutWall ? 'text-emerald-400 font-semibold' : 
        'text-gray-500'
      }`}>
        {strike}
        {isSpot && ' ◄'}
        {isFlip && ' ⚡'}
        {isCallWall && ' 🧱'}
        {isPutWall && ' 💎'}
      </div>
      <div className="flex-1 h-4 relative flex items-center">
        <div className="absolute left-1/2 w-px h-full bg-gray-700"></div>
        <div className="w-full flex justify-center">
          {isPositive ? (
            <div 
              className="h-3 bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-sm transition-all"
              style={{ width: `${width}%`, marginLeft: '50%' }}
            />
          ) : (
            <div 
              className="h-3 bg-gradient-to-l from-red-600 to-red-400 rounded-sm transition-all"
              style={{ width: `${width}%`, marginRight: '50%' }}
            />
          )}
        </div>
      </div>
      <div className={`w-12 text-right font-mono text-xs ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
        {gex >= 0 ? '+' : ''}{gex.toFixed(2)}
      </div>
    </div>
  );
};

const ScenarioCard = ({ scenario, onSelect }) => {
  const bgColor = scenario.alert 
    ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/50 animate-pulse' 
    : scenario.active 
      ? 'bg-gray-800/80 border-gray-600' 
      : 'bg-gray-900/50 border-gray-800';

  return (
    <div 
      className={`p-3 rounded-xl border ${bgColor} cursor-pointer hover:scale-[1.02] transition-all`}
      onClick={() => onSelect?.(scenario)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{scenario.icon}</span>
          <div>
            <div className="font-semibold text-white text-sm">{scenario.name}</div>
            <div className={`text-xs font-bold ${
              scenario.direction === 'LONG' ? 'text-emerald-400' : 
              scenario.direction === 'SHORT' ? 'text-red-400' : 
              'text-gray-400'
            }`}>
              {scenario.direction}
            </div>
          </div>
        </div>
        <div className={`px-2 py-1 rounded-lg text-xs font-bold ${
          scenario.confidence >= 80 ? 'bg-emerald-500/30 text-emerald-300' :
          scenario.confidence >= 60 ? 'bg-yellow-500/30 text-yellow-300' :
          'bg-gray-700 text-gray-400'
        }`}>
          {scenario.confidence}%
        </div>
      </div>
      <div className="text-xs text-gray-400">{scenario.description}</div>
      {scenario.targetPts && (
        <div className="mt-1 text-xs text-blue-400">
          Target: {scenario.targetPts > 0 ? '+' : ''}{scenario.targetPts?.toFixed(0)} pts
        </div>
      )}
      {scenario.alert && (
        <div className="mt-2 flex items-center gap-1 text-yellow-400 text-xs font-semibold">
          <span className="animate-ping absolute h-2 w-2 rounded-full bg-yellow-400 opacity-75"></span>
          <span className="relative h-2 w-2 rounded-full bg-yellow-400 mr-1"></span>
          ALERT: High probability setup!
        </div>
      )}
    </div>
  );
};

const AlertPopup = ({ alert, onDismiss }) => {
  if (!alert) return null;

  return (
    <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 max-w-2xl w-full mx-4 animate-bounce-in">
      <div className={`p-5 rounded-2xl shadow-2xl border-2 ${
        alert.direction === 'LONG' 
          ? 'bg-gradient-to-r from-emerald-900 to-emerald-800 border-emerald-400' 
          : 'bg-gradient-to-r from-red-900 to-red-800 border-red-400'
      }`}>
        <div className="flex items-start gap-4">
          <div className="text-5xl">{alert.icon}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-2xl font-bold ${
                alert.direction === 'LONG' ? 'text-emerald-300' : 'text-red-300'
              }`}>
                {alert.direction} SIGNAL
              </span>
              <span className="px-3 py-1 bg-white/20 rounded-lg text-sm font-bold">
                {alert.confidence}% confidence
              </span>
            </div>
            <div className="text-lg text-white mb-2">{alert.name}</div>
            <div className="text-sm text-gray-300">{alert.description}</div>
            {alert.targetPts && (
              <div className="mt-2 text-emerald-400 font-semibold">
                Target: {alert.targetPts > 0 ? '+' : ''}{alert.targetPts?.toFixed(0)} points
              </div>
            )}
          </div>
          <button 
            onClick={onDismiss} 
            className="text-white/50 hover:text-white text-3xl font-light"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
};

const KeyLevelCard = ({ icon, name, value, distance, color }) => (
  <div className={`p-3 rounded-xl bg-${color}-500/10 border border-${color}-500/30`}>
    <div className="flex justify-between items-center">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="text-sm text-gray-400">{name}</span>
      </div>
      <div className="text-right">
        <div className={`font-mono font-bold text-${color}-400`}>{value}</div>
        {distance !== undefined && (
          <div className="text-xs text-gray-500">
            {distance > 0 ? '+' : ''}{distance.toFixed(1)} pts
          </div>
        )}
      </div>
    </div>
  </div>
);

const TimeWindow = ({ time }) => {
  const h = time.getHours() + time.getMinutes() / 60;
  const dow = time.getDay();

  let window = { name: 'CLOSED', icon: '🌙', quality: 0, canTrade: false, color: 'gray' };
  
  if (dow === 0 || dow === 6) {
    window = { name: 'WEEKEND', icon: '🚫', quality: 0, canTrade: false, color: 'gray' };
  } else if (dow === 5 && h > 14) {
    window = { name: 'FRI CLOSE', icon: '⚠️', quality: 20, canTrade: false, color: 'yellow' };
  } else if (h >= 9.5 && h < 10.5) {
    window = { name: 'OPENING', icon: '🌅', quality: 85, canTrade: true, color: 'emerald', desc: 'High volatility' };
  } else if (h >= 10.5 && h < 11) {
    window = { name: 'MID MORN', icon: '☀️', quality: 70, canTrade: true, color: 'emerald' };
  } else if (h >= 11 && h < 11.75) {
    window = { name: 'PRE-LUNCH', icon: '🎯', quality: 100, canTrade: true, color: 'yellow', desc: 'PRIME REVERSAL!' };
  } else if (h >= 11.75 && h < 14) {
    window = { name: 'LUNCH', icon: '😴', quality: 10, canTrade: false, color: 'red', desc: 'Avoid trading' };
  } else if (h >= 14 && h < 14.5) {
    window = { name: 'EARLY PM', icon: '🌤️', quality: 60, canTrade: true, color: 'emerald' };
  } else if (h >= 14.5 && h < 15.75) {
    window = { name: 'POWER HR', icon: '⚡', quality: 95, canTrade: true, color: 'yellow', desc: 'PRIME REVERSAL!' };
  } else if (h >= 15.75 && h < 16) {
    window = { name: 'CLOSE', icon: '🔔', quality: 50, canTrade: true, color: 'emerald' };
  }

  return (
    <div className={`px-4 py-2 rounded-xl border flex items-center gap-3 ${
      window.canTrade 
        ? `bg-${window.color}-500/20 border-${window.color}-500/50` 
        : 'bg-gray-800 border-gray-700'
    }`}>
      <span className="text-2xl">{window.icon}</span>
      <div>
        <div className={`font-semibold ${window.canTrade ? `text-${window.color}-400` : 'text-gray-400'}`}>
          {window.name}
        </div>
        <div className="text-xs text-gray-500">
          {window.desc || `${window.quality}% quality`}
        </div>
      </div>
      <div className={`ml-auto w-12 h-12 rounded-full flex items-center justify-center ${
        window.quality >= 80 ? 'bg-emerald-500/30' : 
        window.quality >= 50 ? 'bg-yellow-500/30' : 
        'bg-gray-700'
      }`}>
        <span className={`text-lg font-bold ${
          window.quality >= 80 ? 'text-emerald-400' : 
          window.quality >= 50 ? 'text-yellow-400' : 
          'text-gray-500'
        }`}>
          {window.quality}
        </span>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════════════

const TitanOmegaLive = () => {
  const [time, setTime] = useState(new Date());
  const [spot, setSpot] = useState(5985);
  const [gexProfile, setGexProfile] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [currentAlert, setCurrentAlert] = useState(null);
  const [bars, setBars] = useState([]);
  const [vix, setVix] = useState(15);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [commentary, setCommentary] = useState([]);
  const alertSound = useRef(null);

  // Add commentary
  const addComment = useCallback((text, type = 'info') => {
    setCommentary(prev => [{
      text,
      type,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }, ...prev].slice(0, 20));
  }, []);

  // Fetch real data from Polygon
  const fetchData = useCallback(async () => {
    try {
      // Get spot price
      const spotData = await polygonService.getSpotPrice();
      if (spotData) {
        setSpot(spotData.price);
        setIsConnected(true);
        addComment(`📊 SPX: ${spotData.price.toFixed(2)} (${spotData.change >= 0 ? '+' : ''}${spotData.change.toFixed(2)}%)`, 'data');
      }

      // Get VIX
      const vixValue = await polygonService.getVIX();
      setVix(vixValue);

      // Get intraday bars
      const barsData = await polygonService.getIntradayBars('SPY', 5, 2);
      if (barsData.length > 0) {
        setBars(barsData);
      }

      setLastUpdate(new Date());
    } catch (error) {
      console.error('Data fetch error:', error);
      setIsConnected(false);
    }
  }, [addComment]);

  // Build GEX profile
  useEffect(() => {
    const profile = buildGEXProfile(spot, null, vix / 100);
    setGexProfile(profile);

    // Detect scenarios
    const currentBar = bars[0] || { open: spot, high: spot + 2, low: spot - 2, close: spot };
    const prevBar = bars[1];
    const detectedScenarios = detectScenarios(profile, currentBar, prevBar);
    setScenarios(detectedScenarios);

    // Check for alerts
    const alertScenario = detectedScenarios.find(s => s.alert && s.confidence >= 80);
    if (alertScenario && alertScenario.id !== currentAlert?.id) {
      setCurrentAlert(alertScenario);
      addComment(`🚨 ALERT: ${alertScenario.name} - ${alertScenario.direction} signal!`, 'alert');
      // Play sound if available
      alertSound.current?.play().catch(() => {});
    }
  }, [spot, vix, bars, currentAlert?.id, addComment]);

  // Update time
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Initial data fetch and polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Poll every 30 seconds
    return () => clearInterval(interval);
  }, [fetchData]);

  // Simulated price movement for demo
  useEffect(() => {
    if (isConnected) return; // Don't simulate if connected to real data
    
    const interval = setInterval(() => {
      setSpot(prev => {
        const change = (Math.random() - 0.48) * 2;
        return +(prev + change).toFixed(2);
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // Commentary
  useEffect(() => {
    if (!gexProfile) return;
    
    const timer = setInterval(() => {
      const comments = [
        `⚡ Gamma Flip: ${gexProfile.gammaFlip} | Spot ${gexProfile.aboveFlip ? 'ABOVE ✅' : 'BELOW ⚠️'}`,
        `🧱 Call Wall: ${gexProfile.callWall} (${gexProfile.distToCallWall.toFixed(0)} pts away)`,
        `💎 Put Wall: ${gexProfile.putWall} (${gexProfile.distToPutWall.toFixed(0)} pts away)`,
        `📊 Regime: ${gexProfile.regime} | Net GEX: ${gexProfile.netGEX.toFixed(2)}B`,
        `🌊 Vanna Flow: ${gexProfile.vannaFlow > 0 ? 'BUY' : 'SELL'} pressure`,
      ];
      addComment(comments[Math.floor(Math.random() * comments.length)]);
    }, 8000);
    
    return () => clearInterval(timer);
  }, [gexProfile, addComment]);

  if (!gexProfile) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-spin">⚙️</div>
          <div className="text-xl">Loading GEX Data...</div>
        </div>
      </div>
    );
  }

  const maxGEX = Math.max(...Object.values(gexProfile.gexByStrike).map(Math.abs), 0.1);
  const sortedStrikes = Object.keys(gexProfile.gexByStrike)
    .map(Number)
    .filter(k => Math.abs(k - spot) < 80)
    .sort((a, b) => b - a);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      {/* Alert Popup */}
      <AlertPopup alert={currentAlert} onDismiss={() => setCurrentAlert(null)} />
      
      {/* Audio for alerts */}
      <audio ref={alertSound} src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1lZWNfaWlneXuDg4KFhYaJhoeDgoKCgoODhIWFhYaGhoeHh4eHh4eHh4eGhoaFhYWEhIOCgYCAfn18e3p5eHd2dXRzcnFwb29ubm5ubm5ubm9vcHBxcnNzdHV2d3h5ent8fX6AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==" />

      {/* Header */}
      <header className="bg-gray-900/95 backdrop-blur border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
        <div className="max-w-[1920px] mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center text-2xl shadow-lg shadow-orange-500/25">
              🎯
            </div>
            <div>
              <div className="text-xl font-bold bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-transparent">
                TITAN OMEGA
              </div>
              <div className="text-xs text-gray-500">LIVE GEX DASHBOARD</div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Spot Price */}
            <div className="text-center">
              <div className="text-xs text-gray-500">SPX</div>
              <div className="text-2xl font-bold font-mono text-white">{spot.toFixed(2)}</div>
            </div>

            {/* Gamma Flip */}
            <div className="text-center">
              <div className="text-xs text-gray-500">γ-Flip</div>
              <div className="text-xl font-bold font-mono text-yellow-400">{gexProfile.gammaFlip}</div>
            </div>

            {/* VIX */}
            <div className="text-center">
              <div className="text-xs text-gray-500">VIX</div>
              <div className={`text-xl font-bold font-mono ${vix > 20 ? 'text-red-400' : vix > 15 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                {vix.toFixed(1)}
              </div>
            </div>

            {/* Regime */}
            <div className={`px-4 py-2 rounded-xl ${
              gexProfile.regime === 'POSITIVE_GAMMA' ? 'bg-emerald-500/20 text-emerald-400' :
              gexProfile.regime === 'NEGATIVE_GAMMA' ? 'bg-red-500/20 text-red-400' :
              'bg-gray-700 text-gray-400'
            }`}>
              <div className="text-xs opacity-75">Regime</div>
              <div className="font-bold">
                {gexProfile.regime === 'POSITIVE_GAMMA' ? '+γ DAMPEN' : 
                 gexProfile.regime === 'NEGATIVE_GAMMA' ? '-γ AMPLIFY' : 'NEUTRAL'}
              </div>
            </div>

            {/* Connection Status */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
              isConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400'}`}></div>
              <span className="text-sm font-semibold">{isConnected ? 'LIVE' : 'DEMO'}</span>
            </div>

            {/* Time */}
            <div className="font-mono text-gray-400 text-lg">
              {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1920px] mx-auto grid grid-cols-12 gap-3 p-3 h-[calc(100vh-80px)]">
        {/* Left Panel - Scenarios */}
        <aside className="col-span-3 flex flex-col gap-3 overflow-auto">
          {/* Time Window */}
          <TimeWindow time={time} />

          {/* Scenarios */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 flex-1 overflow-auto">
            <div className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <span>🎯</span> ACTIVE SCENARIOS
            </div>
            <div className="space-y-2">
              {scenarios.map((scenario, i) => (
                <ScenarioCard key={scenario.id || i} scenario={scenario} />
              ))}
            </div>
          </div>
        </aside>

        {/* Center - GEX Heatmap */}
        <section className="col-span-6 flex flex-col gap-3">
          <div className="flex-1 bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden">
            <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-lg">📊</span>
                <span className="font-semibold text-gray-300">GEX HEATMAP</span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-emerald-500 rounded"></div>
                  <span className="text-gray-400">Dealers Buy (Support)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-red-500 rounded"></div>
                  <span className="text-gray-400">Dealers Sell (Resist)</span>
                </div>
              </div>
            </div>
            <div className="flex-1 p-2 overflow-y-auto space-y-0.5">
              {sortedStrikes.map(strike => (
                <GEXHeatmapBar
                  key={strike}
                  strike={strike}
                  gex={gexProfile.gexByStrike[strike]}
                  spot={spot}
                  gammaFlip={gexProfile.gammaFlip}
                  callWall={gexProfile.callWall}
                  putWall={gexProfile.putWall}
                  maxGEX={maxGEX}
                />
              ))}
            </div>
          </div>

          {/* Commentary */}
          <div className="h-40 bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden">
            <div className="px-4 py-2 bg-gray-800/50 border-b border-gray-800 flex items-center gap-2">
              <span>💬</span>
              <span className="text-sm font-semibold text-gray-400">LIVE ANALYSIS</span>
            </div>
            <div className="flex-1 p-2 overflow-y-auto space-y-1">
              {commentary.map((c, i) => (
                <div key={i} className={`text-xs px-2 py-1 rounded ${
                  c.type === 'alert' ? 'bg-yellow-500/20 text-yellow-300' :
                  c.type === 'data' ? 'bg-blue-500/10 text-blue-300' :
                  'bg-gray-800 text-gray-400'
                }`}>
                  <span className="text-gray-500 mr-2">{c.time}</span>
                  {c.text}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Right Panel - Key Levels & Info */}
        <aside className="col-span-3 flex flex-col gap-3 overflow-auto">
          {/* Key Levels */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
            <div className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <span>📍</span> KEY LEVELS
            </div>
            <div className="space-y-2">
              <KeyLevelCard
                icon="📍"
                name="Spot Price"
                value={spot.toFixed(2)}
                color="blue"
              />
              <KeyLevelCard
                icon="⚡"
                name="Gamma Flip"
                value={gexProfile.gammaFlip}
                distance={gexProfile.distToFlip}
                color="yellow"
              />
              <KeyLevelCard
                icon="🧱"
                name="Call Wall"
                value={gexProfile.callWall || '—'}
                distance={gexProfile.callWall ? gexProfile.distToCallWall : undefined}
                color="red"
              />
              <KeyLevelCard
                icon="💎"
                name="Put Wall"
                value={gexProfile.putWall || '—'}
                distance={gexProfile.putWall ? -gexProfile.distToPutWall : undefined}
                color="emerald"
              />
            </div>
          </div>

          {/* How It Works */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 flex-1">
            <div className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <span>💡</span> HOW TO USE
            </div>
            <div className="space-y-3 text-xs">
              <div className="p-2 bg-gray-800 rounded-lg">
                <div className="text-emerald-400 font-bold mb-1">🧱 CALL WALL = SHORT</div>
                <div className="text-gray-400">When price hits call wall, dealers sell → Reversal DOWN</div>
              </div>
              <div className="p-2 bg-gray-800 rounded-lg">
                <div className="text-emerald-400 font-bold mb-1">💎 PUT WALL = LONG</div>
                <div className="text-gray-400">When price hits put wall, dealers buy → Reversal UP</div>
              </div>
              <div className="p-2 bg-gray-800 rounded-lg">
                <div className="text-emerald-400 font-bold mb-1">⚡ GAMMA FLIP = REGIME</div>
                <div className="text-gray-400">Above = dampened moves, Below = extended moves</div>
              </div>
              <div className="p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="text-yellow-400 font-bold mb-1">🎯 BEST SETUP</div>
                <div className="text-yellow-200/70">Wall touch + Rejection candle + Prime time (11:00-11:45 or 14:30-15:15)</div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
            <div className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <span>📊</span> GEX STATS
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-gray-800 rounded text-center">
                <div className="text-gray-500">Net GEX</div>
                <div className={`font-bold ${gexProfile.netGEX > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {gexProfile.netGEX.toFixed(2)}B
                </div>
              </div>
              <div className="p-2 bg-gray-800 rounded text-center">
                <div className="text-gray-500">Net DEX</div>
                <div className={`font-bold ${gexProfile.netDEX > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {gexProfile.netDEX?.toFixed(2)}M
                </div>
              </div>
              <div className="p-2 bg-gray-800 rounded text-center">
                <div className="text-gray-500">Vanna</div>
                <div className={`font-bold ${gexProfile.vannaFlow > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {gexProfile.vannaFlow > 0 ? 'BUY' : 'SELL'}
                </div>
              </div>
              <div className="p-2 bg-gray-800 rounded text-center">
                <div className="text-gray-500">Charm</div>
                <div className={`font-bold ${gexProfile.charmFlow > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {gexProfile.charmFlow > 0 ? 'BUY' : 'SELL'}
                </div>
              </div>
            </div>
            {lastUpdate && (
              <div className="mt-2 text-xs text-gray-500 text-center">
                Last update: {lastUpdate.toLocaleTimeString()}
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
};

export default TitanOmegaLive;
