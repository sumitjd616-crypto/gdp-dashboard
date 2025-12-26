import React, { useEffect, useMemo, useState } from 'react';
import massiveService from './services/MassiveService';
import { buildGEXProfile, buildWeeklyAnalysis } from './services/GEXCalculator';

const STORAGE_KEY = 'titan_omega_session_v1';
const API_KEY = import.meta.env.VITE_POLYGON_API_KEY || import.meta.env.VITE_MASSIVE_API_KEY;

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
      },
    });

    (async () => {
      setError(null);
      if (!API_KEY) {
        setStatus({ mode: 'NO_API_KEY' });
        setError('Missing API key (set VITE_POLYGON_API_KEY)');
        return;
      }

      setStatus({ mode: 'CONNECTING' });
      const res = await massiveService.connectAll();
      if (cancelled) return;
      if (res?.errors?.length) setStatus({ mode: 'REST_OK' });

      // lightweight weekly analysis needs daily bars; reuse REST daily via Polygon directly (optional)
      // If you want full daily-bars fetch, wire it here.
      setDailyBars((prev) => prev || []);
    })();

    return () => {
      cancelled = true;
      massiveService.disconnectAll();
    };
  }, []);

  const spot = spx?.price ? Number(spx.price) : null;
  const vixVal = vix?.value ? Number(vix.value) : null;

  const gex = useMemo(() => (spot ? buildGEXProfile(spot, null, vixVal || 15) : null), [spot, vixVal]);
  const weekly = useMemo(() => (gex && dailyBars.length ? buildWeeklyAnalysis(gex, dailyBars) : null), [dailyBars, gex]);

  const heatmap = gex?.heatmap || [];
  const maxAbs = useMemo(() => Math.max(1, ...heatmap.map((h) => Math.abs(h.gex))), [heatmap]);

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
            {!API_KEY && <div className="mt-2 text-xs text-yellow-200">Set `VITE_POLYGON_API_KEY` to enable live streaming.</div>}
          </div>

          {weekly?.available && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-sm font-semibold text-gray-300 mb-2">Weekly Analysis</div>
              <div className="text-xs text-gray-400">Loaded from daily bars (enable if you wire daily-bars fetch).</div>
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
                const w = Math.min(100, (Math.abs(h.gex) / maxAbs) * 100);
                const pos = h.gex >= 0;
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
              Session cache lives in <code className="font-mono">{STORAGE_KEY}</code>. If streaming is unavailable, the dashboard reuses the last saved
              snapshot.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

