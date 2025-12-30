"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                    TITAN ULTIMATE v19.0                                      ║
║                    ═══════════════════════                                   ║
║                                                                              ║
║  The culmination of all TITAN versions, combining the best logic from:       ║
║  • V5: Gaussian force + Vanna + Flow kinetics + Vacuum hysteresis           ║
║  • v2.5 FINAL: Gap warmup + Surgical IV + ES deadzone + Node health         ║
║  • Omega v17.5: Market mood + Trade archiving + Alert system                ║
║  • Realtime: Dealer mechanics + WHY explanation + Entry finder              ║
║                                                                              ║
║  PURPOSE: Catch big SPX moves BEFORE they happen by understanding:          ║
║  1. WHERE dealers are positioned (GEX)                                      ║
║  2. HOW they must hedge (mechanics)                                         ║
║  3. WHAT flow is telling us (smart money)                                   ║
║  4. WHEN to enter (confluence)                                              ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import numpy as np
import json
import time
import os
from datetime import datetime, date, timedelta
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Set
from collections import deque
from enum import Enum
import threading
import logging

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION — Battle-tested parameters from all versions
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class Config:
    """Ultimate configuration combining best parameters"""
    # === API ===
    POLYGON_API_KEY: str = field(default_factory=lambda: os.getenv('POLYGON_API_KEY', ''))
    
    # === Physics Engine (from v2.5 FINAL) ===
    SIGMA_BASE: float = 10.0
    SIGMA_MIN: float = 2.0
    SIGMA_MAX: float = 30.0
    VIX_BASELINE: float = 15.0
    VIX_EXPONENT: float = 1.5
    
    # === GEX Thresholds ===
    GEX_SIGNIFICANCE: float = 1e9
    STRIKE_RANGE_PCT: float = 0.03
    
    # === Vacuum Zones (from V5 - hysteresis) ===
    VACUUM_ENTER_DIST: float = 6.0
    VACUUM_EXIT_DIST: float = 3.5
    VACUUM_REPULSION: float = -1.2
    
    # === Node Health (from v2.5) ===
    TOUCH_DECAY: float = 0.66
    EXPLOSION_MINUTES: float = 30.0
    THETA_ACCEL: float = 2.5
    
    # === Data Quality (from v2.5 - Gemini Fix #1) ===
    MAX_DATA_GAP_MS: int = 5000
    GAP_WARMUP_TICKS: int = 3
    STALE_PENALTY: float = 0.5
    
    # === Kill Zone (from v2.5) ===
    FLIP_ZONE: float = 5.0
    KILL_ZONE_KE: float = 30.0
    
    # === ES Correlation (from v2.5 - Gemini Fix #3) ===
    ES_MOMENTUM_THRESHOLD: float = 0.15  # Fixed from 0.3
    ES_DIVERGENCE_THRESHOLD: float = 0.4
    ES_CONFIDENCE_CUT: float = 0.6
    
    # === IV Crush (from v2.5 - Gemini Fix #2) ===
    VEGA_THETA_SAFE: float = 2.0
    IV_CRUSH_HIGH: float = 70.0
    
    # === Position Sizing (Kelly) ===
    KELLY_FRACTION: float = 0.25
    MIN_KELLY: float = 0.02
    MAX_KELLY: float = 0.10
    MAX_RISK_PCT: float = 0.015
    
    # === Slippage by Regime ===
    SLIPPAGE_SMOOTH: float = 1.0
    SLIPPAGE_CHOPPY: float = 0.9
    SLIPPAGE_WICKY: float = 0.75
    SLIPPAGE_EXPLOSIVE: float = 0.6
    SLIPPAGE_KILL_ZONE: float = 0.5
    
    # === Flow Detection ===
    SWEEP_WINDOW_MS: int = 3000
    SWEEP_MIN_SIZE: int = 50
    SWEEP_MIN_EXCHANGES: int = 2
    BLOCK_SIZE: int = 200
    
    # === Signal Thresholds (from V5) ===
    CONVICTION_THRESHOLD: float = 70.0
    FLOW_DIVERGENCE_THRESHOLD: float = 1.0
    
    # === Alert Cooldowns (from Omega v17.5) ===
    ALERT_COOLDOWN_S: int = 120


CFG = Config()


# ═══════════════════════════════════════════════════════════════════════════════
# ENUMS — Clear state definitions
# ═══════════════════════════════════════════════════════════════════════════════

class DataQuality(Enum):
    GOOD = "GOOD"
    STALE = "STALE"
    GAP = "GAP"
    WARMING = "WARMING"

class DealerPosition(Enum):
    LONG_GAMMA = "LONG_GAMMA"    # Dealers sell rallies, buy dips → MEAN REVERT
    SHORT_GAMMA = "SHORT_GAMMA"  # Dealers buy rallies, sell dips → TREND ACCEL
    NEUTRAL = "NEUTRAL"

class MarketMood(Enum):
    """From Omega v17.5"""
    TREND = "TREND"
    VOL_EXPANSION = "VOL_EXPANSION"
    MEAN_REVERT = "MEAN_REVERT"
    CHOP = "CHOP"
    UNKNOWN = "UNKNOWN"

class RegimeChar(Enum):
    """From v2.5"""
    SMOOTH = "SMOOTH"
    CHOPPY = "CHOPPY"
    WICKY = "WICKY"
    EXPLOSIVE = "EXPLOSIVE"

class NodeHealth(Enum):
    """From v2.5"""
    FRESH = "FRESH"
    HEALTHY = "HEALTHY"
    WEAK = "WEAK"
    DYING = "DYING"
    EXPLODING = "EXPLODING"
    VACUUM = "VACUUM"

class Signal(Enum):
    CONVICTION_LONG = "🚀 CONVICTION LONG"
    CONVICTION_SHORT = "📉 CONVICTION SHORT"
    FLOW_DIVERGENCE = "⚠️ FLOW DIVERGENCE"
    NEUTRAL = "➖ NEUTRAL"
    NO_TRADE = "🚫 NO TRADE"

class Urgency(Enum):
    NOW = "NOW"
    READY = "READY"
    PREP = "PREP"
    WAIT = "WAIT"


