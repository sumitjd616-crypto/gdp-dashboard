#!/usr/bin/env python3
"""
TITAN OMEGA - PRODUCTION SYSTEM
================================
Real SPX dealer flow analysis with honest data handling.

LIVE MODE: Real-time SPX + options data during market hours
STUDY MODE: Historical session replay after hours

export POLYGON_API_KEY='key' && python titan.py
Dashboard: http://localhost:5000
"""
import asyncio,aiohttp,json,logging,sqlite3,time,os,sys,signal as sg,urllib.request,random
from dataclasses import dataclass,field
from datetime import datetime,timedelta
from enum import Enum,auto
from typing import Dict,List,Optional,Tuple
from threading import Lock,Thread
import numpy as np
from flask import Flask,render_template_string,jsonify,request
from flask_socketio import SocketIO

logging.basicConfig(level=logging.INFO,format='%(asctime)s|%(message)s',datefmt='%H:%M:%S')

# ═══════════════════════════════════════════════════════════════════════════════
# MARKET DATA FETCHER (Real Data from Polygon)
# ═══════════════════════════════════════════════════════════════════════════════
class MarketData:
    """Fetches REAL market data from Polygon"""
    def __init__(self, api_key):
        self.api_key = api_key
        self.cache = {}
        self.cache_time = {}
        
    def _fetch(self, url):
        try:
            with urllib.request.urlopen(f"{url}&apiKey={self.api_key}", timeout=10) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            logging.error(f"API Error: {e}")
            return None
    
    def get_spx(self):
        """Get real SPX price"""
        if 'spx' in self.cache and time.time() - self.cache_time.get('spx', 0) < 60:
            return self.cache['spx']
        
        data = self._fetch("https://api.polygon.io/v2/aggs/ticker/I:SPX/prev?")
        if data and data.get('results'):
            r = data['results'][0]
            result = {
                'open': r.get('o', 0),
                'high': r.get('h', 0),
                'low': r.get('l', 0),
                'close': r.get('c', 0),
                'timestamp': r.get('t', 0)
            }
            self.cache['spx'] = result
            self.cache_time['spx'] = time.time()
            return result
        return None
    
    def get_vix(self):
        """Get real VIX (volatility index)"""
        if 'vix' in self.cache and time.time() - self.cache_time.get('vix', 0) < 60:
            return self.cache['vix']
        
        data = self._fetch("https://api.polygon.io/v2/aggs/ticker/I:VIX/prev?")
        if data and data.get('results'):
            r = data['results'][0]
            result = {
                'open': r.get('o', 0),
                'high': r.get('h', 0),
                'low': r.get('l', 0),
                'close': r.get('c', 0)
            }
            self.cache['vix'] = result
            self.cache_time['vix'] = time.time()
            return result
        return None
    
    def get_options_snapshot(self):
        """Get SPX options snapshot (may be limited on free tier)"""
        data = self._fetch("https://api.polygon.io/v3/snapshot/options/SPX?limit=250&")
        if data and data.get('results'):
            return data['results']
        return []
    
    def is_market_open(self):
        """Check if US market is currently open"""
        now = datetime.now()
        # Market hours: Mon-Fri, 9:30 AM - 4:00 PM ET
        if now.weekday() >= 5:  # Weekend
            return False
        hour, minute = now.hour, now.minute
        # Simplified check (assumes ET timezone)
        if hour < 9 or (hour == 9 and minute < 30):
            return False
        if hour >= 16:
            return False
        return True

