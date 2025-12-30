"""
TITAN TIME CONTEXT ENGINE
=========================
Time-aware trading adjustments for SPX day trading

Features:
- Market session detection (Open Drive, Reversal Zone, Midday, Power Hour, MOC)
- OPEX Friday detection and handling
- FOMC/CPI event awareness
- Time-based position sizing adjustments
- Charm acceleration modeling for EOD
"""

from dataclasses import dataclass
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Tuple
from enum import Enum
import calendar


# ═══════════════════════════════════════════════════════════════════════════════
# ENUMS
# ═══════════════════════════════════════════════════════════════════════════════

class MarketSession(Enum):
    PRE_MARKET = "PRE_MARKET"
    OPEN_DRIVE = "OPEN_DRIVE"         # 9:30-9:45 - Momentum continuation
    OPEN_REVERSAL = "OPEN_REVERSAL"   # 9:45-10:15 - Fades work
    MORNING_TREND = "MORNING_TREND"   # 10:15-11:30 - Directional
    MIDDAY_CHOP = "MIDDAY_CHOP"       # 11:30-14:00 - Reduce size
    AFTERNOON_TREND = "AFTERNOON_TREND" # 14:00-14:30 - Setup
    POWER_HOUR = "POWER_HOUR"         # 14:30-15:30 - Momentum
    MOC_IMBALANCE = "MOC_IMBALANCE"   # 15:30-16:00 - Follow MOC
    AFTER_HOURS = "AFTER_HOURS"
    CLOSED = "CLOSED"


class SpecialDay(Enum):
    NORMAL = "NORMAL"
    OPEX_FRIDAY = "OPEX_FRIDAY"       # Monthly options expiration
    WEEKLY_OPEX = "WEEKLY_OPEX"       # Weekly expiration (non-monthly)
    FOMC_DAY = "FOMC_DAY"             # Fed meeting day
    CPI_DAY = "CPI_DAY"               # CPI release day
    QUAD_WITCH = "QUAD_WITCH"         # Quarterly expiration
    HALF_DAY = "HALF_DAY"             # Market closes early
    HOLIDAY = "HOLIDAY"


# ═══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class SessionModifier:
    """Modifiers for the current session"""
    session: MarketSession
    size_mult: float           # Position size multiplier
    momentum_mult: float       # Momentum signal weight
    reversal_mult: float       # Reversal signal weight
    mean_revert_mult: float    # Mean reversion signal weight
    hold_time_mult: float      # Expected hold time multiplier
    stop_buffer_mult: float    # Stop loss buffer multiplier
    notes: List[str]


@dataclass
class DayModifier:
    """Modifiers for special days"""
    day_type: SpecialDay
    size_mult: float
    gamma_pin_prob: float      # Probability of gamma pinning
    avoid_0dte: bool           # Avoid 0DTE options
    volatility_mult: float     # Expected volatility multiplier
    notes: List[str]


@dataclass
class TimeContext:
    """Complete time context for trading decisions"""
    timestamp: datetime
    session: SessionModifier
    day: DayModifier
    
    # Combined modifiers
    final_size_mult: float
    final_momentum_mult: float
    final_reversal_mult: float
    
    # Charm acceleration
    charm_accel: float         # Time decay acceleration factor
    theta_urgency: float       # How urgent is time decay (0-1)
    
    # Key times
    mins_to_close: float
    mins_since_open: float
    is_last_hour: bool
    is_first_30min: bool
    
    # Actionable
    primary_strategy: str
    avoid_strategies: List[str]
    warnings: List[str]


# ═══════════════════════════════════════════════════════════════════════════════
# CALENDAR FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def get_third_friday(year: int, month: int) -> date:
    """Get the third Friday of a month (monthly OPEX)"""
    c = calendar.Calendar(firstweekday=calendar.MONDAY)
    monthcal = c.monthdatescalendar(year, month)
    
    fridays = [
        day for week in monthcal for day in week 
        if day.weekday() == calendar.FRIDAY and day.month == month
    ]
    
    return fridays[2] if len(fridays) >= 3 else fridays[-1]


