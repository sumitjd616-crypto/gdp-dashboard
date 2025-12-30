# ⚡ TITAN OMEGA v18.0

## Ultimate SPX Day Trading Physics Engine

TITAN OMEGA is a professional-grade trading analysis system built on physics-inspired mathematical models for SPX/SPY options day trading.

---

## 🚀 Features

### Core Physics Engine (`titan_core.py`)
- **Gaussian Force Field Model** - Price attraction/repulsion based on gamma exposure
- **VIX-Scaled Sigma** - Dynamic influence radius adapting to volatility
- **Vacuum Zone Detection** - Identifies price acceleration zones
- **Post-Gap Warmup Protection** - 3-tick delay after data gaps
- **Surgical IV Crush Analysis** - Vega/Theta weighted, not binary
- **ES Deadzone Fix** - 0.15 momentum threshold for grinding markets
- **Kelly Criterion Position Sizing** - Mathematically optimal risk management

### Time Context Engine (`titan_time.py`)
- **Market Session Detection** - Open Drive, Reversal Zone, Midday Chop, Power Hour, MOC
- **OPEX Friday Handling** - Monthly/Weekly/Quad Witch awareness
- **FOMC/CPI Event Detection** - Economic calendar integration
- **Charm Acceleration Modeling** - Time decay acceleration near close
- **Session-Specific Strategy Recommendations**

### Multi-Expiry GEX Module (`titan_gex.py`)
- **0DTE + Weekly + Monthly Stacking** - Time-weighted gamma aggregation
- **Max Pain Calculation** - Pin level identification
- **Put Wall / Call Wall Detection** - Support/resistance from gamma
- **Gamma Flip Level Computation** - Key regime change level
- **Volume-Weighted Gamma Influence**

### Flow Intelligence Engine (`titan_flow.py`)
- **Sweep Detection** - Multi-exchange urgency identification
- **Block Trade Analysis** - Large single prints
- **Dark Pool Print Analysis** - Off-exchange flow
- **Smart Money Flow Scoring** - Execution quality analysis
- **Net Premium Flow Calculation**

### Volatility Surface Monitor (`titan_volatility.py`)
- **VIX Term Structure** - VIX9D/VIX/VIX3M/VIX6M analysis
- **VVIX Regime Detection** - Vol of vol awareness
- **IV Skew Analysis** - Put/call skew monitoring
- **RV vs IV Divergence** - Crush/expansion prediction
- **Volatility Regime Classification**

### Intermarket Divergence Detector (`titan_intermarket.py`)
- **SPX vs ES Correlation** - Futures/spot alignment
- **DXY (Dollar) Divergence** - Currency relationship
- **TLT (Bonds) Flight-to-Safety** - Risk sentiment
- **Risk-On/Risk-Off Regime Detection**
- **Multi-Asset Confirmation Scoring**

---

## 📁 File Structure

```
/workspace/
├── titan.py                 # Unified module (import from here)
├── titan_core.py            # Core physics engine
├── titan_time.py            # Time context engine
├── titan_gex.py             # Multi-expiry GEX analysis
├── titan_flow.py            # Options flow intelligence
├── titan_volatility.py      # Volatility surface analysis
├── titan_intermarket.py     # Intermarket divergence
├── titan_dashboard.py       # Streamlit UI dashboard
├── requirements.txt         # Python dependencies
└── TITAN_README.md          # This file
```

---

## 🛠️ Installation

```bash
# Clone or download the workspace
cd /workspace

# Install dependencies
pip install -r requirements.txt

# Run the dashboard
streamlit run titan_dashboard.py
```

---

## 💻 Quick Start

### Using the Unified Interface

```python
from titan import TitanOmega

# Initialize
titan = TitanOmega(account_size=50000)

# Update market data
titan.update_prices(spx=5950, es=5955, vix=18, dxy=104.5, tlt=92.0)
titan.update_gex(net_gex=1.5e9, flip=5930)

# Run analysis
result = titan.analyze()

# Access results
print(f"Signal: {result['core'].signal.value}")
print(f"Best Scenario: {result['core'].best_scenario}")
print(f"Recommendation: {result['recommendation']}")
```

### Using Individual Engines

