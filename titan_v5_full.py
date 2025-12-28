import streamlit as st
import pandas as pd
import numpy as np
import time
import requests
import json
import threading
import websocket
from datetime import datetime
import plotly.graph_objects as go
import os
from dotenv import load_dotenv

# ═══════════════════════════════════════════════════════════════════════════════
# 1. CONFIGURATION & SECURITY
# ═══════════════════════════════════════════════════════════════════════════════

# Load from Environment
load_dotenv()
API_TOKEN = os.getenv("API_TOKEN")

class CONFIG:
    SIGMA_BASE = 10          
    GEX_SIG = 1e9            
    VIX_BASE = 15            
    VACUUM_ENTER_DIST = 6.0  
    VACUUM_EXIT_DIST = 3.5   
    GAP_THRESHOLD_MS = 1500  
    WARMUP_TICKS = 5         
    KELLY_FRACTION = 0.25    

# ═══════════════════════════════════════════════════════════════════════════════
# 2. CORE PHYSICS ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class Node:
    def __init__(self, strike, abs_gamma):
        self.strike = strike
        self.abs_gamma = abs_gamma

class TitanEngineV5:
    def __init__(self):
        self.last_update = 0
        self.prev_vix = 15
        self.warmup = 0
        self.quality = 'GOOD'
        self.vacuum_strikes = set()

    def analyze(self, spot, nodes, gex, flip, vix, flow_imbalance):
        now = int(time.time() * 1000)
        self._process_tick_state(now, vix)
        
        # 1. Gaussian Force
        sigma = CONFIG.SIGMA_BASE * ((vix / CONFIG.VIX_BASE) ** 1.5)
        force = self._compute_force(spot, nodes, sigma)
        
        # 2. Vanna Force
        vanna_force = -(vix - self.prev_vix) * (gex / CONFIG.GEX_SIG) * 2.0 
        
        # 3. Kinetic Flow
        flow_score = min(2.0, max(-2.0, flow_imbalance / 5000))
        
        # 4. Vacuum Hysteresis
        for n in nodes: self._update_vacuum(n, spot)
            
        # 5. Signal Fusion
        base_conf = force['confidence']
        aligned = (force['dir'] == 'UP' and flow_score > 0.5) or (force['dir'] == 'DOWN' and flow_score < -0.5)
        
        if aligned: base_conf += 20
        elif abs(flow_score) > 1.0: base_conf -= 30 
        
        final_conf = min(99, max(0, base_conf))
        
        status_msg = "NEUTRAL"
        if aligned and final_conf > 70: status_msg = "CONVICTION_TRADE"
        elif not aligned and abs(flow_score) > 1.0: status_msg = "FLOW_DIVERGENCE"

        return {
            "status": self.quality, "force_dir": force['dir'], "force_conf": final_conf,
            "vanna_force": vanna_force, "flow_score": flow_score,
            "vacuum_active": len(self.vacuum_strikes) > 0, "signal": status_msg
        }

    def _process_tick_state(self, now, vix):
        gap = now - self.last_update
        if gap > CONFIG.GAP_THRESHOLD_MS and self.last_update != 0:
            self.quality = 'GAP'; self.warmup = CONFIG.WARMUP_TICKS
        elif self.warmup > 0:
            self.quality = 'WARMING'; self.warmup -= 1
        else:
            self.quality = 'GOOD'
        self.last_update = now; self.prev_vix = vix

    def _update_vacuum(self, n, spot):
        dist = abs(n.strike - spot)
        if n.strike not in self.vacuum_strikes and dist > CONFIG.VACUUM_ENTER_DIST: self.vacuum_strikes.add(n.strike)
        elif n.strike in self.vacuum_strikes and dist < CONFIG.VACUUM_EXIT_DIST: self.vacuum_strikes.discard(n.strike)

    def _compute_force(self, spot, nodes, sigma):
        up, down = 0.0, 0.0
        for n in nodes:
            weight = (n.abs_gamma / CONFIG.GEX_SIG) * (1.0 / (sigma * np.sqrt(2 * np.pi))) * np.exp(-0.5 * ((spot - n.strike) / sigma) ** 2)
            if n.strike > spot: up += weight
            else: down += weight
        total = up + down
        return {"dir": 'UP' if (up - down) > 0 else 'DOWN', "confidence": min(99.0, (abs(up - down) / total) * 100.0) if total > 0 else 0.0}

# ═══════════════════════════════════════════════════════════════════════════════
# 3. LIVE DATA & WEBSOCKET
# ═══════════════════════════════════════════════════════════════════════════════