# ═══════════════════════════════════════════════════════════════════════════════
# DATA STRUCTURES — Clean, typed, comprehensive
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class GammaNode:
    """Single strike's gamma exposure"""
    strike: float
    gamma: float
    abs_gamma: float
    oi: int = 0
    volume: int = 0
    touch_count: int = 0
    
    # Computed
    health: NodeHealth = NodeHealth.FRESH
    mass: float = 0.0
    is_vacuum: bool = False


@dataclass
class Bar:
    """OHLCV bar"""
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class OptionFlow:
    """Single options trade"""
    timestamp: int
    strike: float
    option_type: str  # 'call' or 'put'
    side: str  # 'BUY', 'SELL', 'MID'
    size: int
    premium: float
    exchange: str = ""
    iv: Optional[float] = None
    vega: Optional[float] = None
    theta: Optional[float] = None


@dataclass
class Sweep:
    """Detected sweep order"""
    timestamp: int
    strike: float
    option_type: str
    total_size: int
    total_premium: float
    exchanges: Set[str]
    side: str
    bias: str  # 'BULLISH' or 'BEARISH'
    urgency: str  # 'HIGH' or 'EXTREME'


@dataclass
class DealerState:
    """Complete dealer positioning"""
    position: DealerPosition
    total_gex: float
    gamma_flip: float
    dist_to_flip: float
    
    # Key levels
    support_levels: List[Tuple[float, float]]  # (strike, gex)
    resistance_levels: List[Tuple[float, float]]
    
    # Dynamics
    hedge_pressure: float  # -1 to +1
    acceleration_zone: bool


@dataclass
class Momentum:
    """Price momentum from V5"""
    velocity: float
    vw_velocity: float
    acceleration: float
    kinetic_energy: float
    direction: str  # 'UP', 'DOWN', 'FLAT'


@dataclass
class Regime:
    """Market regime from v2.5"""
    gex_type: str  # 'POS' or 'NEG'
    character: RegimeChar
    in_phase: bool  # Near flip
    kill_zone: bool  # Momentum into flip
    slippage_mult: float
    vol_corr_mult: float


@dataclass
class FlowAnalysis:
    """Flow analysis from V5 + realtime"""
    flow_score: float  # -2 to +2
    net_call_premium: float
    net_put_premium: float
    recent_sweeps: List[Sweep]
    smart_money_bias: str  # 'BULLISH', 'BEARISH', 'NEUTRAL'


@dataclass
class IVAnalysis:
    """IV crush analysis from v2.5 Gemini Fix #2"""
    risk_score: float
    recommendation: str  # 'GO', 'CAUTION', 'AVOID'
    vega_theta_ratio: float
    surgical_penalty: float


@dataclass
class Entry:
    """Trade entry"""
    direction: str  # 'LONG' or 'SHORT'
    entry_price: float
    stop: float
    target_1: float
    target_2: float
    
    # Context
    trigger: str
    why_mechanics: str
    why_flow: str
    
    # Risk
    risk_points: float
    reward_points: float
    risk_reward: float
    
    # Sizing
    kelly: float
    contracts: int
    max_risk_dollars: float
    
    # Meta
    confidence: float
    urgency: Urgency
    warnings: List[str]


@dataclass 
class MarketState:
    """Complete market state — THE MAIN OUTPUT"""
    timestamp: datetime
    spot: float
    vix: float
    
    # Data quality
    data_quality: DataQuality
    
    # Dealer positioning (THE KEY)
    dealer: DealerState
    
    # Regime
    regime: Regime
    mood: MarketMood
    
    # Momentum
    momentum: Momentum
    
    # Flow
    flow: FlowAnalysis
    
    # IV
    iv: IVAnalysis
    
    # Force (from physics engine)
    force_direction: str
    force_confidence: float
    equilibrium: float
    
    # Vanna force (from V5)
    vanna_force: float
    
    # THE SIGNAL
    signal: Signal
    
    # Entry opportunity
    entry: Optional[Entry]
    
    # Explanation (THE VALUE)
    why_moving: str
    what_expect: str
    key_levels: Dict[str, float]
    
    # Warnings
    warnings: List[str]


# ═══════════════════════════════════════════════════════════════════════════════
# CORE PHYSICS — Gaussian force field from all versions
# ═══════════════════════════════════════════════════════════════════════════════

def gaussian_pdf(x: float, mu: float, sigma: float) -> float:
    """Standard Gaussian PDF"""
    return (1.0 / (sigma * np.sqrt(2 * np.pi))) * np.exp(-((x - mu) ** 2) / (2 * sigma ** 2))


def calc_sigma(mins_to_exp: float, vix: float, rv: float) -> float:
    """Dynamic sigma from v2.5"""
    time_factor = np.sqrt(min(1.0, mins_to_exp / 390))
    vol_factor = (vix / CFG.VIX_BASELINE) ** CFG.VIX_EXPONENT
    rv_factor = max(0.5, min(2.0, rv / 10))
    sigma = CFG.SIGMA_BASE * time_factor * vol_factor * rv_factor
    return max(CFG.SIGMA_MIN, min(CFG.SIGMA_MAX, sigma))


def calc_realized_vol(bars: List[Bar]) -> float:
    """Calculate RV from bars"""
    if len(bars) < 6:
        return 10.0
    recent = bars[-6:]
    returns = []
    for i in range(1, len(recent)):
        ret = np.log(recent[i].close / recent[i-1].close)
        returns.append(ret * ret)
    return max(5.0, min(50.0, np.sqrt(sum(returns) / len(returns)) * 1000))


# ═══════════════════════════════════════════════════════════════════════════════
# NODE HEALTH SYSTEM — From v2.5
# ═══════════════════════════════════════════════════════════════════════════════

