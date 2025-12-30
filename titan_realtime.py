"""
TITAN REALTIME — Dealer Flow Intelligence System
================================================

This system answers ONE question:
"Why is price moving and where will dealers be FORCED to hedge?"

Core Insight:
- Dealers are SHORT gamma to retail
- When price moves, dealers MUST hedge
- This hedging AMPLIFIES the move
- We can calculate WHERE this happens

Data Sources:
- Polygon.io for options chain + trades
- Real-time GEX calculation
- Options flow tracking
- Print tape analysis

NOT predictions — MECHANICS.
"""

import os
import asyncio
import aiohttp
import json
import time
import numpy as np
from datetime import datetime, date, timedelta
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Callable
from collections import defaultdict, deque
from enum import Enum
import threading
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')
logger = logging.getLogger('TITAN')


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class Config:
    """System configuration"""
    # API
    POLYGON_API_KEY: str = os.getenv('POLYGON_API_KEY', '')
    
    # Symbols
    UNDERLYING: str = 'SPY'  # SPY for liquidity, scale to SPX
    SPX_MULTIPLIER: float = 10.0  # SPY * 10 ≈ SPX
    
    # GEX Calculation
    CONTRACT_MULTIPLIER: int = 100
    GEX_THRESHOLD: float = 500_000_000  # $500M GEX is significant
    
    # Flow Detection
    LARGE_TRADE_SIZE: int = 100  # 100+ contracts = notable
    SWEEP_WINDOW_MS: int = 3000  # 3 seconds
    SWEEP_MIN_EXCHANGES: int = 2
    BLOCK_SIZE: int = 500  # 500+ = block
    
    # Levels
    STRIKE_RANGE_PCT: float = 0.03  # +/- 3% from spot
    SIGNIFICANT_OI: int = 5000  # 5000+ OI = significant strike
    
    # Signals
    HEDGE_ACCELERATION_THRESHOLD: float = 0.02  # 2% move triggers acceleration


CONFIG = Config()


# ═══════════════════════════════════════════════════════════════════════════════
# CORE DATA STRUCTURES
# ═══════════════════════════════════════════════════════════════════════════════

class DealerPosition(Enum):
    """Dealer gamma position"""
    LONG_GAMMA = "LONG_GAMMA"    # Dealers sell into rallies, buy dips (mean reversion)
    SHORT_GAMMA = "SHORT_GAMMA"  # Dealers buy rallies, sell dips (trend acceleration)
    NEUTRAL = "NEUTRAL"


class FlowType(Enum):
    """Type of options flow"""
    SWEEP_CALL_BUY = "SWEEP_CALL_BUY"
    SWEEP_CALL_SELL = "SWEEP_CALL_SELL"
    SWEEP_PUT_BUY = "SWEEP_PUT_BUY"
    SWEEP_PUT_SELL = "SWEEP_PUT_SELL"
    BLOCK_CALL = "BLOCK_CALL"
    BLOCK_PUT = "BLOCK_PUT"
    OPENING = "OPENING"
    CLOSING = "CLOSING"


@dataclass
class OptionContract:
    """Live option contract data"""
    symbol: str
    strike: float
    expiry: str
    option_type: str  # 'call' or 'put'
    
    # Greeks
    delta: float = 0.0
    gamma: float = 0.0
    theta: float = 0.0
    vega: float = 0.0
    iv: float = 0.0
    
    # Positioning
    oi: int = 0
    volume: int = 0
    
    # Prices
    bid: float = 0.0
    ask: float = 0.0
    last: float = 0.0
    
    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2
    
    @property
    def dealer_gamma(self) -> float:
        """
        Dealer gamma exposure from this contract.
        Dealers are SHORT what retail is LONG.
        - Retail buys calls → Dealer short calls → Dealer SHORT gamma
        - Retail buys puts → Dealer short puts → Dealer LONG gamma (puts have negative gamma effect)
        
        Net effect: Call OI creates negative dealer gamma, Put OI creates positive dealer gamma
        """
        gamma_exposure = self.gamma * self.oi * CONFIG.CONTRACT_MULTIPLIER
        
        if self.option_type == 'call':
            return -gamma_exposure  # Dealers short calls = short gamma
        else:
            return gamma_exposure   # Dealers short puts = long gamma (hedging flipped)


@dataclass
class OptionTrade:
    """Single options trade from tape"""
    timestamp: int
    symbol: str
    strike: float
    expiry: str
    option_type: str
    
    size: int
    price: float
    bid: float
    ask: float
    
    exchange: str = ""
    conditions: List[str] = field(default_factory=list)
    
    @property
    def side(self) -> str:
        """Infer trade direction"""
        if self.price >= self.ask - 0.02:
            return "BUY"
        elif self.price <= self.bid + 0.02:
            return "SELL"
        return "MID"
    
    @property
    def premium(self) -> float:
        return self.size * self.price * CONFIG.CONTRACT_MULTIPLIER
    
    @property
    def is_aggressive(self) -> bool:
        """Aggressive = paying up for fills"""
        return self.side == "BUY" and self.price > (self.bid + self.ask) / 2 + 0.05


@dataclass
class GEXLevel:
    """Gamma exposure at a specific strike"""
    strike: float
    call_gex: float  # Gamma exposure from calls
    put_gex: float   # Gamma exposure from puts
    net_gex: float   # Net gamma exposure
    call_oi: int
    put_oi: int
    
    @property
    def is_significant(self) -> bool:
        return abs(self.net_gex) > CONFIG.GEX_THRESHOLD / 10
    
    @property
    def type(self) -> str:
        if self.net_gex > 0:
            return "SUPPORT"  # Positive gamma = dealers buy dips here
        else:
            return "RESISTANCE"  # Negative gamma = dealers sell rallies here


