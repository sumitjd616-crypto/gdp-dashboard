"""
TITAN ULTIMATE v19.0 — STREAMLIT DASHBOARD
==========================================

The ultimate SPX day trading command center combining all TITAN versions.
"""

import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from datetime import datetime, timedelta
import time
import os

from titan_ultimate import (
    TitanUltimate, GammaNode, Bar, OptionFlow,
    DealerPosition, MarketMood, RegimeChar, Signal, Urgency,
    DataQuality, CFG
)

# ═══════════════════════════════════════════════════════════════════════════════
# PAGE CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

st.set_page_config(
    page_title="TITAN ULTIMATE v19.0",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
    
    .main-title {
        font-family: 'JetBrains Mono', monospace;
        font-size: 2.5rem;
        font-weight: bold;
        background: linear-gradient(90deg, #00ff88, #00d4ff, #7b2cbf);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-align: center;
        margin-bottom: 0;
    }
    .subtitle {
        font-family: 'JetBrains Mono', monospace;
        text-align: center;
        color: #666;
        font-size: 0.9rem;
    }
    .metric-card {
        background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
        border: 1px solid #30363d;
        border-radius: 12px;
        padding: 1rem;
        margin: 0.5rem 0;
    }
    .signal-conviction-long {
        background: linear-gradient(135deg, #0d2818 0%, #1a4d2e 100%);
        border: 2px solid #00ff88;
        border-radius: 12px;
        padding: 1.5rem;
        text-align: center;
    }
    .signal-conviction-short {
        background: linear-gradient(135deg, #2d0d0d 0%, #4d1a1a 100%);
        border: 2px solid #ff4757;
        border-radius: 12px;
        padding: 1.5rem;
        text-align: center;
    }
    .signal-neutral {
        background: linear-gradient(135deg, #1a1a0d 0%, #2d2d1a 100%);
        border: 2px solid #ffa502;
        border-radius: 12px;
        padding: 1.5rem;
        text-align: center;
    }
    .signal-no-trade {
        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
        border: 2px solid #666;
        border-radius: 12px;
        padding: 1.5rem;
        text-align: center;
    }
    .why-box {
        background-color: #0d1117;
        border-left: 4px solid #00d4ff;
        padding: 1rem;
        margin: 1rem 0;
        border-radius: 0 8px 8px 0;
        font-family: 'JetBrains Mono', monospace;
    }
    .entry-box {
        background: linear-gradient(135deg, #0a1a0a 0%, #1a3d1a 100%);
        border: 2px solid #00ff88;
        border-radius: 12px;
        padding: 1.5rem;
        margin: 1rem 0;
    }
    .warning-badge {
        background-color: #ffa502;
        color: #000;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.8rem;
        font-weight: bold;
        margin: 0.2rem;
        display: inline-block;
    }
    .danger-badge {
        background-color: #ff4757;
        color: #fff;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.8rem;
        font-weight: bold;
        margin: 0.2rem;
        display: inline-block;
    }
    .success-badge {
        background-color: #00ff88;
        color: #000;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.8rem;
        font-weight: bold;
        margin: 0.2rem;
        display: inline-block;
    }
    .level-table {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.9rem;
    }
</style>
""", unsafe_allow_html=True)


# ═══════════════════════════════════════════════════════════════════════════════
# SESSION STATE
# ═══════════════════════════════════════════════════════════════════════════════

if 'engine' not in st.session_state:
    st.session_state.engine = TitanUltimate(account_size=50000)
    st.session_state.history = []


# ═══════════════════════════════════════════════════════════════════════════════
# SIDEBAR
# ═══════════════════════════════════════════════════════════════════════════════

with st.sidebar:
    st.markdown("## ⚡ TITAN ULTIMATE")
    st.markdown("### v19.0")
    st.markdown("---")
    
    # Mode
    mode = st.radio("Mode", ["🎮 Simulation", "🔴 Live"], index=0)
    is_sim = mode == "🎮 Simulation"
    
    st.markdown("---")
    
    # Account
    st.markdown("### 💰 Account")
    account_size = st.number_input("Account Size ($)", 10000, 500000, 50000, step=5000)
    st.session_state.engine.account_size = account_size
    
    st.markdown("---")
    
    if is_sim:
        st.markdown("### 🎮 Simulation")
        
        sim_spot = st.number_input("SPX Spot", 5000.0, 6500.0, 5950.0, step=1.0)
        sim_vix = st.slider("VIX", 10.0, 50.0, 18.0, 0.5)
        sim_gex = st.slider("Net GEX ($B)", -3.0, 3.0, -1.5, 0.1) * 1e9
        sim_flip = st.number_input("Gamma Flip", sim_spot - 100, sim_spot + 100, sim_spot - 15.0)
        
        st.markdown("### 📊 Flow Bias")
        sim_flow = st.select_slider(
            "Flow Direction",
            options=["Strong Bearish", "Bearish", "Neutral", "Bullish", "Strong Bullish"],
            value="Bullish"
        )
    
    st.markdown("---")
    
    col1, col2 = st.columns(2)
    with col1:
        if st.button("🔄 Refresh", use_container_width=True):
            st.rerun()
    with col2:
        auto_refresh = st.checkbox("Auto", value=False)
    
    st.markdown("---")
    st.markdown("### 📚 Quick Reference")
    with st.expander("Dealer Mechanics"):
        st.markdown("""
        **SHORT GAMMA:**
        - Price ↑ → Dealers BUY → Fuel 🔥
        - Price ↓ → Dealers SELL → Pressure 📉
        
        **LONG GAMMA:**
        - Price ↑ → Dealers SELL → Cap
        - Price ↓ → Dealers BUY → Support
        """)


# ═══════════════════════════════════════════════════════════════════════════════
# GENERATE DATA
# ═══════════════════════════════════════════════════════════════════════════════

def generate_sim_data(spot, vix, gex, flip, flow_bias):
    """Generate simulation data"""
    engine = st.session_state.engine
    
    # Clear old data
    engine.bars = []
    engine.trades = []
    engine.sweeps = []
    engine.nodes = []
    engine.vacuum_strikes = set()
    
    # Generate bars
    now = int(time.time() * 1000)
    base = spot - 5
    for i in range(30):
        noise = np.random.normal(0, 0.3)
        bar = Bar(
            time=now - (30 - i) * 60000,
            open=base + noise,
            high=base + noise + np.random.uniform(0, 0.5),
            low=base + noise - np.random.uniform(0, 0.5),
            close=base + noise + np.random.uniform(-0.2, 0.4),
            volume=np.random.uniform(1000, 5000)
        )
        engine.add_bar(bar)
        base = bar.close
    
    # Generate nodes
    nodes = []
    for i in range(-15, 16):
        strike = round(spot + i * 5)
        gamma = np.random.uniform(0.5e9, 3e9)
        
        # Make gamma distribution realistic
        dist = abs(i)
        gamma *= max(0.2, 1 - dist * 0.05)
        
        nodes.append(GammaNode(
            strike=strike,
            gamma=gamma if i > 0 else -gamma,
            abs_gamma=gamma,
            oi=int(np.random.uniform(3000, 25000)),
            volume=int(np.random.uniform(50, 2000))
        ))
    engine.set_nodes(nodes)
    
    # Generate flow based on bias
    flow_map = {
        "Strong Bearish": (-0.8, 'put', 'BUY'),
        "Bearish": (-0.4, 'put', 'BUY'),
        "Neutral": (0, 'call', 'BUY'),
        "Bullish": (0.4, 'call', 'BUY'),
        "Strong Bullish": (0.8, 'call', 'BUY')
    }
    bias_val, primary_type, primary_side = flow_map.get(flow_bias, (0, 'call', 'BUY'))
    
    flows = []
    for i in range(15):
        opt_type = primary_type if np.random.random() > 0.3 else ('put' if primary_type == 'call' else 'call')
        side = primary_side if np.random.random() > 0.3 else ('SELL' if primary_side == 'BUY' else 'BUY')
        
        flows.append(OptionFlow(
            timestamp=now - i * 5000,
            strike=round(spot + np.random.randint(-8, 9) * 5),
            option_type=opt_type,
            side=side,
            size=np.random.randint(30, 400),
            premium=np.random.uniform(5000, 80000),
            exchange=np.random.choice(['CBOE', 'ISE', 'PHLX', 'AMEX', 'BATS']),
            iv=np.random.uniform(15, 30),
            vega=np.random.uniform(0.05, 0.2),
            theta=np.random.uniform(-0.1, -0.02)
        ))
    engine.add_flow(flows)
    
    # Run analysis
    return engine.analyze(
        spot=spot,
        vix=vix,
        net_gex=gex,
        gamma_flip=flip,
        mins_to_exp=120
    )


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

if is_sim:
    state = generate_sim_data(sim_spot, sim_vix, sim_gex, sim_flip, sim_flow)
else:
    st.warning("🔴 Live mode requires API connection. Using simulation.")
    state = generate_sim_data(5950, 18, -1.5e9, 5935, "Bullish")


# ═══════════════════════════════════════════════════════════════════════════════
# HEADER
# ═══════════════════════════════════════════════════════════════════════════════

st.markdown('<h1 class="main-title">⚡ TITAN ULTIMATE v19.0</h1>', unsafe_allow_html=True)
st.markdown('<p class="subtitle">SPX Day Trading Command Center | Dealer Flow Intelligence</p>', unsafe_allow_html=True)

# Top metrics
m1, m2, m3, m4, m5 = st.columns(5)

with m1:
    st.metric("SPX", f"{state.spot:,.2f}", f"{state.momentum.vw_velocity:+.2f}/min")

with m2:
    vix_emoji = "🔥" if state.vix > 25 else "😴" if state.vix < 15 else "📊"
    st.metric("VIX", f"{vix_emoji} {state.vix:.2f}")

with m3:
    gex_val = state.dealer.total_gex / 1e9
    gex_emoji = "🟢" if gex_val > 0.5 else "🔴" if gex_val < -0.5 else "🟡"
    st.metric("Net GEX", f"{gex_emoji} ${gex_val:+.2f}B")

with m4:
    flip_dist = state.dealer.dist_to_flip
    st.metric("Flip Dist", f"{flip_dist:+.1f}")

with m5:
    st.metric("Data", state.data_quality.value)

st.markdown("---")


# ═══════════════════════════════════════════════════════════════════════════════
# SIGNAL BOX
# ═══════════════════════════════════════════════════════════════════════════════

signal_class = {
    Signal.CONVICTION_LONG: "signal-conviction-long",
    Signal.CONVICTION_SHORT: "signal-conviction-short",
    Signal.NEUTRAL: "signal-neutral",
    Signal.NO_TRADE: "signal-no-trade",
    Signal.FLOW_DIVERGENCE: "signal-neutral"
}.get(state.signal, "signal-neutral")

signal_text = state.signal.value

st.markdown(f"""
<div class="{signal_class}">
    <h1 style="margin: 0; font-size: 2rem;">{signal_text}</h1>
    <p style="margin: 0.5rem 0 0 0; opacity: 0.8;">Force: {state.force_direction} ({state.force_confidence:.0f}%) | Flow: {state.flow.flow_score:+.2f}</p>
</div>
""", unsafe_allow_html=True)

st.markdown("---")


# ═══════════════════════════════════════════════════════════════════════════════
# WHY IS PRICE MOVING? (THE KEY INSIGHT)
# ═══════════════════════════════════════════════════════════════════════════════

st.markdown("## 🧠 WHY IS PRICE MOVING?")

st.markdown(f"""
<div class="why-box">
    <p style="font-size: 1.1rem; margin: 0;">{state.why_moving}</p>
</div>
""", unsafe_allow_html=True)

col_exp1, col_exp2 = st.columns(2)

with col_exp1:
    st.markdown("### 🔮 What to Expect")
    st.info(state.what_expect)

with col_exp2:
    st.markdown("### 🎭 Market Mood")
    mood_emoji = {
        MarketMood.TREND: "📈",
        MarketMood.VOL_EXPANSION: "🌪️",
        MarketMood.MEAN_REVERT: "🔄",
        MarketMood.CHOP: "〰️",
        MarketMood.UNKNOWN: "❓"
    }
    st.markdown(f"### {mood_emoji.get(state.mood, '❓')} {state.mood.value}")

st.markdown("---")


# ═══════════════════════════════════════════════════════════════════════════════
# TWO COLUMN LAYOUT
# ═══════════════════════════════════════════════════════════════════════════════

col_left, col_right = st.columns([3, 2])

with col_left:
    # GEX Chart
    st.markdown("### 📊 Gamma Exposure Map")
    
    # Build chart data
    chart_data = []
    for node in st.session_state.engine.nodes:
        chart_data.append({
            'strike': node.strike,
            'gex': node.gamma / 1e9 if node.gamma > 0 else -node.gamma / 1e9,
            'type': 'Call' if node.gamma > 0 else 'Put',
            'health': node.health.value if hasattr(node, 'health') else 'UNKNOWN'
        })
    
    df = pd.DataFrame(chart_data)
    
    fig = go.Figure()
    
    # Calls
    calls = df[df['type'] == 'Call']
    fig.add_trace(go.Bar(
        x=calls['strike'],
        y=calls['gex'],
        name='Call GEX',
        marker_color='#00ff88',
        opacity=0.8
    ))
    
    # Puts
    puts = df[df['type'] == 'Put']
    fig.add_trace(go.Bar(
        x=puts['strike'],
        y=-puts['gex'],
        name='Put GEX',
        marker_color='#ff4757',
        opacity=0.8
    ))
    
    # Spot line
    fig.add_vline(x=state.spot, line_width=3, line_color="#ffffff",
                  annotation_text=f"SPOT {state.spot:.0f}")
    
    # Flip line
    fig.add_vline(x=state.dealer.gamma_flip, line_width=2, line_dash="dash",
                  line_color="#ffa502", annotation_text=f"FLIP {state.dealer.gamma_flip:.0f}")
    
    fig.update_layout(
        template="plotly_dark",
        height=400,
        margin=dict(l=20, r=20, t=40, b=20),
        xaxis_title="Strike",
        yaxis_title="GEX ($B)",
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        barmode='relative'
    )
    
    st.plotly_chart(fig, use_container_width=True)

with col_right:
    # Dealer State
    st.markdown("### 🎰 Dealer Positioning")
    
    pos_emoji = {
        DealerPosition.LONG_GAMMA: "🟢",
        DealerPosition.SHORT_GAMMA: "🔴",
        DealerPosition.NEUTRAL: "🟡"
    }
    
    st.markdown(f"""
    <div class="metric-card">
        <h3 style="margin-top: 0;">{pos_emoji.get(state.dealer.position, '❓')} {state.dealer.position.value}</h3>
        <table style="width: 100%;">
            <tr><td>Net GEX</td><td style="text-align: right;">${state.dealer.total_gex/1e9:.2f}B</td></tr>
            <tr><td>Gamma Flip</td><td style="text-align: right;">{state.dealer.gamma_flip:.2f}</td></tr>
            <tr><td>Dist to Flip</td><td style="text-align: right;">{state.dealer.dist_to_flip:+.2f}</td></tr>
            <tr><td>Hedge Pressure</td><td style="text-align: right;">{state.dealer.hedge_pressure:+.2f}</td></tr>
        </table>
        <p style="margin-top: 1rem; margin-bottom: 0;">
            {'<span class="danger-badge">⚡ ACCELERATION ZONE</span>' if state.dealer.acceleration_zone else ''}
        </p>
    </div>
    """, unsafe_allow_html=True)
    
    # Regime
    st.markdown("### 📈 Regime")
    
    char_emoji = {
        RegimeChar.SMOOTH: "🌊",
        RegimeChar.CHOPPY: "〰️",
        RegimeChar.WICKY: "📍",
        RegimeChar.EXPLOSIVE: "💥"
    }
    
    st.markdown(f"""
    <div class="metric-card">
        <h4 style="margin-top: 0;">{char_emoji.get(state.regime.character, '❓')} {state.regime.character.value}</h4>
        <table style="width: 100%;">
            <tr><td>GEX Type</td><td style="text-align: right;">{state.regime.gex_type}</td></tr>
            <tr><td>Slippage</td><td style="text-align: right;">{state.regime.slippage_mult:.0%}</td></tr>
            <tr><td>Vol Corr</td><td style="text-align: right;">{state.regime.vol_corr_mult:.2f}x</td></tr>
        </table>
        <p style="margin-top: 1rem; margin-bottom: 0;">
            {'<span class="warning-badge">⚠️ PHASE ZONE</span>' if state.regime.in_phase else ''}
            {'<span class="danger-badge">🔴 KILL ZONE</span>' if state.regime.kill_zone else ''}
        </p>
    </div>
    """, unsafe_allow_html=True)
    
    # Flow
    st.markdown("### 💰 Flow")
    
    st.markdown(f"""
    <div class="metric-card">
        <table style="width: 100%;">
            <tr><td>Flow Score</td><td style="text-align: right;">{state.flow.flow_score:+.2f}</td></tr>
            <tr><td>Smart Money</td><td style="text-align: right;">{state.flow.smart_money_bias}</td></tr>
            <tr><td>Call Premium</td><td style="text-align: right;">${state.flow.net_call_premium/1e6:.1f}M</td></tr>
            <tr><td>Put Premium</td><td style="text-align: right;">${state.flow.net_put_premium/1e6:.1f}M</td></tr>
            <tr><td>Sweeps</td><td style="text-align: right;">{len(state.flow.recent_sweeps)}</td></tr>
        </table>
    </div>
    """, unsafe_allow_html=True)


# ═══════════════════════════════════════════════════════════════════════════════
# ENTRY BOX
# ═══════════════════════════════════════════════════════════════════════════════

st.markdown("---")
st.markdown("## 🎯 ENTRY")

if state.entry:
    entry = state.entry
    
    urgency_color = {
        Urgency.NOW: "#ff4757",
        Urgency.READY: "#ffa502",
        Urgency.PREP: "#00d4ff",
        Urgency.WAIT: "#666"
    }
    
    st.markdown(f"""
    <div class="entry-box">
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
                <h2 style="margin: 0; color: {'#00ff88' if entry.direction == 'LONG' else '#ff4757'};">
                    {'🚀' if entry.direction == 'LONG' else '📉'} {entry.direction}
                </h2>
                <p style="margin: 0; opacity: 0.7;">{entry.trigger}</p>
            </div>
            <div style="text-align: right;">
                <span style="background-color: {urgency_color.get(entry.urgency, '#666')}; 
                            color: {'#000' if entry.urgency != Urgency.WAIT else '#fff'}; 
                            padding: 0.5rem 1rem; border-radius: 20px; font-weight: bold;">
                    {entry.urgency.value}
                </span>
            </div>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-top: 1.5rem;">
            <div style="text-align: center;">
                <p style="margin: 0; opacity: 0.7;">Entry</p>
                <p style="font-size: 1.5rem; font-weight: bold; margin: 0;">{entry.entry_price:.2f}</p>
            </div>
            <div style="text-align: center;">
                <p style="margin: 0; opacity: 0.7;">Stop</p>
                <p style="font-size: 1.5rem; font-weight: bold; margin: 0; color: #ff4757;">{entry.stop:.2f}</p>
            </div>
            <div style="text-align: center;">
                <p style="margin: 0; opacity: 0.7;">Target 1</p>
                <p style="font-size: 1.5rem; font-weight: bold; margin: 0; color: #00ff88;">{entry.target_1:.2f}</p>
            </div>
            <div style="text-align: center;">
                <p style="margin: 0; opacity: 0.7;">Target 2</p>
                <p style="font-size: 1.5rem; font-weight: bold; margin: 0; color: #00ff88;">{entry.target_2:.2f}</p>
            </div>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-top: 1rem;">
            <div style="text-align: center;">
                <p style="margin: 0; opacity: 0.7;">R:R</p>
                <p style="font-size: 1.2rem; font-weight: bold; margin: 0;">1:{entry.risk_reward:.1f}</p>
            </div>
            <div style="text-align: center;">
                <p style="margin: 0; opacity: 0.7;">Kelly</p>
                <p style="font-size: 1.2rem; font-weight: bold; margin: 0;">{entry.kelly:.1%}</p>
            </div>
            <div style="text-align: center;">
                <p style="margin: 0; opacity: 0.7;">Contracts</p>
                <p style="font-size: 1.2rem; font-weight: bold; margin: 0;">{entry.contracts}</p>
            </div>
            <div style="text-align: center;">
                <p style="margin: 0; opacity: 0.7;">Max Risk</p>
                <p style="font-size: 1.2rem; font-weight: bold; margin: 0;">${entry.max_risk_dollars:.0f}</p>
            </div>
        </div>
        
        <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
            <p style="margin: 0;"><strong>WHY (Mechanics):</strong> {entry.why_mechanics}</p>
            <p style="margin: 0.5rem 0 0 0;"><strong>WHY (Flow):</strong> {entry.why_flow}</p>
        </div>
        
        <div style="margin-top: 1rem;">
            {' '.join(f'<span class="warning-badge">{w}</span>' for w in entry.warnings) if entry.warnings else ''}
        </div>
    </div>
    """, unsafe_allow_html=True)

else:
    st.markdown("""
    <div style="background: #1a1a1a; padding: 2rem; border-radius: 12px; text-align: center; border: 1px dashed #333;">
        <h3 style="color: #666; margin: 0;">⏳ No Entry Signal</h3>
        <p style="color: #444; margin: 0.5rem 0 0 0;">Waiting for alignment of dealer positioning + flow + price at key level</p>
    </div>
    """, unsafe_allow_html=True)


# ═══════════════════════════════════════════════════════════════════════════════
# KEY LEVELS & WARNINGS
# ═══════════════════════════════════════════════════════════════════════════════

st.markdown("---")

col_levels, col_warnings = st.columns([1, 1])

with col_levels:
    st.markdown("### 📐 Key Levels")
    
    levels_data = []
    for name, value in state.key_levels.items():
        dist = state.spot - value
        levels_data.append({
            'Level': name.replace('_', ' ').title(),
            'Price': f"{value:.2f}",
            'Distance': f"{dist:+.2f}"
        })
    
    st.dataframe(
        pd.DataFrame(levels_data),
        hide_index=True,
        use_container_width=True
    )

with col_warnings:
    st.markdown("### ⚠️ Warnings")
    
    if state.warnings:
        for w in state.warnings:
            if "KILL" in w or "GAP" in w:
                st.markdown(f'<span class="danger-badge">{w}</span>', unsafe_allow_html=True)
            elif "ACCELERATION" in w or "PHASE" in w:
                st.markdown(f'<span class="warning-badge">{w}</span>', unsafe_allow_html=True)
            else:
                st.markdown(f'<span class="success-badge">{w}</span>', unsafe_allow_html=True)
    else:
        st.success("✅ No warnings")


# ═══════════════════════════════════════════════════════════════════════════════
# FOOTER
# ═══════════════════════════════════════════════════════════════════════════════

st.markdown("---")
st.markdown("""
<div style="text-align: center; color: #444; padding: 1rem;">
    <p>TITAN ULTIMATE v19.0 — The culmination of all TITAN versions</p>
    <p style="font-size: 0.8rem;">V5 Physics + v2.5 FINAL Fixes + Omega v17.5 Mood + Realtime WHY</p>
    <p style="font-size: 0.7rem; color: #333;">⚠️ For educational purposes only. Not financial advice. Trade at your own risk.</p>
</div>
""", unsafe_allow_html=True)


# Auto refresh
if auto_refresh:
    time.sleep(5)
    st.rerun()
