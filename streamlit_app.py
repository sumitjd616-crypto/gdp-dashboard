import streamlit as st
import pandas as pd
import numpy as np
import time
from titan_core import TitanEngineV3, Node

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG & SETUP
# ═══════════════════════════════════════════════════════════════════════════════

st.set_page_config(page_title="TITAN V3.0 | Dealer Positioning", page_icon="⚡", layout="wide")

if 'engine' not in st.session_state:
    st.session_state.engine = TitanEngineV3()
    st.session_state.history = []

# ═══════════════════════════════════════════════════════════════════════════════
# SIDEBAR: MARKET SIMULATION
# ═══════════════════════════════════════════════════════════════════════════════

st.sidebar.title("MKTSIM Control")

# Market Inputs
spot_price = st.sidebar.number_input("Spot Price (SPX)", 4000.0, 4300.0, 4150.0, 1.0)
vix = st.sidebar.slider("VIX", 10.0, 40.0, 15.0)
ke = st.sidebar.slider("Kinetic Energy (Volume/Flow)", 0, 100, 50)
flip_level = st.sidebar.number_input("Gamma Flip Level", 4000, 4300, 4155)
net_gex = st.sidebar.number_input("Net GEX (Billions)", -10.0, 10.0, -2.0) * 1e9

# Dealer Positioning (Gamma Profile)
st.sidebar.subheader("Dealer Positioning")
profile_type = st.sidebar.selectbox("Gamma Profile", ["Neutral", "Call Wall (Resistance)", "Put Wall (Support)", "Vacuum/Thin"])

def generate_nodes(center, profile):
    nodes = []
    strikes = range(int(center)-50, int(center)+55, 5)
    
    for k in strikes:
        gamma = 1e9 # Base
        if profile == "Call Wall (Resistance)" and k > center + 10:
            gamma = 5e9
        elif profile == "Put Wall (Support)" and k < center - 10:
            gamma = 5e9
        elif profile == "Vacuum/Thin" and abs(k - center) < 15:
            gamma = 0.2e9 # Thin
            
        # Add random noise
        gamma *= np.random.uniform(0.8, 1.2)
        nodes.append(Node(k, abs(gamma)))
    return nodes

# Cache nodes so they don't jump around unless profile changes
if 'nodes' not in st.session_state or st.session_state.last_profile != profile_type:
    st.session_state.nodes = generate_nodes(4150, profile_type) # Fixed center for stability
    st.session_state.last_profile = profile_type

nodes = st.session_state.nodes

# ═══════════════════════════════════════════════════════════════════════════════
# ENGINE ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

# Run Engine
result = st.session_state.engine.analyze(
    spot=spot_price,
    nodes=nodes,
    gex=net_gex,
    flip=flip_level,
    vix=vix,
    ke=ke
)

# Store History
st.session_state.history.append({
    "timestamp": time.strftime("%H:%M:%S"),
    "spot": spot_price,
    "force": result['force_conf'] * (1 if result['force_dir'] == 'UP' else -1),
    "sizing": result['sizing']
})
if len(st.session_state.history) > 50:
    st.session_state.history.pop(0)

# ═══════════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════════

st.title("TITAN V3.0 PHYSICS ENGINE")
st.markdown("### *Catching 10-15pt Moves via Dealer Positioning*")

# 1. TOP METRICS
col1, col2, col3, col4 = st.columns(4)
col1.metric("Physics Force", f"{result['force_dir']}", f"{result['force_conf']:.1f}% Conf")
col2.metric("Vanna Multiplier", f"{result['vanna_mult']:.2f}x", delta_color="off")
col3.metric("Rec. Sizing (Kelly)", f"{result['sizing']*100:.1f}%", help="Suggested position size based on edge")
col4.metric("Data Quality", result['status'], delta_color="normal" if result['status'] == 'GOOD' else "inverse")

# 2. ALERTS
if result['vacuum_active']:
    st.error("🚨 VACUUM ZONE DETECTED - ACCELERATION LIKELY")
elif result['force_conf'] > 75:
    st.success(f"🚀 HIGH CONVICTION {result['force_dir']} SETUP")
else:
    st.info("Market Grinding - Waiting for Setup")

# 3. VISUALIZATION
c1, c2 = st.columns([2, 1])

with c1:
    st.subheader("Gamma Landscape (Battlefield)")
    
    # Prepare Data
    df_nodes = pd.DataFrame([{
        'Strike': n.strike, 
        'Gamma': n.abs_gamma/1e9,
        'Type': 'Call Wall' if n.strike > spot_price else 'Put Wall'
    } for n in nodes])
    
    # Chart
    st.bar_chart(df_nodes.set_index('Strike')['Gamma'])
    st.caption(f"Current Spot: {spot_price} | Flip Level: {flip_level}")

with c2:
    st.subheader("Force Momentum")
    df_hist = pd.DataFrame(st.session_state.history)
    if not df_hist.empty:
        st.line_chart(df_hist.set_index('timestamp')['force'])
    else:
        st.write("Waiting for data points...")

# 4. AUDIT LOG
with st.expander("Engine Audit Log", expanded=True):
    st.code(result['audit'])
    st.write(f"Sigma: {result['sigma']:.2f}")