def compute_node_health(
    node: GammaNode, 
    spot: float, 
    mins_to_exp: float,
    vacuum_strikes: Set[float]
) -> GammaNode:
    """Compute node health and mass from v2.5"""
    dist = abs(node.strike - spot)
    
    # Time decay
    decay = mins_to_exp / 120 if mins_to_exp < 120 else 1.0
    
    # Touch decay
    touch_power = CFG.TOUCH_DECAY ** node.touch_count
    
    # Theta acceleration near expiry
    theta_mult = 1.0
    is_vacuum = False
    
    if mins_to_exp < CFG.EXPLOSION_MINUTES and dist < 15:
        theta_mult = 1 + CFG.THETA_ACCEL * (1 - mins_to_exp / CFG.EXPLOSION_MINUTES)
        
        # Vacuum detection with hysteresis (from V5)
        if node.strike not in vacuum_strikes and dist > CFG.VACUUM_ENTER_DIST:
            is_vacuum = True
            vacuum_strikes.add(node.strike)
        elif node.strike in vacuum_strikes and dist < CFG.VACUUM_EXIT_DIST:
            vacuum_strikes.discard(node.strike)
        elif node.strike in vacuum_strikes:
            is_vacuum = True
    
    # Calculate remaining mass
    remaining = touch_power * decay * (0.5 if is_vacuum else theta_mult)
    mass = node.abs_gamma * remaining
    if is_vacuum:
        mass *= CFG.VACUUM_REPULSION
    
    # Determine health
    if is_vacuum:
        health = NodeHealth.VACUUM
    elif mins_to_exp < CFG.EXPLOSION_MINUTES and dist < 15:
        health = NodeHealth.EXPLODING
    elif node.touch_count == 0:
        health = NodeHealth.FRESH
    elif remaining > 0.6:
        health = NodeHealth.HEALTHY
    elif remaining > 0.3:
        health = NodeHealth.WEAK
    else:
        health = NodeHealth.DYING
    
    node.health = health
    node.mass = mass
    node.is_vacuum = is_vacuum
    
    return node


# ═══════════════════════════════════════════════════════════════════════════════
# FORCE COMPUTATION — Gaussian field from V5 + v2.5
# ═══════════════════════════════════════════════════════════════════════════════

def compute_force(
    spot: float,
    nodes: List[GammaNode],
    sigma: float,
    vix: float
) -> Tuple[str, float, float]:
    """
    Compute directional force from gamma structure
    Returns: (direction, confidence, equilibrium)
    """
    if not nodes:
        return 'BALANCED', 0.0, spot
    
    up_force = 0.0
    down_force = 0.0
    weighted_sum = 0.0
    weight_total = 0.0
    
    viscosity = np.log(max(10, vix)) / np.log(CFG.VIX_BASELINE)
    
    for node in nodes:
        # Gaussian-weighted force
        force = (node.abs_gamma / CFG.GEX_SIGNIFICANCE) * \
                gaussian_pdf(spot, node.strike, sigma) * \
                sigma * np.sqrt(2 * np.pi) / viscosity
        
        # Apply vacuum repulsion
        if node.is_vacuum:
            force *= CFG.VACUUM_REPULSION
        
        # Accumulate
        if node.strike > spot:
            up_force += force
        else:
            down_force += force
        
        weighted_sum += node.strike * abs(force)
        weight_total += abs(force)
    
    total = abs(up_force) + abs(down_force)
    diff = up_force - down_force
    
    # Direction
    if diff > total * 0.1:
        direction = 'UP'
    elif diff < -total * 0.1:
        direction = 'DOWN'
    else:
        direction = 'BALANCED'
    
    confidence = min(99.0, (abs(diff) / total) * 100.0) if total > 0 else 0.0
    equilibrium = weighted_sum / weight_total if weight_total > 0 else spot
    
    return direction, confidence, equilibrium


# ═══════════════════════════════════════════════════════════════════════════════
# MOMENTUM — From V5
# ═══════════════════════════════════════════════════════════════════════════════

def compute_momentum(bars: List[Bar]) -> Momentum:
    """Compute momentum metrics from V5"""
    if len(bars) < 6:
        return Momentum(0, 0, 0, 0, 'FLAT')
    
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
        direction = 'UP'
    elif vw_velocity < -0.3:
        direction = 'DOWN'
    else:
        direction = 'FLAT'
    
    return Momentum(velocity, vw_velocity, acceleration, kinetic_energy, direction)


# ═══════════════════════════════════════════════════════════════════════════════
# VANNA FORCE — From V5
# ═══════════════════════════════════════════════════════════════════════════════

def compute_vanna_force(vix: float, prev_vix: float, gex: float) -> float:
    """
    Vanna force from V5
    Vanna = dDelta/dVol - how delta changes with volatility
    When VIX rises, put deltas increase (more negative), dealers must sell
    """
    vix_change = vix - prev_vix
    return -(vix_change) * (gex / CFG.GEX_SIGNIFICANCE) * 2.0


# ═══════════════════════════════════════════════════════════════════════════════
# REGIME DETECTION — From v2.5
# ═══════════════════════════════════════════════════════════════════════════════

def compute_regime(
    spot: float,
    gex: float,
    flip: float,
    vix: float,
    vix_delta: float,
    price_dir: str,
    ke: float,
    prev_ke: float
) -> Regime:
    """Compute market regime from v2.5"""
    positive = gex > 0
    magnitude = abs(gex) / CFG.GEX_SIGNIFICANCE
    dist = spot - flip
    
    # Kill zone detection
    approaching = (dist < 0 and price_dir == 'UP') or (dist > 0 and price_dir == 'DOWN')
    in_phase = abs(dist) < CFG.FLIP_ZONE
    kill_zone = approaching and ke > prev_ke + 5 and abs(dist) < 15 and ke > CFG.KILL_ZONE_KE
    
    # Character classification
    if kill_zone or in_phase:
        char = RegimeChar.EXPLOSIVE
    elif positive:
        char = RegimeChar.SMOOTH if magnitude > 1 else RegimeChar.CHOPPY
    else:
        char = RegimeChar.EXPLOSIVE if magnitude > 1 else RegimeChar.WICKY
    
    # Slippage multiplier
    slippage = {
        RegimeChar.SMOOTH: CFG.SLIPPAGE_SMOOTH,
        RegimeChar.CHOPPY: CFG.SLIPPAGE_CHOPPY,
        RegimeChar.WICKY: CFG.SLIPPAGE_WICKY,
        RegimeChar.EXPLOSIVE: CFG.SLIPPAGE_EXPLOSIVE
    }.get(char, 1.0)
    
    if kill_zone:
        slippage = min(slippage, CFG.SLIPPAGE_KILL_ZONE)
    
    # Vol correlation multiplier
    vix_dir = 'UP' if vix_delta > 0.2 else 'DN' if vix_delta < -0.2 else 'FLAT'
    vol_corr_mult = 1.0
    
    if not positive:
        if price_dir == 'DOWN' and vix_dir == 'UP':
            vol_corr_mult = 1.5 + magnitude * 0.3
        elif price_dir == 'UP' and vix_dir == 'DN':
            vol_corr_mult = 1.3 + magnitude * 0.2
    else:
        vol_corr_mult = 0.7
    
    return Regime(
        gex_type='POS' if positive else 'NEG',
        character=char,
        in_phase=in_phase,
        kill_zone=kill_zone,
        slippage_mult=slippage,
        vol_corr_mult=vol_corr_mult
    )


