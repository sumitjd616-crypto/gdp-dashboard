"""
TITAN OMEGA v18.0
=================
Ultimate SPX Day Trading Physics Engine

Unified module exposing all TITAN components.

Usage:
    from titan import TitanEngine, TimeContextEngine, GEXEngine, FlowEngine
    
    # Initialize engines
    engine = TitanEngine(account_size=50000)
    time_engine = TimeContextEngine()
    
    # Run analysis
    result = engine.analyze(spot=5950, nodes=nodes, net_gex=1e9, flip=5930, vix=18)
    time_ctx = time_engine.get_context()
"""

# Core Physics Engine
from titan_core import (
    # Config
    TitanConfig,
    CONFIG,
    
    # Enums
    DataQuality,
    Direction,
    RegimeType,
    MarketCharacter,
    NodeHealth,
    Signal,
    Urgency,
    
    # Data classes
    GammaNode,
    Bar,
    OptionsTrade,
    ESData,
    TickState,
    NodeAnalysis,
    ForceVector,
    Momentum,
    Regime,
    ESCorrelation,
    IVCrushRisk,
    Position,
    Scenario,
    Warning,
    EngineOutput,
    
    # Main engine
    TitanEngine,
)

# Time Context Engine
from titan_time import (
    MarketSession,
    SpecialDay,
    SessionModifier,
    DayModifier,
    TimeContext,
    TimeContextEngine,
    get_market_session,
    get_special_day,
    calc_charm_acceleration,
)

# Multi-Expiry GEX Engine
from titan_gex import (
    GEXConfig,
    OptionContract,
    ExpiryGEX,
    GammaWall,
    AggregatedGEX,
    GEXEngine,
    analyze_expiry,
    aggregate_gex,
    calc_gamma_flip,
    calc_max_pain,
    detect_walls,
)

# Flow Intelligence Engine
from titan_flow import (
    FlowConfig,
    FlowType,
    FlowSide,
    FlowSentiment,
    OptionTrade,
    DarkPoolPrint,
    Sweep,
    Block,
    FlowAlert,
    FlowSummary,
    DarkPoolSummary,
    FlowEngine,
    detect_sweeps,
    detect_blocks,
    analyze_dark_pool,
    detect_smart_money,
    summarize_flow,
)

# Volatility Surface Engine
from titan_volatility import (
    VolConfig,
    VolRegime,
    TermStructure,
    VolExpectation,
    SkewRegime,
    VIXData,
    SkewData,
    RealizedVol,
    TermStructureAnalysis,
    VolatilityAnalysis,
    VolatilityEngine,
    classify_vix_regime,
    analyze_term_structure,
    classify_skew,
    analyze_rv_iv,
    calc_realized_vol,
)

# Intermarket Divergence Engine
from titan_intermarket import (
    IntermarketConfig,
    RiskRegime,
    AssetDirection,
    CorrelationState,
    DivergenceType,
    AssetData,
    CorrelationPair,
    DivergenceSignal,
    RiskRegimeAnalysis,
    SectorRotation,
    IntermarketEngine,
    calc_direction,
    calc_correlation,
    detect_divergence,
)


# ═══════════════════════════════════════════════════════════════════════════════
# VERSION INFO
# ═══════════════════════════════════════════════════════════════════════════════

__version__ = "18.0.0"
__author__ = "TITAN Development Team"
__description__ = "Ultimate SPX Day Trading Physics Engine"


# ═══════════════════════════════════════════════════════════════════════════════
# CONVENIENCE CLASS
# ═══════════════════════════════════════════════════════════════════════════════

