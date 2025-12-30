# TITAN SYSTEM ARCHITECTURE

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Polygon.io API                Economic Calendar    ES Futures  │
│  ├─ SPY Last Trade             ├─ FOMC Events       ├─ Price    │
│  ├─ Options Snapshot           ├─ CPI Release       ├─ Momentum │
│  └─ 1-Min Bars                 └─ NFP Data          └─ OB Imbal │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     PROCESSING LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  titan_server.py (FastAPI)                                       │
│  ├─ Fetch & Cache Data (2-second poll)                          │
│  ├─ Calculate Exposures (GEX/VEX/Delta)                         │
│  ├─ Compute Gamma Walls & Flip Level                            │
│  ├─ Calculate Vol Regime (RV short/long)                        │
│  ├─ Detect Market Session (OPEN/CLOSED)                         │
│  └─ Monitor Data Quality (freshness/gaps)                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      ANALYSIS LAYER                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TITAN Physics Engine (TypeScript Logic)                        │
│  ├─ Dynamic Sigma Calculation                                   │
│  ├─ Node Health Assessment (touch decay)                        │
│  ├─ Force Vector Computation (Gaussian PDF)                     │
│  ├─ Momentum Analysis (velocity/acceleration)                   │
│  ├─ Regime Classification (POS/NEG GEX)                         │
│  ├─ Kill Zone Detection (high kinetic energy)                   │
│  ├─ Vacuum Zone Identification                                  │
│  ├─ ES Correlation Analysis                                     │
│  ├─ IV Crush Risk Assessment                                    │
│  └─ Scenario Detection (DIP_BUY/GAMMA_FLIP)                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                       RISK LAYER (Phase 1)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Circuit Breaker                                                 │
│  ├─ Daily Loss Limit (2% max)                                   │
│  ├─ Consecutive Loss Counter (3 max)                            │
│  ├─ Win Rate Monitor (35% min)                                  │
│  └─ Cooldown Timer (30 min after breach)                        │
│                                                                  │
│  Economic Calendar Blackout                                      │
│  ├─ Pre-Event Window (10 min)                                   │
│  └─ Post-Event Window (5 min)                                   │
│                                                                  │
│  Data Quality Gate                                               │
│  ├─ Post-Gap Warmup (3 ticks)                                   │
│  ├─ Spot Age Check (10s max)                                    │
│  └─ Options Age Check (180s max)                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     EXECUTION LAYER (Phase 2)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Position Manager                                                │
│  ├─ Entry Signal Router (NOW/READY/PREP)                        │
│  ├─ Kelly Position Sizer                                        │
│  ├─ Order Type Selector (Market/Limit)                          │
│  └─ Broker API Integration (TastyTrade/IBKR)                    │
│                                                                  │
│  Exit Manager                                                    │
│  ├─ Stop Loss Monitor                                           │
│  ├─ Target Monitor                                              │
│  ├─ Trailing Stop Adjuster                                      │
│  ├─ Break-Even Stop Mover                                       │
│  ├─ Regime Flip Detector                                        │
│  ├─ Equilibrium Scale-Out                                       │
│  └─ Time-Based Exit (stale trades)                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    NOTIFICATION LAYER                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Telegram Bot                                                    │
│  ├─ Scenario Alerts (with confidence/urgency)                   │
│  ├─ Exit Notifications (with P&L)                               │
│  └─ Circuit Breaker Warnings                                    │
│                                                                  │
│  Terminal UI (WebSocket)                                         │
│  ├─ Live Scenario Display                                       │
│  ├─ Gamma Field Visualization                                   │
│  ├─ Position Tracker                                            │
│  └─ Alert History                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     PERSISTENCE LAYER                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SQLite Database (titan.db)                                      │
│  ├─ alerts table (scenario history)                             │
│  ├─ outcomes table (performance tracking)                       │
│  └─ trades table (execution log)                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagram

### Scenario Detection Flow