class TitanStreamer:
    def __init__(self):
        self.latest_price = 0.0; self.net_flow = 0; self.prev_price = 0.0
        self.lock = threading.Lock()
        self.ws = None
    
    def start(self):
        if not API_TOKEN: return
        self.ws = websocket.WebSocketApp("wss://socket.polygon.io/stocks",
            on_open=lambda ws: (ws.send(json.dumps({"action":"auth","params":API_TOKEN})), ws.send(json.dumps({"action":"subscribe","params":"T.SPY"}))),
            on_message=self.on_msg, on_error=lambda ws,e: print(f"WS Error: {e}"))
        threading.Thread(target=self.ws.run_forever, daemon=True).start()

    def on_msg(self, ws, msg):
        try:
            for x in json.loads(msg):
                if x.get('ev') == 'T' and x.get('sym') == 'SPY':
                    p, s = x.get('p'), x.get('s', 0)
                    with self.lock:
                        if self.latest_price > 0:
                            if p > self.latest_price: self.net_flow += s
                            elif p < self.latest_price: self.net_flow -= s
                        self.latest_price = p; self.net_flow *= 0.99
        except: pass

    def get_data(self):
        with self.lock: return self.latest_price, self.net_flow

class MarketData:
    def __init__(self):
        self.sess = requests.Session()
        if API_TOKEN:
            self.sess.headers.update({"Authorization": f"Bearer {API_TOKEN}"})
        self.base = "https://api.polygon.io"

    def get_spot(self, ticker="SPX"):
        if not API_TOKEN: return 0.0
        try:
            t = "I:SPX" if ticker == "SPX" else ticker
            r = self.sess.get(f"{self.base}/v2/last/trade/{t}" if "I:" not in t else f"{self.base}/v2/aggs/ticker/{t}/prev", timeout=5)
            if r.status_code == 200:
                d = r.json()
                if "I:" in t: return d['results'][0]['c']
                if d.get('results'): return d['results']['p']
            return self.sess.get(f"{self.base}/v2/aggs/ticker/{t}/prev", timeout=5).json()['results'][0]['c']
        except: return 0.0

    def get_chain(self, ticker="SPX", spot=0):
        if not API_TOKEN: return [], 0, 0, pd.DataFrame()
        try:
            root = "SPX" if "SPX" in ticker else ticker
            today = datetime.now().strftime("%Y-%m-%d")
            r = self.sess.get(f"{self.base}/v3/reference/options/contracts", params={"underlying_ticker":root,"expiration_date.gte":today,"limit":1,"sort":"expiration_date","order":"asc"}, timeout=5)
            if r.status_code != 200: 
                if root == "SPX": return self.get_chain("SPY", spot)
                return [], 0, 0, pd.DataFrame()
            
            expiry = r.json()['results'][0]['expiration_date']
            r_snap = self.sess.get(f"{self.base}/v3/snapshot/options/{root}", params={"expiration_date":expiry, "limit": 250}, timeout=10)
            
            data = []
            for o in r_snap.json().get('results', []):
                g = o.get('greeks', {}).get('gamma')
                if g: data.append({'strike': o['details']['strike_price'], 'type': o['details']['contract_type'], 'gamma': float(g), 'oi': float(o.get('open_interest',0)), 'vol': float(o.get('day',{}).get('volume',0))})
            
            df = pd.DataFrame(data)
            if df.empty: return [], 0, 0, pd.DataFrame()
            
            df['gex_abs'] = df['gamma'] * (df['oi'] + df['vol'] * 2.0) * 100
            df['gex_net'] = np.where(df['type'] == 'call', df['gex_abs'], -df['gex_abs'])
            df_g = df.groupby('strike')[['gex_abs', 'gex_net', 'vol']].sum().reset_index()
            
            flip = df_g.loc[df_g['gex_abs'].idxmax()]['strike']
            net = df_g['gex_net'].sum() * spot * 0.01
            nodes = [Node(r['strike'], r['gex_abs']) for _, r in df_g.iterrows()]
            return nodes, net, flip, df
        except: return [], 0, 0, pd.DataFrame()

# ═══════════════════════════════════════════════════════════════════════════════
# 4. DASHBOARD & COMMENTARY
# ═══════════════════════════════════════════════════════════════════════════════

st.set_page_config(page_title="TITAN V5 | Final Boss", page_icon="⚡", layout="wide")
st.markdown("<style>.metric-card {background-color:#1E1E1E; padding:15px; border-radius:10px;}</style>", unsafe_allow_html=True)

if not API_TOKEN:
    st.error("API_TOKEN not found in .env file. Please check your configuration.")
    st.stop()

if 'eng' not in st.session_state:
    st.session_state.eng = TitanEngineV5()
    st.session_state.data = MarketData()
    st.session_state.hist = []

