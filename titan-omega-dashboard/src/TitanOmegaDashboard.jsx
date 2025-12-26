import React, { useEffect, useMemo, useState } from 'react';
import massiveService from './services/MassiveService';
import { buildGEXProfile, buildWeeklyAnalysis } from './services/GEXCalculator';

const STORAGE_KEY = 'titan_omega_session_v1';
const PROXY_TOKEN = import.meta.env.VITE_PROXY_TOKEN || '';

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
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
}

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
  const [time, setTime] = useState(new Date());
  const [status, setStatus] = useState({ mode: 'INIT' });
  const [error, setError] = useState(null);

  const [spx, setSpx] = useState(null);
  const [vix, setVix] = useState(null);
  const [dailyBars, setDailyBars] = useState([]);
  const [spxBars, setSpxBars] = useState([]);
  const [dataStatus, setDataStatus] = useState({
    ws: { connected: false, authenticated: false, error: null },
    lastSPXTs: null,
    lastVIXTs: null,
    lastSPXBarTs: null,
    lastVIXBarTs: null,
  });

  // Load cached session (after-hours persistence)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw);
      if (cached?.data?.SPX && !spx) setSpx(cached.data.SPX);
      if (cached?.data?.VIX && !vix) setVix(cached.data.VIX);
    } catch {
      // ignore
    }
  }, [spx, vix]);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Connect streaming + REST fallback
  useEffect(() => {
    let cancelled = false;

    massiveService.setCallbacks({
      onConnectionStatus: (s) => {
        if (cancelled) return;
        if (s?.type === 'backend') {
          setStatus({ mode: s?.connected ? 'BACKEND_OK' : 'BACKEND_DOWN' });
          return;
        }
        setStatus({ mode: s?.status === 'authenticated' ? 'WS_LIVE' : s?.status || 'WS' });
      },
      onError: (msg) => {
        if (cancelled) return;
        setError(msg);
      },
      onDataUpdate: () => {
        if (cancelled) return;
        const data = massiveService.getData();
        if (data?.SPX) setSpx(data.SPX);
        if (data?.VIX) setVix(data.VIX);
        if (data?.bars?.SPX && Array.isArray(data.bars.SPX)) setSpxBars(data.bars.SPX);
      },
    });

    (async () => {
      setError(null);
      setStatus({ mode: 'CONNECTING' });
      const res = await massiveService.connectAll();
      if (cancelled) return;
      if (res?.errors?.length) setStatus({ mode: 'REST_OK' });

      // Weekly analysis uses daily bars from backend proxy
      try {
        const bars = await massiveService.fetchDailyBars(10);
        setDailyBars(bars);
      } catch (e) {
        // Not fatal; dashboard still runs.
        setDailyBars((prev) => prev || []);
      }
    })();

    return () => {
      cancelled = true;
      massiveService.disconnectAll();
    };
  }, []);

  const spot = spx?.price ? Number(spx.price) : null;
  const vixVal = vix?.value ? Number(vix.value) : null;

  const gex = useMemo(() => {
    if (!spot || !spxBars.length) return null;
    return buildGEXProfile(spot, spxBars, vixVal || null);
  }, [spot, spxBars, vixVal]);
  const weekly = useMemo(() => (gex && dailyBars.length ? buildWeeklyAnalysis(gex, dailyBars) : null), [dailyBars, gex]);

  const heatmap = gex?.heatmap || [];
  const maxTouches = useMemo(() => Math.max(1, ...heatmap.map((h) => Number(h.touches || 0))), [heatmap]);

  // Data health polling (real-time status only; no mock)
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/status', { headers: PROXY_TOKEN ? { 'x-titan-token': PROXY_TOKEN } : {} });
        const json = await res.json();
        if (!res.ok || !json?.ok) return;
        const st = json.latest?.status || {};
        if (cancelled) return;
        setDataStatus({
          ws: { connected: Boolean(st.connected), authenticated: Boolean(st.authenticated), error: st.error || null },
          lastSPXTs: st.lastSPXTs || null,
          lastVIXTs: st.lastVIXTs || null,
          lastSPXBarTs: st.lastSPXBarTs || null,
          lastVIXBarTs: st.lastVIXBarTs || null,
        });
      } catch {
        // ignore
      }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const nowMs = time.getTime();
  const ageSec = (ts) => (ts ? Math.max(0, Math.floor((nowMs - Number(ts)) / 1000)) : null);
  const spxAge = ageSec(dataStatus.lastSPXTs);
  const vixAge = ageSec(dataStatus.lastVIXTs);
  const spxBarAge = ageSec(dataStatus.lastSPXBarTs);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <header className="bg-gray-900/95 border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
        <div className="max-w-[1400px] mx-auto flex justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center text-xl font-bold">Ω</div>
            <div>
              <div className="text-lg font-bold">TITAN OMEGA</div>
              <div className="text-xs text-gray-500">
                {status?.mode === 'WS_LIVE' ? '🟢 LIVE STREAM' : '🟡 REST / CACHED'} · LEVELS: REAL-TIME
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
                <Badge color="red">Call {gex.callWall}</Badge>
                <Badge color="green">Put {gex.putWall}</Badge>
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
            <div className="mt-2 text-xs text-gray-500">
              Keys are stored server-side. Set <code className="font-mono">MASSIVE_API_KEY</code> in <code className="font-mono">titan-omega-dashboard/.env</code>.
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-gray-300">Data health (real-time)</div>
              <Badge color={dataStatus.ws.authenticated ? 'green' : 'yellow'}>
                {dataStatus.ws.authenticated ? 'UPSTREAM_AUTH' : dataStatus.ws.connected ? 'UPSTREAM_CONN' : 'DOWN'}
              </Badge>
            </div>
            {dataStatus.ws.error && <div className="text-xs text-red-300 mb-2">Upstream: {dataStatus.ws.error}</div>}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-2">
                <div className="text-gray-500">SPX tick age</div>
                <div className="font-mono font-bold">{spxAge == null ? '—' : `${spxAge}s`}</div>
              </div>
              <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-2">
                <div className="text-gray-500">VIX tick age</div>
                <div className="font-mono font-bold">{vixAge == null ? '—' : `${vixAge}s`}</div>
              </div>
              <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-2">
                <div className="text-gray-500">SPX bar age</div>
                <div className="font-mono font-bold">{spxBarAge == null ? '—' : `${spxBarAge}s`}</div>
              </div>
              <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-2">
                <div className="text-gray-500">SPX bars cached</div>
                <div className="font-mono font-bold">{spxBars.length}</div>
              </div>
            </div>
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
                  <div className="font-mono font-bold">{Number(weekly.weekSummary.high).toFixed(0)}</div>
                </div>
                <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-2">
                  <div className="text-gray-500">Week Low</div>
                  <div className="font-mono font-bold">{Number(weekly.weekSummary.low).toFixed(0)}</div>
                </div>
              </div>
            </div>
          )}
        </aside>

        <section className="col-span-12 lg:col-span-8 space-y-3">
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-800/40 border-b border-gray-800 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-300">Level Heatmap (Real touches)</div>
              <div className="flex gap-2 text-xs">
                <span className="text-emerald-400">■ Support</span>
                <span className="text-red-400">■ Resistance</span>
              </div>
            </div>
            <div className="p-3 max-h-[520px] overflow-y-auto space-y-1">
              {heatmap.length === 0 && <div className="text-sm text-gray-500">Waiting for real bars…</div>}
              {heatmap.map((h) => {
                const w = Math.min(100, (Number(h.touches || 0) / maxTouches) * 100);
                const isSpot = spot != null && Math.abs(h.strike - spot) < 2.5;
                const isFlip = gex && Math.abs(h.strike - gex.gammaFlip) < 2.5;
                const isCall = gex && h.strike === gex.callWall;
                const isPut = gex && h.strike === gex.putWall;
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
                        {h.kind === 'SUPPORT' ? (
                          <div className="h-3 bg-emerald-500 rounded-sm" style={{ width: `${w}%`, marginLeft: '50%' }} />
                        ) : h.kind === 'RESISTANCE' ? (
                          <div className="h-3 bg-red-500 rounded-sm" style={{ width: `${w}%`, marginRight: '50%' }} />
                        ) : (
                          <div className="h-3 bg-gray-500 rounded-sm" style={{ width: `${w}%`, marginLeft: '50%' }} />
                        )}
                      </div>
                    </div>
                    <div className="w-16 text-right font-mono text-xs text-gray-300">
                      {Number(h.touches || 0)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-sm font-semibold text-gray-300 mb-2">After-hours persistence</div>
            <div className="text-xs text-gray-400">
              Session cache lives in <code className="font-mono">{STORAGE_KEY}</code>. If streaming is unavailable, the dashboard reuses the last saved
              snapshot.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

