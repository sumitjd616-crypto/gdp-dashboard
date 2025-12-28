import streamlit as st
import pandas as pd
import numpy as np
import time
from titan_core import TitanEngineV3, Node
from live_data import MarketDataManager
import plotly.graph_objects as go

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG & SETUP
# ═══════════════════════════════════════════════════════════════════════════════

st.set_page_config(page_title="TITAN V3.0 | Dealer Positioning", page_icon="⚡", layout="wide")

# Custom CSS for dark theme and metrics
st.markdown("""
<style>
    .big-font { font-size: 3em !important; font-weight: bold; }
    .metric-card { background-color: #1E1E1E; padding: 20px; border-radius: 10px; border: 1px solid #333; }
    .bullish { color: #00FF00; }
    .bearish { color: #FF0000; }
</style>
""", unsafe_allow_html=True)

if 'engine' not in st.session_state:
    st.session_state.engine = TitanEngineV3()
    st.session_state.history = []
    st.session_state.dm = MarketDataManager()

# ═══════════════════════════════════════════════════════════════════════════════
# SIDEBAR: DATA CONTROL
# ═══════════════════════════════════════════════════════════════════════════════

st.sidebar.title("TITAN CONTROL")
mode = st.sidebar.radio("Data Feed", ["Live API (Polygon)", "Simulated"], index=0)
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
        
    st.sidebar.success("● ONLINE")
    
    # Auto-Refresh Control
    refresh_rate = st.sidebar.slider("Refresh Rate (s)", 5, 60, 15)
    
    if st.sidebar.button("Force Refresh") or time.time() % refresh_rate < 1:
        with st.spinner("Scanning Market..."):
            spot_price = st.session_state.dm.get_spot_price(ticker)
            vix = st.session_state.dm.get_vix()
            nodes, net_gex, flip_level = st.session_state.dm.get_option_chain_gex(ticker, spot_price)
            ke = 50 # Volume placeholder
            
        if spot_price == 0:
            st.error("Failed to fetch Spot Price")
            # Fallback for display if history exists? No, stop.
            
else:
    # Market Inputs (Simulation)
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
# DASHBOARD LAYOUT
# ═══════════════════════════════════════════════════════════════════════════════

st.title(f"TITAN V3.0 | {ticker}")

# 1. HEADS UP DISPLAY
c1, c2, c3, c4 = st.columns(4)

with c1:
    st.metric("Spot Price", f"{spot_price:.2f}", f"VIX: {vix:.2f}")

with c2:
    direction_color = "normal" if result['force_dir'] == 'UP' else "inverse"
    st.metric("Physics Force", f"{result['force_dir']}", f"{result['force_conf']:.1f}%", delta_color=direction_color)

with c3:
    st.metric("Est. Net GEX", f"${net_gex/1e9:.2f}B", "Dealer Exposure")

with c4:
    status_icon = "🟢" if result['status'] == 'GOOD' else "🟡" if result['status'] == 'WARMING' else "🔴"
    st.metric("System Status", f"{status_icon} {result['status']}", "Real-Time Quality")

# 2. MAIN VISUALIZATION
col_main, col_side = st.columns([2, 1])

with col_main:
    st.subheader("Gamma Landscape & Vacuum Zones")
    
    if nodes:
        df_nodes = pd.DataFrame([{
            'Strike': n.strike, 
            'Gamma': n.abs_gamma/1e9, # Billions
        } for n in nodes])
        
        # Filter near spot (Dynamic Range)
        range_pct = 0.02 # 2% range
        df_nodes = df_nodes[
            (df_nodes['Strike'] > spot_price * (1 - range_pct)) & 
            (df_nodes['Strike'] < spot_price * (1 + range_pct))
        ]
        
        # Plotly Chart
        fig = go.Figure()
        
        # Gamma Bars
        fig.add_trace(go.Bar(
            x=df_nodes['Strike'], 
            y=df_nodes['Gamma'],
            name='Gamma Exposure',
            marker_color='#4444ff'
        ))
        
        # Spot Line
        fig.add_vline(x=spot_price, line_width=3, line_dash="dash", line_color="yellow", annotation_text="SPOT")
        
        # Vacuum Overlay
        # Simple Logic: If Gamma < Threshold, it's a Vacuum
        threshold = df_nodes['Gamma'].mean() * 0.5
        vacuum_strikes = df_nodes[df_nodes['Gamma'] < threshold]['Strike']
        
        # fig.add_trace(go.Scatter(
        #     x=vacuum_strikes, 
        #     y=[0]*len(vacuum_strikes),
        #     mode='markers',
        #     marker=dict(color='red', size=10, symbol='triangle-up'),
        #     name='Vacuum Pockets'
        # ))
        
        fig.update_layout(
            template="plotly_dark",
            height=400,
            margin=dict(l=20, r=20, t=30, b=20),
            xaxis_title="Strike Price",
            yaxis_title="Gamma Exposure (Billions)"
        )
        
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.warning("No Option Data Found. Check Market Hours or Ticker.")

with col_side:
    st.subheader("Momentum (Force)")
    df_hist = pd.DataFrame(st.session_state.history)
    if not df_hist.empty:
        st.line_chart(df_hist.set_index('timestamp')['force'], height=200)
    
    st.subheader("Actionable Signals")
    if result['vacuum_active']:
        st.error("🚨 VACUUM ACTIVE: Acceleration Likely")
    
    if result['force_conf'] > 80:
        st.success(f"🚀 {result['force_dir']} BREAKOUT IMMINENT")
    elif result['force_conf'] > 60:
        st.info(f"Bias: {result['force_dir']}")
    else:
        st.write("Market Grinding / Balanced")

    st.caption(result['audit'])

# 3. DETAILS
with st.expander("Raw Data & Audit"):
    st.json(result)