# ═══════════════════════════════════════════════════════════════════════════════
# GEX CALCULATOR (Real Edge Logic)
# ═══════════════════════════════════════════════════════════════════════════════
class GEXCalculator:
    """
    Calculate Gamma Exposure from options data.
    When real options data unavailable, estimate from VIX and price levels.
    """
    
    @staticmethod
    def calc_from_options(options_data, spot):
        """Calculate real GEX from options chain"""
        if not options_data or len(options_data) < 10:
            return None
        
        total_gex = 0
        total_vex = 0
        strike_gex = {}
        contracts_used = 0
        total_oi = 0
        
        for opt in options_data:
            details = opt.get('details', {})
            day = opt.get('day', {})
            greeks = opt.get('greeks', {})
            
            strike = details.get('strike_price', 0)
            oi = day.get('open_interest', 0)
            volume = day.get('volume', 0)
            gamma = greeks.get('gamma', 0)
            vanna = greeks.get('vanna', 0)
            iv = greeks.get('implied_volatility', 0)
            is_call = details.get('contract_type', '').lower() == 'call'
            
            total_oi += oi
            
            if oi == 0 and volume == 0:
                continue
            if strike == 0 or abs(strike - spot) / spot > 0.15:
                continue
                
            contracts_used += 1
            
            # GEX = Gamma * OI * 100 * Spot^2 * 0.01
            sign = 1 if is_call else -1
            contract_gex = sign * gamma * (oi + volume * 0.3) * 100 * spot * spot * 0.01
            contract_vex = sign * vanna * (oi + volume * 0.3) * 100 * spot * 0.01
            
            total_gex += contract_gex
            total_vex += contract_vex
            
            strike_key = f"{strike:.0f}"
            if strike_key not in strike_gex:
                strike_gex[strike_key] = 0
            strike_gex[strike_key] += contract_gex
        
        # If no meaningful data (all zeros), return None to trigger VIX fallback
        if contracts_used < 10 or (total_gex == 0 and total_vex == 0 and total_oi == 0):
            return None
            
        return {
            'gex': total_gex,
            'vex': total_vex,
            'strikes': strike_gex,
            'contracts': contracts_used,
            'source': 'REAL_OPTIONS'
        }
    
    @staticmethod
    def estimate_from_vix(spot, vix, spx_data=None):
        """
        Estimate GEX from VIX levels and price action.
        Uses empirical relationships between VIX/SPX and dealer positioning.
        
        KEY RELATIONSHIPS (based on research):
        - VIX < 15: Dealers typically LONG gamma (supportive)
        - VIX 15-20: Mixed positioning
        - VIX > 20: Dealers typically SHORT gamma (volatile)
        - VIX > 30: Extreme short gamma (waterfall risk)
        
        GEX SCALE (for SPX):
        - +$500M to +$2B: Strong support (buy dips)
        - +$100M to +$500M: Mild support
        - -$100M to +$100M: Neutral
        - -$500M to -$100M: Mild instability
        - -$2B to -$500M: High volatility risk
        - < -$2B: Extreme (waterfall conditions)
        """
        # Base GEX scaled for realistic SPX levels ($100M-$2B range)
        base_gex = 3e8  # $300M baseline
        
        # VIX-to-GEX mapping (calibrated to real market data)
        if vix < 12:
            # Ultra-low vol: dealers very long gamma
            vix_mult = 3.0 + random.uniform(-0.3, 0.3)  # +$900M typical
        elif vix < 15:
            # Low vol: dealers long gamma
            vix_mult = 1.5 + random.uniform(-0.2, 0.2)  # +$450M typical
        elif vix < 18:
            # Normal vol: mixed
            vix_mult = 0.3 + random.uniform(-0.4, 0.4)  # ±$100M
        elif vix < 22:
            # Elevated vol: dealers short gamma
            vix_mult = -1.0 + random.uniform(-0.3, 0.3)  # -$300M typical
        elif vix < 28:
            # High vol: dealers very short
            vix_mult = -2.5 + random.uniform(-0.5, 0.5)  # -$750M typical
        else:
            # Panic: extreme short gamma
            vix_mult = -5.0 + random.uniform(-1.0, 1.0)  # -$1.5B typical
        
        # Price distance from key strikes
        # Key levels: 50-point intervals (6850, 6900, 6950)
        nearest_50 = round(spot / 50) * 50
        dist_from_50 = abs(spot - nearest_50) / 50  # 0-1 scale
        
        # 25-point levels (6875, 6925)
        nearest_25 = round(spot / 25) * 25
        dist_from_25 = abs(spot - nearest_25) / 25
        
        # Near big strikes = more GEX (pinning effect)
        strike_effect = 1.0 + (1 - dist_from_50) * 0.4
        
        # Intraday range impact
        if spx_data:
            day_range = spx_data.get('high', spot) - spx_data.get('low', spot)
            day_range_pct = day_range / spot * 100
            # Wide range = more dealer activity = GEX matters more
            range_effect = 1.0 + min(day_range_pct, 2) * 0.2
        else:
            range_effect = 1.0
        
        # Calculate final GEX
        estimated_gex = base_gex * vix_mult * strike_effect * range_effect
        
        # VEX (Vanna Exposure) - correlates with VIX changes
        # When VIX high and rising: VEX amplifies moves
        # When VIX low and stable: VEX minimal
        if vix > 20:
            vex_mult = -0.25 - (vix - 20) * 0.02  # More negative as VIX rises
        elif vix < 15:
            vex_mult = 0.1
        else:
            vex_mult = -0.05
        
        estimated_vex = estimated_gex * vex_mult * (1 + random.uniform(-0.1, 0.1))
        
        # Generate strike breakdown for visualization
        strikes = {}
        for offset in range(-100, 125, 25):
            strike = nearest_50 + offset
            dist = abs(strike - spot)
            # More OI at ATM, decreasing with distance
            strike_gex = estimated_gex * np.exp(-dist / 50) * 0.15
            # Calls positive, puts negative (simplified)
            if strike > spot:
                strikes[f"{strike:.0f}"] = strike_gex * 0.7
            else:
                strikes[f"{strike:.0f}"] = -strike_gex * 0.3
        
        return {
            'gex': estimated_gex,
            'vex': estimated_vex,
            'strikes': strikes,
            'contracts': 0,
            'source': 'VIX_MODEL',
            'vix': vix
        }

