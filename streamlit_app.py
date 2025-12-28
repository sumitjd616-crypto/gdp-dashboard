import streamlit as st
import pandas as pd
import numpy as np
import time
from titan_core import TitanEngineV3, Node
from live_data import MarketDataManager
from titan_ws import get_streamer
import plotly.graph_objects as go

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG & SETUP
# ═══════════════════════════════════════════════════════════════════════════════

st.set_page_config(page_title="TITAN V4.0 | Fluid Dynamics", page_icon="⚡", layout="wide")

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

# Initialize Streamer (Background Thread)
# leveraging st.cache_resource to keep it alive across reruns
@st.cache_resource
def init_streamer():
    s = get_streamer()
    return s

streamer = init_streamer()

# ═══════════════════════════════════════════════════════════════════════════════
# SIDEBAR
# ═══════════════════════════════════════════════════════════════════════════════

st.sidebar.title("TITAN V4.0")
mode = st.sidebar.radio("Data Feed", ["Live API (Polygon)", "Simulated"], index=0)
ticker = st.sidebar.text_input("Ticker", "SPX").upper()

spot_price = 0
vix = 15
nodes = []
net_gex = 0
flip_level = 0
ke = 0
raw_df = pd.DataFrame()

if mode == "Live API (Polygon)":
    if not st.session_state.dm.check_connection():
        st.sidebar.error("API Connection Failed")
        st.stop()
        
    st.sidebar.success("● CONNECTED")
    
    # WebSocket Status
    ws_price, _ = streamer.get_data()
    if ws_price > 0:
        st.sidebar.caption(f"⚡ WS Live: {ws_price:.2f}")
    else:
        st.sidebar.caption("⚡ WS Connecting...")
    
    # Option Chain (Slow Update)
    # We only fetch the full chain occasionally to avoid blocking
    if 'last_chain_update' not in st.session_state:
        st.session_state.last_chain_update = 0
        
    now = time.time()
    # Refresh chain every 30s
    if now - st.session_state.last_chain_update > 30 or st.sidebar.button("Scan Chain"):
        with st.spinner("Scanning Option Structure..."):
            # Use HTTP for the heavy structure
            spot_snap = st.session_state.dm.get_spot_price(ticker)
            vix = st.session_state.dm.get_vix()
            nodes, net_gex, flip_level, raw_df = st.session_state.dm.get_option_chain_gex(ticker, spot_snap)
            
            # Cache results
            st.session_state.cached_nodes = nodes
            st.session_state.cached_gex = net_gex
            st.session_state.cached_flip = flip_level
            st.session_state.cached_df = raw_df
            st.session_state.last_chain_update = now
    
    # Use Cached Structure + Live Price
    nodes = st.session_state.get('cached_nodes', [])
    net_gex = st.session_state.get('cached_gex', 0)
    flip_level = st.session_state.get('cached_flip', 0)
    raw_df = st.session_state.get('cached_df', pd.DataFrame())
    
    # Use WS price if available, else fallback
    if ws_price > 0:
        spot_price = ws_price
    else:
        spot_price = st.session_state.dm.get_spot_price(ticker)
        
    ke = 50 
    
    # Auto-Rerun for Animation
    # This creates the "Game Loop" effect
    time.sleep(1) 
    st.rerun()
    
else:
    spot_price = st.sidebar.number_input("Spot Price", 400.0, 5000.0, 415.0)
    vix = st.sidebar.slider("VIX", 10.0, 40.0, 15.0)
    net_gex = st.sidebar.number_input("Net GEX (B)", -10.0, 10.0, -2.0) * 1e9
    nodes = [Node(spot_price+10, 5e9), Node(spot_price-10, 5e9)] # Mock

# ═══════════════════════════════════════════════════════════════════════════════
# ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

result = st.session_state.engine.analyze(spot_price, nodes, net_gex, flip_level, vix, ke)