@dataclass
class DealerProfile:
    """Current dealer positioning"""
    timestamp: datetime
    spot: float
    
    # Aggregate GEX
    total_gex: float
    call_gex: float
    put_gex: float
    
    # Key levels
    gamma_flip: float  # Where dealer position flips
    max_gamma_strike: float  # Highest absolute gamma
    zero_gamma_band: Tuple[float, float]  # Range where gamma is ~neutral
    
    # Position
    dealer_position: DealerPosition
    
    # Levels
    support_levels: List[GEXLevel]  # Strikes with positive gamma (support)
    resistance_levels: List[GEXLevel]  # Strikes with negative gamma (resistance)
    
    # Hedging dynamics
    hedge_pressure: float  # -1 to +1, which way dealers need to hedge
    acceleration_zone: bool  # Are we in a zone where moves accelerate?
    
    @property
    def regime_description(self) -> str:
        if self.dealer_position == DealerPosition.LONG_GAMMA:
            return "DEALERS LONG GAMMA: Will sell rallies, buy dips. Expect MEAN REVERSION."
        elif self.dealer_position == DealerPosition.SHORT_GAMMA:
            return "DEALERS SHORT GAMMA: Will buy rallies, sell dips. Expect TREND ACCELERATION."
        else:
            return "DEALERS NEUTRAL: Mixed hedging behavior."


@dataclass
class FlowSignal:
    """Detected institutional flow signal"""
    timestamp: int
    signal_type: FlowType
    
    strike: float
    expiry: str
    option_type: str
    
    size: int
    premium: float
    
    # Analysis
    is_opening: bool  # New position vs closing
    aggression: float  # 0-1, how aggressive
    exchanges: List[str]
    
    # Interpretation
    bias: str  # BULLISH, BEARISH
    urgency: str  # LOW, MEDIUM, HIGH, EXTREME
    
    @property
    def description(self) -> str:
        return f"{self.signal_type.value}: {self.size} {self.option_type}s @ {self.strike} ({self.bias}, {self.urgency})"


@dataclass
class MarketState:
    """Complete market state snapshot"""
    timestamp: datetime
    
    # Price
    spot: float
    spot_change: float
    spot_velocity: float  # Points per minute
    
    # Dealer positioning
    dealer: DealerProfile
    
    # Recent flow
    recent_signals: List[FlowSignal]
    net_call_premium: float
    net_put_premium: float
    
    # Key insight
    primary_driver: str  # What's driving price right now
    expected_behavior: str  # What to expect next
    
    # Actionable
    key_levels: Dict[str, float]  # support_1, support_2, resistance_1, etc.
    trade_bias: str  # LONG, SHORT, NEUTRAL
    conviction: float  # 0-100


# ═══════════════════════════════════════════════════════════════════════════════
# POLYGON API CLIENT
# ═══════════════════════════════════════════════════════════════════════════════

class PolygonClient:
    """
    Polygon.io API client for real-time options data
    """
    
    BASE_URL = "https://api.polygon.io"
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, *args):
        if self.session:
            await self.session.close()
    
    async def _get(self, endpoint: str, params: dict = None) -> dict:
        """Make API request"""
        if not self.session:
            self.session = aiohttp.ClientSession()
        
        params = params or {}
        params['apiKey'] = self.api_key
        
        url = f"{self.BASE_URL}{endpoint}"
        
        try:
            async with self.session.get(url, params=params, timeout=10) as resp:
                if resp.status == 200:
                    return await resp.json()
                else:
                    logger.error(f"API error {resp.status}: {await resp.text()}")
                    return {}
        except Exception as e:
            logger.error(f"Request failed: {e}")
            return {}
    
    async def get_spot_price(self, symbol: str = "SPY") -> float:
        """Get current price"""
        data = await self._get(f"/v2/last/trade/{symbol}")
        if data and 'results' in data:
            return data['results'].get('p', 0)
        return 0
    
    async def get_options_chain(self, underlying: str, expiry: str = None) -> List[OptionContract]:
        """
        Get full options chain with Greeks
        """
        contracts = []
        
        # Get expiries if not specified
        if not expiry:
            expiry = date.today().strftime("%Y-%m-%d")
        
        # Snapshot endpoint gives us everything
        endpoint = f"/v3/snapshot/options/{underlying}"
        params = {
            "expiration_date": expiry,
            "limit": 250
        }
        
        data = await self._get(endpoint, params)
        
        if not data or 'results' not in data:
            return contracts
        
        for item in data['results']:
            details = item.get('details', {})
            greeks = item.get('greeks', {})
            day = item.get('day', {})
            
            contract = OptionContract(
                symbol=details.get('ticker', ''),
                strike=details.get('strike_price', 0),
                expiry=details.get('expiration_date', ''),
                option_type=details.get('contract_type', '').lower(),
                delta=greeks.get('delta', 0),
                gamma=greeks.get('gamma', 0),
                theta=greeks.get('theta', 0),
                vega=greeks.get('vega', 0),
                iv=item.get('implied_volatility', 0),
                oi=item.get('open_interest', 0),
                volume=day.get('volume', 0),
                bid=item.get('last_quote', {}).get('bid', 0),
                ask=item.get('last_quote', {}).get('ask', 0),
                last=day.get('close', 0)
            )
            contracts.append(contract)
        
        return contracts
    
    async def get_options_trades(self, underlying: str, limit: int = 100) -> List[OptionTrade]:
        """
        Get recent options trades
        """
        trades = []
        
        endpoint = f"/v3/trades/O:{underlying}"
        params = {"limit": limit, "order": "desc"}
        
        data = await self._get(endpoint, params)
        
        if not data or 'results' not in data:
            return trades
        
        for item in data['results']:
            # Parse option symbol to get details
            symbol = item.get('ticker', '')
            # O:SPY230616C00450000 format
            
            trade = OptionTrade(
                timestamp=item.get('sip_timestamp', 0),
                symbol=symbol,
                strike=0,  # Parse from symbol
                expiry='',
                option_type='call' if 'C' in symbol else 'put',
                size=item.get('size', 0),
                price=item.get('price', 0),
                bid=0,
                ask=0,
                exchange=item.get('exchange', ''),
                conditions=item.get('conditions', [])
            )
            trades.append(trade)
        
        return trades


