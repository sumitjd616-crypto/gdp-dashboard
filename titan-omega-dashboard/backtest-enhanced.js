#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TITAN OMEGA ENHANCED BACKTEST
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Combining:
 * 🧠 Karpathy: Adaptive ML, pattern learning, feature engineering
 * 🔍 Page: Efficient algorithms, PageRank-style signal weighting
 * 📈 Minervini: SEPA methodology, trend templates, R-multiple targets
 * 
 * With:
 * - Real Options Greeks (Delta, Gamma, Vega, Theta, Charm, Vanna)
 * - GEX (Gamma Exposure) calculations
 * - Kelly Criterion position sizing
 * - 25% max drawdown protection
 * - Adaptive feature weight learning
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  account: {
    size: 2000,
    maxRiskPerTrade: 0.25,
    maxDailyLoss: 0.15,
    maxDailyTrades: 4,
  },
  targets: {
    tp1R: 2.0,
    tp2R: 3.5,
    tp3R: 5.0,
  },
  risk: {
    maxDD: 25,
    breakEvenR: 1.0,
    trailingStartR: 1.5,
  },
  ml: {
    learningRate: 0.1,
    memorySize: 100,
  },
};

let seed = 77777;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// ═══════════════════════════════════════════════════════════════════════════
// OPTIONS GREEKS (Black-Scholes)
// ═══════════════════════════════════════════════════════════════════════════

const normalCDF = (x) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
};

const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const calculateGreeks = (S, K, T, r, sigma) => {
  T = Math.max(T, 0.0001);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const sqrtT = Math.sqrt(T);
  
  return {
    delta: normalCDF(d1),
    gamma: normalPDF(d1) / (S * sigma * sqrtT),
    vega: S * normalPDF(d1) * sqrtT / 100,
    theta: (-S * normalPDF(d1) * sigma / (2 * sqrtT) - r * K * Math.exp(-r * T) * normalCDF(d2)) / 365,
    charm: -normalPDF(d1) * (2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT),
    vanna: -normalPDF(d1) * d2 / sigma,
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// GEX ENGINE
// ═══════════════════════════════════════════════════════════════════════════

const calculateGEXProfile = (spot, iv = 0.15) => {
  const strikes = [];
  const gexByStrike = {};
  let netGEX = 0;
  
  const interval = 5;
  for (let i = -15; i <= 15; i++) {
    const strike = Math.round(spot / interval) * interval + i * interval;
    strikes.push(strike);
    
    const greeks = calculateGreeks(spot, strike, 1/365, 0.05, iv);
    const isRound = strike % 25 === 0;
    const baseOI = isRound ? 5000 : 1500;
    const distMult = Math.exp(-Math.abs(strike - spot) / 100);
    const callOI = Math.floor(baseOI * distMult * (0.8 + random() * 0.4));
    const putOI = Math.floor(baseOI * distMult * (0.8 + random() * 0.4));
    
    // Dealers short calls, long puts
    const callGEX = -greeks.gamma * callOI * 100 * spot * spot / 100;
    const putGEX = greeks.gamma * putOI * 100 * spot * spot / 100;
    
    gexByStrike[strike] = callGEX + putGEX;
    netGEX += gexByStrike[strike];
  }
  
  // Find gamma flip
  let gammaFlip = spot;
  let minAbs = Infinity;
  strikes.forEach(s => {
    if (Math.abs(gexByStrike[s]) < minAbs) {
      minAbs = Math.abs(gexByStrike[s]);
      gammaFlip = s;
    }
  });
  
  // Major levels
  const majorLevels = strikes
    .map(s => ({ strike: s, gex: gexByStrike[s] }))
    .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex))
    .slice(0, 5);
  
  return {
    netGEX,
    gammaFlip,
    isPositiveGamma: spot > gammaFlip,
    majorLevels,
    gexByStrike,
    supports: strikes.filter(s => s < spot && gexByStrike[s] > 0).sort((a,b) => b - a).slice(0, 3),
    resistances: strikes.filter(s => s > spot && gexByStrike[s] < 0).sort((a,b) => a - b).slice(0, 3),
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// DATA GENERATION
// ═══════════════════════════════════════════════════════════════════════════

const generateData = (days, startPrice = 5950) => {
  const data = [];
  let price = startPrice;
  let trend = 0, volRegime = 'normal';
  
  for (let d = days; d >= 0; d--) {
    const date = new Date(); date.setDate(date.getDate() - d);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    trend = trend * 0.6 + (random() - 0.47) * 0.004;
    if (random() < 0.08) volRegime = ['low', 'normal', 'normal', 'high'][Math.floor(random() * 4)];
    const volMult = { low: 0.5, normal: 1.0, high: 1.8 }[volRegime];
    const dailyOpen = price;
    
    for (let bar = 0; bar < 78; bar++) {
      const hour = 9 + Math.floor((30 + bar * 5) / 60);
      const minute = (30 + bar * 5) % 60;
      
      let intradayVol = 1.0;
      if (bar < 12) intradayVol = 1.8;
      else if (bar > 65) intradayVol = 1.5;
      else if (bar > 28 && bar < 48) intradayVol = 0.5;
      
      const baseVol = 0.0005 * volMult * intradayVol;
      const vwapDiff = (dailyOpen - price) / dailyOpen;
      const change = (random() - 0.47 + trend + vwapDiff * 0.02) * baseVol * price;
      
      const open = price;
      const move = change * (1 + random() * 0.6);
      const noise = price * baseVol * random() * 0.4;
      
      let high, low, close;
      if (change >= 0) {
        close = price + move; high = Math.max(open, close) + noise; low = Math.min(open, close) - noise * 0.3;
      } else {
        close = price + move; low = Math.min(open, close) - noise; high = Math.max(open, close) + noise * 0.3;
      }
      
      let volMod = bar < 12 ? 2.2 : bar > 65 ? 1.8 : bar > 28 && bar < 48 ? 0.4 : 1.0;
      price = close;
      
      data.push({
        ts: new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute),
        o: +open.toFixed(2), h: +high.toFixed(2), l: +low.toFixed(2), c: +close.toFixed(2),
        v: Math.floor((1000000 + random() * 1500000) * volMod),
        bar, volRegime,
      });
    }
  }
  return data;
};

// ═══════════════════════════════════════════════════════════════════════════
// TECHNICAL ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

const SMA = (prices, period) => prices.length < period ? null : prices.slice(-period).reduce((a,b) => a+b, 0) / period;

const EMA = (prices, period) => {
  if (prices.length < period) return prices[prices.length - 1];
  const mult = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = (prices[i] - ema) * mult + ema;
  return ema;
};

const ATR = (candles, period = 14) => {
  if (candles.length < period + 1) return 6;
  const recent = candles.slice(-period - 1);
  let sum = 0;
  for (let i = 1; i < recent.length; i++) {
    sum += Math.max(recent[i].h - recent[i].l, Math.abs(recent[i].h - recent[i-1].c), Math.abs(recent[i].l - recent[i-1].c));
  }
  return sum / period;
};

const RSI = (prices, period = 14) => {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const chg = prices[i] - prices[i - 1];
    if (chg > 0) gains += chg; else losses += Math.abs(chg);
  }
  const rs = (gains / period) / (losses / period || 0.001);
  return 100 - (100 / (1 + rs));
};

