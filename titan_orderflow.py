"""
TITAN ORDER FLOW MODULE
========================

Real-time order flow analysis using ACCESSIBLE data:
- ES Futures Order Book (Level 2)
- Cumulative Delta
- Time & Sales / Tape Reading
- Market Internals (TICK, ADD, VOLD, TRIN)

NOT included (requires institutional feeds):
- Dark pool prints
- Exact dealer books
- Prop firm positioning
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from enum import Enum
from datetime import datetime, time as dt_time
from collections import deque
import time


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class OrderFlowConfig:
    # ES Order Book
    BOOK_DEPTH: int = 10  # Levels to analyze
    IMBALANCE_THRESHOLD: float = 0.6  # 60% = significant imbalance
    LARGE_ORDER_SIZE: int = 100  # Contracts considered "large"
    ICEBERG_DETECTION_WINDOW: int = 5  # Seconds to detect iceberg
    
    # Cumulative Delta
    DELTA_DIVERGENCE_THRESHOLD: float = 500  # Contracts
    DELTA_WINDOW_BARS: int = 20
    
    # Tape Reading
    TAPE_WINDOW_SECONDS: int = 30
    AGGRESSIVE_RATIO_THRESHOLD: float = 0.65
    BLOCK_TRADE_SIZE: int = 50  # ES contracts
    
    # Market Internals
    TICK_EXTREME_HIGH: int = 800
    TICK_EXTREME_LOW: int = -800
    TICK_REVERSAL_ZONE: int = 500
    ADD_STRONG_THRESHOLD: int = 1500
    ADD_WEAK_THRESHOLD: int = -1500
    TRIN_OVERSOLD: float = 1.5
    TRIN_OVERBOUGHT: float = 0.7


CFG = OrderFlowConfig()


# ═══════════════════════════════════════════════════════════════════════════════
# ENUMS
# ═══════════════════════════════════════════════════════════════════════════════

class BookSide(Enum):
    BID = "BID"
    ASK = "ASK"

class TradeAggressor(Enum):
    BUYER = "BUYER"    # Lifted the ask
    SELLER = "SELLER"  # Hit the bid
    UNKNOWN = "UNKNOWN"

class DeltaState(Enum):
    STRONG_BUYING = "STRONG_BUYING"
    BUYING = "BUYING"
    NEUTRAL = "NEUTRAL"
    SELLING = "SELLING"
    STRONG_SELLING = "STRONG_SELLING"

class DeltaDivergence(Enum):
    BULLISH_DIV = "BULLISH_DIV"   # Price down, delta up
    BEARISH_DIV = "BEARISH_DIV"  # Price up, delta down
    NONE = "NONE"

class TapeSpeed(Enum):
    FAST = "FAST"      # High frequency, momentum
    NORMAL = "NORMAL"
    SLOW = "SLOW"      # Grinding, low interest

class InternalsSignal(Enum):
    STRONG_BUY = "STRONG_BUY"
    BUY = "BUY"
    NEUTRAL = "NEUTRAL"
    SELL = "SELL"
    STRONG_SELL = "STRONG_SELL"


# ═══════════════════════════════════════════════════════════════════════════════
# DATA STRUCTURES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class BookLevel:
    """Single price level in order book"""
    price: float
    size: int
    order_count: int = 1


@dataclass
class OrderBook:
    """ES Futures order book snapshot"""
    timestamp: int
    bids: List[BookLevel]  # Sorted high to low
    asks: List[BookLevel]  # Sorted low to high
    
    @property
    def best_bid(self) -> Optional[float]:
        return self.bids[0].price if self.bids else None
    
    @property
    def best_ask(self) -> Optional[float]:
        return self.asks[0].price if self.asks else None
    
    @property
    def mid_price(self) -> Optional[float]:
        if self.best_bid and self.best_ask:
            return (self.best_bid + self.best_ask) / 2
        return None
    
    @property
    def spread(self) -> Optional[float]:
        if self.best_bid and self.best_ask:
            return self.best_ask - self.best_bid
        return None


@dataclass
class Trade:
    """Single trade execution"""
    timestamp: int
    price: float
    size: int
    aggressor: TradeAggressor


@dataclass
class BookImbalance:
    """Order book imbalance analysis"""
    bid_total: int
    ask_total: int
    imbalance_ratio: float  # >0.5 = bid heavy, <0.5 = ask heavy
    imbalance_pct: float    # -100% to +100%
    
    # Level-by-level
    stacked_bids: List[Tuple[float, int]]  # Large resting bids
    stacked_asks: List[Tuple[float, int]]  # Large resting asks
    
    # Interpretation
    bias: str  # 'BID_HEAVY', 'ASK_HEAVY', 'BALANCED'
    strength: str  # 'STRONG', 'MODERATE', 'WEAK'


@dataclass
class CumulativeDelta:
    """Cumulative delta analysis"""
    current_delta: int
    session_delta: int
    delta_5min: int
    delta_15min: int
    
    state: DeltaState
    divergence: DeltaDivergence
    
    # Key levels where delta shifted
    delta_highs: List[Tuple[float, int]]  # (price, delta)
    delta_lows: List[Tuple[float, int]]


@dataclass
class TapeAnalysis:
    """Time & Sales / Tape Reading"""
    trades_per_second: float
    speed: TapeSpeed
    
    # Aggression
    buy_volume: int
    sell_volume: int
    aggressive_ratio: float  # % of aggressive trades
    
    # Block trades
    recent_blocks: List[Trade]
    block_bias: str  # 'BULLISH', 'BEARISH', 'MIXED'
    
    # Absorption detection
    absorption_detected: bool
    absorption_side: Optional[str]  # 'BID' or 'ASK'


@dataclass
class MarketInternals:
    """NYSE/Market internals"""
    # TICK - NYSE uptick/downtick
    tick: int
    tick_5min_avg: float
    tick_extreme: bool
    tick_signal: str
    
    # ADD - Advance/Decline
    add: int
    add_signal: str
    
    # VOLD - Up volume minus down volume
    vold: int
    vold_signal: str
    
    # TRIN - Arms Index
    trin: float
    trin_signal: str
    
    # Combined
    overall_signal: InternalsSignal
    breadth_confirmation: bool


@dataclass
class OrderFlowState:
    """Complete order flow analysis"""
    timestamp: datetime
    
    # Order Book
    book: Optional[OrderBook]
    imbalance: Optional[BookImbalance]
    
    # Cumulative Delta
    delta: CumulativeDelta
    
    # Tape
    tape: TapeAnalysis
    
    # Internals
    internals: MarketInternals
    
    # Combined Signal
    flow_bias: str  # 'BULLISH', 'BEARISH', 'NEUTRAL'
    flow_strength: float  # 0-100
    
    # Actionable insights
    key_insight: str
    warnings: List[str]


# ═══════════════════════════════════════════════════════════════════════════════
# ORDER BOOK ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_order_book(book: OrderBook) -> BookImbalance:
    """Analyze order book for imbalances and key levels"""
    
    bid_total = sum(level.size for level in book.bids[:CFG.BOOK_DEPTH])
    ask_total = sum(level.size for level in book.asks[:CFG.BOOK_DEPTH])
    
    total = bid_total + ask_total
    if total == 0:
        return BookImbalance(0, 0, 0.5, 0, [], [], 'BALANCED', 'WEAK')
    
    imbalance_ratio = bid_total / total
    imbalance_pct = (bid_total - ask_total) / total * 100
    
    # Find stacked levels (large resting orders)
    stacked_bids = [(l.price, l.size) for l in book.bids 
                   if l.size >= CFG.LARGE_ORDER_SIZE]
    stacked_asks = [(l.price, l.size) for l in book.asks 
                   if l.size >= CFG.LARGE_ORDER_SIZE]
    
    # Determine bias
    if imbalance_ratio > CFG.IMBALANCE_THRESHOLD:
        bias = 'BID_HEAVY'
    elif imbalance_ratio < (1 - CFG.IMBALANCE_THRESHOLD):
        bias = 'ASK_HEAVY'
    else:
        bias = 'BALANCED'
    
    # Determine strength
    diff = abs(imbalance_ratio - 0.5)
    if diff > 0.25:
        strength = 'STRONG'
    elif diff > 0.1:
        strength = 'MODERATE'
    else:
        strength = 'WEAK'
    
    return BookImbalance(
        bid_total=bid_total,
        ask_total=ask_total,
        imbalance_ratio=imbalance_ratio,
        imbalance_pct=imbalance_pct,
        stacked_bids=stacked_bids,
        stacked_asks=stacked_asks,
        bias=bias,
        strength=strength
    )


# ═══════════════════════════════════════════════════════════════════════════════
# CUMULATIVE DELTA
# ═══════════════════════════════════════════════════════════════════════════════

class DeltaTracker:
    """Track cumulative delta over time"""
    
    def __init__(self):
        self.session_delta = 0
        self.delta_history: deque = deque(maxlen=1000)  # (timestamp, price, delta)
        self.bar_deltas: deque = deque(maxlen=CFG.DELTA_WINDOW_BARS)
        self.current_bar_delta = 0
        self.current_bar_start = 0
    
    def add_trade(self, trade: Trade, bar_interval_ms: int = 60000):
        """Add trade and update delta"""
        # Determine delta contribution
        if trade.aggressor == TradeAggressor.BUYER:
            delta = trade.size
        elif trade.aggressor == TradeAggressor.SELLER:
            delta = -trade.size
        else:
            delta = 0
        
        self.session_delta += delta
        self.current_bar_delta += delta
        
        # Track history
        self.delta_history.append((trade.timestamp, trade.price, self.session_delta))
        
        # Bar rollover
        if self.current_bar_start == 0:
            self.current_bar_start = trade.timestamp
        elif trade.timestamp - self.current_bar_start >= bar_interval_ms:
            self.bar_deltas.append(self.current_bar_delta)
            self.current_bar_delta = 0
            self.current_bar_start = trade.timestamp
    
    def get_analysis(self, current_price: float) -> CumulativeDelta:
        """Get cumulative delta analysis"""
        
        # Calculate rolling deltas
        delta_5min = sum(list(self.bar_deltas)[-5:]) if self.bar_deltas else 0
        delta_15min = sum(list(self.bar_deltas)[-15:]) if self.bar_deltas else 0
        
        # Determine state
        if self.session_delta > CFG.DELTA_DIVERGENCE_THRESHOLD * 2:
            state = DeltaState.STRONG_BUYING
        elif self.session_delta > CFG.DELTA_DIVERGENCE_THRESHOLD:
            state = DeltaState.BUYING
        elif self.session_delta < -CFG.DELTA_DIVERGENCE_THRESHOLD * 2:
            state = DeltaState.STRONG_SELLING
        elif self.session_delta < -CFG.DELTA_DIVERGENCE_THRESHOLD:
            state = DeltaState.SELLING
        else:
            state = DeltaState.NEUTRAL
        
        # Detect divergence
        divergence = DeltaDivergence.NONE
        if len(self.delta_history) >= 10:
            recent = list(self.delta_history)[-10:]
            price_change = recent[-1][1] - recent[0][1]
            delta_change = recent[-1][2] - recent[0][2]
            
            if price_change < -0.5 and delta_change > CFG.DELTA_DIVERGENCE_THRESHOLD / 2:
                divergence = DeltaDivergence.BULLISH_DIV
            elif price_change > 0.5 and delta_change < -CFG.DELTA_DIVERGENCE_THRESHOLD / 2:
                divergence = DeltaDivergence.BEARISH_DIV
        
        # Find delta highs/lows
        delta_highs = []
        delta_lows = []
        if self.delta_history:
            history = list(self.delta_history)
            max_delta = max(history, key=lambda x: x[2])
            min_delta = min(history, key=lambda x: x[2])
            delta_highs = [(max_delta[1], max_delta[2])]
            delta_lows = [(min_delta[1], min_delta[2])]
        
        return CumulativeDelta(
            current_delta=self.current_bar_delta,
            session_delta=self.session_delta,
            delta_5min=delta_5min,
            delta_15min=delta_15min,
            state=state,
            divergence=divergence,
            delta_highs=delta_highs,
            delta_lows=delta_lows
        )
    
    def reset_session(self):
        """Reset for new session"""
        self.session_delta = 0
        self.delta_history.clear()
        self.bar_deltas.clear()
        self.current_bar_delta = 0
        self.current_bar_start = 0


# ═══════════════════════════════════════════════════════════════════════════════
# TAPE READING / TIME & SALES
# ═══════════════════════════════════════════════════════════════════════════════

class TapeReader:
    """Analyze time & sales for trading signals"""
    
    def __init__(self):
        self.trades: deque = deque(maxlen=5000)
        self.blocks: deque = deque(maxlen=100)
    
    def add_trade(self, trade: Trade):
        """Add trade to tape"""
        self.trades.append(trade)
        
        # Check for block trade
        if trade.size >= CFG.BLOCK_TRADE_SIZE:
            self.blocks.append(trade)
    
    def analyze(self) -> TapeAnalysis:
        """Analyze recent tape activity"""
        now = int(time.time() * 1000)
        window_ms = CFG.TAPE_WINDOW_SECONDS * 1000
        
        # Filter to recent window
        recent = [t for t in self.trades if t.timestamp > now - window_ms]
        
        if not recent:
            return TapeAnalysis(
                trades_per_second=0,
                speed=TapeSpeed.SLOW,
                buy_volume=0,
                sell_volume=0,
                aggressive_ratio=0.5,
                recent_blocks=[],
                block_bias='MIXED',
                absorption_detected=False,
                absorption_side=None
            )
        
        # Calculate speed
        duration = (recent[-1].timestamp - recent[0].timestamp) / 1000 if len(recent) > 1 else 1
        trades_per_second = len(recent) / max(1, duration)
        
        if trades_per_second > 10:
            speed = TapeSpeed.FAST
        elif trades_per_second > 3:
            speed = TapeSpeed.NORMAL
        else:
            speed = TapeSpeed.SLOW
        
        # Calculate aggression
        buy_volume = sum(t.size for t in recent if t.aggressor == TradeAggressor.BUYER)
        sell_volume = sum(t.size for t in recent if t.aggressor == TradeAggressor.SELLER)
        total_volume = buy_volume + sell_volume
        
        aggressive_ratio = max(buy_volume, sell_volume) / total_volume if total_volume > 0 else 0.5
        
        # Recent blocks
        recent_blocks = [b for b in self.blocks if b.timestamp > now - window_ms]
        
        # Block bias
        block_buy = sum(b.size for b in recent_blocks if b.aggressor == TradeAggressor.BUYER)
        block_sell = sum(b.size for b in recent_blocks if b.aggressor == TradeAggressor.SELLER)
        
        if block_buy > block_sell * 1.5:
            block_bias = 'BULLISH'
        elif block_sell > block_buy * 1.5:
            block_bias = 'BEARISH'
        else:
            block_bias = 'MIXED'
        
        # Absorption detection (high volume at a price without price change)
        absorption_detected = False
        absorption_side = None
        
        if len(recent) >= 20:
            # Check if high volume but price stable
            prices = [t.price for t in recent]
            price_range = max(prices) - min(prices)
            
            if price_range < 0.5 and total_volume > 200:
                # High volume, low movement = absorption
                absorption_detected = True
                if buy_volume > sell_volume:
                    absorption_side = 'BID'  # Bids absorbing
                else:
                    absorption_side = 'ASK'  # Asks absorbing
        
        return TapeAnalysis(
            trades_per_second=trades_per_second,
            speed=speed,
            buy_volume=buy_volume,
            sell_volume=sell_volume,
            aggressive_ratio=aggressive_ratio,
            recent_blocks=recent_blocks,
            block_bias=block_bias,
            absorption_detected=absorption_detected,
            absorption_side=absorption_side
        )


# ═══════════════════════════════════════════════════════════════════════════════
# MARKET INTERNALS
# ═══════════════════════════════════════════════════════════════════════════════

class InternalsTracker:
    """Track NYSE/market internals"""
    
    def __init__(self):
        self.tick_history: deque = deque(maxlen=100)
        self.add_history: deque = deque(maxlen=100)
        self.vold_history: deque = deque(maxlen=100)
        self.trin_history: deque = deque(maxlen=100)
    
    def update(self, tick: int, add: int, vold: int, trin: float):
        """Update internals"""
        now = int(time.time() * 1000)
        self.tick_history.append((now, tick))
        self.add_history.append((now, add))
        self.vold_history.append((now, vold))
        self.trin_history.append((now, trin))
    
    def analyze(self) -> MarketInternals:
        """Analyze current internals"""
        
        # TICK
        tick = self.tick_history[-1][1] if self.tick_history else 0
        tick_5min = np.mean([t[1] for t in list(self.tick_history)[-30:]]) if len(self.tick_history) >= 5 else tick
        
        tick_extreme = abs(tick) > CFG.TICK_EXTREME_HIGH
        
        if tick > CFG.TICK_EXTREME_HIGH:
            tick_signal = 'EXTREME_HIGH'
        elif tick > CFG.TICK_REVERSAL_ZONE:
            tick_signal = 'BULLISH'
        elif tick < CFG.TICK_EXTREME_LOW:
            tick_signal = 'EXTREME_LOW'
        elif tick < -CFG.TICK_REVERSAL_ZONE:
            tick_signal = 'BEARISH'
        else:
            tick_signal = 'NEUTRAL'
        
        # ADD
        add = self.add_history[-1][1] if self.add_history else 0
        
        if add > CFG.ADD_STRONG_THRESHOLD:
            add_signal = 'STRONG_BULLISH'
        elif add > 500:
            add_signal = 'BULLISH'
        elif add < CFG.ADD_WEAK_THRESHOLD:
            add_signal = 'STRONG_BEARISH'
        elif add < -500:
            add_signal = 'BEARISH'
        else:
            add_signal = 'NEUTRAL'
        
        # VOLD
        vold = self.vold_history[-1][1] if self.vold_history else 0
        
        if vold > 500_000_000:
            vold_signal = 'STRONG_BULLISH'
        elif vold > 0:
            vold_signal = 'BULLISH'
        elif vold < -500_000_000:
            vold_signal = 'STRONG_BEARISH'
        elif vold < 0:
            vold_signal = 'BEARISH'
        else:
            vold_signal = 'NEUTRAL'
        
        # TRIN
        trin = self.trin_history[-1][1] if self.trin_history else 1.0
        
        if trin > CFG.TRIN_OVERSOLD:
            trin_signal = 'OVERSOLD'  # Bullish (contrarian)
        elif trin < CFG.TRIN_OVERBOUGHT:
            trin_signal = 'OVERBOUGHT'  # Bearish (contrarian)
        else:
            trin_signal = 'NEUTRAL'
        
        # Combined signal
        bullish_count = sum([
            1 if 'BULLISH' in s else 0 
            for s in [tick_signal, add_signal, vold_signal]
        ])
        bullish_count += 1 if trin_signal == 'OVERSOLD' else 0
        
        bearish_count = sum([
            1 if 'BEARISH' in s else 0 
            for s in [tick_signal, add_signal, vold_signal]
        ])
        bearish_count += 1 if trin_signal == 'OVERBOUGHT' else 0
        
        if bullish_count >= 3:
            overall = InternalsSignal.STRONG_BUY
        elif bullish_count >= 2:
            overall = InternalsSignal.BUY
        elif bearish_count >= 3:
            overall = InternalsSignal.STRONG_SELL
        elif bearish_count >= 2:
            overall = InternalsSignal.SELL
        else:
            overall = InternalsSignal.NEUTRAL
        
        # Breadth confirmation (ADD + TICK aligned with price)
        breadth_confirmation = (
            (add_signal in ['BULLISH', 'STRONG_BULLISH'] and 'BULLISH' in tick_signal) or
            (add_signal in ['BEARISH', 'STRONG_BEARISH'] and 'BEARISH' in tick_signal)
        )
        
        return MarketInternals(
            tick=tick,
            tick_5min_avg=tick_5min,
            tick_extreme=tick_extreme,
            tick_signal=tick_signal,
            add=add,
            add_signal=add_signal,
            vold=vold,
            vold_signal=vold_signal,
            trin=trin,
            trin_signal=trin_signal,
            overall_signal=overall,
            breadth_confirmation=breadth_confirmation
        )


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ORDER FLOW ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class OrderFlowEngine:
    """
    Complete order flow analysis engine
    
    Uses ACCESSIBLE data:
    - ES Futures order book (via broker API or data feed)
    - Time & Sales (trade data)
    - Market internals (TICK, ADD, VOLD, TRIN from any data provider)
    
    NOT using:
    - Dark pool (requires institutional feeds)
    - Prop firm positions (not public)
    """
    
    def __init__(self):
        self.delta_tracker = DeltaTracker()
        self.tape_reader = TapeReader()
        self.internals_tracker = InternalsTracker()
        self.current_book: Optional[OrderBook] = None
    
    def update_book(self, book: OrderBook):
        """Update order book"""
        self.current_book = book
    
    def add_trade(self, trade: Trade):
        """Add trade for delta and tape analysis"""
        self.delta_tracker.add_trade(trade)
        self.tape_reader.add_trade(trade)
    
    def update_internals(self, tick: int, add: int, vold: int, trin: float):
        """Update market internals"""
        self.internals_tracker.update(tick, add, vold, trin)
    
    def analyze(self, current_price: float) -> OrderFlowState:
        """Run complete order flow analysis"""
        
        # Book analysis
        book_imbalance = None
        if self.current_book:
            book_imbalance = analyze_order_book(self.current_book)
        
        # Delta analysis
        delta = self.delta_tracker.get_analysis(current_price)
        
        # Tape analysis
        tape = self.tape_reader.analyze()
        
        # Internals
        internals = self.internals_tracker.analyze()
        
        # Combined flow bias
        bullish_signals = 0
        bearish_signals = 0
        
        # From delta
        if delta.state in [DeltaState.BUYING, DeltaState.STRONG_BUYING]:
            bullish_signals += 2 if delta.state == DeltaState.STRONG_BUYING else 1
        elif delta.state in [DeltaState.SELLING, DeltaState.STRONG_SELLING]:
            bearish_signals += 2 if delta.state == DeltaState.STRONG_SELLING else 1
        
        # From tape
        if tape.block_bias == 'BULLISH':
            bullish_signals += 1
        elif tape.block_bias == 'BEARISH':
            bearish_signals += 1
        
        # From internals
        if internals.overall_signal in [InternalsSignal.BUY, InternalsSignal.STRONG_BUY]:
            bullish_signals += 2 if internals.overall_signal == InternalsSignal.STRONG_BUY else 1
        elif internals.overall_signal in [InternalsSignal.SELL, InternalsSignal.STRONG_SELL]:
            bearish_signals += 2 if internals.overall_signal == InternalsSignal.STRONG_SELL else 1
        
        # From book imbalance
        if book_imbalance:
            if book_imbalance.bias == 'BID_HEAVY':
                bullish_signals += 1
            elif book_imbalance.bias == 'ASK_HEAVY':
                bearish_signals += 1
        
        # Determine bias
        if bullish_signals > bearish_signals + 2:
            flow_bias = 'BULLISH'
        elif bearish_signals > bullish_signals + 2:
            flow_bias = 'BEARISH'
        else:
            flow_bias = 'NEUTRAL'
        
        # Flow strength
        total_signals = bullish_signals + bearish_signals
        if total_signals > 0:
            flow_strength = max(bullish_signals, bearish_signals) / total_signals * 100
        else:
            flow_strength = 50
        
        # Key insight
        insights = []
        warnings = []
        
        if delta.divergence != DeltaDivergence.NONE:
            insights.append(f"⚠️ {delta.divergence.value}: Price/Delta diverging")
        
        if tape.absorption_detected:
            insights.append(f"🛡️ Absorption at {tape.absorption_side}: Large orders being absorbed")
        
        if internals.tick_extreme:
            if internals.tick > 0:
                warnings.append("⚠️ TICK EXTREME HIGH - Potential reversal zone")
            else:
                warnings.append("⚠️ TICK EXTREME LOW - Potential reversal zone")
        
        if internals.breadth_confirmation:
            insights.append("✅ Breadth confirming direction")
        
        if book_imbalance and book_imbalance.strength == 'STRONG':
            insights.append(f"📊 Strong {book_imbalance.bias} order book imbalance")
        
        key_insight = insights[0] if insights else "No significant order flow signals"
        
        return OrderFlowState(
            timestamp=datetime.now(),
            book=self.current_book,
            imbalance=book_imbalance,
            delta=delta,
            tape=tape,
            internals=internals,
            flow_bias=flow_bias,
            flow_strength=flow_strength,
            key_insight=key_insight,
            warnings=warnings
        )
    
    def reset_session(self):
        """Reset for new trading session"""
        self.delta_tracker.reset_session()


# ═══════════════════════════════════════════════════════════════════════════════
# DEMO
# ═══════════════════════════════════════════════════════════════════════════════

def demo():
    """Demo order flow analysis"""
    print("=" * 80)
    print("TITAN ORDER FLOW MODULE — DEMO")
    print("=" * 80)
    
    engine = OrderFlowEngine()
    
    # Simulate some trades
    now = int(time.time() * 1000)
    for i in range(50):
        trade = Trade(
            timestamp=now + i * 100,
            price=5950 + np.random.normal(0, 0.5),
            size=np.random.randint(1, 30),
            aggressor=TradeAggressor.BUYER if np.random.random() > 0.45 else TradeAggressor.SELLER
        )
        engine.add_trade(trade)
    
    # Simulate order book
    book = OrderBook(
        timestamp=now,
        bids=[BookLevel(5950 - i * 0.25, np.random.randint(50, 200)) for i in range(10)],
        asks=[BookLevel(5950.25 + i * 0.25, np.random.randint(40, 180)) for i in range(10)]
    )
    engine.update_book(book)
    
    # Simulate internals
    engine.update_internals(
        tick=450,
        add=1200,
        vold=300_000_000,
        trin=0.95
    )
    
    # Analyze
    state = engine.analyze(5950)
    
    print(f"""