# ═══════════════════════════════════════════════════════════════════════════════
# GEX CALCULATOR
# ═══════════════════════════════════════════════════════════════════════════════

class GEXCalculator:
    """
    Calculate Gamma Exposure (GEX) and dealer positioning
    
    THE KEY INSIGHT:
    - Market makers are short options to retail
    - They must delta hedge
    - Gamma tells us how much they need to hedge per $1 move
    - GEX = Gamma × OI × 100 × Spot
    
    POSITIVE GEX (Dealer Long Gamma):
    - Dealers SELL into rallies (supply)
    - Dealers BUY into dips (demand)
    - Result: MEAN REVERSION, lower volatility
    
    NEGATIVE GEX (Dealer Short Gamma):
    - Dealers BUY into rallies (add fuel)
    - Dealers SELL into dips (add pressure)
    - Result: TREND ACCELERATION, higher volatility
    """
    
    def __init__(self):
        self.last_calculation: Optional[DealerProfile] = None
    
    def calculate(self, contracts: List[OptionContract], spot: float) -> DealerProfile:
        """
        Calculate complete dealer positioning
        """
        now = datetime.now()
        
        # Filter to relevant strikes
        min_strike = spot * (1 - CONFIG.STRIKE_RANGE_PCT)
        max_strike = spot * (1 + CONFIG.STRIKE_RANGE_PCT)
        
        relevant = [c for c in contracts if min_strike <= c.strike <= max_strike]
        
        if not relevant:
            return self._empty_profile(now, spot)
        
        # Calculate GEX by strike
        strike_gex: Dict[float, GEXLevel] = {}
        
        for contract in relevant:
            strike = contract.strike
            
            if strike not in strike_gex:
                strike_gex[strike] = GEXLevel(
                    strike=strike,
                    call_gex=0,
                    put_gex=0,
                    net_gex=0,
                    call_oi=0,
                    put_oi=0
                )
            
            level = strike_gex[strike]
            
            # GEX = Gamma × OI × 100 × Spot
            # Dealer perspective: short what retail is long
            gex = contract.gamma * contract.oi * CONFIG.CONTRACT_MULTIPLIER * spot
            
            if contract.option_type == 'call':
                level.call_gex -= gex  # Dealers short calls = short gamma
                level.call_oi += contract.oi
            else:
                level.put_gex += gex   # Dealers short puts = long gamma
                level.put_oi += contract.oi
            
            level.net_gex = level.call_gex + level.put_gex
        
        # Aggregate totals
        total_gex = sum(l.net_gex for l in strike_gex.values())
        call_gex = sum(l.call_gex for l in strike_gex.values())
        put_gex = sum(l.put_gex for l in strike_gex.values())
        
        # Find gamma flip (where cumulative GEX crosses zero)
        sorted_strikes = sorted(strike_gex.keys())
        gamma_flip = spot  # Default
        cumulative = 0
        
        for strike in sorted_strikes:
            prev_cum = cumulative
            cumulative += strike_gex[strike].net_gex
            
            if prev_cum < 0 and cumulative >= 0:
                # Crossed from negative to positive
                gamma_flip = strike
                break
            elif prev_cum > 0 and cumulative <= 0:
                # Crossed from positive to negative
                gamma_flip = strike
                break
        
        # Find max gamma strike
        max_gamma_strike = max(strike_gex.keys(), key=lambda s: abs(strike_gex[s].net_gex))
        
        # Identify support and resistance levels
        support_levels = sorted(
            [l for l in strike_gex.values() if l.net_gex > 0 and l.strike < spot],
            key=lambda x: x.net_gex,
            reverse=True
        )[:3]
        
        resistance_levels = sorted(
            [l for l in strike_gex.values() if l.net_gex < 0 and l.strike > spot],
            key=lambda x: abs(x.net_gex),
            reverse=True
        )[:3]
        
        # Determine dealer position
        if total_gex > CONFIG.GEX_THRESHOLD:
            dealer_position = DealerPosition.LONG_GAMMA
        elif total_gex < -CONFIG.GEX_THRESHOLD:
            dealer_position = DealerPosition.SHORT_GAMMA
        else:
            dealer_position = DealerPosition.NEUTRAL
        
        # Calculate hedge pressure
        # If spot is above flip, dealers are increasingly short gamma (need to buy)
        # If spot is below flip, dealers are increasingly long gamma (need to sell)
        dist_to_flip = (spot - gamma_flip) / spot
        hedge_pressure = np.clip(dist_to_flip * 10, -1, 1)
        
        # Acceleration zone: near flip or in negative gamma territory
        acceleration_zone = abs(spot - gamma_flip) < spot * 0.005 or total_gex < 0
        
        # Zero gamma band
        zero_band_low = gamma_flip * 0.995
        zero_band_high = gamma_flip * 1.005
        
        profile = DealerProfile(
            timestamp=now,
            spot=spot,
            total_gex=total_gex,
            call_gex=call_gex,
            put_gex=put_gex,
            gamma_flip=gamma_flip,
            max_gamma_strike=max_gamma_strike,
            zero_gamma_band=(zero_band_low, zero_band_high),
            dealer_position=dealer_position,
            support_levels=support_levels,
            resistance_levels=resistance_levels,
            hedge_pressure=hedge_pressure,
            acceleration_zone=acceleration_zone
        )
        
        self.last_calculation = profile
        return profile
    
    def _empty_profile(self, now: datetime, spot: float) -> DealerProfile:
        return DealerProfile(
            timestamp=now,
            spot=spot,
            total_gex=0,
            call_gex=0,
            put_gex=0,
            gamma_flip=spot,
            max_gamma_strike=spot,
            zero_gamma_band=(spot * 0.995, spot * 1.005),
            dealer_position=DealerPosition.NEUTRAL,
            support_levels=[],
            resistance_levels=[],
            hedge_pressure=0,
            acceleration_zone=False
        )