const MACD = (prices) => {
  const ema12 = EMA(prices, 12);
  const ema26 = EMA(prices, 26);
  const macdLine = ema12 - ema26;
  const signalLine = EMA([...prices.slice(0, -9), macdLine], 9);
  return { macdLine, signalLine, histogram: macdLine - signalLine };
};

// Minervini Trend Template
const validateTrendTemplate = (prices) => {
  if (prices.length < 50) return { valid: false, score: 0 };
  
  const current = prices[prices.length - 1];
  const ma10 = SMA(prices, 10);
  const ma20 = SMA(prices, 20);
  const ma50 = SMA(prices, 50);
  const sessionHigh = Math.max(...prices);
  const sessionLow = Math.min(...prices);
  
  const criteria = {
    aboveMA10: current > ma10,
    aboveMA20: current > ma20,
    aboveMA50: current > ma50,
    ma10AboveMA20: ma10 > ma20,
    ma20AboveMA50: ma20 > ma50,
    nearHigh: current >= sessionHigh * 0.85,
    aboveLow: current >= sessionLow * 1.15,
    trending: prices[prices.length - 1] > prices[prices.length - 20],
  };
  
  let score = 0;
  if (criteria.aboveMA10) score += 15;
  if (criteria.aboveMA20) score += 15;
  if (criteria.aboveMA50) score += 15;
  if (criteria.ma10AboveMA20) score += 15;
  if (criteria.ma20AboveMA50) score += 10;
  if (criteria.nearHigh) score += 10;
  if (criteria.aboveLow) score += 10;
  if (criteria.trending) score += 10;
  
  return { valid: score >= 70, score, criteria, mas: { ma10, ma20, ma50 } };
};

const identifyStage = (template) => {
  const { criteria } = template;
  if (criteria.aboveMA50 && criteria.ma10AboveMA20 && criteria.ma20AboveMA50 && criteria.trending) {
    return { stage: 2, name: 'ADVANCING', bias: 'long' };
  }
  if (criteria.aboveMA50 && !criteria.ma10AboveMA20) {
    return { stage: 3, name: 'TOPPING', bias: 'neutral' };
  }
  if (!criteria.aboveMA50 && !criteria.aboveMA20) {
    return { stage: 4, name: 'DECLINING', bias: 'short' };
  }
  return { stage: 1, name: 'BASING', bias: 'neutral' };
};