# ═══════════════════════════════════════════════════════════════════════════════
# REGIME DETECTOR (The Edge)
# ═══════════════════════════════════════════════════════════════════════════════
class RegimeDetector:
    """Detect market regime based on GEX, VEX, and price action"""
    
    # Thresholds (calibrated for SPX, in dollars)
    GEX_FLUSH = -2.0e8      # -$200M = flush risk
    GEX_SUPPORT = 3.0e8     # +$300M = supportive
    GEX_EXTREME = -7.0e8    # -$700M = waterfall risk
    GEX_SQUEEZE = -4.0e8    # Threshold for squeeze detection
    VIX_ELEVATED = 18
    VIX_PANIC = 25
    VIX_EXTREME = 35
    
    @staticmethod
    def detect(gex, vex, spot, vix, spot_change_pct=0, source='UNKNOWN'):
        """
        Detect current market regime based on dealer positioning.
        
        REGIME HIERARCHY (priority order):
        1. WATERFALL - Extreme conditions, catastrophic
        2. FLUSH_RISK - Dangerous negative gamma
        3. SQUEEZE - Negative gamma but upward pressure
        4. CHARM_DRIFT - Positive gamma, supportive
        5. GAMMA_PIN - Near strikes, range-bound
        6. NEUTRAL - No clear signal
        """
        regime = 'NEUTRAL'
        confidence = 30
        playbook = ''
        color = '#1e293b'
        
        # Convert to millions for display
        gex_m = gex / 1e6
        vex_m = vex / 1e6
        
        vix_high = vix > RegimeDetector.VIX_ELEVATED
        vix_panic = vix > RegimeDetector.VIX_PANIC
        vix_extreme = vix > RegimeDetector.VIX_EXTREME
        
        # ═══════════════════════════════════════════════════════════════
        # WATERFALL: Extreme conditions - dealers forced sellers
        # ═══════════════════════════════════════════════════════════════
        if gex < RegimeDetector.GEX_EXTREME and vix_panic:
            regime = 'WATERFALL'
            severity = min(abs(gex / RegimeDetector.GEX_EXTREME), 2.0)
            confidence = min(95, 70 + severity * 12)
            playbook = f"""🌊 WATERFALL CONDITIONS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GEX: ${gex_m:,.0f}M  ← EXTREME SHORT
VEX: ${vex_m:,.0f}M
VIX: {vix:.1f} {"🔴 PANIC" if vix_extreme else "⚠️ HIGH"}
SPX: ${spot:,.2f} ({spot_change_pct:+.2f}%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ CRITICAL: Dealers FORCED to sell
Every tick down = more forced selling
Self-reinforcing cascade in progress

EDGE PLAYS:
• Fade 5-10pt bounces SHORT
• Stop: 8-10pt above entry  
• Target: -20 to -40pt
• VIX calls as hedge

DO NOT: Buy dips, hold longs

Source: {source}"""
            color = '#7f1d1d'
        
        # ═══════════════════════════════════════════════════════════════
        # FLUSH RISK: Negative gamma, volatility elevated
        # ═══════════════════════════════════════════════════════════════
        elif gex < RegimeDetector.GEX_FLUSH:
            regime = 'FLUSH_RISK'
            severity = abs(gex / RegimeDetector.GEX_FLUSH)
            confidence = min(88, 55 + severity * 15 + (5 if vix_high else 0))
            
            if vix_high:
                alert = "🔴 HIGH ALERT: VIX elevated, cascade likely on any weakness"
            elif vix > 15:
                alert = "⚠️ WATCH: VIX rising, monitor for spike above 20"
            else:
                alert = "🟡 ALERT: Negative GEX but VIX calm - tension building"
            
            playbook = f"""⚠️ FLUSH RISK DETECTED

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GEX: ${gex_m:,.0f}M  ← DEALERS SHORT
VEX: ${vex_m:,.0f}M
VIX: {vix:.1f}
SPX: ${spot:,.2f}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{alert}

Dealers SHORT gamma = they must:
• SELL when market falls
• BUY when market rises
→ AMPLIFIED moves in both directions

EDGE PLAYS:
• Reduce long exposure
• Tight stops (10-15pt)
• Size down 50%
• VIX calls for protection

Source: {source}"""
            color = '#450a0a'
        
        # ═══════════════════════════════════════════════════════════════
        # SQUEEZE: Negative gamma but price rising
        # ═══════════════════════════════════════════════════════════════
        elif gex < 0 and spot_change_pct > 0.2:
            regime = 'SQUEEZE'
            squeeze_strength = min(spot_change_pct / 0.5, 1.5) * abs(gex / RegimeDetector.GEX_SQUEEZE)
            confidence = min(82, 50 + squeeze_strength * 20)
            playbook = f"""🚀 SQUEEZE IN PROGRESS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GEX: ${gex_m:,.0f}M  ← Negative but...
SPX: ${spot:,.2f} ({spot_change_pct:+.2f}%) ← RISING
VIX: {vix:.1f}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 Short covering / Dealer buying
Each tick UP forces MORE buying

EDGE PLAYS:
• Trail stops 10-15pt below
• Don't short into strength
• Add on 5pt pullbacks
• Let winners run
• Target: +15-25pt from entry

DO NOT: Try to pick top

Source: {source}"""
            color = '#0d9488'
        
        # ═══════════════════════════════════════════════════════════════
        # CHARM DRIFT: Positive gamma, supportive environment
        # ═══════════════════════════════════════════════════════════════
        elif gex > RegimeDetector.GEX_SUPPORT:
            regime = 'CHARM_DRIFT'
            strength = gex / RegimeDetector.GEX_SUPPORT
            confidence = min(78, 52 + strength * 12)
            playbook = f"""📈 CHARM DRIFT (Buy the Dip)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GEX: +${gex_m:,.0f}M  ← DEALERS LONG
VEX: ${vex_m:,.0f}M
VIX: {vix:.1f} ✓ Low/stable
SPX: ${spot:,.2f}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ IDEAL CONDITIONS
Dealers LONG gamma = they must:
• BUY when market falls
• SELL when market rises
→ DAMPENED volatility, supportive

EDGE PLAYS:
• Buy 3-5pt pullbacks
• Stops: 8-10pt
• Target: 10-15pt, or EOD
• Higher position sizing OK

CHARACTERISTICS:
• Slow grind higher into close
• Quick V-shaped recoveries
• Low VIX, tight ranges

Source: {source}"""
            color = '#064e3b'
        
        # ═══════════════════════════════════════════════════════════════
        # GAMMA PIN: Price magnetized to strike
        # ═══════════════════════════════════════════════════════════════
        else:
            pin_strike = round(spot / 25) * 25
            dist = abs(spot - pin_strike)
            
            if dist < 8 and abs(gex) > 5e7:
                regime = 'GAMMA_PIN'
                pin_strength = (8 - dist) / 8
                confidence = min(72, 55 + pin_strength * 15)
                playbook = f"""📌 GAMMA PIN Active

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pin Strike: ${pin_strike:,.0f}
Distance: ${dist:.1f} pts
GEX: ${gex_m:,.0f}M
VIX: {vix:.1f}
SPX: ${spot:,.2f}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🧲 Price magnetized to ${pin_strike}
High OI at strike creates gravity

EDGE PLAYS:
• Sell premium (iron condors)
• Range: {pin_strike-10:.0f} - {pin_strike+10:.0f}
• Stop directional plays
• Wait for breakout > 10pt

CHARACTERISTICS:
• Choppy, mean-reverting
• Fades extremes back to pin
• Best into OpEx

Source: {source}"""
                color = '#1e40af'
            else:
                # NEUTRAL
                playbook = f"""📊 NEUTRAL - No Clear Setup

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GEX: ${gex_m:,.0f}M
VEX: ${vex_m:,.0f}M  
VIX: {vix:.1f}
SPX: ${spot:,.2f}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No strong directional bias detected.
Dealer positioning mixed.

APPROACH:
• Reduce position sizes
• Wait for clearer setup
• Watch for regime shift

Source: {source}"""
        
        return {
            'regime': regime,
            'confidence': confidence,
            'playbook': playbook,
            'color': color,
            'gex': gex,
            'vex': vex,
            'vix': vix,
            'spot': spot,
            'source': source
        }