# ═══════════════════════════════════════════════════════════════════════════════
# FLOW ANALYZER
# ═══════════════════════════════════════════════════════════════════════════════

class FlowAnalyzer:
    """
    Analyze options flow for institutional activity
    
    WHAT WE'RE LOOKING FOR:
    1. Sweeps - Aggressive orders hitting multiple exchanges
    2. Blocks - Large single prints
    3. Opening vs Closing - New positions vs closing
    4. Aggression - Paying up for fills
    
    INTERPRETATION:
    - Call sweeps at ask = BULLISH
    - Put sweeps at ask = BEARISH
    - Large opening positions = Someone knows something
    - Unusual strike activity = Look for catalyst
    """
    
    def __init__(self):
        self.trades: deque = deque(maxlen=5000)
        self.signals: deque = deque(maxlen=100)
        
    def add_trade(self, trade: OptionTrade):
        """Add trade to analysis buffer"""
        self.trades.append(trade)
        self._check_for_signals(trade)
    
    def _check_for_signals(self, new_trade: OptionTrade):
        """Check if new trade triggers a signal"""
        # Check for sweep
        sweep = self._detect_sweep(new_trade)
        if sweep:
            self.signals.append(sweep)
            return
        
        # Check for block
        if new_trade.size >= CONFIG.BLOCK_SIZE:
            block = self._create_block_signal(new_trade)
            self.signals.append(block)
    
    def _detect_sweep(self, trade: OptionTrade) -> Optional[FlowSignal]:
        """
        Detect if this trade is part of a sweep
        
        Sweep = Same contract, multiple exchanges, short time window
        """
        window_start = trade.timestamp - CONFIG.SWEEP_WINDOW_MS * 1_000_000  # ns
        
        related = [
            t for t in self.trades
            if t.strike == trade.strike
            and t.expiry == trade.expiry
            and t.option_type == trade.option_type
            and t.side == trade.side
            and t.timestamp > window_start
        ]
        
        if len(related) < 2:
            return None
        
        exchanges = set(t.exchange for t in related if t.exchange)
        
        if len(exchanges) < CONFIG.SWEEP_MIN_EXCHANGES:
            return None
        
        total_size = sum(t.size for t in related)
        
        if total_size < CONFIG.LARGE_TRADE_SIZE:
            return None
        
        # This is a sweep!
        total_premium = sum(t.premium for t in related)
        
        # Determine type
        if trade.option_type == 'call':
            if trade.side == 'BUY':
                signal_type = FlowType.SWEEP_CALL_BUY
                bias = "BULLISH"
            else:
                signal_type = FlowType.SWEEP_CALL_SELL
                bias = "BEARISH"
        else:
            if trade.side == 'BUY':
                signal_type = FlowType.SWEEP_PUT_BUY
                bias = "BEARISH"
            else:
                signal_type = FlowType.SWEEP_PUT_SELL
                bias = "BULLISH"
        
        # Urgency based on aggression
        avg_aggression = np.mean([1 if t.is_aggressive else 0 for t in related])
        if avg_aggression > 0.8:
            urgency = "EXTREME"
        elif avg_aggression > 0.5:
            urgency = "HIGH"
        elif avg_aggression > 0.2:
            urgency = "MEDIUM"
        else:
            urgency = "LOW"
        
        return FlowSignal(
            timestamp=trade.timestamp,
            signal_type=signal_type,
            strike=trade.strike,
            expiry=trade.expiry,
            option_type=trade.option_type,
            size=total_size,
            premium=total_premium,
            is_opening=True,  # Would need OI comparison to know
            aggression=avg_aggression,
            exchanges=list(exchanges),
            bias=bias,
            urgency=urgency
        )
    
    def _create_block_signal(self, trade: OptionTrade) -> FlowSignal:
        """Create signal for block trade"""
        if trade.option_type == 'call':
            signal_type = FlowType.BLOCK_CALL
            bias = "BULLISH" if trade.side == 'BUY' else "BEARISH"
        else:
            signal_type = FlowType.BLOCK_PUT
            bias = "BEARISH" if trade.side == 'BUY' else "BULLISH"
        
        return FlowSignal(
            timestamp=trade.timestamp,
            signal_type=signal_type,
            strike=trade.strike,
            expiry=trade.expiry,
            option_type=trade.option_type,
            size=trade.size,
            premium=trade.premium,
            is_opening=True,
            aggression=1.0 if trade.is_aggressive else 0.5,
            exchanges=[trade.exchange],
            bias=bias,
            urgency="HIGH" if trade.size > CONFIG.BLOCK_SIZE * 2 else "MEDIUM"
        )
    
    def get_recent_signals(self, minutes: int = 30) -> List[FlowSignal]:
        """Get signals from last N minutes"""
        cutoff = (datetime.now() - timedelta(minutes=minutes)).timestamp() * 1e9
        return [s for s in self.signals if s.timestamp > cutoff]
    
    def get_net_flow(self, minutes: int = 30) -> Tuple[float, float]:
        """Get net call and put premium flow"""
        cutoff = (datetime.now() - timedelta(minutes=minutes)).timestamp() * 1e9
        recent = [t for t in self.trades if t.timestamp > cutoff]
        
        call_premium = sum(
            t.premium * (1 if t.side == 'BUY' else -1)
            for t in recent if t.option_type == 'call'
        )
        
        put_premium = sum(
            t.premium * (1 if t.side == 'BUY' else -1)
            for t in recent if t.option_type == 'put'
        )
        
        return call_premium, put_premium


# ═══════════════════════════════════════════════════════════════════════════════
# MARKET INTERPRETER
# ═══════════════════════════════════════════════════════════════════════════════

