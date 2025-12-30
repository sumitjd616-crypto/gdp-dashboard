# 🚀 TITAN TRADING SYSTEM
## Physics-Based SPX Day Trading Engine

> **Gamma field modeling for institutional-edge day trading**

[![Status](https://img.shields.io/badge/Status-Beta-yellow)]()
[![Version](https://img.shields.io/badge/Version-2.5-blue)]()
[![Edge](https://img.shields.io/badge/Edge_Score-7.5%2F10-green)]()

---

## 📊 What This Is

TITAN is a **gamma-based options positioning system** that treats strike prices as gravitational nodes in a force field. By modeling dealer exposure dynamics, it generates high-probability trade setups for SPX/SPY day trading.

**Unique Approach**: Instead of static technical analysis, TITAN uses **options market microstructure** (gamma, vanna, charm) to predict where price *wants* to go based on dealer hedging flows.

---

## 🎯 System Components

### 1. TITAN Physics Engine v2.5 (TypeScript)
**Location**: `src/titan-physics-engine.ts` (see `physics-engine-fixes` branches)

- **Gamma Field Modeling**: Strikes as force nodes with mass = gamma exposure
- **Dynamic Volatility**: VIX-adjusted, time-decaying sigma calculations
- **Node Health System**: Touch decay tracking (prevents false signals)
- **Regime Detection**: POS/NEG GEX classification + flip zones
- **Kill Zone Detection**: High-kinetic-energy explosive moves
- **Vacuum Zones**: Low-gamma breakout areas
- **IV Crush Protection**: Surgical vega/theta ratio analysis per strike
- **ES Correlation**: Detects SPX/ES divergences for confidence adjustment

### 2. TITAN OMEGA v17.5 Terminal (Python)
**Location**: `titan_server.py`, `streamlit_app.py` (see `titan-omega-v17-5-upgrade` branch)

- **FastAPI Backend**: Real-time processing with WebSocket streaming
- **Polygon.io Integration**: Live SPY options snapshots + last trades
- **Exposure Calculations**: GEX, VEX, Delta, Gamma Walls, Flip Level
- **Regime Alerts**: PRE, FLUSH, CHARM, NEUTRAL states
- **Market Mood**: TREND, VOL_EXPANSION, MEAN_REVERT signals
- **SQLite Archive**: Trade outcome persistence for backtesting

### 3. Real-Time Terminal UI
**Location**: `static/titan_terminal.html` (embedded in Streamlit)

- Live scenario updates (2-second polling)
- Gamma wall visualization
- Data quality indicators
- Alert history
- ES correlation display

---

## 📈 How It Works

```
Polygon API → Options Snapshot (250 contracts)
    ↓
Exposure Calculation (GEX/VEX/Delta)
    ↓
Physics Engine Analysis (force vectors, equilibrium)
    ↓
Scenario Detection (DIP_BUY, GAMMA_FLIP)
    ↓
Position Sizing (Kelly criterion)
    ↓
Alert Generation → Telegram/Terminal UI
```

**Key Insight**: When price approaches a gamma wall, dealers must hedge. In positive GEX regimes, this creates magnetic pull (mean reversion). In negative GEX, it creates repulsion (momentum continuation).

---

## 🔥 Current Edge (Why It Works)

1. **Novel Physics Modeling** - Competitors use static levels; TITAN models dynamic forces
2. **Touch Decay Tracking** - Prevents "dead" level false signals (exponential decay)
3. **Vacuum Detection** - Identifies low-liquidity air pockets for breakout trades
4. **Surgical IV Crush** - Strike-specific vega/theta analysis (not blanket)
5. **Data Quality Gating** - Post-gap warmup prevents false signals
6. **Multi-Factor Confluence** - ES correlation + IV regime + momentum alignment

**Current Edge Score**: 7.5/10 (institutional-quality core, missing execution automation)

---

## 📋 Setup Instructions

### Prerequisites
- Python 3.10+
- Node.js 18+ (for TypeScript engine)
- Polygon.io API key ($200/month for real-time options)
- $25k+ trading account (PDT rule)

### Installation

1. **Clone and install**
   ```bash
   git clone <repo>
   cd <repo>
   pip install -r requirements.txt
   ```

2. **Configure environment**
   ```bash
   # Create .env file
   POLYGON_API_KEY=your_key_here
   TELEGRAM_BOT_TOKEN=your_bot_token  # Optional
   TELEGRAM_CHAT_ID=your_chat_id      # Optional
   ```

3. **Run terminal**
   ```bash
   streamlit run streamlit_app.py
   ```

4. **Access UI**
   - Open browser to `http://localhost:8501`
   - Terminal UI loads at `http://localhost:8000`

---

## 📚 Documentation

### Core Docs (READ THESE FIRST)
- **[TITAN_TRADING_SYSTEM_ANALYSIS.md](./TITAN_TRADING_SYSTEM_ANALYSIS.md)** - Complete system analysis, gaps, and roadmap
- **[PHASE1_IMPLEMENTATION_GUIDE.md](./PHASE1_IMPLEMENTATION_GUIDE.md)** - Copy-paste code for immediate upgrades
- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Cheat sheet and action plan

### What Each Doc Covers

| Document | Purpose | Time to Read |
|----------|---------|--------------|
| **TITAN_TRADING_SYSTEM_ANALYSIS.md** | Full analysis + 90-day roadmap | 30 min |
| **PHASE1_IMPLEMENTATION_GUIDE.md** | Executable code for risk management | 15 min |
| **QUICK_REFERENCE.md** | Action items + immediate wins | 5 min |

---

## 🎯 Immediate Next Steps (This Week)

### Priority 1: Risk Management (2 days)
- [ ] Add circuit breaker (daily loss limit, consecutive losses)
- [ ] Implement exit logic (stop/target/trailing/regime flip)
- [ ] Test with paper trades

### Priority 2: Event Protection (1 day)
- [ ] Integrate economic calendar (TradingEconomics API)
- [ ] Block trades 10min before FOMC/CPI/NFP
- [ ] Add blackout UI indicator

### Priority 3: Mobile Alerts (1 day)
- [ ] Setup Telegram bot via @BotFather
- [ ] Send scenario alerts to phone
- [ ] Test exit notifications

**Result After Week 1**: Production-ready system with institutional risk controls

---

## 🚨 Known Gaps & Limitations

### Critical Issues
- ❌ **Manual execution only** (10-30 second delay)
- ❌ **No systematic backtesting** (edge not proven)
- ❌ **Single data source** (Polygon downtime = system failure)
- ❌ **No exit automation** (leave profits on table)

### Medium Issues
- ⚠️ SPY proxy vs true SPX (10:1 tracking error)
- ⚠️ Limited options coverage (250 contracts vs full chain)
- ⚠️ No VIX term structure (contango/backwardation)
- ⚠️ Static parameter tuning (not adaptive to regime)

**See TITAN_TRADING_SYSTEM_ANALYSIS.md Section III for full list (20 gaps)**

---

## 🔧 Upcoming Features (90-Day Roadmap)

### Phase 1: Execution & Risk (Weeks 1-2)
- Automated order execution (TastyTrade API)
- Dynamic exit system (9 exit rules)
- Circuit breaker with cooldowns
- Economic calendar integration

### Phase 2: Data Infrastructure (Weeks 3-4)
- Multi-feed aggregation (Polygon + Tradier backup)
- SPX direct support (vs SPY proxy)
- Level 2 order book integration
- Tick-by-tick options flow

### Phase 3: Intelligence Layer (Weeks 5-6)
- Systematic backtesting engine
- Adaptive parameter tuning (by vol regime)
- Multi-timeframe confirmation (5m/15m filter)
- Performance analytics dashboard

### Phase 4: Professional Tooling (Weeks 7-8)
- Real-time gamma field visualization (Chart.js overlay)
- Trade journal with screenshots
- Position tracker with P&L
- Advanced alerting (Discord/SMS)

**Target Edge Score After 90 Days**: 9.4/10

---

## 📊 Performance Targets

| Metric | Current | Target (30 days) | Target (90 days) |
|--------|---------|------------------|------------------|
| Win Rate | ~50% | 60%+ | 65%+ |
| Avg R:R | 1.5:1 | 1.8:1 | 2.0:1 |
| Sharpe | Unknown | 2.0+ | 2.5+ |
| Max Drawdown | Unknown | < 12% | < 10% |
| Signals/Day | 3-5 | 6-8 | 8-12 |
| Execution Latency | 15-30s | 5-10s | < 2s |

---

## 🤝 Contributing

This is a private research project. For questions:
1. Review docs in order (Analysis → Phase 1 → Quick Reference)
2. Check `titan_server.py` logs for debugging
3. Test Polygon API directly with `curl` for data issues

---

## ⚠️ Disclaimer

**FOR EDUCATIONAL PURPOSES ONLY**

This system is experimental and involves substantial risk. Do not trade with capital you cannot afford to lose. Past performance does not guarantee future results. Options trading carries significant risk of loss.

The gamma physics model makes assumptions (r=0, q=0, no pin risk, Black-Scholes greeks) that may not hold in extreme market conditions. Dealer positioning is a proxy based on OI+greeks, not true institutional inventory.

Always paper trade for 30+ days before live deployment.

---

## 📜 License

See LICENSE file for details.

---

## 🚀 Quick Start Checklist

- [ ] Read TITAN_TRADING_SYSTEM_ANALYSIS.md (Section I-II for overview)
- [ ] Read QUICK_REFERENCE.md for immediate action items
- [ ] Set POLYGON_API_KEY in .env
- [ ] Run `streamlit run streamlit_app.py`
- [ ] Implement Phase 1 circuit breaker (1 day)
- [ ] Test with paper trades (1 week)
- [ ] Review performance metrics
- [ ] Proceed to Phase 2 (automated execution)

**Need help?** Review the 12-section analysis doc - it covers everything.

---

**Built with institutional-grade thinking. Ready for Phase 1 implementation.**