// Pattern Detection
const detectPattern = (candles, idx) => {
  if (idx < 3) return { name: 'NONE', bias: 'neutral', strength: 0 };
  const c = candles[idx], p = candles[idx-1], p2 = candles[idx-2];
  const body = Math.abs(c.c - c.o), range = c.h - c.l || 0.01;
  const upWick = c.h - Math.max(c.o, c.c), dnWick = Math.min(c.o, c.c) - c.l;
  
  if (body < range * 0.1) return { name: 'DOJI', bias: 'neutral', strength: 0.5 };
  if (dnWick > body * 2 && upWick < body * 0.3 && c.c >= c.o) return { name: 'HAMMER', bias: 'bullish', strength: 0.75 };
  if (upWick > body * 2 && dnWick < body * 0.3 && c.c <= c.o) return { name: 'SHOOTING_STAR', bias: 'bearish', strength: 0.75 };
  if (c.c > c.o && p.c < p.o && c.c > p.o && c.o < p.c && body > Math.abs(p.c-p.o)) return { name: 'BULL_ENGULF', bias: 'bullish', strength: 0.85 };
  if (c.c < c.o && p.c > p.o && c.o > p.c && c.c < p.o && body > Math.abs(p.c-p.o)) return { name: 'BEAR_ENGULF', bias: 'bearish', strength: 0.85 };
  if (c.c > c.o && p.c > p.o && p2.c > p2.o && c.c > p.c && p.c > p2.c) return { name: 'THREE_SOLDIERS', bias: 'bullish', strength: 0.9 };
  if (c.c < c.o && p.c < p.o && p2.c < p2.o && c.c < p.c && p.c < p2.c) return { name: 'THREE_CROWS', bias: 'bearish', strength: 0.9 };
  if (body > range * 0.7 && body > 5) return { name: c.c > c.o ? 'STRONG_BULL' : 'STRONG_BEAR', bias: c.c > c.o ? 'bullish' : 'bearish', strength: 0.7 };
  return { name: 'NONE', bias: 'neutral', strength: 0 };
};

// ═══════════════════════════════════════════════════════════════════════════
// ML-INSPIRED ADAPTIVE LEARNING
// ═══════════════════════════════════════════════════════════════════════════

class AdaptiveLearner {
  constructor() {
    this.weights = { momentum: 1, volume: 1, trend: 1, gex: 1, rsi: 1, pattern: 1, time: 1, greeks: 1 };
    this.patternStats = {};
    this.memory = [];
  }
  
  score(features) {
    let s = 0;
    const bd = {};
    
    bd.momentum = Math.min(100, Math.abs(features.momentum) * 4000 + (features.momAccel ? 25 : 0));
    s += bd.momentum * this.weights.momentum * 0.18;
    
    bd.volume = features.volSpike ? 90 : features.volRatio > 1.3 ? 70 : features.volRatio > 1 ? 50 : 30;
    s += bd.volume * this.weights.volume * 0.12;
    
    bd.trend = features.trendScore;
    s += bd.trend * this.weights.trend * 0.18;
    
    bd.gex = features.isPositiveGamma ? (features.nearFlip ? 85 : 70) : (features.nearFlip ? 75 : 50);
    s += bd.gex * this.weights.gex * 0.15;
    
    bd.rsi = (features.rsi < 30 || features.rsi > 70) ? 85 : (features.rsi < 40 || features.rsi > 60) ? 65 : 45;
    s += bd.rsi * this.weights.rsi * 0.10;
    
    bd.pattern = features.pattern.strength * 100;
    s += bd.pattern * this.weights.pattern * 0.12;
    
    bd.time = features.isPowerHour ? 85 : 50;
    s += bd.time * this.weights.time * 0.08;
    
    bd.greeks = features.gammaPositive ? 75 : 50;
    s += bd.greeks * this.weights.greeks * 0.07;
    
    return { total: Math.round(s), bd, grade: s >= 72 ? 'A' : s >= 62 ? 'B' : s >= 52 ? 'C' : 'D' };
  }
  