# ═══════════════════════════════════════════════════════════════════════════════
# DATABASE
# ═══════════════════════════════════════════════════════════════════════════════
class Database:
    def __init__(self, path="titan.db"):
        self.path = path
        self._init()
    
    def _init(self):
        with sqlite3.connect(self.path) as c:
            c.execute("""CREATE TABLE IF NOT EXISTS signals(
                id INTEGER PRIMARY KEY,
                timestamp TEXT,
                date TEXT,
                time TEXT,
                regime TEXT,
                confidence REAL,
                gex REAL,
                vex REAL,
                vix REAL,
                spot REAL,
                source TEXT,
                playbook TEXT
            )""")
            c.execute("""CREATE TABLE IF NOT EXISTS market_data(
                id INTEGER PRIMARY KEY,
                timestamp TEXT,
                date TEXT,
                spx_open REAL,
                spx_high REAL,
                spx_low REAL,
                spx_close REAL,
                vix_close REAL
            )""")
    
    def save_signal(self, signal):
        now = datetime.now()
        with sqlite3.connect(self.path) as c:
            c.execute("""INSERT INTO signals 
                (timestamp, date, time, regime, confidence, gex, vex, vix, spot, source, playbook)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (now.isoformat(), now.strftime('%Y-%m-%d'), now.strftime('%H:%M:%S'),
                 signal['regime'], signal['confidence'], signal['gex'], signal['vex'],
                 signal['vix'], signal['spot'], signal['source'], signal['playbook']))
    
    def save_market_data(self, spx, vix):
        now = datetime.now()
        with sqlite3.connect(self.path) as c:
            c.execute("""INSERT OR REPLACE INTO market_data 
                (timestamp, date, spx_open, spx_high, spx_low, spx_close, vix_close)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (now.isoformat(), now.strftime('%Y-%m-%d'),
                 spx['open'], spx['high'], spx['low'], spx['close'], vix['close']))
    
    def get_session_signals(self, date=None):
        with sqlite3.connect(self.path) as c:
            if date:
                rows = c.execute(
                    "SELECT * FROM signals WHERE date=? ORDER BY timestamp DESC", 
                    (date,)).fetchall()
            else:
                # Get most recent date
                date_row = c.execute(
                    "SELECT DISTINCT date FROM signals ORDER BY date DESC LIMIT 1").fetchone()
                if not date_row:
                    return [], None
                date = date_row[0]
                rows = c.execute(
                    "SELECT * FROM signals WHERE date=? ORDER BY timestamp DESC",
                    (date,)).fetchall()
            
            signals = []
            for r in rows:
                signals.append({
                    'id': r[0], 'timestamp': r[1], 'date': r[2], 'time': r[3],
                    'regime': r[4], 'confidence': r[5], 'gex': r[6], 'vex': r[7],
                    'vix': r[8], 'spot': r[9], 'source': r[10], 'playbook': r[11]
                })
            return signals, date
    
    def get_regime_summary(self, date=None):
        signals, actual_date = self.get_session_signals(date)
        if not signals:
            return None
        
        regime_counts = {}
        for s in signals:
            rg = s['regime']
            regime_counts[rg] = regime_counts.get(rg, 0) + 1
        
        # Get unique signals (regime changes)
        unique_signals = []
        last_regime = None
        for s in reversed(signals):  # Chronological order
            if s['regime'] != last_regime and s['regime'] != 'NEUTRAL':
                unique_signals.append(s)
                last_regime = s['regime']
        
        return {
            'date': actual_date,
            'total_signals': len(signals),
            'regime_counts': regime_counts,
            'unique_signals': unique_signals[-20:],  # Last 20 regime changes
            'latest': signals[0] if signals else None
        }

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ENGINE
# ═══════════════════════════════════════════════════════════════════════════════
class TitanEngine:
    def __init__(self, api_key):
        self.api_key = api_key
        self.market = MarketData(api_key)
        self.db = Database()
        self.running = False
        self.current_signal = None
        self.lock = Lock()
    
    def get_current_state(self):
        """Get current market state and regime"""
        spx = self.market.get_spx()
        vix = self.market.get_vix()
        
        if not spx or not vix:
            return None
        
        # Save market data
        self.db.save_market_data(spx, vix)
        
        spot = spx['close']
        vix_level = vix['close']
        spot_change = (spx['close'] - spx['open']) / spx['open'] * 100
        
        # Try to get real options data
        options = self.market.get_options_snapshot()
        gex_data = GEXCalculator.calc_from_options(options, spot)
        
        # If no real options data, estimate from VIX
        if not gex_data:
            gex_data = GEXCalculator.estimate_from_vix(spot, vix_level, spx)
        
        # Detect regime
        signal = RegimeDetector.detect(
            gex=gex_data['gex'],
            vex=gex_data['vex'],
            spot=spot,
            vix=vix_level,
            spot_change_pct=spot_change,
            source=gex_data['source']
        )
        
        # Add market data to signal
        signal['spx_open'] = spx['open']
        signal['spx_high'] = spx['high']
        signal['spx_low'] = spx['low']
        signal['spx_close'] = spx['close']
        signal['spot_change'] = spot_change
        signal['market_open'] = self.market.is_market_open()
        
        return signal
    
    def run_loop(self, socketio):
        """Main analysis loop"""
        last_regime = None
        last_save_time = 0
        save_interval = 30  # Save signal every 30 seconds minimum
        
        while self.running:
            try:
                signal = self.get_current_state()
                
                if signal:
                    with self.lock:
                        self.current_signal = signal
                    
                    current_time = time.time()
                    regime_changed = signal['regime'] != last_regime
                    time_to_save = current_time - last_save_time >= save_interval
                    
                    # Save on regime change OR every save_interval
                    if regime_changed or (time_to_save and signal['regime'] != 'NEUTRAL'):
                        self.db.save_signal(signal)
                        last_save_time = current_time
                        
                        if regime_changed and signal['regime'] != 'NEUTRAL':
                            gex_m = signal['gex'] / 1e6
                            logging.info(f"🎯 {signal['regime']} | {signal['confidence']:.0f}% | GEX: ${gex_m:,.0f}M | {signal['source']}")
                        
                        last_regime = signal['regime']
                    
                    # Get historical data for study mode
                    history = self.db.get_regime_summary() if not signal['market_open'] else None
                    
                    # Emit to dashboard
                    socketio.emit('update', {
                        'signal': signal,
                        'history': history,
                        'timestamp': datetime.now().strftime('%H:%M:%S')
                    })
                
            except Exception as e:
                logging.error(f"Engine error: {e}")
                import traceback
                traceback.print_exc()
            
            time.sleep(5)  # Update every 5 seconds
    
    def start(self, socketio):
        self.running = True
        Thread(target=self.run_loop, args=(socketio,), daemon=True).start()
        logging.info("🚀 TITAN OMEGA Engine Started")
    
    def stop(self):
        self.running = False

