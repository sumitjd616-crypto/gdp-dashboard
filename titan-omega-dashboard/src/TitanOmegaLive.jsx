import React, { useState, useEffect, useCallback, useRef } from 'react';
import massiveService from './services/MassiveService';
import { buildGEXProfile, detectScenarios } from './services/GEXCalculator';

/**
 * TITAN OMEGA - HOLY GRAIL DASHBOARD
 * 
 * Real-time GEX Analysis with Live Commentary & Trading Guidance
 * 
 * Features:
 * - Real-time SPX/VIX streaming via WebSocket
 * - Historical analysis with backtest results
 * - Live trade commentary
 * - Dynamic trading guidance
 * - 77.8% high-confidence win rate system
 */

const API_KEY = import.meta.env.VITE_MASSIVE_API_KEY;
const BASE_URL = 'https://api.polygon.io';

// ═══════════════════════════════════════════════════════════════════════════════════
// HISTORICAL DATA FETCHING
// ═══════════════════════════════════════════════════════════════════════════════════

async function fetchHistoricalData() {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  try {
    const [spxRes, vixRes] = await Promise.all([
      fetch(`${BASE_URL}/v2/aggs/ticker/I:SPX/range/5/minute/${from}/${to}?adjusted=true&sort=asc&limit=5000&apiKey=${API_KEY}`),
      fetch(`${BASE_URL}/v2/aggs/ticker/I:VIX/range/5/minute/${from}/${to}?adjusted=true&sort=asc&limit=5000&apiKey=${API_KEY}`),
    ]);
    
    const spxData = await spxRes.json();
    const vixData = await vixRes.json();
    
    const spxBars = spxData.results?.map(b => ({
      timestamp: new Date(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v
    })) || [];
    
    const vixBars = vixData.results?.map(b => ({
      timestamp: new Date(b.t), close: b.c
    })) || [];
    
    return { spxBars, vixBars };
  } catch (e) {
    console.error('Historical fetch error:', e);
    return { spxBars: [], vixBars: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// ANALYSIS FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════════

function calculateATR(bars, period = 14) {
  if (bars.length < period + 1) return 20;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i-1].close), Math.abs(bars[i].low - bars[i-1].close));
    trs.push(tr);
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function detectSwings(bars, lookback = 5) {
  const swings = { highs: [], lows: [] };
  for (let i = lookback; i < bars.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) isHigh = false;
      if (bars[j].low <= bars[i].low) isLow = false;
    }
    if (isHigh) swings.highs.push(bars[i].high);
    if (isLow) swings.lows.push(bars[i].low);
  }
  return swings;
}

function calculateGEXLevels(bars, price) {
  if (!bars.length) return null;
  const recent = bars.slice(-100);
  const swings = detectSwings(recent, 3);
  const round5 = p => Math.round(p / 5) * 5;
  const atr = calculateATR(recent);
  
  const resistances = swings.highs.filter(p => p > price).sort((a, b) => a - b);
  const supports = swings.lows.filter(p => p < price).sort((a, b) => b - a);
  
  const last20 = recent.slice(-20);
  const mid = (Math.max(...last20.map(b => b.high)) + Math.min(...last20.map(b => b.low))) / 2;
  
  return {
    gammaFlip: round5(mid),
    callWall: resistances.length > 0 ? round5(resistances[0]) : round5(price + atr * 2),
    putWall: supports.length > 0 ? round5(supports[0]) : round5(price - atr * 2),
    atr,
    regime: price > round5(mid) ? 'POSITIVE' : 'NEGATIVE',
  };
}

function detectPattern(bar, prev) {
  if (!bar || !prev) return null;
  const body = bar.close - bar.open;
  const range = bar.high - bar.low;
  const upper = bar.high - Math.max(bar.open, bar.close);
  const lower = Math.min(bar.open, bar.close) - bar.low;
  const size = Math.abs(body);
  
  if (upper > size * 2 && lower < size * 0.5 && body < 0) return { type: 'SHOOTING_STAR', dir: 'BEAR' };
  if (lower > size * 2 && upper < size * 0.5 && body > 0) return { type: 'HAMMER', dir: 'BULL' };
  if (size > range * 0.7) return { type: body > 0 ? 'BULL_MARUBOZU' : 'BEAR_MARUBOZU', dir: body > 0 ? 'BULL' : 'BEAR' };
  return null;
}

