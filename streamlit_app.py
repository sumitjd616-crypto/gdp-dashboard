import streamlit as st
import pandas as pd
import numpy as np
import time
from titan_core import TitanEngineV3, Node
from live_data import MarketDataManager

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG & SETUP
# ═══════════════════════════════════════════════════════════════════════════════

st.set_page_config(page_title="TITAN V3.0 | Dealer Positioning", page_icon="⚡", layout="wide")

if 'engine' not in st.session_state:
    st.session_state.engine = TitanEngineV3()
    st.session_state.history = []
    st.session_state.dm = MarketDataManager()

# ═══════════════════════════════════════════════════════════════════════════════
# SIDEBAR: DATA CONTROL
# ═══════════════════════════════════════════════════════════════════════════════

st.sidebar.title("Data Feed")
mode = st.sidebar.radio("Source", ["Simulated", "Live API (Polygon)"])
ticker = st.sidebar.text_input("Ticker", "SPY").upper()

spot_price = 0
vix = 15
nodes = []
net_gex = 0
flip_level = 0
ke = 0

if mode == "Live API (Polygon)":
    if not st.session_state.dm.check_connection():
        st.sidebar.error("API Connection Failed. Check .env")
        st.stop()
        
    st.sidebar.success("● API Connected")
    
    # Auto-Refresh
    if st.sidebar.button("Refresh Data"):
        st.rerun()
        
    with st.spinner("Fetching Market Data..."):
        spot_price = st.session_state.dm.get_spot_price(ticker)
        vix = st.session_state.dm.get_vix()
        nodes, net_gex, flip_level = st.session_state.dm.get_option_chain_gex(ticker, spot_price)
        ke = 50 # Volume placeholder for now
        
        if spot_price == 0:
            st.error("Failed to fetch Spot Price")
            st.stop()
            
else:
    # Market Inputs
    spot_price = st.sidebar.number_input("Spot Price", 400.0, 5000.0, 415.0, 0.1)
    vix = st.sidebar.slider("VIX", 10.0, 40.0, 15.0)
    ke = st.sidebar.slider("Kinetic Energy", 0, 100, 50)
    flip_level = st.sidebar.number_input("Gamma Flip", 400, 5000, 416)
    net_gex = st.sidebar.number_input("Net GEX (B)", -10.0, 10.0, -2.0) * 1e9
    
    # Dealer Positioning (Gamma Profile)
    profile_type = st.sidebar.selectbox("Gamma Profile", ["Neutral", "Call Wall", "Put Wall", "Vacuum"])
    
    def generate_nodes(center, profile):
        n = []
        strikes = range(int(center)-10, int(center)+11, 1)
        for k in strikes:
            gamma = 1e9 # Base
            if profile == "Call Wall" and k > center + 2: gamma = 5e9
            elif profile == "Put Wall" and k < center - 2: gamma = 5e9
            elif profile == "Vacuum" and abs(k - center) < 3: gamma = 0.2e9
            n.append(Node(k, abs(gamma)))
        return n
        
    nodes = generate_nodes(spot_price, profile_type)

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

st.title(f"TITAN V3.0 | {ticker}")
st.markdown("### *Catching 10-15pt Moves via Dealer Positioning*")

# 1. TOP METRICS
col1, col2, col3, col4 = st.columns(4)
col1.metric("Physics Force", f"{result['force_dir']}", f"{result['force_conf']:.1f}% Conf")
col2.metric("Vanna Multiplier", f"{result['vanna_mult']:.2f}x")
col3.metric("Spot Price", f"{spot_price:.2f}")
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
    st.subheader("Gamma Landscape")
    if nodes:
        df_nodes = pd.DataFrame([{
            'Strike': n.strike, 
            'Gamma': n.abs_gamma/1e9, # Billions
        } for n in nodes])
        
        # Filter near spot
        df_nodes = df_nodes[
            (df_nodes['Strike'] > spot_price * 0.98) & 
            (df_nodes['Strike'] < spot_price * 1.02)
        ]
        
        st.bar_chart(df_nodes.set_index('Strike')['Gamma'])
    else:
        st.write("No Gamma Data Available")

with c2:
    st.subheader("Force Momentum")
    df_hist = pd.DataFrame(st.session_state.history)
    if not df_hist.empty:
        st.line_chart(df_hist.set_index('timestamp')['force'])

# 4. AUDIT LOG
with st.expander("Engine Audit Log", expanded=False):
    st.code(result['audit'])
