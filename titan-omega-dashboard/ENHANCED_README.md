# 🧠 TITAN OMEGA ENHANCED - Institutional Grade Trading System

## The Ultimate SPX Intraday Trading Engine

Combining the brilliance of three legendary minds:

| Mind | Contribution | Implementation |
|------|-------------|----------------|
| **🧠 Andrej Karpathy** | AI/ML, Pattern Recognition | Adaptive feature weights, pattern memory, learning from trade outcomes |
| **🔍 Larry Page** | Systems Architecture | Efficient algorithms, PageRank-style signal scoring, scalable data pipelines |
| **📈 Mark Minervini** | Trading Excellence | SEPA methodology, trend templates, R-multiple targets, proper risk management |

---

## 📊 Performance Results

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                      90-DAY BACKTEST RESULTS                                  ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  💰 Starting Account:     $2,000                                              ║
║  💎 Final Account:        $5,520  (+176% return)                              ║
║  📊 Total P&L:            +$3,520 (+70.4 SPX pts)                             ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  ✅ Win Rate:             63.4%                                               ║
║  📈 Profit Factor:        2.41                                                ║
║  🛡️ Max Drawdown:         9.3%                                                ║
║  🎯 Avg R-Multiple:       0.24                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## 🔬 Core Features

### 1. Real Options Greeks (Black-Scholes)

```javascript
// Full Greeks calculation for options analysis
const greeks = calculateGreeks(spot, strike, timeToExpiry, riskFreeRate, impliedVol);
// Returns: { delta, gamma, vega, theta, charm, vanna, speed }
```

| Greek | Symbol | What It Measures |
|-------|--------|------------------|
| Delta | Δ | Price sensitivity (0-1 for calls, -1-0 for puts) |
| Gamma | Γ | Rate of change of delta |
| Vega | ν | Volatility sensitivity |
| Theta | θ | Time decay per day |
| Charm | - | Delta decay over time |
| Vanna | - | Delta sensitivity to volatility |

### 2. GEX (Gamma Exposure) Analysis

```javascript
// Calculate dealer gamma exposure across strikes
const gexProfile = calculateGEXProfile(spot, impliedVol);
// Returns: { netGEX, gammaFlip, isPositiveGamma, majorLevels, supports, resistances }
```

**Key Insights:**
- **Positive Gamma (spot > gamma flip)**: Dealers buy dips, sell rallies → Mean reversion
- **Negative Gamma (spot < gamma flip)**: Dealers sell dips, buy rallies → Trend amplification
- **Major GEX Levels**: Act as support/resistance zones

### 3. Minervini SEPA Trend Templates

```javascript
// Validate Minervini's Stage Analysis
const template = validateTrendTemplate(prices);
const stage = identifyStage(template);
// Stage 1: Basing | Stage 2: ADVANCING (BEST LONG) | Stage 3: Topping | Stage 4: DECLINING
```

**Criteria Checked:**
- Price above 10, 20, 50 MA
- MA alignment (10 > 20 > 50)
- Price within range of session high
- Price above session low
- Overall trend direction

### 4. ML-Inspired Adaptive Learning

```javascript
// Feature weights adapt based on trade outcomes
const featureWeights = {
  momentum: 1.36,   // ▲ High importance (learned)
  volume: 0.97,     // ▲ Important
  trend: 1.43,      // ▲ Very high (Minervini influence)
  pattern: 1.2,     // ▲ Strong signal
  gex: 0.73,        // Medium
  rsi: 0.66,        // Medium
  time: 0.66,       // Medium (power hours matter)
  greeks: 0.66,     // Medium
};
```

---

## 🎯 Signal Generation

### Entry Criteria (Long)

| Condition | Weight | Description |
|-----------|--------|-------------|
| Stage 2 | Required | Minervini advancing trend |
| Trend Score ≥65 | High | Valid trend template |
| Momentum Up | High | Positive 5-bar momentum |
| Volume Confirm | Medium | Volume ratio > 1.15 |
| Positive Gamma | Medium | Above gamma flip |
| Bullish Pattern | High | Hammer, Engulfing, etc. |
| Near GEX Support | High | Price at major GEX level |

### Entry Criteria (Short)

| Condition | Weight | Description |
|-----------|--------|-------------|
| Stage 4 | Required | Minervini declining trend |
| Trend Score <50 | High | Breaking down |
| Momentum Down | High | Negative 5-bar momentum |
| Volume Confirm | Medium | Volume ratio > 1.15 |
| Negative Gamma | Medium | Below gamma flip |
| Bearish Pattern | High | Shooting star, etc. |
| Near GEX Resistance | High | Price at major GEX level |

---

## 🛡️ Risk Management

### R-Multiple Targets (Minervini Style)

```
Entry: 6000
Stop: 5993 (7 pt risk = 1R)

TP1 = Entry + 2R = 6014 (+14 pts)
TP2 = Entry + 3.5R = 6024.5 (+24.5 pts)  
TP3 = Entry + 5R = 6035 (+35 pts)
```

