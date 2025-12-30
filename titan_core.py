"""
TITAN OMEGA CORE ENGINE v18.0
=============================
Ultimate SPX Day Trading Physics Engine

Features:
- Gaussian force field with VIX-scaled sigma
- Post-gap warmup protection
- Surgical IV crush (Vega/Theta weighted)
- ES deadzone fix (0.15 threshold)
- Vacuum zone detection with hysteresis
- Kelly criterion position sizing
"""

import numpy as np
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from enum import Enum
import time


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class TitanConfig:
    """Core engine configuration with battle-tested defaults"""
    # Sigma (price influence radius)
    SIGMA_BASE: float = 10.0
    SIGMA_MIN: float = 2.0
    SIGMA_MAX: float = 30.0
    
    # VIX scaling
    VIX_BASELINE: float = 15.0
    VIX_EXPONENT: float = 1.5
    
    # GEX thresholds
    GEX_SIGNIFICANCE: float = 1e9
    
    # Vacuum zones
    VACUUM_ENTER_DIST: float = 6.0
    VACUUM_EXIT_DIST: float = 3.5
    VACUUM_REPULSION: float = -1.2
    
    # Flip zone
    FLIP_ZONE: float = 5.0
    
    # Kill zone
    KILL_ZONE_KE: float = 30.0
    
    # Theta explosion
    EXPLOSION_MINUTES: float = 30.0
    THETA_ACCEL: float = 2.5
    TOUCH_DECAY: float = 0.66
    
    # Data quality
    MAX_DATA_GAP_MS: int = 5000
    GAP_WARMUP_TICKS: int = 3
    STALE_DATA_PENALTY: float = 0.5
    
    # IV Crush
    VEGA_THETA_SAFE: float = 2.0
    IV_CRUSH_HIGH: float = 70.0
    
    # ES Correlation
    ES_DIVERGENCE_THRESHOLD: float = 0.4
    ES_MOMENTUM_THRESHOLD: float = 0.15  # Fixed: was 0.3
    ES_CONFIDENCE_CUT: float = 0.6
    
    # Position sizing
    KELLY_FRACTION: float = 0.25
    MIN_KELLY: float = 0.02
    MAX_KELLY: float = 0.10
    MAX_RISK_PCT: float = 0.015
    
    # Slippage
    SLIPPAGE_EXPLOSIVE: float = 0.6
    SLIPPAGE_WICKY: float = 0.75
    SLIPPAGE_KILL_ZONE: float = 0.5
    
    # Realized vol
    RV_WINDOW_BARS: int = 5
    
    # Flow thresholds
    SWEEP_SIZE: int = 50
    BLOCK_SIZE: int = 200


CONFIG = TitanConfig()


# ═══════════════════════════════════════════════════════════════════════════════
# ENUMS
# ═══════════════════════════════════════════════════════════════════════════════

class DataQuality(Enum):
    GOOD = "GOOD"
    STALE = "STALE"
    GAP = "GAP"
    WARMING = "WARMING"


class Direction(Enum):
    UP = "UP"
    DOWN = "DOWN"
    FLAT = "FLAT"
    BALANCED = "BALANCED"


class RegimeType(Enum):
    POSITIVE = "POS"
    NEGATIVE = "NEG"


class MarketCharacter(Enum):
    SMOOTH = "SMOOTH"
    CHOPPY = "CHOPPY"
    WICKY = "WICKY"
    EXPLOSIVE = "EXPLOSIVE"


class NodeHealth(Enum):
    FRESH = "FRESH"
    HEALTHY = "HEALTHY"
    WEAK = "WEAK"
    DYING = "DYING"
    EXPLODING = "EXPLODING"
    VACUUM = "VACUUM"


class Signal(Enum):
    CONVICTION_LONG = "CONVICTION_LONG"
    CONVICTION_SHORT = "CONVICTION_SHORT"
    FLOW_DIVERGENCE = "FLOW_DIVERGENCE"
    NEUTRAL = "NEUTRAL"
    NO_TRADE = "NO_TRADE"


class Urgency(Enum):
    WAIT = "WAIT"
    PREP = "PREP"
    READY = "READY"
    NOW = "NOW"


# ═══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class GammaNode:
    """Single gamma exposure point"""
    strike: float
    gamma: float
    abs_gamma: float
    sign: int  # 1 for calls, -1 for puts
    delta: float = 0.0
    oi: float = 0.0
    volume: float = 0.0
    touch_count: int = 0
    
    @property
    def gex(self) -> float:
        return self.abs_gamma * self.sign


@dataclass
class Bar:
    """OHLCV bar"""
    time: int  # timestamp ms
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class OptionsTrade:
    """Single options trade"""
    timestamp: int
    strike: float
    option_type: str  # 'call' or 'put'
    side: str  # 'buy' or 'sell'
    size: int
    price: float
    bid: float
    ask: float
    iv: Optional[float] = None
    vega: Optional[float] = None
    theta: Optional[float] = None
    delta: Optional[float] = None
    exchange: Optional[str] = None


@dataclass
class ESData:
    """ES futures data"""
    price: float
    momentum: float
    order_book_imbalance: float


