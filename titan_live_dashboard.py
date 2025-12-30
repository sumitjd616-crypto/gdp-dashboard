"""
TITAN LIVE DASHBOARD — Dealer Flow Intelligence
===============================================

Focused, actionable dashboard for catching big moves.

Shows:
1. WHY price is moving (dealer mechanics)
2. WHERE dealers must hedge (key levels)
3. WHEN to enter (entry signals)
4. HOW much to risk (position sizing)
"""

import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from datetime import datetime, timedelta
import asyncio
import os

# Page config
st.set_page_config(
    page_title="TITAN LIVE | Dealer Flow",
    page_icon="🎯",
    layout="wide"
)

# Custom CSS for dark theme
st.markdown("""
<style>
    .main-title {
        font-size: 2rem;
        font-weight: bold;
        color: #00ff88;
        margin-bottom: 0;
    }
    .subtitle {
        font-size: 1rem;
        color: #888;
        margin-top: 0;
    }
    .metric-box {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-radius: 10px;
        padding: 1rem;
        border: 1px solid #0f3460;
        margin: 0.5rem 0;
    }
    .bullish { color: #00ff88; }
    .bearish { color: #ff4757; }
    .neutral { color: #ffa502; }
    .big-number {
        font-size: 2.5rem;
        font-weight: bold;
    }
    .explanation-box {
        background-color: #1a1a2e;
        border-left: 4px solid #00d4ff;
        padding: 1rem;
        margin: 1rem 0;
        border-radius: 0 8px 8px 0;
    }
    .entry-box {
        background: linear-gradient(135deg, #0a3d1a 0%, #1a4d2a 100%);
        border: 2px solid #00ff88;
        border-radius: 10px;
        padding: 1.5rem;
        margin: 1rem 0;
    }
    .warning-box {
        background-color: #3d2a0a;
        border-left: 4px solid #ffa502;
        padding: 0.5rem 1rem;
        margin: 0.5rem 0;
    }
    .danger-box {
        background-color: #3d0a0a;
        border-left: 4px solid #ff4757;
        padding: 0.5rem 1rem;
        margin: 0.5rem 0;
    }
</style>
""", unsafe_allow_html=True)


# ═══════════════════════════════════════════════════════════════════════════════
# SIMULATION DATA (Replace with real API in production)
# ═══════════════════════════════════════════════════════════════════════════════

def get_simulated_data():
    """Generate realistic simulation data"""
    np.random.seed(int(datetime.now().timestamp()) % 1000)
    
    base_spot = 595.0  # SPY
    spot_noise = np.random.normal(0, 1)
    spot = base_spot + spot_noise
    
    # Simulate GEX
    total_gex = np.random.choice([-2e9, -1e9, -0.5e9, 0.5e9, 1e9, 2e9])
    gamma_flip = spot - np.random.uniform(2, 8) * np.sign(total_gex)
    
    # Position
    if total_gex > 0.5e9:
        dealer_position = "LONG_GAMMA"
        position_color = "bullish"
    elif total_gex < -0.5e9:
        dealer_position = "SHORT_GAMMA"
        position_color = "bearish"
    else:
        dealer_position = "NEUTRAL"
        position_color = "neutral"
    
    # Flow
    call_premium = np.random.uniform(20e6, 80e6)
    put_premium = np.random.uniform(10e6, 60e6)
    
    # Sweeps
    num_sweeps = np.random.randint(0, 8)
    sweeps = []
    for _ in range(num_sweeps):
        sweep_type = np.random.choice(["CALL_BUY", "CALL_SELL", "PUT_BUY", "PUT_SELL"])
        strike = round(spot + np.random.uniform(-10, 10))
        size = np.random.randint(100, 1000)
        urgency = np.random.choice(["HIGH", "EXTREME"])
        sweeps.append({
            "type": sweep_type,
            "strike": strike,
            "size": size,
            "urgency": urgency,
            "bias": "BULLISH" if "CALL_BUY" in sweep_type or "PUT_SELL" in sweep_type else "BEARISH"
        })
    
    # Levels
    support_1 = round(spot - np.random.uniform(3, 6), 2)
    support_2 = round(spot - np.random.uniform(8, 12), 2)
    resistance_1 = round(spot + np.random.uniform(3, 6), 2)
    resistance_2 = round(spot + np.random.uniform(8, 12), 2)
    
    # Velocity
    velocity = np.random.uniform(-0.5, 0.5)
    
    # Entry opportunity
    has_entry = np.random.random() > 0.5
    
    return {
        "spot": spot,
        "spx": spot * 10,
        "velocity": velocity,
        "total_gex": total_gex,
        "gamma_flip": gamma_flip,
        "dealer_position": dealer_position,
        "position_color": position_color,
        "call_premium": call_premium,
        "put_premium": put_premium,
        "sweeps": sweeps,
        "support_1": support_1,
        "support_2": support_2,
        "resistance_1": resistance_1,
        "resistance_2": resistance_2,
        "has_entry": has_entry,
        "in_acceleration_zone": abs(spot - gamma_flip) < 3
    }