```
1. Market Data Ingestion
   ├─ Polygon: SPY last trade → spot price
   ├─ Polygon: Options snapshot → 250 contracts with OI+greeks
   └─ Manual: ES futures data → momentum/order book imbalance

2. Exposure Calculation
   ├─ Net GEX = Σ(OI × 100 × gamma × spot²) × call_put_sign
   ├─ Net VEX = Σ(OI × 100 × vega)
   ├─ Net Delta = Σ(OI × 100 × delta)
   ├─ Gamma Walls = Top 5 strikes by |gamma|
   └─ Gamma Flip = Zero-crossing of cumulative signed gamma

3. Physics Engine Analysis
   ├─ Calculate dynamic sigma (VIX + time + RV adjusted)
   ├─ Compute node health for each strike:
   │   └─ Mass = absGamma × touch_decay × theta_multiplier
   ├─ Calculate force vector:
   │   ├─ Up force = Σ(gaussian_pdf × gamma) for strikes > spot
   │   └─ Down force = Σ(gaussian_pdf × gamma) for strikes < spot
   ├─ Compute momentum (velocity, acceleration, kinetic energy)
   ├─ Classify regime (POS/NEG GEX, flip zone, kill zone)
   └─ Check ES correlation (divergence warning)

4. Scenario Detection
   ├─ IF spot near support gamma wall (< 20 points):
   │   ├─ AND momentum down (vwVel < -1)
   │   ├─ AND no regime kill zone
   │   ├─ AND ES aligned (conf_mult > 0.8)
   │   └─ THEN → DIP_BUY scenario (confidence 50-90%)
   │
   └─ IF spot near gamma flip (< 5 points):
       ├─ AND momentum toward flip
       ├─ AND kinetic energy rising
       └─ THEN → GAMMA_FLIP scenario (confidence 55-85%)

5. Risk Gating
   ├─ Check circuit breaker (daily loss/consecutive losses)
   ├─ Check economic calendar (blackout window?)
   ├─ Check data quality (post-gap warmup?)
   └─ IF all pass → Generate alert

6. Position Sizing
   ├─ Kelly fraction = (win_prob × avg_win - loss_prob × avg_loss) / avg_loss
   ├─ Adjust for regime (explosive = 60% Kelly)
   ├─ Adjust for ES divergence (low corr = 70% Kelly)
   ├─ Adjust for IV crush risk (high theta = 80% Kelly)
   ├─ Cap at max_kelly (10% of account)
   └─ Convert to contracts ($ allocation / strike price / 100)

7. Alert Distribution
   ├─ Update GLOBAL_STATE (for WebSocket broadcast)
   ├─ Insert into SQLite alerts table
   ├─ Send Telegram notification (if enabled)
   └─ Log to titan_server.py logger
```

---

## Position Lifecycle

### From Signal → Entry → Management → Exit

```
┌──────────────┐
│  New Signal  │
│  Generated   │
└──────┬───────┘
       │
       ↓
┌──────────────────────────────────┐
│  Entry Decision                  │
│  ├─ Urgency = NOW?               │
│  │   └─ Market order (5-tick slp)│
│  ├─ Urgency = READY?             │
│  │   └─ Limit at mid (10s timeout)│
│  └─ Urgency = PREP/WAIT?         │
│      └─ Monitor, don't enter yet │
└──────┬───────────────────────────┘
       │
       ↓
┌──────────────────────────────────┐
│  Position Opened                 │
│  ├─ Log entry price/time         │
│  ├─ Set OCO stop/target          │
│  ├─ Add to active_positions[]    │
│  └─ Send entry alert (Telegram)  │
└──────┬───────────────────────────┘
       │
       ↓
┌────────────────────────────────────────────────┐
│  Position Management (Every 2-second loop)     │
│                                                │
│  Exit Rule Checks:                             │
│  ├─ 1. Stop hit? → CLOSE_NOW                  │
│  ├─ 2. Target hit? → CLOSE_NOW                │
│  ├─ 3. Regime flipped? → CLOSE_NOW            │
│  ├─ 4. Gamma flip crossed? → CLOSE_NOW        │
│  ├─ 5. Near equilibrium? → SCALE_OUT 50%      │
│  ├─ 6. Stale (45min)? → CLOSE_NOW             │
│  ├─ 7. VIX spike? → CLOSE_NOW                 │
│  ├─ 8. Profit 5+ pts? → MOVE_STOP (trail)     │
│  └─ 9. Profit 3+ pts? → MOVE_STOP (breakeven) │
│                                                │
└──────┬─────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────┐
│  Position Closed                 │
│  ├─ Execute exit order           │
│  ├─ Calculate realized P&L       │
│  ├─ Update circuit breaker state │
│  ├─ Log to closed_positions[]    │
│  ├─ Insert outcome to SQLite     │
│  └─ Send exit alert (Telegram)   │
└──────┬───────────────────────────┘
       │
       ↓
┌──────────────────────────────────┐
│  Post-Trade Analysis             │
│  ├─ Record outcome metrics       │
│  ├─ Update win/loss counters     │
│  ├─ Check circuit breaker rules  │
│  └─ Archive for backtesting      │
└──────────────────────────────────┘
```

---

## Key Algorithms Explained

### 1. Dynamic Sigma Calculation

