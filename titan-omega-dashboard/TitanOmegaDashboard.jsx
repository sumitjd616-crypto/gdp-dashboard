import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Titan Omega Dashboard (self-contained)
 *
 * Implements:
 * - WebSocket streaming (Polygon indices socket) with REST fallback
 * - After-hours persistence (localStorage cached last good snapshot)
 * - Model-based GEX profile (since real options chain requires higher tier)
 * - Weekly analysis (last ~5 daily bars)
 *
 * API key is read ONLY from `import.meta.env.VITE_MASSIVE_API_KEY`.
 */

const API_KEY = import.meta?.env?.VITE_MASSIVE_API_KEY;
const POLYGON_BASE_URL = 'https://api.polygon.io';
const STORAGE_KEY = 'titan_omega_session_v1';

function safeNow() {
  return new Date();
}

function formatETTime(date) {
  try {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'America/New_York',
    });
  } catch {
    // Fallback if timeZone unsupported
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
}

function roundTo(x, step) {
  return Math.round(x / step) * step;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function loadSession() {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

async function fetchPrevDayIndex(ticker) {
  // ticker: "I:SPX" | "I:VIX"
  const res = await fetch(`${POLYGON_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?apiKey=${encodeURIComponent(API_KEY)}`);
  const json = await res.json();
  const r = json?.results?.[0];
  if (!r) return null;
  return {
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: r.v,
    timestamp: r.t ? new Date(r.t) : safeNow(),
    source: 'REST_PREV_DAY',
  };
}

async function fetchDailyBars(ticker, days = 7) {
  // Returns newest-first array of bars with { date, open, high, low, close }
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url =
    `${POLYGON_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(ticker)}` +
    `/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=10&apiKey=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(url);
  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  return results.map((b) => ({
    date: new Date(b.t).toISOString().slice(0, 10),
    timestamp: new Date(b.t),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
}

/**
 * Model-based GEX profile.
 * This is a *proxy* that approximates typical SPX dealer positioning around spot
 * and round-number OI concentrations.
 */
function buildModelGEXProfile(spot, vix = 15) {
  const iv = (Number(vix) || 15) / 100;
  const roundedSpot = roundTo(spot, 5);
  const strikeStep = 5;
  const n = 44; // strikes on each side / coverage

  // Use VIX as a rough daily vol proxy -> scale "walls" and flip spacing
  const volPts = clamp(spot * iv * Math.sqrt(1 / 252), 12, 80);
  const flip = roundTo(spot + (Math.random() - 0.5) * volPts * 0.4, 5);
  const majorCallWall = roundTo(spot + volPts * 1.2, 5);
  const majorPutWall = roundTo(spot - volPts * 1.2, 5);

  const heatmap = [];
  let netGEX = 0;

  for (let i = -n; i <= n; i += 1) {
    const strike = roundedSpot + i * strikeStep;
    const dist = Math.abs(strike - spot);
    const stepsAway = Math.abs(i);

    // Round-number concentration (50s strongest, then 25s)
    const roundBonus = strike % 50 === 0 ? 2.5 : strike % 25 === 0 ? 1.6 : 1;
    const atmDecay = Math.exp(-0.085 * stepsAway);

    // Sign convention: strikes above spot act like resistance (-GEX), below like support (+GEX)
    const direction = strike >= spot ? -1 : 1;

    // Larger magnitude near ATM and near major walls
    const wallBoost = Math.exp(-dist / Math.max(8, volPts * 0.5));
    const gex = direction * 100 * roundBonus * atmDecay * (0.6 + 0.7 * wallBoost);

    heatmap.push({ strike, gex });
    netGEX += gex;
  }

  const regime = netGEX >= 0 ? 'POSITIVE' : 'NEGATIVE';

  return {
    available: true,
    dataSource: 'MODEL',
    spot,
    timestamp: safeNow(),
    gammaFlip: flip,
    majorCallWall,
    majorPutWall,
    netGEX,
    regime,
    heatmap,
    analysis: {
      aboveGammaFlip: spot > flip,
      nearCallWall: Math.abs(spot - majorCallWall) < 10,
      nearPutWall: Math.abs(spot - majorPutWall) < 10,
    },
  };
}

function buildWeeklyAnalysis(gexProfile, dailyBars) {
  if (!gexProfile?.available) return { available: false, reason: 'GEX profile required' };
  if (!Array.isArray(dailyBars) || dailyBars.length === 0) return { available: false, reason: 'Daily bars required' };

  const weekBars = dailyBars.slice(0, 5);
  const weekHigh = Math.max(...weekBars.map((b) => b.high));
  const weekLow = Math.min(...weekBars.map((b) => b.low));
  const weekRange = weekHigh - weekLow;

  const lastBar = weekBars[0];
  const weekOpen = weekBars[weekBars.length - 1]?.open ?? lastBar.open;
  const weekClose = lastBar.close;
  const weekTrend = weekClose >= weekOpen ? 'BULLISH' : 'BEARISH';
  const weekChange = ((weekClose - weekOpen) / weekOpen) * 100;

  const atrDaily = weekBars.reduce((sum, b) => sum + (b.high - b.low), 0) / weekBars.length;
  const expectedWeekRange = atrDaily * 2.5;

  const notes = [];
  if (gexProfile.regime === 'POSITIVE') notes.push('Positive gamma proxy: expect mean reversion / dampened vol.');
  else notes.push('Negative gamma proxy: expect trend extension / amplified vol.');
  if (gexProfile.analysis?.nearCallWall) notes.push('Price near call wall: watch for rejection / resistance.');
  if (gexProfile.analysis?.nearPutWall) notes.push('Price near put wall: watch for bounce / support.');

  return {
    available: true,
    lastSession: {
      date: lastBar.date,
      close: lastBar.close,
      high: lastBar.high,
      low: lastBar.low,
    },
    weekSummary: {
      trend: weekTrend,
      change: `${weekChange.toFixed(2)}%`,
      high: weekHigh,
      low: weekLow,
      range: weekRange.toFixed(0),
    },
    nextWeekExpectation: {
      expectedRange: expectedWeekRange.toFixed(0),
      bullishTarget: (lastBar.close + expectedWeekRange * 0.6).toFixed(0),
      bearishTarget: (lastBar.close - expectedWeekRange * 0.6).toFixed(0),
    },
    keyLevels: {
      gammaFlip: gexProfile.gammaFlip,
      majorCallWall: gexProfile.majorCallWall,
      majorPutWall: gexProfile.majorPutWall,
      weeklyHigh: weekHigh,
      weeklyLow: weekLow,
    },
    outlook: {
      regime: gexProfile.regime,
      bias: gexProfile.analysis?.aboveGammaFlip ? 'BULLISH' : 'BEARISH',
      notes,
    },
  };
}

class MassiveService {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.lastError = null;
    this.onUpdate = null;
    this.onStatus = null;
  }

  connectIndices() {
    if (!API_KEY) throw new Error('Missing API key: set VITE_MASSIVE_API_KEY');
    const endpoint = 'wss://socket.polygon.io/indices';
    this.disconnect();

    const ws = new WebSocket(endpoint);
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'auth', params: API_KEY }));
      this.onStatus?.({ connected: true, mode: 'WS_CONNECTING' });
    };

    ws.onmessage = (event) => {
      let messages;
      try {
        messages = JSON.parse(event.data);
      } catch {
        return;
      }

      const list = Array.isArray(messages) ? messages : [messages];
      for (const msg of list) {
        if (msg?.ev === 'status') {
          if (msg.status === 'auth_success') {
            this.connected = true;
            // Subscribe to SPX + VIX values and minute bars
            ws.send(JSON.stringify({ action: 'subscribe', params: 'V.I:SPX,V.I:VIX,AM.I:SPX,AM.I:VIX' }));
            this.onStatus?.({ connected: true, mode: 'WS_LIVE' });
          }
          if (msg.status === 'auth_failed') {
            this.lastError = msg.message || 'auth_failed';
            this.onStatus?.({ connected: false, mode: 'WS_AUTH_FAILED', error: this.lastError });
          }
          continue;
        }

        // V = index value { ev:'V', val, T:'I:SPX', t }
        if (msg?.ev === 'V') {
          const sym = String(msg.T || '').replace('I:', '');
          const val = Number(msg.val ?? msg.v);
          const t = msg.t ? new Date(msg.t) : safeNow();
          if (sym === 'SPX') this.onUpdate?.({ type: 'SPX', price: val, timestamp: t, source: 'WS_V' });
          if (sym === 'VIX') this.onUpdate?.({ type: 'VIX', value: val, timestamp: t, source: 'WS_V' });
          continue;
        }

        // AM = aggregate minute bar { ev:'AM', sym:'I:SPX', o,h,l,c,v,s,e }
        if (msg?.ev === 'AM') {
          const sym = String(msg.sym || '').replace('I:', '');
          const bar = {
            timestamp: msg.s ? new Date(msg.s) : safeNow(),
            open: msg.o,
            high: msg.h,
            low: msg.l,
            close: msg.c,
            volume: msg.v,
            source: 'WS_AM',
          };
          if (sym === 'SPX') this.onUpdate?.({ type: 'SPX_BAR', bar });
          if (sym === 'VIX') this.onUpdate?.({ type: 'VIX_BAR', bar });
        }
      }
    };

    ws.onerror = () => {
      this.lastError = 'WebSocket error';
      this.onStatus?.({ connected: false, mode: 'WS_ERROR', error: this.lastError });
    };

    ws.onclose = () => {
      this.connected = false;
      this.onStatus?.({ connected: false, mode: 'WS_CLOSED' });
    };
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;
    this.connected = false;
  }

  setCallbacks({ onUpdate, onStatus }) {
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
  }
}

const massiveServiceSingleton = new MassiveService();

const Badge = ({ color = 'gray', children }) => {
  const cls =
    color === 'green'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : color === 'red'
        ? 'bg-red-500/15 text-red-300 border-red-500/30'
        : color === 'yellow'
          ? 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30'
          : color === 'blue'
            ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
            : 'bg-gray-500/10 text-gray-300 border-gray-700';
  return <span className={`px-2 py-0.5 text-xs rounded border ${cls}`}>{children}</span>;
};

export default function TitanOmegaDashboard() {
  const serviceRef = useRef(massiveServiceSingleton);
  const [time, setTime] = useState(safeNow());

  const [status, setStatus] = useState({ connected: false, mode: 'INIT' });
  const [spx, setSpx] = useState(null); // { price, timestamp, source, ... }
  const [vix, setVix] = useState(null); // { value, timestamp, source, ... }
  const [spxBars, setSpxBars] = useState([]); // most-recent-first
  const [dailyBars, setDailyBars] = useState([]); // most-recent-first
  const [error, setError] = useState(null);

  // Tick clock
  useEffect(() => {
    const t = setInterval(() => setTime(safeNow()), 1000);
    return () => clearInterval(t);
  }, []);

  // Load cached session immediately (after-hours persistence)
  useEffect(() => {
    const cached = loadSession();
    if (cached?.data?.spx && !spx) setSpx(cached.data.spx);
    if (cached?.data?.vix && !vix) setVix(cached.data.vix);
    if (Array.isArray(cached?.data?.spxBars) && spxBars.length === 0) setSpxBars(cached.data.spxBars);
    if (Array.isArray(cached?.data?.dailyBars) && dailyBars.length === 0) setDailyBars(cached.data.dailyBars);
  }, [dailyBars.length, spx, spxBars.length, vix]);

  // Connect WebSocket + REST fallback
  useEffect(() => {
    let cancelled = false;
    const svc = serviceRef.current;

    svc.setCallbacks({
      onStatus: (s) => {
        if (cancelled) return;
        setStatus(s);
      },
      onUpdate: (u) => {
        if (cancelled) return;

        if (u.type === 'SPX') {
          setSpx({ price: u.price, timestamp: u.timestamp, source: u.source });
        } else if (u.type === 'VIX') {
          setVix({ value: u.value, timestamp: u.timestamp, source: u.source });
        } else if (u.type === 'SPX_BAR') {
          setSpxBars((prev) => [u.bar, ...prev].slice(0, 500));
          // update last price from bar close if we don't have tick yet
          setSpx((prev) => prev || { price: u.bar.close, timestamp: u.bar.timestamp, source: u.bar.source });
        } else if (u.type === 'VIX_BAR') {
          setVix((prev) => prev || { value: u.bar.close, timestamp: u.bar.timestamp, source: u.bar.source });
        }
      },
    });

    const run = async () => {
      setError(null);
      if (!API_KEY) {
        setError('Missing API key: set VITE_MASSIVE_API_KEY');
        setStatus({ connected: false, mode: 'NO_API_KEY' });
        return;
      }

      // Try WS first
      try {
        svc.connectIndices();
      } catch (e) {
        setError(String(e?.message || e));
        setStatus({ connected: false, mode: 'WS_INIT_FAILED' });
      }

      // Always attempt REST initial snapshot (also used after-hours)
      try {
        const [spxPrev, vixPrev, dBars] = await Promise.all([fetchPrevDayIndex('I:SPX'), fetchPrevDayIndex('I:VIX'), fetchDailyBars('I:SPX', 10)]);
        if (cancelled) return;
        if (!spx && spxPrev) setSpx({ price: spxPrev.close, timestamp: spxPrev.timestamp, source: spxPrev.source });
        if (!vix && vixPrev) setVix({ value: vixPrev.close, timestamp: vixPrev.timestamp, source: vixPrev.source });
        if (Array.isArray(dBars) && dBars.length > 0) setDailyBars(dBars);
        if (spxPrev || vixPrev) setStatus((prev) => (prev?.mode?.startsWith('WS_') ? prev : { connected: false, mode: 'REST_OK' }));
      } catch (e) {
        if (cancelled) return;
        setError((prev) => prev || `REST failed: ${String(e?.message || e)}`);
        setStatus((prev) => (prev?.mode?.startsWith('WS_') ? prev : { connected: false, mode: 'REST_FAILED' }));
      }
    };

    run();
    return () => {
      cancelled = true;
      svc.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist session whenever we have something meaningful
  useEffect(() => {
    saveSession({
      timestamp: safeNow().toISOString(),
      data: {
        spx,
        vix,
        spxBars,
        dailyBars,
      },
    });
  }, [dailyBars, spx, spxBars, vix]);

  const spot = spx?.price ? Number(spx.price) : null;
  const vixVal = vix?.value ? Number(vix.value) : null;

  const gex = useMemo(() => {
    if (!spot) return null;
    return buildModelGEXProfile(spot, vixVal || 15);
  }, [spot, vixVal]);

  const weekly = useMemo(() => {
    if (!gex || dailyBars.length === 0) return null;
    return buildWeeklyAnalysis(gex, dailyBars);
  }, [dailyBars, gex]);

  const heatmap = gex?.heatmap || [];
  const maxAbs = useMemo(() => Math.max(1, ...heatmap.map((h) => Math.abs(h.gex))), [heatmap]);

  if (!API_KEY && !spot) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="text-xl font-bold mb-2">TITAN OMEGA</div>
          <div className="text-sm text-gray-400">
            Missing API key. Set <code className="font-mono">VITE_MASSIVE_API_KEY</code> in your environment.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <header className="bg-gray-900/95 border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
        <div className="max-w-[1400px] mx-auto flex justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center text-xl font-bold">Ω</div>
            <div>
              <div className="text-lg font-bold">TITAN OMEGA</div>
              <div className="text-xs text-gray-500">
                {status?.mode === 'WS_LIVE' ? '🟢 LIVE STREAM' : '🟡 REST / CACHED'} · GEX: MODEL
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-xs text-gray-500">SPX</div>
              <div className="text-2xl font-mono font-bold">{spot ? spot.toFixed(2) : '—'}</div>
              <div className="text-xs text-gray-600">{spx?.timestamp ? formatETTime(new Date(spx.timestamp)) : ''} ET</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-500">VIX</div>
              <div className="text-xl font-mono">{vixVal ? vixVal.toFixed(2) : '—'}</div>
              <div className="text-xs text-gray-600">{vix?.timestamp ? formatETTime(new Date(vix.timestamp)) : ''} ET</div>
            </div>
            {gex && (
              <div className="flex items-center gap-2">
                <Badge color="yellow">γ-Flip {gex.gammaFlip}</Badge>
                <Badge color="red">Call {gex.majorCallWall}</Badge>
                <Badge color="green">Put {gex.majorPutWall}</Badge>
                <Badge color={gex.regime === 'POSITIVE' ? 'green' : 'red'}>{gex.regime === 'POSITIVE' ? '+γ' : '-γ'}</Badge>
              </div>
            )}
            <div className="font-mono text-gray-400">{formatETTime(time)} ET</div>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto grid grid-cols-12 gap-3 p-3">
        <aside className="col-span-12 lg:col-span-4 space-y-3">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-gray-300">Connection</div>
              <Badge color={status?.mode === 'WS_LIVE' ? 'green' : 'yellow'}>{status?.mode || '—'}</Badge>
            </div>
            <div className="text-xs text-gray-400">
              Source: <span className="font-mono">{spx?.source || '—'}</span> / <span className="font-mono">{vix?.source || '—'}</span>
            </div>
            {error && <div className="mt-2 text-xs text-red-300">Error: {error}</div>}
            {!error && status?.mode !== 'WS_LIVE' && (
              <div className="mt-2 text-xs text-gray-500">
                Using REST and/or cached last session for after-hours persistence.
              </div>
            )}
          </div>

          {weekly?.available && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-sm font-semibold text-gray-300 mb-2">Weekly Analysis</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-2">
                  <div className="text-gray-500">Trend</div>
                  <div className="font-mono font-bold">{weekly.weekSummary.trend}</div>
                </div>
                <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-2">
                  <div className="text-gray-500">Change</div>
                  <div className="font-mono font-bold">{weekly.weekSummary.change}</div>
                </div>
                <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-2">
                  <div className="text-gray-500">Week High</div>
                  <div className="font-mono font-bold">{weekly.weekSummary.high.toFixed(0)}</div>
                </div>
                <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-2">
                  <div className="text-gray-500">Week Low</div>
                  <div className="font-mono font-bold">{weekly.weekSummary.low.toFixed(0)}</div>
                </div>
              </div>
              <div className="mt-3 text-xs text-gray-400">
                <div className="font-semibold text-gray-300 mb-1">Outlook</div>
                <div className="mb-1">
                  Bias: <span className="font-mono">{weekly.outlook.bias}</span> · Regime:{' '}
                  <span className="font-mono">{weekly.outlook.regime}</span>
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  {weekly.outlook.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </aside>

        <section className="col-span-12 lg:col-span-8 space-y-3">
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-800/40 border-b border-gray-800 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-300">GEX Heatmap (Model)</div>
              <div className="flex gap-2 text-xs">
                <span className="text-emerald-400">■ Support (+GEX)</span>
                <span className="text-red-400">■ Resistance (-GEX)</span>
              </div>
            </div>
            <div className="p-3 max-h-[520px] overflow-y-auto space-y-1">
              {heatmap.length === 0 && <div className="text-sm text-gray-500">Waiting for price…</div>}
              {heatmap.map((h) => {
                const isSpot = spot != null && Math.abs(h.strike - spot) < 2.5;
                const isFlip = gex && Math.abs(h.strike - gex.gammaFlip) < 2.5;
                const isCall = gex && h.strike === gex.majorCallWall;
                const isPut = gex && h.strike === gex.majorPutWall;
                const w = Math.min(100, (Math.abs(h.gex) / maxAbs) * 100);
                const pos = h.gex >= 0;
                return (
                  <div
                    key={h.strike}
                    className={`flex items-center gap-2 px-2 py-1 rounded border ${
                      isSpot
                        ? 'bg-blue-500/15 border-blue-500/30'
                        : isFlip
                          ? 'bg-yellow-500/10 border-yellow-500/25'
                          : isCall
                            ? 'bg-red-500/10 border-red-500/25'
                            : isPut
                              ? 'bg-emerald-500/10 border-emerald-500/25'
                              : 'bg-gray-950/20 border-gray-800'
                    }`}
                  >
                    <div className={`w-20 text-right font-mono text-sm ${isSpot ? 'text-blue-300 font-bold' : 'text-gray-500'}`}>
                      {h.strike}
                      {isSpot ? ' ◄' : ''}
                      {isFlip ? ' ⚡' : ''}
                      {isCall ? ' 🧱' : ''}
                      {isPut ? ' 💎' : ''}
                    </div>
                    <div className="flex-1 h-4 relative">
                      <div className="absolute left-1/2 w-px h-full bg-gray-700" />
                      <div className="w-full flex justify-center">
                        {pos ? (
                          <div className="h-3 bg-emerald-500 rounded-sm" style={{ width: `${w}%`, marginLeft: '50%' }} />
                        ) : (
                          <div className="h-3 bg-red-500 rounded-sm" style={{ width: `${w}%`, marginRight: '50%' }} />
                        )}
                      </div>
                    </div>
                    <div className={`w-16 text-right font-mono text-xs ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pos ? '+' : ''}
                      {h.gex.toFixed(0)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-sm font-semibold text-gray-300 mb-2">After-hours persistence</div>
            <div className="text-xs text-gray-400">
              Last cached session is stored in <code className="font-mono">{STORAGE_KEY}</code>. If markets are closed or streaming is unavailable,
              the dashboard will continue showing the last known SPX/VIX snapshot plus last fetched daily bars.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

