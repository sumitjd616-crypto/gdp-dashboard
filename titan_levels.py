"""
TITAN INTRADAY LEVELS MODULE
=============================

Key institutional levels that professional traders use:
- VWAP (Volume Weighted Average Price)
- Opening Range (OR)
- Initial Balance (IB)
- Prior Day High/Low/Close
- Weekly/Monthly High/Low
- ETH (Electronic Trading Hours) High/Low
- Virgin VPOC (Volume Point of Control)
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from datetime import datetime, date, time as dt_time, timedelta
from collections import deque
from enum import Enum


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class LevelsConfig:
    # Market hours (ET)
    RTH_OPEN: dt_time = field(default_factory=lambda: dt_time(9, 30))
    RTH_CLOSE: dt_time = field(default_factory=lambda: dt_time(16, 0))
    
    # Initial Balance (first 30 min or 1 hour)
    IB_MINUTES: int = 30  # Traditional is 30, some use 60
    
    # Opening Range (first N minutes)
    OR_MINUTES: int = 5
    
    # VWAP bands
    VWAP_STD_BANDS: List[float] = field(default_factory=lambda: [1.0, 2.0, 3.0])
    
    # Level importance decay
    TOUCH_DECAY: float = 0.8  # Each touch weakens level
    
    # Confluence detection
    CONFLUENCE_RANGE: float = 2.0  # Points


CFG = LevelsConfig()


# ═══════════════════════════════════════════════════════════════════════════════
# ENUMS
# ═══════════════════════════════════════════════════════════════════════════════

class LevelType(Enum):
    VWAP = "VWAP"
    VWAP_UPPER_1 = "VWAP +1σ"
    VWAP_UPPER_2 = "VWAP +2σ"
    VWAP_LOWER_1 = "VWAP -1σ"
    VWAP_LOWER_2 = "VWAP -2σ"
    OR_HIGH = "OR HIGH"
    OR_LOW = "OR LOW"
    IB_HIGH = "IB HIGH"
    IB_LOW = "IB LOW"
    PDH = "Prior Day High"
    PDL = "Prior Day Low"
    PDC = "Prior Day Close"
    PWH = "Prior Week High"
    PWL = "Prior Week Low"
    PMH = "Prior Month High"
    PML = "Prior Month Low"
    ETH_HIGH = "ETH High"
    ETH_LOW = "ETH Low"
    VPOC = "Volume POC"
    VAH = "Value Area High"
    VAL = "Value Area Low"


class LevelStrength(Enum):
    VIRGIN = "VIRGIN"        # Never tested
    STRONG = "STRONG"        # Tested 1-2x, held
    MODERATE = "MODERATE"    # Tested 3x
    WEAK = "WEAK"           # Multiple tests, losing power
    BROKEN = "BROKEN"       # Has been breached


class PricePosition(Enum):
    ABOVE_VWAP = "ABOVE_VWAP"
    BELOW_VWAP = "BELOW_VWAP"
    AT_VWAP = "AT_VWAP"
    IN_VALUE = "IN_VALUE"
    ABOVE_VALUE = "ABOVE_VALUE"
    BELOW_VALUE = "BELOW_VALUE"


# ═══════════════════════════════════════════════════════════════════════════════
# DATA STRUCTURES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class Bar:
    """OHLCV bar"""
    time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Level:
    """A key price level"""
    price: float
    level_type: LevelType
    strength: LevelStrength
    touch_count: int = 0
    last_touch: Optional[datetime] = None
    
    # For dynamic levels like VWAP
    is_dynamic: bool = False
    
    # Confluence (other levels nearby)
    confluence_levels: List[LevelType] = field(default_factory=list)
    
    @property
    def has_confluence(self) -> bool:
        return len(self.confluence_levels) > 0
    
    @property
    def importance(self) -> float:
        """Calculate level importance (0-100)"""
        base = 50
        
        # Virgin levels are strongest
        if self.strength == LevelStrength.VIRGIN:
            base = 80
        elif self.strength == LevelStrength.STRONG:
            base = 70
        elif self.strength == LevelStrength.MODERATE:
            base = 50
        elif self.strength == LevelStrength.WEAK:
            base = 30
        else:
            base = 20
        
        # Confluence bonus
        base += len(self.confluence_levels) * 10
        
        # VWAP is always important
        if 'VWAP' in self.level_type.value:
            base += 10
        
        # Prior day levels are key
        if 'Prior Day' in self.level_type.value:
            base += 5
        
        return min(100, base)


@dataclass
class VWAP:
    """Volume Weighted Average Price with bands"""
    value: float
    upper_1: float  # +1 std dev
    upper_2: float  # +2 std dev
    upper_3: float  # +3 std dev
    lower_1: float  # -1 std dev
    lower_2: float  # -2 std dev
    lower_3: float  # -3 std dev
    
    # VWAP slope for trend
    slope: float  # Points per minute


@dataclass
class ValueArea:
    """Volume profile value area"""
    poc: float      # Point of Control (highest volume price)
    vah: float      # Value Area High (70% of volume)
    val: float      # Value Area Low
    
    # Is POC virgin (never tested)?
    poc_virgin: bool = True


@dataclass 
class OpeningRange:
    """First N minutes range"""
    high: float
    low: float
    midpoint: float
    range_size: float


@dataclass
class InitialBalance:
    """First 30/60 minutes range"""
    high: float
    low: float
    midpoint: float
    range_size: float
    
    # IB extensions
    ext_1_5_high: float  # 1.5x extension
    ext_1_5_low: float
    ext_2_high: float    # 2x extension
    ext_2_low: float


@dataclass
class PriorDayLevels:
    """Prior day key levels"""
    high: float
    low: float
    close: float
    
    # Mid levels
    mid: float
    upper_half: float  # Midpoint of upper half
    lower_half: float  # Midpoint of lower half


@dataclass
class IntradayLevels:
    """Complete intraday levels package"""
    timestamp: datetime
    spot: float
    
    # Core levels
    vwap: VWAP
    value_area: Optional[ValueArea]
    opening_range: Optional[OpeningRange]
    initial_balance: Optional[InitialBalance]
    prior_day: Optional[PriorDayLevels]
    
    # All levels sorted by proximity to current price
    all_levels: List[Level]
    
    # Position relative to key levels
    position: PricePosition
    position_detail: str
    
    # Nearest support/resistance
    nearest_support: Optional[Level]
    nearest_resistance: Optional[Level]
    
    # Trading implications
    bias: str  # 'BULLISH', 'BEARISH', 'NEUTRAL'
    key_insight: str


# ═══════════════════════════════════════════════════════════════════════════════
# VWAP CALCULATOR
# ═══════════════════════════════════════════════════════════════════════════════

class VWAPCalculator:
    """Calculate rolling VWAP and bands"""
    
    def __init__(self):
        self.cumulative_tp_vol = 0.0  # Sum of (Typical Price * Volume)
        self.cumulative_vol = 0.0
        self.cumulative_tp2_vol = 0.0  # For variance
        self.bars: List[Bar] = []
        self.vwap_history: deque = deque(maxlen=100)
    
    def add_bar(self, bar: Bar):
        """Add bar to VWAP calculation"""
        self.bars.append(bar)
        
        tp = (bar.high + bar.low + bar.close) / 3
        self.cumulative_tp_vol += tp * bar.volume
        self.cumulative_vol += bar.volume
        self.cumulative_tp2_vol += (tp ** 2) * bar.volume
        
        vwap = self.get_vwap()
        if vwap:
            self.vwap_history.append((bar.time, vwap.value))
    
    def get_vwap(self) -> Optional[VWAP]:
        """Calculate current VWAP and bands"""
        if self.cumulative_vol == 0:
            return None
        
        vwap = self.cumulative_tp_vol / self.cumulative_vol
        
        # Variance for standard deviation bands
        variance = (self.cumulative_tp2_vol / self.cumulative_vol) - (vwap ** 2)
        std_dev = np.sqrt(max(0, variance))
        
        # Calculate slope (points per minute over last 10 bars)
        slope = 0.0
        if len(self.vwap_history) >= 10:
            recent = list(self.vwap_history)[-10:]
            if len(recent) >= 2:
                time_diff = (recent[-1][0] - recent[0][0]).total_seconds() / 60
                if time_diff > 0:
                    slope = (recent[-1][1] - recent[0][1]) / time_diff
        
        return VWAP(
            value=vwap,
            upper_1=vwap + std_dev,
            upper_2=vwap + 2 * std_dev,
            upper_3=vwap + 3 * std_dev,
            lower_1=vwap - std_dev,
            lower_2=vwap - 2 * std_dev,
            lower_3=vwap - 3 * std_dev,
            slope=slope
        )
    
    def reset(self):
        """Reset for new session"""
        self.cumulative_tp_vol = 0.0
        self.cumulative_vol = 0.0
        self.cumulative_tp2_vol = 0.0
        self.bars = []
        self.vwap_history.clear()


# ═══════════════════════════════════════════════════════════════════════════════
# VOLUME PROFILE CALCULATOR
# ═══════════════════════════════════════════════════════════════════════════════

class VolumeProfileCalculator:
    """Calculate volume profile and value area"""
    
    def __init__(self, tick_size: float = 0.25):
        self.tick_size = tick_size
        self.profile: Dict[float, float] = {}  # price -> volume
    
    def add_bar(self, bar: Bar):
        """Add bar to volume profile"""
        # Distribute volume across price range
        bar_range = bar.high - bar.low
        if bar_range < self.tick_size:
            price = round(bar.close / self.tick_size) * self.tick_size
            self.profile[price] = self.profile.get(price, 0) + bar.volume
        else:
            # Distribute volume across price levels
            num_levels = int(bar_range / self.tick_size) + 1
            vol_per_level = bar.volume / num_levels
            
            price = round(bar.low / self.tick_size) * self.tick_size
            while price <= bar.high:
                self.profile[price] = self.profile.get(price, 0) + vol_per_level
                price += self.tick_size
    
    def get_value_area(self, pct: float = 0.70) -> Optional[ValueArea]:
        """Calculate POC and value area (70% of volume by default)"""
        if not self.profile:
            return None
        
        # Find POC (highest volume price)
        poc = max(self.profile.keys(), key=lambda k: self.profile[k])
        
        # Calculate value area
        total_vol = sum(self.profile.values())
        target_vol = total_vol * pct
        
        # Start from POC and expand outward
        prices = sorted(self.profile.keys())
        poc_idx = prices.index(poc)
        
        vah_idx = poc_idx
        val_idx = poc_idx
        current_vol = self.profile[poc]
        
        while current_vol < target_vol:
            # Look up
            up_vol = self.profile.get(prices[vah_idx + 1], 0) if vah_idx + 1 < len(prices) else 0
            # Look down
            down_vol = self.profile.get(prices[val_idx - 1], 0) if val_idx > 0 else 0
            
            if up_vol >= down_vol and vah_idx + 1 < len(prices):
                vah_idx += 1
                current_vol += up_vol
            elif val_idx > 0:
                val_idx -= 1
                current_vol += down_vol
            else:
                break
        
        return ValueArea(
            poc=poc,
            vah=prices[vah_idx],
            val=prices[val_idx],
            poc_virgin=True  # Updated externally based on price action
        )
    
    def reset(self):
        """Reset for new session"""
        self.profile.clear()


# ═══════════════════════════════════════════════════════════════════════════════
# INTRADAY LEVELS ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class IntradayLevelsEngine:
    """
    Track and analyze key intraday levels
    
    ACCESSIBLE data sources:
    - Price bars (OHLCV) from any data provider
    - Volume data
    
    Calculates:
    - VWAP and bands
    - Opening Range
    - Initial Balance
    - Prior Day H/L/C
    - Volume Profile / Value Area
    """
    
    def __init__(self):
        self.vwap_calc = VWAPCalculator()
        self.vol_profile = VolumeProfileCalculator()
        
        # Session data
        self.session_bars: List[Bar] = []
        self.session_date: Optional[date] = None
        
        # Key levels
        self.or_high: Optional[float] = None
        self.or_low: Optional[float] = None
        self.or_set: bool = False
        
        self.ib_high: Optional[float] = None
        self.ib_low: Optional[float] = None
        self.ib_set: bool = False
        
        # Prior day
        self.prior_day: Optional[PriorDayLevels] = None
        
        # ETH (Electronic Trading Hours)
        self.eth_high: Optional[float] = None
        self.eth_low: Optional[float] = None
        
        # Level tracking
        self.level_touches: Dict[LevelType, int] = {}
    
    def set_prior_day(self, high: float, low: float, close: float):
        """Set prior day levels"""
        mid = (high + low) / 2
        self.prior_day = PriorDayLevels(
            high=high,
            low=low,
            close=close,
            mid=mid,
            upper_half=(high + mid) / 2,
            lower_half=(low + mid) / 2
        )
    
    def add_bar(self, bar: Bar, is_rth: bool = True):
        """Add bar and update levels"""
        
        # Check for new session
        if self.session_date != bar.time.date():
            self._new_session(bar.time.date())
        
        self.session_bars.append(bar)
        
        # Update VWAP (RTH only typically)
        if is_rth:
            self.vwap_calc.add_bar(bar)
            self.vol_profile.add_bar(bar)
        else:
            # Track ETH high/low
            if self.eth_high is None or bar.high > self.eth_high:
                self.eth_high = bar.high
            if self.eth_low is None or bar.low < self.eth_low:
                self.eth_low = bar.low
        
        # Update Opening Range (first N minutes)
        if is_rth and not self.or_set:
            minutes_in = self._minutes_since_open(bar.time)
            if minutes_in <= CFG.OR_MINUTES:
                if self.or_high is None or bar.high > self.or_high:
                    self.or_high = bar.high
                if self.or_low is None or bar.low < self.or_low:
                    self.or_low = bar.low
            else:
                self.or_set = True
        
        # Update Initial Balance (first 30/60 minutes)
        if is_rth and not self.ib_set:
            minutes_in = self._minutes_since_open(bar.time)
            if minutes_in <= CFG.IB_MINUTES:
                if self.ib_high is None or bar.high > self.ib_high:
                    self.ib_high = bar.high
                if self.ib_low is None or bar.low < self.ib_low:
                    self.ib_low = bar.low
            else:
                self.ib_set = True
    
    def _new_session(self, new_date: date):
        """Reset for new session"""
        # Store prior day if we have session data
        if self.session_bars:
            high = max(b.high for b in self.session_bars)
            low = min(b.low for b in self.session_bars)
            close = self.session_bars[-1].close
            self.set_prior_day(high, low, close)
        
        # Reset
        self.session_date = new_date
        self.session_bars = []
        self.vwap_calc.reset()
        self.vol_profile.reset()
        
        self.or_high = None
        self.or_low = None
        self.or_set = False
        
        self.ib_high = None
        self.ib_low = None
        self.ib_set = False
        
        self.eth_high = None
        self.eth_low = None
        
        self.level_touches.clear()
    
    def _minutes_since_open(self, t: datetime) -> float:
        """Calculate minutes since RTH open"""
        open_dt = datetime.combine(t.date(), CFG.RTH_OPEN)
        return (t - open_dt).total_seconds() / 60
    
    def get_levels(self, spot: float) -> IntradayLevels:
        """Get complete intraday levels analysis"""
        
        # VWAP
        vwap = self.vwap_calc.get_vwap()
        if vwap is None:
            vwap = VWAP(spot, spot, spot, spot, spot, spot, spot, 0)
        
        # Value Area
        value_area = self.vol_profile.get_value_area()
        
        # Opening Range
        opening_range = None
        if self.or_high is not None and self.or_low is not None:
            opening_range = OpeningRange(
                high=self.or_high,
                low=self.or_low,
                midpoint=(self.or_high + self.or_low) / 2,
                range_size=self.or_high - self.or_low
            )
        
        # Initial Balance
        initial_balance = None
        if self.ib_high is not None and self.ib_low is not None:
            ib_range = self.ib_high - self.ib_low
            initial_balance = InitialBalance(
                high=self.ib_high,
                low=self.ib_low,
                midpoint=(self.ib_high + self.ib_low) / 2,
                range_size=ib_range,
                ext_1_5_high=self.ib_high + ib_range * 0.5,
                ext_1_5_low=self.ib_low - ib_range * 0.5,
                ext_2_high=self.ib_high + ib_range,
                ext_2_low=self.ib_low - ib_range
            )
        
        # Build all levels list
        all_levels = []
        
        # Add VWAP levels
        all_levels.append(Level(vwap.value, LevelType.VWAP, LevelStrength.STRONG, is_dynamic=True))
        all_levels.append(Level(vwap.upper_1, LevelType.VWAP_UPPER_1, LevelStrength.MODERATE, is_dynamic=True))
        all_levels.append(Level(vwap.upper_2, LevelType.VWAP_UPPER_2, LevelStrength.MODERATE, is_dynamic=True))
        all_levels.append(Level(vwap.lower_1, LevelType.VWAP_LOWER_1, LevelStrength.MODERATE, is_dynamic=True))
        all_levels.append(Level(vwap.lower_2, LevelType.VWAP_LOWER_2, LevelStrength.MODERATE, is_dynamic=True))
        
        # Add OR levels
        if opening_range:
            all_levels.append(Level(opening_range.high, LevelType.OR_HIGH, LevelStrength.VIRGIN))
            all_levels.append(Level(opening_range.low, LevelType.OR_LOW, LevelStrength.VIRGIN))
        
        # Add IB levels
        if initial_balance:
            all_levels.append(Level(initial_balance.high, LevelType.IB_HIGH, LevelStrength.VIRGIN))
            all_levels.append(Level(initial_balance.low, LevelType.IB_LOW, LevelStrength.VIRGIN))
        
        # Add prior day levels
        if self.prior_day:
            all_levels.append(Level(self.prior_day.high, LevelType.PDH, LevelStrength.VIRGIN))
            all_levels.append(Level(self.prior_day.low, LevelType.PDL, LevelStrength.VIRGIN))
            all_levels.append(Level(self.prior_day.close, LevelType.PDC, LevelStrength.STRONG))
        
        # Add value area
        if value_area:
            all_levels.append(Level(value_area.poc, LevelType.VPOC, LevelStrength.VIRGIN))
            all_levels.append(Level(value_area.vah, LevelType.VAH, LevelStrength.MODERATE))
            all_levels.append(Level(value_area.val, LevelType.VAL, LevelStrength.MODERATE))
        
        # Add ETH levels
        if self.eth_high is not None:
            all_levels.append(Level(self.eth_high, LevelType.ETH_HIGH, LevelStrength.MODERATE))
        if self.eth_low is not None:
            all_levels.append(Level(self.eth_low, LevelType.ETH_LOW, LevelStrength.MODERATE))
        
        # Check for confluence
        for level in all_levels:
            for other in all_levels:
                if level != other and abs(level.price - other.price) <= CFG.CONFLUENCE_RANGE:
                    level.confluence_levels.append(other.level_type)
        
        # Sort by proximity to spot
        all_levels.sort(key=lambda l: abs(l.price - spot))
        
        # Find nearest support/resistance
        nearest_support = None
        nearest_resistance = None
        
        for level in all_levels:
            if level.price < spot and nearest_support is None:
                nearest_support = level
            elif level.price > spot and nearest_resistance is None:
                nearest_resistance = level
        
        # Sort by proximity for supports and resistances separately
        supports = sorted([l for l in all_levels if l.price < spot], 
                         key=lambda l: spot - l.price)
        resistances = sorted([l for l in all_levels if l.price > spot],
                            key=lambda l: l.price - spot)
        
        nearest_support = supports[0] if supports else None
        nearest_resistance = resistances[0] if resistances else None
        
        # Determine position
        if value_area:
            if spot > value_area.vah:
                position = PricePosition.ABOVE_VALUE
            elif spot < value_area.val:
                position = PricePosition.BELOW_VALUE
            else:
                position = PricePosition.IN_VALUE
        elif spot > vwap.value:
            position = PricePosition.ABOVE_VWAP
        elif spot < vwap.value:
            position = PricePosition.BELOW_VWAP
        else:
            position = PricePosition.AT_VWAP
        
        # Position detail
        vwap_dist = spot - vwap.value
        position_detail = f"{'Above' if vwap_dist > 0 else 'Below'} VWAP by {abs(vwap_dist):.2f}"
        
        # Bias
        if spot > vwap.value and vwap.slope > 0:
            bias = 'BULLISH'
        elif spot < vwap.value and vwap.slope < 0:
            bias = 'BEARISH'
        else:
            bias = 'NEUTRAL'
        
        # Key insight
        insights = []
        
        if position == PricePosition.ABOVE_VALUE:
            insights.append("Price above value area - potential long continuation")
        elif position == PricePosition.BELOW_VALUE:
            insights.append("Price below value area - potential short continuation")
        else:
            insights.append("Price in value - watch for breakout direction")
        
        if nearest_support and nearest_support.has_confluence:
            insights.append(f"Strong support confluence at {nearest_support.price:.2f}")
        if nearest_resistance and nearest_resistance.has_confluence:
            insights.append(f"Strong resistance confluence at {nearest_resistance.price:.2f}")
        
        if self.ib_set and initial_balance:
            if spot > initial_balance.high:
                insights.append("IB breakout to upside - trend day potential")
            elif spot < initial_balance.low:
                insights.append("IB breakdown - trend day potential")
        
        return IntradayLevels(
            timestamp=datetime.now(),
            spot=spot,
            vwap=vwap,
            value_area=value_area,
            opening_range=opening_range,
            initial_balance=initial_balance,
            prior_day=self.prior_day,
            all_levels=all_levels,
            position=position,
            position_detail=position_detail,
            nearest_support=nearest_support,
            nearest_resistance=nearest_resistance,
            bias=bias,
            key_insight=insights[0] if insights else "No significant level signals"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# DEMO
# ═══════════════════════════════════════════════════════════════════════════════

def demo():
    """Demo intraday levels"""
    print("=" * 80)
    print("TITAN INTRADAY LEVELS MODULE — DEMO")
    print("=" * 80)
    
    engine = IntradayLevelsEngine()
    
    # Set prior day
    engine.set_prior_day(high=5965, low=5920, close=5945)
    
    # Simulate bars
    base_price = 5950
    now = datetime.now().replace(hour=9, minute=30, second=0, microsecond=0)
    
    for i in range(60):  # 60 minutes of data
        bar = Bar(
            time=now + timedelta(minutes=i),
            open=base_price + np.random.normal(0, 0.5),
            high=base_price + np.random.uniform(0.5, 2),
            low=base_price - np.random.uniform(0.5, 2),
            close=base_price + np.random.normal(0, 1),
            volume=np.random.uniform(1000, 5000)
        )
        engine.add_bar(bar)
        base_price = bar.close
    
    # Get levels
    spot = 5952
    levels = engine.get_levels(spot)
    
    va_poc = f"{levels.value_area.poc:.2f}" if levels.value_area else 'N/A'
    va_vah = f"{levels.value_area.vah:.2f}" if levels.value_area else 'N/A'
    va_val = f"{levels.value_area.val:.2f}" if levels.value_area else 'N/A'
    or_high = f"{levels.opening_range.high:.2f}" if levels.opening_range else 'N/A'
    or_low = f"{levels.opening_range.low:.2f}" if levels.opening_range else 'N/A'
    or_range = f"{levels.opening_range.range_size:.2f}" if levels.opening_range else 'N/A'
    ib_high = f"{levels.initial_balance.high:.2f}" if levels.initial_balance else 'N/A'
    ib_low = f"{levels.initial_balance.low:.2f}" if levels.initial_balance else 'N/A'
    ib_ext_up = f"{levels.initial_balance.ext_1_5_high:.2f}" if levels.initial_balance else 'N/A'
    ib_ext_dn = f"{levels.initial_balance.ext_1_5_low:.2f}" if levels.initial_balance else 'N/A'
    pd_high = f"{levels.prior_day.high:.2f}" if levels.prior_day else 'N/A'
    pd_low = f"{levels.prior_day.low:.2f}" if levels.prior_day else 'N/A'
    pd_close = f"{levels.prior_day.close:.2f}" if levels.prior_day else 'N/A'
    
    sup_name = levels.nearest_support.level_type.value if levels.nearest_support else 'None'
    sup_price = f"{levels.nearest_support.price:.2f}" if levels.nearest_support else '0'
    sup_conf = ', '.join(l.value for l in levels.nearest_support.confluence_levels) if levels.nearest_support and levels.nearest_support.confluence_levels else 'None'
    
    res_name = levels.nearest_resistance.level_type.value if levels.nearest_resistance else 'None'
    res_price = f"{levels.nearest_resistance.price:.2f}" if levels.nearest_resistance else '0'
    res_conf = ', '.join(l.value for l in levels.nearest_resistance.confluence_levels) if levels.nearest_resistance and levels.nearest_resistance.confluence_levels else 'None'
    
    print(f"""
