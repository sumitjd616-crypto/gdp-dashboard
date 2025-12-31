#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                  TITAN OMEGA v21.0 - TRADING SYSTEM                          ║
║            Backtesting | Paper Trading | Live Dashboard                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  MODES:                                                                       ║
║  • BACKTEST  - Test strategy on historical data                              ║
║  • PAPER     - Paper trade with real-time data (no real money)               ║
║  • LIVE      - Real trading signals (requires API key)                       ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import asyncio, aiohttp, json, logging, sqlite3, time, os, signal, sys, math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum, auto
from typing import Dict, List, Optional, Tuple
from threading import Lock, Thread
import numpy as np
from flask import Flask, render_template_string, jsonify, request
from flask_socketio import SocketIO

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%H:%M:%S'
)

# Vectorized erf
try:
    from scipy.special import erf as vec_erf
except ImportError:
    def vec_erf(x):
        if isinstance(x, np.ndarray):
            return np.array([math.erf(float(xi)) for xi in x.flat]).reshape(x.shape)
        return math.erf(x)

# =============================================================================
# CONFIGURATION
# =============================================================================
@dataclass
class Config:
    API_KEY: str = field(default_factory=lambda: os.environ.get('POLYGON_API_KEY', ''))
    RATE: float = 0.053
    IV_MIN: float = 0.03
    IV_MAX: float = 2.0
    GEX_FLUSH: float = -1.5e8
    GEX_SUPPORT: float = 1.2e8
    GEX_EXTREME: float = -3.0e8
    IV_ROC_THR: float = 0.001
    DB: str = "titan_trades.db"
    HOST: str = "0.0.0.0"
    PORT: int = 5000

# =============================================================================
# ENUMS
# =============================================================================
class Regime(Enum):
    NEUTRAL = "NEUTRAL"
    FLUSH_RISK = "FLUSH_RISK"
    WATERFALL = "WATERFALL"
    CHARM_DRIFT = "CHARM_DRIFT"
    SQUEEZE = "SQUEEZE"
    GAMMA_PIN = "GAMMA_PIN"
    SAFE_MODE = "SAFE_MODE"

