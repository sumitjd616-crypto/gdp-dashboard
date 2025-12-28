/**
 * Real-time ONLY levels calculator (no synthetic/mock data)
 *
 * We do NOT compute true options-chain GEX here.
 * Instead, we derive actionable “walls/flip” from real SPX minute bars:
 * - gammaFlip: midpoint of last 20-bar range (real price action)
 * - callWall: most-touched resistance level above spot (real touches)
 * - putWall:  most-touched support level below spot (real touches)
 *
 * Output includes a “heatmap” that is **touch-count based** (real data),
 * not synthetic GEX numbers.
 */

function roundTo5(x) {
  return Math.round(x / 5) * 5;
}

function calculateATR(bars, period = 14) {
  if (!bars || bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i += 1) {
    const hi = bars[i].high;
    const lo = bars[i].low;
    const pc = bars[i - 1].close;
    const tr = Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc));
    trs.push(tr);
  }
  const tail = trs.slice(-period);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

function buildTouchMap(bars, spot, windowBars = 200) {
  const recent = bars.slice(0, windowBars); // bars are newest-first
  const touch = new Map(); // strike -> count

  const tol = 2.5; // half of 5pt increment
  const addTouch = (price) => {
    const s = roundTo5(price);
    const k = String(s);
    touch.set(k, (touch.get(k) || 0) + 1);
  };

  for (const b of recent) {
    if (!b) continue;
    // count touches near high/low/close (real)
    if (typeof b.high === 'number') addTouch(b.high);
    if (typeof b.low === 'number') addTouch(b.low);
    if (typeof b.close === 'number') addTouch(b.close);
  }

  // Build ladder around spot
  const center = roundTo5(spot);
  const ladder = [];
  for (let s = center + 100; s >= center - 100; s -= 5) {
    const count = touch.get(String(s)) || 0;
    const kind = s > spot + tol ? 'RESISTANCE' : s < spot - tol ? 'SUPPORT' : 'NEUTRAL';
    ladder.push({ strike: s, touches: count, kind });
  }
  return ladder;
}

function pickWall(levels, dir) {
  // dir: 'UP' -> resistance, 'DOWN' -> support
  const filtered =
    dir === 'UP' ? levels.filter((l) => l.kind === 'RESISTANCE') : levels.filter((l) => l.kind === 'SUPPORT');
  filtered.sort((a, b) => b.touches - a.touches);
  return filtered[0]?.strike ?? null;
}

export function buildGEXProfile(spot, bars = [], vix = null) {
  if (!spot || !Array.isArray(bars) || bars.length === 0) {
    return { available: false, reason: 'Need real spot + real bars' };
  }

  // gammaFlip from real consolidation midpoint (last 20 bars)
  const last20 = bars.slice(0, 20);
  const hi = Math.max(...last20.map((b) => b.high).filter((x) => typeof x === 'number'));
  const lo = Math.min(...last20.map((b) => b.low).filter((x) => typeof x === 'number'));
  const gammaFlip = roundTo5((hi + lo) / 2);

  const heatmap = buildTouchMap(bars, spot, 250);
  const callWall = pickWall(heatmap, 'UP') ?? roundTo5(spot + 25);
  const putWall = pickWall(heatmap, 'DOWN') ?? roundTo5(spot - 25);

  const atr = calculateATR([...bars].reverse(), 14); // ATR expects oldest->newest
  const regime = spot >= gammaFlip ? 'POSITIVE' : 'NEGATIVE';

  return {
    available: true,
    dataSource: 'REAL_BARS',
    spot,
    vix: vix ?? null,
    timestamp: new Date(),
    gammaFlip,
    callWall,
    putWall,
    atr,
    heatmap, // [{ strike, touches, kind }]
    analysis: {
      aboveGammaFlip: spot > gammaFlip,
      nearCallWall: Math.abs(spot - callWall) < 10,
      nearPutWall: Math.abs(spot - putWall) < 10,
    },
    regime,
  };
}

export function buildWeeklyAnalysis(gexProfile, dailyBars = []) {
  if (!gexProfile?.available) return { available: false, reason: 'GEX profile required for weekly analysis' };
  if (!dailyBars.length) return { available: false, reason: 'Daily bars required for weekly analysis' };

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
  if (gexProfile.regime === 'POSITIVE') notes.push('Positive gamma proxy: mean reversion bias.');
  else notes.push('Negative gamma proxy: momentum / acceleration bias.');

  return {
    available: true,
    lastSession: { date: lastBar.date, close: lastBar.close, high: lastBar.high, low: lastBar.low },
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
      callWall: gexProfile.callWall,
      putWall: gexProfile.putWall,
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

export function detectScenarios() {
  // Optional extension point: real-time scenario detection.
  return [];
}

export default {
  buildGEXProfile,
  buildWeeklyAnalysis,
  detectScenarios,
};