📊 ORDER FLOW ANALYSIS
═══════════════════════════════════════════════════════════════════════════════

🎯 FLOW BIAS: {state.flow_bias} ({state.flow_strength:.0f}%)

📈 CUMULATIVE DELTA
   Session: {state.delta.session_delta:+d}
   5min: {state.delta.delta_5min:+d}
   State: {state.delta.state.value}
   Divergence: {state.delta.divergence.value}

📋 TAPE READING
   Speed: {state.tape.speed.value} ({state.tape.trades_per_second:.1f}/sec)
   Buy Vol: {state.tape.buy_volume}
   Sell Vol: {state.tape.sell_volume}
   Block Bias: {state.tape.block_bias}
   Absorption: {'YES - ' + state.tape.absorption_side if state.tape.absorption_detected else 'No'}

📊 MARKET INTERNALS
   TICK: {state.internals.tick} ({state.internals.tick_signal})
   ADD: {state.internals.add} ({state.internals.add_signal})
   VOLD: {state.internals.vold:,} ({state.internals.vold_signal})
   TRIN: {state.internals.trin:.2f} ({state.internals.trin_signal})
   Overall: {state.internals.overall_signal.value}
   Breadth Confirm: {'✅' if state.internals.breadth_confirmation else '❌'}

📕 ORDER BOOK
   Imbalance: {state.imbalance.bias if state.imbalance else 'N/A'}
   Bid Total: {state.imbalance.bid_total if state.imbalance else 0}
   Ask Total: {state.imbalance.ask_total if state.imbalance else 0}

💡 KEY INSIGHT
   {state.key_insight}

{'⚠️ WARNINGS: ' + ', '.join(state.warnings) if state.warnings else ''}
═══════════════════════════════════════════════════════════════════════════════
""")


if __name__ == "__main__":
    demo()