@dataclass 
class TickState:
    """Tick-level state tracking"""
    last_update: int = 0
    prev_ke: float = 0.0
    prev_vix: float = 15.0
    quality: DataQuality = DataQuality.GOOD
    warmup_remaining: int = 0
    ticks_since_gap: int = 999


@dataclass
class NodeAnalysis:
    """Analysis of a single gamma node"""
    strike: float
    health: NodeHealth
    mass: float
    is_vacuum: bool
    decay_factor: float
    theta_mult: float


@dataclass
class ForceVector:
    """Directional force from gamma structure"""
    direction: Direction
    imbalance: float
    confidence: float
    equilibrium: float
    up_force: float
    down_force: float


@dataclass
class Momentum:
    """Price momentum metrics"""
    velocity: float
    vw_velocity: float  # Volume-weighted
    acceleration: float
    kinetic_energy: float
    direction: Direction


@dataclass
class Regime:
    """Market regime classification"""
    type: RegimeType
    flip: float
    dist_to_flip: float
    in_phase: bool
    kill_zone: bool
    character: MarketCharacter
    slippage_mult: float
    vol_correlation_mult: float


@dataclass
class ESCorrelation:
    """ES futures correlation analysis"""
    correlation: float
    divergent: bool
    confidence_mult: float
    es_direction: str


@dataclass
class IVCrushRisk:
    """IV crush analysis"""
    risk_score: float
    recommendation: str  # 'GO', 'CAUTION', 'AVOID'
    vega_theta_ratio: float
    surgical_penalty: float
    iv_trend: str  # 'FALLING', 'RISING', 'STABLE'


@dataclass
class Position:
    """Position sizing output"""
    kelly: float
    contracts: int
    max_risk: float
    penalties: List[str]
    adjusted_win_prob: float


@dataclass
class Scenario:
    """Trading scenario"""
    type: str
    confidence: float
    direction: str  # 'LONG' or 'SHORT'
    entry_low: float
    entry_high: float
    stop: float
    target: float
    urgency: Urgency
    position: Position
    warnings: List[str]
    trigger_strike: Optional[float] = None


@dataclass
class Warning:
    """System warning"""
    type: str
    severity: str  # 'INFO', 'WARN', 'CRIT'
    message: str


@dataclass
class EngineOutput:
    """Complete engine analysis output"""
    timestamp: int
    spot: float
    sigma: float
    realized_vol: float
    
    # Core analysis
    regime: Regime
    momentum: Momentum
    force: ForceVector
    es_correlation: ESCorrelation
    iv_crush: IVCrushRisk
    
    # Nodes
    node_analysis: List[NodeAnalysis]
    
    # Scenarios
    scenarios: List[Scenario]
    best_scenario: Optional[Scenario]
    
    # Warnings & quality
    warnings: List[Warning]
    data_quality: DataQuality
    signal: Signal


# ═══════════════════════════════════════════════════════════════════════════════
# CORE PHYSICS FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def gaussian_pdf(x: float, mu: float, sigma: float) -> float:
    """Standard Gaussian probability density function"""
    return (1.0 / (sigma * np.sqrt(2 * np.pi))) * np.exp(-((x - mu) ** 2) / (2 * sigma ** 2))


def calc_realized_vol(bars: List[Bar], window: int = None) -> float:
    """Calculate realized volatility from price bars"""
    window = window or CONFIG.RV_WINDOW_BARS
    if len(bars) < window + 1:
        return 10.0
    
    recent = bars[-(window + 1):]
    returns = []
    for i in range(1, len(recent)):
        ret = np.log(recent[i].close / recent[i - 1].close)
        returns.append(ret * ret)
    
    rv = np.sqrt(sum(returns) / len(returns)) * 1000
    return max(5.0, min(50.0, rv))


def calc_sigma(mins_to_exp: float, vix: float, rv: float) -> float:
    """Calculate dynamic sigma based on time, VIX, and realized vol"""
    time_factor = np.sqrt(min(1.0, mins_to_exp / 390))
    vol_factor = (vix / CONFIG.VIX_BASELINE) ** CONFIG.VIX_EXPONENT
    rv_factor = max(0.5, min(2.0, rv / 10))
    
    sigma = CONFIG.SIGMA_BASE * time_factor * vol_factor * rv_factor
    return max(CONFIG.SIGMA_MIN, min(CONFIG.SIGMA_MAX, sigma))


# ═══════════════════════════════════════════════════════════════════════════════
# TICK STATE MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

def update_tick_state(state: TickState, now: int, ke: float, vix: float) -> TickState:
    """Update tick state with gap detection and warmup tracking"""
    gap = now - state.last_update if state.last_update > 0 else 0
    
    # Detect gap
    if gap > CONFIG.MAX_DATA_GAP_MS:
        return TickState(
            last_update=now,
            prev_ke=ke,
            prev_vix=vix,
            quality=DataQuality.GAP,
            warmup_remaining=CONFIG.GAP_WARMUP_TICKS,
            ticks_since_gap=0
        )
    
    # In warmup period after gap
    if state.warmup_remaining > 0:
        return TickState(
            last_update=now,
            prev_ke=ke,
            prev_vix=vix,
            quality=DataQuality.WARMING,
            warmup_remaining=state.warmup_remaining - 1,
            ticks_since_gap=state.ticks_since_gap + 1
        )
    
    # Stale but not gap
    if gap > CONFIG.MAX_DATA_GAP_MS / 2:
        return TickState(
            last_update=now,
            prev_ke=ke,
            prev_vix=vix,
            quality=DataQuality.STALE,
            warmup_remaining=0,
            ticks_since_gap=state.ticks_since_gap + 1
        )
    
    return TickState(
        last_update=now,
        prev_ke=ke,
        prev_vix=vix,
        quality=DataQuality.GOOD,
        warmup_remaining=0,
        ticks_since_gap=state.ticks_since_gap + 1
    )


