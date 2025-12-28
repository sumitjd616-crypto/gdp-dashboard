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
raw_df = pd.DataFrame()

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
            nodes, net_gex, flip_level, raw_df = st.session_state.dm.get_option_chain_gex(ticker, spot_price)
            ke = 50 # Volume placeholder
            
        if spot_price == 0:
            st.error("Failed to fetch Spot Price")
            
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
    st.metric("Flip Level", f"{flip_level}", f"GEX: ${net_gex/1e9:.2f}B")

with c4:
    status_icon = "🟢" if result['status'] == 'GOOD' else "🟡" if result['status'] == 'WARMING' else "🔴"
    st.metric("System Status", f"{status_icon} {result['status']}", "Real-Time Quality")

# 2. MAIN VISUALIZATION
col_main, col_side = st.columns([2, 1])

with col_main:
    st.subheader("Gamma Landscape & Vacuum Zones")
    
    if mode == "Live API (Polygon)" and not raw_df.empty:
        # Advanced Plot: Call GEX vs Put GEX
        # Raw DF has 'type' ('call'/'put'), 'strike', 'gex_abs'
        
        # We need to pivot Raw DF to get Calls and Puts separate per strike
        # Since we only have `df_strikes` (summarized) returned as `raw_df` from `get_option_chain_gex`?
        # Wait, I returned `df` (the list of all contracts) in step 3? 
        # No, step 3 created `df`, but step 4 grouped it.
        # Let's check `live_data.py`. I returned `df` (the raw contract list).
        
        # Aggregating for Plot
        df_plot = raw_df.groupby(['strike', 'type'])['gex_abs'].sum().unstack(fill_value=0).reset_index()
        
        # Filter Range
        range_pct = 0.02
        df_plot = df_plot[
            (df_plot['strike'] > spot_price * (1 - range_pct)) & 
            (df_plot['strike'] < spot_price * (1 + range_pct))
        ]
        
        fig = go.Figure()
        
        # Call Wall (Resistance) - Positive
        if 'call' in df_plot.columns:
            fig.add_trace(go.Bar(
                x=df_plot['strike'], y=df_plot['call']/1e9,
                name='Call GEX (Res)', marker_color='#00CC96'
            ))
            
        # Put Wall (Support) - Negative
        if 'put' in df_plot.columns:
            fig.add_trace(go.Bar(
                x=df_plot['strike'], y=-df_plot['put']/1e9,
                name='Put GEX (Sup)', marker_color='#EF553B'
            ))
            
        # Spot Line
        fig.add_vline(x=spot_price, line_width=2, line_dash="dash", line_color="yellow")
        
        fig.update_layout(
            barmode='relative', 
            template="plotly_dark",
            height=400,
            title="Net Gamma Exposure Profile (Billions)",
            xaxis_title="Strike", yaxis_title="Gamma Exposure ($B)"
        )
        st.plotly_chart(fig, use_container_width=True)
        
    elif nodes:
        # Fallback for Simulated
        df_nodes = pd.DataFrame([{ 'Strike': n.strike, 'Gamma': n.abs_gamma/1e9 } for n in nodes])
        st.bar_chart(df_nodes.set_index('Strike')['Gamma'])
    else:
        st.warning("No Option Data Found.")

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
