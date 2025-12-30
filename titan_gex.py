"""
TITAN MULTI-EXPIRY GEX MODULE
=============================
Aggregated gamma exposure across multiple expirations

Features:
- 0DTE, weekly, monthly GEX stacking
- Time-weighted gamma aggregation
- Max pain calculation
- Put wall / Call wall detection
- Gamma flip level computation
- Volume-weighted gamma influence
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from datetime import datetime, date, timedelta
from enum import Enum
import numpy as np


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class GEXConfig:
    """GEX calculation configuration"""
    # Strike filtering
    STRIKE_RANGE_PCT: float = 0.05      # +/- 5% from spot
    MIN_OI: int = 100                    # Minimum open interest
    MIN_VOLUME: int = 10                 # Minimum volume
    
    # Time weighting
    DTE_WEIGHT_POWER: float = 0.5        # Weight = 1 / DTE^0.5
    NEAR_TERM_BOOST: float = 2.0         # 0DTE multiplier
    
    # Volume influence
    VOLUME_WEIGHT: float = 2.0           # Volume counts 2x OI
    
    # Wall detection
    WALL_MIN_GEX_PCT: float = 0.05       # Min 5% of total GEX
    WALL_CLUSTER_WIDTH: float = 5.0      # Points to cluster
    
    # Significance
    GEX_SIGNIFICANCE: float = 1e9


CONFIG = GEXConfig()


# ═══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class OptionContract:
    """Single option contract"""
    strike: float
    expiry: date
    option_type: str  # 'call' or 'put'
    oi: int
    volume: int
    gamma: float
    delta: float
    iv: float
    bid: float
    ask: float
    last: float
    
    @property
    def gex(self) -> float:
        """Gamma exposure = gamma * (OI + volume*weight) * 100 * spot"""
        position_size = self.oi + self.volume * CONFIG.VOLUME_WEIGHT
        # Sign: calls positive, puts negative for dealer position
        sign = 1 if self.option_type == 'call' else -1
        return self.gamma * position_size * 100 * sign


@dataclass
class ExpiryGEX:
    """GEX analysis for a single expiration"""
    expiry: date
    dte: int
    
    # Aggregated metrics
    net_gex: float
    call_gex: float
    put_gex: float
    
    # Key levels
    gamma_flip: float
    max_pain: float
    call_wall: float
    put_wall: float
    
    # Strikes
    strikes: List[float]
    strike_gex: Dict[float, float]  # Strike -> net GEX
    
    # Metadata
    total_oi: int
    total_volume: int
    weight: float  # Time weight for aggregation


@dataclass
class GammaWall:
    """Gamma wall (support/resistance)"""
    strike: float
    gex: float
    wall_type: str  # 'call' or 'put'
    strength: float  # 0-1 relative strength
    expiry: Optional[date] = None


@dataclass
class AggregatedGEX:
    """Complete multi-expiry GEX analysis"""
    timestamp: datetime
    spot: float
    
    # Primary metrics
    blended_gex: float          # Time-weighted total
    zero_dte_gex: float         # 0DTE only
    weekly_gex: float           # This week's expiry
    monthly_gex: float          # Monthly expiry
    
    # Key levels
    gamma_flip: float           # Blended flip level
    max_pain: float             # Blended max pain
    call_resistance: float      # Strongest call wall
    put_support: float          # Strongest put wall
    
    # Detailed walls
    call_walls: List[GammaWall]
    put_walls: List[GammaWall]
    
    # Regime
    regime: str                 # 'POSITIVE', 'NEGATIVE', 'NEUTRAL'
    zero_dte_dominant: bool     # 0DTE > 60% of total
    
    # Per-expiry breakdown
    by_expiry: Dict[date, ExpiryGEX]
    
    # Strike-level data
    strike_gex: Dict[float, float]
    
    # Metadata
    total_oi: int
    total_volume: int
    expirations_analyzed: int


# ═══════════════════════════════════════════════════════════════════════════════
# CORE CALCULATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def calc_dte(expiry: date, today: date = None) -> int:
    """Calculate days to expiration"""
    if today is None:
        today = date.today()
    return max(0, (expiry - today).days)


def calc_time_weight(dte: int) -> float:
    """
    Calculate time weight for an expiration
    Near-term expirations have more influence
    """
    if dte == 0:
        return CONFIG.NEAR_TERM_BOOST
    return 1.0 / (dte ** CONFIG.DTE_WEIGHT_POWER)


def calc_max_pain(contracts: List[OptionContract]) -> float:
    """
    Calculate max pain level (where options expire worthless)
    """
    if not contracts:
        return 0
    
    # Get unique strikes
    strikes = sorted(set(c.strike for c in contracts))
    if not strikes:
        return 0
    
    min_pain = float('inf')
    max_pain_strike = strikes[len(strikes) // 2]
    
    for test_strike in strikes:
        total_pain = 0
        
        for c in contracts:
            if c.option_type == 'call' and test_strike > c.strike:
                # Call is ITM, pain = (test - strike) * OI * 100
                total_pain += (test_strike - c.strike) * c.oi * 100
            elif c.option_type == 'put' and test_strike < c.strike:
                # Put is ITM, pain = (strike - test) * OI * 100
                total_pain += (c.strike - test_strike) * c.oi * 100
        
        if total_pain < min_pain:
            min_pain = total_pain
            max_pain_strike = test_strike
    
    return max_pain_strike


def calc_gamma_flip(strike_gex: Dict[float, float], spot: float) -> float:
    """
    Calculate gamma flip level (where net GEX crosses zero)
    """
    if not strike_gex:
        return spot
    
    # Sort strikes
    strikes = sorted(strike_gex.keys())
    
    # Find where cumulative GEX crosses zero
    cumulative = 0
    prev_strike = strikes[0]
    prev_cum = 0
    
    for strike in strikes:
        gex = strike_gex[strike]
        cumulative += gex
        
        if prev_cum <= 0 and cumulative > 0:
            # Crossed from negative to positive
            if cumulative - prev_cum != 0:
                # Interpolate
                flip = prev_strike + (strike - prev_strike) * (-prev_cum) / (cumulative - prev_cum)
                return flip
            return strike
        
        prev_strike = strike
        prev_cum = cumulative
    
    # No flip found - use max GEX strike
    max_gex_strike = max(strike_gex, key=lambda k: abs(strike_gex[k]))
    return max_gex_strike


def detect_walls(
    strike_gex: Dict[float, float], 
    spot: float,
    wall_type: str = 'call'
) -> List[GammaWall]:
    """
    Detect gamma walls (clusters of high gamma)
    """
    if not strike_gex:
        return []
    
    total_gex = sum(abs(g) for g in strike_gex.values())
    if total_gex == 0:
        return []
    
    walls = []
    
    # Filter strikes by type
    if wall_type == 'call':
        # Call walls are above spot
        relevant = {k: v for k, v in strike_gex.items() if k > spot and v > 0}
    else:
        # Put walls are below spot
        relevant = {k: v for k, v in strike_gex.items() if k < spot and v < 0}
    
    if not relevant:
        return []
    
    # Cluster nearby strikes
    clusters = []
    sorted_strikes = sorted(relevant.keys())
    current_cluster = []
    
    for strike in sorted_strikes:
        if not current_cluster:
            current_cluster = [strike]
        elif strike - current_cluster[-1] <= CONFIG.WALL_CLUSTER_WIDTH:
            current_cluster.append(strike)
        else:
            clusters.append(current_cluster)
            current_cluster = [strike]
    
    if current_cluster:
        clusters.append(current_cluster)
    
    # Find significant walls
    for cluster in clusters:
        cluster_gex = sum(abs(strike_gex[s]) for s in cluster)
        strength = cluster_gex / total_gex
        
        if strength >= CONFIG.WALL_MIN_GEX_PCT:
            # Use volume-weighted average strike
            avg_strike = sum(s * abs(strike_gex[s]) for s in cluster) / cluster_gex
            
            walls.append(GammaWall(
                strike=round(avg_strike),
                gex=cluster_gex if wall_type == 'call' else -cluster_gex,
                wall_type=wall_type,
                strength=strength
            ))
    
    # Sort by strength
    walls.sort(key=lambda w: w.strength, reverse=True)
    return walls[:5]  # Top 5 walls


# ═══════════════════════════════════════════════════════════════════════════════
# SINGLE EXPIRY ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_expiry(
    contracts: List[OptionContract], 
    spot: float,
    today: date = None
) -> Optional[ExpiryGEX]:
    """
    Analyze GEX for a single expiration
    """
    if not contracts:
        return None
    
    if today is None:
        today = date.today()
    
    expiry = contracts[0].expiry
    dte = calc_dte(expiry, today)
    weight = calc_time_weight(dte)
    
    # Filter by strike range
    min_strike = spot * (1 - CONFIG.STRIKE_RANGE_PCT)
    max_strike = spot * (1 + CONFIG.STRIKE_RANGE_PCT)
    
    filtered = [
        c for c in contracts 
        if min_strike <= c.strike <= max_strike
        and (c.oi >= CONFIG.MIN_OI or c.volume >= CONFIG.MIN_VOLUME)
    ]
    
    if not filtered:
        return None
    
    # Calculate per-strike GEX
    strike_gex = {}
    call_gex = 0
    put_gex = 0
    total_oi = 0
    total_vol = 0
    
    for c in filtered:
        position_size = c.oi + c.volume * CONFIG.VOLUME_WEIGHT
        gex = c.gamma * position_size * 100
        
        if c.option_type == 'call':
            call_gex += gex
            sign = 1
        else:
            put_gex += gex
            sign = -1
        
        if c.strike not in strike_gex:
            strike_gex[c.strike] = 0
        strike_gex[c.strike] += gex * sign
        
        total_oi += c.oi
        total_vol += c.volume
    
    net_gex = call_gex - put_gex
    
    # Key levels
    gamma_flip = calc_gamma_flip(strike_gex, spot)
    max_pain = calc_max_pain(filtered)
    
    # Walls
    call_walls = detect_walls(strike_gex, spot, 'call')
    put_walls = detect_walls(strike_gex, spot, 'put')
    
    call_wall = call_walls[0].strike if call_walls else spot + 20
    put_wall = put_walls[0].strike if put_walls else spot - 20
    
    return ExpiryGEX(
        expiry=expiry,
        dte=dte,
        net_gex=net_gex * spot * 0.01,  # Dollar GEX
        call_gex=call_gex * spot * 0.01,
        put_gex=put_gex * spot * 0.01,
        gamma_flip=gamma_flip,
        max_pain=max_pain,
        call_wall=call_wall,
        put_wall=put_wall,
        strikes=sorted(strike_gex.keys()),
        strike_gex=strike_gex,
        total_oi=total_oi,
        total_volume=total_vol,
        weight=weight
    )


# ═══════════════════════════════════════════════════════════════════════════════
# MULTI-EXPIRY AGGREGATION
# ═══════════════════════════════════════════════════════════════════════════════

def aggregate_gex(
    all_contracts: List[OptionContract],
    spot: float,
    today: date = None
) -> AggregatedGEX:
    """
    Aggregate GEX across all expirations with time weighting
    """
    if today is None:
        today = date.today()
    
    now = datetime.now()
    
    if not all_contracts:
        return AggregatedGEX(
            timestamp=now,
            spot=spot,
            blended_gex=0,
            zero_dte_gex=0,
            weekly_gex=0,
            monthly_gex=0,
            gamma_flip=spot,
            max_pain=spot,
            call_resistance=spot + 20,
            put_support=spot - 20,
            call_walls=[],
            put_walls=[],
            regime='NEUTRAL',
            zero_dte_dominant=False,
            by_expiry={},
            strike_gex={},
            total_oi=0,
            total_volume=0,
            expirations_analyzed=0
        )
    
    # Group by expiry
    by_expiry = {}
    for c in all_contracts:
        if c.expiry not in by_expiry:
            by_expiry[c.expiry] = []
        by_expiry[c.expiry].append(c)
    
    # Analyze each expiry
    expiry_analysis: Dict[date, ExpiryGEX] = {}
    
    for expiry, contracts in sorted(by_expiry.items()):
        analysis = analyze_expiry(contracts, spot, today)
        if analysis:
            expiry_analysis[expiry] = analysis
    
    if not expiry_analysis:
        return AggregatedGEX(
            timestamp=now,
            spot=spot,
            blended_gex=0,
            zero_dte_gex=0,
            weekly_gex=0,
            monthly_gex=0,
            gamma_flip=spot,
            max_pain=spot,
            call_resistance=spot + 20,
            put_support=spot - 20,
            call_walls=[],
            put_walls=[],
            regime='NEUTRAL',
            zero_dte_dominant=False,
            by_expiry={},
            strike_gex={},
            total_oi=0,
            total_volume=0,
            expirations_analyzed=0
        )
    
    # Calculate blended metrics
    total_weight = sum(e.weight for e in expiry_analysis.values())
    
    blended_gex = sum(e.net_gex * e.weight for e in expiry_analysis.values()) / total_weight
    
    # Calculate weighted gamma flip
    gamma_flip = sum(e.gamma_flip * e.weight * abs(e.net_gex) for e in expiry_analysis.values())
    gex_weight = sum(e.weight * abs(e.net_gex) for e in expiry_analysis.values())
    gamma_flip = gamma_flip / gex_weight if gex_weight > 0 else spot
    
    # Max pain (weighted by OI)
    total_oi = sum(e.total_oi for e in expiry_analysis.values())
    max_pain = sum(e.max_pain * e.total_oi for e in expiry_analysis.values()) / total_oi if total_oi > 0 else spot
    
    # Identify 0DTE, weekly, monthly
    zero_dte_gex = 0
    weekly_gex = 0
    monthly_gex = 0
    
    # Find weekly Friday and monthly (third Friday)
    days_to_friday = (4 - today.weekday()) % 7
    this_friday = today + timedelta(days=days_to_friday)
    
    # Third Friday of month
    from calendar import Calendar
    c = Calendar()
    month_fridays = [d for d in c.itermonthdates(today.year, today.month) 
                    if d.weekday() == 4 and d.month == today.month]
    monthly_expiry = month_fridays[2] if len(month_fridays) >= 3 else None
    
    for expiry, analysis in expiry_analysis.items():
        if analysis.dte == 0:
            zero_dte_gex = analysis.net_gex
        if expiry == this_friday:
            weekly_gex = analysis.net_gex
        if expiry == monthly_expiry:
            monthly_gex = analysis.net_gex
    
    # Aggregate strike-level GEX
    combined_strike_gex = {}
    for analysis in expiry_analysis.values():
        for strike, gex in analysis.strike_gex.items():
            if strike not in combined_strike_gex:
                combined_strike_gex[strike] = 0
            combined_strike_gex[strike] += gex * analysis.weight
    
    # Find walls
    all_call_walls = []
    all_put_walls = []
    
    for analysis in expiry_analysis.values():
        for w in detect_walls(analysis.strike_gex, spot, 'call'):
            w.expiry = analysis.expiry
            all_call_walls.append(w)
        for w in detect_walls(analysis.strike_gex, spot, 'put'):
            w.expiry = analysis.expiry
            all_put_walls.append(w)
    
    # Sort by strength (weighted by expiry)
    for w in all_call_walls:
        exp_analysis = expiry_analysis.get(w.expiry)
        if exp_analysis:
            w.strength *= exp_analysis.weight
    for w in all_put_walls:
        exp_analysis = expiry_analysis.get(w.expiry)
        if exp_analysis:
            w.strength *= exp_analysis.weight
    
    all_call_walls.sort(key=lambda w: w.strength, reverse=True)
    all_put_walls.sort(key=lambda w: w.strength, reverse=True)
    
    call_resistance = all_call_walls[0].strike if all_call_walls else spot + 20
    put_support = all_put_walls[0].strike if all_put_walls else spot - 20
    
    # Determine regime
    if blended_gex > CONFIG.GEX_SIGNIFICANCE * 0.1:
        regime = 'POSITIVE'
    elif blended_gex < -CONFIG.GEX_SIGNIFICANCE * 0.1:
        regime = 'NEGATIVE'
    else:
        regime = 'NEUTRAL'
    
    # Check 0DTE dominance
    total_abs_gex = sum(abs(e.net_gex) for e in expiry_analysis.values())
    zero_dte_dominant = abs(zero_dte_gex) > total_abs_gex * 0.6 if total_abs_gex > 0 else False
    
    total_volume = sum(e.total_volume for e in expiry_analysis.values())
    
    return AggregatedGEX(
        timestamp=now,
        spot=spot,
        blended_gex=blended_gex,
        zero_dte_gex=zero_dte_gex,
        weekly_gex=weekly_gex,
        monthly_gex=monthly_gex,
        gamma_flip=gamma_flip,
        max_pain=max_pain,
        call_resistance=call_resistance,
        put_support=put_support,
        call_walls=all_call_walls[:5],
        put_walls=all_put_walls[:5],
        regime=regime,
        zero_dte_dominant=zero_dte_dominant,
        by_expiry=expiry_analysis,
        strike_gex=combined_strike_gex,
        total_oi=total_oi,
        total_volume=total_volume,
        expirations_analyzed=len(expiry_analysis)
    )


# ═══════════════════════════════════════════════════════════════════════════════
# GEX ENGINE CLASS
# ═══════════════════════════════════════════════════════════════════════════════

class GEXEngine:
    """
    Multi-Expiry GEX Analysis Engine
    
    Handles gamma exposure aggregation across all expirations
    """
    
    def __init__(self):
        self.contracts: List[OptionContract] = []
        self.last_analysis: Optional[AggregatedGEX] = None
    
    def update_contracts(self, contracts: List[OptionContract]):
        """Update the contract universe"""
        self.contracts = contracts
    
    def add_contract(self, contract: OptionContract):
        """Add a single contract"""
        self.contracts.append(contract)
    
    def analyze(self, spot: float) -> AggregatedGEX:
        """Run full GEX analysis"""
        self.last_analysis = aggregate_gex(self.contracts, spot)
        return self.last_analysis
    
    def get_key_levels(self, spot: float) -> Dict[str, float]:
        """Get key levels for trading"""
        if not self.last_analysis or abs(self.last_analysis.spot - spot) > 5:
            self.analyze(spot)
        
        analysis = self.last_analysis
        
        return {
            'gamma_flip': analysis.gamma_flip,
            'max_pain': analysis.max_pain,
            'call_wall_1': analysis.call_walls[0].strike if analysis.call_walls else spot + 20,
            'call_wall_2': analysis.call_walls[1].strike if len(analysis.call_walls) > 1 else spot + 30,
            'put_wall_1': analysis.put_walls[0].strike if analysis.put_walls else spot - 20,
            'put_wall_2': analysis.put_walls[1].strike if len(analysis.put_walls) > 1 else spot - 30,
        }
    
    def get_regime_info(self, spot: float) -> Dict:
        """Get regime information"""
        if not self.last_analysis or abs(self.last_analysis.spot - spot) > 5:
            self.analyze(spot)
        
        analysis = self.last_analysis
        
        return {
            'regime': analysis.regime,
            'blended_gex': analysis.blended_gex,
            'zero_dte_dominant': analysis.zero_dte_dominant,
            'dist_to_flip': spot - analysis.gamma_flip,
            'in_positive': analysis.blended_gex > 0,
        }
    
    def reset(self):
        """Clear all data"""
        self.contracts = []
        self.last_analysis = None


# ═══════════════════════════════════════════════════════════════════════════════
# EXPORTS
# ═══════════════════════════════════════════════════════════════════════════════

__all__ = [
    'GEXConfig', 'CONFIG',
    'OptionContract', 'ExpiryGEX', 'GammaWall', 'AggregatedGEX',
    'GEXEngine',
    'analyze_expiry', 'aggregate_gex',
    'calc_gamma_flip', 'calc_max_pain', 'detect_walls'
]