# ═══════════════════════════════════════════════════════════════════════════════
# NODE ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_node(node: GammaNode, spot: float, now: int, expiry: int) -> NodeAnalysis:
    """Analyze health and mass of a gamma node"""
    mins_to_exp = max(1, (expiry - now) / 60000)
    dist = abs(node.strike - spot)
    
    # Time decay
    decay = mins_to_exp / 120 if mins_to_exp < 120 else 1.0
    
    # Touch decay
    touch_power = CONFIG.TOUCH_DECAY ** node.touch_count
    
    # Theta acceleration near expiry
    theta_mult = 1.0
    is_vacuum = False
    
    if mins_to_exp < CONFIG.EXPLOSION_MINUTES and dist < 15:
        theta_mult = 1 + CONFIG.THETA_ACCEL * (1 - mins_to_exp / CONFIG.EXPLOSION_MINUTES)
        if dist > CONFIG.VACUUM_ENTER_DIST:
            is_vacuum = True
    
    # Calculate remaining mass
    remaining = touch_power * decay * (0.5 if is_vacuum else theta_mult)
    mass = node.abs_gamma * remaining
    if is_vacuum:
        mass *= CONFIG.VACUUM_REPULSION
    
    # Determine health
    if is_vacuum:
        health = NodeHealth.VACUUM
    elif mins_to_exp < CONFIG.EXPLOSION_MINUTES and dist < 15:
        health = NodeHealth.EXPLODING
    elif node.touch_count == 0:
        health = NodeHealth.FRESH
    elif remaining > 0.6:
        health = NodeHealth.HEALTHY
    elif remaining > 0.3:
        health = NodeHealth.WEAK
    else:
        health = NodeHealth.DYING
    
    return NodeAnalysis(
        strike=node.strike,
        health=health,
        mass=mass,
        is_vacuum=is_vacuum,
        decay_factor=remaining,
        theta_mult=theta_mult
    )


# ═══════════════════════════════════════════════════════════════════════════════
# FORCE COMPUTATION
# ═══════════════════════════════════════════════════════════════════════════════

def compute_force(
    spot: float, 
    nodes: List[GammaNode], 
    node_health: Dict[float, NodeAnalysis],
    sigma: float, 
    vix: float
) -> ForceVector:
    """Compute directional force from gamma structure"""
    up_force = 0.0
    down_force = 0.0
    weighted_sum = 0.0
    weight_total = 0.0
    
    viscosity = np.log(max(10, vix)) / np.log(CONFIG.VIX_BASELINE)
    
    for node in nodes:
        health = node_health.get(node.strike)
        
        # Base force from Gaussian
        force = (node.abs_gamma / CONFIG.GEX_SIGNIFICANCE) * \
                gaussian_pdf(spot, node.strike, sigma) * \
                sigma * np.sqrt(2 * np.pi) / viscosity
        
        # Apply vacuum repulsion
        if health and health.is_vacuum:
            force *= CONFIG.VACUUM_REPULSION
        
        # Accumulate directional forces
        if node.strike > spot:
            up_force += force
        else:
            down_force += force
        
        # For equilibrium calculation
        weighted_sum += node.strike * abs(force)
        weight_total += abs(force)
    
    total = abs(up_force) + abs(down_force)
    diff = up_force - down_force
    
    # Determine direction
    if diff > total * 0.1:
        direction = Direction.UP
    elif diff < -total * 0.1:
        direction = Direction.DOWN
    else:
        direction = Direction.BALANCED
    
    imbalance = abs(diff) / total if total > 0 else 0
    confidence = min(99.0, imbalance * 100)
    equilibrium = weighted_sum / weight_total if weight_total > 0 else spot
    
    return ForceVector(
        direction=direction,
        imbalance=imbalance,
        confidence=confidence,
        equilibrium=equilibrium,
        up_force=up_force,
        down_force=down_force
    )


# ═══════════════════════════════════════════════════════════════════════════════
# MOMENTUM COMPUTATION
# ═══════════════════════════════════════════════════════════════════════════════

