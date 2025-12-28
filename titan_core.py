import numpy as np
import time

class CONFIG:
    SIGMA_BASE = 10
    GEX_SIG = 1e9
    VIX_BASE = 15
    VACUUM_ENTER_DIST = 6.0
    VACUUM_EXIT_DIST = 3.5
    GAP_THRESHOLD_MS = 1500
    WARMUP_TICKS = 5
    KELLY_FRACTION = 0.25

class Node:
    def __init__(self, strike, abs_gamma, touch_count=0):
        self.strike = strike
        self.abs_gamma = abs_gamma
        self.touch_count = touch_count

class TitanEngineV3:
    def __init__(self):
        self.last_update = 0
        self.prev_ke = 0
        self.prev_vix = 15
        self.warmup = 0
        self.quality = 'GOOD'
        self.vacuum_strikes = set()

    def analyze(self, spot, nodes, gex, flip, vix, flow_imbalance):
        now = int(time.time() * 1000)
        self._process_tick_state(now, 0, vix)
        
        # 1. Gaussian Force (Potential Energy)
        sigma = self._calc_sigma(vix)
        force = self._compute_gaussian_force(spot, nodes, sigma)
        
        # 2. Vanna Force (Anti-Gravity)
        vanna_force = -(vix - self.prev_vix) * (gex / CONFIG.GEX_SIG) * 2.0 
        
        # 3. Kinetic Flow (The Trigger)
        # Normalize flow: Assuming 10k shares net is "High" for instant tick
        flow_score = min(2.0, max(-2.0, flow_imbalance / 5000))
        
        # 4. Vacuum Hysteresis
        for n in nodes: self._update_vacuum_state(n, spot)
            
        # 5. Fusion (Structure + Vol + Flow)
        # Flow validates Structure.
        # If Force UP + Flow UP = HIGH CONFIDENCE
        # If Force UP + Flow DOWN = DIVERGENCE (Wait)
        
        base_conf = force['confidence']
        
        # Alignment check
        aligned = False
        if force['dir'] == 'UP' and flow_score > 0.5: aligned = True
        if force['dir'] == 'DOWN' and flow_score < -0.5: aligned = True
        
        if aligned: base_conf += 20
        elif abs(flow_score) > 1.0: base_conf -= 30 # Heavy counter-flow kills signal
        
        final_conf = min(99, max(0, base_conf))
        
        # Determine Status
        status_msg = "NEUTRAL"
        if aligned and final_conf > 70: status_msg = "CONVICTION_TRADE"
        elif not aligned and abs(flow_score) > 1.0: status_msg = "FLOW_DIVERGENCE"

        return {
            "status": self.quality,
            "force_dir": force['dir'],
            "force_conf": final_conf,
            "vanna_force": vanna_force,
            "flow_score": flow_score,
            "vacuum_active": len(self.vacuum_strikes) > 0,
            "signal": status_msg,
            "audit": f"PHYSICS:{force['dir']} | FLOW:{flow_score:.2f} | STATUS:{status_msg}"
        }

    def _process_tick_state(self, now, ke, vix):
        gap = now - self.last_update
        if gap > CONFIG.GAP_THRESHOLD_MS and self.last_update != 0:
            self.quality = 'GAP'
            self.warmup = CONFIG.WARMUP_TICKS
        elif self.warmup > 0:
            self.quality = 'WARMING'
            self.warmup -= 1
        else:
            self.quality = 'GOOD'
        self.last_update = now
        self.prev_vix = vix

    def _update_vacuum_state(self, n, spot):
        dist = abs(n.strike - spot)
        if n.strike not in self.vacuum_strikes and dist > CONFIG.VACUUM_ENTER_DIST:
            self.vacuum_strikes.add(n.strike)
        elif n.strike in self.vacuum_strikes and dist < CONFIG.VACUUM_EXIT_DIST:
            self.vacuum_strikes.discard(n.strike)

    def _calculate_kelly(self, conf, rr, mult):
        return 0 # Simplified for V5 logic

    def _calc_sigma(self, vix):
        return CONFIG.SIGMA_BASE * ((vix / CONFIG.VIX_BASE) ** 1.5)

    def _compute_gaussian_force(self, spot, nodes, sigma):
        up, down = 0.0, 0.0
        for n in nodes:
            weight = (n.abs_gamma / CONFIG.GEX_SIG) * self._gaussian_pdf(spot, n.strike, sigma)
            if n.strike > spot: up += weight
            else: down += weight
        total = up + down
        diff = up - down
        return {"dir": 'UP' if diff > 0 else 'DOWN', "confidence": min(99.0, (abs(diff) / total) * 100.0) if total > 0 else 0.0}

    def _gaussian_pdf(self, x, mu, sigma):
        return (1.0 / (sigma * np.sqrt(2 * np.pi))) * np.exp(-0.5 * ((x - mu) / sigma) ** 2)