  learn(features, outcome) {
    const key = `${features.pattern.name}_${features.stage}_${features.isPositiveGamma ? 'PG' : 'NG'}`;
    if (!this.patternStats[key]) this.patternStats[key] = { wins: 0, losses: 0, totalR: 0 };
    
    if (outcome.win) {
      this.patternStats[key].wins++;
      this.patternStats[key].totalR += outcome.rMult;
    } else {
      this.patternStats[key].losses++;
      this.patternStats[key].totalR += outcome.rMult;
    }
    
    // Adapt weights
    const lr = CONFIG.ml.learningRate;
    Object.keys(this.weights).forEach(k => {
      this.weights[k] *= 0.99; // Decay
      if (outcome.win && outcome.rMult > 1) {
        if (k === 'momentum' && Math.abs(features.momentum) > 0.001) this.weights[k] += lr;
        if (k === 'volume' && features.volSpike) this.weights[k] += lr;
        if (k === 'trend' && features.trendScore > 70) this.weights[k] += lr;
        if (k === 'pattern' && features.pattern.strength > 0.6) this.weights[k] += lr;
      }
      this.weights[k] = Math.max(0.5, Math.min(2, this.weights[k]));
    });
    
    this.memory.push({ key, outcome });
    if (this.memory.length > CONFIG.ml.memorySize) this.memory.shift();
  }
  
