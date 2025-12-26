/**
 * Model-based GEX Calculator
 *
 * Real options GEX needs full options-chain + greeks subscription.
 * This module provides a model proxy that is stable and useful for levels.
 */

function roundTo(x, step) {
  return Math.round(x / step) * step;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

export function buildGEXProfile(spot, _optionsChain = null, vix = 15) {
  const iv = (Number(vix) || 15) / 100;
  const roundedSpot = roundTo(spot, 5);
  const strikeStep = 5;
  const n = 44;

  const volPts = clamp(spot * iv * Math.sqrt(1 / 252), 12, 80);
  const gammaFlip = roundTo(spot, 5); // stable reference (avoid jitter)
  const callWall = roundTo(spot + volPts * 1.2, 5);
  const putWall = roundTo(spot - volPts * 1.2, 5);

  const heatmap = [];
  let netGEX = 0;

  for (let i = -n; i <= n; i += 1) {
    const strike = roundedSpot + i * strikeStep;
    const dist = Math.abs(strike - spot);
    const stepsAway = Math.abs(i);

    const roundBonus = strike % 50 === 0 ? 2.5 : strike % 25 === 0 ? 1.6 : 1;
    const atmDecay = Math.exp(-0.085 * stepsAway);
    const direction = strike >= spot ? -1 : 1;
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
    timestamp: new Date(),
    gammaFlip,
    callWall,
    putWall,
    netGEX,
    regime,
    heatmap,
    analysis: {
      aboveGammaFlip: spot > gammaFlip,
      nearCallWall: Math.abs(spot - callWall) < 10,
      nearPutWall: Math.abs(spot - putWall) < 10,
    },
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

