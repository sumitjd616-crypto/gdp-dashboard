import React, { useState, useEffect, useCallback, useRef } from 'react';
import polygonService from './services/PolygonService';
import { buildGEXProfile, detectScenarios, buildWeeklyAnalysis } from './services/GEXCalculator';

/**
 * TITAN OMEGA - LIVE GEX DASHBOARD
 * 
 * REAL DATA ONLY - NO SIMULATIONS
 * 
 * Data Sources:
 * - I:SPX → Real S&P 500 Index (Indices Subscription)
 * - I:VIX → Real VIX Index (Indices Subscription)
 * - SPX/SPY Options → Real options chain (Options Developer)
 */

// ═══════════════════════════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════════════

const GEXHeatmapBar = ({ strike, gex, spot, gammaFlip, callWall, putWall, maxGEX }) => {
  const isSpot = Math.abs(strike - spot) < 3;
  const isFlip = Math.abs(strike - gammaFlip) < 3;
  const isCallWall = strike === callWall;
  const isPutWall = strike === putWall;
  const width = Math.min(100, Math.abs(gex) / (maxGEX || 0.1) * 100);
  const isPositive = gex >= 0;

  return (
    <div className={`flex items-center gap-2 px-2 py-0.5 rounded transition-all ${
      isSpot ? 'bg-blue-500/30 ring-2 ring-blue-500 scale-[1.02]' : 
      isFlip ? 'bg-yellow-500/20 ring-1 ring-yellow-500/50' : 
      isCallWall ? 'bg-red-500/15 ring-1 ring-red-500/30' : 
      isPutWall ? 'bg-emerald-500/15 ring-1 ring-emerald-500/30' : 
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
              className="h-3 bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-sm transition-all duration-300"
              style={{ width: `${width}%`, marginLeft: '50%' }}
            />
          ) : (
            <div 
              className="h-3 bg-gradient-to-l from-red-600 to-red-400 rounded-sm transition-all duration-300"
              style={{ width: `${width}%`, marginRight: '50%' }}
            />
          )}
        </div>
      </div>
      <div className={`w-14 text-right font-mono text-xs ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
        {gex >= 0 ? '+' : ''}{gex.toFixed(1)}M
      </div>
    </div>
  );
};

const ScenarioCard = ({ scenario, onSelect }) => {
  const bgColor = scenario.alert 
    ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/50' 
    : 'bg-gray-900/50 border-gray-800';

  return (
    <div 
      className={`p-3 rounded-xl border ${bgColor} cursor-pointer hover:scale-[1.01] transition-all ${scenario.alert ? 'animate-pulse' : ''}`}
      onClick={() => onSelect?.(scenario)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{scenario.direction === 'LONG' ? '🟢' : '🔴'}</span>
          <div>
            <div className="font-semibold text-white text-sm">{scenario.type.replace(/_/g, ' ')}</div>
            <div className={`text-xs font-bold ${
              scenario.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'
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
      <div className="text-xs text-gray-400">{scenario.reason}</div>
      {scenario.targets && scenario.targets[0] && (
        <div className="mt-1 text-xs text-blue-400">
          Target: {scenario.targets[0].toFixed(0)} ({Math.abs(scenario.targets[0] - scenario.entry).toFixed(0)} pts)
        </div>
      )}
      {scenario.alert && (
        <div className="mt-2 flex items-center gap-2 text-yellow-400 text-xs font-semibold">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-400"></span>
          </span>
          A+ SETUP - HIGH PROBABILITY!
        </div>
      )}
    </div>
  );
};

const AlertPopup = ({ alert, onDismiss }) => {
  if (!alert) return null;

  return (
    <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 max-w-2xl w-full mx-4">
      <div className={`p-5 rounded-2xl shadow-2xl border-2 ${
        alert.direction === 'LONG' 
          ? 'bg-gradient-to-r from-emerald-900 to-emerald-800 border-emerald-400' 
          : 'bg-gradient-to-r from-red-900 to-red-800 border-red-400'
      }`}>
        <div className="flex items-start gap-4">
          <div className="text-5xl">{alert.direction === 'LONG' ? '🟢' : '🔴'}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-2xl font-bold ${
                alert.direction === 'LONG' ? 'text-emerald-300' : 'text-red-300'
              }`}>
                🎯 {alert.direction} SIGNAL
              </span>
              <span className="px-3 py-1 bg-white/20 rounded-lg text-sm font-bold">
                {alert.confidence}% confidence
              </span>
            </div>
            <div className="text-lg text-white mb-2">{alert.type.replace(/_/g, ' ')}</div>
            <div className="text-sm text-gray-300">{alert.reason}</div>
            <div className="mt-2 flex gap-4 text-sm">
              <span className="text-gray-400">Entry: <span className="text-white font-mono">{alert.entry?.toFixed(2)}</span></span>
              <span className="text-gray-400">Stop: <span className="text-red-400 font-mono">{alert.stop?.toFixed(2)}</span></span>
              <span className="text-gray-400">Target: <span className="text-emerald-400 font-mono">{alert.targets?.[0]?.toFixed(2)}</span></span>
            </div>
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

const KeyLevelCard = ({ icon, name, value, distance, color, highlight }) => (
  <div className={`p-3 rounded-xl border transition-all ${
    highlight 
      ? `bg-${color}-500/20 border-${color}-500/50 ring-2 ring-${color}-500/30` 
      : `bg-${color}-500/10 border-${color}-500/20`
  }`}>
    <div className="flex justify-between items-center">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="text-sm text-gray-400">{name}</span>
      </div>
      <div className="text-right">
        <div className={`font-mono font-bold text-${color}-400`}>{value || '—'}</div>
        {distance !== undefined && (
          <div className={`text-xs ${Math.abs(distance) <= 5 ? 'text-yellow-400 font-semibold' : 'text-gray-500'}`}>
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
    window = { name: 'WEEKEND', icon: '🚫', quality: 0, canTrade: false, color: 'gray', desc: 'Markets closed' };
  } else if (dow === 5 && h > 14) {
    window = { name: 'FRI CLOSE', icon: '⚠️', quality: 20, canTrade: false, color: 'yellow', desc: 'Avoid - Low quality' };
  } else if (h >= 9.5 && h < 10.5) {
    window = { name: 'OPENING', icon: '🌅', quality: 85, canTrade: true, color: 'emerald', desc: 'High volatility, breakouts' };
  } else if (h >= 10.5 && h < 11) {
    window = { name: 'MID MORN', icon: '☀️', quality: 70, canTrade: true, color: 'emerald', desc: 'Trend continuation' };
  } else if (h >= 11 && h < 11.75) {
    window = { name: 'PRE-LUNCH', icon: '🎯', quality: 100, canTrade: true, color: 'yellow', desc: '⭐ PRIME REVERSAL WINDOW!' };
  } else if (h >= 11.75 && h < 14) {
    window = { name: 'LUNCH', icon: '😴', quality: 10, canTrade: false, color: 'red', desc: 'Avoid - No follow-through' };
  } else if (h >= 14 && h < 14.5) {
    window = { name: 'EARLY PM', icon: '🌤️', quality: 60, canTrade: true, color: 'emerald', desc: 'Position building' };
  } else if (h >= 14.5 && h < 15.75) {
    window = { name: 'POWER HR', icon: '⚡', quality: 95, canTrade: true, color: 'yellow', desc: '⭐ PRIME REVERSAL WINDOW!' };
  } else if (h >= 15.75 && h < 16) {
    window = { name: 'CLOSE', icon: '🔔', quality: 50, canTrade: true, color: 'emerald', desc: 'EOD charm flows' };
  } else if (h >= 4 && h < 9.5) {
    window = { name: 'PRE-MKT', icon: '🌅', quality: 30, canTrade: false, color: 'gray', desc: 'Pre-market session' };
  } else if (h >= 16 && h < 20) {
    window = { name: 'AFTER-HRS', icon: '🌆', quality: 20, canTrade: false, color: 'gray', desc: 'After-hours session' };
  }

  return (
    <div className={`px-4 py-3 rounded-xl border flex items-center gap-3 ${
      window.quality >= 90 
        ? 'bg-yellow-500/20 border-yellow-500/50 ring-2 ring-yellow-500/20' 
        : window.canTrade 
          ? 'bg-emerald-500/10 border-emerald-500/30' 
          : 'bg-gray-800 border-gray-700'
    }`}>
      <span className="text-3xl">{window.icon}</span>
      <div className="flex-1">
        <div className={`font-bold ${window.quality >= 90 ? 'text-yellow-400' : window.canTrade ? 'text-emerald-400' : 'text-gray-400'}`}>
          {window.name}
        </div>
        <div className="text-xs text-gray-400">{window.desc}</div>
      </div>
      <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
        window.quality >= 90 ? 'bg-yellow-500/30 ring-2 ring-yellow-500/50' : 
        window.quality >= 60 ? 'bg-emerald-500/20' : 
        'bg-gray-700'
      }`}>
        <span className={`text-xl font-bold ${
          window.quality >= 90 ? 'text-yellow-400' : 
          window.quality >= 60 ? 'text-emerald-400' : 
          'text-gray-500'
        }`}>
          {window.quality}
        </span>
      </div>
    </div>
  );
};

const ConnectionStatus = ({ isConnected, dataSource, dataQuality, lastUpdate, error }) => (
  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
    dataQuality === 'EXCELLENT' ? 'bg-emerald-500/20' :
    dataQuality === 'GOOD' ? 'bg-blue-500/20' :
    isConnected ? 'bg-yellow-500/20' : 
    error ? 'bg-red-500/20' : 'bg-gray-700'
  }`}>
    <div className={`w-2 h-2 rounded-full ${
      dataQuality === 'EXCELLENT' ? 'bg-emerald-400 animate-pulse' :
      dataQuality === 'GOOD' ? 'bg-blue-400 animate-pulse' :
      isConnected ? 'bg-yellow-400 animate-pulse' : 
      error ? 'bg-red-400' : 'bg-gray-500'
    }`}></div>
    <div className="text-sm">
      <div className={`font-semibold ${
        dataQuality === 'EXCELLENT' ? 'text-emerald-400' :
        dataQuality === 'GOOD' ? 'text-blue-400' :
        isConnected ? 'text-yellow-400' : 
        error ? 'text-red-400' : 'text-gray-400'
      }`}>
        {dataQuality === 'EXCELLENT' ? 'REAL DATA' :
         dataQuality === 'GOOD' ? 'INDEX DATA' :
         isConnected ? 'CONNECTED' : 
         error ? 'ERROR' : 'CONNECTING...'}
      </div>
      {dataSource && <div className="text-xs text-gray-500">{dataSource}</div>}
    </div>
  </div>
);

const WeeklyAnalysisPanel = ({ analysis }) => {
  if (!analysis?.available) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
        <div className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
          <span>📅</span> WEEKLY OUTLOOK
        </div>
        <div className="text-xs text-gray-500 text-center py-4">
          Requires daily bars data
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
      <div className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
        <span>📅</span> WEEKLY OUTLOOK
      </div>
      
      <div className="space-y-2 text-xs">
        {/* Week Summary */}
        <div className={`p-2 rounded-lg ${
          analysis.weekSummary.trend === 'BULLISH' 
            ? 'bg-emerald-500/10 border border-emerald-500/20' 
            : 'bg-red-500/10 border border-red-500/20'
        }`}>
          <div className="flex justify-between">
            <span className="text-gray-400">Week Trend</span>
            <span className={analysis.weekSummary.trend === 'BULLISH' ? 'text-emerald-400' : 'text-red-400'}>
              {analysis.weekSummary.trend} {analysis.weekSummary.change}
            </span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-gray-500">Range</span>
            <span className="text-gray-400">{analysis.weekSummary.low?.toFixed(0)} - {analysis.weekSummary.high?.toFixed(0)}</span>
          </div>
        </div>

        {/* Next Week Expectation */}
        <div className="p-2 bg-gray-800 rounded-lg">
          <div className="text-gray-400 mb-1">Next Week Range</div>
          <div className="flex justify-between">
            <span className="text-emerald-400">↑ {analysis.nextWeekExpectation.bullishTarget}</span>
            <span className="text-gray-500">±{analysis.nextWeekExpectation.expectedRange} pts</span>
            <span className="text-red-400">↓ {analysis.nextWeekExpectation.bearishTarget}</span>
          </div>
        </div>

        {/* Outlook Notes */}
        <div className="space-y-1">
          {analysis.outlook.notes.map((note, i) => (
            <div key={i} className="text-gray-400 text-xs flex items-center gap-1">
              <span className="text-yellow-500">•</span> {note}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════════════

const TitanOmegaLive = () => {
  const [time, setTime] = useState(new Date());
  const [spot, setSpot] = useState(null);
  const [spxData, setSpxData] = useState(null);
  const [vixData, setVixData] = useState(null);
  const [gexProfile, setGexProfile] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [currentAlert, setCurrentAlert] = useState(null);
  const [bars, setBars] = useState([]);
  const [dailyBars, setDailyBars] = useState([]);
  const [optionsData, setOptionsData] = useState({ available: false, data: [] });
  const [isConnected, setIsConnected] = useState(false);
  const [dataQuality, setDataQuality] = useState('UNKNOWN');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);
  const [commentary, setCommentary] = useState([]);
  const [marketStatus, setMarketStatus] = useState(null);
  const [weeklyAnalysis, setWeeklyAnalysis] = useState(null);
  const alertShownRef = useRef(new Set());
  const audioRef = useRef(null);

  // Add commentary
  const addComment = useCallback((text, type = 'info') => {
    setCommentary(prev => [{
      text,
      type,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }, ...prev].slice(0, 25));
  }, []);

  // Fetch all real data from Polygon
  const fetchData = useCallback(async () => {
    try {
      setError(null);
      addComment('🔄 Fetching real-time data...', 'info');
      
      // Get all data from consolidated fetch
      const allData = await polygonService.getAllData();
      
      setMarketStatus(allData.marketStatus);
      setDataQuality(allData.dataQuality);

      // SPX Price
      if (allData.spx) {
        setSpxData(allData.spx);
        setSpot(allData.spx.price);
        setIsConnected(true);
        
        const changeStr = allData.spx.session?.changePercent 
          ? `${allData.spx.session.changePercent >= 0 ? '+' : ''}${allData.spx.session.changePercent.toFixed(2)}%`
          : '';
        
        addComment(
          `📊 SPX: ${allData.spx.price.toFixed(2)} ${changeStr} [${allData.spx.source}]`, 
          'data'
        );
      } else if (allData.lastSession?.spx) {
        // Use last session during off-hours
        setSpxData(allData.lastSession.spx);
        setSpot(allData.lastSession.spx.price);
        setIsConnected(false);
        addComment(`📊 Using last session data from ${new Date(allData.lastSession.timestamp).toLocaleDateString()}`, 'info');
      } else {
        setIsConnected(false);
        const spxError = allData.errors.find(e => e.source === 'SPX');
        setError(spxError?.error || 'SPX data unavailable');
      }

      // VIX
      if (allData.vix) {
        setVixData(allData.vix);
        addComment(`📈 VIX: ${allData.vix.value.toFixed(2)} [${allData.vix.source}]`, 'data');
      }

      // Options Chain
      if (allData.options?.available) {
        setOptionsData(allData.options);
        addComment(`📋 Options: ${allData.options.count} contracts${allData.options.scaledFromSPY ? ' (SPY scaled)' : ''} [REAL]`, 'data');
      } else {
        setOptionsData({ available: false, data: [] });
        if (allData.options?.error) {
          addComment(`⚠️ Options: ${allData.options.error}`, 'error');
        }
      }

      // Intraday Bars
      if (allData.bars?.length > 0) {
        setBars(allData.bars);
        addComment(`📈 Loaded ${allData.bars.length} intraday bars`, 'data');
      }

      // Daily Bars
      if (allData.dailyBars?.length > 0) {
        setDailyBars(allData.dailyBars);
        addComment(`📊 Loaded ${allData.dailyBars.length} daily bars for weekly analysis`, 'data');
      }

      // Log any errors
      for (const err of allData.errors) {
        console.warn(`${err.source}: ${err.error}`);
      }

      setLastUpdate(new Date());
      addComment(`✅ Data quality: ${allData.dataQuality}`, 'info');
      
    } catch (err) {
      console.error('Data fetch error:', err);
      setError(err.message);
      setIsConnected(false);
      addComment(`❌ Error: ${err.message}`, 'error');
    }
  }, [addComment]);

  // Build GEX profile when data changes
  useEffect(() => {
    if (!spot) return;

    const vix = vixData?.value || 15;
    const optionsChain = optionsData?.available ? optionsData.data : [];
    
    const profile = buildGEXProfile(spot, optionsChain, vix);
    setGexProfile(profile);

    // Build weekly analysis if we have daily bars
    if (profile?.available && dailyBars.length > 0) {
      const weekly = buildWeeklyAnalysis(profile, dailyBars);
      setWeeklyAnalysis(weekly);
    }

    // Detect scenarios if GEX is available
    if (profile?.available) {
      const detectedScenarios = detectScenarios(profile, bars, time);
      setScenarios(detectedScenarios);

      // Check for high-confidence alerts
      const alertScenario = detectedScenarios.find(s => 
        s.alert && 
        s.confidence >= 75 && 
        !alertShownRef.current.has(s.type + '-' + Math.floor(Date.now() / 60000))
      );
      
      if (alertScenario) {
        const alertKey = alertScenario.type + '-' + Math.floor(Date.now() / 60000);
        alertShownRef.current.add(alertKey);
        setCurrentAlert({ ...alertScenario, entry: spot });
        addComment(`🚨 ALERT: ${alertScenario.type.replace(/_/g, ' ')} - ${alertScenario.direction} @ ${spot.toFixed(2)}`, 'alert');
        
        if (audioRef.current) {
          audioRef.current.play().catch(() => {});
        }
      }
    }
  }, [spot, vixData, bars, dailyBars, optionsData, time, addComment]);

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Initial data fetch and polling
  useEffect(() => {
    addComment('🚀 Connecting to Polygon.io (Real SPX + Options)...', 'info');
    fetchData();
    
    // Poll every 15 seconds for real-time data
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData, addComment]);

  // Auto commentary
  useEffect(() => {
    if (!gexProfile?.available) return;
    
    const timer = setInterval(() => {
      const distToFlip = spot - gexProfile.gammaFlip;
      const distToCallWall = gexProfile.majorCallWall - spot;
      const distToPutWall = spot - gexProfile.majorPutWall;
      
      const comments = [
        `⚡ Gamma Flip: ${gexProfile.gammaFlip.toFixed(0)} | ${distToFlip > 0 ? 'ABOVE ✅' : 'BELOW ⚠️'} (${distToFlip.toFixed(1)} pts)`,
        `🧱 Call Wall: ${gexProfile.majorCallWall.toFixed(0)} | ${distToCallWall.toFixed(1)} pts away`,
        `💎 Put Wall: ${gexProfile.majorPutWall.toFixed(0)} | ${distToPutWall.toFixed(1)} pts away`,
        `📊 Regime: ${gexProfile.regime} ${gexProfile.regimeStrength} | Net GEX: ${gexProfile.netGEX.toFixed(0)}M`,
        `🌊 Vanna: ${gexProfile.netVanna > 0 ? 'BUY' : 'SELL'} flow | Charm: ${gexProfile.netCharm > 0 ? 'BUY' : 'SELL'} flow`,
        `📡 Data: ${gexProfile.dataSource} | Options: ${optionsData.count || 0} contracts`,
      ];
      addComment(comments[Math.floor(Math.random() * comments.length)]);
    }, 12000);
    
    return () => clearInterval(timer);
  }, [gexProfile, spot, optionsData, addComment]);

  // Loading state
  if (!spot) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🎯</div>
          <div className="text-xl font-semibold mb-2">TITAN OMEGA</div>
          <div className="text-gray-400">Connecting to Polygon.io...</div>
          <div className="text-gray-500 text-sm mt-2">Real SPX + VIX + Options</div>
          {error && <div className="text-red-400 mt-2 text-sm">{error}</div>}
        </div>
      </div>
    );
  }

  // Build heatmap data
  const heatmapData = gexProfile?.available && gexProfile?.heatmap
    ? gexProfile.heatmap.filter(h => Math.abs(h.strike - spot) < 80)
    : [];
  
  const maxGEX = heatmapData.length > 0 
    ? Math.max(...heatmapData.map(h => Math.abs(h.netGEX)), 1) 
    : 1;

  const distToFlip = gexProfile?.available ? spot - gexProfile.gammaFlip : 0;
  const distToCallWall = gexProfile?.available ? gexProfile.majorCallWall - spot : 0;
  const distToPutWall = gexProfile?.available ? spot - gexProfile.majorPutWall : 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      {/* Alert Popup */}
      <AlertPopup alert={currentAlert} onDismiss={() => setCurrentAlert(null)} />
      
      {/* Audio for alerts */}
      <audio ref={audioRef} src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1lZWNfaWlneXuDg4KFhYaJhoeDgoKCgoODhIWFhYaGhoeHh4eHh4eHh4eGhoaFhYWEhIOCgYCAfn18e3p5eHd2dXRzcnFwb29ubm5ubm5ubm9vcHBxcnNzdHV2d3h5ent8fX6AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==" />

      {/* Header */}
      <header className="bg-gray-900/95 backdrop-blur-sm border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
        <div className="max-w-[1920px] mx-auto flex justify-between items-center">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center text-2xl shadow-lg shadow-orange-500/25">
              🎯
            </div>
            <div>
              <div className="text-xl font-bold bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-transparent">
                TITAN OMEGA
              </div>
              <div className="text-xs text-gray-500">
                {gexProfile?.available 
                  ? `🟢 REAL OPTIONS (${optionsData.count || 0} contracts)`
                  : spxData?.isRealIndex 
                    ? '🟡 REAL INDEX - Options unavailable' 
                    : '⚪ LAST SESSION DATA'}
              </div>
            </div>
          </div>

          {/* Key Metrics */}
          <div className="flex items-center gap-6">
            {/* SPX Price */}
            <div className="text-center">
              <div className="text-xs text-gray-500">SPX (Real Index)</div>
              <div className="text-2xl font-bold font-mono text-white">{spot.toFixed(2)}</div>
              {spxData?.session?.changePercent !== undefined && (
                <div className={`text-xs ${spxData.session.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {spxData.session.changePercent >= 0 ? '+' : ''}{spxData.session.changePercent.toFixed(2)}%
                </div>
              )}
            </div>

            {/* Gamma Flip */}
            {gexProfile?.available && (
              <div className="text-center">
                <div className="text-xs text-gray-500">γ-Flip</div>
                <div className="text-xl font-bold font-mono text-yellow-400">{gexProfile.gammaFlip.toFixed(0)}</div>
                <div className={`text-xs ${distToFlip > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {distToFlip > 0 ? 'ABOVE' : 'BELOW'}
                </div>
              </div>
            )}

            {/* VIX */}
            <div className="text-center">
              <div className="text-xs text-gray-500">VIX (Real)</div>
              <div className={`text-xl font-bold font-mono ${
                (vixData?.value || 0) > 25 ? 'text-red-400' : (vixData?.value || 0) > 18 ? 'text-yellow-400' : 'text-emerald-400'
              }`}>
                {vixData?.value?.toFixed(1) || '—'}
              </div>
            </div>

            {/* Regime */}
            {gexProfile?.available && (
              <div className={`px-4 py-2 rounded-xl ${
                gexProfile.regime === 'POSITIVE' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                gexProfile.regime === 'NEGATIVE' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                'bg-gray-700 text-gray-400'
              }`}>
                <div className="text-xs opacity-75">Regime</div>
                <div className="font-bold text-sm">
                  {gexProfile.regime === 'POSITIVE' ? '+γ DAMPEN' : 
                   gexProfile.regime === 'NEGATIVE' ? '-γ AMPLIFY' : 'NEUTRAL'}
                </div>
              </div>
            )}

            {/* Connection Status */}
            <ConnectionStatus 
              isConnected={isConnected} 
              dataSource={spxData?.source}
              dataQuality={dataQuality}
              lastUpdate={lastUpdate}
              error={error}
            />

            {/* Market Status */}
            {marketStatus && (
              <div className={`px-3 py-1 rounded-lg text-xs ${
                marketStatus.isOpen ? 'bg-emerald-500/20 text-emerald-400' :
                marketStatus.afterHours ? 'bg-yellow-500/20 text-yellow-400' :
                marketStatus.preMarket ? 'bg-blue-500/20 text-blue-400' :
                'bg-gray-700 text-gray-400'
              }`}>
                {marketStatus.isOpen ? '🟢 OPEN' :
                 marketStatus.afterHours ? '🟡 AFTER-HRS' :
                 marketStatus.preMarket ? '🔵 PRE-MKT' :
                 '⚪ CLOSED'}
              </div>
            )}

            {/* Time */}
            <div className="font-mono text-gray-400 text-lg tabular-nums">
              {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1920px] mx-auto grid grid-cols-12 gap-3 p-3 h-[calc(100vh-80px)]">
        {/* Left Panel - Time & Scenarios */}
        <aside className="col-span-3 flex flex-col gap-3 overflow-auto">
          {/* Time Window */}
          <TimeWindow time={time} />

          {/* Weekly Analysis */}
          <WeeklyAnalysisPanel analysis={weeklyAnalysis} />

          {/* Active Scenarios */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 flex-1 overflow-auto">
            <div className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <span>🎯</span> SCENARIOS
              <span className="ml-auto text-xs px-2 py-0.5 bg-gray-800 rounded">{scenarios.length}</span>
            </div>
            {!gexProfile?.available ? (
              <div className="text-xs text-gray-500 text-center py-4">
                ⚠️ Real options data required for scenarios
              </div>
            ) : scenarios.length === 0 ? (
              <div className="text-xs text-gray-500 text-center py-4">
                No active scenarios - watching...
              </div>
            ) : (
              <div className="space-y-2">
                {scenarios.map((scenario, i) => (
                  <ScenarioCard key={scenario.type + i} scenario={scenario} />
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Center - GEX Heatmap */}
        <section className="col-span-6 flex flex-col gap-3">
          <div className="flex-1 bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden">
            <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-lg">📊</span>
                <span className="font-semibold text-gray-300">GEX HEATMAP</span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  gexProfile?.available ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {gexProfile?.dataSource || 'NO DATA'}
                </span>
                {optionsData.scaledFromSPY && (
                  <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
                    SPY→SPX
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-emerald-500 rounded"></div>
                  <span className="text-gray-400">+GEX (Support)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-red-500 rounded"></div>
                  <span className="text-gray-400">-GEX (Resistance)</span>
                </div>
              </div>
            </div>
            <div className="flex-1 p-2 overflow-y-auto space-y-0.5">
              {!gexProfile?.available ? (
                <div className="h-full flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <div className="text-3xl mb-2">⚠️</div>
                    <div>Real options data required</div>
                    <div className="text-xs mt-1">Options Developer subscription needed</div>
                  </div>
                </div>
              ) : heatmapData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-500">
                  No GEX data in range
                </div>
              ) : (
                heatmapData.map(h => (
                  <GEXHeatmapBar
                    key={h.strike}
                    strike={h.strike}
                    gex={h.netGEX}
                    spot={spot}
                    gammaFlip={gexProfile.gammaFlip}
                    callWall={gexProfile.majorCallWall}
                    putWall={gexProfile.majorPutWall}
                    maxGEX={maxGEX}
                  />
                ))
              )}
            </div>
          </div>

          {/* Live Commentary */}
          <div className="h-44 bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden">
            <div className="px-4 py-2 bg-gray-800/50 border-b border-gray-800 flex items-center gap-2">
              <span>💬</span>
              <span className="text-sm font-semibold text-gray-400">LIVE ANALYSIS</span>
              <div className="ml-auto flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
                <span className="text-xs text-gray-500">Live</span>
              </div>
            </div>
            <div className="flex-1 p-2 overflow-y-auto space-y-1">
              {commentary.map((c, i) => (
                <div key={i} className={`text-xs px-2 py-1 rounded ${
                  c.type === 'alert' ? 'bg-yellow-500/20 text-yellow-300 font-semibold' :
                  c.type === 'error' ? 'bg-red-500/20 text-red-300' :
                  c.type === 'data' ? 'bg-blue-500/10 text-blue-300' :
                  'bg-gray-800/50 text-gray-400'
                }`}>
                  <span className="text-gray-600 mr-2">{c.time}</span>
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
              <KeyLevelCard icon="📍" name="SPX Spot" value={spot.toFixed(2)} color="blue" />
              {gexProfile?.available && (
                <>
                  <KeyLevelCard 
                    icon="⚡" name="γ-Flip" value={gexProfile.gammaFlip.toFixed(0)} 
                    distance={distToFlip} color="yellow"
                    highlight={Math.abs(distToFlip) <= 5}
                  />
                  <KeyLevelCard 
                    icon="🧱" name="Call Wall" value={gexProfile.majorCallWall.toFixed(0)} 
                    distance={distToCallWall} color="red"
                    highlight={distToCallWall <= 8}
                  />
                  <KeyLevelCard 
                    icon="💎" name="Put Wall" value={gexProfile.majorPutWall.toFixed(0)} 
                    distance={-distToPutWall} color="emerald"
                    highlight={distToPutWall <= 8}
                  />
                </>
              )}
            </div>
          </div>

          {/* Trade Rules */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 flex-1">
            <div className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <span>💡</span> TRADING RULES
            </div>
            <div className="space-y-2 text-xs">
              <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="text-red-400 font-bold mb-1">🧱 CALL WALL → SHORT</div>
                <div className="text-gray-400">Price hits wall → Dealers sell → Reversal DOWN</div>
              </div>
              <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <div className="text-emerald-400 font-bold mb-1">💎 PUT WALL → LONG</div>
                <div className="text-gray-400">Price hits wall → Dealers buy → Reversal UP</div>
              </div>
              <div className="p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <div className="text-yellow-400 font-bold mb-1">⚡ GAMMA FLIP</div>
                <div className="text-yellow-200/70">Cross = regime change, expect momentum</div>
              </div>
              <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                <div className="text-purple-400 font-bold mb-1">🎯 A+ SETUP</div>
                <div className="text-purple-200/70">Wall touch + Rejection + Prime time = 75%+</div>
              </div>
            </div>
          </div>

          {/* Stats */}
          {gexProfile?.available && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
              <div className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
                <span>📊</span> GEX STATS
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 bg-gray-800 rounded text-center">
                  <div className="text-gray-500">Net GEX</div>
                  <div className={`font-bold font-mono ${gexProfile.netGEX > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {gexProfile.netGEX.toFixed(0)}M
                  </div>
                </div>
                <div className="p-2 bg-gray-800 rounded text-center">
                  <div className="text-gray-500">Contracts</div>
                  <div className="font-bold font-mono text-blue-400">
                    {gexProfile.totalContracts}
                  </div>
                </div>
                <div className="p-2 bg-gray-800 rounded text-center">
                  <div className="text-gray-500">Vanna Flow</div>
                  <div className={`font-bold ${gexProfile.netVanna > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {gexProfile.netVanna > 0 ? '↑ BUY' : '↓ SELL'}
                  </div>
                </div>
                <div className="p-2 bg-gray-800 rounded text-center">
                  <div className="text-gray-500">Charm Flow</div>
                  <div className={`font-bold ${gexProfile.netCharm > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {gexProfile.netCharm > 0 ? '↑ BUY' : '↓ SELL'}
                  </div>
                </div>
              </div>
              {lastUpdate && (
                <div className="mt-2 text-xs text-gray-500 text-center">
                  Updated: {lastUpdate.toLocaleTimeString()}
                </div>
              )}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
};

export default TitanOmegaLive;