📐 INTRADAY LEVELS ANALYSIS
═══════════════════════════════════════════════════════════════════════════════

📍 SPOT: {spot:.2f}
📊 POSITION: {levels.position.value}
   {levels.position_detail}

📈 VWAP
   Value: {levels.vwap.value:.2f}
   +1σ: {levels.vwap.upper_1:.2f}
   -1σ: {levels.vwap.lower_1:.2f}
   Slope: {levels.vwap.slope:.3f}/min

📊 VALUE AREA
   POC: {va_poc}
   VAH: {va_vah}
   VAL: {va_val}

🎯 OPENING RANGE
   High: {or_high}
   Low: {or_low}
   Range: {or_range}

📊 INITIAL BALANCE
   High: {ib_high}
   Low: {ib_low}
   1.5x Up: {ib_ext_up}
   1.5x Down: {ib_ext_dn}

📅 PRIOR DAY
   High: {pd_high}
   Low: {pd_low}
   Close: {pd_close}

🛡️ NEAREST SUPPORT: {sup_name} @ {sup_price}
   Confluence: {sup_conf}

🎯 NEAREST RESISTANCE: {res_name} @ {res_price}
   Confluence: {res_conf}

📊 BIAS: {levels.bias}

💡 KEY INSIGHT
   {levels.key_insight}

═══════════════════════════════════════════════════════════════════════════════
""")


if __name__ == "__main__":
    demo()