```typescript
function calcSigma(minsToExp: number, vix: number, rv: number): number {
  // Time factor (sqrt of fraction of trading day)
  const time = Math.sqrt(Math.min(1, minsToExp / 390));
  
  // Volatility regime factor (non-linear VIX scaling)
  const vol = Math.pow(vix / VIX_BASELINE, VIX_EXPONENT);
  
  // Realized vol adjustment (recent vs historical)
  const rvFactor = Math.max(0.5, Math.min(2, rv / 10));
  
  // Combined sigma (clamped to min/max)
  return clamp(
    SIGMA_BASE * time * vol * rvFactor,
    SIGMA_MIN,
    SIGMA_MAX
  );
}
```

**Why This Works**:
- Time factor accounts for theta decay acceleration
- VIX exponent captures regime shifts (low vol = tight bands)
- RV adjustment prevents over/under-reaction to recent volatility

### 2. Force Vector Computation

```typescript
function computeForce(spot: number, nodes: Node[], sigma: number): ForceVector {
  let upForce = 0;
  let downForce = 0;
  
  for (const node of nodes) {
    // Gaussian probability density at current spot
    const pdf = gaussianPDF(spot, node.strike, sigma);
    
    // Force magnitude (gamma scaled by probability)
    const force = (node.absGamma / GEX_SIGNIFICANCE) * pdf * sigma * √(2π);
    
    // Direction depends on strike location
    if (node.strike > spot) {
      upForce += force;
    } else {
      downForce += force;
    }
  }
  
  // Net imbalance determines direction
  const netForce = upForce - downForce;
  const totalForce = upForce + downForce;
  
  return {
    direction: netForce > 0.1 * totalForce ? 'UP' : 
               netForce < -0.1 * totalForce ? 'DOWN' : 'BALANCED',
    imbalance: Math.abs(netForce) / totalForce
  };
}
```

**Physics Intuition**:
- Strikes act like magnets with strength = gamma
- Probability of reaching strike = Gaussian distance
- Net force determines dealer hedging pressure

### 3. Touch Decay System

```typescript
interface Node {
  strike: number;
  gamma: number;
  touchCount: number;  // How many times price tested this level
}

function computeNodeHealth(node: Node, spot: number): NodeHealth {
  // Exponential decay after each touch
  const touchPower = Math.pow(TOUCH_DECAY, node.touchCount);
  // TOUCH_DECAY = 0.66, so 1st touch = 66%, 2nd = 44%, 3rd = 29%
  
  // Time decay (closer to expiry = weaker)
  const timeDecay = minsToExpiry < 120 ? minsToExpiry / 120 : 1;
  
  // Combined remaining strength
  const remaining = touchPower * timeDecay;
  
  // Effective mass for force calculations
  const mass = node.gamma * remaining;
  
  return {
    strike: node.strike,
    health: remaining > 0.6 ? 'HEALTHY' : 
            remaining > 0.3 ? 'WEAK' : 'DYING',
    mass
  };
}
```

**Why This Works**:
- Each touch weakens dealer positioning (they hedge incrementally)
- Prevents false bounces at "dead" levels
- Models reality better than static support/resistance

### 4. Kelly Position Sizing

```typescript
function calcPosition(
  confidence: number,  // 0-100
  riskReward: number,  // target/stop ratio
  regime: Regime,
  esCorr: number,
  ivRisk: IVCrush
): Position {
  // Base Kelly fraction
  const winProb = confidence / 100;
  const kellyFraction = (winProb * riskReward - (1 - winProb)) / riskReward;
  
  // Regime adjustment (explosive = reduce size)
  let sizeMultiplier = regime.char === 'EXPLOSIVE' ? 0.6 : 1.0;
  
  // ES divergence adjustment (low correlation = reduce)
  if (esCorr < 0.6) sizeMultiplier *= 0.7;
  
  // IV crush adjustment (high theta = reduce)
  if (ivRisk.vegaThetaRatio < 1.5) sizeMultiplier *= 0.8;
  
  // Final kelly (clamped to safety limits)
  const adjustedKelly = clamp(
    kellyFraction * sizeMultiplier,
    MIN_KELLY,  // 2%
    MAX_KELLY   // 10%
  );
  
  return {
    kellyFraction: adjustedKelly,
    contracts: Math.floor(accountSize * adjustedKelly / (strikePrice * 100))
  };
}
```

**Risk Controls**:
- Kelly naturally sizes based on edge and R:R
- Regime adjustments prevent oversizing in chaos
- Multiple layers of size reduction (multiplicative)
- Hard caps prevent account blow-up

---

## Integration Points