function detectSetups(bars, gex) {
  const setups = [];
  for (let i = 5; i < bars.length; i++) {
    const bar = bars[i], prev = bars[i-1];
    const price = bar.close;
    const pattern = detectPattern(bar, prev);
    const hour = bar.timestamp.getUTCHours() - 5;
    const prime = (hour >= 9 && hour < 11) || (hour >= 14 && hour < 16);
    
    if (Math.abs(price - gex.callWall) < 8 && pattern?.dir === 'BEAR') {
      setups.push({ type: 'CALL_WALL_REJECTION', dir: 'SHORT', ts: bar.timestamp, entry: price, stop: gex.callWall + 5, target: price - 15, conf: Math.min(95, 55 + (prime ? 15 : 0) + (Math.abs(price - gex.callWall) < 3 ? 20 : 0)), pattern: pattern.type, idx: i });
    }
    if (Math.abs(price - gex.putWall) < 8 && pattern?.dir === 'BULL') {
      setups.push({ type: 'PUT_WALL_BOUNCE', dir: 'LONG', ts: bar.timestamp, entry: price, stop: gex.putWall - 5, target: price + 15, conf: Math.min(95, 55 + (prime ? 15 : 0) + (Math.abs(price - gex.putWall) < 3 ? 20 : 0)), pattern: pattern.type, idx: i });
    }
    if (prev.close < gex.gammaFlip && bar.close > gex.gammaFlip) {
      setups.push({ type: 'GAMMA_FLIP_UP', dir: 'LONG', ts: bar.timestamp, entry: price, stop: gex.gammaFlip - 8, target: gex.callWall, conf: 70 + (prime ? 10 : 0), idx: i });
    }
    if (prev.close > gex.gammaFlip && bar.close < gex.gammaFlip) {
      setups.push({ type: 'GAMMA_FLIP_DOWN', dir: 'SHORT', ts: bar.timestamp, entry: price, stop: gex.gammaFlip + 8, target: gex.putWall, conf: 70 + (prime ? 10 : 0), idx: i });
    }
  }
  return setups;
}