def compute_momentum(bars: List[Bar]) -> Momentum:
    """Compute price momentum from bars"""
    if len(bars) < 6:
        return Momentum(
            velocity=0, vw_velocity=0, acceleration=0, 
            kinetic_energy=0, direction=Direction.FLAT
        )
    
    recent = bars[-4:]
    velocity = (recent[-1].close - recent[0].close) / 3
    
    # Volume-weighted velocity
    weighted_change = 0
    total_volume = 0
    for i in range(1, len(recent)):
        weighted_change += (recent[i].close - recent[i-1].close) * recent[i].volume
        total_volume += recent[i].volume
    vw_velocity = weighted_change / total_volume if total_volume > 0 else 0
    
    # Acceleration
    older = bars[-7:-3] if len(bars) >= 7 else bars[:4]
    old_velocity = (older[-1].close - older[0].close) / max(1, len(older) - 1) if len(older) >= 2 else 0
    acceleration = velocity - old_velocity
    
    # Kinetic energy
    avg_volume = sum(b.volume for b in bars[-5:]) / 5
    kinetic_energy = 0.5 * (avg_volume / 10000) * velocity * velocity
    
    # Direction
    if vw_velocity > 0.3:
        direction = Direction.UP
    elif vw_velocity < -0.3:
        direction = Direction.DOWN
    else:
        direction = Direction.FLAT
    
    return Momentum(
        velocity=velocity,
        vw_velocity=vw_velocity,
        acceleration=acceleration,
        kinetic_energy=kinetic_energy,
        direction=direction
    )


# ═══════════════════════════════════════════════════════════════════════════════
# REGIME DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def compute_regime(
    spot: float,
    gex: float,
    flip: float,
    vix: float,
    vix_delta: float,
    price_dir: Direction,
    ke: float,
    prev_ke: float
) -> Regime:
    """Determine market regime from gamma exposure"""
    positive = gex > 0
    magnitude = abs(gex) / CONFIG.GEX_SIGNIFICANCE
    dist = spot - flip
    
    # Kill zone detection
    approaching = (dist < 0 and price_dir == Direction.UP) or \
                  (dist > 0 and price_dir == Direction.DOWN)
    in_phase = abs(dist) < CONFIG.FLIP_ZONE
    kill_zone = approaching and ke > prev_ke + 5 and abs(dist) < 15 and ke > CONFIG.KILL_ZONE_KE
    
    # Character classification
    if kill_zone or in_phase:
        character = MarketCharacter.EXPLOSIVE
    elif positive:
        character = MarketCharacter.SMOOTH if magnitude > 1 else MarketCharacter.CHOPPY
    else:
        character = MarketCharacter.EXPLOSIVE if magnitude > 1 else MarketCharacter.WICKY
    
    # Slippage multiplier
    slippage = 1.0
    if character == MarketCharacter.EXPLOSIVE:
        slippage = CONFIG.SLIPPAGE_EXPLOSIVE
    elif character == MarketCharacter.WICKY:
        slippage = CONFIG.SLIPPAGE_WICKY
    if kill_zone:
        slippage = min(slippage, CONFIG.SLIPPAGE_KILL_ZONE)
    
    # Vol correlation multiplier
    vix_dir = 'UP' if vix_delta > 0.2 else 'DN' if vix_delta < -0.2 else 'FLAT'
    vol_corr_mult = 1.0
    
    if not positive:
        if price_dir == Direction.DOWN and vix_dir == 'UP':
            vol_corr_mult = 1.5 + magnitude * 0.3
        elif price_dir == Direction.UP and vix_dir == 'DN':
            vol_corr_mult = 1.3 + magnitude * 0.2
    else:
        vol_corr_mult = 0.7
    
    return Regime(
        type=RegimeType.POSITIVE if positive else RegimeType.NEGATIVE,
        flip=flip,
        dist_to_flip=dist,
        in_phase=in_phase,
        kill_zone=kill_zone,
        character=character,
        slippage_mult=slippage,
        vol_correlation_mult=vol_corr_mult
    )


# ═══════════════════════════════════════════════════════════════════════════════
# ES CORRELATION (with deadzone fix)
# ═══════════════════════════════════════════════════════════════════════════════

def compute_es_correlation(es: Optional[ESData], spx_dir: Direction) -> ESCorrelation:
    """Compute ES futures correlation with SPX"""
    if es is None:
        return ESCorrelation(
            correlation=1.0,
            divergent=False,
            confidence_mult=1.0,
            es_direction='NONE'
        )
    
    # Fixed: Lower threshold to catch grinding markets
    if es.momentum > CONFIG.ES_MOMENTUM_THRESHOLD:
        es_dir = 'UP'
    elif es.momentum < -CONFIG.ES_MOMENTUM_THRESHOLD:
        es_dir = 'DOWN'
    else:
        es_dir = 'FLAT'
    
    book_bias = 'BUY' if es.order_book_imbalance > 0.2 else \
                'SELL' if es.order_book_imbalance < -0.2 else 'FLAT'
    
    # Calculate correlation
    correlation = 0.5
    spx_dir_str = spx_dir.value
    
    if (spx_dir_str == 'UP' and es_dir == 'UP') or (spx_dir_str == 'DOWN' and es_dir == 'DOWN'):
        correlation = 0.85
    elif (spx_dir_str == 'UP' and es_dir == 'DOWN') or (spx_dir_str == 'DOWN' and es_dir == 'UP'):
        correlation = -0.4
    elif es_dir == 'FLAT':
        correlation = 0.6  # Fixed: Grinding is not divergence
    
    # Order book adjustment
    if (spx_dir_str == 'UP' and book_bias == 'SELL') or \
       (spx_dir_str == 'DOWN' and book_bias == 'BUY'):
        correlation -= 0.25
    
    correlation = max(-1, min(1, correlation))
    divergent = correlation < CONFIG.ES_DIVERGENCE_THRESHOLD
    
    return ESCorrelation(
        correlation=correlation,
        divergent=divergent,
        confidence_mult=CONFIG.ES_CONFIDENCE_CUT if divergent else 1.0,
        es_direction=es_dir
    )