# ═══════════════════════════════════════════════════════════════════════════════
# MARKET MOOD — From Omega v17.5
# ═══════════════════════════════════════════════════════════════════════════════

def compute_mood(
    dealer_position: DealerPosition,
    regime: Regime,
    momentum: Momentum,
    flow_bias: str
) -> MarketMood:
    """Determine market mood from Omega v17.5"""
    
    # Vol expansion: High KE + negative gamma + VIX rising
    if regime.vol_corr_mult > 1.3 and dealer_position == DealerPosition.SHORT_GAMMA:
        return MarketMood.VOL_EXPANSION
    
    # Trend: Strong momentum + flow aligned
    if abs(momentum.vw_velocity) > 0.5:
        if (momentum.direction == 'UP' and flow_bias == 'BULLISH') or \
           (momentum.direction == 'DOWN' and flow_bias == 'BEARISH'):
            return MarketMood.TREND
    
    # Mean revert: Long gamma
    if dealer_position == DealerPosition.LONG_GAMMA and regime.character == RegimeChar.SMOOTH:
        return MarketMood.MEAN_REVERT
    
    # Chop: Neutral gamma, low momentum
    if dealer_position == DealerPosition.NEUTRAL and abs(momentum.vw_velocity) < 0.2:
        return MarketMood.CHOP
    
    return MarketMood.UNKNOWN


# ═══════════════════════════════════════════════════════════════════════════════
# FLOW ANALYSIS — From V5 + realtime
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_flow(
    trades: List[OptionFlow],
    sweeps: List[Sweep]
) -> FlowAnalysis:
    """Analyze options flow"""
    
    # Net premium
    call_premium = sum(t.premium * (1 if t.side == 'BUY' else -1) 
                       for t in trades if t.option_type == 'call')
    put_premium = sum(t.premium * (1 if t.side == 'BUY' else -1)
                      for t in trades if t.option_type == 'put')
    
    # Flow score (from V5): -2 to +2
    net_flow = call_premium - put_premium
    total_flow = abs(call_premium) + abs(put_premium)
    flow_score = (net_flow / total_flow * 2) if total_flow > 0 else 0
    flow_score = max(-2, min(2, flow_score))
    
    # Smart money bias from sweeps
    bullish_sweeps = len([s for s in sweeps if s.bias == 'BULLISH' and s.urgency == 'EXTREME'])
    bearish_sweeps = len([s for s in sweeps if s.bias == 'BEARISH' and s.urgency == 'EXTREME'])
    
    if bullish_sweeps > bearish_sweeps + 1:
        smart_money_bias = 'BULLISH'
    elif bearish_sweeps > bullish_sweeps + 1:
        smart_money_bias = 'BEARISH'
    else:
        smart_money_bias = 'NEUTRAL'
    
    return FlowAnalysis(
        flow_score=flow_score,
        net_call_premium=call_premium,
        net_put_premium=put_premium,
        recent_sweeps=sweeps,
        smart_money_bias=smart_money_bias
    )


# ═══════════════════════════════════════════════════════════════════════════════
# IV CRUSH ANALYSIS — From v2.5 Gemini Fix #2 (Surgical)
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_iv_crush(
    trades: List[OptionFlow],
    mins_to_exp: float
) -> IVAnalysis:
    """Surgical IV crush analysis from v2.5"""
    iv_trades = [t for t in trades if t.iv and t.iv > 0]
    
    if len(iv_trades) < 3:
        return IVAnalysis(25, 'GO', 3.0, 0)
    
    # Calculate Vega/Theta ratio
    total_vega = sum(abs(t.vega or 0) * t.size for t in iv_trades)
    total_theta = sum(abs(t.theta or 0) * t.size for t in iv_trades)
    vega_theta_ratio = total_vega / total_theta if total_theta > 0 else 3.0
    
    # IV trend
    mid = len(iv_trades) // 2
    first_avg = sum(t.iv for t in iv_trades[:mid]) / mid if mid > 0 else 0
    second_avg = sum(t.iv for t in iv_trades[mid:]) / (len(iv_trades) - mid)
    iv_falling = second_avg < first_avg * 0.95
    
    # Risk score
    risk = 25
    if iv_falling:
        risk += 25
    if second_avg > 30:
        risk += 15
    if mins_to_exp < 60:
        risk += 20
    if vega_theta_ratio < CFG.VEGA_THETA_SAFE:
        risk += 20
    risk = min(100, risk)
    
    # SURGICAL penalty (not binary!)
    if vega_theta_ratio >= CFG.VEGA_THETA_SAFE:
        surgical_penalty = 0
    else:
        surgical_penalty = min(0.5, (CFG.VEGA_THETA_SAFE - vega_theta_ratio) / CFG.VEGA_THETA_SAFE * 0.5)
    
    # Recommendation
    if risk > CFG.IV_CRUSH_HIGH:
        rec = 'AVOID'
    elif risk > 50:
        rec = 'CAUTION'
    else:
        rec = 'GO'
    
    return IVAnalysis(risk, rec, vega_theta_ratio, surgical_penalty)


# ═══════════════════════════════════════════════════════════════════════════════
# SIGNAL GENERATION — From V5 + v2.5
# ═══════════════════════════════════════════════════════════════════════════════