class MarketInterpreter:
    """
    Interpret market state and provide actionable insight
    
    CORE LOGIC:
    1. WHERE are dealers positioned? (GEX)
    2. WHAT is the flow telling us? (Sweeps/Blocks)
    3. HOW will dealers need to hedge? (Direction)
    4. WHERE are the key levels? (Support/Resistance)
    """
    
    def interpret(
        self,
        dealer: DealerProfile,
        flow_signals: List[FlowSignal],
        net_call_premium: float,
        net_put_premium: float,
        spot_velocity: float
    ) -> MarketState:
        """
        Create complete market interpretation
        """
        now = datetime.now()
        spot = dealer.spot
        
        # Analyze flow bias
        bullish_signals = len([s for s in flow_signals if s.bias == "BULLISH"])
        bearish_signals = len([s for s in flow_signals if s.bias == "BEARISH"])
        
        # Determine primary driver
        primary_driver = self._identify_driver(
            dealer, bullish_signals, bearish_signals, spot_velocity
        )
        
        # Determine expected behavior
        expected_behavior = self._predict_behavior(
            dealer, bullish_signals > bearish_signals, spot_velocity
        )
        
        # Build key levels
        key_levels = {
            'gamma_flip': dealer.gamma_flip,
        }
        
        if dealer.support_levels:
            key_levels['support_1'] = dealer.support_levels[0].strike
            if len(dealer.support_levels) > 1:
                key_levels['support_2'] = dealer.support_levels[1].strike
        
        if dealer.resistance_levels:
            key_levels['resistance_1'] = dealer.resistance_levels[0].strike
            if len(dealer.resistance_levels) > 1:
                key_levels['resistance_2'] = dealer.resistance_levels[1].strike
        
        # Trade bias
        trade_bias, conviction = self._determine_bias(
            dealer, flow_signals, net_call_premium, net_put_premium
        )
        
        return MarketState(
            timestamp=now,
            spot=spot,
            spot_change=0,
            spot_velocity=spot_velocity,
            dealer=dealer,
            recent_signals=flow_signals,
            net_call_premium=net_call_premium,
            net_put_premium=net_put_premium,
            primary_driver=primary_driver,
            expected_behavior=expected_behavior,
            key_levels=key_levels,
            trade_bias=trade_bias,
            conviction=conviction
        )
    
    def _identify_driver(
        self,
        dealer: DealerProfile,
        bullish_count: int,
        bearish_count: int,
        velocity: float
    ) -> str:
        """Identify what's driving price"""
        
        if dealer.acceleration_zone:
            return "GAMMA FLIP ZONE - Dealer hedging amplifying moves"
        
        if abs(velocity) > 0.5:  # Fast move
            if dealer.dealer_position == DealerPosition.SHORT_GAMMA:
                return "DEALER SHORT GAMMA - Hedging accelerating the trend"
            else:
                return "MOMENTUM - Fast move in progress"
        
        if bullish_count > bearish_count + 2:
            return "CALL FLOW - Aggressive call buying"
        elif bearish_count > bullish_count + 2:
            return "PUT FLOW - Aggressive put buying"
        
        if dealer.dealer_position == DealerPosition.LONG_GAMMA:
            return "DEALER LONG GAMMA - Mean reversion environment"
        
        return "MIXED - No dominant driver"
    
    def _predict_behavior(
        self,
        dealer: DealerProfile,
        flow_bullish: bool,
        velocity: float
    ) -> str:
        """Predict expected price behavior"""
        
        # In acceleration zone
        if dealer.acceleration_zone:
            if velocity > 0:
                return "EXPECT ACCELERATION HIGHER - Dealers must buy to hedge"
            elif velocity < 0:
                return "EXPECT ACCELERATION LOWER - Dealers must sell to hedge"
            else:
                return "UNSTABLE - Any move will be amplified"
        
        # Dealer positioning
        if dealer.dealer_position == DealerPosition.LONG_GAMMA:
            if dealer.spot > dealer.gamma_flip:
                return "EXPECT RESISTANCE - Dealers will sell rallies"
            else:
                return "EXPECT SUPPORT - Dealers will buy dips"
        
        elif dealer.dealer_position == DealerPosition.SHORT_GAMMA:
            if flow_bullish:
                return "EXPECT TREND CONTINUATION HIGHER - Dealers adding fuel"
            else:
                return "EXPECT TREND CONTINUATION LOWER - Dealers adding pressure"
        
        return "EXPECT CHOP - Mixed signals"
    
    def _determine_bias(
        self,
        dealer: DealerProfile,
        signals: List[FlowSignal],
        call_premium: float,
        put_premium: float
    ) -> Tuple[str, float]:
        """Determine trade bias and conviction"""
        
        score = 0
        factors = []
        
        # 1. Dealer positioning (30%)
        if dealer.dealer_position == DealerPosition.SHORT_GAMMA:
            if dealer.hedge_pressure > 0:
                score += 30
                factors.append("Dealers must buy (short gamma above flip)")
            else:
                score -= 30
                factors.append("Dealers must sell (short gamma below flip)")
        
        # 2. Flow signals (40%)
        bullish = len([s for s in signals if s.bias == "BULLISH" and s.urgency in ["HIGH", "EXTREME"]])
        bearish = len([s for s in signals if s.bias == "BEARISH" and s.urgency in ["HIGH", "EXTREME"]])
        
        flow_score = (bullish - bearish) * 10
        score += np.clip(flow_score, -40, 40)
        
        # 3. Premium flow (30%)
        if call_premium > put_premium * 1.5:
            score += 30
            factors.append("Heavy call premium")
        elif put_premium > call_premium * 1.5:
            score -= 30
            factors.append("Heavy put premium")
        
        # Determine bias
        if score > 30:
            bias = "LONG"
        elif score < -30:
            bias = "SHORT"
        else:
            bias = "NEUTRAL"
        
        conviction = min(100, abs(score))
        
        return bias, conviction


