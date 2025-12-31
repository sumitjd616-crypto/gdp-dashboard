"""
TITAN FLOW INTELLIGENCE MODULE
==============================
Options flow analysis using ACCESSIBLE data sources

Features:
- Sweep detection (multi-exchange urgency)
- Block trade identification
- Smart money flow scoring
- Unusual activity detection
- Net premium flow calculation

ACCESSIBLE via:
- Polygon.io options trades
- CBOE/exchange time & sales
- Options volume/OI data

NOT accessible (removed):
- Dark pool prints (requires institutional feeds)
- Exact dealer positioning
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Set
from datetime import datetime, timedelta
from enum import Enum
from collections import defaultdict
import numpy as np


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class FlowConfig:
    """Flow analysis configuration"""
    # Sweep detection
    SWEEP_WINDOW_MS: int = 5000          # 5 seconds
    SWEEP_MIN_SIZE: int = 50             # Minimum contracts
    SWEEP_MIN_EXCHANGES: int = 2         # Minimum exchanges
    
    # Block detection
    BLOCK_SIZE: int = 200                # Large single print
    MEGA_BLOCK_SIZE: int = 1000          # Very large print
    
    # Premium flow
    PREMIUM_LOOKBACK_MIN: int = 30       # 30 minute window
    
    # Unusual activity
    UNUSUAL_SIZE_MULT: float = 3.0       # 3x average
    UNUSUAL_OI_PCT: float = 0.5          # 50% of OI
    
    # Smart money
    SMART_MONEY_MIN_SIZE: int = 100
    SMART_MONEY_EDGE_PCT: float = 0.10   # 10% from mid


CONFIG = FlowConfig()


# ═══════════════════════════════════════════════════════════════════════════════
# ENUMS
# ═══════════════════════════════════════════════════════════════════════════════

class FlowType(Enum):
    SWEEP = "SWEEP"
    BLOCK = "BLOCK"
    MEGA_BLOCK = "MEGA_BLOCK"
    SPLIT = "SPLIT"
    DARK_POOL = "DARK_POOL"
    RETAIL = "RETAIL"


class FlowSide(Enum):
    BUY = "BUY"
    SELL = "SELL"
    NEUTRAL = "NEUTRAL"


class FlowSentiment(Enum):
    BULLISH = "BULLISH"
    BEARISH = "BEARISH"
    NEUTRAL = "NEUTRAL"


class Urgency(Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    AGGRESSIVE = "AGGRESSIVE"


# ═══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class OptionTrade:
    """Single options trade"""
    timestamp: int              # Unix ms
    symbol: str                 # Option symbol
    underlying: str             # SPX, SPY, etc.
    strike: float
    expiry: str                 # YYYY-MM-DD
    option_type: str            # 'call' or 'put'
    
    # Trade details
    size: int
    price: float
    bid: float
    ask: float
    
    # Greeks (if available)
    iv: Optional[float] = None
    delta: Optional[float] = None
    gamma: Optional[float] = None
    vega: Optional[float] = None
    theta: Optional[float] = None
    
    # Context
    exchange: Optional[str] = None
    condition: Optional[str] = None  # Trade condition codes
    oi: Optional[int] = None         # Open interest
    
    @property
    def premium(self) -> float:
        return self.size * self.price * 100
    
    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2
    
    @property
    def spread(self) -> float:
        return self.ask - self.bid
    
    @property
    def edge_from_mid(self) -> float:
        if self.mid == 0:
            return 0
        return (self.price - self.mid) / self.mid
    
    @property
    def side(self) -> FlowSide:
        """Determine buy/sell based on price vs bid/ask"""
        if self.price >= self.ask - 0.01:
            return FlowSide.BUY
        elif self.price <= self.bid + 0.01:
            return FlowSide.SELL
        else:
            return FlowSide.NEUTRAL


@dataclass
class DarkPoolPrint:
    """Dark pool / off-exchange print"""
    timestamp: int
    symbol: str                 # Underlying
    price: float
    size: int
    value: float                # Dollar value
    
    # Classification
    side: FlowSide              # Inferred direction
    venue: str                  # ADF, TRF, etc.
    
    @property
    def is_significant(self) -> bool:
        return self.value >= CONFIG.DP_MIN_VALUE


@dataclass
class Sweep:
    """Detected sweep order"""
    timestamp: int
    strike: float
    expiry: str
    option_type: str
    
    # Aggregated
    total_size: int
    total_premium: float
    trades: List[OptionTrade]
    exchanges: Set[str]
    
    # Classification
    side: FlowSide
    urgency: Urgency
    
    @property
    def exchange_count(self) -> int:
        return len(self.exchanges)
    
    @property
    def avg_price(self) -> float:
        if self.total_size == 0:
            return 0
        return sum(t.price * t.size for t in self.trades) / self.total_size


@dataclass
class Block:
    """Block trade"""
    trade: OptionTrade
    block_type: str             # 'BLOCK' or 'MEGA_BLOCK'
    
    # Analysis
    oi_percentage: Optional[float] = None  # % of open interest
    is_opening: Optional[bool] = None      # New position vs closing


@dataclass 
class FlowAlert:
    """Significant flow alert"""
    timestamp: int
    alert_type: FlowType
    
    # Details
    strike: float
    expiry: str
    option_type: str
    side: FlowSide
    size: int
    premium: float
    
    # Sentiment
    sentiment: FlowSentiment
    urgency: Urgency
    
    # Context
    spot_at_time: float
    distance_from_spot: float
    
    # Score
    significance: float         # 0-100


@dataclass
class FlowSummary:
    """Aggregated flow analysis"""
    timestamp: datetime
    window_minutes: int
    
    # Net flows
    net_call_premium: float
    net_put_premium: float
    net_delta_premium: float    # Call - Put premium
    
    # Counts
    total_trades: int
    sweep_count: int
    block_count: int
    
    # Sentiment
    call_buy_pct: float         # % of call volume that's buying
    put_buy_pct: float          # % of put volume that's buying
    overall_sentiment: FlowSentiment
    
    # Smart money
    smart_money_bias: FlowSide
    smart_money_score: float    # -100 to +100
    
    # Key strikes
    hot_call_strikes: List[Tuple[float, float]]  # (strike, premium)
    hot_put_strikes: List[Tuple[float, float]]
    
    # Alerts
    alerts: List[FlowAlert]


@dataclass
class DarkPoolSummary:
    """Dark pool flow summary"""
    timestamp: datetime
    window_minutes: int
    spot: float
    
    # Aggregates
    total_value: float
    buy_value: float
    sell_value: float
    
    # Metrics
    net_delta: float            # Buy - Sell
    dp_ratio: float             # Buy / Sell
    
    # Significant prints
    significant_prints: List[DarkPoolPrint]
    
    # Bias
    bias: FlowSentiment
    
    # Levels
    accumulation_zones: List[Tuple[float, float]]  # (price, value)
    distribution_zones: List[Tuple[float, float]]


# ═══════════════════════════════════════════════════════════════════════════════
# SWEEP DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def detect_sweeps(trades: List[OptionTrade]) -> List[Sweep]:
    """
    Detect sweep orders from trade stream
    
    Sweeps are aggressive orders that hit multiple exchanges
    within a short time window
    """
    if not trades:
        return []
    
    # Sort by timestamp
    sorted_trades = sorted(trades, key=lambda t: t.timestamp)
    
    # Group potential sweeps
    sweeps = []
    processed = set()
    
    for i, trade in enumerate(sorted_trades):
        if i in processed:
            continue
        
        # Find related trades
        related = [trade]
        related_idx = {i}
        
        for j, other in enumerate(sorted_trades[i+1:], i+1):
            if j in processed:
                continue
            
            # Same contract within time window
            time_diff = other.timestamp - trade.timestamp
            if time_diff > CONFIG.SWEEP_WINDOW_MS:
                break
            
            if (other.strike == trade.strike and 
                other.expiry == trade.expiry and
                other.option_type == trade.option_type and
                other.side == trade.side):
                related.append(other)
                related_idx.add(j)
        
        # Check if it qualifies as sweep
        total_size = sum(t.size for t in related)
        exchanges = set(t.exchange for t in related if t.exchange)
        
        if total_size >= CONFIG.SWEEP_MIN_SIZE and len(exchanges) >= CONFIG.SWEEP_MIN_EXCHANGES:
            # Determine urgency
            avg_edge = np.mean([abs(t.edge_from_mid) for t in related])
            if avg_edge > 0.15:
                urgency = Urgency.AGGRESSIVE
            elif avg_edge > 0.08:
                urgency = Urgency.HIGH
            elif avg_edge > 0.03:
                urgency = Urgency.MEDIUM
            else:
                urgency = Urgency.LOW
            
            sweep = Sweep(
                timestamp=trade.timestamp,
                strike=trade.strike,
                expiry=trade.expiry,
                option_type=trade.option_type,
                total_size=total_size,
                total_premium=sum(t.premium for t in related),
                trades=related,
                exchanges=exchanges,
                side=trade.side,
                urgency=urgency
            )
            sweeps.append(sweep)
            processed.update(related_idx)
    
    return sweeps


# ═══════════════════════════════════════════════════════════════════════════════
# BLOCK DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def detect_blocks(trades: List[OptionTrade]) -> List[Block]:
    """Detect block trades"""
    blocks = []
    
    for trade in trades:
        if trade.size >= CONFIG.MEGA_BLOCK_SIZE:
            block_type = 'MEGA_BLOCK'
        elif trade.size >= CONFIG.BLOCK_SIZE:
            block_type = 'BLOCK'
        else:
            continue
        
        # Calculate OI percentage if available
        oi_pct = None
        is_opening = None
        if trade.oi and trade.oi > 0:
            oi_pct = trade.size / trade.oi
            # If trade is > 50% of OI, likely opening
            is_opening = oi_pct > 0.5
        
        blocks.append(Block(
            trade=trade,
            block_type=block_type,
            oi_percentage=oi_pct,
            is_opening=is_opening
        ))
    
    return blocks


# ═══════════════════════════════════════════════════════════════════════════════
# DARK POOL ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_dark_pool(
    prints: List[DarkPoolPrint],
    spot: float,
    window_minutes: int = 30
) -> DarkPoolSummary:
    """Analyze dark pool prints"""
    now = datetime.now()
    
    if not prints:
        return DarkPoolSummary(
            timestamp=now,
            window_minutes=window_minutes,
            spot=spot,
            total_value=0,
            buy_value=0,
            sell_value=0,
            net_delta=0,
            dp_ratio=1.0,
            significant_prints=[],
            bias=FlowSentiment.NEUTRAL,
            accumulation_zones=[],
            distribution_zones=[]
        )
    
    # Filter to window
    cutoff = int((now - timedelta(minutes=window_minutes)).timestamp() * 1000)
    recent = [p for p in prints if p.timestamp >= cutoff]
    
    # Filter to near spot
    near_spot = [p for p in recent 
                 if abs(p.price - spot) / spot <= CONFIG.DP_SPOT_RANGE]
    
    # Aggregate
    buy_value = sum(p.value for p in near_spot if p.side == FlowSide.BUY)
    sell_value = sum(p.value for p in near_spot if p.side == FlowSide.SELL)
    total_value = buy_value + sell_value
    
    net_delta = buy_value - sell_value
    dp_ratio = buy_value / sell_value if sell_value > 0 else float('inf') if buy_value > 0 else 1.0
    
    # Significant prints
    significant = [p for p in near_spot if p.is_significant]
    significant.sort(key=lambda p: p.value, reverse=True)
    
    # Determine bias
    if dp_ratio > 1.5:
        bias = FlowSentiment.BULLISH
    elif dp_ratio < 0.67:
        bias = FlowSentiment.BEARISH
    else:
        bias = FlowSentiment.NEUTRAL
    
    # Find accumulation/distribution zones
    price_buckets = defaultdict(lambda: {'buy': 0, 'sell': 0})
    bucket_size = spot * 0.002  # 0.2% buckets
    
    for p in near_spot:
        bucket = round(p.price / bucket_size) * bucket_size
        if p.side == FlowSide.BUY:
            price_buckets[bucket]['buy'] += p.value
        else:
            price_buckets[bucket]['sell'] += p.value
    
    accumulation_zones = []
    distribution_zones = []
    
    for price, flows in price_buckets.items():
        net = flows['buy'] - flows['sell']
        if net > CONFIG.DP_MIN_VALUE:
            accumulation_zones.append((price, net))
        elif net < -CONFIG.DP_MIN_VALUE:
            distribution_zones.append((price, abs(net)))
    
    accumulation_zones.sort(key=lambda x: x[1], reverse=True)
    distribution_zones.sort(key=lambda x: x[1], reverse=True)
    
    return DarkPoolSummary(
        timestamp=now,
        window_minutes=window_minutes,
        spot=spot,
        total_value=total_value,
        buy_value=buy_value,
        sell_value=sell_value,
        net_delta=net_delta,
        dp_ratio=dp_ratio,
        significant_prints=significant[:10],
        bias=bias,
        accumulation_zones=accumulation_zones[:5],
        distribution_zones=distribution_zones[:5]
    )


# ═══════════════════════════════════════════════════════════════════════════════
# SMART MONEY DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def detect_smart_money(trades: List[OptionTrade]) -> Tuple[FlowSide, float]:
    """
    Detect smart money flow based on:
    - Large size
    - Execution quality (close to favorable side of spread)
    - Timing (avoiding bad fills)
    """
    if not trades:
        return FlowSide.NEUTRAL, 0.0
    
    smart_trades = []
    
    for trade in trades:
        if trade.size < CONFIG.SMART_MONEY_MIN_SIZE:
            continue
        
        # Check execution quality
        edge = trade.edge_from_mid
        
        # Buyers paying at/above ask with size = smart money bid
        # Sellers hitting at/below bid with size = smart money offer
        if trade.side == FlowSide.BUY and edge >= CONFIG.SMART_MONEY_EDGE_PCT:
            smart_trades.append((trade, 'BUY', trade.premium))
        elif trade.side == FlowSide.SELL and edge <= -CONFIG.SMART_MONEY_EDGE_PCT:
            smart_trades.append((trade, 'SELL', trade.premium))
    
    if not smart_trades:
        return FlowSide.NEUTRAL, 0.0
    
    # Calculate net smart money
    buy_premium = sum(t[2] for t in smart_trades if t[1] == 'BUY')
    sell_premium = sum(t[2] for t in smart_trades if t[1] == 'SELL')
    
    total = buy_premium + sell_premium
    if total == 0:
        return FlowSide.NEUTRAL, 0.0
    
    # Score from -100 to +100
    score = ((buy_premium - sell_premium) / total) * 100
    
    if score > 20:
        bias = FlowSide.BUY
    elif score < -20:
        bias = FlowSide.SELL
    else:
        bias = FlowSide.NEUTRAL
    
    return bias, score


# ═══════════════════════════════════════════════════════════════════════════════
# FLOW SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

def summarize_flow(
    trades: List[OptionTrade],
    spot: float,
    window_minutes: int = 30
) -> FlowSummary:
    """Create comprehensive flow summary"""
    now = datetime.now()
    
    if not trades:
        return FlowSummary(
            timestamp=now,
            window_minutes=window_minutes,
            net_call_premium=0,
            net_put_premium=0,
            net_delta_premium=0,
            total_trades=0,
            sweep_count=0,
            block_count=0,
            call_buy_pct=0.5,
            put_buy_pct=0.5,
            overall_sentiment=FlowSentiment.NEUTRAL,
            smart_money_bias=FlowSide.NEUTRAL,
            smart_money_score=0,
            hot_call_strikes=[],
            hot_put_strikes=[],
            alerts=[]
        )
    
    # Filter to window
    cutoff = int((now - timedelta(minutes=window_minutes)).timestamp() * 1000)
    recent = [t for t in trades if t.timestamp >= cutoff]
    
    # Detect sweeps and blocks
    sweeps = detect_sweeps(recent)
    blocks = detect_blocks(recent)
    
    # Calculate premium flows
    call_trades = [t for t in recent if t.option_type == 'call']
    put_trades = [t for t in recent if t.option_type == 'put']
    
    call_buy = sum(t.premium for t in call_trades if t.side == FlowSide.BUY)
    call_sell = sum(t.premium for t in call_trades if t.side == FlowSide.SELL)
    put_buy = sum(t.premium for t in put_trades if t.side == FlowSide.BUY)
    put_sell = sum(t.premium for t in put_trades if t.side == FlowSide.SELL)
    
    net_call = call_buy - call_sell
    net_put = put_buy - put_sell
    net_delta = net_call - net_put
    
    # Buy percentages
    total_call = call_buy + call_sell
    total_put = put_buy + put_sell
    call_buy_pct = call_buy / total_call if total_call > 0 else 0.5
    put_buy_pct = put_buy / total_put if total_put > 0 else 0.5
    
    # Overall sentiment
    if net_delta > total_call * 0.2:
        sentiment = FlowSentiment.BULLISH
    elif net_delta < -total_put * 0.2:
        sentiment = FlowSentiment.BEARISH
    else:
        sentiment = FlowSentiment.NEUTRAL
    
    # Smart money
    smart_bias, smart_score = detect_smart_money(recent)
    
    # Hot strikes
    call_by_strike = defaultdict(float)
    put_by_strike = defaultdict(float)
    
    for t in call_trades:
        call_by_strike[t.strike] += t.premium if t.side == FlowSide.BUY else -t.premium
    for t in put_trades:
        put_by_strike[t.strike] += t.premium if t.side == FlowSide.BUY else -t.premium
    
    hot_calls = sorted(call_by_strike.items(), key=lambda x: abs(x[1]), reverse=True)[:5]
    hot_puts = sorted(put_by_strike.items(), key=lambda x: abs(x[1]), reverse=True)[:5]
    
    # Generate alerts
    alerts = []
    
    for sweep in sweeps:
        # Determine sentiment
        if sweep.option_type == 'call':
            sent = FlowSentiment.BULLISH if sweep.side == FlowSide.BUY else FlowSentiment.BEARISH
        else:
            sent = FlowSentiment.BEARISH if sweep.side == FlowSide.BUY else FlowSentiment.BULLISH
        
        significance = min(100, sweep.total_premium / 100000 * 20 + sweep.exchange_count * 10)
        
        alerts.append(FlowAlert(
            timestamp=sweep.timestamp,
            alert_type=FlowType.SWEEP,
            strike=sweep.strike,
            expiry=sweep.expiry,
            option_type=sweep.option_type,
            side=sweep.side,
            size=sweep.total_size,
            premium=sweep.total_premium,
            sentiment=sent,
            urgency=sweep.urgency,
            spot_at_time=spot,
            distance_from_spot=sweep.strike - spot,
            significance=significance
        ))
    
    for block in blocks:
        t = block.trade
        if t.option_type == 'call':
            sent = FlowSentiment.BULLISH if t.side == FlowSide.BUY else FlowSentiment.BEARISH
        else:
            sent = FlowSentiment.BEARISH if t.side == FlowSide.BUY else FlowSentiment.BULLISH
        
        significance = min(100, t.premium / 100000 * 30)
        
        alerts.append(FlowAlert(
            timestamp=t.timestamp,
            alert_type=FlowType.MEGA_BLOCK if block.block_type == 'MEGA_BLOCK' else FlowType.BLOCK,
            strike=t.strike,
            expiry=t.expiry,
            option_type=t.option_type,
            side=t.side,
            size=t.size,
            premium=t.premium,
            sentiment=sent,
            urgency=Urgency.HIGH if block.block_type == 'MEGA_BLOCK' else Urgency.MEDIUM,
            spot_at_time=spot,
            distance_from_spot=t.strike - spot,
            significance=significance
        ))
    
    # Sort alerts by significance
    alerts.sort(key=lambda a: a.significance, reverse=True)
    
    return FlowSummary(
        timestamp=now,
        window_minutes=window_minutes,
        net_call_premium=net_call,
        net_put_premium=net_put,
        net_delta_premium=net_delta,
        total_trades=len(recent),
        sweep_count=len(sweeps),
        block_count=len(blocks),
        call_buy_pct=call_buy_pct,
        put_buy_pct=put_buy_pct,
        overall_sentiment=sentiment,
        smart_money_bias=smart_bias,
        smart_money_score=smart_score,
        hot_call_strikes=hot_calls,
        hot_put_strikes=hot_puts,
        alerts=alerts[:20]
    )


# ═══════════════════════════════════════════════════════════════════════════════
# FLOW ENGINE CLASS
# ═══════════════════════════════════════════════════════════════════════════════

class FlowEngine:
    """
    Options Flow Intelligence Engine
    
    Analyzes options flow for trading signals
    """
    
    def __init__(self):
        self.trades: List[OptionTrade] = []
        self.dark_pool_prints: List[DarkPoolPrint] = []
        self.max_trades = 10000
        self.max_prints = 5000
    
    def add_trade(self, trade: OptionTrade):
        """Add single trade"""
        self.trades.append(trade)
        if len(self.trades) > self.max_trades:
            self.trades = self.trades[-self.max_trades:]
    
    def add_trades(self, trades: List[OptionTrade]):
        """Add multiple trades"""
        self.trades.extend(trades)
        if len(self.trades) > self.max_trades:
            self.trades = self.trades[-self.max_trades:]
    
    def add_dark_pool_print(self, print_: DarkPoolPrint):
        """Add dark pool print"""
        self.dark_pool_prints.append(print_)
        if len(self.dark_pool_prints) > self.max_prints:
            self.dark_pool_prints = self.dark_pool_prints[-self.max_prints:]
    
    def get_flow_summary(self, spot: float, window_minutes: int = 30) -> FlowSummary:
        """Get comprehensive flow analysis"""
        return summarize_flow(self.trades, spot, window_minutes)
    
    def get_dark_pool_summary(self, spot: float, window_minutes: int = 30) -> DarkPoolSummary:
        """Get dark pool analysis"""
        return analyze_dark_pool(self.dark_pool_prints, spot, window_minutes)
    
    def get_sweeps(self, window_minutes: int = 30) -> List[Sweep]:
        """Get recent sweeps"""
        now = datetime.now()
        cutoff = int((now - timedelta(minutes=window_minutes)).timestamp() * 1000)
        recent = [t for t in self.trades if t.timestamp >= cutoff]
        return detect_sweeps(recent)
    
    def get_blocks(self, window_minutes: int = 30) -> List[Block]:
        """Get recent blocks"""
        now = datetime.now()
        cutoff = int((now - timedelta(minutes=window_minutes)).timestamp() * 1000)
        recent = [t for t in self.trades if t.timestamp >= cutoff]
        return detect_blocks(recent)
    
    def get_smart_money_signal(self, window_minutes: int = 30) -> Tuple[FlowSide, float]:
        """Get smart money bias"""
        now = datetime.now()
        cutoff = int((now - timedelta(minutes=window_minutes)).timestamp() * 1000)
        recent = [t for t in self.trades if t.timestamp >= cutoff]
        return detect_smart_money(recent)
    
    def reset(self):
        """Clear all data"""
        self.trades = []
        self.dark_pool_prints = []


# ═══════════════════════════════════════════════════════════════════════════════
# EXPORTS
# ═══════════════════════════════════════════════════════════════════════════════

__all__ = [
    'FlowConfig', 'CONFIG',
    'FlowType', 'FlowSide', 'FlowSentiment', 'Urgency',
    'OptionTrade', 'DarkPoolPrint', 'Sweep', 'Block', 'FlowAlert',
    'FlowSummary', 'DarkPoolSummary',
    'FlowEngine',
    'detect_sweeps', 'detect_blocks', 'analyze_dark_pool',
    'detect_smart_money', 'summarize_flow'
]
