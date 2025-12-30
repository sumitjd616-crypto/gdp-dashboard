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

    def get_spot_price(self, ticker="SPX"):
        try:
            query_ticker = ticker
            if ticker == "SPX": query_ticker = "I:SPX"
            
            # Try Real-Time Trade first
            endpoint = f"/v2/last/trade/{query_ticker}" if "I:" not in query_ticker else f"/v2/aggs/ticker/{query_ticker}/prev"
            
            resp = self.session.get(f"{self.base_url}{endpoint}", timeout=APIConfig.TIMEOUT)
            if resp.status_code == 200:
                data = resp.json()
                if "I:" in query_ticker: return data['results'][0]['c']
                if data.get('results'): return data['results']['p']
            
            # Fallback
            resp_agg = self.session.get(f"{self.base_url}/v2/aggs/ticker/{query_ticker}/prev", timeout=APIConfig.TIMEOUT)
            if resp_agg.status_code == 200: return resp_agg.json()['results'][0]['c']
            
        except Exception as e:
            print(f"Error fetching spot: {e}")
        return 0.0

    def get_vix(self):
        try:
            resp = self.session.get(f"{self.base_url}/v2/aggs/ticker/I:VIX/prev", timeout=3)
            if resp.status_code == 200: return resp.json()['results'][0]['c']
        except: pass
        return 15.0

    def get_option_chain_gex(self, ticker="SPX", spot=None):
        target_root = "SPX" if "SPX" in ticker else ticker
        if spot is None: spot = self.get_spot_price(ticker)
        if spot == 0: return [], 0, 0, pd.DataFrame(), None

        try:
            today = datetime.now().strftime("%Y-%m-%d")
            
            # 1. OPTIMIZATION: Reduce payload - fetch only near-the-money if possible?
            # Polygon doesn't support strike filtering well on contract list without pagination loop.
            # Best efficient way: Get nearest expiry, then snapshot.
            
            r = self.session.get(f"{self.base_url}/v3/reference/options/contracts", params={
                "underlying_ticker": target_root, 
                "expiration_date.gte": today, 
                "limit": 1, 
                "sort": "expiration_date", 
                "order": "asc"
            }, timeout=APIConfig.TIMEOUT)
            
            if r.status_code != 200 or not r.json().get('results'): 
                if target_root == "SPX": return self.get_option_chain_gex("SPY", spot)
                return [], 0, 0, pd.DataFrame(), None

            expiry = r.json()['results'][0]['expiration_date']
            
            # 2. OPTIMIZATION: Snapshot
            r_snap = self.session.get(f"{self.base_url}/v3/snapshot/options/{target_root}", params={
                "expiration_date": expiry, "limit": 250
            }, timeout=10)
            
            results = r_snap.json().get('results', [])
            if not results: return [], 0, 0, pd.DataFrame()

            # 3. VECTORIZATION (Fixing "Slow Loop" flaw)
            data_list = []
            for opt in results:
                details = opt.get('details', {})
                greeks = opt.get('greeks', {}) or {}
                gamma = greeks.get('gamma')
                
                # Handling missing gamma with approximation if needed, but for speed we skip or calc
                if gamma is None: continue 
                
                data_list.append({
                    'strike': details.get('strike_price'),
                    'type': details.get('contract_type'),
                    'gamma': float(gamma),
                    'oi': float(opt.get('open_interest', 0) or 0),
                    'volume': float(opt.get('day', {}).get('volume', 0) or 0)
                })

            df = pd.DataFrame(data_list)
            if df.empty: return [], 0, 0, pd.DataFrame()
            
            # 4. LOGIC REFINEMENT: Weight Volume Higher (Fixing "Old Data" flaw)
            # Standard GEX = Gamma * OI * 100
            # Titan V5 GEX = Gamma * (OI + Volume*2) * 100 
            # We weight fresh volume 2x to account for "New Walls" being built intraday.
            
            df['gex_abs'] = df['gamma'] * (df['oi'] + df['volume'] * 2.0) * 100
            df['gex_net'] = np.where(df['type'] == 'call', df['gex_abs'], -df['gex_abs'])
            
            df_strikes = df.groupby('strike')[['gex_abs', 'gex_net', 'volume', 'oi']].sum().reset_index()
            
            # 5. Flip Level Refinement (Zero Gamma Crossover)
            # Find strike closest to where gex_net crosses 0?
            # Or simplified: Strike with Max Absolute Gamma (The "Pivot")
            flip_level = df_strikes.loc[df_strikes['gex_abs'].idxmax()]['strike']
            total_net_gex = df_strikes['gex_net'].sum() * spot * 0.01

            nodes = [Node(row['strike'], row['gex_abs']) for _, row in df_strikes.iterrows()]
            
            return nodes, total_net_gex, flip_level, df

        except Exception as e:
            print(f"Data Error: {e}")
            return [], 0, 0, pd.DataFrame()