# ═══════════════════════════════════════════════════════════════════════════════
# ENTRY FINDER
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class TradeEntry:
    """Actionable trade entry"""
    timestamp: datetime
    
    direction: str  # LONG or SHORT
    entry_price: float
    stop_loss: float
    target_1: float
    target_2: float
    
    # Context
    trigger: str  # What triggered this entry
    dealer_context: str  # Dealer positioning context
    flow_context: str  # Flow context
    
    # Risk
    risk_points: float
    reward_points: float
    risk_reward: float
    
    # Confidence
    confidence: float  # 0-100
    
    # Warnings
    warnings: List[str]


class EntryFinder:
    """
    Find optimal entries based on dealer positioning and flow
    
    ENTRY LOGIC:
    1. Identify key gamma levels (support/resistance)
    2. Wait for price to approach level
    3. Confirm with flow (sweeps/blocks in direction)
    4. Enter with stop on other side of gamma level
    """
    
    def find_entries(self, state: MarketState) -> List[TradeEntry]:
        """Find all valid entry opportunities"""
        entries = []
        
        # Entry at gamma support (LONG)
        if state.dealer.support_levels:
            support = state.dealer.support_levels[0]
            entry = self._check_support_entry(state, support)
            if entry:
                entries.append(entry)
        
        # Entry at gamma resistance (SHORT)
        if state.dealer.resistance_levels:
            resistance = state.dealer.resistance_levels[0]
            entry = self._check_resistance_entry(state, resistance)
            if entry:
                entries.append(entry)
        
        # Entry at gamma flip (momentum)
        flip_entry = self._check_flip_entry(state)
        if flip_entry:
            entries.append(flip_entry)
        
        return sorted(entries, key=lambda e: e.confidence, reverse=True)
    
    def _check_support_entry(self, state: MarketState, support: GEXLevel) -> Optional[TradeEntry]:
        """Check for long entry at gamma support"""
        spot = state.spot
        support_price = support.strike
        
        # Must be near support (within 0.5%)
        if spot > support_price * 1.005 or spot < support_price * 0.995:
            return None
        
        # Check for bullish flow confirmation
        bullish_signals = [s for s in state.recent_signals 
                         if s.bias == "BULLISH" and s.urgency in ["HIGH", "EXTREME"]]
        
        if not bullish_signals:
            return None
        
        # Build entry
        stop = support_price - (spot * 0.003)  # 0.3% below support
        target_1 = spot + (spot - stop) * 1.5  # 1.5R
        target_2 = spot + (spot - stop) * 3    # 3R
        
        risk = spot - stop
        reward = target_1 - spot
        
        warnings = []
        confidence = 60
        
        # Adjust confidence
        if state.dealer.dealer_position == DealerPosition.LONG_GAMMA:
            confidence += 20
        elif state.dealer.dealer_position == DealerPosition.SHORT_GAMMA:
            confidence -= 10
            warnings.append("Short gamma environment - support may break")
        
        if len(bullish_signals) > 2:
            confidence += 10
        
        if state.dealer.acceleration_zone:
            warnings.append("Near gamma flip - expect volatility")
        
        return TradeEntry(
            timestamp=datetime.now(),
            direction="LONG",
            entry_price=spot,
            stop_loss=stop,
            target_1=target_1,
            target_2=target_2,
            trigger=f"Price at gamma support {support_price:.2f}",
            dealer_context=state.dealer.regime_description,
            flow_context=f"{len(bullish_signals)} bullish signals",
            risk_points=risk,
            reward_points=reward,
            risk_reward=reward / risk if risk > 0 else 0,
            confidence=min(95, confidence),
            warnings=warnings
        )
    
    def _check_resistance_entry(self, state: MarketState, resistance: GEXLevel) -> Optional[TradeEntry]:
        """Check for short entry at gamma resistance"""
        spot = state.spot
        resistance_price = resistance.strike
        
        # Must be near resistance (within 0.5%)
        if spot < resistance_price * 0.995 or spot > resistance_price * 1.005:
            return None
        
        # Check for bearish flow confirmation
        bearish_signals = [s for s in state.recent_signals 
                         if s.bias == "BEARISH" and s.urgency in ["HIGH", "EXTREME"]]
        
        if not bearish_signals:
            return None
        
        # Build entry
        stop = resistance_price + (spot * 0.003)  # 0.3% above resistance
        target_1 = spot - (stop - spot) * 1.5  # 1.5R
        target_2 = spot - (stop - spot) * 3    # 3R
        
        risk = stop - spot
        reward = spot - target_1
        
        warnings = []
        confidence = 60
        
        # Adjust confidence
        if state.dealer.dealer_position == DealerPosition.LONG_GAMMA:
            confidence += 20
        elif state.dealer.dealer_position == DealerPosition.SHORT_GAMMA:
            confidence -= 10
            warnings.append("Short gamma environment - resistance may break")
        
        if len(bearish_signals) > 2:
            confidence += 10
        
        return TradeEntry(
            timestamp=datetime.now(),
            direction="SHORT",
            entry_price=spot,
            stop_loss=stop,
            target_1=target_1,
            target_2=target_2,
            trigger=f"Price at gamma resistance {resistance_price:.2f}",
            dealer_context=state.dealer.regime_description,
            flow_context=f"{len(bearish_signals)} bearish signals",
            risk_points=risk,
            reward_points=reward,
            risk_reward=reward / risk if risk > 0 else 0,
            confidence=min(95, confidence),
            warnings=warnings
        )
    
    def _check_flip_entry(self, state: MarketState) -> Optional[TradeEntry]:
        """
        Check for momentum entry through gamma flip
        
        THE BIG MOVE SETUP:
        - Price crosses gamma flip
        - Dealer hedging ACCELERATES the move
        - This is where big moves happen
        """
        spot = state.spot
        flip = state.dealer.gamma_flip
        
        # Must be very close to flip (within 0.2%)
        if abs(spot - flip) > flip * 0.002:
            return None
        
        # Need strong flow confirmation
        bullish = [s for s in state.recent_signals if s.bias == "BULLISH" and s.urgency == "EXTREME"]
        bearish = [s for s in state.recent_signals if s.bias == "BEARISH" and s.urgency == "EXTREME"]
        
        # Determine direction based on momentum and flow
        if state.spot_velocity > 0.1 and len(bullish) > len(bearish):
            direction = "LONG"
            stop = flip - (spot * 0.005)
            target_1 = spot + (spot * 0.01)  # 1% move
            target_2 = spot + (spot * 0.02)  # 2% move
            flow_context = f"{len(bullish)} extreme bullish signals"
        elif state.spot_velocity < -0.1 and len(bearish) > len(bullish):
            direction = "SHORT"
            stop = flip + (spot * 0.005)
            target_1 = spot - (spot * 0.01)
            target_2 = spot - (spot * 0.02)
            flow_context = f"{len(bearish)} extreme bearish signals"
        else:
            return None
        
        risk = abs(spot - stop)
        reward = abs(target_1 - spot)
        
        return TradeEntry(
            timestamp=datetime.now(),
            direction=direction,
            entry_price=spot,
            stop_loss=stop,
            target_1=target_1,
            target_2=target_2,
            trigger=f"GAMMA FLIP BREAKOUT at {flip:.2f}",
            dealer_context="Dealers will be FORCED to hedge in direction of move",
            flow_context=flow_context,
            risk_points=risk,
            reward_points=reward,
            risk_reward=reward / risk if risk > 0 else 0,
            confidence=85,  # High confidence for flip breakouts
            warnings=["⚡ HIGH VOLATILITY EXPECTED", "Move fast or miss it"]
        )


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class TitanRealtime:
    """
    TITAN Realtime Dealer Flow Intelligence System
    
    Usage:
        titan = TitanRealtime(api_key="your_polygon_key")
        await titan.start()
        
        # Get current state
        state = await titan.get_state()
        print(state.primary_driver)
        print(state.expected_behavior)
        
        # Get entries
        entries = titan.get_entries()
        for entry in entries:
            print(entry)
    """
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or CONFIG.POLYGON_API_KEY
        self.client: Optional[PolygonClient] = None
        
        self.gex_calculator = GEXCalculator()
        self.flow_analyzer = FlowAnalyzer()
        self.interpreter = MarketInterpreter()
        self.entry_finder = EntryFinder()
        
        self.current_state: Optional[MarketState] = None
        self.spot_history: deque = deque(maxlen=100)
        
        self._running = False
    
    async def start(self):
        """Start the engine"""
        if not self.api_key:
            raise ValueError("Polygon API key required. Set POLYGON_API_KEY env var.")
        
        self.client = PolygonClient(self.api_key)
        self._running = True
        
        logger.info("TITAN Realtime started")
        
        # Initial data load
        await self._update()
    
    async def stop(self):
        """Stop the engine"""
        self._running = False
        if self.client and self.client.session:
            await self.client.session.close()
        logger.info("TITAN Realtime stopped")
    
    async def _update(self):
        """Update all data"""
        if not self.client:
            return
        
        # Get spot price
        spot = await self.client.get_spot_price(CONFIG.UNDERLYING)
        if spot == 0:
            logger.warning("Failed to get spot price")
            return
        
        self.spot_history.append({
            'time': datetime.now(),
            'price': spot
        })
        
        # Calculate velocity
        velocity = 0
        if len(self.spot_history) > 1:
            dt = (self.spot_history[-1]['time'] - self.spot_history[0]['time']).total_seconds() / 60
            if dt > 0:
                velocity = (self.spot_history[-1]['price'] - self.spot_history[0]['price']) / dt
        
        # Get options chain
        today = date.today().strftime("%Y-%m-%d")
        contracts = await self.client.get_options_chain(CONFIG.UNDERLYING, today)
        
        if not contracts:
            logger.warning("Failed to get options chain")
            return
        
        # Calculate GEX
        dealer = self.gex_calculator.calculate(contracts, spot)
        
        # Get flow data
        trades = await self.client.get_options_trades(CONFIG.UNDERLYING, 100)
        for trade in trades:
            self.flow_analyzer.add_trade(trade)
        
        signals = self.flow_analyzer.get_recent_signals(30)
        call_premium, put_premium = self.flow_analyzer.get_net_flow(30)
        
        # Interpret
        self.current_state = self.interpreter.interpret(
            dealer, signals, call_premium, put_premium, velocity
        )
        
        logger.info(f"Updated: {spot:.2f} | GEX: {dealer.total_gex/1e9:.2f}B | "
                   f"Flip: {dealer.gamma_flip:.2f} | {dealer.dealer_position.value}")
    
    async def get_state(self) -> Optional[MarketState]:
        """Get current market state"""
        await self._update()
        return self.current_state
    
    def get_entries(self) -> List[TradeEntry]:
        """Get current entry opportunities"""
        if not self.current_state:
            return []
        return self.entry_finder.find_entries(self.current_state)
    
    def explain_market(self) -> str:
        """Get human-readable market explanation"""
        if not self.current_state:
            return "No data available"
        
        state = self.current_state
        
        explanation = f"""
═══════════════════════════════════════════════════════════════
TITAN REALTIME MARKET ANALYSIS
═══════════════════════════════════════════════════════════════

📍 CURRENT STATE
   SPY: {state.spot:.2f}
   Velocity: {state.spot_velocity:+.2f} pts/min

🎰 DEALER POSITIONING
   {state.dealer.regime_description}
   
   Total GEX: ${state.dealer.total_gex/1e9:.2f}B
   Gamma Flip: {state.dealer.gamma_flip:.2f}
   Distance to Flip: {state.spot - state.dealer.gamma_flip:+.2f}
   
   {"⚠️ IN ACCELERATION ZONE - MOVES WILL BE AMPLIFIED" if state.dealer.acceleration_zone else ""}

💰 FLOW ANALYSIS
   Net Call Premium: ${state.net_call_premium/1e6:.1f}M
   Net Put Premium: ${state.net_put_premium/1e6:.1f}M
   Recent Signals: {len(state.recent_signals)}

📊 PRIMARY DRIVER
   {state.primary_driver}

🎯 EXPECTED BEHAVIOR
   {state.expected_behavior}

📐 KEY LEVELS
   Gamma Flip: {state.key_levels.get('gamma_flip', 0):.2f}
   Support 1: {state.key_levels.get('support_1', 0):.2f}
   Support 2: {state.key_levels.get('support_2', 0):.2f}
   Resistance 1: {state.key_levels.get('resistance_1', 0):.2f}
   Resistance 2: {state.key_levels.get('resistance_2', 0):.2f}

🎲 TRADE BIAS
   Direction: {state.trade_bias}
   Conviction: {state.conviction:.0f}%

═══════════════════════════════════════════════════════════════
"""
        return explanation


