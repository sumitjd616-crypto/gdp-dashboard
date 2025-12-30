"""
TITAN VOLATILITY SURFACE MODULE
===============================
Volatility regime detection and term structure analysis

Features:
- VIX term structure analysis (VIX9D/VIX/VIX3M/VIX6M)
- VVIX (vol of vol) regime detection
- IV skew analysis (put/call)
- Realized vs Implied volatility divergence
- Vol crush/expansion detection
- Volatility regime classification
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from enum import Enum
import numpy as np


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class VolConfig:
    """Volatility analysis configuration"""
    # VIX thresholds
    VIX_LOW: float = 12.0
    VIX_NORMAL: float = 18.0
    VIX_ELEVATED: float = 25.0
    VIX_HIGH: float = 35.0
    VIX_EXTREME: float = 50.0
    
    # VVIX thresholds
    VVIX_LOW: float = 80.0
    VVIX_NORMAL: float = 100.0
    VVIX_ELEVATED: float = 120.0
    VVIX_HIGH: float = 140.0
    
    # Term structure
    CONTANGO_THRESHOLD: float = 1.05    # VIX3M/VIX > 1.05
    BACKWARDATION_THRESHOLD: float = 0.95
    STEEP_CONTANGO: float = 1.15
    STEEP_BACKWARDATION: float = 0.85
    
    # Short-term ratio (VIX9D/VIX)
    NEAR_TERM_FEAR: float = 1.10        # VIX9D > VIX by 10%
    NEAR_TERM_COMPLACENCY: float = 0.90
    
    # Skew
    SKEW_NORMAL: float = 3.0            # Put IV - Call IV
    SKEW_FEAR: float = 8.0
    SKEW_COMPLACENCY: float = -1.0
    
    # RV vs IV
    RV_IV_CRUSH: float = 0.7            # RV/IV < 0.7 = crush coming
    RV_IV_EXPANSION: float = 1.3        # RV/IV > 1.3 = IV catch up


CONFIG = VolConfig()


# ═══════════════════════════════════════════════════════════════════════════════
# ENUMS
# ═══════════════════════════════════════════════════════════════════════════════

class VolRegime(Enum):
    LOW = "LOW"                     # VIX < 12 - Complacent
    NORMAL = "NORMAL"               # VIX 12-18
    ELEVATED = "ELEVATED"           # VIX 18-25
    HIGH = "HIGH"                   # VIX 25-35
    EXTREME = "EXTREME"             # VIX > 35
    CRISIS = "CRISIS"               # VIX > 50


class TermStructure(Enum):
    STEEP_CONTANGO = "STEEP_CONTANGO"       # Strong bullish
    CONTANGO = "CONTANGO"                   # Normal/bullish
    FLAT = "FLAT"                           # Uncertain
    BACKWARDATION = "BACKWARDATION"         # Fear/bearish
    STEEP_BACKWARDATION = "STEEP_BACKWARDATION"  # Extreme fear


class VolExpectation(Enum):
    CRUSH_IMMINENT = "CRUSH_IMMINENT"       # IV will drop
    CRUSH_LIKELY = "CRUSH_LIKELY"
    STABLE = "STABLE"
    EXPANSION_LIKELY = "EXPANSION_LIKELY"
    EXPANSION_IMMINENT = "EXPANSION_IMMINENT"  # IV will spike


class SkewRegime(Enum):
    EXTREME_FEAR = "EXTREME_FEAR"           # Puts way more expensive
    FEAR = "FEAR"                           # Puts expensive
    NORMAL = "NORMAL"                       # Balanced
    COMPLACENT = "COMPLACENT"               # Calls expensive
    EUPHORIA = "EUPHORIA"                   # Calls way more expensive


# ═══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class VIXData:
    """VIX family data"""
    timestamp: datetime
    
    # Core VIX values
    vix: float                      # 30-day VIX
    vix9d: Optional[float] = None   # 9-day VIX
    vix3m: Optional[float] = None   # 3-month VIX
    vix6m: Optional[float] = None   # 6-month VIX
    vvix: Optional[float] = None    # Vol of Vol
    
    # Changes
    vix_change: float = 0.0         # 1-day change
    vix_change_5d: float = 0.0      # 5-day change


@dataclass
class SkewData:
    """IV skew data"""
    timestamp: datetime
    spot: float
    expiry: str
    
    # ATM IV
    atm_call_iv: float
    atm_put_iv: float
    
    # 25-delta IV (if available)
    d25_call_iv: Optional[float] = None
    d25_put_iv: Optional[float] = None
    
    # Skew metrics
    @property
    def atm_skew(self) -> float:
        """Put IV - Call IV at ATM"""
        return self.atm_put_iv - self.atm_call_iv
    
    @property
    def risk_reversal(self) -> Optional[float]:
        """25-delta risk reversal"""
        if self.d25_call_iv and self.d25_put_iv:
            return self.d25_put_iv - self.d25_call_iv
        return None


@dataclass
class RealizedVol:
    """Realized volatility data"""
    timestamp: datetime
    
    # Different windows
    rv_5d: float                    # 5-day realized
    rv_10d: float                   # 10-day realized
    rv_20d: float                   # 20-day realized
    rv_60d: Optional[float] = None  # 60-day realized
    
    # Annualized
    @property
    def rv_5d_ann(self) -> float:
        return self.rv_5d * np.sqrt(252)
    
    @property
    def rv_20d_ann(self) -> float:
        return self.rv_20d * np.sqrt(252)


@dataclass
class TermStructureAnalysis:
    """VIX term structure analysis"""
    structure: TermStructure
    
    # Ratios
    near_term_ratio: Optional[float]    # VIX9D / VIX
    term_ratio: float                   # VIX3M / VIX (or approximation)
    long_term_ratio: Optional[float]    # VIX6M / VIX
    
    # Interpretation
    near_term_fear: bool                # Short-term spike
    roll_yield: str                     # POSITIVE, NEGATIVE, FLAT
    
    # Signal
    signal: str                         # RISK_ON, RISK_OFF, NEUTRAL


@dataclass
class VolatilityAnalysis:
    """Complete volatility analysis"""
    timestamp: datetime
    
    # Current state
    vix: float
    regime: VolRegime
    
    # Term structure
    term_structure: TermStructureAnalysis
    
    # Skew
    skew_regime: SkewRegime
    atm_skew: float
    
    # RV vs IV
    rv_iv_ratio: float
    vol_expectation: VolExpectation
    
    # VVIX
    vvix: Optional[float]
    vvix_regime: str                    # LOW, NORMAL, ELEVATED, HIGH
    
    # Actionable
    options_bias: str                   # BUY_VOL, SELL_VOL, NEUTRAL
    strategy_adjustment: float          # Position size multiplier
    
    # Warnings
    warnings: List[str]


# ═══════════════════════════════════════════════════════════════════════════════
# CORE ANALYSIS FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def classify_vix_regime(vix: float) -> VolRegime:
    """Classify VIX into regime"""
    if vix < CONFIG.VIX_LOW:
        return VolRegime.LOW
    elif vix < CONFIG.VIX_NORMAL:
        return VolRegime.NORMAL
    elif vix < CONFIG.VIX_ELEVATED:
        return VolRegime.ELEVATED
    elif vix < CONFIG.VIX_HIGH:
        return VolRegime.HIGH
    elif vix < CONFIG.VIX_EXTREME:
        return VolRegime.EXTREME
    else:
        return VolRegime.CRISIS


def analyze_term_structure(vix_data: VIXData) -> TermStructureAnalysis:
    """Analyze VIX term structure"""
    vix = vix_data.vix
    
    # Calculate ratios
    near_term_ratio = vix_data.vix9d / vix if vix_data.vix9d else None
    
    # Use VIX3M if available, otherwise estimate
    if vix_data.vix3m:
        term_ratio = vix_data.vix3m / vix
    else:
        # Estimate based on typical structure
        term_ratio = 1.05 if vix < 20 else 0.95
    
    long_term_ratio = vix_data.vix6m / vix if vix_data.vix6m else None
    
    # Classify structure
    if term_ratio >= CONFIG.STEEP_CONTANGO:
        structure = TermStructure.STEEP_CONTANGO
    elif term_ratio >= CONFIG.CONTANGO_THRESHOLD:
        structure = TermStructure.CONTANGO
    elif term_ratio <= CONFIG.STEEP_BACKWARDATION:
        structure = TermStructure.STEEP_BACKWARDATION
    elif term_ratio <= CONFIG.BACKWARDATION_THRESHOLD:
        structure = TermStructure.BACKWARDATION
    else:
        structure = TermStructure.FLAT
    
    # Near-term fear check
    near_term_fear = near_term_ratio is not None and near_term_ratio > CONFIG.NEAR_TERM_FEAR
    
    # Roll yield
    if term_ratio > 1.03:
        roll_yield = "POSITIVE"  # Long VIX futures lose to roll
    elif term_ratio < 0.97:
        roll_yield = "NEGATIVE"  # Short VIX futures lose to roll
    else:
        roll_yield = "FLAT"
    
    # Signal
    if structure in (TermStructure.BACKWARDATION, TermStructure.STEEP_BACKWARDATION):
        signal = "RISK_OFF"
    elif structure == TermStructure.STEEP_CONTANGO:
        signal = "RISK_ON"
    elif near_term_fear:
        signal = "RISK_OFF"
    else:
        signal = "NEUTRAL"
    
    return TermStructureAnalysis(
        structure=structure,
        near_term_ratio=near_term_ratio,
        term_ratio=term_ratio,
        long_term_ratio=long_term_ratio,
        near_term_fear=near_term_fear,
        roll_yield=roll_yield,
        signal=signal
    )


def classify_skew(skew: float) -> SkewRegime:
    """Classify IV skew regime"""
    if skew > CONFIG.SKEW_FEAR * 1.5:
        return SkewRegime.EXTREME_FEAR
    elif skew > CONFIG.SKEW_FEAR:
        return SkewRegime.FEAR
    elif skew < CONFIG.SKEW_COMPLACENCY - 2:
        return SkewRegime.EUPHORIA
    elif skew < CONFIG.SKEW_COMPLACENCY:
        return SkewRegime.COMPLACENT
    else:
        return SkewRegime.NORMAL


def analyze_rv_iv(rv: float, iv: float) -> Tuple[float, VolExpectation]:
    """
    Compare realized vol to implied vol
    
    Returns (ratio, expectation)
    """
    if iv == 0:
        return 1.0, VolExpectation.STABLE
    
    ratio = rv / iv
    
    if ratio < CONFIG.RV_IV_CRUSH * 0.8:
        expectation = VolExpectation.CRUSH_IMMINENT
    elif ratio < CONFIG.RV_IV_CRUSH:
        expectation = VolExpectation.CRUSH_LIKELY
    elif ratio > CONFIG.RV_IV_EXPANSION * 1.2:
        expectation = VolExpectation.EXPANSION_IMMINENT
    elif ratio > CONFIG.RV_IV_EXPANSION:
        expectation = VolExpectation.EXPANSION_LIKELY
    else:
        expectation = VolExpectation.STABLE
    
    return ratio, expectation


def classify_vvix(vvix: float) -> str:
    """Classify VVIX regime"""
    if vvix < CONFIG.VVIX_LOW:
        return "LOW"
    elif vvix < CONFIG.VVIX_NORMAL:
        return "NORMAL"
    elif vvix < CONFIG.VVIX_ELEVATED:
        return "ELEVATED"
    else:
        return "HIGH"


def calc_realized_vol(closes: List[float], window: int = 20) -> float:
    """Calculate realized volatility from closing prices"""
    if len(closes) < window + 1:
        return 0.0
    
    recent = closes[-(window + 1):]
    returns = []
    
    for i in range(1, len(recent)):
        ret = np.log(recent[i] / recent[i-1])
        returns.append(ret)
    
    return np.std(returns) * np.sqrt(252)


# ═══════════════════════════════════════════════════════════════════════════════
# VOLATILITY ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class VolatilityEngine:
    """
    Volatility Surface Analysis Engine
    
    Monitors and analyzes volatility regime for trading decisions
    """
    
    def __init__(self):
        self.vix_history: List[VIXData] = []
        self.skew_history: List[SkewData] = []
        self.closes: List[float] = []
        self.max_history = 500
    
    def update_vix(self, vix_data: VIXData):
        """Update VIX data"""
        self.vix_history.append(vix_data)
        if len(self.vix_history) > self.max_history:
            self.vix_history.pop(0)
    
    def update_skew(self, skew_data: SkewData):
        """Update skew data"""
        self.skew_history.append(skew_data)
        if len(self.skew_history) > self.max_history:
            self.skew_history.pop(0)
    
    def add_close(self, close: float):
        """Add closing price for RV calculation"""
        self.closes.append(close)
        if len(self.closes) > self.max_history:
            self.closes.pop(0)
    
    def analyze(
        self,
        vix: float,
        vix9d: Optional[float] = None,
        vix3m: Optional[float] = None,
        vvix: Optional[float] = None,
        atm_call_iv: Optional[float] = None,
        atm_put_iv: Optional[float] = None
    ) -> VolatilityAnalysis:
        """
        Run complete volatility analysis
        """
        now = datetime.now()
        warnings = []
        
        # Create VIX data
        vix_data = VIXData(
            timestamp=now,
            vix=vix,
            vix9d=vix9d,
            vix3m=vix3m,
            vvix=vvix
        )
        
        # 1. VIX Regime
        regime = classify_vix_regime(vix)
        
        if regime in (VolRegime.EXTREME, VolRegime.CRISIS):
            warnings.append(f"🔴 EXTREME VOL: VIX at {vix:.1f}")
        elif regime == VolRegime.LOW:
            warnings.append("⚠️ LOW VOL: Complacency risk")
        
        # 2. Term Structure
        term_analysis = analyze_term_structure(vix_data)
        
        if term_analysis.structure == TermStructure.STEEP_BACKWARDATION:
            warnings.append("🔴 STEEP BACKWARDATION: Crisis signal")
        elif term_analysis.near_term_fear:
            warnings.append("⚠️ NEAR-TERM FEAR: VIX9D elevated")
        
        # 3. Skew
        if atm_call_iv and atm_put_iv:
            atm_skew = atm_put_iv - atm_call_iv
            skew_regime = classify_skew(atm_skew)
        else:
            atm_skew = 3.0  # Default normal
            skew_regime = SkewRegime.NORMAL
        
        if skew_regime == SkewRegime.EXTREME_FEAR:
            warnings.append("🔴 EXTREME SKEW: Put buyers aggressive")
        elif skew_regime == SkewRegime.EUPHORIA:
            warnings.append("⚠️ EUPHORIC SKEW: Call buyers aggressive")
        
        # 4. RV vs IV
        rv_20d = calc_realized_vol(self.closes, 20) if len(self.closes) > 21 else vix * 0.01
        rv_iv_ratio, vol_expectation = analyze_rv_iv(rv_20d, vix)
        
        if vol_expectation == VolExpectation.CRUSH_IMMINENT:
            warnings.append("📉 IV CRUSH IMMINENT: RV << IV")
        elif vol_expectation == VolExpectation.EXPANSION_IMMINENT:
            warnings.append("📈 VOL EXPANSION IMMINENT: RV >> IV")
        
        # 5. VVIX
        vvix_regime = classify_vvix(vvix) if vvix else "UNKNOWN"
        
        if vvix and vvix > CONFIG.VVIX_HIGH:
            warnings.append(f"🌪️ HIGH VVIX ({vvix:.0f}): Vol of vol elevated")
        
        # 6. Options Bias
        if vol_expectation in (VolExpectation.CRUSH_IMMINENT, VolExpectation.CRUSH_LIKELY):
            options_bias = "SELL_VOL"
        elif vol_expectation in (VolExpectation.EXPANSION_IMMINENT, VolExpectation.EXPANSION_LIKELY):
            options_bias = "BUY_VOL"
        elif regime == VolRegime.LOW and term_analysis.structure == TermStructure.STEEP_CONTANGO:
            options_bias = "BUY_VOL"  # Vol too cheap
        elif regime in (VolRegime.HIGH, VolRegime.EXTREME) and term_analysis.structure == TermStructure.BACKWARDATION:
            options_bias = "SELL_VOL"  # Vol too expensive
        else:
            options_bias = "NEUTRAL"
        
        # 7. Strategy Adjustment
        # Base multiplier from regime
        regime_mult = {
            VolRegime.LOW: 1.2,       # Increase size in low vol
            VolRegime.NORMAL: 1.0,
            VolRegime.ELEVATED: 0.8,
            VolRegime.HIGH: 0.6,
            VolRegime.EXTREME: 0.4,
            VolRegime.CRISIS: 0.2
        }
        
        strategy_adjustment = regime_mult.get(regime, 1.0)
        
        # Adjust for term structure
        if term_analysis.signal == "RISK_OFF":
            strategy_adjustment *= 0.8
        
        # Adjust for VVIX
        if vvix and vvix > CONFIG.VVIX_ELEVATED:
            strategy_adjustment *= 0.9
        
        return VolatilityAnalysis(
            timestamp=now,
            vix=vix,
            regime=regime,
            term_structure=term_analysis,
            skew_regime=skew_regime,
            atm_skew=atm_skew,
            rv_iv_ratio=rv_iv_ratio,
            vol_expectation=vol_expectation,
            vvix=vvix,
            vvix_regime=vvix_regime,
            options_bias=options_bias,
            strategy_adjustment=strategy_adjustment,
            warnings=warnings
        )
    
    def get_regime_summary(self, vix: float) -> Dict:
        """Quick regime summary"""
        regime = classify_vix_regime(vix)
        
        return {
            'vix': vix,
            'regime': regime.value,
            'is_low_vol': regime == VolRegime.LOW,
            'is_high_vol': regime in (VolRegime.HIGH, VolRegime.EXTREME, VolRegime.CRISIS),
            'size_mult': {
                VolRegime.LOW: 1.2,
                VolRegime.NORMAL: 1.0,
                VolRegime.ELEVATED: 0.8,
                VolRegime.HIGH: 0.6,
                VolRegime.EXTREME: 0.4,
                VolRegime.CRISIS: 0.2
            }.get(regime, 1.0)
        }
    
    def reset(self):
        """Clear all data"""
        self.vix_history = []
        self.skew_history = []
        self.closes = []


# ═══════════════════════════════════════════════════════════════════════════════
# EXPORTS
# ═══════════════════════════════════════════════════════════════════════════════

__all__ = [
    'VolConfig', 'CONFIG',
    'VolRegime', 'TermStructure', 'VolExpectation', 'SkewRegime',
    'VIXData', 'SkewData', 'RealizedVol', 
    'TermStructureAnalysis', 'VolatilityAnalysis',
    'VolatilityEngine',
    'classify_vix_regime', 'analyze_term_structure', 
    'classify_skew', 'analyze_rv_iv', 'calc_realized_vol'
]