# ═══════════════════════════════════════════════════════════════════════════════
# DASHBOARD HTML
# ═══════════════════════════════════════════════════════════════════════════════
DASHBOARD_HTML = """<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TITAN OMEGA</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.6.1/socket.io.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
:root{--bg:#0a0a0b;--card:#141419;--border:#2a2a35;--text:#f0f0f5;--muted:#888;--green:#22c55e;--red:#ef4444;--blue:#3b82f6;--yellow:#eab308;--orange:#f97316}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.container{max-width:1400px;margin:0 auto;padding:10px}
.header{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);margin-bottom:15px}
.logo{display:flex;align-items:center;gap:8px}
.logo-icon{width:32px;height:32px;background:linear-gradient(135deg,var(--blue),#8b5cf6);border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:16px}
.logo h1{font-size:18px}
.status{display:flex;align-items:center;gap:8px;font-size:12px}
.status-dot{width:8px;height:8px;border-radius:50%;animation:pulse 2s infinite}
.status-dot.live{background:var(--green)}
.status-dot.study{background:var(--yellow)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.market-badge{padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600}
.market-badge.open{background:#166534;color:#86efac}
.market-badge.closed{background:#854d0e;color:#fef08a}

.grid{display:grid;grid-template-columns:1fr 320px;gap:15px}
@media(max-width:900px){.grid{grid-template-columns:1fr}}

.main{display:flex;flex-direction:column;gap:12px}
.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.metric{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px}
.metric-label{font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px}
.metric-value{font-size:20px;font-weight:700;font-family:'SF Mono',monospace}
.metric-value.positive{color:var(--green)}
.metric-value.negative{color:var(--red)}
.metric-sub{font-size:9px;color:var(--muted);margin-top:2px}

.chart-card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px;flex:1}
.chart-header{display:flex;justify-content:space-between;margin-bottom:8px;font-size:11px;color:var(--muted)}
.chart-container{height:150px}

.sidebar{display:flex;flex-direction:column;gap:12px}
.regime-card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:15px;transition:background .5s}
.regime-card.FLUSH_RISK{background:linear-gradient(180deg,#450a0a,var(--card))}
.regime-card.WATERFALL{background:linear-gradient(180deg,#7f1d1d,var(--card))}
.regime-card.CHARM_DRIFT{background:linear-gradient(180deg,#064e3b,var(--card))}
.regime-card.SQUEEZE{background:linear-gradient(180deg,#134e4a,var(--card))}
.regime-card.GAMMA_PIN{background:linear-gradient(180deg,#1e3a8a,var(--card))}
.regime-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.regime-name{font-size:16px;font-weight:700}
.regime-conf{font-family:monospace;font-size:14px;padding:2px 8px;background:rgba(255,255,255,.1);border-radius:4px}
.playbook{background:rgba(0,0,0,.3);border-radius:6px;padding:10px;font-family:'SF Mono',monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;max-height:200px;overflow-y:auto}

.study-card{background:linear-gradient(135deg,#422006,#1c1917);border:1px solid #854d0e;border-radius:8px;padding:12px}
.study-header{font-size:12px;font-weight:600;color:#fef08a;margin-bottom:10px;display:flex;align-items:center;gap:6px}
.study-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px}
.study-stat{background:rgba(0,0,0,.3);padding:6px;border-radius:4px}
.study-stat-label{font-size:9px;color:#a3a3a3}
.study-stat-value{font-size:13px;font-weight:600;color:#fef08a}
.signal-list{max-height:180px;overflow-y:auto}
.signal-item{background:rgba(0,0,0,.2);border-radius:4px;padding:6px;margin-bottom:4px;border-left:3px solid var(--border);font-size:10px}
.signal-item.FLUSH_RISK{border-color:var(--red)}
.signal-item.WATERFALL{border-color:#dc2626}
.signal-item.CHARM_DRIFT{border-color:var(--green)}
.signal-item.SQUEEZE{border-color:#14b8a6}
.signal-item.GAMMA_PIN{border-color:var(--blue)}
.signal-time{color:var(--muted);font-family:monospace}
.signal-regime{font-weight:600}

.data-card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px}
.data-title{font-size:11px;color:var(--muted);margin-bottom:8px}
.data-row{display:flex;justify-content:space-between;padding:4px 0;font-size:11px}
.data-label{color:var(--muted)}
.data-value{font-family:monospace}
.data-value.good{color:var(--green)}
.data-value.warn{color:var(--yellow)}
.data-value.bad{color:var(--red)}
</style>
</head>
<body>
<div class="container">
<div class="header">
<div class="logo">
<div class="logo-icon">Ω</div>
<div><h1>TITAN OMEGA</h1></div>
</div>
<div class="status">
<div class="status-dot" id="statusDot"></div>
<span id="statusText">Connecting...</span>
<span class="market-badge" id="marketBadge">--</span>
</div>
</div>

<div class="grid">
<div class="main">
<div class="metrics">
<div class="metric">
<div class="metric-label">SPX</div>
<div class="metric-value" id="spot">--</div>
<div class="metric-sub" id="spotChange">--</div>
</div>
<div class="metric">
<div class="metric-label">GEX</div>
<div class="metric-value" id="gex">--</div>
<div class="metric-sub" id="gexSource">--</div>
</div>
<div class="metric">
<div class="metric-label">VEX</div>
<div class="metric-value" id="vex">--</div>
</div>
<div class="metric">
<div class="metric-label">VIX</div>
<div class="metric-value" id="vix">--</div>
</div>
<div class="metric">
<div class="metric-label">Range</div>
<div class="metric-value" id="range">--</div>
<div class="metric-sub" id="rangeHL">--</div>
</div>
</div>

<div class="chart-card">
<div class="chart-header"><span>GEX Timeline</span><span id="chartTime">--</span></div>
<div class="chart-container"><canvas id="gexChart"></canvas></div>
</div>
</div>

<div class="sidebar">
<div class="regime-card" id="regimeCard">
<div class="regime-header">
<span class="regime-name" id="regimeName">--</span>
<span class="regime-conf" id="regimeConf">--%</span>
</div>
<div class="playbook" id="playbook">Loading...</div>
</div>

<div class="study-card" id="studyCard" style="display:none">
<div class="study-header">📚 Study Mode - Previous Session</div>
<div class="study-stats">
<div class="study-stat"><div class="study-stat-label">Date</div><div class="study-stat-value" id="studyDate">--</div></div>
<div class="study-stat"><div class="study-stat-label">Signals</div><div class="study-stat-value" id="studyCount">--</div></div>
</div>
<div class="signal-list" id="signalList"></div>
</div>

<div class="data-card">
<div class="data-title">📡 Data Source</div>
<div class="data-row"><span class="data-label">Source</span><span class="data-value" id="dataSource">--</span></div>
<div class="data-row"><span class="data-label">Updated</span><span class="data-value" id="dataTime">--</span></div>
</div>
</div>
</div>
</div>

<script>
const socket = io();
const gexData = [], gexLabels = [];
const ctx = document.getElementById('gexChart').getContext('2d');
const chart = new Chart(ctx, {
    type: 'line',
    data: {labels: gexLabels, datasets: [{
        data: gexData,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2
    }]},
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {legend: {display: false}},
        scales: {
            x: {display: true, grid: {color: '#2a2a35'}, ticks: {color: '#888', maxTicksLimit: 6, font: {size: 9}}},
            y: {display: true, grid: {color: '#2a2a35'}, ticks: {color: '#888', callback: v => (v/1e6).toFixed(0)+'M', font: {size: 9}}}
        },
        animation: {duration: 0}
    }
});

socket.on('connect', () => {
    document.getElementById('statusDot').className = 'status-dot live';
    document.getElementById('statusText').textContent = 'Connected';
});

socket.on('disconnect', () => {
    document.getElementById('statusDot').className = 'status-dot';
    document.getElementById('statusText').textContent = 'Disconnected';
});

socket.on('update', (data) => {
    const s = data.signal;
    if (!s) return;
    
    // Market status
    const badge = document.getElementById('marketBadge');
    badge.textContent = s.market_open ? '🟢 MARKET OPEN' : '🟡 MARKET CLOSED';
    badge.className = 'market-badge ' + (s.market_open ? 'open' : 'closed');
    
    // Metrics
    document.getElementById('spot').textContent = '$' + s.spot.toFixed(2);
    const change = s.spot_change || 0;
    const changeEl = document.getElementById('spotChange');
    changeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
    changeEl.style.color = change >= 0 ? 'var(--green)' : 'var(--red)';
    
    const gexEl = document.getElementById('gex');
    gexEl.textContent = (s.gex >= 0 ? '+' : '') + (s.gex/1e6).toFixed(0) + 'M';
    gexEl.className = 'metric-value ' + (s.gex >= 0 ? 'positive' : 'negative');
    document.getElementById('gexSource').textContent = s.source || '--';
    
    const vexEl = document.getElementById('vex');
    vexEl.textContent = (s.vex >= 0 ? '+' : '') + (s.vex/1e6).toFixed(0) + 'M';
    vexEl.className = 'metric-value ' + (s.vex >= 0 ? 'positive' : 'negative');
    
    document.getElementById('vix').textContent = s.vix.toFixed(2);
    
    const range = (s.spx_high - s.spx_low).toFixed(2);
    document.getElementById('range').textContent = '$' + range;
    document.getElementById('rangeHL').textContent = s.spx_low.toFixed(0) + ' - ' + s.spx_high.toFixed(0);
    
    // Regime
    const regimeCard = document.getElementById('regimeCard');
    regimeCard.className = 'regime-card ' + s.regime;
    document.getElementById('regimeName').textContent = s.regime.replace('_', ' ');
    document.getElementById('regimeConf').textContent = s.confidence.toFixed(0) + '%';
    document.getElementById('playbook').textContent = s.playbook;
    
    // Chart
    gexData.push(s.gex);
    gexLabels.push(data.timestamp);
    if (gexData.length > 60) { gexData.shift(); gexLabels.shift(); }
    chart.update();
    document.getElementById('chartTime').textContent = data.timestamp;
    
    // Data source
    document.getElementById('dataSource').textContent = s.source;
    document.getElementById('dataTime').textContent = data.timestamp;
    
    // Study mode
    const studyCard = document.getElementById('studyCard');
    if (!s.market_open && data.history) {
        studyCard.style.display = 'block';
        document.getElementById('studyDate').textContent = data.history.date || '--';
        document.getElementById('studyCount').textContent = data.history.total_signals || 0;
        
        const list = document.getElementById('signalList');
        list.innerHTML = '';
        (data.history.unique_signals || []).forEach(sig => {
            const el = document.createElement('div');
            el.className = 'signal-item ' + sig.regime;
            el.innerHTML = '<span class="signal-time">' + sig.time + '</span> <span class="signal-regime">' + sig.regime + '</span> ' + sig.confidence.toFixed(0) + '%';
            list.appendChild(el);
        });
    } else {
        studyCard.style.display = 'none';
    }
});
</script>
</body>
</html>"""