def is_third_friday(d: date) -> bool:
    """Check if date is the third Friday of its month"""
    return d == get_third_friday(d.year, d.month)


def is_quad_witch(d: date) -> bool:
    """Check if date is quarterly expiration (Mar, Jun, Sep, Dec)"""
    if d.month not in [3, 6, 9, 12]:
        return False
    return is_third_friday(d)


def get_special_day(d: date, fomc_dates: List[date] = None, cpi_dates: List[date] = None) -> SpecialDay:
    """Determine if today is a special trading day"""
    # Check quad witch first
    if is_quad_witch(d):
        return SpecialDay.QUAD_WITCH
    
    # Check monthly OPEX
    if is_third_friday(d):
        return SpecialDay.OPEX_FRIDAY
    
    # Check weekly OPEX (Friday that's not monthly)
    if d.weekday() == calendar.FRIDAY:
        return SpecialDay.WEEKLY_OPEX
    
    # Check FOMC
    if fomc_dates and d in fomc_dates:
        return SpecialDay.FOMC_DAY
    
    # Check CPI
    if cpi_dates and d in cpi_dates:
        return SpecialDay.CPI_DAY
    
    return SpecialDay.NORMAL


# ═══════════════════════════════════════════════════════════════════════════════
# SESSION DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def get_market_session(dt: datetime) -> MarketSession:
    """
    Determine current market session based on ET time
    
    All times in Eastern Time:
    - Pre-market: 4:00-9:30
    - Open Drive: 9:30-9:45
    - Open Reversal: 9:45-10:15
    - Morning Trend: 10:15-11:30
    - Midday Chop: 11:30-14:00
    - Afternoon Trend: 14:00-14:30
    - Power Hour: 14:30-15:30
    - MOC Imbalance: 15:30-16:00
    - After Hours: 16:00-20:00
    """
    hour = dt.hour
    minute = dt.minute
    time_mins = hour * 60 + minute
    
    # Boundaries in minutes from midnight
    PRE_OPEN = 4 * 60       # 4:00
    OPEN = 9 * 60 + 30      # 9:30
    OPEN_REV = 9 * 60 + 45  # 9:45
    MORNING = 10 * 60 + 15  # 10:15
    MIDDAY_START = 11 * 60 + 30  # 11:30
    MIDDAY_END = 14 * 60    # 14:00
    POWER_START = 14 * 60 + 30  # 14:30
    MOC_START = 15 * 60 + 30    # 15:30
    CLOSE = 16 * 60         # 16:00
    AFTER_END = 20 * 60     # 20:00
    
    if time_mins < PRE_OPEN:
        return MarketSession.CLOSED
    elif time_mins < OPEN:
        return MarketSession.PRE_MARKET
    elif time_mins < OPEN_REV:
        return MarketSession.OPEN_DRIVE
    elif time_mins < MORNING:
        return MarketSession.OPEN_REVERSAL
    elif time_mins < MIDDAY_START:
        return MarketSession.MORNING_TREND
    elif time_mins < MIDDAY_END:
        return MarketSession.MIDDAY_CHOP
    elif time_mins < POWER_START:
        return MarketSession.AFTERNOON_TREND
    elif time_mins < MOC_START:
        return MarketSession.POWER_HOUR
    elif time_mins < CLOSE:
        return MarketSession.MOC_IMBALANCE
    elif time_mins < AFTER_END:
        return MarketSession.AFTER_HOURS
    else:
        return MarketSession.CLOSED


# ═══════════════════════════════════════════════════════════════════════════════
# MODIFIER GENERATORS
# ═══════════════════════════════════════════════════════════════════════════════

