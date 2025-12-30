"""
TITAN OMEGA v18.0 — ULTIMATE SPX DAY TRADING DASHBOARD
======================================================
Unified dashboard integrating all TITAN modules

Features:
- Real-time gamma exposure visualization
- Time context awareness
- Flow intelligence display
- Volatility regime monitoring
- Intermarket divergence alerts
- Scenario generation with Kelly sizing
- Comprehensive risk management
"""

import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
from datetime import datetime, timedelta
import time
import os
from typing import Dict, List, Optional

# Import TITAN modules
from titan_core import (
    TitanEngine, GammaNode, Bar, OptionsTrade, ESData,
    Signal, Urgency, DataQuality, Direction, RegimeType
)
from titan_time import TimeContextEngine, MarketSession, SpecialDay
from titan_gex import GEXEngine, OptionContract, AggregatedGEX
from titan_flow import FlowEngine, OptionTrade, FlowSummary, FlowSentiment
from titan_volatility import VolatilityEngine, VolRegime, VolatilityAnalysis
from titan_intermarket import IntermarketEngine, RiskRegime, RiskRegimeAnalysis


# ═══════════════════════════════════════════════════════════════════════════════
# PAGE CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

st.set_page_config(
    page_title="TITAN OMEGA v18.0 | SPX Quant Terminal",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS
st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        font-weight: bold;
        background: linear-gradient(90deg, #00d4ff, #7b2cbf);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 0.5rem;
    }
    .metric-card {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-radius: 10px;
        padding: 1rem;
        border: 1px solid #0f3460;
    }
    .signal-bullish {
        color: #00ff88;
        font-weight: bold;
        font-size: 1.2rem;
    }
    .signal-bearish {
        color: #ff4757;
        font-weight: bold;
        font-size: 1.2rem;
    }
    .signal-neutral {
        color: #ffa502;
        font-weight: bold;
        font-size: 1.2rem;
    }
    .warning-box {
        background-color: #2d1f1f;
        border-left: 4px solid #ff4757;
        padding: 0.5rem 1rem;
        margin: 0.5rem 0;
        border-radius: 0 5px 5px 0;
    }
    .info-box {
        background-color: #1f2d2f;
        border-left: 4px solid #00d4ff;
        padding: 0.5rem 1rem;
        margin: 0.5rem 0;
        border-radius: 0 5px 5px 0;
    }
    .stMetric > div {
        background-color: #16213e;
        border-radius: 8px;
        padding: 0.5rem;
    }
</style>
""", unsafe_allow_html=True)


# ═══════════════════════════════════════════════════════════════════════════════
# SESSION STATE INITIALIZATION
# ═══════════════════════════════════════════════════════════════════════════════

def init_session_state():
    """Initialize all session state variables"""
    if 'titan_engine' not in st.session_state:
        st.session_state.titan_engine = TitanEngine(account_size=50000)
    
    if 'time_engine' not in st.session_state:
        st.session_state.time_engine = TimeContextEngine()
    
    if 'gex_engine' not in st.session_state:
        st.session_state.gex_engine = GEXEngine()
    
    if 'flow_engine' not in st.session_state:
        st.session_state.flow_engine = FlowEngine()
    
    if 'vol_engine' not in st.session_state:
        st.session_state.vol_engine = VolatilityEngine()
    
    if 'intermarket_engine' not in st.session_state:
        st.session_state.intermarket_engine = IntermarketEngine()
    
    if 'price_history' not in st.session_state:
        st.session_state.price_history = []
    
    if 'signal_history' not in st.session_state:
        st.session_state.signal_history = []

init_session_state()


# ═══════════════════════════════════════════════════════════════════════════════
# SIDEBAR
# ═══════════════════════════════════════════════════════════════════════════════

with st.sidebar:
    st.markdown("## ⚡ TITAN OMEGA v18.0")
    st.markdown("---")
    
    # Mode selection
    mode = st.radio("Mode", ["🔴 Live", "🟡 Simulation"], index=1)
    is_live = mode == "🔴 Live"
    
    st.markdown("---")
    
    # Account settings
    st.markdown("### 💰 Account")
    account_size = st.number_input("Account Size ($)", 10000, 1000000, 50000, step=5000)
    st.session_state.titan_engine.set_account(account_size)
    
    max_risk = st.slider("Max Risk per Trade (%)", 0.5, 3.0, 1.5, 0.1)
    
    st.markdown("---")
    
    # Simulation inputs
    if not is_live:
        st.markdown("### 🎮 Simulation")
        sim_spot = st.number_input("SPX Spot", 4000.0, 6500.0, 5950.0, step=1.0)
        sim_vix = st.slider("VIX", 10.0, 50.0, 18.0, 0.5)
        sim_gex = st.slider("Net GEX ($B)", -5.0, 5.0, 1.0, 0.1) * 1e9
        sim_flip = st.number_input("Gamma Flip", sim_spot - 100, sim_spot + 100, sim_spot - 20.0)
        
        # ES data
        st.markdown("### 📊 ES Futures")
        es_price = st.number_input("ES Price", sim_spot - 50, sim_spot + 50, sim_spot + 5.0)
        es_momentum = st.slider("ES Momentum", -1.0, 1.0, 0.2, 0.05)
        es_imbalance = st.slider("Book Imbalance", -1.0, 1.0, 0.1, 0.05)
        
        # Flow simulation
        st.markdown("### 💹 Flow")
        sim_flow_bias = st.select_slider(
            "Flow Sentiment",
            options=["Strong Sell", "Sell", "Neutral", "Buy", "Strong Buy"],
            value="Buy"
        )
    
    st.markdown("---")
    
    # Refresh
    if st.button("🔄 Refresh Analysis", use_container_width=True):
        st.rerun()
    
    auto_refresh = st.checkbox("Auto-refresh (5s)", value=False)


# ═══════════════════════════════════════════════════════════════════════════════
# DATA GENERATION (Simulation Mode)
# ═══════════════════════════════════════════════════════════════════════════════

def generate_sim_data():
    """Generate simulation data"""
    now = int(time.time() * 1000)
    
    # Generate gamma nodes
    nodes = []
    for i in range(-10, 11):
        strike = sim_spot + i * 5
        gamma = np.random.uniform(1e9, 5e9)
        sign = 1 if i > 0 else -1
        nodes.append(GammaNode(
            strike=strike,
            gamma=gamma * sign,
            abs_gamma=gamma,
            sign=sign,
            delta=0.5 + i * 0.03,
            oi=int(np.random.uniform(5000, 20000)),
            volume=int(np.random.uniform(100, 2000)),
            touch_count=0
        ))
    
    # Generate bars
    bars = []
    base_price = sim_spot
    for i in range(20):
        noise = np.random.normal(0, 0.5)
        bar = Bar(
            time=now - (20 - i) * 60000,
            open=base_price + noise,
            high=base_price + noise + np.random.uniform(0, 1),
            low=base_price + noise - np.random.uniform(0, 1),
            close=base_price + noise + np.random.uniform(-0.5, 0.5),
            volume=np.random.uniform(1000, 5000)
        )
        bars.append(bar)
        base_price = bar.close
    
    return nodes, bars


def generate_sim_flow():
    """Generate simulated flow data"""
    flow_map = {
        "Strong Sell": -100,
        "Sell": -50,
        "Neutral": 0,
        "Buy": 50,
        "Strong Buy": 100
    }
    return flow_map.get(sim_flow_bias, 0)


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

# Run analysis
if not is_live:
    nodes, bars = generate_sim_data()
    
    # Update engines with simulation data
    for bar in bars[-5:]:
        st.session_state.titan_engine.add_bar(bar)
    
    # Set ES data
    st.session_state.titan_engine.set_es(ESData(
        price=es_price,
        momentum=es_momentum,
        order_book_imbalance=es_imbalance
    ))
    
    # Update intermarket
    st.session_state.intermarket_engine.update(
        spx=sim_spot,
        es=es_price,
        vix=sim_vix
    )
    
    # Update volatility engine
    for bar in bars:
        st.session_state.vol_engine.add_close(bar.close)
    
    # Run core analysis
    analysis = st.session_state.titan_engine.analyze(
        spot=sim_spot,
        nodes=nodes,
        net_gex=sim_gex,
        flip=sim_flip,
        vix=sim_vix
    )
    
    # Time context
    time_ctx = st.session_state.time_engine.get_context()
    
    # Volatility analysis
    vol_analysis = st.session_state.vol_engine.analyze(
        vix=sim_vix,
        vix9d=sim_vix * 1.05 if sim_vix > 20 else sim_vix * 0.95,
        vix3m=sim_vix * 0.95 if sim_vix > 20 else sim_vix * 1.05,
        vvix=90 + sim_vix
    )
    
    # Intermarket analysis
    intermarket = st.session_state.intermarket_engine.analyze()
    
    # Store current values for display
    current_spot = sim_spot
    current_vix = sim_vix
    current_gex = sim_gex
    current_flip = sim_flip

else:
    st.warning("🔴 Live mode requires API configuration. Using simulation data.")
    # Fallback to simulation
    nodes, bars = generate_sim_data()
    analysis = st.session_state.titan_engine.analyze(
        spot=5950,
        nodes=nodes,
        net_gex=1e9,
        flip=5930,
        vix=18
    )
    time_ctx = st.session_state.time_engine.get_context()
    vol_analysis = st.session_state.vol_engine.analyze(vix=18)
    intermarket = st.session_state.intermarket_engine.analyze()
    current_spot = 5950
    current_vix = 18
    current_gex = 1e9
    current_flip = 5930


# ═══════════════════════════════════════════════════════════════════════════════
# HEADER
# ═══════════════════════════════════════════════════════════════════════════════

st.markdown('<p class="main-header">⚡ TITAN OMEGA v18.0</p>', unsafe_allow_html=True)
st.markdown(f"**SPX Day Trading Command Center** | {datetime.now().strftime('%Y-%m-%d %H:%M:%S ET')}")

# Top metrics row
col1, col2, col3, col4, col5, col6 = st.columns(6)

with col1:
    st.metric("SPX", f"{current_spot:,.2f}", 
              f"{analysis.momentum.velocity:+.2f}" if analysis.momentum else "0.00")

with col2:
    vix_delta = "🔺" if vol_analysis.vix > 20 else "🔻" if vol_analysis.vix < 15 else "➖"
    st.metric("VIX", f"{current_vix:.2f}", vix_delta)

with col3:
    gex_display = current_gex / 1e9
    gex_color = "🟢" if gex_display > 0 else "🔴"
    st.metric("Net GEX", f"{gex_color} {gex_display:+.2f}B")

with col4:
    flip_dist = current_spot - current_flip
    st.metric("Flip Distance", f"{flip_dist:+.1f}", 
              "Above" if flip_dist > 0 else "Below")

with col5:
    signal_emoji = {
        Signal.CONVICTION_LONG: "🚀",
        Signal.CONVICTION_SHORT: "📉",
        Signal.FLOW_DIVERGENCE: "⚠️",
        Signal.NEUTRAL: "➖",
        Signal.NO_TRADE: "🚫"
    }
    st.metric("Signal", f"{signal_emoji.get(analysis.signal, '➖')} {analysis.signal.value}")

with col6:
    st.metric("Session", time_ctx.session.session.value.replace("_", " "))

st.markdown("---")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN CONTENT - 3 COLUMN LAYOUT
# ═══════════════════════════════════════════════════════════════════════════════

left_col, center_col, right_col = st.columns([1, 2, 1])


# ─────────────────────────────────────────────────────────────────────────────
# LEFT COLUMN - Regime & Warnings
# ─────────────────────────────────────────────────────────────────────────────

with left_col:
    st.markdown("### 🎯 Market Regime")
    
    # Regime card
    regime_color = "🟢" if analysis.regime.type == RegimeType.POSITIVE else "🔴"
    st.markdown(f"""
    <div class="metric-card">
        <h3>{regime_color} {analysis.regime.type.value} GAMMA</h3>
        <p><b>Character:</b> {analysis.regime.character.value}</p>
        <p><b>Flip Zone:</b> {'⚠️ IN PHASE' if analysis.regime.in_phase else '✅ Clear'}</p>
        <p><b>Kill Zone:</b> {'🔴 ACTIVE' if analysis.regime.kill_zone else '✅ Clear'}</p>
        <p><b>Slippage:</b> {analysis.regime.slippage_mult:.0%}</p>
    </div>
    """, unsafe_allow_html=True)
    
    st.markdown("### ⏰ Time Context")
    
    # Time context card
    session_emoji = {
        MarketSession.OPEN_DRIVE: "🚀",
        MarketSession.OPEN_REVERSAL: "🔄",
        MarketSession.MORNING_TREND: "📈",
        MarketSession.MIDDAY_CHOP: "⚠️",
        MarketSession.POWER_HOUR: "⚡",
        MarketSession.MOC_IMBALANCE: "📊"
    }.get(time_ctx.session.session, "⏰")
    
    st.markdown(f"""
    <div class="metric-card">
        <h4>{session_emoji} {time_ctx.session.session.value.replace('_', ' ')}</h4>
        <p><b>Size Mult:</b> {time_ctx.final_size_mult:.0%}</p>
        <p><b>Momentum:</b> {time_ctx.final_momentum_mult:.1f}x</p>
        <p><b>Strategy:</b> {time_ctx.primary_strategy}</p>
        <p><b>Mins to Close:</b> {int(time_ctx.mins_to_close)}</p>
    </div>
    """, unsafe_allow_html=True)
    
    st.markdown("### 📊 Volatility")
    
    vol_emoji = {
        VolRegime.LOW: "😴",
        VolRegime.NORMAL: "😐",
        VolRegime.ELEVATED: "😬",
        VolRegime.HIGH: "😰",
        VolRegime.EXTREME: "🔥",
        VolRegime.CRISIS: "💀"
    }.get(vol_analysis.regime, "❓")
    
    st.markdown(f"""
    <div class="metric-card">
        <h4>{vol_emoji} {vol_analysis.regime.value}</h4>
        <p><b>Term:</b> {vol_analysis.term_structure.structure.value}</p>
        <p><b>Skew:</b> {vol_analysis.skew_regime.value}</p>
        <p><b>RV/IV:</b> {vol_analysis.rv_iv_ratio:.2f}</p>
        <p><b>Bias:</b> {vol_analysis.options_bias}</p>
    </div>
    """, unsafe_allow_html=True)


# ─────────────────────────────────────────────────────────────────────────────
# CENTER COLUMN - Charts & Scenarios
# ─────────────────────────────────────────────────────────────────────────────

with center_col:
    st.markdown("### 📈 Gamma Exposure Map")
    
    # Create GEX chart
    if not is_live:
        # Build strike GEX data
        strike_data = []
        for node in nodes:
            strike_data.append({
                'strike': node.strike,
                'gex': node.gex / 1e9,
                'type': 'Call' if node.sign > 0 else 'Put'
            })
        
        df_gex = pd.DataFrame(strike_data)
        
        # Create figure
        fig = make_subplots(rows=1, cols=1)
        
        # Call GEX (positive)
        calls = df_gex[df_gex['type'] == 'Call']
        fig.add_trace(go.Bar(
            x=calls['strike'],
            y=calls['gex'],
            name='Call GEX',
            marker_color='#00ff88',
            opacity=0.8
        ))
        
        # Put GEX (negative)
        puts = df_gex[df_gex['type'] == 'Put']
        fig.add_trace(go.Bar(
            x=puts['strike'],
            y=puts['gex'],
            name='Put GEX',
            marker_color='#ff4757',
            opacity=0.8
        ))
        
        # Add spot line
        fig.add_vline(x=current_spot, line_width=2, line_color="#ffff00", 
                     annotation_text=f"Spot: {current_spot:.0f}")
        
        # Add flip line
        fig.add_vline(x=current_flip, line_width=2, line_dash="dash", 
                     line_color="#ff9f43", annotation_text=f"Flip: {current_flip:.0f}")
        
        fig.update_layout(
            template="plotly_dark",
            height=350,
            margin=dict(l=20, r=20, t=30, b=20),
            legend=dict(orientation="h", yanchor="bottom", y=1.02),
            xaxis_title="Strike",
            yaxis_title="GEX ($B)",
            barmode='relative'
        )
        
        st.plotly_chart(fig, use_container_width=True)
    
    # Scenarios
    st.markdown("### 🎯 Active Scenarios")
    
    if analysis.scenarios:
        for i, scenario in enumerate(analysis.scenarios[:3]):
            urgency_color = {
                Urgency.NOW: "🔴",
                Urgency.READY: "🟠",
                Urgency.PREP: "🟡",
                Urgency.WAIT: "⚪"
            }.get(scenario.urgency, "⚪")
            
            direction_color = "🟢" if scenario.direction == "LONG" else "🔴"
            
            with st.expander(f"{urgency_color} {scenario.type} | {direction_color} {scenario.direction} | {scenario.confidence}% Conf", expanded=(i==0)):
                col_a, col_b, col_c = st.columns(3)
                
                with col_a:
                    st.markdown(f"""
                    **Entry Zone:** {scenario.entry_low:.2f} - {scenario.entry_high:.2f}
                    
                    **Stop:** {scenario.stop:.2f}
                    
                    **Target:** {scenario.target:.2f}
                    """)
                
                with col_b:
                    st.markdown(f"""
                    **Kelly:** {scenario.position.kelly:.1%}
                    
                    **Contracts:** {scenario.position.contracts}
                    
                    **Max Risk:** ${scenario.position.max_risk:,.0f}
                    """)
                
                with col_c:
                    st.markdown(f"""
                    **Urgency:** {scenario.urgency.value}
                    
                    **Win Prob:** {scenario.position.adjusted_win_prob:.0%}
                    
                    **Trigger:** {scenario.trigger_strike:.0f if scenario.trigger_strike else 'N/A'}
                    """)
                
                if scenario.warnings:
                    st.warning(" | ".join(scenario.warnings))
    else:
        st.info("No active scenarios. Wait for setup.")
    
    # Force vector display
    st.markdown("### 🧭 Force Analysis")
    
    force_col1, force_col2 = st.columns(2)
    
    with force_col1:
        direction_emoji = "🔼" if analysis.force.direction == Direction.UP else "🔽" if analysis.force.direction == Direction.DOWN else "➖"
        st.metric("Force Direction", f"{direction_emoji} {analysis.force.direction.value}")
        st.metric("Confidence", f"{analysis.force.confidence:.0f}%")
    
    with force_col2:
        st.metric("Equilibrium", f"{analysis.force.equilibrium:.2f}")
        st.metric("Imbalance", f"{analysis.force.imbalance:.2%}")


# ─────────────────────────────────────────────────────────────────────────────
# RIGHT COLUMN - Warnings & Flow
# ─────────────────────────────────────────────────────────────────────────────

with right_col:
    st.markdown("### ⚠️ Warnings")
    
    all_warnings = []
    
    # Engine warnings
    for w in analysis.warnings:
        all_warnings.append(f"[{w.severity}] {w.type}: {w.message}")
    
    # Time warnings
    all_warnings.extend(time_ctx.warnings[:3])
    
    # Vol warnings
    all_warnings.extend(vol_analysis.warnings[:3])
    
    # Intermarket warnings
    all_warnings.extend(intermarket.warnings[:3])
    
    if all_warnings:
        for warning in all_warnings[:8]:
            if "CRIT" in warning or "🔴" in warning:
                st.markdown(f'<div class="warning-box">{warning}</div>', unsafe_allow_html=True)
            else:
                st.markdown(f'<div class="info-box">{warning}</div>', unsafe_allow_html=True)
    else:
        st.success("✅ No active warnings")
    
    st.markdown("### 🌐 Intermarket")
    
    regime_emoji = {
        RiskRegime.RISK_ON: "🟢",
        RiskRegime.RISK_OFF: "🔴",
        RiskRegime.MIXED: "🟡",
        RiskRegime.DIVERGENCE: "⚠️"
    }.get(intermarket.regime, "❓")
    
    st.markdown(f"""
    <div class="metric-card">
        <h4>{regime_emoji} {intermarket.regime.value}</h4>
        <p><b>SPX:</b> {intermarket.spx_direction.value}</p>
        <p><b>ES:</b> {intermarket.es_direction.value}</p>
        <p><b>VIX:</b> {intermarket.vix_direction.value}</p>
        <p><b>TLT:</b> {intermarket.tlt_signal}</p>
        <p><b>Bias:</b> {intermarket.trade_bias}</p>
        <p><b>Size Adj:</b> {intermarket.size_adjustment:.0%}</p>
    </div>
    """, unsafe_allow_html=True)
    
    st.markdown("### 📊 Data Quality")
    
    quality_emoji = {
        DataQuality.GOOD: "🟢",
        DataQuality.STALE: "🟡",
        DataQuality.GAP: "🔴",
        DataQuality.WARMING: "🟠"
    }.get(analysis.data_quality, "❓")
    
    st.markdown(f"""
    <div class="metric-card">
        <h4>{quality_emoji} {analysis.data_quality.value}</h4>
        <p><b>Sigma:</b> {analysis.sigma:.2f}</p>
        <p><b>RV:</b> {analysis.realized_vol:.2f}</p>
        <p><b>ES Corr:</b> {analysis.es_correlation.correlation:.2f}</p>
        <p><b>IV Crush:</b> {analysis.iv_crush.risk_score:.0f}%</p>
    </div>
    """, unsafe_allow_html=True)


# ═══════════════════════════════════════════════════════════════════════════════
# BOTTOM SECTION - TACTICAL GUIDE
# ═══════════════════════════════════════════════════════════════════════════════

st.markdown("---")
st.markdown("### ⚔️ TACTICAL GUIDE")

tac_col1, tac_col2, tac_col3 = st.columns(3)

with tac_col1:
    st.markdown("#### 📋 Current Setup")
    
    if analysis.signal == Signal.CONVICTION_LONG:
        st.markdown("""
        <div style="background-color: #0a3d1a; padding: 1rem; border-radius: 8px; border: 1px solid #00ff88;">
            <h4 style="color: #00ff88;">🚀 CONVICTION LONG</h4>
            <p>Structure and flow aligned bullish. Look for dip entries.</p>
        </div>
        """, unsafe_allow_html=True)
    elif analysis.signal == Signal.CONVICTION_SHORT:
        st.markdown("""
        <div style="background-color: #3d0a0a; padding: 1rem; border-radius: 8px; border: 1px solid #ff4757;">
            <h4 style="color: #ff4757;">📉 CONVICTION SHORT</h4>
            <p>Structure and flow aligned bearish. Look for rally fades.</p>
        </div>
        """, unsafe_allow_html=True)
    elif analysis.signal == Signal.FLOW_DIVERGENCE:
        st.markdown("""
        <div style="background-color: #3d2a0a; padding: 1rem; border-radius: 8px; border: 1px solid #ffa502;">
            <h4 style="color: #ffa502;">⚠️ FLOW DIVERGENCE</h4>
            <p>Flow contradicts structure. Reduce size or wait.</p>
        </div>
        """, unsafe_allow_html=True)
    else:
        st.markdown("""
        <div style="background-color: #1a1a2e; padding: 1rem; border-radius: 8px; border: 1px solid #666;">
            <h4>➖ NEUTRAL</h4>
            <p>No clear edge. Wait for better setup.</p>
        </div>
        """, unsafe_allow_html=True)

with tac_col2:
    st.markdown("#### 🎯 Key Levels")
    
    levels_df = pd.DataFrame({
        'Level': ['Gamma Flip', 'Equilibrium', 'Nearest Support', 'Nearest Resistance'],
        'Price': [
            f"{current_flip:.2f}",
            f"{analysis.force.equilibrium:.2f}",
            f"{current_spot - 10:.2f}",
            f"{current_spot + 10:.2f}"
        ],
        'Distance': [
            f"{current_spot - current_flip:+.1f}",
            f"{current_spot - analysis.force.equilibrium:+.1f}",
            f"{-10:.1f}",
            f"{10:.1f}"
        ]
    })
    
    st.dataframe(levels_df, hide_index=True, use_container_width=True)

with tac_col3:
    st.markdown("#### ⏱️ Session Notes")
    
    if time_ctx.session.notes:
        for note in time_ctx.session.notes[:5]:
            st.markdown(f"• {note}")
    
    if time_ctx.avoid_strategies:
        st.markdown("**Avoid:**")
        for avoid in time_ctx.avoid_strategies[:3]:
            st.markdown(f"• ❌ {avoid}")


# ═══════════════════════════════════════════════════════════════════════════════
# FOOTER
# ═══════════════════════════════════════════════════════════════════════════════

st.markdown("---")
st.markdown("""
<div style="text-align: center; color: #666; font-size: 0.8rem;">
    <p>TITAN OMEGA v18.0 | Physics-Based SPX Day Trading Engine</p>
    <p>⚠️ For educational purposes only. Not financial advice. Trade at your own risk.</p>
</div>
""", unsafe_allow_html=True)


# Auto-refresh
if auto_refresh:
    time.sleep(5)
    st.rerun()