# ═══════════════════════════════════════════════════════════════════════════════
# IV CRUSH ANALYSIS (surgical, not binary)
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_iv_crush(
    trades: List[OptionsTrade], 
    mins_to_exp: float,
    target_strike: Optional[float] = None
) -> IVCrushRisk:
    """Analyze IV crush risk with surgical Vega/Theta weighting"""
    iv_trades = [t for t in trades if t.iv and t.iv > 0]
    
    if len(iv_trades) < 3:
        return IVCrushRisk(
            risk_score=25,
            recommendation='GO',
            vega_theta_ratio=3.0,
            surgical_penalty=0,
            iv_trend='STABLE'
        )
    
    # Calculate actual Vega/Theta if available
    total_vega = 0
    total_theta = 0
    
    strike_trades = iv_trades
    if target_strike:
        strike_trades = [t for t in iv_trades if abs(t.strike - target_strike) < 10]
        if len(strike_trades) < 3:
            strike_trades = iv_trades
    
    for t in strike_trades:
        if t.vega:
            total_vega += abs(t.vega) * t.size
        if t.theta:
            total_theta += abs(t.theta) * t.size
    
    vega_theta_ratio = total_vega / total_theta if total_theta > 0 else 3.0
    
    # IV trend
    mid = len(iv_trades) // 2
    first_avg = sum(t.iv for t in iv_trades[:mid]) / mid if mid > 0 else 0
    second_avg = sum(t.iv for t in iv_trades[mid:]) / (len(iv_trades) - mid) if len(iv_trades) > mid else 0
    
    iv_falling = second_avg < first_avg * 0.95
    iv_rising = second_avg > first_avg * 1.05
    iv_trend = 'FALLING' if iv_falling else 'RISING' if iv_rising else 'STABLE'
    
    # Calculate risk score
    risk = 25
    if iv_falling:
        risk += 25
    if second_avg > 30:
        risk += 15
    if mins_to_exp < 60:
        risk += 20
    if vega_theta_ratio < CONFIG.VEGA_THETA_SAFE:
        risk += 20
    risk = min(100, risk)
    
    # SURGICAL PENALTY: Based on actual Vega/Theta, not binary
    if vega_theta_ratio >= CONFIG.VEGA_THETA_SAFE:
        surgical_penalty = 0
    else:
        surgical_penalty = min(0.5, (CONFIG.VEGA_THETA_SAFE - vega_theta_ratio) / CONFIG.VEGA_THETA_SAFE * 0.5)
    
    # Recommendation
    if risk > CONFIG.IV_CRUSH_HIGH:
        recommendation = 'AVOID'
    elif risk > 50:
        recommendation = 'CAUTION'
    else:
        recommendation = 'GO'
    
    return IVCrushRisk(
        risk_score=risk,
        recommendation=recommendation,
        vega_theta_ratio=vega_theta_ratio,
        surgical_penalty=surgical_penalty,
        iv_trend=iv_trend
    )


# ═══════════════════════════════════════════════════════════════════════════════
# POSITION SIZING
# ═══════════════════════════════════════════════════════════════════════════════

def calc_position(
    confidence: float,
    risk_reward: float,
    regime: Regime,
    es: ESCorrelation,
    iv: IVCrushRisk,
    tick_quality: DataQuality,
    account_size: float,
    stop_distance: float
) -> Position:
    """Calculate position size with Kelly criterion and penalties"""
    penalties = []
    win_prob = confidence / 100
    
    # ES divergence penalty
    win_prob *= es.confidence_mult
    if es.divergent:
        penalties.append(f"ES:-{int((1 - es.confidence_mult) * 100)}%")
    
    # Surgical IV penalty (not binary)
    if iv.surgical_penalty > 0:
        win_prob *= (1 - iv.surgical_penalty)
        penalties.append(f"IV:-{int(iv.surgical_penalty * 100)}% (V/T:{iv.vega_theta_ratio:.1f})")
    
    # Regime penalties
    if regime.type == RegimeType.NEGATIVE:
        win_prob *= 0.85
        penalties.append('NEG_GAMMA:-15%')
    if regime.in_phase:
        win_prob *= 0.7
        penalties.append('PHASE:-30%')
    if regime.kill_zone:
        win_prob *= 0.6
        penalties.append('KILL:-40%')
    
    # Data quality penalties
    if tick_quality == DataQuality.WARMING:
        win_prob *= 0.4
        penalties.append('WARMING:-60%')
    elif tick_quality == DataQuality.GAP:
        win_prob *= 0.2
        penalties.append('GAP:-80%')
    elif tick_quality == DataQuality.STALE:
        win_prob *= CONFIG.STALE_DATA_PENALTY
        penalties.append('STALE:-50%')
    
    # Kelly criterion
    q = 1 - win_prob
    kelly = ((risk_reward * win_prob) - q) / risk_reward if risk_reward > 0 else 0
    kelly *= CONFIG.KELLY_FRACTION * regime.slippage_mult
    kelly = max(CONFIG.MIN_KELLY, min(CONFIG.MAX_KELLY, kelly))
    
    max_risk = account_size * min(CONFIG.MAX_RISK_PCT, kelly)
    contracts = max(1, int(max_risk / (stop_distance * 50))) if stop_distance > 0 else 1
    
    return Position(
        kelly=kelly,
        contracts=contracts,
        max_risk=max_risk,
        penalties=penalties,
        adjusted_win_prob=win_prob
    )


