import requests
from config import APIConfig
import pandas as pd

class MarketCommentary:
    def __init__(self):
        pass

    def generate_commentary(self, spot, net_gex, flip, force_dir, force_conf, vacuum, vanna, flow_score, signal):
        """
        Generates tactical trading guidance (Entry/Exit/Stop) based on engine state.
        """
        
        # 1. HEADLINE
        headline = "😴 MARKET CHOP - PATIENCE"
        color = "gray"
        
        if signal == "CONVICTION_TRADE":
            headline = f"🚀 PRIME {force_dir} SETUP DETECTED"
            color = "green" if force_dir == "UP" else "red"
        elif signal == "FLOW_DIVERGENCE":
            headline = f"⚠️ CAUTION - {force_dir} FAKEOUT LIKELY"
            color = "orange"
        elif vacuum:
            headline = "🚨 VACUUM ACCELERATION PHASE"
            color = "purple"

        # 2. TACTICAL PLAN
        plan = ""
        stop_loss = ""
        target = ""
        
        if signal == "CONVICTION_TRADE":
            if force_dir == "UP":
                plan = "Look for pullback to VWAP to ENTER LONG. Buyers are aggressive."
                stop_loss = f"Stop below {spot - 3:.2f} (Structure Support)"
                target = f"Target {spot + 10:.2f} (Next Gamma Level)"
            else:
                plan = "Sell rallies. Aggressive selling into weakness detected."
                stop_loss = f"Stop above {spot + 3:.2f} (Structure Res)"
                target = f"Target {spot - 10:.2f} (Vacuum Floor)"
        
        elif signal == "FLOW_DIVERGENCE":
            plan = f"DO NOT CHASE the {force_dir} move. Aggressors are trading AGAINST the structure."
            stop_loss = "Wait for flow to align with structure."
            target = "No trade."

        elif vacuum:
            plan = "MOMENTUM TRADE ONLY. Do not fade. Price is in freefall/skyrocket mode."
            stop_loss = "Tight trailing stop (2pts). Volatility is expanding."
            target = "Next High Volume Node."
            
        else:
            plan = "Market is balancing. Theta decay active. Scalp 2-3 points or SIT ON HANDS."
            stop_loss = "Tight stops if scalping."
            target = "Range bound."

        # 3. EVIDENCE (Reasoning)
        reasons = []
        if abs(flow_score) > 0.5:
            reasons.append(f"**Flow**: Net Aggressors are {'Buying' if flow_score > 0 else 'Selling'} ({flow_score:.2f} sigma)")
        if abs(vanna) > 1.0:
            reasons.append(f"**Vanna**: Volatility flow is {'supporting' if (vanna > 0 and force_dir=='UP') else 'drag'} the move")
        if net_gex > 0:
            reasons.append("**Structure**: Positive Gamma (Dealers dampen volatility - Expect mean reversion)")
        else:
            reasons.append("**Structure**: Negative Gamma (Dealers expand volatility - Expect acceleration)")

        evidence_str = "\n".join([f"* {r}" for r in reasons])

        return f"""
        ### **{headline}**
        
        **🛡️ BATTLE PLAN**
        *   **Action**: {plan}
        *   **Stop Loss**: {stop_loss}
        *   **Target**: {target}
        
        **🧠 THE "WHY" (Engine Logic)**
        {evidence_str}
        
        *(Confidence: {force_conf:.0f}% | Flow Score: {flow_score:.2f})*
        """