@st.cache_resource
def get_ws():
    ws = TitanStreamer()
    ws.start()
    return ws

ws = get_ws()

# Sidebar
st.sidebar.title("TITAN V5.0")
mode = st.sidebar.radio("Mode", ["Live", "Sim"], index=0)
ticker = st.sidebar.text_input("Ticker", "SPX").upper()

spot, vix, nodes, net_gex, flip, raw_df = 0, 15, [], 0, 0, pd.DataFrame()
net_flow = 0

if mode == "Live":
    ws_p, net_flow = ws.get_data()
    if ws_p > 0: st.sidebar.metric("WS Price", f"{ws_p:.2f}", f"Flow: {net_flow:.0f}")
    else: st.sidebar.warning("Connecting WS...")
    
    if 'last_scan' not in st.session_state: st.session_state.last_scan = 0
    if time.time() - st.session_state.last_scan > 30 or st.sidebar.button("Scan Chain"):
        spot_snap = st.session_state.data.get_spot(ticker)
        nodes, net_gex, flip, raw_df = st.session_state.data.get_chain(ticker, spot_snap)
        st.session_state.cache = (nodes, net_gex, flip, raw_df)
        st.session_state.last_scan = time.time()
    
    nodes, net_gex, flip, raw_df = st.session_state.get('cache', ([], 0, 0, pd.DataFrame()))
    spot = ws_p if ws_p > 0 else st.session_state.data.get_spot(ticker)
    time.sleep(1); st.rerun()
else:
    spot = st.sidebar.number_input("Spot", 400.0, 5000.0, 4150.0)
    net_flow = st.sidebar.slider("Flow", -10000, 10000, 5000)
    nodes = [Node(spot+10, 5e9), Node(spot-10, 5e9)]

# Run Analysis
res = st.session_state.eng.analyze(spot, nodes, net_gex, flip, vix, net_flow)
st.session_state.hist.append({'t': time.strftime("%H:%M:%S"), 'force': res['force_conf']*(1 if res['force_dir']=='UP' else -1), 'flow': res['flow_score']})
if len(st.session_state.hist) > 60: st.session_state.hist.pop(0)

# Display
st.title(f"TITAN V5 | {ticker}")
c1, c2, c3, c4 = st.columns(4)
c1.metric("Spot", f"{spot:.2f}")
c2.metric("Gamma Force", res['force_dir'], f"{res['force_conf']:.0f}%")
c3.metric("Vanna", f"{res['vanna_force']:.2f}")
c4.metric("Signal", res['signal'])

cm, cs = st.columns([3, 1])
with cm:
    if not raw_df.empty:
        df_p = raw_df.groupby(['strike', 'type'])[['gex_abs', 'vol']].sum().unstack(fill_value=0).reset_index()
        df_p.columns = ['strike', 'cg', 'pg', 'cv', 'pv']
        df_p = df_p[(df_p['strike'] > spot*0.985) & (df_p['strike'] < spot*1.015)]
        
        fig = go.Figure()
        fig.add_trace(go.Bar(x=df_p['strike'], y=df_p['cg']/1e9, name='Call Wall', marker_color='#00CC96'))
        fig.add_trace(go.Bar(x=df_p['strike'], y=-df_p['pg']/1e9, name='Put Wall', marker_color='#EF553B'))
        fig.add_vline(x=spot, line_width=2, line_color="yellow", line_dash="solid")
        fig.update_layout(template="plotly_dark", height=400, margin=dict(l=20,r=20,t=30,b=20))
        st.plotly_chart(fig, use_container_width=True)
    else: st.info("Waiting for data...")

with cs:
    if st.session_state.hist: st.area_chart(pd.DataFrame(st.session_state.hist).set_index('t')[['force', 'flow']], height=200)
    if res['vacuum_active']: st.error("🚨 VACUUM")

# Commentary Logic
plan = "Wait."
if res['signal'] == "CONVICTION_TRADE":
    plan = f"🚀 **PRIME {res['force_dir']}**: Flow confirms Structure. Enter on pullback."
    stop = f"Stop: {spot-4 if res['force_dir']=='UP' else spot+4:.2f}"
elif res['signal'] == "FLOW_DIVERGENCE":
    plan = f"⚠️ **TRAP**: Flow contradicts Structure. DO NOT TRADE."
    stop = "N/A"

with st.expander("⚔️ TACTICAL GUIDE", expanded=True):
    st.markdown(f"### {plan}\n* **Stop**: {stop if 'stop' in locals() else 'N/A'}\n* **Logic**: Flow Score {res['flow_score']:.2f} vs Force {res['force_conf']:.0f}%")