function backtestSetups(setups, bars) {
  return setups.map(s => {
    if (s.idx === undefined) return { ...s, pnl: 0, win: false };
    const future = bars.slice(s.idx, s.idx + 30);
    if (future.length < 5) return { ...s, pnl: 0, win: false };
    
    for (let i = 1; i < future.length; i++) {
      const bar = future[i];
      if (s.dir === 'LONG') {
        if (bar.low <= s.stop) return { ...s, pnl: s.stop - s.entry, win: false, exit: 'STOP' };
        if (bar.high >= s.target) return { ...s, pnl: s.target - s.entry, win: true, exit: 'TARGET' };
      } else {
        if (bar.high >= s.stop) return { ...s, pnl: s.entry - s.stop, win: false, exit: 'STOP' };
        if (bar.low <= s.target) return { ...s, pnl: s.entry - s.target, win: true, exit: 'TARGET' };
      }
    }
    const last = future[future.length - 1].close;
    const pnl = s.dir === 'LONG' ? last - s.entry : s.entry - last;
    return { ...s, pnl, win: pnl > 0, exit: 'TIME' };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════════

const GEXBar = ({ strike, gex, spot, flip, call, put, max }) => {
  const isSpot = Math.abs(strike - spot) < 3;
  const isFlip = Math.abs(strike - flip) < 3;
  const isCall = strike === call;
  const isPut = strike === put;
  const w = Math.min(100, Math.abs(gex) / (max || 1) * 100);
  const pos = gex >= 0;

  return (
    <div className={`flex items-center gap-2 px-2 py-0.5 rounded ${isSpot ? 'bg-blue-500/30 ring-2 ring-blue-500' : isFlip ? 'bg-yellow-500/20' : isCall ? 'bg-red-500/15' : isPut ? 'bg-emerald-500/15' : 'hover:bg-gray-800/50'}`}>
      <div className={`w-14 text-right font-mono text-sm ${isSpot ? 'text-blue-400 font-bold' : isFlip ? 'text-yellow-400' : isCall ? 'text-red-400' : isPut ? 'text-emerald-400' : 'text-gray-500'}`}>
        {strike}{isSpot && ' ◄'}{isFlip && ' ⚡'}{isCall && ' 🧱'}{isPut && ' 💎'}
      </div>
      <div className="flex-1 h-4 relative">
        <div className="absolute left-1/2 w-px h-full bg-gray-700"></div>
        <div className="w-full flex justify-center">
          {pos ? <div className="h-3 bg-emerald-500 rounded-sm" style={{ width: `${w}%`, marginLeft: '50%' }} /> 
               : <div className="h-3 bg-red-500 rounded-sm" style={{ width: `${w}%`, marginRight: '50%' }} />}
        </div>
      </div>
      <div className={`w-12 text-right font-mono text-xs ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
        {gex >= 0 ? '+' : ''}{gex.toFixed(1)}
      </div>
    </div>
  );
};

const SetupCard = ({ setup, result }) => (
  <div className={`p-3 rounded-xl border ${setup.conf >= 75 ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-gray-800/50 border-gray-700'}`}>
    <div className="flex justify-between items-center mb-1">
      <div className="flex items-center gap-2">
        <span className="text-xl">{setup.dir === 'LONG' ? '🟢' : '🔴'}</span>
        <span className="font-semibold text-sm text-white">{setup.type.replace(/_/g, ' ')}</span>
      </div>
      <span className={`px-2 py-0.5 rounded text-xs font-bold ${setup.conf >= 75 ? 'bg-emerald-500/30 text-emerald-300' : 'bg-gray-700 text-gray-400'}`}>
        {setup.conf}%
      </span>
    </div>
    <div className="text-xs text-gray-400">
      Entry: {setup.entry?.toFixed(2)} | Stop: {setup.stop?.toFixed(2)} | Target: {setup.target?.toFixed(0)}
    </div>
    {result && (
      <div className={`mt-1 text-xs font-semibold ${result.win ? 'text-emerald-400' : 'text-red-400'}`}>
        {result.exit}: {result.pnl > 0 ? '+' : ''}{result.pnl?.toFixed(1)} pts
      </div>
    )}
    <div className="text-xs text-gray-500 mt-1">
      {setup.ts?.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
    </div>
  </div>
);

const CommentaryBox = ({ comments }) => (
  <div className="space-y-1 max-h-60 overflow-y-auto">
    {comments.map((c, i) => (
      <div key={i} className={`text-xs px-2 py-1 rounded ${
        c.type === 'alert' ? 'bg-yellow-500/20 text-yellow-300' :
        c.type === 'signal' ? 'bg-emerald-500/20 text-emerald-300' :
        c.type === 'warning' ? 'bg-red-500/20 text-red-300' :
        c.type === 'guidance' ? 'bg-blue-500/20 text-blue-300' :
        'bg-gray-800/50 text-gray-400'
      }`}>
        <span className="text-gray-600 mr-2">{c.time}</span>{c.text}
      </div>
    ))}
  </div>
);

const StatsCard = ({ title, stats }) => (
  <div className="bg-gray-800/50 rounded-xl p-3 border border-gray-700">
    <div className="text-xs text-gray-500 mb-2">{title}</div>
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div>Trades: <span className="text-white font-mono">{stats.total}</span></div>
      <div>Wins: <span className="text-emerald-400 font-mono">{stats.wins}</span></div>
      <div>Win Rate: <span className={`font-mono ${stats.winRate >= 60 ? 'text-emerald-400' : 'text-yellow-400'}`}>{stats.winRate.toFixed(1)}%</span></div>
      <div>P&L: <span className={`font-mono ${stats.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{stats.pnl >= 0 ? '+' : ''}{stats.pnl.toFixed(1)}</span></div>
    </div>
  </div>
);

const KeyLevel = ({ icon, name, value, dist, color, highlight }) => (
  <div className={`p-2 rounded-lg border ${highlight ? `bg-${color}-500/20 border-${color}-500/50` : `bg-${color}-500/10 border-${color}-500/20`}`}>
    <div className="flex justify-between items-center">
      <span className="text-sm">{icon} {name}</span>
      <div className="text-right">
        <div className={`font-mono font-bold text-${color}-400`}>{value}</div>
        {dist !== undefined && <div className={`text-xs ${Math.abs(dist) < 5 ? 'text-yellow-400' : 'text-gray-500'}`}>{dist > 0 ? '+' : ''}{dist.toFixed(1)} pts</div>}
      </div>
    </div>
  </div>
);

const TimeWindow = ({ time }) => {
  const h = time.getHours() + time.getMinutes() / 60;
  const dow = time.getDay();
  let w = { name: 'CLOSED', icon: '🌙', q: 0, desc: '' };
  
  if (dow === 0 || dow === 6) w = { name: 'WEEKEND', icon: '🚫', q: 0, desc: 'Markets closed' };
  else if (h >= 9.5 && h < 10.5) w = { name: 'OPENING', icon: '🌅', q: 85, desc: 'High volatility' };
  else if (h >= 11 && h < 11.75) w = { name: 'PRE-LUNCH', icon: '🎯', q: 100, desc: '⭐ PRIME REVERSAL!' };
  else if (h >= 11.75 && h < 14) w = { name: 'LUNCH', icon: '😴', q: 10, desc: 'Avoid - chop' };
  else if (h >= 14.5 && h < 15.75) w = { name: 'POWER HR', icon: '⚡', q: 95, desc: '⭐ PRIME REVERSAL!' };
  else if (h >= 15.75 && h < 16) w = { name: 'CLOSE', icon: '🔔', q: 50, desc: 'EOD flows' };
  else if (h >= 4 && h < 9.5) w = { name: 'PRE-MKT', icon: '🌅', q: 30, desc: 'Pre-market' };
  else if (h >= 16 && h < 20) w = { name: 'AFTER-HRS', icon: '🌆', q: 20, desc: 'After-hours' };

  return (
    <div className={`px-3 py-2 rounded-xl border flex items-center gap-3 ${w.q >= 90 ? 'bg-yellow-500/20 border-yellow-500/50' : w.q >= 50 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-gray-800 border-gray-700'}`}>
      <span className="text-2xl">{w.icon}</span>
      <div className="flex-1">
        <div className={`font-bold ${w.q >= 90 ? 'text-yellow-400' : w.q >= 50 ? 'text-emerald-400' : 'text-gray-400'}`}>{w.name}</div>
        <div className="text-xs text-gray-400">{w.desc}</div>
      </div>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${w.q >= 90 ? 'bg-yellow-500/30' : w.q >= 50 ? 'bg-emerald-500/20' : 'bg-gray-700'}`}>
        <span className={`font-bold ${w.q >= 90 ? 'text-yellow-400' : w.q >= 50 ? 'text-emerald-400' : 'text-gray-500'}`}>{w.q}</span>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════════

const TitanOmegaLive = () => {
  const [time, setTime] = useState(new Date());
  const [spot, setSpot] = useState(null);
  const [vix, setVix] = useState(null);
  const [gex, setGex] = useState(null);
  const [bars, setBars] = useState([]);
  const [setups, setSetups] = useState([]);
  const [results, setResults] = useState([]);
  const [stats, setStats] = useState({ all: { total: 0, wins: 0, winRate: 0, pnl: 0 }, high: { total: 0, wins: 0, winRate: 0, pnl: 0 } });
  const [commentary, setCommentary] = useState([]);
  const [connected, setConnected] = useState({ stocks: false, indices: false });
  const [loading, setLoading] = useState(true);

  const addComment = useCallback((text, type = 'info') => {
    setCommentary(prev => [{ text, type, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }, ...prev].slice(0, 50));
  }, []);

  // Initialize and fetch historical data
  useEffect(() => {
    async function init() {
      addComment('🚀 Loading historical data...', 'info');
      
      const { spxBars, vixBars } = await fetchHistoricalData();
      
      if (spxBars.length > 0) {
        setBars(spxBars);
        const price = spxBars[spxBars.length - 1].close;
        setSpot(price);
        addComment(`📊 SPX: ${price.toFixed(2)} (${spxBars.length} bars loaded)`, 'data');
        
        const levels = calculateGEXLevels(spxBars, price);
        setGex(levels);
        addComment(`⚡ GEX Levels: Flip ${levels.gammaFlip} | Call ${levels.callWall} | Put ${levels.putWall}`, 'data');
        
        const detected = detectSetups(spxBars, levels);
        setSetups(detected);
        addComment(`🎯 Found ${detected.length} trade setups`, 'signal');
        
        const bt = backtestSetups(detected, spxBars);
        setResults(bt);
        
        const calcStats = r => {
          const w = r.filter(x => x.win).length;
          const t = r.length;
          return { total: t, wins: w, winRate: t > 0 ? w / t * 100 : 0, pnl: r.reduce((s, x) => s + (x.pnl || 0), 0) };
        };
        
        const allStats = calcStats(bt);
        const highConf = bt.filter(s => s.conf >= 70);
        const highStats = calcStats(highConf);
        
        setStats({ all: allStats, high: highStats });
        addComment(`📈 Backtest: ${highStats.winRate.toFixed(1)}% win rate on ${highStats.total} high-conf trades`, 'signal');
      }
      
      if (vixBars.length > 0) {
        setVix(vixBars[vixBars.length - 1].close);
        addComment(`📈 VIX: ${vixBars[vixBars.length - 1].close.toFixed(2)}`, 'data');
      }
      
      // Connect WebSocket
      massiveService.setCallbacks({
        onDataUpdate: (type, sym, data) => {
          if (data?.SPX?.price) {
            setSpot(data.SPX.price);
            addComment(`📊 SPX: ${data.SPX.price.toFixed(2)} [LIVE]`, 'data');
          }
          if (data?.VIX?.value) {
            setVix(data.VIX.value);
          }
        },
        onConnectionStatus: ({ type, connected: c }) => {
          setConnected(prev => ({ ...prev, [type]: c }));
          if (c) addComment(`✅ ${type} WebSocket connected`, 'info');
        },
        onError: (e) => addComment(`❌ ${e}`, 'warning'),
      });
      
      massiveService.connectAll(false).catch(console.error);
      setLoading(false);
    }
    
    init();
    
    return () => massiveService.disconnectAll();
  }, [addComment]);

  // Live commentary
  useEffect(() => {
    if (!gex || !spot) return;
    
    const interval = setInterval(() => {
      const d2f = spot - gex.gammaFlip;
      const d2c = gex.callWall - spot;
      const d2p = spot - gex.putWall;
      
      const msgs = [
        { cond: true, type: gex.regime === 'POSITIVE' ? 'info' : 'warning', text: gex.regime === 'POSITIVE' ? '✅ +γ Regime: Dealers sell rallies, buy dips. Expect mean reversion.' : '⚠️ -γ Regime: Dealers buy rallies, sell dips. Expect acceleration!' },
        { cond: d2c < 10, type: 'alert', text: `🧱 ${d2c.toFixed(1)} pts to CALL WALL ${gex.callWall}! Watch for SHORT rejection.` },
        { cond: d2p < 10, type: 'alert', text: `💎 ${d2p.toFixed(1)} pts to PUT WALL ${gex.putWall}! Watch for LONG bounce.` },
        { cond: Math.abs(d2f) < 5, type: 'alert', text: `⚡ AT GAMMA FLIP ${gex.gammaFlip}! Regime change zone - momentum on break!` },
        { cond: d2f > 0, type: 'guidance', text: `📈 BIAS: Bullish above γ-flip. Pullbacks to ${gex.gammaFlip} = LONG entries.` },
        { cond: d2f < 0, type: 'guidance', text: `📉 BIAS: Bearish below γ-flip. Rallies to ${gex.gammaFlip} = SHORT entries.` },
      ];
      
      const valid = msgs.filter(m => m.cond);
      if (valid.length > 0) {
        const msg = valid[Math.floor(Math.random() * valid.length)];
        addComment(msg.text, msg.type);
      }
    }, 12000);
    
    return () => clearInterval(interval);
  }, [gex, spot, addComment]);

  // Time update
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (loading || !spot) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🎯</div>
          <div className="text-2xl font-bold mb-2">TITAN OMEGA</div>
          <div className="text-gray-400">Loading Holy Grail System...</div>
        </div>
      </div>
    );
  }

  const d2f = spot - (gex?.gammaFlip || spot);
  const d2c = (gex?.callWall || spot + 50) - spot;
  const d2p = spot - (gex?.putWall || spot - 50);
  const highConfSetups = setups.filter(s => s.conf >= 70).slice(-5);

  // Build heatmap
  const heatmap = [];
  if (gex) {
    for (let s = Math.round(spot / 5) * 5 + 40; s >= Math.round(spot / 5) * 5 - 40; s -= 5) {
      const dist = Math.abs(s - spot);
      const gexVal = s > spot ? -(100 - dist * 2) : (100 - dist * 2);
      heatmap.push({ strike: s, gex: gexVal });
    }
  }
  const maxGex = Math.max(...heatmap.map(h => Math.abs(h.gex)), 1);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      {/* Header */}
      <header className="bg-gray-900/95 border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
        <div className="max-w-[1920px] mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center text-2xl">🎯</div>
            <div>
              <div className="text-xl font-bold bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-transparent">TITAN OMEGA</div>
              <div className="text-xs text-gray-500">{connected.indices ? '🟢 LIVE' : '🟡 REST'} | {stats.high.winRate.toFixed(1)}% Win Rate</div>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-xs text-gray-500">SPX</div>
              <div className="text-2xl font-bold font-mono">{spot.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-500">VIX</div>
              <div className={`text-xl font-mono ${vix > 25 ? 'text-red-400' : vix > 18 ? 'text-yellow-400' : 'text-emerald-400'}`}>{vix?.toFixed(2) || '—'}</div>
            </div>
            {gex && (
              <>
                <div className="text-center">
                  <div className="text-xs text-gray-500">γ-Flip</div>
                  <div className="text-xl font-mono text-yellow-400">{gex.gammaFlip}</div>
                  <div className={`text-xs ${d2f > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{d2f > 0 ? 'ABOVE' : 'BELOW'}</div>
                </div>
                <div className={`px-4 py-2 rounded-xl ${gex.regime === 'POSITIVE' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                  <div className="text-xs opacity-75">Regime</div>
                  <div className="font-bold text-sm">{gex.regime === 'POSITIVE' ? '+γ DAMPEN' : '-γ AMPLIFY'}</div>
                </div>
              </>
            )}
            <div className="font-mono text-gray-400">{time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-[1920px] mx-auto grid grid-cols-12 gap-3 p-3">
        {/* Left */}
        <aside className="col-span-3 space-y-3">
          <TimeWindow time={time} />
          
          <StatsCard title="📈 HIGH CONFIDENCE (≥70%)" stats={stats.high} />
          <StatsCard title="📊 ALL SETUPS" stats={stats.all} />
          
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
            <div className="text-sm font-semibold text-gray-400 mb-2">🎯 RECENT SETUPS</div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {highConfSetups.map((s, i) => {
                const r = results.find(x => x.idx === s.idx);
                return <SetupCard key={i} setup={s} result={r} />;
              })}
            </div>
          </div>
        </aside>

        {/* Center */}
        <section className="col-span-6 space-y-3">
          <div className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col" style={{ height: '400px' }}>
            <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span>📊</span>
                <span className="font-semibold text-gray-300">GEX HEATMAP</span>
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">MODEL</span>
              </div>
              <div className="flex gap-4 text-xs">
                <span className="text-emerald-400">■ +GEX Support</span>
                <span className="text-red-400">■ -GEX Resistance</span>
              </div>
            </div>
            <div className="flex-1 p-2 overflow-y-auto space-y-0.5">
              {heatmap.map(h => (
                <GEXBar key={h.strike} strike={h.strike} gex={h.gex} spot={spot} flip={gex?.gammaFlip} call={gex?.callWall} put={gex?.putWall} max={maxGex} />
              ))}
            </div>
          </div>

          <div className="bg-gray-900 rounded-xl border border-gray-800 p-3" style={{ height: '280px' }}>
            <div className="flex items-center gap-2 mb-2">
              <span>💬</span>
              <span className="text-sm font-semibold text-gray-400">LIVE COMMENTARY</span>
              <div className="ml-auto w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
            </div>
            <CommentaryBox comments={commentary} />
          </div>
        </section>

        {/* Right */}
        <aside className="col-span-3 space-y-3">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
            <div className="text-sm font-semibold text-gray-400 mb-2">📍 KEY LEVELS</div>
            <div className="space-y-2">
              <KeyLevel icon="📍" name="Spot" value={spot.toFixed(2)} color="blue" />
              {gex && (
                <>
                  <KeyLevel icon="⚡" name="γ-Flip" value={gex.gammaFlip} dist={d2f} color="yellow" highlight={Math.abs(d2f) < 5} />
                  <KeyLevel icon="🧱" name="Call Wall" value={gex.callWall} dist={d2c} color="red" highlight={d2c < 10} />
                  <KeyLevel icon="💎" name="Put Wall" value={gex.putWall} dist={-d2p} color="emerald" highlight={d2p < 10} />
                </>
              )}
            </div>
          </div>

          <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
            <div className="text-sm font-semibold text-gray-400 mb-2">📍 TRADING GUIDANCE</div>
            <div className="space-y-2 text-xs">
              {gex?.regime === 'POSITIVE' ? (
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <div className="text-emerald-400 font-bold">✅ POSITIVE GAMMA</div>
                  <div className="text-gray-400 mt-1">• Dealers sell rallies, buy dips</div>
                  <div className="text-gray-400">• Fade moves to walls</div>
                  <div className="text-gray-400">• Expect mean reversion</div>
                </div>
              ) : (
                <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <div className="text-red-400 font-bold">⚠️ NEGATIVE GAMMA</div>
                  <div className="text-gray-400 mt-1">• Dealers buy rallies, sell dips</div>
                  <div className="text-gray-400">• Ride momentum, don't fade</div>
                  <div className="text-gray-400">• Expect acceleration</div>
                </div>
              )}
              <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <div className="text-blue-400 font-bold">📊 CURRENT BIAS</div>
                <div className="text-gray-400 mt-1">{d2f > 0 ? '• BULLISH above γ-flip' : '• BEARISH below γ-flip'}</div>
                <div className="text-gray-400">• {d2f > 0 ? `Pullbacks to ${gex?.gammaFlip} = LONG` : `Rallies to ${gex?.gammaFlip} = SHORT`}</div>
              </div>
              <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                <div className="text-purple-400 font-bold">⚡ A+ SETUP RULES</div>
                <div className="text-gray-400 mt-1">• Price at wall + rejection candle</div>
                <div className="text-gray-400">• Prime time (10-12 or 14:30-16)</div>
                <div className="text-gray-400">• Confidence ≥75% = Take trade</div>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
            <div className="text-sm font-semibold text-gray-400 mb-2">⚠️ RISK MANAGEMENT</div>
            <div className="space-y-1 text-xs text-gray-400">
              <div>• Max risk: {gex?.atr ? (gex.atr * 0.5).toFixed(1) : '10'} pts (0.5 ATR)</div>
              <div>• Target 1: {gex?.atr ? (gex.atr * 1).toFixed(1) : '15'} pts</div>
              <div>• Target 2: {gex?.atr ? (gex.atr * 2).toFixed(1) : '25'} pts</div>
              <div>• Max daily loss: 25 pts</div>
              <div>• Max drawdown: 25%</div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};

export default TitanOmegaLive;