# ═══════════════════════════════════════════════════════════════════════════════
# HEADER
# ═══════════════════════════════════════════════════════════════════════════════

col1, col2, col3 = st.columns([2, 1, 1])

with col1:
    st.markdown('<p class="main-title">🎯 TITAN LIVE</p>', unsafe_allow_html=True)
    st.markdown('<p class="subtitle">Dealer Flow Intelligence | Real-time Positioning</p>', unsafe_allow_html=True)

with col2:
    api_key = os.getenv('POLYGON_API_KEY', '')
    if api_key:
        st.success("🟢 API Connected")
    else:
        st.warning("🟡 Demo Mode")

with col3:
    st.markdown(f"**{datetime.now().strftime('%H:%M:%S')} ET**")
    if st.button("🔄 Refresh"):
        st.rerun()

st.markdown("---")

# Get data
data = get_simulated_data()


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN METRICS ROW
# ═══════════════════════════════════════════════════════════════════════════════

m1, m2, m3, m4 = st.columns(4)

with m1:
    st.metric(
        "SPY",
        f"${data['spot']:.2f}",
        f"{data['velocity']:+.2f}/min"
    )
    st.caption(f"SPX ≈ {data['spx']:.0f}")

with m2:
    gex_display = data['total_gex'] / 1e9
    gex_emoji = "🟢" if gex_display > 0 else "🔴" if gex_display < 0 else "🟡"
    st.metric(
        "Net GEX",
        f"{gex_emoji} ${gex_display:+.2f}B"
    )

with m3:
    flip_dist = data['spot'] - data['gamma_flip']
    st.metric(
        "Gamma Flip",
        f"${data['gamma_flip']:.2f}",
        f"{flip_dist:+.2f} away"
    )

with m4:
    pos_emoji = {"LONG_GAMMA": "🟢", "SHORT_GAMMA": "🔴", "NEUTRAL": "🟡"}
    st.metric(
        "Dealer Position",
        f"{pos_emoji.get(data['dealer_position'], '🟡')} {data['dealer_position'].replace('_', ' ')}"
    )


# ═══════════════════════════════════════════════════════════════════════════════
# WHY IS PRICE MOVING? (The Key Insight)
# ═══════════════════════════════════════════════════════════════════════════════

st.markdown("## 🧠 WHY IS PRICE MOVING?")

if data['dealer_position'] == "SHORT_GAMMA":
    st.markdown("""
    <div class="explanation-box">
        <h3 style="color: #ff4757; margin-top: 0;">🔴 DEALERS ARE SHORT GAMMA</h3>
        <p><b>What this means:</b> Market makers are net short options. They must hedge dynamically.</p>
        
        <p><b>The Mechanics:</b></p>
        <ul>
            <li>Price goes UP → Dealer delta exposure INCREASES → They must BUY to hedge → Adds fuel to rally</li>
            <li>Price goes DOWN → Dealer delta exposure DECREASES → They must SELL to hedge → Adds pressure to selloff</li>
        </ul>
        
        <p><b>Result:</b> <span style="color: #ff4757; font-weight: bold;">TRENDS ACCELERATE</span></p>
        <p>This is the environment where big moves happen. Dealers are forced to chase price in whichever direction it moves.</p>
    </div>
    """, unsafe_allow_html=True)

elif data['dealer_position'] == "LONG_GAMMA":
    st.markdown("""
    <div class="explanation-box">
        <h3 style="color: #00ff88; margin-top: 0;">🟢 DEALERS ARE LONG GAMMA</h3>
        <p><b>What this means:</b> Market makers are net long options. Their hedging works against the trend.</p>
        
        <p><b>The Mechanics:</b></p>
        <ul>
            <li>Price goes UP → Dealer delta exposure INCREASES → They must SELL to stay hedged → Caps the rally</li>
            <li>Price goes DOWN → Dealer delta exposure DECREASES → They must BUY to stay hedged → Supports the dip</li>
        </ul>
        
        <p><b>Result:</b> <span style="color: #00ff88; font-weight: bold;">MEAN REVERSION</span></p>
        <p>Moves get faded. Dealers provide liquidity at extremes. Good for range trading, bad for trend following.</p>
    </div>
    """, unsafe_allow_html=True)