def get_session_modifier(session: MarketSession) -> SessionModifier:
    """Get trading modifiers for a market session"""
    
    modifiers = {
        MarketSession.PRE_MARKET: SessionModifier(
            session=session,
            size_mult=0.0,
            momentum_mult=0.0,
            reversal_mult=0.0,
            mean_revert_mult=0.0,
            hold_time_mult=0.0,
            stop_buffer_mult=1.0,
            notes=["No trading - pre-market"]
        ),
        
        MarketSession.OPEN_DRIVE: SessionModifier(
            session=session,
            size_mult=0.7,          # Moderate size due to spreads
            momentum_mult=1.5,      # Strong momentum continuation
            reversal_mult=0.3,      # Fades are dangerous
            mean_revert_mult=0.2,   # Don't mean revert
            hold_time_mult=0.5,     # Quick trades
            stop_buffer_mult=1.5,   # Wider stops for volatility
            notes=[
                "🚀 MOMENTUM ZONE",
                "Follow overnight gap direction",
                "Don't fade initial move",
                "Wide spreads - market orders risky"
            ]
        ),
        
        MarketSession.OPEN_REVERSAL: SessionModifier(
            session=session,
            size_mult=0.8,
            momentum_mult=0.7,
            reversal_mult=1.5,      # Fades work here
            mean_revert_mult=1.2,
            hold_time_mult=0.8,
            stop_buffer_mult=1.2,
            notes=[
                "🔄 REVERSAL ZONE",
                "9:50-10:00 common reversal time",
                "Look for failed breakouts",
                "Gap fills likely"
            ]
        ),
        
        MarketSession.MORNING_TREND: SessionModifier(
            session=session,
            size_mult=1.0,          # Full size
            momentum_mult=1.2,
            reversal_mult=0.8,
            mean_revert_mult=0.6,
            hold_time_mult=1.0,
            stop_buffer_mult=1.0,
            notes=[
                "📈 TREND ZONE",
                "Best trending period",
                "Follow 9:30-10:00 direction",
                "News catalyst trades work"
            ]
        ),
        
        MarketSession.MIDDAY_CHOP: SessionModifier(
            session=session,
            size_mult=0.5,          # Half size
            momentum_mult=0.4,      # Momentum fades
            reversal_mult=0.6,
            mean_revert_mult=1.3,   # Mean reversion works
            hold_time_mult=0.6,     # Shorter holds
            stop_buffer_mult=0.8,   # Tighter stops
            notes=[
                "⚠️ CHOP ZONE",
                "Reduce position size 50%",
                "Scalp only, no swing",
                "Wait for afternoon setup"
            ]
        ),
        
        MarketSession.AFTERNOON_TREND: SessionModifier(
            session=session,
            size_mult=0.8,
            momentum_mult=1.0,
            reversal_mult=0.7,
            mean_revert_mult=0.8,
            hold_time_mult=1.0,
            stop_buffer_mult=1.0,
            notes=[
                "🎯 SETUP ZONE",
                "Prepare for power hour",
                "Watch for momentum build",
                "Position before 2:30"
            ]
        ),
        
        MarketSession.POWER_HOUR: SessionModifier(
            session=session,
            size_mult=1.0,
            momentum_mult=1.4,      # Strong momentum
            reversal_mult=0.5,      # Don't fade
            mean_revert_mult=0.4,
            hold_time_mult=0.7,
            stop_buffer_mult=1.1,
            notes=[
                "⚡ POWER HOUR",
                "Momentum resumes",
                "Institutional positioning",
                "Don't fade the move"
            ]
        ),
        
        MarketSession.MOC_IMBALANCE: SessionModifier(
            session=session,
            size_mult=0.6,
            momentum_mult=1.2,
            reversal_mult=0.3,
            mean_revert_mult=0.3,
            hold_time_mult=0.3,     # Very short holds
            stop_buffer_mult=1.3,
            notes=[
                "📊 MOC ZONE",
                "Watch MOC imbalance at 3:50",
                "Follow imbalance direction",
                "Gamma pin possible",
                "Don't hold through close"
            ]
        ),
        
        MarketSession.AFTER_HOURS: SessionModifier(
            session=session,
            size_mult=0.0,
            momentum_mult=0.0,
            reversal_mult=0.0,
            mean_revert_mult=0.0,
            hold_time_mult=0.0,
            stop_buffer_mult=1.0,
            notes=["No SPX trading - after hours"]
        ),
        
        MarketSession.CLOSED: SessionModifier(
            session=session,
            size_mult=0.0,
            momentum_mult=0.0,
            reversal_mult=0.0,
            mean_revert_mult=0.0,
            hold_time_mult=0.0,
            stop_buffer_mult=1.0,
            notes=["Market closed"]
        ),
    }
    
    return modifiers.get(session, modifiers[MarketSession.CLOSED])


