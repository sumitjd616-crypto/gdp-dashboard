"""
TITAN INTERMARKET DIVERGENCE MODULE
===================================
Cross-asset correlation and divergence detection

Features:
- SPX vs ES futures correlation
- DXY (Dollar) divergence detection
- TLT (Bonds) flight-to-safety signals
- Sector rotation analysis
- Risk-on/Risk-off regime detection
- Multi-asset confirmation scoring
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from enum import Enum
import numpy as np
from collections import deque


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class IntermarketConfig:
    """Intermarket analysis configuration"""
    # Correlation windows
    CORR_WINDOW_SHORT: int = 20         # 20 bars
    CORR_WINDOW_LONG: int = 100         # 100 bars
    
    # Divergence thresholds
    DIVERGE_THRESHOLD: float = 0.3      # 30% move difference
    STRONG_DIVERGE: float = 0.5         # 50% difference
    
    # Direction thresholds (% change)
    UP_THRESHOLD: float = 0.001         # 0.1%
    DOWN_THRESHOLD: float = -0.001
    STRONG_MOVE: float = 0.003          # 0.3%
    
    # Bond/Equity relationship
    FLIGHT_TO_SAFETY_TLT: float = 0.003  # TLT up 0.3% while SPX down
    
    # Dollar relationship
    DXY_DIVERGE: float = 0.002          # 0.2% opposite move
    
    # Lookback for regime
    REGIME_LOOKBACK: int = 50


CONFIG = IntermarketConfig()


# ═══════════════════════════════════════════════════════════════════════════════
# ENUMS
# ═══════════════════════════════════════════════════════════════════════════════

class RiskRegime(Enum):
    RISK_ON = "RISK_ON"                 # Bullish across assets
    RISK_OFF = "RISK_OFF"               # Flight to safety
    MIXED = "MIXED"                     # No clear direction
    ROTATION = "ROTATION"               # Sector rotation
    DIVERGENCE = "DIVERGENCE"           # Unusual divergence


class AssetDirection(Enum):
    UP = "UP"
    DOWN = "DOWN"
    FLAT = "FLAT"


class CorrelationState(Enum):
    STRONG_POSITIVE = "STRONG_POSITIVE"     # > 0.7
    POSITIVE = "POSITIVE"                    # 0.3 to 0.7
    NEUTRAL = "NEUTRAL"                      # -0.3 to 0.3
    NEGATIVE = "NEGATIVE"                    # -0.7 to -0.3
    STRONG_NEGATIVE = "STRONG_NEGATIVE"     # < -0.7


class DivergenceType(Enum):
    NONE = "NONE"
    BULLISH = "BULLISH"                 # Hidden bullish divergence
    BEARISH = "BEARISH"                 # Hidden bearish divergence
    CONFIRMATION = "CONFIRMATION"       # Assets confirming


# ═══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class AssetData:
    """Single asset data point"""
    symbol: str
    timestamp: int
    price: float
    change: float               # % change from previous
    change_5: float = 0.0       # 5-period change
    volume: float = 0.0


@dataclass
class CorrelationPair:
    """Correlation between two assets"""
    asset1: str
    asset2: str
    correlation: float
    correlation_state: CorrelationState
    lookback: int
    
    # Change detection
    corr_change: float          # Change from previous
    breaking_down: bool         # Correlation weakening


@dataclass
class DivergenceSignal:
    """Divergence detection result"""
    asset1: str
    asset2: str
    divergence_type: DivergenceType
    
    # Details
    asset1_direction: AssetDirection
    asset2_direction: AssetDirection
    asset1_change: float
    asset2_change: float
    
    # Strength
    strength: float             # 0-100
    
    # Interpretation
    signal: str                 # Trading implication
    confidence: float


@dataclass
class RiskRegimeAnalysis:
    """Overall risk regime analysis"""
    timestamp: datetime
    regime: RiskRegime
    confidence: float           # 0-100
    
    # Asset states
    spx_direction: AssetDirection
    es_direction: AssetDirection
    dxy_direction: AssetDirection
    tlt_direction: AssetDirection
    vix_direction: AssetDirection
    
    # Key signals
    es_divergence: Optional[DivergenceSignal]
    dxy_divergence: Optional[DivergenceSignal]
    tlt_signal: str             # FLIGHT_TO_SAFETY, RISK_ON, NEUTRAL
    
    # Correlations
    spx_es_corr: float
    spx_dxy_corr: float
    spx_tlt_corr: float
    
    # Actionable
    trade_bias: str             # LONG, SHORT, NEUTRAL
    size_adjustment: float      # Multiplier for position size
    warnings: List[str]


@dataclass
class SectorRotation:
    """Sector rotation analysis"""
    timestamp: datetime
    
    # Relative strength
    tech_rs: float              # XLK relative strength
    financials_rs: float        # XLF
    energy_rs: float            # XLE
    utilities_rs: float         # XLU
    
    # Rotation direction
    into_defensives: bool       # Money moving to utilities, staples
    into_cyclicals: bool        # Money moving to tech, discretionary
    
    # Signal
    rotation_signal: str


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def calc_direction(change: float) -> AssetDirection:
    """Determine direction from % change"""
    if change > CONFIG.UP_THRESHOLD:
        return AssetDirection.UP
    elif change < CONFIG.DOWN_THRESHOLD:
        return AssetDirection.DOWN
    else:
        return AssetDirection.FLAT


def calc_correlation(series1: List[float], series2: List[float]) -> float:
    """Calculate Pearson correlation"""
    if len(series1) < 5 or len(series2) < 5:
        return 0.0
    
    n = min(len(series1), len(series2))
    s1 = np.array(series1[-n:])
    s2 = np.array(series2[-n:])
    
    # Returns
    r1 = np.diff(s1) / s1[:-1]
    r2 = np.diff(s2) / s2[:-1]
    
    if len(r1) < 3:
        return 0.0
    
    corr = np.corrcoef(r1, r2)[0, 1]
    return corr if not np.isnan(corr) else 0.0


def classify_correlation(corr: float) -> CorrelationState:
    """Classify correlation strength"""
    if corr > 0.7:
        return CorrelationState.STRONG_POSITIVE
    elif corr > 0.3:
        return CorrelationState.POSITIVE
    elif corr > -0.3:
        return CorrelationState.NEUTRAL
    elif corr > -0.7:
        return CorrelationState.NEGATIVE
    else:
        return CorrelationState.STRONG_NEGATIVE


def detect_divergence(
    asset1_change: float,
    asset2_change: float,
    expected_relationship: str = "POSITIVE"  # or "NEGATIVE"
) -> DivergenceSignal:
    """
    Detect divergence between two assets
    
    Args:
        expected_relationship: POSITIVE means they should move together,
                             NEGATIVE means they should move opposite
    """
    dir1 = calc_direction(asset1_change)
    dir2 = calc_direction(asset2_change)
    
    # Determine if diverging
    if expected_relationship == "POSITIVE":
        # Should move together
        if dir1 == AssetDirection.UP and dir2 == AssetDirection.DOWN:
            div_type = DivergenceType.BEARISH
            signal = "Asset2 not confirming - bearish"
        elif dir1 == AssetDirection.DOWN and dir2 == AssetDirection.UP:
            div_type = DivergenceType.BULLISH
            signal = "Asset2 not confirming - potential reversal"
        elif dir1 == dir2:
            div_type = DivergenceType.CONFIRMATION
            signal = "Assets confirming"
        else:
            div_type = DivergenceType.NONE
            signal = "No clear signal"
    else:
        # Should move opposite (e.g., SPX vs TLT)
        if dir1 == AssetDirection.UP and dir2 == AssetDirection.UP:
            div_type = DivergenceType.BEARISH
            signal = "Both up - unusual, bearish divergence"
        elif dir1 == AssetDirection.DOWN and dir2 == AssetDirection.DOWN:
            div_type = DivergenceType.BULLISH
            signal = "Both down - unusual, bullish divergence"
        elif (dir1 == AssetDirection.UP and dir2 == AssetDirection.DOWN) or \
             (dir1 == AssetDirection.DOWN and dir2 == AssetDirection.UP):
            div_type = DivergenceType.CONFIRMATION
            signal = "Normal inverse relationship"
        else:
            div_type = DivergenceType.NONE
            signal = "No clear signal"
    
    # Calculate strength
    strength = min(100, abs(asset1_change - asset2_change) / CONFIG.STRONG_DIVERGE * 100)
    
    # Confidence based on move magnitude
    move_size = max(abs(asset1_change), abs(asset2_change))
    confidence = min(100, move_size / CONFIG.STRONG_MOVE * 50 + strength * 0.5)
    
    return DivergenceSignal(
        asset1="asset1",
        asset2="asset2",
        divergence_type=div_type,
        asset1_direction=dir1,
        asset2_direction=dir2,
        asset1_change=asset1_change,
        asset2_change=asset2_change,
        strength=strength,
        signal=signal,
        confidence=confidence
    )


# ═══════════════════════════════════════════════════════════════════════════════
# INTERMARKET ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class IntermarketEngine:
    """
    Intermarket Divergence Analysis Engine
    
    Monitors cross-asset correlations and divergences for trading signals
    """
    
    def __init__(self):
        # Price histories
        self.spx_prices: deque = deque(maxlen=CONFIG.CORR_WINDOW_LONG)
        self.es_prices: deque = deque(maxlen=CONFIG.CORR_WINDOW_LONG)
        self.dxy_prices: deque = deque(maxlen=CONFIG.CORR_WINDOW_LONG)
        self.tlt_prices: deque = deque(maxlen=CONFIG.CORR_WINDOW_LONG)
        self.vix_prices: deque = deque(maxlen=CONFIG.CORR_WINDOW_LONG)
        
        # Latest data
        self.latest: Dict[str, AssetData] = {}
        
        # Previous correlations
        self.prev_spx_es_corr: float = 0.95
        self.prev_spx_dxy_corr: float = -0.3
        self.prev_spx_tlt_corr: float = -0.4
    
    def update(
        self,
        spx: Optional[float] = None,
        es: Optional[float] = None,
        dxy: Optional[float] = None,
        tlt: Optional[float] = None,
        vix: Optional[float] = None,
        timestamp: Optional[int] = None
    ):
        """Update price data"""
        ts = timestamp or int(datetime.now().timestamp() * 1000)
        
        if spx is not None:
            prev = self.spx_prices[-1] if self.spx_prices else spx
            change = (spx - prev) / prev if prev else 0
            self.spx_prices.append(spx)
            self.latest['SPX'] = AssetData('SPX', ts, spx, change)
        
        if es is not None:
            prev = self.es_prices[-1] if self.es_prices else es
            change = (es - prev) / prev if prev else 0
            self.es_prices.append(es)
            self.latest['ES'] = AssetData('ES', ts, es, change)
        
        if dxy is not None:
            prev = self.dxy_prices[-1] if self.dxy_prices else dxy
            change = (dxy - prev) / prev if prev else 0
            self.dxy_prices.append(dxy)
            self.latest['DXY'] = AssetData('DXY', ts, dxy, change)
        
        if tlt is not None:
            prev = self.tlt_prices[-1] if self.tlt_prices else tlt
            change = (tlt - prev) / prev if prev else 0
            self.tlt_prices.append(tlt)
            self.latest['TLT'] = AssetData('TLT', ts, tlt, change)
        
        if vix is not None:
            prev = self.vix_prices[-1] if self.vix_prices else vix
            change = (vix - prev) / prev if prev else 0
            self.vix_prices.append(vix)
            self.latest['VIX'] = AssetData('VIX', ts, vix, change)
    
    def analyze(self) -> RiskRegimeAnalysis:
        """
        Run complete intermarket analysis
        """
        now = datetime.now()
        warnings = []
        
        # Get latest data
        spx_data = self.latest.get('SPX')
        es_data = self.latest.get('ES')
        dxy_data = self.latest.get('DXY')
        tlt_data = self.latest.get('TLT')
        vix_data = self.latest.get('VIX')
        
        # Directions
        spx_dir = calc_direction(spx_data.change) if spx_data else AssetDirection.FLAT
        es_dir = calc_direction(es_data.change) if es_data else AssetDirection.FLAT
        dxy_dir = calc_direction(dxy_data.change) if dxy_data else AssetDirection.FLAT
        tlt_dir = calc_direction(tlt_data.change) if tlt_data else AssetDirection.FLAT
        vix_dir = calc_direction(vix_data.change) if vix_data else AssetDirection.FLAT
        
        # Calculate correlations
        spx_list = list(self.spx_prices)
        es_list = list(self.es_prices)
        dxy_list = list(self.dxy_prices)
        tlt_list = list(self.tlt_prices)
        
        spx_es_corr = calc_correlation(spx_list, es_list) if es_list else 0.95
        spx_dxy_corr = calc_correlation(spx_list, dxy_list) if dxy_list else -0.3
        spx_tlt_corr = calc_correlation(spx_list, tlt_list) if tlt_list else -0.4
        
        # ES Divergence
        es_divergence = None
        if spx_data and es_data:
            es_divergence = detect_divergence(
                spx_data.change, es_data.change, "POSITIVE"
            )
            es_divergence.asset1 = "SPX"
            es_divergence.asset2 = "ES"
            
            if es_divergence.divergence_type in (DivergenceType.BULLISH, DivergenceType.BEARISH):
                warnings.append(f"⚠️ SPX/ES DIVERGENCE: {es_divergence.signal}")
        
        # DXY Divergence
        dxy_divergence = None
        if spx_data and dxy_data:
            # SPX and DXY often move inversely
            dxy_divergence = detect_divergence(
                spx_data.change, dxy_data.change, "NEGATIVE"
            )
            dxy_divergence.asset1 = "SPX"
            dxy_divergence.asset2 = "DXY"
            
            # Strong dollar + strong SPX = unusual
            if spx_dir == AssetDirection.UP and dxy_dir == AssetDirection.UP:
                warnings.append("⚠️ SPX + DXY both up - watch for reversal")
        
        # TLT Flight to Safety
        tlt_signal = "NEUTRAL"
        if spx_data and tlt_data:
            if spx_dir == AssetDirection.DOWN and tlt_dir == AssetDirection.UP:
                if tlt_data.change > CONFIG.FLIGHT_TO_SAFETY_TLT:
                    tlt_signal = "FLIGHT_TO_SAFETY"
                    warnings.append("🔴 FLIGHT TO SAFETY: TLT bid, SPX offered")
            elif spx_dir == AssetDirection.UP and tlt_dir == AssetDirection.DOWN:
                tlt_signal = "RISK_ON"
        
        # VIX confirmation
        if vix_data and spx_data:
            if spx_dir == AssetDirection.DOWN and vix_dir == AssetDirection.DOWN:
                warnings.append("⚠️ SPX down but VIX down - divergence")
            elif spx_dir == AssetDirection.UP and vix_dir == AssetDirection.UP:
                warnings.append("⚠️ SPX up but VIX up - divergence")
        
        # Correlation breakdown check
        if abs(spx_es_corr - self.prev_spx_es_corr) > 0.2:
            warnings.append("⚠️ SPX/ES correlation breaking down")
        
        # Determine regime
        regime, confidence = self._determine_regime(
            spx_dir, es_dir, dxy_dir, tlt_dir, vix_dir,
            tlt_signal, es_divergence
        )
        
        # Trade bias
        trade_bias, size_adj = self._calc_trade_bias(
            regime, spx_dir, es_divergence, tlt_signal, confidence
        )
        
        # Update prev correlations
        self.prev_spx_es_corr = spx_es_corr
        self.prev_spx_dxy_corr = spx_dxy_corr
        self.prev_spx_tlt_corr = spx_tlt_corr
        
        return RiskRegimeAnalysis(
            timestamp=now,
            regime=regime,
            confidence=confidence,
            spx_direction=spx_dir,
            es_direction=es_dir,
            dxy_direction=dxy_dir,
            tlt_direction=tlt_dir,
            vix_direction=vix_dir,
            es_divergence=es_divergence,
            dxy_divergence=dxy_divergence,
            tlt_signal=tlt_signal,
            spx_es_corr=spx_es_corr,
            spx_dxy_corr=spx_dxy_corr,
            spx_tlt_corr=spx_tlt_corr,
            trade_bias=trade_bias,
            size_adjustment=size_adj,
            warnings=warnings
        )
    
    def _determine_regime(
        self,
        spx_dir: AssetDirection,
        es_dir: AssetDirection,
        dxy_dir: AssetDirection,
        tlt_dir: AssetDirection,
        vix_dir: AssetDirection,
        tlt_signal: str,
        es_divergence: Optional[DivergenceSignal]
    ) -> Tuple[RiskRegime, float]:
        """Determine overall risk regime"""
        
        # Risk-off signals
        risk_off_score = 0
        if tlt_signal == "FLIGHT_TO_SAFETY":
            risk_off_score += 30
        if vix_dir == AssetDirection.UP:
            risk_off_score += 20
        if spx_dir == AssetDirection.DOWN and es_dir == AssetDirection.DOWN:
            risk_off_score += 25
        if dxy_dir == AssetDirection.UP and spx_dir == AssetDirection.DOWN:
            risk_off_score += 15
        
        # Risk-on signals
        risk_on_score = 0
        if spx_dir == AssetDirection.UP and es_dir == AssetDirection.UP:
            risk_on_score += 30
        if vix_dir == AssetDirection.DOWN:
            risk_on_score += 20
        if tlt_dir == AssetDirection.DOWN and spx_dir == AssetDirection.UP:
            risk_on_score += 20
        
        # Divergence signals
        divergence_score = 0
        if es_divergence and es_divergence.divergence_type != DivergenceType.CONFIRMATION:
            divergence_score = es_divergence.strength
        
        # Determine regime
        if divergence_score > 50:
            return RiskRegime.DIVERGENCE, divergence_score
        elif risk_off_score > 60:
            return RiskRegime.RISK_OFF, risk_off_score
        elif risk_on_score > 60:
            return RiskRegime.RISK_ON, risk_on_score
        elif abs(risk_on_score - risk_off_score) < 20:
            return RiskRegime.MIXED, 50
        else:
            return RiskRegime.MIXED, max(risk_on_score, risk_off_score)
    
    def _calc_trade_bias(
        self,
        regime: RiskRegime,
        spx_dir: AssetDirection,
        es_divergence: Optional[DivergenceSignal],
        tlt_signal: str,
        confidence: float
    ) -> Tuple[str, float]:
        """Calculate trade bias and size adjustment"""
        
        if regime == RiskRegime.RISK_ON:
            bias = "LONG"
            size_adj = 1.0 + (confidence - 50) / 100
        elif regime == RiskRegime.RISK_OFF:
            bias = "SHORT"
            size_adj = 1.0 + (confidence - 50) / 100
        elif regime == RiskRegime.DIVERGENCE:
            # Reduce size during divergence
            bias = "NEUTRAL"
            size_adj = 0.5
        else:
            bias = "NEUTRAL"
            size_adj = 0.7
        
        # Adjust for specific signals
        if es_divergence and es_divergence.divergence_type == DivergenceType.BEARISH:
            if bias == "LONG":
                size_adj *= 0.5
        
        if tlt_signal == "FLIGHT_TO_SAFETY" and bias == "LONG":
            size_adj *= 0.5
        
        return bias, min(1.5, max(0.3, size_adj))
    
    def get_quick_check(self) -> Dict:
        """Quick intermarket status"""
        spx_data = self.latest.get('SPX')
        es_data = self.latest.get('ES')
        
        if not spx_data or not es_data:
            return {'aligned': True, 'warning': None}
        
        spx_dir = calc_direction(spx_data.change)
        es_dir = calc_direction(es_data.change)
        
        aligned = spx_dir == es_dir or spx_dir == AssetDirection.FLAT or es_dir == AssetDirection.FLAT
        
        return {
            'aligned': aligned,
            'spx_dir': spx_dir.value,
            'es_dir': es_dir.value,
            'warning': None if aligned else "SPX/ES diverging"
        }
    
    def reset(self):
        """Clear all data"""
        self.spx_prices.clear()
        self.es_prices.clear()
        self.dxy_prices.clear()
        self.tlt_prices.clear()
        self.vix_prices.clear()
        self.latest = {}


# ═══════════════════════════════════════════════════════════════════════════════
# EXPORTS
# ═══════════════════════════════════════════════════════════════════════════════

__all__ = [
    'IntermarketConfig', 'CONFIG',
    'RiskRegime', 'AssetDirection', 'CorrelationState', 'DivergenceType',
    'AssetData', 'CorrelationPair', 'DivergenceSignal', 
    'RiskRegimeAnalysis', 'SectorRotation',
    'IntermarketEngine',
    'calc_direction', 'calc_correlation', 'detect_divergence'
]