def generate_signal(
    force_dir: str,
    force_conf: float,
    flow: FlowAnalysis,
    data_quality: DataQuality,
    regime: Regime
) -> Signal:
    """Generate trading signal"""
    
    # Block signals during warmup (Gemini Fix #1)
    if data_quality in (DataQuality.GAP, DataQuality.WARMING):
        return Signal.NO_TRADE
    
    # Check for alignment (from V5)
    aligned_up = force_dir == 'UP' and flow.flow_score > 0.5
    aligned_down = force_dir == 'DOWN' and flow.flow_score < -0.5
    
    # Adjust confidence for alignment
    adjusted_conf = force_conf
    if aligned_up or aligned_down:
        adjusted_conf += 20
    elif abs(flow.flow_score) > CFG.FLOW_DIVERGENCE_THRESHOLD:
        adjusted_conf -= 30
    
    adjusted_conf = max(0, min(99, adjusted_conf))
    
    # Flow divergence check
    if not (aligned_up or aligned_down) and abs(flow.flow_score) > CFG.FLOW_DIVERGENCE_THRESHOLD:
        return Signal.FLOW_DIVERGENCE
    
    # Conviction check
    if adjusted_conf >= CFG.CONVICTION_THRESHOLD:
        if aligned_up:
            return Signal.CONVICTION_LONG
        elif aligned_down:
            return Signal.CONVICTION_SHORT
    
    return Signal.NEUTRAL


# ═══════════════════════════════════════════════════════════════════════════════
# ENTRY FINDER — From realtime module
# ═══════════════════════════════════════════════════════════════════════════════

def find_entry(
    spot: float,
    dealer: DealerState,
    regime: Regime,
    momentum: Momentum,
    flow: FlowAnalysis,
    iv: IVAnalysis,
    signal: Signal,
    force_conf: float,
    data_quality: DataQuality,
    account_size: float = 50000
) -> Optional[Entry]:
    """Find optimal entry based on mechanics"""
    
    # No entry during data issues
    if data_quality in (DataQuality.GAP, DataQuality.WARMING):
        return None
    
    # No entry on neutral or divergence
    if signal in (Signal.NEUTRAL, Signal.NO_TRADE, Signal.FLOW_DIVERGENCE):
        return None
    
    # Determine direction
    if signal == Signal.CONVICTION_LONG:
        direction = 'LONG'
    elif signal == Signal.CONVICTION_SHORT:
        direction = 'SHORT'
    else:
        return None
    
    # Find entry level
    if direction == 'LONG' and dealer.support_levels:
        trigger_strike = dealer.support_levels[0][0]
        stop = trigger_strike - 5
        target_1 = spot + 8
        target_2 = spot + 15
    elif direction == 'SHORT' and dealer.resistance_levels:
        trigger_strike = dealer.resistance_levels[0][0]
        stop = trigger_strike + 5
        target_1 = spot - 8
        target_2 = spot - 15
    else:
        # Use gamma flip as reference
        if direction == 'LONG':
            stop = dealer.gamma_flip - 3
            target_1 = spot + 8
            target_2 = spot + 15
        else:
            stop = dealer.gamma_flip + 3
            target_1 = spot - 8
            target_2 = spot - 15
    
    # Risk/Reward
    risk = abs(spot - stop)
    reward = abs(target_1 - spot)
    rr = reward / risk if risk > 0 else 0
    
    # Position sizing with Kelly
    win_prob = force_conf / 100
    
    # Apply penalties
    penalties = []
    
    # Surgical IV penalty
    if iv.surgical_penalty > 0:
        win_prob *= (1 - iv.surgical_penalty)
        penalties.append(f"IV:-{int(iv.surgical_penalty * 100)}%")
    
    # Regime penalties
    if regime.gex_type == 'NEG':
        win_prob *= 0.85
        penalties.append("NEG_GAMMA:-15%")
    if regime.in_phase:
        win_prob *= 0.7
        penalties.append("PHASE:-30%")
    if regime.kill_zone:
        win_prob *= 0.6
        penalties.append("KILL:-40%")
    
    # Data quality penalties
    if data_quality == DataQuality.STALE:
        win_prob *= CFG.STALE_PENALTY
        penalties.append("STALE:-50%")
    
    # Kelly criterion
    q = 1 - win_prob
    kelly = ((rr * win_prob) - q) / rr if rr > 0 else 0
    kelly *= CFG.KELLY_FRACTION * regime.slippage_mult
    kelly = max(CFG.MIN_KELLY, min(CFG.MAX_KELLY, kelly))
    
    max_risk_dollars = account_size * min(CFG.MAX_RISK_PCT, kelly)
    contracts = max(1, int(max_risk_dollars / (risk * 50))) if risk > 0 else 1
    
    # Confidence
    confidence = win_prob * 100
    
    # Urgency
    dist_to_entry = abs(spot - (trigger_strike if 'trigger_strike' in dir() else spot))
    if dist_to_entry < 2:
        urgency = Urgency.NOW
    elif dist_to_entry < 5:
        urgency = Urgency.READY
    elif dist_to_entry < 10:
        urgency = Urgency.PREP
    else:
        urgency = Urgency.WAIT
    
    # Downgrade urgency if IV is bad
    if iv.recommendation == 'AVOID':
        urgency = Urgency.WAIT
    elif iv.recommendation == 'CAUTION' and urgency == Urgency.NOW:
        urgency = Urgency.READY
    
    # Build WHY explanation
    if dealer.position == DealerPosition.SHORT_GAMMA:
        why_mechanics = f"Dealers SHORT gamma → Must {('BUY' if direction == 'LONG' else 'SELL')} to hedge → ADDS FUEL"
    else:
        why_mechanics = f"Dealers LONG gamma → Will fade move → Watch for reversal at level"
    
    why_flow = f"Flow score {flow.flow_score:+.2f}, {len([s for s in flow.recent_sweeps if s.urgency == 'EXTREME'])} extreme sweeps"
    
    return Entry(
        direction=direction,
        entry_price=spot,
        stop=stop,
        target_1=target_1,
        target_2=target_2,
        trigger=f"{'Support' if direction == 'LONG' else 'Resistance'} at {trigger_strike if 'trigger_strike' in dir() else dealer.gamma_flip:.0f}",
        why_mechanics=why_mechanics,
        why_flow=why_flow,
        risk_points=risk,
        reward_points=reward,
        risk_reward=rr,
        kelly=kelly,
        contracts=contracts,
        max_risk_dollars=max_risk_dollars,
        confidence=confidence,
        urgency=urgency,
        warnings=penalties
    )