class TitanOmega:
    """
    Unified TITAN OMEGA interface
    
    Combines all engines into a single interface for easy use.
    
    Example:
        titan = TitanOmega(account_size=50000)
        
        # Update data
        titan.update_prices(spx=5950, es=5955, vix=18)
        
        # Run analysis
        result = titan.analyze()
        
        # Get recommendation
        print(result.best_scenario)
    """
    
    def __init__(self, account_size: float = 50000):
        self.core = TitanEngine(account_size=account_size)
        self.time = TimeContextEngine()
        self.gex = GEXEngine()
        self.flow = FlowEngine()
        self.vol = VolatilityEngine()
        self.intermarket = IntermarketEngine()
        
        self._spot = 0.0
        self._vix = 18.0
        self._net_gex = 0.0
        self._flip = 0.0
    
    def update_prices(
        self,
        spx: float,
        es: float = None,
        vix: float = None,
        dxy: float = None,
        tlt: float = None
    ):
        """Update all price data"""
        self._spot = spx
        if vix:
            self._vix = vix
        
        # Update intermarket
        self.intermarket.update(spx=spx, es=es, vix=vix, dxy=dxy, tlt=tlt)
        
        # Update vol engine
        self.vol.add_close(spx)
        
        # Update core with ES
        if es:
            self.core.set_es(ESData(
                price=es,
                momentum=(es - spx) / spx if spx > 0 else 0,
                order_book_imbalance=0
            ))
    
    def update_gex(self, net_gex: float, flip: float, nodes: list = None):
        """Update gamma exposure data"""
        self._net_gex = net_gex
        self._flip = flip
        
        if nodes:
            self.gex.update_contracts(nodes)
    
    def add_bar(self, bar: Bar):
        """Add price bar"""
        self.core.add_bar(bar)
    
    def add_flow(self, trades: list):
        """Add options flow trades"""
        self.flow.add_trades(trades)
    
    def analyze(self, nodes: list = None) -> dict:
        """
        Run complete analysis across all engines
        
        Returns dict with:
            - core: Core engine output
            - time: Time context
            - vol: Volatility analysis
            - intermarket: Intermarket analysis
            - recommendation: Overall recommendation
        """
        # Generate default nodes if not provided
        if nodes is None:
            nodes = [
                GammaNode(
                    strike=self._spot + i * 5,
                    gamma=1e9 if i > 0 else -1e9,
                    abs_gamma=1e9,
                    sign=1 if i > 0 else -1
                )
                for i in range(-10, 11)
            ]
        
        # Run core analysis
        core_result = self.core.analyze(
            spot=self._spot,
            nodes=nodes,
            net_gex=self._net_gex,
            flip=self._flip,
            vix=self._vix
        )
        
        # Time context
        time_ctx = self.time.get_context()
        
        # Volatility
        vol_result = self.vol.analyze(vix=self._vix)
        
        # Intermarket
        im_result = self.intermarket.analyze()
        
        # Generate recommendation
        recommendation = self._generate_recommendation(
            core_result, time_ctx, vol_result, im_result
        )
        
        return {
            'core': core_result,
            'time': time_ctx,
            'vol': vol_result,
            'intermarket': im_result,
            'recommendation': recommendation
        }
    
    def _generate_recommendation(self, core, time_ctx, vol, intermarket) -> dict:
        """Generate unified trading recommendation"""
        
        # Base from core signal
        if core.signal == Signal.CONVICTION_LONG:
            bias = "LONG"
            confidence = 80
        elif core.signal == Signal.CONVICTION_SHORT:
            bias = "SHORT"
            confidence = 80
        elif core.signal == Signal.FLOW_DIVERGENCE:
            bias = "NEUTRAL"
            confidence = 30
        else:
            bias = "NEUTRAL"
            confidence = 50
        
        # Adjust for time context
        confidence *= time_ctx.final_size_mult
        
        # Adjust for volatility
        confidence *= vol.strategy_adjustment
        
        # Adjust for intermarket
        if intermarket.regime == RiskRegime.DIVERGENCE:
            confidence *= 0.5
        confidence *= intermarket.size_adjustment
        
        # Final size calculation
        if core.best_scenario:
            contracts = max(1, int(core.best_scenario.position.contracts * confidence / 100))
        else:
            contracts = 0
        
        return {
            'bias': bias,
            'confidence': min(100, max(0, confidence)),
            'contracts': contracts,
            'action': "TRADE" if confidence > 60 and bias != "NEUTRAL" else "WAIT",
            'notes': [
                f"Signal: {core.signal.value}",
                f"Session: {time_ctx.session.session.value}",
                f"Vol Regime: {vol.regime.value}",
                f"Risk Regime: {intermarket.regime.value}"
            ]
        }
    
    def reset(self):
        """Reset all engines"""
        self.core.reset()
        self.gex.reset()
        self.flow.reset()
        self.vol.reset()
        self.intermarket.reset()


# ═══════════════════════════════════════════════════════════════════════════════
# EXPORTS
# ═══════════════════════════════════════════════════════════════════════════════

__all__ = [
    # Version
    '__version__',
    '__author__',
    '__description__',
    
    # Main unified class
    'TitanOmega',
    
    # Core
    'TitanEngine',
    'TitanConfig',
    'GammaNode',
    'Bar',
    'ESData',
    'EngineOutput',
    'Signal',
    'Urgency',
    'Direction',
    'RegimeType',
    
    # Time
    'TimeContextEngine',
    'MarketSession',
    'SpecialDay',
    'TimeContext',
    
    # GEX
    'GEXEngine',
    'OptionContract',
    'AggregatedGEX',
    'GammaWall',
    
    # Flow
    'FlowEngine',
    'OptionTrade',
    'FlowSummary',
    'Sweep',
    'Block',
    'FlowSentiment',
    
    # Volatility
    'VolatilityEngine',
    'VolRegime',
    'VolatilityAnalysis',
    'TermStructure',
    
    # Intermarket
    'IntermarketEngine',
    'RiskRegime',
    'RiskRegimeAnalysis',
]
