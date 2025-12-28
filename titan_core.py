import numpy as np
import time

# ═══════════════════════════════════════════════════════════════════════════════
# 1. CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

class CONFIG:
    # Physics
    SIGMA_BASE = 10
    GEX_SIG = 1e9
    VIX_BASE = 15
    VACUUM_ENTER_DIST = 6.0
    VACUUM_EXIT_DIST = 3.5
    
    # Timing
    GAP_THRESHOLD_MS = 1500
    WARMUP_TICKS = 5
    
    # Sizing
    KELLY_FRACTION = 0.25

# ═══════════════════════════════════════════════════════════════════════════════
# 2. DATA STRUCTURES
# ═══════════════════════════════════════════════════════════════════════════════

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

    def analyze(self, spot, nodes, gex, flip, vix, ke):
        now = int(time.time() * 1000)
        self._process_tick_state(now, ke, vix)
        
        # 1. Gaussian Force (Static Structure)
        sigma = self._calc_sigma(vix)
        force = self._compute_gaussian_force(spot, nodes, sigma)
        
        # 2. Vanna Force (Dynamic Volatility Flow)
        # If VIX is dropping, Dealers BUY back Short Calls -> Force UP
        # If VIX is rising, Dealers SELL -> Force DOWN
        vix_change = vix - self.prev_vix
        # Vanna is stronger when Net GEX is large
        vanna_force = -vix_change * (gex / CONFIG.GEX_SIG) * 2.0 
        
        # 3. Vacuum Hysteresis
        for n in nodes:
            self._update_vacuum_state(n, spot)
            
        # Combine Forces
        total_conf = force['confidence'] + (vanna_force * 10) # Vanna kicker
        total_conf = min(99, max(0, total_conf))
        
        # Determine Dominant Direction
        # If Gaussian says UP but VIX Spiking (Vanna DOWN) -> Conflict/Chop
        final_dir = force['dir']
        if force['dir'] == 'UP' and vanna_force < -1: final_dir = 'CHOP'
        if force['dir'] == 'DOWN' and vanna_force > 1: final_dir = 'CHOP'

        return {
            "status": self.quality,
            "force_dir": final_dir,
            "force_conf": total_conf,
            "vanna_force": vanna_force,
            "vacuum_active": len(self.vacuum_strikes) > 0,
            "sizing": self._calculate_kelly(total_conf, 1.5, 1.0),
            "sigma": sigma,
            "audit": f"PHYSICS: {force['dir']} | VANNA: {vanna_force:.2f} | QUALITY: {self.quality}"
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
        self.prev_ke = ke
        # self.prev_vix update moved to analyze start to catch change? 
        # No, update at end is correct for next tick comparison
        self.prev_vix = vix

    def _update_vacuum_state(self, n, spot):
        dist = abs(n.strike - spot)
        if n.strike not in self.vacuum_strikes and dist > CONFIG.VACUUM_ENTER_DIST:
            self.vacuum_strikes.add(n.strike)
        elif n.strike in self.vacuum_strikes and dist < CONFIG.VACUUM_EXIT_DIST:
            self.vacuum_strikes.discard(n.strike)

    def _calculate_kelly(self, conf, rr, mult):
        if self.quality != 'GOOD': return 0.0
        p = (conf / 100.0) * mult
        if p <= 0: return 0.0
        q = 1.0 - p
        k = ((rr * p) - q) / rr
        return max(0.0, k * CONFIG.KELLY_FRACTION)

    def _calc_sigma(self, vix):
        return CONFIG.SIGMA_BASE * ((vix / CONFIG.VIX_BASE) ** 1.5)

    def _compute_gaussian_force(self, spot, nodes, sigma):
        up = 0.0
        down = 0.0
        for n in nodes:
            weight = (n.abs_gamma / CONFIG.GEX_SIG) * self._gaussian_pdf(spot, n.strike, sigma)
            if n.strike > spot: up += weight
            else: down += weight
        total = up + down
        diff = up - down
        direction = 'UP' if diff > 0 else 'DOWN'
        confidence = min(99.0, (abs(diff) / total) * 100.0) if total > 0 else 0.0
        return {"dir": direction, "confidence": confidence}

    def _gaussian_pdf(self, x, mu, sigma):
        return (1.0 / (sigma * np.sqrt(2 * np.pi))) * np.exp(-0.5 * ((x - mu) / sigma) ** 2)