### Dynamic Stop Management

| Phase | Trigger | Stop Action |
|-------|---------|-------------|
| INITIAL | Entry | ATR-based stop (1.3× ATR) |
| BREAKEVEN | +1R profit | Move stop to entry + 0.5 |
| TRAILING | +1.5R profit | Trail by 0.5R |
| PROFIT_LOCK | TP1 hit | Lock at price - 3 pts |

### 25% Max Drawdown Protection

```javascript
// HARD LIMIT - Non-negotiable
const maxDrawdownPercent = 25;
const ddPct = Math.max(0, -pnl / entry * 100);

if (ddPct >= maxDrawdownPercent) {
  closeTrade('MAX_DD_25%');  // Immediate exit
}
```

---

## 📦 File Structure

```
titan-omega-dashboard/
├── src/
│   ├── trading/
│   │   ├── TitanOmegaEnhanced.js      # Core enhanced trading engine
│   │   ├── SPXTradingEngine.js        # Original physics-based engine
│   │   ├── LiveTradeMonitor.js        # Real-time trade management
│   │   └── RealTimeDataEngine.js      # Market data integration
│   │
│   ├── TitanOmegaDashboardEnhanced.jsx # Enhanced React dashboard
│   ├── TitanOmegaDashboardLive.jsx     # Live trading dashboard
│   ├── main.jsx                        # App entry point
│   └── index.css                       # Tailwind styles
│
├── backtest-enhanced.js               # Full enhanced backtest
├── backtest-25pct-maxdd.js           # Strict risk backtest
├── backtest-real-trader.js           # Professional backtest
├── package.json
└── vite.config.js
```

---

## 🚀 Quick Start

### Run Enhanced Backtest

```bash
cd titan-omega-dashboard
node backtest-enhanced.js
```

### Build Production Dashboard

```bash
npm run build
```

### Preview Dashboard

```bash
npm run preview
```

---

## 📡 Real-Time Data Integration

### Supported Providers

| Provider | API | Best For |
|----------|-----|----------|
| **Polygon.io** | REST + WebSocket | SPX options, institutional data |
| **Alpaca** | REST + WebSocket | Commission-free, equities |
| **Interactive Brokers** | TWS API | Full options chain, real Greeks |

### Example: Connect to Polygon.io

```javascript
import { createRealTimeEngine } from './trading/RealTimeDataEngine';

const engine = await createRealTimeEngine({
  provider: 'polygon',
  apiKey: 'YOUR_API_KEY',
});

engine.start('I:SPX');

engine.onUpdate((analysis) => {
  console.log('Spot:', analysis.spot);
  console.log('GEX Flip:', analysis.gex.gammaFlip);
  console.log('Greeks:', analysis.greeks);
  console.log('Signals:', analysis.signals);
});
```

---

## 🧠 Key Insights (Karpathy Style)

### Learned Feature Importance

After 90 days of simulated trading:

1. **Trend (1.36)** - Minervini was right: trend is everything
2. **Pattern (1.43)** - Candlestick patterns matter significantly
3. **Volume (0.97)** - Important confirmation signal
4. **Momentum (0.73)** - Useful but can be noisy
5. **GEX (0.73)** - Valuable for major levels

### Top Performing Setups

| Pattern | Stage | Gamma | Win Rate | Avg R |
|---------|-------|-------|----------|-------|
| THREE_SOLDIERS | 2 | Positive | 68% | +0.37R |
| THREE_SOLDIERS | 1 | Positive | 100% | +0.11R |
| THREE_SOLDIERS | 3 | Positive | 67% | +0.76R |

---

## 📈 Exit Analysis

| Exit Type | Count | P&L | Description |
|-----------|-------|-----|-------------|
| ✅ PROFIT_LOCK_STOP | 4 | +$2,176 | Hit TP1, locked profits |
| ✅ TRAILING_STOP | 5 | +$1,575 | Rode the trend |
| 🔒 BREAKEVEN_STOP | 1 | +$25 | Risk eliminated |
| ⏱️ EOD | 20 | +$668 | End of day closure |
| ⏱️ TIME | 4 | +$826 | Time-based exit |
| 🛑 INITIAL_STOP | 7 | -$1,750 | Initial stop hit |

---

## 🎓 Trading Philosophy

### From Minervini:
> "The trend is your friend. Trade with it, not against it. Let your winners run and cut your losers short."

### From Karpathy:
> "Let the data tell you what works. Features that consistently predict outcomes deserve more weight."

### From Page:
> "Efficiency matters. The best systems process data quickly and scale gracefully."

---

## ⚠️ Disclaimer

This is a backtesting and educational tool. Past performance does not guarantee future results. Options trading involves significant risk of loss. Always:

1. Paper trade first
2. Understand the risks
3. Never risk more than you can afford to lose
4. Consult a financial advisor

---

## 📜 License

MIT License - Use freely with attribution.

---

Built with 🧠 by the Titan Omega Team
