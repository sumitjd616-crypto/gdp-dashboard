import requests
from config import APIConfig
import pandas as pd
from datetime import datetime

class MarketCommentary:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(APIConfig.get_headers())
        self.base_url = APIConfig.BASE_URL
        
    def get_context(self, ticker="SPY"):
        try:
            # 1. Previous Day Close
            prev_close = 0
            r_prev = self.session.get(f"{self.base_url}/v2/aggs/ticker/{ticker}/prev", timeout=5)
            if r_prev.status_code == 200:
                prev_close = r_prev.json()['results'][0]['c']
                
            # 2. Pre-Market Range (4am - 9:30am ET)
            # Need to fetch agg bars for today
            # Simple approximation: Get today's open vs current
            
            # For now, let's just return key levels
            return {
                "prev_close": prev_close,
                "pivot": prev_close # Simplified Pivot
            }
        except:
            return {"prev_close": 0, "pivot": 0}

    def generate_commentary(self, spot, net_gex, flip, force_dir, force_conf, vacuum, vanna):
        """
        Generates trader-focused commentary comparing current action to structure.
        """
        bias = "NEUTRAL"
        if force_conf > 60: bias = force_dir
        
        # Structure Analysis
        structure_msg = ""
        if net_gex > 0:
            structure_msg = "Market is in **Positive Gamma** (Dampened Volatility). Dealers are fading moves."
        else:
            structure_msg = "Market is in **Negative Gamma** (High Volatility). Dealers are chasing moves."
            
        # Vanna/Vol Context
        vanna_msg = ""
        if vanna > 1.0:
            vanna_msg = "Vanna flows are **Supportive** (VIX dropping), adding tailwind to bulls."
        elif vanna < -1.0:
            vanna_msg = "Vanna flows are **Bearish** (VIX rising), adding pressure to downside."
            
        # Vacuum Context
        vac_msg = "No structural voids nearby."
        if vacuum:
            vac_msg = "🚨 **VACUUM TRIGGERED**: Price has entered a low-liquidity pocket. Expect acceleration."
            
        return f"""
        **Market Context**:
        *   **Structure**: {structure_msg}
        *   **Dealer Positioning**: Net GEX is {"Bullish" if net_gex > 0 else "Bearish"}. Flip Level at {flip}.
        *   **Flow Dynamics**: {vanna_msg}
        
        **Live Action**:
        *   Physics Engine is signaling **{bias} ({force_conf:.0f}%)**.
        *   {vac_msg}
        """