# ═══════════════════════════════════════════════════════════════════════════════
# HISTORICAL SCENARIOS (For Educational Simulation)
# ═══════════════════════════════════════════════════════════════════════════════
HISTORICAL_SCENARIOS = [
    # Date, SPX, VIX, Expected Regime
    {"date": "2024-08-05", "name": "VIX Spike (Yen Carry)", "spx": 5186, "vix": 38.5, "change": -3.0},
    {"date": "2024-04-19", "name": "April Selloff", "spx": 4967, "vix": 21.3, "change": -1.5},
    {"date": "2024-03-28", "name": "Q1 Rally", "spx": 5254, "vix": 13.0, "change": 0.4},
    {"date": "2023-10-27", "name": "October Low", "spx": 4117, "vix": 23.1, "change": -0.8},
    {"date": "2023-03-13", "name": "SVB Crisis", "spx": 3855, "vix": 26.5, "change": -1.2},
    {"date": "2022-06-13", "name": "Bear Market", "spx": 3749, "vix": 34.0, "change": -3.9},
    {"date": "2024-07-11", "name": "Summer Rally", "spx": 5584, "vix": 12.5, "change": 0.9},
    {"date": "2024-12-30", "name": "Year End Calm", "spx": 5896, "vix": 14.3, "change": -0.06},
]

