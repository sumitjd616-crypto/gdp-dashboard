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
        if not APIConfig.TOKEN:
            return False
        try:
            # Simple ping
            r = self.session.get(f"{self.base_url}/v3/reference/status", timeout=5)
            return r.status_code == 200
        except:
            return False

    def get_spot_price(self, ticker="SPY"):
        try:
            # Try Real-Time Trade first
            url = f"{self.base_url}/v2/last/trade/{ticker}"
            resp = self.session.get(url, timeout=APIConfig.TIMEOUT)
            if resp.status_code == 200:
                data = resp.json()
                if data.get('results'):
                    return data['results']['p']
            
            # Fallback to Aggregate (Previous Close if market closed)
            url_agg = f"{self.base_url}/v2/aggs/ticker/{ticker}/prev"
            resp_agg = self.session.get(url_agg, timeout=APIConfig.TIMEOUT)
            if resp_agg.status_code == 200:
                return resp_agg.json()['results'][0]['c']
                
        except Exception as e:
            print(f"Error fetching spot: {e}")
        return 0.0

    def get_vix(self):
        # Trying typical tickers for VIX
        for t in ["I:VIX", "VIX", "VIXY"]:
            try:
                # Indices often use /v2/aggs/ticker/I:VIX/prev
                url = f"{self.base_url}/v2/aggs/ticker/{t}/prev"
                resp = self.session.get(url, timeout=3)
                if resp.status_code == 200:
                    return resp.json()['results'][0]['c']
            except:
                continue
        return 15.0

    def get_option_chain_gex(self, ticker="SPY", spot=None):
        if spot is None:
            spot = self.get_spot_price(ticker)
        if spot == 0: return [], 0, 0

        # 1. Find Nearest Expiry
        try:
            # List contracts to find nearest expiry
            today = datetime.now().strftime("%Y-%m-%d")
            url_contracts = f"{self.base_url}/v3/reference/options/contracts"
            params = {
                "underlying_ticker": ticker,
                "expiration_date.gte": today,
                "limit": 1,
                "sort": "expiration_date",
                "order": "asc"
            }
            r = self.session.get(url_contracts, params=params, timeout=APIConfig.TIMEOUT)
            if r.status_code != 200 or not r.json().get('results'):
                return [], 0, 0
                
            expiry = r.json()['results'][0]['expiration_date']
            
            # 2. Get Snapshot for that Expiry
            # This returns all options for that expiry with Greeks
            url_snap = f"{self.base_url}/v3/snapshot/options/{ticker}"
            params_snap = {
                "expiration_date": expiry,
                "limit": 250 # Polygon max limit? Pagination might be needed for SPX
            }
            
            # Note: Pagination handling is needed for full SPX chain, 
            # but for 10-15pt moves, near-the-money is key.
            # We will use iterator if generic wrapper supports it, else simple fetch.
            
            # Actually Polygon snapshot doesn't always support pagination in the same way.
            # Assuming we get a decent chunk.
            
            r_snap = self.session.get(url_snap, params=params_snap, timeout=10)
            results = r_snap.json().get('results', [])
            
            # 3. Calculate GEX
            # Map: Strike -> Net Gamma
            strike_gamma = {}
            
            for opt in results:
                details = opt.get('details', {})
                strike = details.get('strike_price')
                contract_type = details.get('contract_type') # 'call' or 'put'
                
                # Check for Greeks
                greeks = opt.get('greeks', {})
                gamma = greeks.get('gamma')
                oi = opt.get('open_interest', 0)
                
                if gamma is None:
                    iv = details.get('implied_volatility')
                    if iv and expiry and spot:
                        # Calculate Gamma if missing but IV present
                        from titan_math import black_scholes_gamma
                        try:
                            T = (datetime.strptime(expiry, "%Y-%m-%d") - datetime.now()).days / 365.0
                            if T < 1/365: T = 1/365
                            gamma = black_scholes_gamma(spot, strike, T, 0.04, iv)
                        except:
                            gamma = None
                
                if gamma is None or oi is None:
                    continue
                    
                # Calculate GEX contribution
                # Standard: Call (+), Put (-) for Dealer Exposure?
                # Using: Call GEX = Gamma * OI * 100 * Spot * Spot * 0.01 (Dollar Gamma)
                # Simplified: Gamma * OI * 100
                
                # Contribution to Dealer Gamma:
                # Dealer Short Call -> Negative Gamma -> Market instability (Hedging same direction)
                # Dealer Short Put -> Positive Gamma -> Market stability (Hedging inverse)
                
                # Wait.
                # Dealer Short Call: Price UP -> Delta becomes more negative -> Dealer Buys -> Pro-cyclical.
                # Dealer Short Put: Price DOWN -> Delta becomes more positive -> Dealer Buys -> Counter-cyclical.
                
                # Let's stick to simple "Wall" logic.
                # Call Wall = Resistance. Put Wall = Support.
                
                gex_val = gamma * oi * 100
                
                if strike not in strike_gamma: strike_gamma[strike] = 0
                
                # Netting
                # If Call: Add
                # If Put: Add (Absolute Gamma is what matters for "Walls")
                
                # But for Net GEX (Directional Bias):
                # Call - Put ?
                if contract_type == 'call':
                    strike_gamma[strike] += gex_val
                else:
                    strike_gamma[strike] += gex_val # Storing ABSOLUTE GAMMA for Nodes
            
            # Convert to Nodes
            nodes = []
            total_net_gex = 0 # Placeholder for directional gex
            
            for k, g in strike_gamma.items():
                nodes.append(Node(float(k), float(g)))
            
            # Flip Level = Strike with zero Net GEX? 
            # Simplified: Strike with Max Gamma is the "Anchor"
            
            return nodes, 0, spot # Returning spot as flip for now if calcs are complex
            
        except Exception as e:
            print(f"Data Fetch Error: {e}")
            return [], 0, 0