# ═══════════════════════════════════════════════════════════════════════════════
# SCENARIO DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def detect_scenarios(
    spot: float,
    momentum: Momentum,
    regime: Regime,
    node_health: List[NodeAnalysis],
    force: ForceVector,
    es: ESCorrelation,
    iv: IVCrushRisk,
    tick: TickState,
    account_size: float,
    trades: List[OptionsTrade]
) -> List[Scenario]:
    """Detect trading scenarios from market state"""
    scenarios = []
    
    # Block scenarios during warmup (Gemini Fix #1)
    if tick.quality in (DataQuality.GAP, DataQuality.WARMING):
        return []
    
    # ─────────────────────────────────────────────────────────────────────────
    # DIP BUY SCENARIO
    # ─────────────────────────────────────────────────────────────────────────
    supports = [n for n in node_health 
                if n.strike < spot and n.strike > spot - 30 
                and n.mass > 0 and not n.is_vacuum]
    supports.sort(key=lambda x: x.mass, reverse=True)
    
    if supports:
        sup = supports[0]
        dist = spot - sup.strike
        
        if dist <= 20 or momentum.direction == Direction.DOWN:
            conf = 0
            
            # Distance scoring
            if dist < 5:
                conf += 30
            elif dist < 10:
                conf += 20
            elif dist < 15:
                conf += 10
            
            # Health scoring
            if sup.health == NodeHealth.FRESH:
                conf += 25
            elif sup.health == NodeHealth.EXPLODING:
                conf += 30
            
            # Momentum scoring
            if momentum.vw_velocity < -1:
                conf += 15
            if force.direction == Direction.UP:
                conf += 10
            
            # Regime penalties
            if regime.in_phase:
                conf -= 15
            if regime.kill_zone:
                conf -= 25
            if regime.vol_correlation_mult > 1.3 and momentum.direction == Direction.DOWN:
                conf -= 15
            
            # ES penalty
            conf *= es.confidence_mult
            
            if conf >= 50:
                wick = 8 if regime.type == RegimeType.NEGATIVE else 3
                stop = sup.strike - wick - 5
                target = force.equilibrium
                rr = abs(target - sup.strike) / abs(sup.strike - stop) if abs(sup.strike - stop) > 0 else 1
                
                # Strike-specific IV analysis
                iv_strike = analyze_iv_crush(trades, 60, sup.strike)
                
                # Urgency
                if dist < 5:
                    urgency = Urgency.NOW
                elif dist < 10:
                    urgency = Urgency.READY
                else:
                    urgency = Urgency.PREP
                
                if iv_strike.recommendation == 'AVOID':
                    urgency = Urgency.WAIT
                elif iv_strike.recommendation == 'CAUTION' and urgency == Urgency.NOW:
                    urgency = Urgency.READY
                
                # Check for nearby vacuum
                vacuum = next((n for n in node_health if n.is_vacuum and abs(n.strike - spot) < 10), None)
                if vacuum and urgency != Urgency.WAIT:
                    urgency = Urgency.READY
                
                position = calc_position(conf, rr, regime, es, iv_strike, tick.quality, account_size, abs(sup.strike - stop))
                
                warnings = list(position.penalties)
                if vacuum:
                    warnings.append('⚡VACUUM_NEAR')
                if tick.quality != DataQuality.GOOD:
                    warnings.append(f'⚠️{tick.quality.value}')
                
                scenarios.append(Scenario(
                    type='DIP_BUY',
                    confidence=round(conf),
                    direction='LONG',
                    entry_low=sup.strike - wick,
                    entry_high=sup.strike + 3,
                    stop=stop,
                    target=target,
                    urgency=urgency,
                    position=position,
                    warnings=warnings,
                    trigger_strike=sup.strike
                ))
    
    # ─────────────────────────────────────────────────────────────────────────
    # GAMMA FLIP SCENARIO
    # ─────────────────────────────────────────────────────────────────────────
    if regime.in_phase:
        cross_up = regime.dist_to_flip < 0 and momentum.direction == Direction.UP
        cross_down = regime.dist_to_flip > 0 and momentum.direction == Direction.DOWN
        
        if cross_up or cross_down:
            conf = 50
            
            if abs(regime.dist_to_flip) < 3:
                conf += 20
            if abs(momentum.vw_velocity) > 0.5:
                conf += 15
            if momentum.kinetic_energy > 50:
                conf += 10
            if regime.kill_zone:
                conf -= 20
            
            conf *= es.confidence_mult
            
            if conf >= 55:
                direction = 'LONG' if cross_up else 'SHORT'
                stop = regime.flip - 10 if direction == 'LONG' else regime.flip + 10
                target = regime.flip + 15 if direction == 'LONG' else regime.flip - 15
                
                urgency = Urgency.NOW
                if iv.recommendation == 'AVOID':
                    urgency = Urgency.WAIT
                
                position = calc_position(conf, 1.5, regime, es, iv, tick.quality, account_size, 10)
                
                warnings = ['⚠️PHASE'] + list(position.penalties)
                if regime.kill_zone:
                    warnings.append('🔴KILL')
                
                entry_low = regime.flip - 2 if direction == 'LONG' else regime.flip - 5
                entry_high = regime.flip + 5 if direction == 'LONG' else regime.flip + 2
                
                scenarios.append(Scenario(
                    type='GAMMA_FLIP',
                    confidence=round(conf),
                    direction=direction,
                    entry_low=entry_low,
                    entry_high=entry_high,
                    stop=stop,
                    target=target,
                    urgency=urgency,
                    position=position,
                    warnings=warnings,
                    trigger_strike=regime.flip
                ))
    
    # ─────────────────────────────────────────────────────────────────────────
    # RESISTANCE FADE SCENARIO
    # ─────────────────────────────────────────────────────────────────────────
    resistances = [n for n in node_health 
                   if n.strike > spot and n.strike < spot + 30 
                   and n.mass > 0 and not n.is_vacuum]
    resistances.sort(key=lambda x: x.mass, reverse=True)
    
    if resistances and momentum.direction == Direction.UP:
        res = resistances[0]
        dist = res.strike - spot
        
        if dist <= 15:
            conf = 0
            
            # Distance scoring
            if dist < 3:
                conf += 30
            elif dist < 7:
                conf += 20
            elif dist < 12:
                conf += 10
            
            # Health scoring
            if res.health == NodeHealth.FRESH:
                conf += 25
            elif res.health == NodeHealth.EXPLODING:
                conf += 20
            
            # Momentum exhaustion
            if momentum.acceleration < 0:
                conf += 15
            if force.direction == Direction.DOWN:
                conf += 10
            
            # Regime
            if regime.type == RegimeType.POSITIVE:
                conf -= 20  # Don't fade in positive gamma
            
            conf *= es.confidence_mult
            
            if conf >= 55:
                wick = 5 if regime.type == RegimeType.NEGATIVE else 2
                stop = res.strike + wick + 3
                target = force.equilibrium
                rr = abs(res.strike - target) / abs(stop - res.strike) if abs(stop - res.strike) > 0 else 1
                
                urgency = Urgency.NOW if dist < 3 else Urgency.READY if dist < 7 else Urgency.PREP
                
                position = calc_position(conf, rr, regime, es, iv, tick.quality, account_size, abs(stop - res.strike))
                
                warnings = list(position.penalties)
                if regime.type == RegimeType.POSITIVE:
                    warnings.append('⚠️POS_GAMMA_FADE')
                
                scenarios.append(Scenario(
                    type='RESISTANCE_FADE',
                    confidence=round(conf),
                    direction='SHORT',
                    entry_low=res.strike - 2,
                    entry_high=res.strike + wick,
                    stop=stop,
                    target=target,
                    urgency=urgency,
                    position=position,
                    warnings=warnings,
                    trigger_strike=res.strike
                ))
    
    # Sort by confidence
    scenarios.sort(key=lambda x: x.confidence, reverse=True)
    return scenarios