```python
from titan_core import TitanEngine, GammaNode, Bar
from titan_time import TimeContextEngine

# Core engine
engine = TitanEngine(account_size=50000)

# Add price bars
bar = Bar(time=1234567890, open=5950, high=5952, low=5948, close=5951, volume=1000)
engine.add_bar(bar)

# Create gamma nodes
nodes = [
    GammaNode(strike=5960, gamma=2e9, abs_gamma=2e9, sign=1),
    GammaNode(strike=5940, gamma=-1.5e9, abs_gamma=1.5e9, sign=-1),
]

# Analyze
result = engine.analyze(spot=5950, nodes=nodes, net_gex=1e9, flip=5930, vix=18)

# Time context
time_engine = TimeContextEngine()
ctx = time_engine.get_context()
print(f"Session: {ctx.session.session.value}")
print(f"Size Multiplier: {ctx.final_size_mult}")
```

---

## 📊 Signal Types

| Signal | Meaning | Action |
|--------|---------|--------|
| `CONVICTION_LONG` | Structure + Flow aligned bullish | Enter long on pullback |
| `CONVICTION_SHORT` | Structure + Flow aligned bearish | Enter short on rally |
| `FLOW_DIVERGENCE` | Flow contradicts structure | Reduce size or wait |
| `NEUTRAL` | No clear edge | Wait for setup |
| `NO_TRADE` | Data issues (gap/warming) | Do not trade |

---

## 🎯 Scenario Types

| Scenario | Description | Entry |
|----------|-------------|-------|
| `DIP_BUY` | Long at gamma support | On pullback to support strike |
| `GAMMA_FLIP` | Trade through flip level | On momentum through flip |
| `RESISTANCE_FADE` | Short at gamma resistance | On rally into resistance strike |

---

## ⚠️ Risk Management

### Kelly Criterion
Position sizes are calculated using fractional Kelly:
```
Kelly = ((WinProb × RiskReward) - (1 - WinProb)) / RiskReward × 0.25
```

### Penalties Applied
- **ES Divergence**: -40% confidence
- **Negative Gamma**: -15%
- **Phase (near flip)**: -30%
- **Kill Zone**: -40%
- **Data Gap**: -80%
- **IV Crush**: Variable based on Vega/Theta ratio

### Position Limits
- Max Kelly: 10%
- Min Kelly: 2%
- Max Risk per Trade: 1.5% of account

---

## 📈 Market Sessions

| Session | Time (ET) | Characteristics |
|---------|-----------|-----------------|
| Open Drive | 9:30-9:45 | Momentum continuation |
| Open Reversal | 9:45-10:15 | Fades work |
| Morning Trend | 10:15-11:30 | Best trending |
| Midday Chop | 11:30-14:00 | Reduce size 50% |
| Afternoon Trend | 14:00-14:30 | Setup building |
| Power Hour | 14:30-15:30 | Momentum resumes |
| MOC Imbalance | 15:30-16:00 | Follow MOC |

---

## 🌡️ Volatility Regimes

| Regime | VIX Range | Action |
|--------|-----------|--------|
| LOW | < 12 | Increase size, expect crush |
| NORMAL | 12-18 | Standard sizing |
| ELEVATED | 18-25 | Reduce size 20% |
| HIGH | 25-35 | Reduce size 40% |
| EXTREME | 35-50 | Reduce size 60% |
| CRISIS | > 50 | Reduce size 80% |

---

## 🔧 Configuration

Key parameters can be adjusted in each module's `CONFIG` class:

```python
# titan_core.py
CONFIG.SIGMA_BASE = 10.0        # Price influence radius
CONFIG.VIX_BASELINE = 15.0      # VIX normalization base
CONFIG.KELLY_FRACTION = 0.25    # Kelly multiplier
CONFIG.MAX_RISK_PCT = 0.015     # 1.5% max risk

# titan_time.py
# Market session times are Eastern Time

# titan_flow.py
CONFIG.SWEEP_MIN_SIZE = 50      # Minimum sweep contracts
CONFIG.BLOCK_SIZE = 200         # Block trade threshold
```

---

## 🔮 Future Enhancements

1. **Machine Learning Integration**
   - XGBoost regime classification
   - Dynamic parameter tuning
   - Pattern recognition

2. **Live Data Integration**
   - Polygon.io WebSocket
   - CBOE data feeds
   - Dark pool feeds

3. **Backtesting Framework**
   - Historical simulation
   - Performance metrics
   - Strategy optimization

4. **Alert System**
   - Discord/Telegram notifications
   - Sound alerts
   - SMS notifications

---

## ⚠️ Disclaimer

**TITAN OMEGA is for educational and research purposes only.**

- This is not financial advice
- Past performance does not guarantee future results
- Options trading involves substantial risk of loss
- Only trade with money you can afford to lose
- Always do your own research and due diligence

---

## 📜 License

MIT License - See LICENSE file for details.

---

## 🤝 Contributing

Contributions welcome! Please read the contribution guidelines before submitting PRs.

---

**Built with ⚡ by the TITAN Development Team**