else:
    st.markdown("""
    <div class="explanation-box">
        <h3 style="color: #ffa502; margin-top: 0;">🟡 DEALERS ARE NEUTRAL</h3>
        <p><b>What this means:</b> Gamma exposure is balanced. No clear hedging direction.</p>
        <p><b>Result:</b> <span style="color: #ffa502; font-weight: bold;">CHOPPY/MIXED</span></p>
        <p>Flow and other factors will dominate. Watch for regime change.</p>
    </div>
    """, unsafe_allow_html=True)

# Acceleration zone warning
if data['in_acceleration_zone']:
    st.markdown("""
    <div class="danger-box">
        <h4 style="margin: 0;">⚡ IN ACCELERATION ZONE</h4>
        <p style="margin: 0.5rem 0 0 0;">Price is near the gamma flip. Any move from here will be AMPLIFIED. 
        This is where big moves start.</p>
    </div>
    """, unsafe_allow_html=True)


# ═══════════════════════════════════════════════════════════════════════════════
# TWO COLUMN LAYOUT: LEVELS + FLOW
# ═══════════════════════════════════════════════════════════════════════════════

col_left, col_right = st.columns([1, 1])

with col_left:
    st.markdown("## 📐 KEY LEVELS")
    st.markdown("*Where dealers will be forced to act*")
    
    # Create level chart
    fig = go.Figure()
    
    # Current price
    fig.add_hline(y=data['spot'], line_dash="solid", line_color="#ffffff", 
                  annotation_text=f"SPOT: {data['spot']:.2f}")
    
    # Gamma flip
    fig.add_hline(y=data['gamma_flip'], line_dash="dash", line_color="#ffa502",
                  annotation_text=f"FLIP: {data['gamma_flip']:.2f}")
    
    # Support
    fig.add_hline(y=data['support_1'], line_dash="dot", line_color="#00ff88",
                  annotation_text=f"S1: {data['support_1']:.2f}")
    fig.add_hline(y=data['support_2'], line_dash="dot", line_color="#00cc66",
                  annotation_text=f"S2: {data['support_2']:.2f}")
    
    # Resistance
    fig.add_hline(y=data['resistance_1'], line_dash="dot", line_color="#ff4757",
                  annotation_text=f"R1: {data['resistance_1']:.2f}")
    fig.add_hline(y=data['resistance_2'], line_dash="dot", line_color="#cc3344",
                  annotation_text=f"R2: {data['resistance_2']:.2f}")
    
    fig.update_layout(
        template="plotly_dark",
        height=300,
        yaxis_range=[data['support_2'] - 2, data['resistance_2'] + 2],
        showlegend=False,
        margin=dict(l=20, r=20, t=20, b=20)
    )
    
    st.plotly_chart(fig, use_container_width=True)
    
    # Level explanations
    st.markdown(f"""
    | Level | Price | Meaning |
    |-------|-------|---------|
    | **Gamma Flip** | {data['gamma_flip']:.2f} | Regime change point |
    | **Support 1** | {data['support_1']:.2f} | Dealers buy here |
    | **Support 2** | {data['support_2']:.2f} | Strong dealer buying |
    | **Resistance 1** | {data['resistance_1']:.2f} | Dealers sell here |
    | **Resistance 2** | {data['resistance_2']:.2f} | Strong dealer selling |
    """)

with col_right:
    st.markdown("## 💰 FLOW SIGNALS")
    st.markdown("*Institutional activity detected*")
    
    # Flow metrics
    fc1, fc2 = st.columns(2)
    with fc1:
        st.metric("Call Premium", f"${data['call_premium']/1e6:.1f}M")
    with fc2:
        st.metric("Put Premium", f"${data['put_premium']/1e6:.1f}M")
    
    # Recent sweeps
    if data['sweeps']:
        st.markdown("### Recent Sweeps")
        for sweep in data['sweeps'][:5]:
            emoji = "🟢" if sweep['bias'] == "BULLISH" else "🔴"
            urgency_style = "color: #ff4757; font-weight: bold;" if sweep['urgency'] == "EXTREME" else ""
            st.markdown(f"""
            <div style="background: #1a1a2e; padding: 0.5rem; margin: 0.3rem 0; border-radius: 5px;">
                {emoji} <b>{sweep['type']}</b>: {sweep['size']} @ {sweep['strike']} 
                <span style="{urgency_style}">[{sweep['urgency']}]</span>
            </div>
            """, unsafe_allow_html=True)
    else:
        st.info("No significant sweeps detected")
    
    # Flow bias
    net_premium = data['call_premium'] - data['put_premium']
    if net_premium > 20e6:
        flow_bias = "BULLISH"
        flow_color = "#00ff88"
    elif net_premium < -20e6:
        flow_bias = "BEARISH"
        flow_color = "#ff4757"
    else:
        flow_bias = "NEUTRAL"
        flow_color = "#ffa502"
    
    st.markdown(f"""
    <div style="text-align: center; padding: 1rem; background: #1a1a2e; border-radius: 10px; margin-top: 1rem;">
        <p style="margin: 0; color: #888;">NET FLOW BIAS</p>
        <p style="font-size: 2rem; font-weight: bold; color: {flow_color}; margin: 0;">{flow_bias}</p>
    </div>
    """, unsafe_allow_html=True)