# ═══════════════════════════════════════════════════════════════════════════════
# CLI INTERFACE
# ═══════════════════════════════════════════════════════════════════════════════

async def main():
    """Run TITAN Realtime from command line"""
    api_key = os.getenv('POLYGON_API_KEY')
    
    if not api_key:
        print("=" * 60)
        print("TITAN REALTIME - Dealer Flow Intelligence")
        print("=" * 60)
        print()
        print("❌ POLYGON_API_KEY environment variable not set")
        print()
        print("To use this system:")
        print("1. Get a free API key from https://polygon.io")
        print("2. Set the environment variable:")
        print("   export POLYGON_API_KEY='your_key_here'")
        print("3. Run again")
        print()
        
        # Run demo mode
        print("Running in DEMO mode with simulated data...")
        print()
        await run_demo()
        return
    
    titan = TitanRealtime(api_key)
    
    try:
        await titan.start()
        
        while True:
            print("\033[2J\033[H")  # Clear screen
            print(titan.explain_market())
            
            entries = titan.get_entries()
            if entries:
                print("\n🎯 ENTRY OPPORTUNITIES:")
                for entry in entries:
                    print(f"""
   {entry.direction} @ {entry.entry_price:.2f}
   Stop: {entry.stop_loss:.2f} | Target: {entry.target_1:.2f}
   R:R = 1:{entry.risk_reward:.1f} | Confidence: {entry.confidence:.0f}%
   Trigger: {entry.trigger}
   {"⚠️ " + " | ".join(entry.warnings) if entry.warnings else ""}
""")
            
            await asyncio.sleep(5)
            
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        await titan.stop()


