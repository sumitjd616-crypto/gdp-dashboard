import requests
from config import APIConfig
import pandas as pd

class MarketCommentary:
    def __init__(self):
        pass

    def generate_commentary(self, spot, net_gex, flip, force_dir, force_conf, vacuum, vanna, flow_score, signal, kelly_size=0.0):
        """
        Generates tactical trading guidance (Entry/Exit/Stop) based on engine state.
        """
        
        # 1. HEADLINE LOGIC (Refined)
        headline = "😴 MARKET CHOP - PATIENCE"
        color = "gray"
        
        if signal == "CONVICTION_TRADE":
            headline = f"🚀 PRIME {force_dir} SETUP DETECTED"
            color = "green" if force_dir == "UP" else "red"
        elif signal == "FLOW_DIVERGENCE":
            headline = f"⚠️ TRAP - {force_dir} FAKEOUT LIKELY"
            color = "orange"
        elif vacuum and abs(flow_score) > 0.5: # Only signal vacuum if flow supports it (Fixing "Blind Vacuum" flaw)
            headline = "🚨 VACUUM ACCELERATION ACTIVE"
            color = "purple"

        # 2. TACTICAL PLAN (Refined)
        plan = ""
        stop_loss = ""
        target = ""
        size_guide = f"Risk {kelly_size*100:.1f}% of Cap" if kelly_size > 0 else "N/A"
        
        if "PRIME" in headline:
            if force_dir == "UP":
                plan = "Looking for buyers? **ENTER LONG** on pullbacks. Momentum is real."
                stop_loss = f"Hard Stop: {spot - 4:.2f} (Below Structure)"
                target = f"Target: {spot + 15:.2f} (Next Wall)"
            else:
                plan = "Looking for sellers? **ENTER SHORT** on pops. Structure is collapsing."
                stop_loss = f"Hard Stop: {spot + 4:.2f} (Above Structure)"
                target = f"Target: {spot - 15:.2f} (Vacuum Floor)"
        
        elif "TRAP" in headline:
            plan = f"**STAND DOWN**. Physics says {force_dir} but Real Money is trading the opposite. Wait for alignment."
            stop_loss = "N/A"
            target = "N/A"

        elif "VACUUM" in headline:
            plan = "**SCALP MODE**. Fast execution. Do not hold through bounces."
            stop_loss = "Trailing Stop 2pts."
            target = "Next High Volume Node."
            
        else:
            plan = "Market is balancing (Chop). Theta decay is the winner. **NO TRADE**."
            stop_loss = "N/A"
            target = "N/A"
            size_guide = "0%"

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
        *   **Size**: {size_guide}
        
        **🧠 THE "WHY" (Engine Logic)**
        {evidence_str}
        
        *(Confidence: {force_conf:.0f}% | Flow Score: {flow_score:.2f})*
        """