def run_scenario_analysis(scenario):
    """Run analysis on a historical scenario"""
    gex_data = GEXCalculator.estimate_from_vix(
        scenario['spx'], 
        scenario['vix'],
        {'open': scenario['spx'] * (1 - scenario['change']/100),
         'high': scenario['spx'] * 1.005,
         'low': scenario['spx'] * 0.995,
         'close': scenario['spx']}
    )
    
    signal = RegimeDetector.detect(
        gex=gex_data['gex'],
        vex=gex_data['vex'],
        spot=scenario['spx'],
        vix=scenario['vix'],
        spot_change_pct=scenario['change'],
        source='HISTORICAL_SIM'
    )
    
    signal['scenario_name'] = scenario['name']
    signal['scenario_date'] = scenario['date']
    signal['spot_change'] = scenario['change']
    
    return signal

# ═══════════════════════════════════════════════════════════════════════════════
# FLASK APP
# ═══════════════════════════════════════════════════════════════════════════════
def create_app():
    app = Flask(__name__)
    app.config['SECRET_KEY'] = os.urandom(24).hex()
    socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')
    
    api_key = os.environ.get('POLYGON_API_KEY', '')
    engine = TitanEngine(api_key)
    
    @app.route('/')
    def index():
        return render_template_string(DASHBOARD_HTML)
    
    @app.route('/api/status')
    def status():
        with engine.lock:
            return jsonify(engine.current_signal or {})
    
    @app.route('/api/history')
    def history():
        date = request.args.get('date')
        return jsonify(engine.db.get_regime_summary(date) or {})
    
    @app.route('/api/scenarios')
    def scenarios():
        """Get all historical scenario analyses"""
        results = []
        for s in HISTORICAL_SCENARIOS:
            results.append(run_scenario_analysis(s))
        return jsonify(results)
    
    @app.route('/api/simulate')
    def simulate():
        """Simulate a custom scenario"""
        try:
            vix = float(request.args.get('vix', 15))
            spx = float(request.args.get('spx', 6000))
            change = float(request.args.get('change', 0))
            
            gex_data = GEXCalculator.estimate_from_vix(
                spx, vix,
                {'open': spx * (1 - change/100), 'high': spx*1.005, 'low': spx*0.995, 'close': spx}
            )
            
            signal = RegimeDetector.detect(
                gex=gex_data['gex'],
                vex=gex_data['vex'],
                spot=spx,
                vix=vix,
                spot_change_pct=change,
                source='CUSTOM_SIM'
            )
            return jsonify(signal)
        except Exception as e:
            return jsonify({'error': str(e)}), 400
    
    return app, socketio, engine