def get_day_modifier(day_type: SpecialDay) -> DayModifier:
    """Get trading modifiers for special days"""
    
    modifiers = {
        SpecialDay.NORMAL: DayModifier(
            day_type=day_type,
            size_mult=1.0,
            gamma_pin_prob=0.3,
            avoid_0dte=False,
            volatility_mult=1.0,
            notes=[]
        ),
        
        SpecialDay.WEEKLY_OPEX: DayModifier(
            day_type=day_type,
            size_mult=0.9,
            gamma_pin_prob=0.5,
            avoid_0dte=False,
            volatility_mult=1.1,
            notes=[
                "Weekly expiration",
                "Increased gamma pinning",
                "Watch key strikes"
            ]
        ),
        
        SpecialDay.OPEX_FRIDAY: DayModifier(
            day_type=day_type,
            size_mult=0.7,
            gamma_pin_prob=0.75,
            avoid_0dte=True,
            volatility_mult=1.3,
            notes=[
                "🎯 MONTHLY OPEX",
                "High gamma pinning probability",
                "Avoid 0DTE - theta crush",
                "Watch max pain level",
                "Big moves possible at 3PM+"
            ]
        ),
        
        SpecialDay.QUAD_WITCH: DayModifier(
            day_type=day_type,
            size_mult=0.5,
            gamma_pin_prob=0.85,
            avoid_0dte=True,
            volatility_mult=1.5,
            notes=[
                "🔥 QUAD WITCH",
                "Extreme gamma exposure",
                "Unpredictable moves",
                "Massive volume spikes",
                "Avoid trading 0DTE",
                "Wait for dust to settle"
            ]
        ),
        
        SpecialDay.FOMC_DAY: DayModifier(
            day_type=day_type,
            size_mult=0.5,
            gamma_pin_prob=0.2,
            avoid_0dte=True,
            volatility_mult=2.0,
            notes=[
                "🏛️ FOMC DAY",
                "Wait until 2:30 announcement",
                "Expect whipsaw after",
                "Real move often 30min later",
                "Avoid pre-announcement trades"
            ]
        ),
        
        SpecialDay.CPI_DAY: DayModifier(
            day_type=day_type,
            size_mult=0.6,
            gamma_pin_prob=0.3,
            avoid_0dte=True,
            volatility_mult=1.8,
            notes=[
                "📈 CPI DAY",
                "8:30 AM release",
                "Gap and go or gap and fade",
                "Wait for 9:30 for real direction",
                "Increased vol all day"
            ]
        ),
        
        SpecialDay.HALF_DAY: DayModifier(
            day_type=day_type,
            size_mult=0.4,
            gamma_pin_prob=0.6,
            avoid_0dte=True,
            volatility_mult=0.6,
            notes=[
                "Half day - closes at 1PM",
                "Low liquidity",
                "Avoid trading"
            ]
        ),
        
        SpecialDay.HOLIDAY: DayModifier(
            day_type=day_type,
            size_mult=0.0,
            gamma_pin_prob=0.0,
            avoid_0dte=True,
            volatility_mult=0.0,
            notes=["Market closed - holiday"]
        ),
    }
    
    return modifiers.get(day_type, modifiers[SpecialDay.NORMAL])


# ═══════════════════════════════════════════════════════════════════════════════
# CHARM ACCELERATION
# ═══════════════════════════════════════════════════════════════════════════════