# ═══════════════════════════════════════════════════════════════════════════════
# WARNING GENERATION
# ═══════════════════════════════════════════════════════════════════════════════

def generate_warnings(
    regime: Regime,
    node_health: List[NodeAnalysis],
    es: ESCorrelation,
    iv: IVCrushRisk,
    tick: TickState
) -> List[Warning]:
    """Generate system warnings"""
    warnings = []
    
    # Data quality
    if tick.quality == DataQuality.GAP:
        warnings.append(Warning('DATA_GAP', 'CRIT', 'Scenarios blocked'))
    elif tick.quality == DataQuality.WARMING:
        warnings.append(Warning('WARMING', 'WARN', f'{tick.warmup_remaining} ticks remaining'))
    elif tick.quality == DataQuality.STALE:
        warnings.append(Warning('STALE', 'WARN', 'Data delayed'))
    
    # Regime
    if regime.kill_zone:
        warnings.append(Warning('KILL_ZONE', 'CRIT', f'Slip:{int((1-regime.slippage_mult)*100)}%'))
    if regime.in_phase:
        warnings.append(Warning('GAMMA_FLIP', 'CRIT', f'{abs(regime.dist_to_flip):.1f}pts'))
    
    # Vacuum zones
    vacuums = [n for n in node_health if n.is_vacuum]
    if vacuums:
        strikes = ','.join(str(int(v.strike)) for v in vacuums)
        warnings.append(Warning('VACUUM', 'WARN', strikes))
    
    # ES divergence
    if es.divergent:
        warnings.append(Warning('ES_DIV', 'WARN', f'Corr:{es.correlation:.2f}'))
    
    # IV crush
    if iv.risk_score > 50:
        severity = 'CRIT' if iv.risk_score > 70 else 'WARN'
        warnings.append(Warning('IV_CRUSH', severity, f'{iv.risk_score}% V/T:{iv.vega_theta_ratio:.1f}'))
    
    return warnings


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ENGINE CLASS
# ═══════════════════════════════════════════════════════════════════════════════