# ═══════════════════════════════════════════════════════════════════════════════
# WHY EXPLANATION — From realtime module
# ═══════════════════════════════════════════════════════════════════════════════

def explain_why_moving(dealer: DealerState, momentum: Momentum, flow: FlowAnalysis) -> str:
    """Generate human-readable explanation of WHY price is moving"""
    
    parts = []
    
    # Dealer positioning
    if dealer.position == DealerPosition.SHORT_GAMMA:
        if momentum.direction == 'UP':
            parts.append("DEALERS SHORT GAMMA + PRICE RISING → Dealers must BUY to hedge → ADDING FUEL 🔥")
        elif momentum.direction == 'DOWN':
            parts.append("DEALERS SHORT GAMMA + PRICE FALLING → Dealers must SELL to hedge → ADDING PRESSURE 📉")
        else:
            parts.append("DEALERS SHORT GAMMA → Any move will be amplified")
    elif dealer.position == DealerPosition.LONG_GAMMA:
        parts.append("DEALERS LONG GAMMA → They will fade the move → Expect mean reversion")
    
    # Acceleration zone
    if dealer.acceleration_zone:
        parts.append("⚡ IN ACCELERATION ZONE near gamma flip")
    
    # Flow
    if flow.smart_money_bias == 'BULLISH':
        parts.append(f"BULLISH FLOW: {len([s for s in flow.recent_sweeps if s.bias == 'BULLISH'])} call sweeps")
    elif flow.smart_money_bias == 'BEARISH':
        parts.append(f"BEARISH FLOW: {len([s for s in flow.recent_sweeps if s.bias == 'BEARISH'])} put sweeps")
    
    return " | ".join(parts) if parts else "Mixed signals - no dominant driver"


def explain_what_expect(dealer: DealerState, mood: MarketMood, regime: Regime) -> str:
    """Generate expectation"""
    
    if mood == MarketMood.TREND:
        return "EXPECT TREND CONTINUATION - Momentum + Flow aligned"
    elif mood == MarketMood.VOL_EXPANSION:
        return "EXPECT VOLATILITY EXPANSION - Short gamma + VIX rising"
    elif mood == MarketMood.MEAN_REVERT:
        return "EXPECT MEAN REVERSION - Dealers will fade extremes"
    elif mood == MarketMood.CHOP:
        return "EXPECT CHOP - No clear direction, reduce size"
    
    if dealer.acceleration_zone:
        return "EXPECT AMPLIFIED MOVES - Near gamma flip"
    
    if regime.kill_zone:
        return "⚠️ KILL ZONE - High slippage, be careful"
    
    return "MIXED - Wait for clearer setup"


# ═══════════════════════════════════════════════════════════════════════════════
# THE MAIN ENGINE — Combines everything
# ═══════════════════════════════════════════════════════════════════════════════

