import React, { useState, useEffect } from 'react';

const TitanOmegaDashboard = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [spotPrice, setSpotPrice] = useState(6893.18);
  const [showAlert, setShowAlert] = useState(true);
  
  // Simulate live price updates
  useEffect(() => {
    const priceInterval = setInterval(() => {
      setSpotPrice(prev => {
        const change = (Math.random() - 0.48) * 0.4;
        return Math.max(6875, Math.min(6910, prev + change));
      });
    }, 2000);
    
    const timeInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    
    const alertTimeout = setTimeout(() => setShowAlert(false), 6000);
    
    return () => {
      clearInterval(priceInterval);
      clearInterval(timeInterval);
      clearTimeout(alertTimeout);
    };
  }, []);

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: false 
    }) + ' ET';
  };

  const gexData = [
    { strike: 6950, gex: -0.8 },
    { strike: 6925, gex: -1.3 },
    { strike: 6900, gex: -1.7 },
    { strike: 6893, gex: -0.6, isSpot: true },
    { strike: 6875, gex: 0.1, isFlip: true },
    { strike: 6850, gex: 1.1 },
    { strike: 6825, gex: 1.6 },
    { strike: 6800, gex: 2.2 },
    { strike: 6775, gex: 1.8 },
    { strike: 6750, gex: 1.2 },
  ];

  const signals = [
    {
      type: 'LONG_REVERSAL',
      direction: 'long',
      entry: 6875,
      stop: 6865,
      tp1: 6897,
      tp2: 6910,
      confidence: 78,
      rr: 2.2,
      time: '10:09 AM',
      reason: 'Long reversal at GEX support 6,875 with HAMMER pattern. Positive gamma regime.',
      triggers: ['🔨 Hammer', '📊 GEX Support', '✅ +Gamma', '📈 Below VWAP'],
      active: true
    },
    {
      type: 'SHORT_BREAKDOWN',
      direction: 'short',
      entry: 6808,
      stop: 6820,
      tp1: 6775,
      tp2: 6750,
      confidence: 72,
      rr: 2.8,
      time: '12/18 11:39',
      reason: 'Breakdown below 6,800 in negative gamma. Dealers amplifying - waterfall setup.',
      triggers: ['⬇️ Breakdown', '🔴 -Gamma', '📉 Below VWAP', '⚡ Volume'],
      active: false
    },
    {
      type: 'GAMMA_SQUEEZE',
      direction: 'long',
      entry: 6880,
      stop: 6868,
      tp1: 6920,
      tp2: 6950,
      confidence: 65,
      rr: 3.3,
      time: '10:32 AM',
      reason: 'Approaching gamma flip from below. Squeeze potential if 6,880 breaks.',
      triggers: ['⚡ Near Flip', '📈 Momentum', '🎯 Breakout Setup'],
      active: false
    }
  ];

  const history = [
    { type: 'LONG_REVERSAL', levels: '6,875 → 6,897', time: '10:09 AM', result: 'active', pnl: '+0.26%' },
    { type: 'SHORT_BREAKDOWN', levels: '6,808 → 6,761', time: '12/18 11:39', result: 'win', pnl: '+0.69%' },
    { type: 'LONG_BREAKOUT', levels: '6,850 → 6,878', time: '12/18 09:45', result: 'win', pnl: '+0.41%' },
    { type: 'SHORT_REVERSAL', levels: '6,920 → 6,895', time: '12/17 14:22', result: 'loss', pnl: '-0.15%' },
    { type: 'GAMMA_SQUEEZE', levels: '6,780 → 6,845', time: '12/17 10:15', result: 'win', pnl: '+0.83%' },
  ];

  const keyLevels = [
    { name: 'Spot Price', value: spotPrice.toFixed(2), type: 'spot' },
    { name: 'Gamma Flip', value: '6,875', type: 'flip' },
    { name: 'VWAP', value: '6,885', type: 'vwap' },
    { name: 'Resistance 1', value: '6,900', type: 'resistance' },
    { name: 'Resistance 2', value: '6,925', type: 'resistance' },
    { name: 'Support 1', value: '6,850', type: 'support' },
    { name: 'Support 2', value: '6,800', type: 'support' },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      {/* Alert Banner */}
      {showAlert && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-gradient-to-r from-emerald-500 to-emerald-600 text-black px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-pulse">
          <span className="text-2xl">🟢</span>
          <div>
            <div className="font-bold">NEW SIGNAL: LONG REVERSAL</div>
            <div className="text-sm opacity-90">Entry: 6,875 | Target: 6,897 | R:R 2.2:1</div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex justify-between items-center sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center font-bold text-xl">Ω</div>
          <div>
            <div className="text-lg font-bold bg-gradient-to-r from-white to-blue-400 bg-clip-text text-transparent">TITAN OMEGA</div>
            <div className="text-xs text-gray-500 tracking-wider">INSTITUTIONAL FLOW DETECTION</div>
          </div>
        </div>
        
        <div className="flex gap-4">
          {[
            { label: 'SPX', value: spotPrice.toFixed(2) },
            { label: 'Change', value: '+0.28%', color: 'text-emerald-400' },
            { label: 'VIX', value: '15.82' },
            { label: 'Net GEX', value: '+2.4B', color: 'text-emerald-400' },
            { label: 'γ Flip', value: '6,875' },
          ].map((stat, i) => (
            <div key={i} className="text-center px-3 py-1 bg-gray-800 rounded-lg border border-gray-700">
              <div className={`font-mono font-bold ${stat.color || 'text-white'}`}>{stat.value}</div>
              <div className="text-xs text-gray-500">{stat.label}</div>
            </div>
          ))}
        </div>
        
        <div className="flex items-center gap-3">
          <div className="px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded text-sm font-semibold">MARKET OPEN</div>
          <div className="font-mono text-gray-400">{formatTime(currentTime)}</div>
          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-sm">Live</span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="grid grid-cols-12 gap-3 p-3 h-[calc(100vh-64px)]">
        
        {/* Left Panel - Signals */}
        <aside className="col-span-3 bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden">
          <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
            <span className="text-sm font-semibold text-gray-400 tracking-wide">🎯 ACTIVE SIGNALS</span>
            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full text-xs font-bold">3 Active</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {signals.map((signal, i) => (
              <div key={i} className={`bg-gray-800 rounded-lg p-3 border-l-4 ${signal.direction === 'long' ? 'border-emerald-500' : 'border-red-500'} ${signal.active ? 'ring-1 ring-emerald-500/50' : ''} hover:bg-gray-750 transition-all cursor-pointer`}>
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <span>{signal.direction === 'long' ? '🟢' : '🔴'}</span>
                    <span className={`text-xs font-bold tracking-wide ${signal.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>{signal.type}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-blue-400 font-semibold">{signal.confidence}%</div>
                    <div className="text-xs text-gray-500">{signal.time}</div>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mb-3 leading-relaxed">{signal.reason}</p>
                <div className="grid grid-cols-4 gap-1.5 mb-3">
                  {[
                    { label: 'Entry', value: signal.entry, color: 'text-white' },
                    { label: 'Stop', value: signal.stop, color: 'text-red-400' },
                    { label: 'TP1', value: signal.tp1, color: 'text-emerald-400' },
                    { label: 'TP2', value: signal.tp2, color: 'text-emerald-400/70' },
                  ].map((level, j) => (
                    <div key={j} className="bg-gray-900 rounded p-1.5 text-center">
                      <div className={`font-mono text-sm font-bold ${level.color}`}>{level.value.toLocaleString()}</div>
                      <div className="text-xs text-gray-600">{level.label}</div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1 mb-3">
                  {signal.triggers.map((t, j) => (
                    <span key={j} className="px-2 py-0.5 bg-gray-900 rounded text-xs text-gray-400 border border-gray-700">{t}</span>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-gray-700">
                  <div className="flex-1 mr-3">
                    <div className="text-xs text-gray-500 mb-1">Confidence</div>
                    <div className="h-1.5 bg-gray-900 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full" style={{width: `${signal.confidence}%`}}></div>
                    </div>
                  </div>
                  <div className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-sm font-bold">{signal.rr}:1</div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Center Panel */}
        <section className="col-span-6 flex flex-col gap-3">
          {/* GEX Profile */}
          <div className="flex-1 bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden">
            <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-400 tracking-wide">📊 GEX PROFILE BY STRIKE</span>
              <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full text-xs font-bold">Live</span>
            </div>
            <div className="flex-1 p-3 overflow-y-auto space-y-1">
              {gexData.map((row, i) => (
                <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded ${row.isSpot ? 'bg-blue-500/10' : row.isFlip ? 'bg-yellow-500/10' : ''}`}>
                  <span className={`w-14 text-right font-mono text-sm ${row.isSpot ? 'text-blue-400 font-bold' : 'text-gray-500'}`}>
                    {row.strike.toLocaleString()}{row.isSpot ? ' ◀' : row.isFlip ? ' ⚡' : ''}
                  </span>
                  <div className="flex-1 h-5 relative flex items-center">
                    <div className="absolute left-1/2 w-px h-full bg-gray-700"></div>
                    <div className="w-full flex justify-center">
                      {row.gex >= 0 ? (
                        <div className="h-4 bg-gradient-to-r from-emerald-500/30 to-emerald-500 rounded-sm" style={{width: `${Math.abs(row.gex) * 20}%`, marginLeft: '50%', transform: 'translateX(0)'}}></div>
                      ) : (
                        <div className="h-4 bg-gradient-to-l from-red-500/30 to-red-500 rounded-sm" style={{width: `${Math.abs(row.gex) * 20}%`, marginRight: '50%', transform: 'translateX(0)'}}></div>
                      )}
                    </div>
                  </div>
                  <span className={`w-12 font-mono text-xs ${row.gex >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {row.gex >= 0 ? '+' : ''}{row.gex.toFixed(1)}B
                  </span>
                </div>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-gray-800 flex justify-center gap-6 text-xs">
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-500 rounded-sm"></div> Support (Buy)</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-red-500 rounded-sm"></div> Resistance (Sell)</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-yellow-500 rounded-sm"></div> Gamma Flip</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-500 rounded-sm"></div> Spot</div>
            </div>
          </div>

          {/* History */}
          <div className="h-48 bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden">
            <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-400 tracking-wide">📜 SIGNAL HISTORY</span>
              <span className="text-xs text-gray-500">Last 24h</span>
            </div>
            <div className="flex-1 p-3 overflow-y-auto space-y-2">
              {history.map((h, i) => (
                <div key={i} className={`flex items-center justify-between px-3 py-2 bg-gray-800 rounded-lg border-l-2 ${h.type.includes('LONG') || h.type.includes('SQUEEZE') ? 'border-emerald-500' : 'border-red-500'}`}>
                  <span className={`text-xs font-bold ${h.type.includes('LONG') || h.type.includes('SQUEEZE') ? 'text-emerald-400' : 'text-red-400'}`}>{h.type}</span>
                  <span className="font-mono text-xs text-gray-400">{h.levels}</span>
                  <span className="text-xs text-gray-500">{h.time}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${h.result === 'win' ? 'bg-emerald-500/20 text-emerald-400' : h.result === 'loss' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                    {h.result.toUpperCase()} {h.pnl}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Right Panel - Context */}
        <aside className="col-span-3 bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden">
          <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
            <span className="text-sm font-semibold text-gray-400 tracking-wide">📈 MARKET CONTEXT</span>
            <span className="text-xs text-gray-500">🔄 2s ago</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Metrics */}
            <div>
              <div className="text-xs text-gray-500 mb-2 pb-1 border-b border-gray-800">CORE METRICS</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'SPX Spot', value: spotPrice.toFixed(2) },
                  { label: 'VIX', value: '15.82' },
                  { label: 'Net GEX', value: '+2.4B', color: 'text-emerald-400' },
                  { label: 'Gamma Flip', value: '6,875', color: 'text-yellow-400' },
                ].map((m, i) => (
                  <div key={i} className="bg-gray-800 rounded-lg p-2 border border-gray-700">
                    <div className={`font-mono font-bold text-lg ${m.color || 'text-white'}`}>{m.value}</div>
                    <div className="text-xs text-gray-500">{m.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Regime */}
            <div>
              <div className="text-xs text-gray-500 mb-2 pb-1 border-b border-gray-800">DEALER REGIME</div>
              <div className="bg-emerald-500/10 border border-emerald-500/50 rounded-lg p-3 flex items-center gap-3">
                <div className="w-11 h-11 bg-emerald-500 rounded-lg flex items-center justify-center text-xl">🟢</div>
                <div>
                  <div className="font-bold text-emerald-400">Positive Gamma</div>
                  <div className="text-xs text-gray-400">Dealers BUY dips, SELL rips. Vol suppressed.</div>
                </div>
              </div>
            </div>

            {/* Key Levels */}
            <div>
              <div className="text-xs text-gray-500 mb-2 pb-1 border-b border-gray-800">KEY GEX LEVELS</div>
              <div className="space-y-1.5">
                {keyLevels.map((level, i) => (
                  <div key={i} className={`flex justify-between items-center px-3 py-2 rounded-lg border ${level.type === 'spot' ? 'bg-blue-500/10 border-blue-500/50' : 'bg-gray-800 border-gray-700'}`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        level.type === 'spot' ? 'bg-blue-400' :
                        level.type === 'flip' ? 'bg-yellow-400' :
                        level.type === 'vwap' ? 'bg-purple-400' :
                        level.type === 'support' ? 'bg-emerald-400' : 'bg-red-400'
                      }`}></div>
                      <span className="text-sm text-gray-400">{level.name}</span>
                    </div>
                    <span className={`font-mono font-semibold ${
                      level.type === 'spot' ? 'text-blue-400' :
                      level.type === 'flip' ? 'text-yellow-400' :
                      level.type === 'vwap' ? 'text-purple-400' :
                      level.type === 'support' ? 'text-emerald-400' : 'text-red-400'
                    }`}>{level.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Session Stats */}
            <div>
              <div className="text-xs text-gray-500 mb-2 pb-1 border-b border-gray-800">SESSION STATS</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Win Rate (24h)', value: '68%', color: 'text-blue-400' },
                  { label: 'P&L (24h)', value: '+1.84%', color: 'text-emerald-400' },
                  { label: 'Signals Today', value: '5' },
                  { label: 'Avg R:R', value: '2.1:1' },
                ].map((s, i) => (
                  <div key={i} className="bg-gray-800 rounded-lg p-2 border border-gray-700">
                    <div className={`font-mono font-bold ${s.color || 'text-white'}`}>{s.value}</div>
                    <div className="text-xs text-gray-500">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};

export default TitanOmegaDashboard;