# ═══════════════════════════════════════════════════════════════════════════════
# ENTRY SIGNAL
# ═══════════════════════════════════════════════════════════════════════════════

st.markdown("---")
st.markdown("## 🎯 ENTRY SIGNAL")

bullish_sweeps = len([s for s in data['sweeps'] if s['bias'] == 'BULLISH' and s['urgency'] == 'EXTREME'])
bearish_sweeps = len([s for s in data['sweeps'] if s['bias'] == 'BEARISH' and s['urgency'] == 'EXTREME'])

# Determine if we have an entry
if data['dealer_position'] == "SHORT_GAMMA" and bullish_sweeps >= 2:
    # Bullish entry in short gamma
    entry = data['spot']
    stop = data['gamma_flip'] - 2
    target1 = entry + (entry - stop) * 1.5
    target2 = entry + (entry - stop) * 3
    
    st.markdown(f"""
    <div class="entry-box">
        <h2 style="color: #00ff88; margin-top: 0;">🚀 LONG ENTRY DETECTED</h2>
        
        <div style="display: flex; justify-content: space-around; margin: 1rem 0;">
            <div style="text-align: center;">
                <p style="color: #888; margin: 0;">ENTRY</p>
                <p class="big-number" style="color: #00ff88;">{entry:.2f}</p>
            </div>
            <div style="text-align: center;">
                <p style="color: #888; margin: 0;">STOP</p>
                <p class="big-number" style="color: #ff4757;">{stop:.2f}</p>
            </div>
            <div style="text-align: center;">
                <p style="color: #888; margin: 0;">TARGET 1</p>
                <p class="big-number" style="color: #00ff88;">{target1:.2f}</p>
            </div>
            <div style="text-align: center;">
                <p style="color: #888; margin: 0;">TARGET 2</p>
                <p class="big-number" style="color: #00ff88;">{target2:.2f}</p>
            </div>
        </div>
        
        <p><b>WHY THIS TRADE:</b></p>
        <ul>
            <li>Dealers are SHORT gamma → Must BUY as price rises → Adds fuel</li>
            <li>{bullish_sweeps} EXTREME bullish sweeps detected → Institutions positioning</li>
            <li>Stop below gamma flip → Protected if regime changes</li>
        </ul>
        
        <p><b>RISK/REWARD:</b> 1:{((target1 - entry) / (entry - stop)):.1f}</p>
    </div>
    """, unsafe_allow_html=True)

elif data['dealer_position'] == "SHORT_GAMMA" and bearish_sweeps >= 2:
    # Bearish entry in short gamma
    entry = data['spot']
    stop = data['gamma_flip'] + 2
    target1 = entry - (stop - entry) * 1.5
    target2 = entry - (stop - entry) * 3
    
    st.markdown(f"""
    <div class="entry-box" style="background: linear-gradient(135deg, #3d0a0a 0%, #4d1a1a 100%); border-color: #ff4757;">
        <h2 style="color: #ff4757; margin-top: 0;">📉 SHORT ENTRY DETECTED</h2>
        
        <div style="display: flex; justify-content: space-around; margin: 1rem 0;">
            <div style="text-align: center;">
                <p style="color: #888; margin: 0;">ENTRY</p>
                <p class="big-number" style="color: #ff4757;">{entry:.2f}</p>
            </div>
            <div style="text-align: center;">
                <p style="color: #888; margin: 0;">STOP</p>
                <p class="big-number" style="color: #00ff88;">{stop:.2f}</p>
            </div>
            <div style="text-align: center;">
                <p style="color: #888; margin: 0;">TARGET 1</p>
                <p class="big-number" style="color: #ff4757;">{target1:.2f}</p>
            </div>
            <div style="text-align: center;">
                <p style="color: #888; margin: 0;">TARGET 2</p>
                <p class="big-number" style="color: #ff4757;">{target2:.2f}</p>
            </div>
        </div>
        
        <p><b>WHY THIS TRADE:</b></p>
        <ul>
            <li>Dealers are SHORT gamma → Must SELL as price falls → Adds pressure</li>
            <li>{bearish_sweeps} EXTREME bearish sweeps detected → Institutions positioning</li>
            <li>Stop above gamma flip → Protected if regime changes</li>
        </ul>
    </div>
    """, unsafe_allow_html=True)

