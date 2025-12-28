/**
 * TITAN PHYSICS ENGINE v3.0 - PRODUCTION MASTER
 * Philosophy: Andrej Karpathy (Explicit logic, robust state, no magic numbers)
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 1. TYPES & CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

export const CONFIG = {
  // Physics
  SIGMA_BASE: 10, GEX_SIG: 1e9, VIX_BASE: 15,
  VACUUM_ENTER_DIST: 6.0, VACUUM_EXIT_DIST: 3.5, // Hysteresis
  // Timing & Data
  STALE_DATA_MS: 500, GAP_THRESHOLD_MS: 1500, WARMUP_TICKS: 5,
  // Sizing
  KELLY_FRACTION: 0.25, MAX_RISK_PCT: 0.015,
};

export interface Node { strike: number; absGamma: number; touchCount: number; }
interface TickState { 
  lastUpdate: number; prevKE: number; prevVix: number; 
  warmup: number; quality: 'GOOD' | 'WARMING' | 'GAP'; 
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CORE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function gaussianPDF(x: number, mu: number, sigma: number): number {
  return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-Math.pow(x - mu, 2) / (2 * sigma * sigma));
}

export class TitanEngineV3 {
  private state: TickState = { lastUpdate: 0, prevKE: 0, prevVix: 15, warmup: 0, quality: 'GOOD' };
  private vacuumStrikes: Set<number> = new Set();

  public analyze(spot: number, nodes: Node[], gex: number, flip: number, vix: number, ke: number): any {
    const now = Date.now();
    this.processTickState(now, ke, vix);

    // 1. GAUSSIAN FORCE
    const sigma = this.calcSigma(vix);
    const force = this.computeGaussianForce(spot, nodes, sigma);

    // 2. MULTIPLICATIVE SHADOW FORCE
    const vannaMult = this.calcVannaMultiplier(gex, spot > flip);

    // 3. VACUUM HYSTERESIS
    nodes.forEach(n => this.updateVacuumState(n, spot));

    return {
      status: this.state.quality,
      sizing: this.calculateKelly(force.confidence, 1.5, vannaMult),
      audit: `PHYSICS: ${force.dir} | VANNA: ${vannaMult.toFixed(1)}x | QUALITY: ${this.state.quality}`
    };
  }

  private processTickState(now: number, ke: number, vix: number) {
    const gap = now - this.state.lastUpdate;
    // On first run lastUpdate is 0, so gap is huge. Enters GAP state, which triggers warmup. 
    // This is desired behavior (startup warmup).
    if (gap > CONFIG.GAP_THRESHOLD_MS) {
      this.state.quality = 'GAP';
      this.state.warmup = CONFIG.WARMUP_TICKS;
    } else if (this.state.warmup > 0) {
      this.state.quality = 'WARMING';
      this.state.warmup--;
    } else {
      this.state.quality = 'GOOD';
    }
    this.state.lastUpdate = now;
    this.state.prevKE = ke;
    this.state.prevVix = vix;
  }

  private updateVacuumState(n: Node, spot: number) {
    const dist = Math.abs(n.strike - spot);
    if (!this.vacuumStrikes.has(n.strike) && dist > CONFIG.VACUUM_ENTER_DIST) {
      this.vacuumStrikes.add(n.strike);
    } else if (this.vacuumStrikes.has(n.strike) && dist < CONFIG.VACUUM_EXIT_DIST) {
      this.vacuumStrikes.delete(n.strike);
    }
  }

  private calcVannaMultiplier(gex: number, aboveFlip: boolean): number {
    const mag = Math.abs(gex) / CONFIG.GEX_SIG;
    return !aboveFlip ? 1.5 + (mag * 0.3) : 0.7; // Compounded in Neg Gamma
  }

  private calculateKelly(conf: number, rr: number, mult: number): number {
    if (this.state.quality !== 'GOOD') return 0;
    const p = (conf / 100) * (mult > 1 ? 1.2 : 0.8);
    // Kelly formula: f = (p(b+1) - 1) / b where b is odds received (RR)
    // Here using: ((RR * p) - q) / RR
    // q = 1 - p
    if (p <= 0) return 0;
    const q = 1 - p;
    const k = ((rr * p) - q) / rr;
    return Math.max(0, k * CONFIG.KELLY_FRACTION);
  }

  private calcSigma(vix: number): number {
    return CONFIG.SIGMA_BASE * Math.pow(vix / CONFIG.VIX_BASE, 1.5);
  }

  private computeGaussianForce(spot: number, nodes: Node[], sigma: number) {
    let up = 0, down = 0;
    for (const n of nodes) {
        const weight = (n.absGamma / CONFIG.GEX_SIG) * gaussianPDF(spot, n.strike, sigma);
        if (n.strike > spot) up += weight;
        else down += weight;
    }
    const total = up + down;
    const diff = up - down;
    const dir = diff > 0 ? 'UP' : 'DOWN';
    const confidence = total > 0 ? Math.min(99, (Math.abs(diff) / total) * 100) : 0;
    
    return { dir, confidence };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO
// ═══════════════════════════════════════════════════════════════════════════════

export function demo() {
  console.log('TITAN ENGINE v3.0 DEMO');
  const engine = new TitanEngineV3();
  
  const nodes: Node[] = [
      { strike: 4100, absGamma: 2e9, touchCount: 0 },
      { strike: 4150, absGamma: 5e9, touchCount: 0 },
      { strike: 4200, absGamma: 2e9, touchCount: 0 }
  ];
  
  // Simulation loop
  console.log('Simulating 7 ticks (expect GAP -> WARMING -> GOOD)...');
  
  // Need to simulate time passing for Date.now()
  // Since we can't easily sleep in sync JS without blocking, we'll mock behavior or just run logic.
  // The engine uses Date.now(). In a real loop, time passes.
  // For demo, we will just call it. Since it runs effectively instantly, the gap will be 0 after first tick.
  
  for (let i = 0; i < 7; i++) {
      const spot = 4140 + i * 2;
      
      // Artificial delay mock (not real sleep, but consecutive calls are fast enough to be < GAP_THRESHOLD)
      // The first call will see a huge gap (since lastUpdate=0).
      
      const result = engine.analyze(
          spot, 
          nodes, 
          -2e9, // Neg Gamma
          4150, // Flip
          20,   // Vix
          50    // KE
      );
      console.log(`T${i}: Spot ${spot} -> ${result.audit} | Sizing: ${(result.sizing * 100).toFixed(2)}%`);
  }
}

if (typeof require !== 'undefined' && require.main === module) demo();