class TitanUltimate:
    """
    TITAN ULTIMATE v19.0 — The final form
    
    Combines the best of:
    - V5: Physics + Vanna + Flow
    - v2.5 FINAL: Gap warmup + Surgical IV + Node health
    - Omega v17.5: Mood + Archiving
    - Realtime: WHY explanation + Entry finder
    """
    
    def __init__(self, account_size: float = 50000):
        self.account_size = account_size
        
        # State
        self.bars: List[Bar] = []
        self.trades: List[OptionFlow] = []
        self.sweeps: List[Sweep] = []
        self.nodes: List[GammaNode] = []
        
        # Vacuum tracking (from V5)
        self.vacuum_strikes: Set[float] = set()
        
        # Tick state (from v2.5)
        self.last_update: int = 0
        self.warmup_remaining: int = 0
        self.data_quality: DataQuality = DataQuality.GOOD
        
        # Previous values
        self.prev_vix: float = 15.0
        self.prev_ke: float = 0.0
        self.prev_gex: float = 0.0
        
        # Alert cooldown (from Omega v17.5)
        self.last_alert_time: int = 0
    
    def add_bar(self, bar: Bar):
        """Add price bar"""
        self.bars.append(bar)
        if len(self.bars) > 100:
            self.bars.pop(0)
    
    def add_flow(self, trades: List[OptionFlow]):
        """Add options flow"""
        now = int(time.time() * 1000)
        self.trades.extend(trades)
        # Keep last 2 minutes
        self.trades = [t for t in self.trades if t.timestamp > now - 120000][-500:]
        
        # Detect sweeps
        self._detect_sweeps()
    
    def set_nodes(self, nodes: List[GammaNode]):
        """Update gamma nodes"""
        self.nodes = nodes
    
    def _update_tick_state(self, now: int):
        """Update data quality state (from v2.5 Gemini Fix #1)"""
        gap = now - self.last_update if self.last_update > 0 else 0
        
        if gap > CFG.MAX_DATA_GAP_MS:
            self.data_quality = DataQuality.GAP
            self.warmup_remaining = CFG.GAP_WARMUP_TICKS
        elif self.warmup_remaining > 0:
            self.data_quality = DataQuality.WARMING
            self.warmup_remaining -= 1
        elif gap > CFG.MAX_DATA_GAP_MS / 2:
            self.data_quality = DataQuality.STALE
        else:
            self.data_quality = DataQuality.GOOD
        
        self.last_update = now
    
    def _detect_sweeps(self):
        """Detect sweep orders"""
        if len(self.trades) < 3:
            return
        
        # Group by contract
        by_contract = {}
        for t in self.trades[-100:]:
            key = (t.strike, t.option_type)
            if key not in by_contract:
                by_contract[key] = []
            by_contract[key].append(t)
        
        # Check each contract for sweeps
        new_sweeps = []
        for (strike, opt_type), trades in by_contract.items():
            if len(trades) < 2:
                continue
            
            # Check time window
            trades = sorted(trades, key=lambda t: t.timestamp)
            for i, t in enumerate(trades):
                related = [t]
                for j in range(i + 1, len(trades)):
                    if trades[j].timestamp - t.timestamp > CFG.SWEEP_WINDOW_MS * 1000000:
                        break
                    if trades[j].side == t.side:
                        related.append(trades[j])
                
                if len(related) >= 2:
                    exchanges = set(tr.exchange for tr in related if tr.exchange)
                    total_size = sum(tr.size for tr in related)
                    
                    if len(exchanges) >= CFG.SWEEP_MIN_EXCHANGES and total_size >= CFG.SWEEP_MIN_SIZE:
                        # Determine bias
                        if opt_type == 'call':
                            bias = 'BULLISH' if t.side == 'BUY' else 'BEARISH'
                        else:
                            bias = 'BEARISH' if t.side == 'BUY' else 'BULLISH'
                        
                        urgency = 'EXTREME' if total_size > CFG.SWEEP_MIN_SIZE * 3 else 'HIGH'
                        
                        sweep = Sweep(
                            timestamp=t.timestamp,
                            strike=strike,
                            option_type=opt_type,
                            total_size=total_size,
                            total_premium=sum(tr.premium for tr in related),
                            exchanges=exchanges,
                            side=t.side,
                            bias=bias,
                            urgency=urgency
                        )
                        new_sweeps.append(sweep)
        
        self.sweeps.extend(new_sweeps)
        # Keep last 100 sweeps
        self.sweeps = self.sweeps[-100:]
    
    def analyze(
        self,
        spot: float,
        vix: float,
        net_gex: float,
        gamma_flip: float,
        mins_to_exp: float = 60
    ) -> MarketState:
        """
        THE MAIN ANALYSIS METHOD
        
        Returns complete market state with:
        - WHY price is moving
        - WHAT to expect
        - WHERE to enter
        - HOW much to risk
        """
        now = int(time.time() * 1000)
        timestamp = datetime.now()
        
        # Update tick state
        self._update_tick_state(now)
        
        # Compute node health
        for node in self.nodes:
            compute_node_health(node, spot, mins_to_exp, self.vacuum_strikes)
        
        # Realized vol
        rv = calc_realized_vol(self.bars)
        
        # Sigma
        sigma = calc_sigma(mins_to_exp, vix, rv)
        
        # Force
        force_dir, force_conf, equilibrium = compute_force(spot, self.nodes, sigma, vix)
        
        # Momentum
        momentum = compute_momentum(self.bars)
        
        # Vanna force
        vanna_force = compute_vanna_force(vix, self.prev_vix, net_gex)
        
        # Regime
        vix_delta = vix - self.prev_vix
        regime = compute_regime(
            spot, net_gex, gamma_flip, vix, vix_delta,
            momentum.direction, momentum.kinetic_energy, self.prev_ke
        )
        
        # Dealer state
        dealer_position = (
            DealerPosition.LONG_GAMMA if net_gex > CFG.GEX_SIGNIFICANCE * 0.5
            else DealerPosition.SHORT_GAMMA if net_gex < -CFG.GEX_SIGNIFICANCE * 0.5
            else DealerPosition.NEUTRAL
        )
        
        # Support/Resistance levels
        support_levels = [
            (n.strike, n.mass) for n in self.nodes
            if n.strike < spot and n.mass > 0 and not n.is_vacuum
        ]
        support_levels.sort(key=lambda x: x[1], reverse=True)
        
        resistance_levels = [
            (n.strike, abs(n.mass)) for n in self.nodes
            if n.strike > spot and n.mass < 0 and not n.is_vacuum
        ]
        resistance_levels.sort(key=lambda x: x[1], reverse=True)
        
        dist_to_flip = spot - gamma_flip
        acceleration_zone = abs(dist_to_flip) < spot * 0.005 or net_gex < 0
        
        dealer = DealerState(
            position=dealer_position,
            total_gex=net_gex,
            gamma_flip=gamma_flip,
            dist_to_flip=dist_to_flip,
            support_levels=support_levels[:3],
            resistance_levels=resistance_levels[:3],
            hedge_pressure=np.clip(dist_to_flip / spot * 100, -1, 1),
            acceleration_zone=acceleration_zone
        )
        
        # Flow analysis
        flow = analyze_flow(self.trades, self.sweeps[-20:])
        
        # IV analysis
        iv = analyze_iv_crush(self.trades, mins_to_exp)
        
        # Market mood
        mood = compute_mood(dealer_position, regime, momentum, flow.smart_money_bias)
        
        # Signal
        signal = generate_signal(force_dir, force_conf, flow, self.data_quality, regime)
        
        # Entry
        entry = find_entry(
            spot, dealer, regime, momentum, flow, iv, signal,
            force_conf, self.data_quality, self.account_size
        )
        
        # WHY explanation
        why_moving = explain_why_moving(dealer, momentum, flow)
        what_expect = explain_what_expect(dealer, mood, regime)
        
        # Key levels
        key_levels = {
            'gamma_flip': gamma_flip,
            'equilibrium': equilibrium,
        }
        if support_levels:
            key_levels['support_1'] = support_levels[0][0]
        if resistance_levels:
            key_levels['resistance_1'] = resistance_levels[0][0]
        
        # Warnings
        warnings = []
        if self.data_quality != DataQuality.GOOD:
            warnings.append(f"⚠️ Data: {self.data_quality.value}")
        if regime.kill_zone:
            warnings.append("🔴 KILL ZONE")
        if regime.in_phase:
            warnings.append("⚡ PHASE ZONE")
        if dealer.acceleration_zone:
            warnings.append("⚡ ACCELERATION ZONE")
        if iv.recommendation == 'AVOID':
            warnings.append(f"📉 IV CRUSH RISK: {iv.risk_score:.0f}%")
        
        # Update previous values
        self.prev_vix = vix
        self.prev_ke = momentum.kinetic_energy
        self.prev_gex = net_gex
        
        return MarketState(
            timestamp=timestamp,
            spot=spot,
            vix=vix,
            data_quality=self.data_quality,
            dealer=dealer,
            regime=regime,
            mood=mood,
            momentum=momentum,
            flow=flow,
            iv=iv,
            force_direction=force_dir,
            force_confidence=force_conf,
            equilibrium=equilibrium,
            vanna_force=vanna_force,
            signal=signal,
            entry=entry,
            why_moving=why_moving,
            what_expect=what_expect,
            key_levels=key_levels,
            warnings=warnings
        )
    
    def get_readable_output(self, state: MarketState) -> str:
        """Get human-readable output"""
        
        output = f"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  TITAN ULTIMATE v19.0 — {state.timestamp.strftime('%H:%M:%S')}