class TitanEngine:
    """
    TITAN OMEGA Core Physics Engine v18.0
    
    Handles all core analysis:
    - Gamma force field computation
    - Regime detection
    - Scenario generation
    - Position sizing
    """
    
    def __init__(self, account_size: float = 50000):
        self.bars: List[Bar] = []
        self.trades: List[OptionsTrade] = []
        self.tick_state = TickState()
        self.es_data: Optional[ESData] = None
        self.account_size = account_size
        self.vacuum_strikes: set = set()
    
    def set_account(self, size: float):
        self.account_size = size
    
    def set_es(self, data: ESData):
        self.es_data = data
    
    def add_bar(self, bar: Bar):
        self.bars.append(bar)
        if len(self.bars) > 100:
            self.bars.pop(0)
    
    def add_trades(self, trades: List[OptionsTrade]):
        now = int(time.time() * 1000)
        self.trades.extend(trades)
        # Keep only recent trades
        self.trades = [t for t in self.trades if t.timestamp > now - 120000][-500:]
    
    def reset(self):
        self.bars = []
        self.trades = []
        self.tick_state = TickState()
        self.es_data = None
        self.vacuum_strikes = set()
    
    def analyze(
        self,
        spot: float,
        nodes: List[GammaNode],
        net_gex: float,
        flip: float,
        vix: float,
        expiry: Optional[int] = None
    ) -> EngineOutput:
        """
        Main analysis entry point
        
        Args:
            spot: Current price
            nodes: List of gamma nodes
            net_gex: Net gamma exposure
            flip: Gamma flip level
            vix: VIX value
            expiry: Expiry timestamp (ms), defaults to today 4PM ET
        
        Returns:
            EngineOutput with complete analysis
        """
        now = int(time.time() * 1000)
        
        # Default expiry to today 4PM
        if expiry is None:
            from datetime import datetime
            d = datetime.now()
            d = d.replace(hour=16, minute=0, second=0, microsecond=0)
            if d.timestamp() * 1000 <= now:
                d = d.replace(day=d.day + 1)
            expiry = int(d.timestamp() * 1000)
        
        mins_to_exp = max(1, (expiry - now) / 60000)
        
        # Calculate base metrics
        rv = calc_realized_vol(self.bars)
        sigma = calc_sigma(mins_to_exp, vix, rv)
        momentum = compute_momentum(self.bars)
        
        # Update tick state
        vix_delta = vix - self.tick_state.prev_vix
        self.tick_state = update_tick_state(self.tick_state, now, momentum.kinetic_energy, vix)
        
        # Analyze nodes
        node_analysis = [analyze_node(n, spot, now, expiry) for n in nodes]
        node_health_map = {n.strike: n for n in node_analysis}
        
        # Compute force
        force = compute_force(spot, nodes, node_health_map, sigma, vix)
        
        # Compute regime
        regime = compute_regime(
            spot, net_gex, flip, vix, vix_delta,
            momentum.direction, momentum.kinetic_energy, self.tick_state.prev_ke
        )
        
        # ES correlation
        es_corr = compute_es_correlation(self.es_data, force.direction)
        
        # IV crush analysis
        iv_crush = analyze_iv_crush(self.trades, mins_to_exp)
        
        # Detect scenarios
        scenarios = detect_scenarios(
            spot, momentum, regime, node_analysis, force,
            es_corr, iv_crush, self.tick_state, self.account_size, self.trades
        )
        
        # Generate warnings
        warnings = generate_warnings(regime, node_analysis, es_corr, iv_crush, self.tick_state)
        
        # Determine signal
        best_scenario = scenarios[0] if scenarios else None
        
        if self.tick_state.quality in (DataQuality.GAP, DataQuality.WARMING):
            signal = Signal.NO_TRADE
        elif best_scenario:
            if best_scenario.confidence >= 70:
                if best_scenario.direction == 'LONG':
                    signal = Signal.CONVICTION_LONG
                else:
                    signal = Signal.CONVICTION_SHORT
            else:
                signal = Signal.NEUTRAL
        else:
            signal = Signal.NEUTRAL
        
        # Check for flow divergence
        if es_corr.divergent and best_scenario:
            signal = Signal.FLOW_DIVERGENCE
        
        return EngineOutput(
            timestamp=now,
            spot=spot,
            sigma=sigma,
            realized_vol=rv,
            regime=regime,
            momentum=momentum,
            force=force,
            es_correlation=es_corr,
            iv_crush=iv_crush,
            node_analysis=node_analysis,
            scenarios=scenarios,
            best_scenario=best_scenario,
            warnings=warnings,
            data_quality=self.tick_state.quality,
            signal=signal
        )


# ═══════════════════════════════════════════════════════════════════════════════
# EXPORTS
# ═══════════════════════════════════════════════════════════════════════════════

__all__ = [
    'TitanConfig', 'CONFIG',
    'DataQuality', 'Direction', 'RegimeType', 'MarketCharacter', 
    'NodeHealth', 'Signal', 'Urgency',
    'GammaNode', 'Bar', 'OptionsTrade', 'ESData',
    'NodeAnalysis', 'ForceVector', 'Momentum', 'Regime',
    'ESCorrelation', 'IVCrushRisk', 'Position', 'Scenario', 
    'Warning', 'EngineOutput',
    'TitanEngine'
]