async def run_demo():
    """Run demo with simulated data"""
    from titan_core import GammaNode
    
    # Simulated dealer profile
    spot = 595.0  # SPY
    
    print(f"""
═══════════════════════════════════════════════════════════════
TITAN REALTIME DEMO
═══════════════════════════════════════════════════════════════

📍 SIMULATED STATE
   SPY: {spot:.2f} (SPX ≈ {spot * 10:.2f})

🎰 DEALER POSITIONING
   DEALERS SHORT GAMMA: Will buy rallies, sell dips.
   Expect TREND ACCELERATION.
   
   Total GEX: -$1.5B (negative = short gamma)
   Gamma Flip: {spot - 3:.2f}
   Distance to Flip: +3.00 (above flip)
   
   ⚠️ IN ACCELERATION ZONE - MOVES WILL BE AMPLIFIED

💰 FLOW ANALYSIS
   Net Call Premium: $45.2M (bullish)
   Net Put Premium: $12.1M
   Recent Signals: 5 sweeps detected
   
   🔥 SWEEP_CALL_BUY: 500 calls @ 600 (BULLISH, EXTREME)
   🔥 SWEEP_CALL_BUY: 300 calls @ 605 (BULLISH, HIGH)

📊 PRIMARY DRIVER
   DEALER SHORT GAMMA - Hedging accelerating the trend

🎯 EXPECTED BEHAVIOR
   EXPECT TREND CONTINUATION HIGHER - Dealers adding fuel
   
   WHY: Dealers are short gamma. As price rises, their delta
   exposure increases, forcing them to BUY more shares/futures
   to stay hedged. This buying ADDS to the rally.

📐 KEY LEVELS
   Gamma Flip: {spot - 3:.2f} (CRITICAL - regime change below)
   Support 1: {spot - 5:.2f} (dealers will buy here)
   Resistance 1: {spot + 8:.2f} (major call wall)

═══════════════════════════════════════════════════════════════

🎯 ENTRY OPPORTUNITY DETECTED:

   LONG @ {spot:.2f}
   Stop: {spot - 4:.2f} | Target 1: {spot + 6:.2f} | Target 2: {spot + 12:.2f}
   Risk: $4.00 | Reward: $6.00 | R:R = 1:1.5
   
   ✅ TRIGGER: Short gamma above flip + aggressive call buying
   ✅ CONTEXT: Dealers MUST buy to hedge, adding fuel to rally
   ⚠️ WARNING: Fast move - be quick or miss it

═══════════════════════════════════════════════════════════════

HOW THIS WORKS:

1. DEALER MECHANICS
   - Market makers sell options to retail
   - They must delta hedge to stay neutral
   - Gamma tells us how much they hedge per $1 move

2. SHORT GAMMA = TREND FUEL
   - When dealers are short gamma (as now):
   - Price up → Delta increases → Dealers buy → Price up more
   - Price down → Delta decreases → Dealers sell → Price down more
   - Result: TRENDS ACCELERATE

3. THE GAMMA FLIP
   - Below {spot - 3:.2f}: Dealers become long gamma
   - Long gamma = they sell rallies, buy dips
   - Result: MEAN REVERSION
   - This level is the KEY regime change point

4. THE TRADE
   - We're above flip with bullish flow
   - Dealers will be FORCED to buy as price rises
   - Entry here captures the acceleration
   - Stop below flip (regime change)

═══════════════════════════════════════════════════════════════
""")


if __name__ == "__main__":
    asyncio.run(main())
