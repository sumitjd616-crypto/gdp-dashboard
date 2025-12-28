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
        
        # 1. Gaussian Force
        sigma = self._calc_sigma(vix)
        force = self._compute_gaussian_force(spot, nodes, sigma)
        
        # 2. Vanna Multiplier
        vanna_mult = self._calc_vanna_multiplier(gex, spot > flip)
        
        # 3. Vacuum Hysteresis
        for n in nodes:
            self._update_vacuum_state(n, spot)
            
        # Audit
        return {
            "status": self.quality,
            "force_dir": force['dir'],
            "force_conf": force['confidence'],
            "vanna_mult": vanna_mult,
            "vacuum_active": len(self.vacuum_strikes) > 0,
            "sizing": self._calculate_kelly(force['confidence'], 1.5, vanna_mult),
            "sigma": sigma,
            "audit": f"PHYSICS: {force['dir']} ({force['confidence']:.1f}%) | VANNA: {vanna_mult:.1f}x | STATE: {self.quality}"
        }

    def _process_tick_state(self, now, ke, vix):
        gap = now - self.last_update
        # On first run, gap is huge -> GAP state -> Warmup. Correct.
        if gap > CONFIG.GAP_THRESHOLD_MS:
            self.quality = 'GAP'
            self.warmup = CONFIG.WARMUP_TICKS
        elif self.warmup > 0:
            self.quality = 'WARMING'
            self.warmup -= 1
        else:
            self.quality = 'GOOD'
            
        self.last_update = now
        self.prev_ke = ke
        self.prev_vix = vix

    def _update_vacuum_state(self, n, spot):
        dist = abs(n.strike - spot)
        if n.strike not in self.vacuum_strikes and dist > CONFIG.VACUUM_ENTER_DIST:
            self.vacuum_strikes.add(n.strike)
        elif n.strike in self.vacuum_strikes and dist < CONFIG.VACUUM_EXIT_DIST:
            self.vacuum_strikes.discard(n.strike)

    def _calc_vanna_multiplier(self, gex, above_flip):
        mag = abs(gex) / CONFIG.GEX_SIG
        if not above_flip:
            return 1.5 + (mag * 0.3)
        return 0.7

    def _calculate_kelly(self, conf, rr, mult):
        if self.quality != 'GOOD':
            return 0.0
        
        p = (conf / 100.0) * (1.2 if mult > 1 else 0.8)
        if p <= 0: return 0.0
        
        # Kelly: f = (p(b+1) - 1) / b  -> ((RR * p) - q) / RR
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
            if n.strike > spot:
                up += weight
            else:
                down += weight
                
        total = up + down
        diff = up - down
        
        direction = 'UP' if diff > 0 else 'DOWN'
        confidence = min(99.0, (abs(diff) / total) * 100.0) if total > 0 else 0.0
        
        return {"dir": direction, "confidence": confidence}

    def _gaussian_pdf(self, x, mu, sigma):
        return (1.0 / (sigma * np.sqrt(2 * np.pi))) * np.exp(-0.5 * ((x - mu) / sigma) ** 2)