╠══════════════════════════════════════════════════════════════════════════════╣

📍 SPOT: {state.spot:.2f}  |  VIX: {state.vix:.2f}  |  DATA: {state.data_quality.value}

════════════════════════════════════════════════════════════════════════════════
🎰 DEALER POSITIONING
════════════════════════════════════════════════════════════════════════════════

Position: {state.dealer.position.value}
Net GEX: ${state.dealer.total_gex/1e9:.2f}B
Gamma Flip: {state.dealer.gamma_flip:.2f} ({state.dealer.dist_to_flip:+.2f} away)
{"⚡ IN ACCELERATION ZONE" if state.dealer.acceleration_zone else ""}

════════════════════════════════════════════════════════════════════════════════
🧠 WHY IS PRICE MOVING?
════════════════════════════════════════════════════════════════════════════════

{state.why_moving}

════════════════════════════════════════════════════════════════════════════════
🔮 WHAT TO EXPECT
════════════════════════════════════════════════════════════════════════════════

Mood: {state.mood.value}
{state.what_expect}

════════════════════════════════════════════════════════════════════════════════
📊 MARKET STRUCTURE
════════════════════════════════════════════════════════════════════════════════

Force: {state.force_direction} ({state.force_confidence:.0f}%)
Regime: {state.regime.gex_type} GAMMA, {state.regime.character.value}
Momentum: {state.momentum.direction} (vel: {state.momentum.vw_velocity:.2f})
Vanna Force: {state.vanna_force:.2f}

════════════════════════════════════════════════════════════════════════════════
💰 FLOW INTELLIGENCE
════════════════════════════════════════════════════════════════════════════════

Flow Score: {state.flow.flow_score:+.2f}
Smart Money: {state.flow.smart_money_bias}
Recent Sweeps: {len(state.flow.recent_sweeps)}

════════════════════════════════════════════════════════════════════════════════
🎯 SIGNAL
════════════════════════════════════════════════════════════════════════════════

>>> {state.signal.value} <<<

"""
        if state.entry:
            output += f"""
════════════════════════════════════════════════════════════════════════════════
📍 ENTRY
════════════════════════════════════════════════════════════════════════════════

Direction: {state.entry.direction}
Entry: {state.entry.entry_price:.2f}
Stop: {state.entry.stop:.2f}
Target 1: {state.entry.target_1:.2f}
Target 2: {state.entry.target_2:.2f}

R:R = 1:{state.entry.risk_reward:.1f}
Kelly: {state.entry.kelly:.1%}
Contracts: {state.entry.contracts}
Max Risk: ${state.entry.max_risk_dollars:.0f}

Urgency: {state.entry.urgency.value}
Confidence: {state.entry.confidence:.0f}%

WHY MECHANICS: {state.entry.why_mechanics}
WHY FLOW: {state.entry.why_flow}

{chr(10).join(f'⚠️ {w}' for w in state.entry.warnings) if state.entry.warnings else ''}
"""
        
        if state.warnings:
            output += f"""
════════════════════════════════════════════════════════════════════════════════
⚠️ WARNINGS
════════════════════════════════════════════════════════════════════════════════

{chr(10).join(state.warnings)}
"""
        
        output += f"""
════════════════════════════════════════════════════════════════════════════════
📐 KEY LEVELS
════════════════════════════════════════════════════════════════════════════════

"""
        for name, level in state.key_levels.items():
            output += f"  {name}: {level:.2f}\n"
        
        output += """
╚══════════════════════════════════════════════════════════════════════════════╝
"""
        return output
    
    def reset(self):
        """Reset engine state"""
        self.bars = []
        self.trades = []
        self.sweeps = []
        self.nodes = []
        self.vacuum_strikes = set()
        self.last_update = 0
        self.warmup_remaining = 0
        self.data_quality = DataQuality.GOOD


# ═══════════════════════════════════════════════════════════════════════════════
# DEMO
# ═══════════════════════════════════════════════════════════════════════════════

def demo():
    """Run demo with simulated data"""
    print("=" * 80)
    print("TITAN ULTIMATE v19.0 — DEMO")
    print("=" * 80)
    
    engine = TitanUltimate(account_size=50000)
    
    # Generate simulated data
    spot = 5950.0
    
    # Add bars
    for i in range(20):
        bar = Bar(
            time=int(time.time() * 1000) - (20 - i) * 60000,
            open=spot - 10 + i * 0.5,
            high=spot - 9 + i * 0.5,
            low=spot - 11 + i * 0.5,
            close=spot - 10 + i * 0.5 + 0.3,
            volume=1000 + i * 100
        )
        engine.add_bar(bar)
    
    # Add nodes
    nodes = []
    for i in range(-10, 11):
        strike = spot + i * 5
        gamma = np.random.uniform(1e9, 5e9)
        nodes.append(GammaNode(
            strike=strike,
            gamma=gamma if i > 0 else -gamma,
            abs_gamma=gamma,
            oi=int(np.random.uniform(5000, 20000)),
            volume=int(np.random.uniform(100, 2000))
        ))
    engine.set_nodes(nodes)
    
    # Add some flow
    now = int(time.time() * 1000)
    flows = []
    for i in range(10):
        flows.append(OptionFlow(
            timestamp=now - i * 5000,
            strike=spot + np.random.randint(-5, 6) * 5,
            option_type='call' if np.random.random() > 0.4 else 'put',
            side='BUY' if np.random.random() > 0.3 else 'SELL',
            size=np.random.randint(50, 500),
            premium=np.random.uniform(10000, 100000),
            exchange=np.random.choice(['CBOE', 'ISE', 'PHLX', 'AMEX'])
        ))
    engine.add_flow(flows)
    
    # Run analysis
    state = engine.analyze(
        spot=spot,
        vix=18.5,
        net_gex=-1.5e9,  # Short gamma
        gamma_flip=spot - 15,
        mins_to_exp=120
    )
    
    # Print output
    print(engine.get_readable_output(state))


if __name__ == "__main__":
    demo()