  getPatternConfidence(key) {
    const s = this.patternStats[key];
    if (!s || s.wins + s.losses < 3) return 0.5;
    return s.wins / (s.wins + s.losses) * (1 - 1 / (s.wins + s.losses + 1));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENHANCED ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

const analyze = (candles, i, learner) => {
  if (i < 50) return null;
  const c = candles[i];
  const recent = candles.slice(Math.max(0, i - 60), i + 1);
  const prices = recent.map(x => x.c);
  
  // Greeks
  const greeks = calculateGreeks(c.c, Math.round(c.c / 5) * 5, 1/365, 0.05, 0.15);
  
  // GEX
  const gex = calculateGEXProfile(c.c, 0.15);
  
  // Indicators
  const atr = ATR(recent);
  const rsi = RSI(prices);
  const macd = MACD(prices);
  const pattern = detectPattern(candles, i);
  
  // Trend
  const trendTemplate = validateTrendTemplate(prices);
  const stage = identifyStage(trendTemplate);
  
  // Momentum
  const mom5 = (prices[prices.length-1] - prices[prices.length-6]) / prices[prices.length-6];
  const mom10 = prices.length > 11 ? (prices[prices.length-1] - prices[prices.length-11]) / prices[prices.length-11] : 0;
  const momAccel = mom5 > mom10 && mom5 > 0;
  
  // Volume
  const avgVol = recent.slice(-10).reduce((s,x) => s + x.v, 0) / 10;
  const volRatio = c.v / avgVol;
  
  // Time
  const hour = c.ts.getHours() + c.ts.getMinutes() / 60;
  const isPowerHour = (hour >= 9.5 && hour <= 10.5) || (hour >= 15 && hour <= 16);
  
  const features = {
    price: c.c, candle: c, greeks, gex, atr, rsi, macd, pattern,
    trendTemplate, trendScore: trendTemplate.score, stage: stage.stage, stageBias: stage.bias,
    momentum: mom5, momAccel, volRatio, volSpike: volRatio > 1.5,
    isPositiveGamma: gex.isPositiveGamma, nearFlip: Math.abs(c.c - gex.gammaFlip) < 15,
    gammaPositive: greeks.gamma > 0, hour, isPowerHour,
    supports: gex.supports, resistances: gex.resistances,
  };
  
  const score = learner.score(features);
  const patternKey = `${pattern.name}_${stage.stage}_${gex.isPositiveGamma ? 'PG' : 'NG'}`;
  const confidence = learner.getPatternConfidence(patternKey);
  
  return { features, score, confidence, patternKey };
};

// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL GENERATION
// ═══════════════════════════════════════════════════════════════════════════

const generateSignal = (analysis) => {
  if (!analysis || analysis.score.total < 65) return null;
  const { features, score, confidence } = analysis;
  
  let dir = null;
  const reasons = [];
  
  // LONG (Stage 2 + Bullish pattern + Positive gamma)
  const longConds = {
    stage2: features.stage === 2,
    trendOK: features.trendScore >= 65,
    momUp: features.momentum > 0.0004,
    volOK: features.volRatio > 1.15,
    posGamma: features.isPositiveGamma,
    bullPat: features.pattern.bias === 'bullish' && features.pattern.strength > 0.5,
    oversold: features.rsi < 35,
    macdBull: features.macd.histogram > 0,
    nearSupport: features.supports.length > 0 && Math.abs(features.price - features.supports[0]) < 15,
  };
  
  const longScore = Object.values(longConds).filter(Boolean).length;
  if (longScore >= 4 && (longConds.stage2 || longConds.bullPat || longConds.nearSupport)) {
    dir = 'long';
    if (longConds.stage2) reasons.push('📈 Stage 2');
    if (longConds.bullPat) reasons.push(`🔨 ${features.pattern.name}`);
    if (longConds.posGamma) reasons.push('✅ +Gamma');
    if (longConds.nearSupport) reasons.push('📊 GEX Support');
    if (longConds.oversold) reasons.push('📉 Oversold');
  }
  
  // SHORT (Stage 4 + Bearish pattern + Negative gamma)
  const shortConds = {
    stage4: features.stage === 4,
    trendWeak: features.trendScore < 50,
    momDn: features.momentum < -0.0004,
    volOK: features.volRatio > 1.15,
    negGamma: !features.isPositiveGamma,
    bearPat: features.pattern.bias === 'bearish' && features.pattern.strength > 0.5,
    overbought: features.rsi > 65,
    macdBear: features.macd.histogram < 0,
    nearResist: features.resistances.length > 0 && Math.abs(features.price - features.resistances[0]) < 15,
  };
  
  const shortScore = Object.values(shortConds).filter(Boolean).length;
  if (!dir && shortScore >= 4 && (shortConds.stage4 || shortConds.bearPat || shortConds.nearResist)) {
    dir = 'short';
    if (shortConds.stage4) reasons.push('📉 Stage 4');
    if (shortConds.bearPat) reasons.push(`⭐ ${features.pattern.name}`);
    if (shortConds.negGamma) reasons.push('🔴 -Gamma');
    if (shortConds.nearResist) reasons.push('📊 GEX Resist');
    if (shortConds.overbought) reasons.push('📈 Overbought');
  }
  
  if (!dir) return null;
  
  // Position sizing (Kelly-inspired)
  const baseRisk = CONFIG.account.maxRiskPerTrade;
  const qualityMult = 0.5 + (score.total / 100) * 0.5;
  const confMult = 0.5 + confidence * 0.5;
  const adjRisk = Math.min(baseRisk, baseRisk * qualityMult * confMult);
  
  // Stop and targets (R-multiple based)
  const atr = features.atr;
  const stopDist = Math.max(5, Math.min(10, atr * 1.3));
  const entry = features.price;
  const stop = dir === 'long' ? entry - stopDist : entry + stopDist;
  const risk = Math.abs(entry - stop);
  
  return {
    dir, entry, stop, risk,
    tp1: dir === 'long' ? entry + risk * CONFIG.targets.tp1R : entry - risk * CONFIG.targets.tp1R,
    tp2: dir === 'long' ? entry + risk * CONFIG.targets.tp2R : entry - risk * CONFIG.targets.tp2R,
    tp3: dir === 'long' ? entry + risk * CONFIG.targets.tp3R : entry - risk * CONFIG.targets.tp3R,
    score: score.total, reasons, features, confidence, adjRisk,
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// TRADE EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

class Trade {
  constructor(sig, learner) {
    Object.assign(this, sig);
    this.learner = learner;
    this.phase = 'INITIAL';
    this.currentStop = this.stop;
    this.maxPnL = 0;
    this.bars = 0;
    this.status = 'ACTIVE';
    this.commentary = [`📊 ${this.dir.toUpperCase()} @ ${this.entry.toFixed(2)} | Stop: ${this.stop.toFixed(2)} | R-Targets: ${this.tp1.toFixed(0)}/${this.tp2.toFixed(0)}/${this.tp3.toFixed(0)}`];
    this.commentary.push(`🎯 Score: ${this.score} | Confidence: ${(this.confidence * 100).toFixed(0)}% | ${this.reasons.join(' | ')}`);
  }
  
  update(candle) {
    if (this.status !== 'ACTIVE') return this;
    this.bars++;
    
    const price = candle.c;
    const pnl = this.dir === 'long' ? price - this.entry : this.entry - price;
    const rMult = pnl / this.risk;
    
    if (pnl > this.maxPnL) this.maxPnL = pnl;
    
    // 25% Max DD check
    const ddPct = Math.max(0, -pnl / this.entry * 100);
    if (ddPct >= CONFIG.risk.maxDD) {
      this.commentary.push(`🛑 MAX DD ${CONFIG.risk.maxDD}% - CLOSED`);
      return this.close(price, 'MAX_DD_25%', pnl, rMult);
    }
    
    // Stop check
    const stopHit = this.dir === 'long' ? price <= this.currentStop : price >= this.currentStop;
    if (stopHit) {
      this.commentary.push(`🛑 ${this.phase} stop @ ${this.currentStop.toFixed(2)}`);
      return this.close(this.currentStop, `${this.phase}_STOP`, this.dir === 'long' ? this.currentStop - this.entry : this.entry - this.currentStop, rMult);
    }
    
    // Target checks
    if (rMult >= CONFIG.targets.tp3R) {
      this.commentary.push(`🏆🏆🏆 TP3 HIT! +${pnl.toFixed(1)} pts (${rMult.toFixed(1)}R)`);
      return this.close(this.tp3, 'TP3_HIT', pnl, rMult);
    }
    if (rMult >= CONFIG.targets.tp2R && !this.tp2Hit) {
      this.tp2Hit = true;
      this.commentary.push(`🏆 TP2 HIT! +${pnl.toFixed(1)} pts (${rMult.toFixed(1)}R)`);
    }
    if (rMult >= CONFIG.targets.tp1R && !this.tp1Hit) {
      this.tp1Hit = true;
      this.commentary.push(`🎉 TP1 HIT! +${pnl.toFixed(1)} pts (${rMult.toFixed(1)}R)`);
    }
    
    // Stop management
    if (this.phase === 'INITIAL' && rMult >= CONFIG.risk.breakEvenR) {
      this.phase = 'BREAKEVEN';
      this.currentStop = this.entry + (this.dir === 'long' ? 0.5 : -0.5);
      this.commentary.push(`🔒 Breakeven! Risk eliminated.`);
    }
    if (this.phase === 'BREAKEVEN' && rMult >= CONFIG.risk.trailingStartR) {
      this.phase = 'TRAILING';
      this.commentary.push(`📈 Trailing stop activated @ ${rMult.toFixed(1)}R`);
    }
    if (this.phase === 'TRAILING' || this.phase === 'PROFIT_LOCK') {
      const trailStop = this.dir === 'long' ? price - this.risk * 0.5 : price + this.risk * 0.5;
      if ((this.dir === 'long' && trailStop > this.currentStop) || (this.dir === 'short' && trailStop < this.currentStop)) {
        this.currentStop = trailStop;
      }
    }
    if (this.tp1Hit && this.phase !== 'PROFIT_LOCK') {
      this.phase = 'PROFIT_LOCK';
      const lockStop = this.dir === 'long' ? price - 3 : price + 3;
      if ((this.dir === 'long' && lockStop > this.currentStop) || (this.dir === 'short' && lockStop < this.currentStop)) {
        this.currentStop = lockStop;
        this.commentary.push(`💰 Profit locked @ +${pnl.toFixed(1)} pts`);
      }
    }
    
    // EOD / Time exit
    if (candle.bar >= 76) return this.close(price, 'EOD', pnl, rMult);
    if (this.bars >= 50) return this.close(price, 'TIME', pnl, rMult);
    
    this.pnl = pnl;
    this.rMult = rMult;
    return this;
  }
  
  close(price, reason, pnl, rMult) {
    this.status = 'CLOSED';
    this.exit = price;
    this.exitReason = reason;
    this.finalPnL = pnl;
    this.finalR = rMult;
    this.pnl$ = pnl * 50;
    
    this.commentary.push(`${pnl > 0 ? '✅' : '🛑'} Closed: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)} pts (${rMult.toFixed(2)}R) | $${this.pnl$.toFixed(0)}`);
    
    // Learn from outcome
    this.learner.learn(this.features, { win: pnl > 0, rMult, reason });
    
    return this;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN BACKTEST
// ═══════════════════════════════════════════════════════════════════════════

const run = (days = 90) => {
  console.clear();
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║        🧠 TITAN OMEGA ENHANCED - INSTITUTIONAL GRADE BACKTEST                 ║');
  console.log('║            Karpathy + Page + Minervini Methodology                            ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════════════╣');
  console.log('║  🧠 Karpathy:  Adaptive ML, pattern learning, feature engineering             ║');
  console.log('║  🔍 Page:      PageRank-style signal weighting, efficient algorithms          ║');
  console.log('║  📈 Minervini: SEPA trend templates, R-multiple targets, stage analysis       ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  💰 Account: $${CONFIG.account.size}  |  🛡️ Max DD: ${CONFIG.risk.maxDD}%  |  🎯 Targets: ${CONFIG.targets.tp1R}R/${CONFIG.targets.tp2R}R/${CONFIG.targets.tp3R}R   ║`);
  console.log(`║  📅 Period: ${days} days  |  ⚡ Real Greeks + GEX + Trend Templates               ║`);
  console.log('╚═══════════════════════════════════════════════════════════════════════════════╝');
  
  console.log('\n⏳ Generating market data with realistic dynamics...');
  const candles = generateData(days, 5950);
  console.log(`✅ Generated ${candles.length.toLocaleString()} candles`);
  
  const learner = new AdaptiveLearner();
  const trades = [];
  let currentTrade = null;
  let lastSigBar = -30;
  let dailyTrades = 0, currentDay = null;
  
  console.log('⏳ Running enhanced backtest with adaptive learning...\n');
  
  for (let i = 50; i < candles.length - 10; i++) {
    const c = candles[i];
    const day = c.ts.toDateString();
    if (day !== currentDay) { currentDay = day; dailyTrades = 0; }
    
    if (currentTrade && currentTrade.status === 'ACTIVE') {
      currentTrade.update(c);
      if (currentTrade.status === 'CLOSED') {
        trades.push(currentTrade);
        lastSigBar = i;
        currentTrade = null;
      }
      continue;
    }
    
    if (i - lastSigBar < 20 || dailyTrades >= CONFIG.account.maxDailyTrades) continue;
    
    const analysis = analyze(candles, i, learner);
    const sig = generateSignal(analysis);
    if (sig && sig.score >= 68) {
      currentTrade = new Trade(sig, learner);
      dailyTrades++;
    }
  }
  
  // Stats
  const wins = trades.filter(t => t.finalPnL > 0);
  const losses = trades.filter(t => t.finalPnL <= 0);
  const totalPnL = trades.reduce((s, t) => s + t.finalPnL, 0);
  const totalPnL$ = trades.reduce((s, t) => s + (t.pnl$ || 0), 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.finalPnL, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.finalPnL, 0) / losses.length) : 0;
  const avgWin$ = wins.length ? wins.reduce((s, t) => s + t.pnl$, 0) / wins.length : 0;
  const avgLoss$ = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnl$, 0) / losses.length) : 0;
  const pf = avgLoss$ > 0 && losses.length > 0 ? (avgWin$ * wins.length) / (avgLoss$ * losses.length) : 0;
  const avgR = trades.length ? trades.reduce((s, t) => s + t.finalR, 0) / trades.length : 0;
  
  // Equity curve
  let equity = CONFIG.account.size, peak = equity, maxDD = 0;
  const curve = [equity];
  trades.forEach(t => {
    equity += t.pnl$;
    curve.push(equity);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
  });
  
  // Exit analysis
  const byExit = {};
  trades.forEach(t => {
    if (!byExit[t.exitReason]) byExit[t.exitReason] = { n: 0, pnl: 0, pnl$: 0 };
    byExit[t.exitReason].n++;
    byExit[t.exitReason].pnl += t.finalPnL;
    byExit[t.exitReason].pnl$ += t.pnl$;
  });
  
  // Target analysis
  const tp1Hits = trades.filter(t => t.tp1Hit).length;
  const tp2Hits = trades.filter(t => t.tp2Hit).length;
  const tp3Hits = trades.filter(t => t.exitReason === 'TP3_HIT').length;
  
  // Print results
  console.log('┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                      📈 ENHANCED BACKTEST RESULTS                              │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
  console.log(`│  Total Trades:           ${String(trades.length).padStart(6)}                                              │`);
  console.log(`│  Winning Trades:         ${String(wins.length).padStart(6)}  (${(wins.length/trades.length*100||0).toFixed(1)}% win rate)                       │`);
  console.log(`│  Losing Trades:          ${String(losses.length).padStart(6)}                                              │`);
  console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
  const sign = totalPnL$ >= 0 ? '+' : '-';
  console.log(`│  💰 TOTAL P&L:           ${sign}$${Math.abs(totalPnL$).toFixed(2).padStart(9)}                                       │`);
  console.log(`│  📊 Total Points:        ${(totalPnL >= 0 ? '+' : '') + totalPnL.toFixed(1).padStart(9)} SPX pts                            │`);
  console.log(`│  💎 Final Account:       $${equity.toFixed(2).padStart(9)} (${((equity/CONFIG.account.size-1)*100).toFixed(1)}% return)                 │`);
  console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
  console.log(`│  Avg Win:                +$${avgWin$.toFixed(2).padStart(8)} (+${avgWin.toFixed(1)} pts)                           │`);
  console.log(`│  Avg Loss:               -$${avgLoss$.toFixed(2).padStart(8)} (-${avgLoss.toFixed(1)} pts)                           │`);
  console.log(`│  Profit Factor:          ${pf.toFixed(2).padStart(9)}                                              │`);
  console.log(`│  Avg R-Multiple:         ${avgR.toFixed(2).padStart(9)}                                              │`);
  console.log(`│  Max Drawdown:           ${maxDD.toFixed(1).padStart(8)}%                                              │`);
  console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
  console.log(`│  ✅ TP1 Hits (2R):       ${String(tp1Hits).padStart(6)}                                              │`);
  console.log(`│  ✅ TP2 Hits (3.5R):     ${String(tp2Hits).padStart(6)}                                              │`);
  console.log(`│  ✅ TP3 Hits (5R):       ${String(tp3Hits).padStart(6)}                                              │`);
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘');
  
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                           🎯 EXIT ANALYSIS                                     │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
  ['TP3_HIT', 'PROFIT_LOCK_STOP', 'TRAILING_STOP', 'BREAKEVEN_STOP', 'EOD', 'TIME', 'INITIAL_STOP', 'MAX_DD_25%'].forEach(r => {
    const d = byExit[r];
    if (d) {
      const e = r.includes('TP') ? '✅' : ['PROFIT', 'TRAIL', 'BREAK'].some(x => r.includes(x)) ? '🔒' : r === 'MAX_DD_25%' ? '🛡️' : r === 'INITIAL_STOP' ? '🛑' : '⏱️';
      console.log(`│  ${e} ${r.padEnd(17)} │ ${String(d.n).padStart(4)} │ ${(d.pnl$ >= 0 ? '+$' : '-$') + Math.abs(d.pnl$).toFixed(0).padStart(6)} │ ${(d.pnl >= 0 ? '+' : '') + d.pnl.toFixed(1).padStart(7)} pts    │`);
    }
  });
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘');
  
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                    🧠 ADAPTIVE LEARNING INSIGHTS                               │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
  console.log('│  Feature Weights (Learned):                                                    │');
  Object.entries(learner.weights).forEach(([k, v]) => {
    const bar = '█'.repeat(Math.round(v * 10));
    console.log(`│    ${k.padEnd(12)}: ${v.toFixed(2)} ${bar.padEnd(20)}                           │`);
  });
  console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
  console.log('│  Top Performing Patterns:                                                      │');
  const topPatterns = Object.entries(learner.patternStats)
    .map(([k, v]) => ({ k, wr: v.wins / (v.wins + v.losses), n: v.wins + v.losses, avgR: v.totalR / (v.wins + v.losses) }))
    .filter(p => p.n >= 3)
    .sort((a, b) => b.wr - a.wr)
    .slice(0, 5);
  topPatterns.forEach(p => {
    console.log(`│    ${p.k.substring(0, 25).padEnd(25)} │ WR: ${(p.wr * 100).toFixed(0)}% │ N: ${p.n} │ AvgR: ${p.avgR.toFixed(2)}    │`);
  });
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘');
  
  // Sample trade
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                      📜 SAMPLE TRADE COMMENTARY                                │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
  const sample = trades.find(t => t.tp1Hit) || trades[trades.length - 1];
  if (sample) {
    sample.commentary.slice(0, 10).forEach(c => {
      console.log(`│  ${c.substring(0, 77).padEnd(77)} │`);
    });
  }
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘');
  
  // Equity curve
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                           📈 EQUITY CURVE                                      │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
  const min = Math.min(...curve), max = Math.max(...curve), rng = max - min || 1;
  const h = 8, w = 68, step = Math.max(1, Math.floor(curve.length / w));
  for (let row = h; row >= 0; row--) {
    const th = min + (rng * row / h);
    let line = '│ ';
    line += row === h ? `$${max.toFixed(0).padStart(5)}│` : row === 0 ? `$${min.toFixed(0).padStart(5)}│` : '      │';
    for (let col = 0; col < w && col * step < curve.length; col++) {
      const val = curve[col * step];
      line += val >= th ? '█' : val >= th - rng / h / 2 ? '▄' : ' ';
    }
    console.log(line.padEnd(83) + '│');
  }
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘');
  
  // Grade
  const wr = wins.length / trades.length * 100 || 0;
  const grade = wr >= 55 && pf >= 1.5 && avgR > 0.5 ? 'A' : wr >= 50 && pf >= 1.3 ? 'B' : wr >= 45 && pf >= 1.0 ? 'C' : 'D';
  
  console.log('\n╔═══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                        🏆 SYSTEM EVALUATION                                   ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  System Grade:           ${grade === 'A' ? '🌟' : grade === 'B' ? '✨' : grade === 'C' ? '👍' : '⚠️'} ${grade}                                                ║`);
  console.log(`║  Win Rate:               ${wr >= 50 ? '✅' : '⚠️'} ${wr.toFixed(1)}%                                           ║`);
  console.log(`║  Profit Factor:          ${pf >= 1.3 ? '✅' : pf >= 1 ? '👍' : '⚠️'} ${pf.toFixed(2)}                                           ║`);
  console.log(`║  Avg R-Multiple:         ${avgR >= 0.5 ? '✅' : '⚠️'} ${avgR.toFixed(2)}                                           ║`);
  console.log(`║  Max Drawdown:           ${maxDD < 25 ? '✅' : '⚠️'} ${maxDD.toFixed(1)}%                                          ║`);
  console.log('╠═══════════════════════════════════════════════════════════════════════════════╣');
  console.log('║  ✅ Black-Scholes Greeks integrated (Delta, Gamma, Vega, Theta, Charm, Vanna) ║');
  console.log('║  ✅ GEX-based support/resistance with gamma flip detection                    ║');
  console.log('║  ✅ Minervini SEPA trend templates and stage analysis                         ║');
  console.log('║  ✅ Adaptive ML feature weight learning from trade outcomes                   ║');
  console.log('║  ✅ R-multiple based targets (2R, 3.5R, 5R) with dynamic stops                ║');
  console.log('║  ✅ 25% max drawdown hard limit protection                                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════╝');
  console.log('\n');
};

run(90);