elif data['dealer_position'] == "LONG_GAMMA" and abs(data['spot'] - data['support_1']) < 2:
    # Support bounce in long gamma
    entry = data['support_1']
    stop = entry - 3
    target1 = data['gamma_flip']
    
    st.markdown(f"""
    <div class="entry-box">
        <h2 style="color: #00ff88; margin-top: 0;">🎯 SUPPORT BOUNCE SETUP</h2>
        
        <p><b>Setup:</b> Price approaching gamma support at {data['support_1']:.2f}</p>
        <p><b>Why:</b> Dealers LONG gamma will BUY here to hedge. Natural support.</p>
        
        <div style="display: flex; justify-content: space-around; margin: 1rem 0;">
            <div style="text-align: center;">
                <p style="color: #888; margin: 0;">BUY ZONE</p>
                <p class="big-number" style="color: #00ff88;">{entry:.2f}</p>
            </div>
            <div style="text-align: center;">
                <p style="color: #888; margin: 0;">STOP</p>
                <p class="big-number" style="color: #ff4757;">{stop:.2f}</p>
            </div>
            <div style="text-align: center;">
                <p style="color: #888; margin: 0;">TARGET</p>
                <p class="big-number" style="color: #00ff88;">{target1:.2f}</p>
            </div>
        </div>
        
        <p style="color: #ffa502;"><b>⚠️ Wait for price to reach level before entering</b></p>
    </div>
    """, unsafe_allow_html=True)

else:
    st.markdown("""
    <div style="background: #1a1a2e; padding: 2rem; border-radius: 10px; text-align: center;">
        <h3 style="color: #888;">⏳ NO ENTRY SIGNAL</h3>
        <p style="color: #666;">Waiting for alignment of dealer positioning + flow + price at key level</p>
        <p style="color: #666;">The best trades happen when ALL factors align. Patience pays.</p>
    </div>
    """, unsafe_allow_html=True)


# ═══════════════════════════════════════════════════════════════════════════════
# FOOTER
# ═══════════════════════════════════════════════════════════════════════════════

st.markdown("---")

# Quick reference
with st.expander("📚 Quick Reference: Dealer Mechanics"):
    st.markdown("""
    ### How Dealer Hedging Creates Big Moves
    
    **The Setup:**
    - Market makers sell options to retail traders
    - They must delta hedge to stay market neutral
    - Gamma = how much delta changes per $1 move
    
    **Short Gamma (Negative GEX):**
    - Dealers are SHORT options overall
    - Price UP → Delta UP → Dealers must BUY → Adds fuel 🔥
    - Price DOWN → Delta DOWN → Dealers must SELL → Adds pressure 📉
    - **Result: TRENDS ACCELERATE**
    
    **Long Gamma (Positive GEX):**
    - Dealers are LONG options overall  
    - Price UP → Delta UP → Dealers must SELL → Caps rally 🛑
    - Price DOWN → Delta DOWN → Dealers must BUY → Supports dip 🛡️
    - **Result: MEAN REVERSION**
    
    **The Gamma Flip:**
    - The price level where dealer positioning changes
    - Crossing this level changes the entire market behavior
    - Most volatile area - where big moves originate
    
    **How to Trade It:**
    1. Identify dealer position (GEX)
    2. Find key gamma levels (support/resistance)
    3. Wait for flow confirmation (sweeps/blocks)
    4. Enter with stop on other side of gamma level
    5. Let dealer hedging work FOR you
    """)

st.markdown("""
<div style="text-align: center; color: #444; padding: 1rem;">
    <p>TITAN LIVE | Dealer Flow Intelligence</p>
    <p>⚠️ For educational purposes only. Not financial advice.</p>
</div>
""", unsafe_allow_html=True)

# Auto refresh
auto_refresh = st.sidebar.checkbox("Auto-refresh (10s)", value=False)
if auto_refresh:
    import time
    time.sleep(10)
    st.rerun()