st.session_state.history.append({
    "timestamp": time.strftime("%H:%M:%S"),
    "force": result['force_conf'] * (1 if result['force_dir'] == 'UP' else -1),
    "vanna": result['vanna_force']
})
if len(st.session_state.history) > 60: st.session_state.history.pop(0)

# ═══════════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════════

st.title(f"TITAN V4.0 | {ticker}")

# HUD
c1, c2, c3, c4 = st.columns(4)
c1.metric("Spot", f"{spot_price:.2f}", f"VIX: {vix:.2f}")
c2.metric("Gamma Force", result['force_dir'], f"{result['force_conf']:.1f}%")
c3.metric("Vanna Flow", f"{result['vanna_force']:.2f}", "Vol Sensitivity")
c4.metric("Status", result['status'], "Latency: ~50ms (WS)")

# MAIN CHART
col_main, col_side = st.columns([3, 1])

with col_main:
    st.subheader("Liquidity Structure (Gamma + Volume)")
    
    if mode == "Live API (Polygon)" and not raw_df.empty:
        # Plot Logic
        df_plot = raw_df.groupby(['strike', 'type'])[['gex_abs', 'volume']].sum().unstack(fill_value=0).reset_index()
        
        # Flatten columns
        df_plot.columns = ['strike', 'call_gex', 'put_gex', 'call_vol', 'put_vol']
        
        # Filter Range
        range_pct = 0.015
        df_plot = df_plot[
            (df_plot['strike'] > spot_price * (1 - range_pct)) & 
            (df_plot['strike'] < spot_price * (1 + range_pct))
        ]
        
        fig = go.Figure()
        
        # 1. Structure (Gamma Walls)
        fig.add_trace(go.Bar(x=df_plot['strike'], y=df_plot['call_gex']/1e9, name='Call Wall (Res)', marker_color='rgba(0, 204, 150, 0.6)'))
        fig.add_trace(go.Bar(x=df_plot['strike'], y=-df_plot['put_gex']/1e9, name='Put Wall (Sup)', marker_color='rgba(239, 85, 59, 0.6)'))
        
        # 2. Activity (Volume Hotspots) - Overlay as Lines/Markers
        # Normalize volume for scale
        vol_scale = (df_plot['call_gex'].max() / df_plot['call_vol'].max()) * 0.5 if df_plot['call_vol'].max() > 0 else 0
        
        fig.add_trace(go.Scatter(
            x=df_plot['strike'], y=df_plot['call_vol'] * vol_scale / 1e9,
            mode='lines', name='Call Vol (Heat)', line=dict(color='white', width=2, dash='dot')
        ))
        
        # Spot Line
        fig.add_vline(x=spot_price, line_width=2, line_color="yellow", line_dash="solid")
        
        fig.update_layout(
            barmode='relative', template="plotly_dark", height=500,
            title="Market Architecture: Structure (Bars) vs Flow (White Line)",
            xaxis_title="Strike", yaxis_title="Gamma Exposure ($B)"
        )
        st.plotly_chart(fig, use_container_width=True)
        
    elif nodes:
        st.info("Simulated Data Mode - Visualization Limited")

with col_side:
    st.subheader("Fluid Dynamics")
    
    # Force History
    hist_df = pd.DataFrame(st.session_state.history)
    if not hist_df.empty:
        st.area_chart(hist_df.set_index('timestamp')['force'], height=150)
        st.caption("Gamma Force (Structure)")
        
        st.line_chart(hist_df.set_index('timestamp')['vanna'], height=150)
        st.caption("Vanna Flow (Volatility)")

    st.subheader("Alerts")
    if result['vacuum_active']: st.error("🚨 VACUUM ACCELERATION")
    if abs(result['vanna_force']) > 2.0: st.warning(f"🌊 HIGH VANNA FLOW: {'Bearish' if result['vanna_force'] > 0 else 'Bullish'}")