def calc_charm_acceleration(mins_to_close: float) -> Tuple[float, float]:
    """
    Calculate charm (delta decay) acceleration as market close approaches
    
    Returns:
        (charm_accel, theta_urgency)
        - charm_accel: Multiplier for delta decay speed
        - theta_urgency: 0-1 scale of time decay pressure
    """
    if mins_to_close > 120:
        # More than 2 hours - normal decay
        return 1.0, 0.1
    elif mins_to_close > 60:
        # 1-2 hours - accelerating
        return 1.5, 0.3
    elif mins_to_close > 30:
        # 30min-1hr - fast decay
        return 2.5, 0.6
    elif mins_to_close > 15:
        # 15-30min - very fast
        return 4.0, 0.8
    elif mins_to_close > 5:
        # 5-15min - extreme
        return 6.0, 0.95
    else:
        # Last 5 min - gamma explosion
        return 10.0, 1.0


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN CONTEXT BUILDER
# ═══════════════════════════════════════════════════════════════════════════════

class TimeContextEngine:
    """
    Time Context Engine for SPX Day Trading
    
    Provides time-aware adjustments for all trading decisions.
    """
    
    def __init__(
        self, 
        fomc_dates: List[date] = None,
        cpi_dates: List[date] = None,
        half_days: List[date] = None,
        holidays: List[date] = None
    ):
        self.fomc_dates = fomc_dates or []
        self.cpi_dates = cpi_dates or []
        self.half_days = half_days or []
        self.holidays = holidays or []
    
    def get_context(self, dt: datetime = None) -> TimeContext:
        """
        Get complete time context for trading decisions
        
        Args:
            dt: Datetime in Eastern Time (defaults to now)
        
        Returns:
            TimeContext with all modifiers and recommendations
        """
        if dt is None:
            dt = datetime.now()
        
        # Check holiday first
        if dt.date() in self.holidays:
            day_mod = get_day_modifier(SpecialDay.HOLIDAY)
            session_mod = get_session_modifier(MarketSession.CLOSED)
            
            return TimeContext(
                timestamp=dt,
                session=session_mod,
                day=day_mod,
                final_size_mult=0,
                final_momentum_mult=0,
                final_reversal_mult=0,
                charm_accel=1.0,
                theta_urgency=0,
                mins_to_close=0,
                mins_since_open=0,
                is_last_hour=False,
                is_first_30min=False,
                primary_strategy="NO_TRADE",
                avoid_strategies=["ALL"],
                warnings=["Market closed - holiday"]
            )
        
        # Get session and day type
        session = get_market_session(dt)
        session_mod = get_session_modifier(session)
        
        day_type = get_special_day(dt.date(), self.fomc_dates, self.cpi_dates)
        if dt.date() in self.half_days:
            day_type = SpecialDay.HALF_DAY
        day_mod = get_day_modifier(day_type)
        
        # Calculate time metrics
        market_open = dt.replace(hour=9, minute=30, second=0)
        market_close = dt.replace(hour=16, minute=0, second=0)
        if day_type == SpecialDay.HALF_DAY:
            market_close = dt.replace(hour=13, minute=0, second=0)
        
        mins_since_open = (dt - market_open).total_seconds() / 60 if dt > market_open else 0
        mins_to_close = (market_close - dt).total_seconds() / 60 if dt < market_close else 0
        mins_to_close = max(0, mins_to_close)
        
        # Charm acceleration
        charm_accel, theta_urgency = calc_charm_acceleration(mins_to_close)
        
        # Combined modifiers
        final_size_mult = session_mod.size_mult * day_mod.size_mult
        final_momentum_mult = session_mod.momentum_mult
        final_reversal_mult = session_mod.reversal_mult
        
        # Determine primary strategy
        primary_strategy = self._get_primary_strategy(session, day_type, mins_to_close)
        avoid_strategies = self._get_avoid_strategies(session, day_type, mins_to_close)
        
        # Build warnings
        warnings = []
        warnings.extend(session_mod.notes)
        warnings.extend(day_mod.notes)
        
        if theta_urgency > 0.8:
            warnings.append("⚠️ HIGH THETA DECAY - Close positions soon")
        if mins_to_close < 30 and mins_to_close > 0:
            warnings.append("🕐 Close approaching - reduce exposure")
        if day_mod.gamma_pin_prob > 0.6:
            warnings.append(f"📍 {int(day_mod.gamma_pin_prob*100)}% gamma pin probability")
        
        return TimeContext(
            timestamp=dt,
            session=session_mod,
            day=day_mod,
            final_size_mult=final_size_mult,
            final_momentum_mult=final_momentum_mult,
            final_reversal_mult=final_reversal_mult,
            charm_accel=charm_accel,
            theta_urgency=theta_urgency,
            mins_to_close=mins_to_close,
            mins_since_open=mins_since_open,
            is_last_hour=mins_to_close <= 60 and mins_to_close > 0,
            is_first_30min=0 < mins_since_open <= 30,
            primary_strategy=primary_strategy,
            avoid_strategies=avoid_strategies,
            warnings=warnings
        )
    
    def _get_primary_strategy(
        self, 
        session: MarketSession, 
        day_type: SpecialDay,
        mins_to_close: float
    ) -> str:
        """Determine the primary strategy for current conditions"""
        
        if session == MarketSession.CLOSED or session == MarketSession.PRE_MARKET:
            return "WAIT"
        
        if day_type == SpecialDay.FOMC_DAY and mins_to_close > 90:
            return "WAIT_FOMC"
        
        if session == MarketSession.OPEN_DRIVE:
            return "MOMENTUM_CONTINUATION"
        elif session == MarketSession.OPEN_REVERSAL:
            return "REVERSAL_FADE"
        elif session == MarketSession.MORNING_TREND:
            return "TREND_FOLLOW"
        elif session == MarketSession.MIDDAY_CHOP:
            return "SCALP_ONLY"
        elif session == MarketSession.AFTERNOON_TREND:
            return "SETUP_WATCH"
        elif session == MarketSession.POWER_HOUR:
            return "MOMENTUM_FOLLOW"
        elif session == MarketSession.MOC_IMBALANCE:
            return "MOC_FOLLOW"
        else:
            return "WAIT"
    
    def _get_avoid_strategies(
        self,
        session: MarketSession,
        day_type: SpecialDay,
        mins_to_close: float
    ) -> List[str]:
        """Determine strategies to avoid"""
        avoid = []
        
        if session == MarketSession.OPEN_DRIVE:
            avoid.extend(["FADE", "MEAN_REVERT", "COUNTER_TREND"])
        
        if session == MarketSession.MIDDAY_CHOP:
            avoid.extend(["BREAKOUT", "MOMENTUM", "SWING"])
        
        if session == MarketSession.MOC_IMBALANCE:
            avoid.extend(["HOLD_OVERNIGHT", "SWING"])
        
        if day_type == SpecialDay.OPEX_FRIDAY:
            avoid.append("0DTE_OPTIONS")
        
        if day_type == SpecialDay.QUAD_WITCH:
            avoid.extend(["0DTE_OPTIONS", "LARGE_SIZE", "HOLD_PAST_3PM"])
        
        if day_type == SpecialDay.FOMC_DAY and mins_to_close > 90:
            avoid.extend(["ALL_TRADES_PRE_FOMC"])
        
        if mins_to_close < 15 and mins_to_close > 0:
            avoid.extend(["NEW_POSITIONS", "HOLD_THROUGH_CLOSE"])
        
        return avoid
    
    def is_tradeable(self, dt: datetime = None) -> Tuple[bool, str]:
        """Quick check if current time is tradeable"""
        ctx = self.get_context(dt)
        
        if ctx.final_size_mult == 0:
            return False, "Market closed or untradeable period"
        
        if ctx.day.day_type == SpecialDay.FOMC_DAY and ctx.mins_to_close > 90:
            return False, "Wait for FOMC announcement"
        
        if ctx.session.session == MarketSession.MIDDAY_CHOP:
            return True, "Tradeable but reduced size (midday chop)"
        
        return True, "Tradeable"


# ═══════════════════════════════════════════════════════════════════════════════
# EXPORTS
# ═══════════════════════════════════════════════════════════════════════════════

__all__ = [
    'MarketSession', 'SpecialDay',
    'SessionModifier', 'DayModifier', 'TimeContext',
    'TimeContextEngine',
    'get_market_session', 'get_special_day',
    'calc_charm_acceleration'
]