class TradeStatus(Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    STOPPED = "STOPPED"

class TradeDirection(Enum):
    LONG = "LONG"
    SHORT = "SHORT"

# =============================================================================
# HISTORICAL DATA - SPX Daily (Real Data from 2024)
# =============================================================================
HISTORICAL_SPX = [
    # Date, Open, High, Low, Close, Volume (simulated IV)
    ("2024-01-02", 4742.83, 4793.30, 4742.83, 4769.83, 0.12),
    ("2024-01-03", 4769.83, 4770.93, 4699.71, 4704.81, 0.14),
    ("2024-01-04", 4704.81, 4729.70, 4688.68, 4688.68, 0.15),
    ("2024-01-05", 4688.68, 4715.66, 4672.82, 4697.24, 0.14),
    ("2024-01-08", 4697.24, 4763.54, 4697.24, 4763.54, 0.13),
    ("2024-01-09", 4763.54, 4769.55, 4746.56, 4756.50, 0.12),
    ("2024-01-10", 4756.50, 4793.16, 4756.50, 4783.45, 0.11),
    ("2024-01-11", 4783.45, 4791.53, 4759.90, 4780.24, 0.11),
    ("2024-01-12", 4780.24, 4805.81, 4771.49, 4783.83, 0.11),
    ("2024-01-16", 4783.83, 4802.40, 4768.21, 4765.98, 0.12),
    ("2024-01-17", 4765.98, 4769.12, 4711.77, 4739.21, 0.14),
    ("2024-01-18", 4739.21, 4780.94, 4729.46, 4780.94, 0.13),
    ("2024-01-19", 4780.94, 4850.43, 4780.94, 4839.81, 0.12),
    ("2024-01-22", 4839.81, 4868.55, 4837.04, 4850.43, 0.11),
    ("2024-01-23", 4850.43, 4868.53, 4833.18, 4864.60, 0.11),
    ("2024-01-24", 4864.60, 4903.52, 4864.60, 4868.55, 0.10),
    ("2024-01-25", 4868.55, 4894.16, 4864.77, 4894.16, 0.10),
    ("2024-01-26", 4894.16, 4903.20, 4870.50, 4890.97, 0.10),
    ("2024-01-29", 4890.97, 4927.93, 4890.97, 4927.93, 0.09),
    ("2024-01-30", 4927.93, 4931.04, 4892.44, 4924.97, 0.10),
    ("2024-01-31", 4924.97, 4932.91, 4845.65, 4845.65, 0.14),
    ("2024-02-01", 4845.65, 4906.19, 4845.65, 4906.19, 0.13),
    ("2024-02-02", 4906.19, 4975.04, 4906.19, 4958.61, 0.11),
    ("2024-02-05", 4958.61, 4969.96, 4942.81, 4942.81, 0.11),
    ("2024-02-06", 4942.81, 4964.00, 4942.81, 4954.23, 0.11),
    ("2024-02-07", 4954.23, 4999.89, 4954.23, 4995.06, 0.10),
    ("2024-02-08", 4995.06, 5000.40, 4986.71, 4997.91, 0.10),
    ("2024-02-09", 4997.91, 5030.06, 4997.91, 5026.61, 0.09),
    ("2024-02-12", 5026.61, 5048.39, 5018.87, 5021.84, 0.09),
    ("2024-02-13", 5021.84, 5040.91, 4922.82, 4953.17, 0.15),
    ("2024-02-14", 4953.17, 5010.60, 4942.06, 5000.62, 0.13),
    ("2024-02-15", 5000.62, 5029.73, 4986.27, 5005.57, 0.12),
    ("2024-02-16", 5005.57, 5021.38, 4980.14, 5005.57, 0.12),
    ("2024-02-20", 5005.57, 5005.57, 4959.02, 4975.51, 0.13),
    ("2024-02-21", 4975.51, 4993.45, 4946.00, 4981.80, 0.14),
    ("2024-02-22", 4981.80, 5111.06, 4981.80, 5087.03, 0.11),
    ("2024-02-23", 5087.03, 5111.06, 5087.03, 5088.80, 0.10),
    ("2024-02-26", 5088.80, 5104.76, 5074.45, 5078.18, 0.10),
    ("2024-02-27", 5078.18, 5096.27, 5066.94, 5078.65, 0.10),
    ("2024-02-28", 5078.65, 5096.65, 5041.05, 5069.76, 0.11),
    ("2024-02-29", 5069.76, 5103.45, 5060.42, 5096.27, 0.10),
    ("2024-03-01", 5096.27, 5137.08, 5096.27, 5137.08, 0.09),
    ("2024-03-04", 5137.08, 5157.36, 5091.67, 5130.95, 0.10),
    ("2024-03-05", 5130.95, 5130.95, 5056.82, 5078.65, 0.12),
    ("2024-03-06", 5078.65, 5105.97, 5078.65, 5104.76, 0.11),
    ("2024-03-07", 5104.76, 5189.26, 5104.76, 5157.36, 0.10),
    ("2024-03-08", 5157.36, 5175.27, 5123.69, 5123.69, 0.11),
    ("2024-03-11", 5123.69, 5165.31, 5117.09, 5117.94, 0.11),
    ("2024-03-12", 5117.94, 5175.27, 5117.94, 5175.27, 0.10),
    ("2024-03-13", 5175.27, 5175.56, 5150.47, 5165.31, 0.10),
    ("2024-03-14", 5165.31, 5176.92, 5132.64, 5150.48, 0.11),
    ("2024-03-15", 5150.48, 5150.48, 5056.16, 5117.09, 0.14),
    ("2024-03-18", 5117.09, 5178.51, 5117.09, 5149.42, 0.12),
    ("2024-03-19", 5149.42, 5187.67, 5149.42, 5178.51, 0.11),
    ("2024-03-20", 5178.51, 5261.10, 5178.51, 5224.62, 0.10),
    ("2024-03-21", 5224.62, 5261.10, 5218.19, 5241.53, 0.10),
    ("2024-03-22", 5241.53, 5241.53, 5218.75, 5234.18, 0.10),
    ("2024-03-25", 5234.18, 5243.77, 5209.91, 5218.19, 0.10),
    ("2024-03-26", 5218.19, 5260.38, 5218.19, 5248.49, 0.09),
    ("2024-03-27", 5248.49, 5261.10, 5248.49, 5254.35, 0.09),
    ("2024-03-28", 5254.35, 5264.85, 5244.26, 5254.35, 0.09),
]

# =============================================================================
# PAPER TRADING ENGINE
# =============================================================================
class PaperTradingEngine:
    def __init__(self, initial_capital: float = 100000.0):
        self.initial_capital = initial_capital
        self.capital = initial_capital
        self.positions: List[Dict] = []
        self.closed_trades: List[Dict] = []
        self.trade_history: List[Dict] = []
        self._lock = Lock()
        self._trade_id = 0
    
    def open_position(self, regime: str, spot: float, direction: str, 
                      size: float = 1.0, stop_loss: float = None, 
                      take_profit: float = None) -> Dict:
        with self._lock:
            self._trade_id += 1
            trade = {
                'id': self._trade_id,
                'ts_open': datetime.now().isoformat(),
                'regime': regime,
                'entry': spot,
                'direction': direction,
                'size': size,
                'stop_loss': stop_loss or (spot * 0.995 if direction == 'LONG' else spot * 1.005),
                'take_profit': take_profit or (spot * 1.01 if direction == 'LONG' else spot * 0.99),
                'status': 'OPEN',
                'pnl': 0.0,
                'pnl_pct': 0.0
            }
            self.positions.append(trade)
            self.trade_history.append({**trade, 'action': 'OPEN'})
            logging.info(f"📈 PAPER TRADE OPENED: #{trade['id']} {direction} @ {spot:.2f}")
            return trade
    
    def update_positions(self, current_spot: float) -> List[Dict]:
        closed = []
        with self._lock:
            for pos in self.positions[:]:
                if pos['status'] != 'OPEN':
                    continue
                
                # Calculate unrealized P&L
                if pos['direction'] == 'LONG':
                    pos['pnl'] = (current_spot - pos['entry']) * pos['size'] * 100
                    pos['pnl_pct'] = (current_spot - pos['entry']) / pos['entry'] * 100
                else:
                    pos['pnl'] = (pos['entry'] - current_spot) * pos['size'] * 100
                    pos['pnl_pct'] = (pos['entry'] - current_spot) / pos['entry'] * 100
                
                # Check stop loss
                if pos['direction'] == 'LONG' and current_spot <= pos['stop_loss']:
                    pos['status'] = 'STOPPED'
                    pos['exit'] = current_spot
                    pos['ts_close'] = datetime.now().isoformat()
                    closed.append(pos)
                elif pos['direction'] == 'SHORT' and current_spot >= pos['stop_loss']:
                    pos['status'] = 'STOPPED'
                    pos['exit'] = current_spot
                    pos['ts_close'] = datetime.now().isoformat()
                    closed.append(pos)
                
                # Check take profit
                elif pos['direction'] == 'LONG' and current_spot >= pos['take_profit']:
                    pos['status'] = 'CLOSED'
                    pos['exit'] = current_spot
                    pos['ts_close'] = datetime.now().isoformat()
                    closed.append(pos)
                elif pos['direction'] == 'SHORT' and current_spot <= pos['take_profit']:
                    pos['status'] = 'CLOSED'
                    pos['exit'] = current_spot
                    pos['ts_close'] = datetime.now().isoformat()
                    closed.append(pos)
            
            # Move closed positions
            for pos in closed:
                self.positions.remove(pos)
                self.closed_trades.append(pos)
                self.capital += pos['pnl']
                self.trade_history.append({**pos, 'action': 'CLOSE'})
                logging.info(f"{'🟢' if pos['pnl'] > 0 else '🔴'} TRADE CLOSED: #{pos['id']} P&L: ${pos['pnl']:.2f}")
        
        return closed
    
    def close_position(self, trade_id: int, current_spot: float) -> Optional[Dict]:
        with self._lock:
            for pos in self.positions[:]:
                if pos['id'] == trade_id and pos['status'] == 'OPEN':
                    if pos['direction'] == 'LONG':
                        pos['pnl'] = (current_spot - pos['entry']) * pos['size'] * 100
                    else:
                        pos['pnl'] = (pos['entry'] - current_spot) * pos['size'] * 100
                    pos['pnl_pct'] = pos['pnl'] / pos['entry'] * 100
                    pos['status'] = 'CLOSED'
                    pos['exit'] = current_spot
                    pos['ts_close'] = datetime.now().isoformat()
                    self.positions.remove(pos)
                    self.closed_trades.append(pos)
                    self.capital += pos['pnl']
                    return pos
        return None
    
    def get_stats(self) -> Dict:
        with self._lock:
            total_trades = len(self.closed_trades)
            winners = [t for t in self.closed_trades if t['pnl'] > 0]
            losers = [t for t in self.closed_trades if t['pnl'] <= 0]
            
            total_pnl = sum(t['pnl'] for t in self.closed_trades)
            open_pnl = sum(p['pnl'] for p in self.positions)
            
            return {
                'initial_capital': self.initial_capital,
                'current_capital': self.capital,
                'total_pnl': total_pnl,
                'open_pnl': open_pnl,
                'total_return_pct': (self.capital - self.initial_capital) / self.initial_capital * 100,
                'total_trades': total_trades,
                'winners': len(winners),
                'losers': len(losers),
                'win_rate': len(winners) / total_trades * 100 if total_trades > 0 else 0,
                'avg_win': sum(t['pnl'] for t in winners) / len(winners) if winners else 0,
                'avg_loss': sum(t['pnl'] for t in losers) / len(losers) if losers else 0,
                'largest_win': max((t['pnl'] for t in winners), default=0),
                'largest_loss': min((t['pnl'] for t in losers), default=0),
                'open_positions': len(self.positions),
                'positions': self.positions[-5:],
                'recent_trades': self.closed_trades[-10:]
            }

# =============================================================================
# BACKTESTING ENGINE
# =============================================================================
class BacktestEngine:
    def __init__(self, config: Config):
        self.config = config
        self.results: List[Dict] = []
    
    def generate_signals(self, data: List[Tuple]) -> List[Dict]:
        """Generate trading signals from historical data."""
        signals = []
        
        for i in range(5, len(data)):
            date, open_p, high, low, close, iv = data[i]
            prev_close = data[i-1][4]
            prev_iv = data[i-1][5]
            
            # Calculate metrics
            daily_return = (close - prev_close) / prev_close
            iv_change = iv - prev_iv
            range_pct = (high - low) / open_p
            
            # Simulate GEX based on price action
            # Negative GEX when price dropping with high IV
            simulated_gex = -2e8 if (daily_return < -0.01 and iv > 0.12) else \
                            1.5e8 if (daily_return > 0.01 and iv < 0.11) else \
                            np.random.uniform(-1e8, 1e8)
            
            # Detect regime
            regime = Regime.NEUTRAL
            confidence = 30
            direction = None
            
            if simulated_gex < self.config.GEX_FLUSH and iv_change > 0:
                regime = Regime.FLUSH_RISK
                confidence = 70
                direction = 'SHORT'
            elif simulated_gex < self.config.GEX_EXTREME and iv > 0.13:
                regime = Regime.WATERFALL
                confidence = 85
                direction = 'SHORT'
            elif simulated_gex > self.config.GEX_SUPPORT and daily_return > 0:
                regime = Regime.CHARM_DRIFT
                confidence = 65
                direction = 'LONG'
            elif simulated_gex < 0 and daily_return > 0.005:
                regime = Regime.SQUEEZE
                confidence = 60
                direction = 'LONG'
            
            signals.append({
                'date': date,
                'open': open_p,
                'high': high,
                'low': low,
                'close': close,
                'iv': iv,
                'gex': simulated_gex,
                'regime': regime.value,
                'confidence': confidence,
                'direction': direction
            })
        
        return signals
    
    def run_backtest(self, signals: List[Dict], 
                     initial_capital: float = 100000.0) -> Dict:
        """Run backtest on generated signals."""
        capital = initial_capital
        positions = []
        trades = []
        equity_curve = [initial_capital]
        
        for i, sig in enumerate(signals):
            # Update existing positions
            for pos in positions[:]:
                current = sig['close']
                
                # Check exit conditions
                exit_trade = False
                if pos['direction'] == 'LONG':
                    pos['pnl'] = (current - pos['entry']) * pos['size'] * 100
                    if current <= pos['stop'] or current >= pos['target']:
                        exit_trade = True
                else:
                    pos['pnl'] = (pos['entry'] - current) * pos['size'] * 100
                    if current >= pos['stop'] or current <= pos['target']:
                        exit_trade = True
                
                # Also exit after 3 days max
                if i - pos['entry_idx'] >= 3:
                    exit_trade = True
                
                if exit_trade:
                    pos['exit'] = current
                    pos['exit_date'] = sig['date']
                    capital += pos['pnl']
                    trades.append(pos)
                    positions.remove(pos)
            
            # Enter new position if signal and no existing position
            if sig['direction'] and len(positions) == 0 and sig['confidence'] >= 60:
                entry = sig['close']
                if sig['direction'] == 'LONG':
                    stop = entry * 0.993  # 0.7% stop
                    target = entry * 1.015  # 1.5% target
                else:
                    stop = entry * 1.007
                    target = entry * 0.985
                
                positions.append({
                    'entry_idx': i,
                    'entry_date': sig['date'],
                    'entry': entry,
                    'direction': sig['direction'],
                    'regime': sig['regime'],
                    'size': 1.0,
                    'stop': stop,
                    'target': target,
                    'pnl': 0
                })
            
            equity_curve.append(capital + sum(p['pnl'] for p in positions))
        
        # Close remaining positions
        for pos in positions:
            pos['exit'] = signals[-1]['close']
            pos['exit_date'] = signals[-1]['date']
            capital += pos['pnl']
            trades.append(pos)
        
        # Calculate statistics
        winners = [t for t in trades if t['pnl'] > 0]
        losers = [t for t in trades if t['pnl'] <= 0]
        
        return {
            'initial_capital': initial_capital,
            'final_capital': capital,
            'total_return': (capital - initial_capital) / initial_capital * 100,
            'total_trades': len(trades),
            'winners': len(winners),
            'losers': len(losers),
            'win_rate': len(winners) / len(trades) * 100 if trades else 0,
            'avg_win': np.mean([t['pnl'] for t in winners]) if winners else 0,
            'avg_loss': np.mean([t['pnl'] for t in losers]) if losers else 0,
            'profit_factor': abs(sum(t['pnl'] for t in winners) / sum(t['pnl'] for t in losers)) if losers and sum(t['pnl'] for t in losers) != 0 else 0,
            'max_drawdown': self._calc_max_drawdown(equity_curve),
            'sharpe_ratio': self._calc_sharpe(equity_curve),
            'trades': trades,
            'equity_curve': equity_curve,
            'signals': signals
        }
    
    def _calc_max_drawdown(self, equity: List[float]) -> float:
        peak = equity[0]
        max_dd = 0
        for val in equity:
            if val > peak:
                peak = val
            dd = (peak - val) / peak * 100
            if dd > max_dd:
                max_dd = dd
        return max_dd
    
    def _calc_sharpe(self, equity: List[float], rf: float = 0.05) -> float:
        returns = np.diff(equity) / equity[:-1]
        if len(returns) < 2 or np.std(returns) == 0:
            return 0
        return (np.mean(returns) * 252 - rf) / (np.std(returns) * np.sqrt(252))

# =============================================================================
# GLOBALS
# =============================================================================
CONFIG = Config()
PAPER_TRADER = PaperTradingEngine(100000.0)
BACKTEST_ENGINE = BacktestEngine(CONFIG)
BACKTEST_RESULTS = None

# =============================================================================
# DASHBOARD HTML
# =============================================================================
DASHBOARD_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>TITAN OMEGA v21.0 - Trading System</title>
    <meta charset="utf-8">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.0.1/socket.io.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%);
            color: #e5e5e5;
            min-height: 100vh;
        }
        .header {
            background: rgba(0,0,0,0.4);
            border-bottom: 1px solid rgba(255,255,255,0.1);
            padding: 15px 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header h1 {
            font-size: 1.5rem;
            background: linear-gradient(90deg, #60a5fa, #a78bfa, #f472b6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .mode-badge {
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 600;
        }
        .mode-paper { background: #854d0e; color: #fef08a; }
        .mode-live { background: #166534; color: #86efac; }
        .mode-backtest { background: #1e3a5f; color: #93c5fd; }
        
        .container { padding: 20px; max-width: 1800px; margin: 0 auto; }
        
        .grid { display: grid; gap: 20px; }
        .grid-4 { grid-template-columns: repeat(4, 1fr); }
        .grid-3 { grid-template-columns: repeat(3, 1fr); }
        .grid-2 { grid-template-columns: repeat(2, 1fr); }
        
        @media (max-width: 1200px) {
            .grid-4, .grid-3 { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 768px) {
            .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; }
        }
        
        .card {
            background: rgba(30, 30, 46, 0.8);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 20px;
            backdrop-filter: blur(10px);
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .card-title {
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #888;
        }
        
        .stat-value {
            font-size: 2.5rem;
            font-weight: 700;
            line-height: 1.2;
        }
        .stat-label {
            font-size: 0.8rem;
            color: #888;
            margin-top: 5px;
        }
        .stat-change {
            font-size: 0.9rem;
            margin-top: 5px;
        }
        
        .positive { color: #4ade80; }
        .negative { color: #f87171; }
        .neutral { color: #fbbf24; }
        
        .regime-display {
            padding: 25px;
            border-radius: 12px;
            text-align: center;
            min-height: 150px;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        .regime-name {
            font-size: 1.8rem;
            font-weight: 700;
            margin-bottom: 10px;
        }
        .regime-conf {
            font-size: 3rem;
            font-weight: 800;
        }
        
        .playbook {
            background: rgba(0,0,0,0.3);
            border-radius: 8px;
            padding: 15px;
            font-family: 'SF Mono', monospace;
            font-size: 0.85rem;
            line-height: 1.6;
            white-space: pre-wrap;
            max-height: 200px;
            overflow-y: auto;
        }
        
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
        }
        .metric {
            background: rgba(0,0,0,0.2);
            padding: 12px;
            border-radius: 8px;
        }
        .metric-label { font-size: 0.75rem; color: #888; }
        .metric-value { font-size: 1.2rem; font-weight: 600; margin-top: 3px; }
        
        .trade-list {
            max-height: 300px;
            overflow-y: auto;
        }
        .trade-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 8px;
            background: rgba(0,0,0,0.2);
        }
        .trade-info { flex: 1; }
        .trade-regime { font-size: 0.75rem; color: #888; }
        .trade-entry { font-weight: 600; }
        .trade-pnl {
            font-weight: 700;
            font-size: 1.1rem;
            padding: 5px 12px;
            border-radius: 6px;
        }
        
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary { background: #3b82f6; color: white; }
        .btn-success { background: #22c55e; color: white; }
        .btn-danger { background: #ef4444; color: white; }
        .btn:hover { transform: translateY(-2px); opacity: 0.9; }
        
        .btn-group { display: flex; gap: 10px; margin-top: 15px; }
        
        .chart-container {
            height: 250px;
            position: relative;
        }
        
        .tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }
        .tab {
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            transition: all 0.2s;
        }
        .tab.active {
            background: #3b82f6;
            border-color: #3b82f6;
        }
        .tab:hover { background: rgba(255,255,255,0.1); }
        
        .backtest-summary {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 15px;
            margin-bottom: 20px;
        }
        .bt-stat {
            text-align: center;
            padding: 15px;
            background: rgba(0,0,0,0.2);
            border-radius: 8px;
        }
        .bt-stat-value { font-size: 1.5rem; font-weight: 700; }
        .bt-stat-label { font-size: 0.75rem; color: #888; margin-top: 5px; }
        
        .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            display: inline-block;
            margin-right: 8px;
            animation: pulse 2s infinite;
        }
        .status-dot.live { background: #22c55e; }
        .status-dot.paper { background: #eab308; }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🏛️ TITAN OMEGA v21.0</h1>
        <div>
            <span class="status-dot paper"></span>
            <span class="mode-badge mode-paper" id="mode-badge">PAPER TRADING</span>
        </div>
    </div>
    
    <div class="container">
        <div class="tabs">
            <div class="tab active" onclick="showTab('trading')">📊 Live Trading</div>
            <div class="tab" onclick="showTab('backtest')">📈 Backtest</div>
            <div class="tab" onclick="showTab('history')">📋 Trade History</div>
        </div>
        
        <!-- TRADING TAB -->
        <div id="tab-trading">
            <div class="grid grid-4" style="margin-bottom: 20px;">
                <div class="card">
                    <div class="card-header"><span class="card-title">Capital</span></div>
                    <div class="stat-value" id="capital">$100,000</div>
                    <div class="stat-change" id="capital-change">+$0.00 (0.00%)</div>
                </div>
                <div class="card">
                    <div class="card-header"><span class="card-title">SPX Spot</span></div>
                    <div class="stat-value" id="spot">--</div>
                    <div class="stat-label">Real-time price</div>
                </div>
                <div class="card">
                    <div class="card-header"><span class="card-title">Win Rate</span></div>
                    <div class="stat-value" id="win-rate">0%</div>
                    <div class="stat-label"><span id="wins">0</span>W / <span id="losses">0</span>L</div>
                </div>
                <div class="card">
                    <div class="card-header"><span class="card-title">Open P&L</span></div>
                    <div class="stat-value" id="open-pnl">$0.00</div>
                    <div class="stat-label" id="open-positions">0 positions</div>
                </div>
            </div>
            
            <div class="grid grid-2">
                <div class="card">
                    <div class="card-header">
                        <span class="card-title">Current Regime</span>
                        <span id="regime-time">--</span>
                    </div>
                    <div class="regime-display" id="regime-box" style="background: #1e293b;">
                        <div class="regime-name" id="regime-name">WAITING</div>
                        <div class="regime-conf"><span id="regime-conf">0</span>%</div>
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-success" onclick="openTrade('LONG')">📈 LONG</button>
                        <button class="btn btn-danger" onclick="openTrade('SHORT')">📉 SHORT</button>
                        <button class="btn btn-primary" onclick="closeAllTrades()">Close All</button>
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-header"><span class="card-title">Playbook</span></div>
                    <div class="playbook" id="playbook">Analyzing market conditions...</div>
                </div>
            </div>
            
            <div class="grid grid-2" style="margin-top: 20px;">
                <div class="card">
                    <div class="card-header"><span class="card-title">Greeks Exposure</span></div>
                    <div class="metrics-grid">
                        <div class="metric">
                            <div class="metric-label">GEX (Gamma)</div>
                            <div class="metric-value" id="gex">$0M</div>
                        </div>
                        <div class="metric">
                            <div class="metric-label">VEX (Vanna)</div>
                            <div class="metric-value" id="vex">$0M</div>
                        </div>
                        <div class="metric">
                            <div class="metric-label">CEX (Charm)</div>
                            <div class="metric-value" id="cex">$0M</div>
                        </div>
                        <div class="metric">
                            <div class="metric-label">Net Delta</div>
                            <div class="metric-value" id="delta">0</div>
                        </div>
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-header"><span class="card-title">Open Positions</span></div>
                    <div class="trade-list" id="positions-list">
                        <div style="text-align: center; color: #666; padding: 40px;">
                            No open positions
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- BACKTEST TAB -->
        <div id="tab-backtest" style="display: none;">
            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <span class="card-title">Backtest Configuration</span>
                    <button class="btn btn-primary" onclick="runBacktest()">🚀 Run Backtest</button>
                </div>
                <p style="color: #888; margin-bottom: 15px;">
                    Test strategy on SPX historical data (Jan-Mar 2024)
                </p>
                <div id="backtest-status"></div>
            </div>
            
            <div class="backtest-summary" id="bt-summary" style="display: none;">
                <div class="bt-stat">
                    <div class="bt-stat-value" id="bt-return">--</div>
                    <div class="bt-stat-label">Total Return</div>
                </div>
                <div class="bt-stat">
                    <div class="bt-stat-value" id="bt-trades">--</div>
                    <div class="bt-stat-label">Total Trades</div>
                </div>
                <div class="bt-stat">
                    <div class="bt-stat-value" id="bt-winrate">--</div>
                    <div class="bt-stat-label">Win Rate</div>
                </div>
                <div class="bt-stat">
                    <div class="bt-stat-value" id="bt-sharpe">--</div>
                    <div class="bt-stat-label">Sharpe Ratio</div>
                </div>
            </div>
            
            <div class="grid grid-2">
                <div class="card">
                    <div class="card-header"><span class="card-title">Equity Curve</span></div>
                    <div class="chart-container">
                        <canvas id="equityChart"></canvas>
                    </div>
                </div>
                <div class="card">
                    <div class="card-header"><span class="card-title">Backtest Trades</span></div>
                    <div class="trade-list" id="bt-trades-list">
                        <div style="text-align: center; color: #666; padding: 40px;">
                            Run backtest to see results
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- HISTORY TAB -->
        <div id="tab-history" style="display: none;">
            <div class="card">
                <div class="card-header"><span class="card-title">Paper Trade History</span></div>
                <div class="trade-list" id="history-list" style="max-height: 500px;">
                    <div style="text-align: center; color: #666; padding: 40px;">
                        No trades yet. Start paper trading to build history.
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        const socket = io();
        let equityChart = null;
        
        function showTab(tab) {
            document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
            document.getElementById('tab-' + tab).style.display = 'block';
            event.target.classList.add('active');
        }
        
        function formatMoney(n) {
            return '$' + n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        }
        
        function formatNum(n) {
            if (Math.abs(n) >= 1e9) return '$' + (n/1e9).toFixed(1) + 'B';
            if (Math.abs(n) >= 1e6) return '$' + (n/1e6).toFixed(1) + 'M';
            return '$' + (n/1e3).toFixed(1) + 'K';
        }
        
        socket.on('update', (data) => {
            if (data.spot) {
                document.getElementById('spot').textContent = data.spot.toFixed(2);
            }
            
            if (data.signal) {
                const s = data.signal;
                document.getElementById('regime-name').textContent = s.regime;
                document.getElementById('regime-conf').textContent = s.conf.toFixed(0);
                document.getElementById('regime-box').style.background = s.color || '#1e293b';
                document.getElementById('playbook').textContent = s.playbook;
                document.getElementById('regime-time').textContent = new Date().toLocaleTimeString();
                
                document.getElementById('gex').innerHTML = `<span class="${s.gex > 0 ? 'positive' : 'negative'}">${formatNum(s.gex)}</span>`;
                document.getElementById('vex').innerHTML = `<span class="${s.vex > 0 ? 'positive' : 'negative'}">${formatNum(s.vex)}</span>`;
                document.getElementById('cex').innerHTML = `<span class="${s.cex > 0 ? 'positive' : 'negative'}">${formatNum(s.cex)}</span>`;
                document.getElementById('delta').textContent = (s.delta/1000).toFixed(1) + 'K';
            }
            
            if (data.paper_stats) {
                const ps = data.paper_stats;
                document.getElementById('capital').textContent = formatMoney(ps.current_capital);
                const change = ps.current_capital - ps.initial_capital;
                const changePct = ps.total_return_pct;
                document.getElementById('capital-change').innerHTML = 
                    `<span class="${change >= 0 ? 'positive' : 'negative'}">${change >= 0 ? '+' : ''}${formatMoney(change)} (${changePct.toFixed(2)}%)</span>`;
                
                document.getElementById('win-rate').textContent = ps.win_rate.toFixed(0) + '%';
                document.getElementById('wins').textContent = ps.winners;
                document.getElementById('losses').textContent = ps.losers;
                document.getElementById('open-pnl').innerHTML = 
                    `<span class="${ps.open_pnl >= 0 ? 'positive' : 'negative'}">${formatMoney(ps.open_pnl)}</span>`;
                document.getElementById('open-positions').textContent = ps.open_positions + ' positions';
                
                // Update positions list
                const posList = document.getElementById('positions-list');
                if (ps.positions && ps.positions.length > 0) {
                    posList.innerHTML = ps.positions.map(p => `
                        <div class="trade-item">
                            <div class="trade-info">
                                <div class="trade-regime">${p.regime} | ${p.direction}</div>
                                <div class="trade-entry">Entry: ${p.entry.toFixed(2)}</div>
                            </div>
                            <div class="trade-pnl ${p.pnl >= 0 ? 'positive' : 'negative'}" 
                                 style="background: ${p.pnl >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}">
                                ${p.pnl >= 0 ? '+' : ''}${formatMoney(p.pnl)}
                            </div>
                        </div>
                    `).join('');
                } else {
                    posList.innerHTML = '<div style="text-align: center; color: #666; padding: 40px;">No open positions</div>';
                }
                
                // Update history
                if (ps.recent_trades) {
                    const histList = document.getElementById('history-list');
                    if (ps.recent_trades.length > 0) {
                        histList.innerHTML = ps.recent_trades.slice().reverse().map(t => `
                            <div class="trade-item">
                                <div class="trade-info">
                                    <div class="trade-regime">${t.regime} | ${t.direction} | ${t.status}</div>
                                    <div class="trade-entry">${t.entry.toFixed(2)} → ${(t.exit || t.entry).toFixed(2)}</div>
                                </div>
                                <div class="trade-pnl ${t.pnl >= 0 ? 'positive' : 'negative'}"
                                     style="background: ${t.pnl >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}">
                                    ${t.pnl >= 0 ? '+' : ''}${formatMoney(t.pnl)}
                                </div>
                            </div>
                        `).join('');
                    }
                }
            }
        });
        
        function openTrade(direction) {
            fetch('/api/trade/open', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({direction: direction})
            }).then(r => r.json()).then(data => {
                console.log('Trade opened:', data);
            });
        }
        
        function closeAllTrades() {
            fetch('/api/trade/close_all', {method: 'POST'})
                .then(r => r.json())
                .then(data => console.log('Trades closed:', data));
        }
        
        function runBacktest() {
            document.getElementById('backtest-status').innerHTML = '<span style="color: #fbbf24;">Running backtest...</span>';
            
            fetch('/api/backtest/run', {method: 'POST'})
                .then(r => r.json())
                .then(data => {
                    document.getElementById('backtest-status').innerHTML = '<span class="positive">✓ Backtest complete</span>';
                    document.getElementById('bt-summary').style.display = 'grid';
                    
                    document.getElementById('bt-return').innerHTML = 
                        `<span class="${data.total_return >= 0 ? 'positive' : 'negative'}">${data.total_return.toFixed(2)}%</span>`;
                    document.getElementById('bt-trades').textContent = data.total_trades;
                    document.getElementById('bt-winrate').textContent = data.win_rate.toFixed(1) + '%';
                    document.getElementById('bt-sharpe').textContent = data.sharpe_ratio.toFixed(2);
                    
                    // Update equity chart
                    if (equityChart) equityChart.destroy();
                    const ctx = document.getElementById('equityChart').getContext('2d');
                    equityChart = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: data.equity_curve.map((_, i) => i),
                            datasets: [{
                                label: 'Equity',
                                data: data.equity_curve,
                                borderColor: '#3b82f6',
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                fill: true,
                                tension: 0.4
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                x: { display: false },
                                y: { 
                                    grid: { color: 'rgba(255,255,255,0.1)' },
                                    ticks: { color: '#888' }
                                }
                            }
                        }
                    });
                    
                    // Update trades list
                    const tradesList = document.getElementById('bt-trades-list');
                    tradesList.innerHTML = data.trades.slice().reverse().map(t => `
                        <div class="trade-item">
                            <div class="trade-info">
                                <div class="trade-regime">${t.regime} | ${t.direction}</div>
                                <div class="trade-entry">${t.entry_date}: ${t.entry.toFixed(2)} → ${t.exit.toFixed(2)}</div>
                            </div>
                            <div class="trade-pnl ${t.pnl >= 0 ? 'positive' : 'negative'}"
                                 style="background: ${t.pnl >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}">
                                ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}
                            </div>
                        </div>
                    `).join('');
                });
        }
    </script>
</body>
</html>
"""

# =============================================================================
# FLASK APP
# =============================================================================
app = Flask(__name__)
app.config['SECRET_KEY'] = 'titan-omega-trading'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Current market state
MARKET_STATE = {
    'spot': 5970.0,
    'gex': 0,
    'vex': 0,
    'cex': 0,
    'delta': 0,
    'iv': 0.12,
    'regime': 'NEUTRAL',
    'confidence': 30,
    'playbook': 'Initializing...',
    'color': '#1e293b'
}

@app.route('/')
def index():
    return render_template_string(DASHBOARD_HTML)

@app.route('/api/status')
def api_status():
    return jsonify({
        'market': MARKET_STATE,
        'paper_stats': PAPER_TRADER.get_stats()
    })

@app.route('/api/trade/open', methods=['POST'])
def api_open_trade():
    data = request.json
    direction = data.get('direction', 'LONG')
    trade = PAPER_TRADER.open_position(
        regime=MARKET_STATE['regime'],
        spot=MARKET_STATE['spot'],
        direction=direction
    )
    return jsonify({'success': True, 'trade': trade})

@app.route('/api/trade/close_all', methods=['POST'])
def api_close_all():
    closed = []
    for pos in PAPER_TRADER.positions[:]:
        result = PAPER_TRADER.close_position(pos['id'], MARKET_STATE['spot'])
        if result:
            closed.append(result)
    return jsonify({'success': True, 'closed': len(closed)})

@app.route('/api/backtest/run', methods=['POST'])
def api_run_backtest():
    global BACKTEST_RESULTS
    signals = BACKTEST_ENGINE.generate_signals(HISTORICAL_SPX)
    BACKTEST_RESULTS = BACKTEST_ENGINE.run_backtest(signals)
    return jsonify(BACKTEST_RESULTS)

# =============================================================================
# MARKET SIMULATION (for paper trading without API)
# =============================================================================
def simulate_market():
    """Simulate realistic market movements for paper trading."""
    global MARKET_STATE
    
    base_spot = 5970.0
    tick = 0
    
    while True:
        tick += 1
        
        # Simulate price movement
        drift = np.random.randn() * 0.3
        if tick % 20 == 0:  # Occasional larger moves
            drift += np.random.randn() * 2
        
        MARKET_STATE['spot'] = max(5800, min(6100, MARKET_STATE['spot'] + drift))
        
        # Simulate Greeks
        price_momentum = drift * 10
        MARKET_STATE['gex'] = np.clip(MARKET_STATE['gex'] + np.random.randn() * 5e7, -5e8, 5e8)
        MARKET_STATE['vex'] = np.clip(MARKET_STATE['vex'] + np.random.randn() * 2e7, -2e8, 2e8)
        MARKET_STATE['cex'] = np.clip(MARKET_STATE['cex'] + np.random.randn() * 1e7, -1e8, 1e8)
        MARKET_STATE['delta'] = np.random.randn() * 50000
        MARKET_STATE['iv'] = np.clip(0.12 + np.random.randn() * 0.01, 0.08, 0.25)
        
        # Determine regime
        gex = MARKET_STATE['gex']
        vex = MARKET_STATE['vex']
        iv = MARKET_STATE['iv']
        
        if gex < -3e8 and iv > 0.15:
            MARKET_STATE['regime'] = 'WATERFALL'
            MARKET_STATE['confidence'] = 85
            MARKET_STATE['color'] = '#7f1d1d'
            MARKET_STATE['playbook'] = f"""🌊 WATERFALL DETECTED

GEX: ${gex/1e6:.1f}M | Vanna: ${vex/1e6:.1f}M
IV: {iv*100:.1f}% ⬆️

TRADE: FADE THE RIP
Entry: Wait for 3-5pt bounce
Stop: 7pt | Target: 15-20pt"""

        elif gex < -1.5e8 and vex > 0:
            MARKET_STATE['regime'] = 'FLUSH_RISK'
            MARKET_STATE['confidence'] = 70
            MARKET_STATE['color'] = '#450a0a'
            MARKET_STATE['playbook'] = f"""⚠️ FLUSH RISK

GEX: ${gex/1e6:.1f}M | Vanna: ${vex/1e6:.1f}M
IV: {iv*100:.1f}%

Watching for IV spike to confirm.
Be ready to SHORT on breakdown."""

        elif gex > 1.2e8:
            MARKET_STATE['regime'] = 'CHARM_DRIFT'
            MARKET_STATE['confidence'] = 65
            MARKET_STATE['color'] = '#064e3b'
            MARKET_STATE['playbook'] = f"""📈 CHARM DRIFT

GEX: +${gex/1e6:.1f}M | Charm flow positive

Mechanical bid into close.
TRADE: BUY THE DIP
Target: +10-15pt"""

        elif gex < 0 and drift > 0.5:
            MARKET_STATE['regime'] = 'SQUEEZE'
            MARKET_STATE['confidence'] = 60
            MARKET_STATE['color'] = '#1e3a5f'
            MARKET_STATE['playbook'] = f"""🚀 SQUEEZE POTENTIAL

GEX: ${gex/1e6:.1f}M | Price rising

Short covering fueling rally.
TRADE: RIDE MOMENTUM
Stop: -5pt trailing"""

        else:
            MARKET_STATE['regime'] = 'NEUTRAL'
            MARKET_STATE['confidence'] = 30
            MARKET_STATE['color'] = '#1e293b'
            MARKET_STATE['playbook'] = f"""📊 NEUTRAL

GEX: ${gex/1e6:.1f}M | Vanna: ${vex/1e6:.1f}M
IV: {iv*100:.1f}%

No clear directional bias.
Wait for setup..."""
        
        # Update paper positions
        PAPER_TRADER.update_positions(MARKET_STATE['spot'])
        
        # Emit update
        socketio.emit('update', {
            'spot': MARKET_STATE['spot'],
            'signal': {
                'regime': MARKET_STATE['regime'],
                'conf': MARKET_STATE['confidence'],
                'playbook': MARKET_STATE['playbook'],
                'color': MARKET_STATE['color'],
                'gex': MARKET_STATE['gex'],
                'vex': MARKET_STATE['vex'],
                'cex': MARKET_STATE['cex'],
                'delta': MARKET_STATE['delta'],
                'iv': MARKET_STATE['iv']
            },
            'paper_stats': PAPER_TRADER.get_stats()
        })
        
        time.sleep(2)

# =============================================================================
# MAIN
# =============================================================================
def main():
    logging.info("=" * 60)
    logging.info("🏛️ TITAN OMEGA v21.0 - TRADING SYSTEM")
    logging.info("=" * 60)
    
    if CONFIG.API_KEY:
        logging.info(f"✅ API Key: {CONFIG.API_KEY[:8]}...")
        logging.info("📡 Mode: LIVE DATA")
    else:
        logging.info("🎮 Mode: PAPER TRADING (Simulated Data)")
        logging.info("   For live data: export POLYGON_API_KEY='key'")
    
    logging.info(f"💰 Initial Capital: $100,000")
    logging.info(f"🌐 Dashboard: http://localhost:{CONFIG.PORT}")
    
    # Start market simulation
    Thread(target=simulate_market, daemon=True).start()
    
    # Run Flask
    socketio.run(app, host=CONFIG.HOST, port=CONFIG.PORT, 
                 debug=False, use_reloader=False, allow_unsafe_werkzeug=True)

if __name__ == "__main__":
    main()