### Current Integrations
- ✅ Polygon.io (SPY spot + options)
- ✅ SQLite (alert/outcome storage)
- ✅ Streamlit (terminal UI)
- ✅ FastAPI (backend server)

### Phase 1 Additions
- 🔧 Telegram Bot API (mobile alerts)
- 🔧 TradingEconomics API (calendar)
- 🔧 Internal circuit breaker (state management)
- 🔧 Internal exit engine (position tracking)

### Phase 2 Additions
- 📋 TastyTrade API (automated execution)
- 📋 Tradier API (backup data feed)
- 📋 TDAmeritrade API (Level 2 order book)
- 📋 CBOE DataShop (premium GEX data)

### Phase 3 Additions
- 📋 Backtesting engine (performance analysis)
- 📋 Parameter optimizer (adaptive tuning)
- 📋 Multi-timeframe analyzer (5m/15m filter)

---

## Failure Modes & Mitigations

### Data Layer Failures
**Issue**: Polygon API downtime
**Impact**: No spot price or options data
**Mitigation**: 
- Add Tradier as backup feed (Phase 2)
- Cache last-known-good data (5-second staleness allowed)
- Set GLOBAL_STATE["engine_status"] = "DEGRADED"
- Block new entries, manage existing positions only

### Analysis Layer Failures
**Issue**: TypeScript engine exception
**Impact**: No scenario generation
**Mitigation**:
- Result<T, E> type system catches errors gracefully
- Log error, return Err() instead of crashing
- UI shows "Analysis Error" with reason
- Fallback to simple gamma wall proximity alerts

### Execution Layer Failures
**Issue**: Broker API timeout during entry
**Impact**: Miss trade or partial fill
**Mitigation**:
- 5-second timeout on order placement
- Retry once with market order if limit times out
- Log partial fills, adjust stop/target accordingly
- Alert user via Telegram of execution issues

### Risk Control Bypass
**Issue**: Circuit breaker bug allows overtrading
**Impact**: Catastrophic losses
**Mitigation**:
- Unit tests for all circuit breaker rules
- Manual kill switch in UI (red button → halt all)
- Broker-level position limits as backstop
- Daily manual review of trade log

---

## Performance Characteristics

### Latency Budget (2-second polling cycle)
- Data fetch: 200ms (Polygon API)
- Exposure calculation: 50ms (vectorized numpy)
- Physics engine analysis: 100ms (TypeScript)
- Risk checks: 10ms (circuit breaker)
- Alert distribution: 50ms (WebSocket + Telegram)
- **Total**: 410ms per cycle (leaves 1.6s buffer)

### Scalability
- **Current**: Processes 250 contracts/snapshot
- **Phase 2**: Can handle 5000+ contracts with optimization
- **Bottleneck**: Polygon API rate limits (not system)
- **Solution**: Batch requests, use WebSocket for ticks

### Reliability
- **Current Uptime**: ~95% (single Polygon dependency)
- **Phase 1 Target**: 99% (with circuit breaker safe halts)
- **Phase 2 Target**: 99.5% (multi-feed redundancy)
- **MTTR** (Mean Time To Recovery): < 2 minutes (auto-restart)

---

## Security Considerations

### API Key Management
- ✅ Use environment variables (never hardcode)
- ✅ .gitignore includes .env file
- 🔧 Add key rotation schedule (90 days)
- 🔧 Encrypt at rest (future: use Vault)

### Execution Safety
- ✅ Position size caps (10% max Kelly)
- ✅ Account max risk (1.5% per trade)
- 🔧 IP whitelist for broker API
- 🔧 2FA for terminal access

### Data Integrity
- ✅ Spot age validation (10s max)
- ✅ Options age validation (180s max)
- ✅ Post-gap warmup (3 ticks)
- 🔧 Checksum validation on SQLite writes

---

## Testing Strategy

### Unit Tests
- Physics engine functions (sigma calc, force vector)
- Exposure calculations (GEX/VEX formulas)
- Circuit breaker rules (all trigger conditions)
- Exit logic (all 9 rules)

### Integration Tests
- Polygon API mocking (test with stale/invalid data)
- SQLite persistence (write + read roundtrip)
- WebSocket streaming (test 100+ rapid updates)

### System Tests
- Paper trading (30-day minimum before live)
- Replay historical data (backtest 2023-2024)
- Stress test (simulated flash crash scenario)

### Performance Tests
- 1000 contracts processing time (< 200ms)
- 100 concurrent WebSocket clients (no lag)
- 24-hour continuous run (no memory leaks)

---

**See PHASE1_IMPLEMENTATION_GUIDE.md for executable code to upgrade the system.**
