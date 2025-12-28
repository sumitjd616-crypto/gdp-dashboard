import requests
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from config import APIConfig
from titan_core import Node
import time

class MarketDataManager:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(APIConfig.get_headers())
        self.base_url = APIConfig.BASE_URL
        
    def check_connection(self):
        if not APIConfig.TOKEN: return False
        try:
            r = self.session.get(f"{self.base_url}/v3/reference/status", timeout=5)
            return r.status_code == 200
        except: return False

    def get_spot_price(self, ticker="SPY"):
        try:
            # 1. Try Real-Time Trade
            resp = self.session.get(f"{self.base_url}/v2/last/trade/{ticker}", timeout=APIConfig.TIMEOUT)
            if resp.status_code == 200:
                data = resp.json()
                if data.get('results'): return data['results']['p']
            
            # 2. Fallback to Prev Close
            resp_agg = self.session.get(f"{self.base_url}/v2/aggs/ticker/{ticker}/prev", timeout=APIConfig.TIMEOUT)
            if resp_agg.status_code == 200: return resp_agg.json()['results'][0]['c']
        except Exception as e:
            print(f"Error fetching spot: {e}")
        return 0.0

    def get_vix(self):
        for t in ["I:VIX", "VIX", "VIXY"]:
            try:
                resp = self.session.get(f"{self.base_url}/v2/aggs/ticker/{t}/prev", timeout=3)
                if resp.status_code == 200: return resp.json()['results'][0]['c']
            except: continue
        return 15.0

    def get_option_chain_gex(self, ticker="SPY", spot=None):
        if spot is None: spot = self.get_spot_price(ticker)
        if spot == 0: return [], 0, 0, pd.DataFrame()

        try:
            # 1. Get Nearest Expiry
            today = datetime.now().strftime("%Y-%m-%d")
            r = self.session.get(f"{self.base_url}/v3/reference/options/contracts", params={
                "underlying_ticker": ticker, "expiration_date.gte": today, "limit": 1, "sort": "expiration_date", "order": "asc"
            }, timeout=APIConfig.TIMEOUT)
            
            if r.status_code != 200 or not r.json().get('results'): return [], 0, 0, pd.DataFrame()
            expiry = r.json()['results'][0]['expiration_date']
            
            # 2. Vectorized Snapshot Fetch
            # We fetch ALL strikes for this expiry
            r_snap = self.session.get(f"{self.base_url}/v3/snapshot/options/{ticker}", params={
                "expiration_date": expiry, "limit": 250
            }, timeout=10)
            
            results = r_snap.json().get('results', [])
            if not results: return [], 0, 0, pd.DataFrame()

            # 3. "Karpathy" Optimization: Vectorized Processing via Pandas
            # Instead of looping, we build a DataFrame
            data_list = []
            for opt in results:
                details = opt.get('details', {})
                greeks = opt.get('greeks', {}) or {}
                
                # Safe Extraction
                gamma = greeks.get('gamma')
                if gamma is None: continue # Skip if no gamma (simpler than BS calc for speed)
                
                data_list.append({
                    'strike': details.get('strike_price'),
                    'type': details.get('contract_type'), # 'call' or 'put'
                    'gamma': float(gamma),
                    'oi': float(opt.get('open_interest', 0) or 0),
                    'volume': float(opt.get('day', {}).get('volume', 0) or 0)
                })

            df = pd.DataFrame(data_list)
            if df.empty: return [], 0, 0, pd.DataFrame()
            
            # 4. Vectorized GEX Calculation
            # GEX = Gamma * OI * 100
            df['gex_abs'] = df['gamma'] * df['oi'] * 100 # Absolute GEX contribution
            
            # Net GEX (Directional): Calls are +, Puts are -
            df['gex_net'] = np.where(df['type'] == 'call', df['gex_abs'], -df['gex_abs'])
            
            # Group by Strike to combine Calls and Puts
            df_strikes = df.groupby('strike')[['gex_abs', 'gex_net', 'volume', 'oi']].sum().reset_index()
            
            # 5. Determine Flip Level (Strike where Net GEX flips from - to + or min/max)
            # Simple Proxy: Strike with highest Absolute Gamma is the "Magnet"
            # Better Proxy: The zero-crossing of Cumulative GEX? 
            # Let's stick to Max Gamma Level as the "Pivot"
            flip_level = df_strikes.loc[df_strikes['gex_abs'].idxmax()]['strike']
            total_net_gex = df_strikes['gex_net'].sum() * spot * 0.01

            # 6. Convert to Titan Nodes
            nodes = [Node(row['strike'], row['gex_abs']) for _, row in df_strikes.iterrows()]
            
            return nodes, total_net_gex, flip_level, df # Return DF for advanced plotting

        except Exception as e:
            print(f"Data Error: {e}")
            return [], 0, 0, pd.DataFrame()