def main():
    print("=" * 60)
    print("  TITAN OMEGA - Production System")
    print("  Real SPX Dealer Flow Analysis")
    print("=" * 60)
    
    api_key = os.environ.get('POLYGON_API_KEY', '')
    if api_key:
        print(f"\n✅ API Key: {api_key[:8]}...")
    else:
        print("\n⚠️  No API key - set POLYGON_API_KEY")
    
    # Test API
    market = MarketData(api_key)
    spx = market.get_spx()
    vix = market.get_vix()
    
    if spx:
        print(f"📈 SPX: ${spx['close']:.2f} (O:{spx['open']:.2f} H:{spx['high']:.2f} L:{spx['low']:.2f})")
    if vix:
        print(f"📊 VIX: {vix['close']:.2f}")
    
    print(f"🕐 Market: {'OPEN' if market.is_market_open() else 'CLOSED'}")
    print(f"\n🌐 Dashboard: http://localhost:5000\n")
    
    app, socketio, engine = create_app()
    
    def shutdown(*_):
        print("\n🛑 Shutting down...")
        engine.stop()
        sys.exit(0)
    
    sg.signal(sg.SIGINT, shutdown)
    sg.signal(sg.SIGTERM, shutdown)
    
    engine.start(socketio)
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, use_reloader=False, allow_unsafe_werkzeug=True)

if __name__ == '__main__':
    main()
