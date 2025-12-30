# PHASE 1 IMPLEMENTATION GUIDE
## Execution & Risk Management (Weeks 1-2)

This guide provides copy-paste code templates to immediately upgrade TITAN with automated execution and robust risk controls.

---

## Part 1: Circuit Breaker System (Day 1)

### 1.1 Add to `titan_server.py`

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

@dataclass
class TradeOutcome:
    """Individual trade result"""
    timestamp: datetime
    scenario_type: str
    entry_price: float
    exit_price: float
    pnl: float
    r_multiple: float
    duration_seconds: int

class CircuitBreaker:
    """
    Prevents catastrophic losses with multiple safety mechanisms
    """
    
    def __init__(
        self,
        max_daily_loss_pct: float = 0.02,  # 2% max daily loss
        max_consecutive_losses: int = 3,
        min_win_rate_window: int = 10,
        min_win_rate_threshold: float = 0.35,
        cooldown_after_breach_minutes: int = 30
    ):
        self.max_daily_loss_pct = max_daily_loss_pct
        self.max_consecutive_losses = max_consecutive_losses
        self.min_win_rate_window = min_win_rate_window
        self.min_win_rate_threshold = min_win_rate_threshold
        self.cooldown_minutes = cooldown_after_breach_minutes
        
        self.daily_pnl: float = 0
        self.starting_balance: float = 50000  # Set from account
        self.consecutive_losses: int = 0
        self.trade_history: list[TradeOutcome] = []
        self.breach_time: Optional[datetime] = None
        self.breach_reason: Optional[str] = None
        
    def reset_daily(self):
        """Call at market open"""
        self.daily_pnl = 0
        self.consecutive_losses = 0
        self.breach_time = None
        self.breach_reason = None
        
    def record_trade(self, outcome: TradeOutcome):
        """Log trade result and update state"""
        self.trade_history.append(outcome)
        self.daily_pnl += outcome.pnl
        
        if outcome.pnl < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0
            
        # Trim history to last 30 days
        cutoff = datetime.now() - timedelta(days=30)
        self.trade_history = [
            t for t in self.trade_history 
            if t.timestamp > cutoff
        ]
        
    def should_halt_trading(self) -> tuple[bool, Optional[str]]:
        """
        Returns (should_halt, reason)
        """
        now = datetime.now()
        
        # Check if in cooldown from previous breach
        if self.breach_time and (now - self.breach_time).seconds < self.cooldown_minutes * 60:
            remaining = self.cooldown_minutes - ((now - self.breach_time).seconds // 60)
            return True, f"COOLDOWN: {remaining}min remaining ({self.breach_reason})"
        
        # Rule 1: Daily loss limit
        daily_loss_pct = abs(self.daily_pnl) / self.starting_balance
        if self.daily_pnl < 0 and daily_loss_pct >= self.max_daily_loss_pct:
            self.breach_time = now
            self.breach_reason = f"DAILY_LOSS: {daily_loss_pct*100:.1f}%"
            return True, self.breach_reason
            
        # Rule 2: Consecutive losses
        if self.consecutive_losses >= self.max_consecutive_losses:
            self.breach_time = now
            self.breach_reason = f"CONSEC_LOSSES: {self.consecutive_losses}"
            return True, self.breach_reason
            
        # Rule 3: Rolling win rate collapse
        if len(self.trade_history) >= self.min_win_rate_window:
            recent = self.trade_history[-self.min_win_rate_window:]
            wins = sum(1 for t in recent if t.pnl > 0)
            win_rate = wins / len(recent)
            
            if win_rate < self.min_win_rate_threshold:
                self.breach_time = now
                self.breach_reason = f"WIN_RATE: {win_rate*100:.0f}% < {self.min_win_rate_threshold*100:.0f}%"
                return True, self.breach_reason
                
        return False, None
    
    def get_status(self) -> dict:
        """For UI display"""
        halt, reason = self.should_halt_trading()
        
        today_trades = [
            t for t in self.trade_history 
            if t.timestamp.date() == datetime.now().date()
        ]
        
        return {
            "halted": halt,
            "reason": reason,
            "daily_pnl": self.daily_pnl,
            "daily_pnl_pct": (self.daily_pnl / self.starting_balance) * 100,
            "consecutive_losses": self.consecutive_losses,
            "today_trades": len(today_trades),
            "today_wins": sum(1 for t in today_trades if t.pnl > 0)
        }
```

### 1.2 Integrate into GLOBAL_STATE

Add to the top of `titan_server.py`:

```python
# Add to GLOBAL_STATE
GLOBAL_STATE["circuit_breaker"] = CircuitBreaker(
    max_daily_loss_pct=0.02,
    max_consecutive_losses=3
)

# Add status endpoint
@app.get("/circuit_breaker_status")
async def get_circuit_breaker_status():
    cb = GLOBAL_STATE["circuit_breaker"]
    return JSONResponse(cb.get_status())
```

### 1.3 Block Scenarios When Halted

Modify the scenario detection in `titan_server.py`:

```python
async def _analyze_loop():
    """Main analysis loop"""
    while True:
        # ... existing code ...
        
        # CHECK CIRCUIT BREAKER BEFORE GENERATING SCENARIOS
        cb = GLOBAL_STATE["circuit_breaker"]
        halt, reason = cb.should_halt_trading()
        
        if halt:
            logger.warning(f"Circuit breaker active: {reason}")
            GLOBAL_STATE["engine_status"] = "CIRCUIT_BREAKER"
            GLOBAL_STATE["engine_reason"] = reason
            GLOBAL_STATE["scenario"] = None
            GLOBAL_STATE["regime"] = "HALTED"
            GLOBAL_STATE["trigger_text"] = f"🚨 TRADING HALTED: {reason}"
            await asyncio.sleep(cfg.poll_s)
            continue
        
        # ... rest of analysis ...
```

---

## Part 2: Exit Logic (Days 2-3)

### 2.1 Create `titan_exits.py`

```python
"""
Exit signal generation for TITAN
Determines when to close/adjust positions
"""

from dataclasses import dataclass
from typing import Optional, Literal

@dataclass
class Position:
    """Active trade position"""
    entry_time: float
    entry_price: float
    direction: Literal['LONG', 'SHORT']
    stop_loss: float
    target: float
    contracts: int
    entry_regime: str
    scenario_type: str
    initial_confidence: float

@dataclass
class ExitSignal:
    action: Literal['CLOSE_NOW', 'MOVE_STOP', 'SCALE_OUT', 'HOLD']
    reason: str
    new_stop: Optional[float] = None
    scale_out_pct: Optional[float] = None
    urgency: Literal['IMMEDIATE', 'NORMAL'] = 'NORMAL'

def evaluate_exit(
    position: Position,
    current_price: float,
    current_regime: str,
    force_equilibrium: float,
    gamma_flip: Optional[float],
    time_elapsed_minutes: float,
    vix_change: float
) -> ExitSignal:
    """
    Main exit logic - returns signal for position management
    """
    
    # Calculate unrealized P&L
    if position.direction == 'LONG':
        unrealized_pnl = current_price - position.entry_price
    else:
        unrealized_pnl = position.entry_price - current_price
    
    # RULE 1: Stop loss hit
    if position.direction == 'LONG' and current_price <= position.stop_loss:
        return ExitSignal(
            action='CLOSE_NOW',
            reason='STOP_LOSS_HIT',
            urgency='IMMEDIATE'
        )
    elif position.direction == 'SHORT' and current_price >= position.stop_loss:
        return ExitSignal(
            action='CLOSE_NOW',
            reason='STOP_LOSS_HIT',
            urgency='IMMEDIATE'
        )
    
    # RULE 2: Target reached
    if position.direction == 'LONG' and current_price >= position.target:
        return ExitSignal(
            action='CLOSE_NOW',
            reason='TARGET_REACHED',
            urgency='NORMAL'
        )
    elif position.direction == 'SHORT' and current_price <= position.target:
        return ExitSignal(
            action='CLOSE_NOW',
            reason='TARGET_REACHED',
            urgency='NORMAL'
        )
    
    # RULE 3: Regime flip (structure broke)
    if position.entry_regime != current_regime:
        if position.entry_regime == 'POS' and current_regime == 'NEG':
            return ExitSignal(
                action='CLOSE_NOW',
                reason='REGIME_FLIP_POS_TO_NEG',
                urgency='IMMEDIATE'
            )
        elif position.entry_regime == 'NEG' and current_regime == 'POS':
            return ExitSignal(
                action='CLOSE_NOW',
                reason='REGIME_FLIP_NEG_TO_POS',
                urgency='NORMAL'
            )
    
    # RULE 4: Gamma flip level crossed (major structure break)
    if gamma_flip is not None:
        if position.direction == 'LONG' and position.entry_price > gamma_flip and current_price < gamma_flip:
            return ExitSignal(
                action='CLOSE_NOW',
                reason='CROSSED_GAMMA_FLIP_DOWN',
                urgency='IMMEDIATE'
            )
        elif position.direction == 'SHORT' and position.entry_price < gamma_flip and current_price > gamma_flip:
            return ExitSignal(
                action='CLOSE_NOW',
                reason='CROSSED_GAMMA_FLIP_UP',
                urgency='IMMEDIATE'
            )
    
    # RULE 5: Near equilibrium - scale out 50%
    dist_to_eq = abs(current_price - force_equilibrium)
    if dist_to_eq < 2.0 and unrealized_pnl > 0:
        return ExitSignal(
            action='SCALE_OUT',
            reason='APPROACHING_EQUILIBRIUM',
            scale_out_pct=0.5,
            urgency='NORMAL'
        )
    
    # RULE 6: Time-based exit (stale trade)
    if position.scenario_type == 'DIP_BUY' and time_elapsed_minutes > 45 and unrealized_pnl < 0:
        return ExitSignal(
            action='CLOSE_NOW',
            reason='STALE_TRADE_45MIN',
            urgency='NORMAL'
        )
    
    # RULE 7: VIX spike (environment changed)
    if vix_change > 2.0 and unrealized_pnl < 0:
        return ExitSignal(
            action='CLOSE_NOW',
            reason='VIX_SPIKE',
            urgency='IMMEDIATE'
        )
    
    # RULE 8: Trailing stop (for winning trades)
    if unrealized_pnl > 5.0:  # In profit by 5+ points
        if position.direction == 'LONG':
            trailing_stop = current_price - 3.0  # 3-point trail
            if trailing_stop > position.stop_loss:
                return ExitSignal(
                    action='MOVE_STOP',
                    reason='TRAILING_STOP_UP',
                    new_stop=trailing_stop,
                    urgency='NORMAL'
                )
        else:
            trailing_stop = current_price + 3.0
            if trailing_stop < position.stop_loss:
                return ExitSignal(
                    action='MOVE_STOP',
                    reason='TRAILING_STOP_DOWN',
                    new_stop=trailing_stop,
                    urgency='NORMAL'
                )
    
    # RULE 9: Break-even stop (after 3+ points profit)
    if unrealized_pnl > 3.0:
        if position.direction == 'LONG' and position.stop_loss < position.entry_price:
            return ExitSignal(
                action='MOVE_STOP',
                reason='BREAK_EVEN_STOP',
                new_stop=position.entry_price + 0.5,
                urgency='NORMAL'
            )
        elif position.direction == 'SHORT' and position.stop_loss > position.entry_price:
            return ExitSignal(
                action='MOVE_STOP',
                reason='BREAK_EVEN_STOP',
                new_stop=position.entry_price - 0.5,
                urgency='NORMAL'
            )
    
    return ExitSignal(
        action='HOLD',
        reason='NO_EXIT_CONDITIONS',
        urgency='NORMAL'
    )

def calculate_actual_pnl(
    position: Position,
    exit_price: float,
    commission_per_contract: float = 0.65
) -> float:
    """
    Calculate realized P&L including slippage estimate and commissions
    """
    if position.direction == 'LONG':
        gross_pnl = (exit_price - position.entry_price) * position.contracts * 100
    else:
        gross_pnl = (position.entry_price - exit_price) * position.contracts * 100
    
    total_commission = commission_per_contract * position.contracts * 2  # entry + exit
    
    return gross_pnl - total_commission
```

### 2.2 Add Position Tracking to `titan_server.py`

```python
# Add to GLOBAL_STATE
GLOBAL_STATE["active_positions"] = []
GLOBAL_STATE["closed_positions"] = []

# Add exit evaluation to main loop
async def _analyze_loop():
    """Main analysis loop with exit monitoring"""
    while True:
        # ... existing analysis ...
        
        # EVALUATE EXITS FOR ACTIVE POSITIONS
        from titan_exits import evaluate_exit, calculate_actual_pnl
        
        for pos in GLOBAL_STATE["active_positions"]:
            time_elapsed = (datetime.now().timestamp() - pos.entry_time) / 60
            
            exit_signal = evaluate_exit(
                position=pos,
                current_price=GLOBAL_STATE["spot"],
                current_regime=GLOBAL_STATE["regime"],
                force_equilibrium=GLOBAL_STATE.get("force_equilibrium", pos.target),
                gamma_flip=GLOBAL_STATE.get("gamma_flip"),
                time_elapsed_minutes=time_elapsed,
                vix_change=GLOBAL_STATE.get("vix", 15) - pos.entry_vix
            )
            
            if exit_signal.action != 'HOLD':
                logger.info(f"Exit signal: {exit_signal.action} - {exit_signal.reason}")
                
                # TODO: Execute actual exit via broker API
                # For now, log and track
                
                if exit_signal.action in ['CLOSE_NOW', 'SCALE_OUT']:
                    pnl = calculate_actual_pnl(pos, GLOBAL_STATE["spot"])
                    
                    # Record outcome for circuit breaker
                    outcome = TradeOutcome(
                        timestamp=datetime.now(),
                        scenario_type=pos.scenario_type,
                        entry_price=pos.entry_price,
                        exit_price=GLOBAL_STATE["spot"],
                        pnl=pnl,
                        r_multiple=pnl / (abs(pos.entry_price - pos.stop_loss) * pos.contracts * 100),
                        duration_seconds=int(time_elapsed * 60)
                    )
                    
                    GLOBAL_STATE["circuit_breaker"].record_trade(outcome)
                    
                    if exit_signal.action == 'CLOSE_NOW':
                        GLOBAL_STATE["active_positions"].remove(pos)
                        GLOBAL_STATE["closed_positions"].append({
                            "position": pos,
                            "exit": exit_signal,
                            "pnl": pnl
                        })
                
                elif exit_signal.action == 'MOVE_STOP':
                    pos.stop_loss = exit_signal.new_stop
```

---

## Part 3: Economic Calendar Integration (Day 4)

### 3.1 Create `economic_calendar.py`

```python
"""
Economic event filtering to prevent disaster trades
"""

import httpx
from datetime import datetime, timedelta
from typing import List, Optional
import logging

logger = logging.getLogger("titan.calendar")

# High-impact events that cause violent moves
BLACKOUT_EVENTS = [
    'FOMC', 'Interest Rate Decision', 'Federal Funds Rate',
    'CPI', 'Consumer Price Index', 'Core CPI',
    'PPI', 'Producer Price Index',
    'NFP', 'Nonfarm Payrolls', 'Employment',
    'GDP', 'Gross Domestic Product',
    'Retail Sales', 'PCE', 'ISM Manufacturing', 'ISM Services',
    'Unemployment Rate', 'Jobless Claims'
]

class EconomicCalendar:
    def __init__(self, api_key: Optional[str] = None):
        """
        Uses TradingEconomics or Alpha Vantage
        Free tier: https://tradingeconomics.com/api
        """
        self.api_key = api_key
        self.events_cache: List[dict] = []
        self.cache_expiry: Optional[datetime] = None
        
    async def fetch_today_events(self) -> List[dict]:
        """
        Fetch economic events for today
        Returns list of {time, event, importance}
        """
        now = datetime.now()
        
        # Return cache if fresh (< 1 hour old)
        if self.cache_expiry and now < self.cache_expiry:
            return self.events_cache
        
        try:
            # Option 1: TradingEconomics (free 1000 calls/month)
            if self.api_key:
                async with httpx.AsyncClient() as client:
                    url = "https://api.tradingeconomics.com/calendar"
                    params = {
                        "c": self.api_key,
                        "country": "united states",
                        "d1": now.strftime("%Y-%m-%d"),
                        "d2": now.strftime("%Y-%m-%d")
                    }
                    response = await client.get(url, params=params, timeout=5.0)
                    data = response.json()
                    
                    events = [
                        {
                            "time": datetime.fromisoformat(e["Date"].replace("Z", "+00:00")),
                            "event": e["Event"],
                            "importance": e.get("Importance", "Low")
                        }
                        for e in data
                        if any(kw in e["Event"] for kw in BLACKOUT_EVENTS)
                    ]
                    
                    self.events_cache = events
                    self.cache_expiry = now + timedelta(hours=1)
                    return events
            
            # Option 2: Hardcoded schedule (use for demo)
            # FOMC: 2:00 PM ET on meeting days (8 times/year)
            # CPI: 8:30 AM ET (monthly, ~12th of month)
            # NFP: 8:30 AM ET (first Friday of month)
            
            # For production, replace with real API
            return []
            
        except Exception as e:
            logger.error(f"Failed to fetch calendar: {e}")
            return []
    
    def is_blackout_window(
        self,
        current_time: datetime,
        events: List[dict],
        pre_minutes: int = 10,
        post_minutes: int = 5
    ) -> tuple[bool, Optional[str]]:
        """
        Returns (is_blackout, event_name)
        Blocks trading 10min before → 5min after major releases
        """
        for event in events:
            event_time = event["time"]
            start = event_time - timedelta(minutes=pre_minutes)
            end = event_time + timedelta(minutes=post_minutes)
            
            if start <= current_time <= end:
                return True, event["event"]
        
        return False, None
```

### 3.2 Integrate into Main Loop

```python
# In titan_server.py
from economic_calendar import EconomicCalendar

# Initialize
calendar = EconomicCalendar(api_key=os.getenv("TRADING_ECONOMICS_API_KEY"))

async def _analyze_loop():
    """Main loop with calendar checking"""
    while True:
        # Fetch calendar at start of day
        events = await calendar.fetch_today_events()
        
        # Check blackout before generating scenarios
        is_blackout, event_name = calendar.is_blackout_window(
            datetime.now(),
            events,
            pre_minutes=10,
            post_minutes=5
        )
        
        if is_blackout:
            logger.warning(f"BLACKOUT: {event_name} - No trading")
            GLOBAL_STATE["engine_status"] = "BLACKOUT"
            GLOBAL_STATE["engine_reason"] = f"Economic event: {event_name}"
            GLOBAL_STATE["scenario"] = None
            GLOBAL_STATE["trigger_text"] = f"⏸️ BLACKOUT: {event_name}"
            await asyncio.sleep(cfg.poll_s)
            continue
        
        # ... rest of analysis ...
```

---

## Part 4: Telegram Alerts (Day 5)

### 4.1 Install Dependencies

```bash
pip install python-telegram-bot==20.7
```

### 4.2 Create `telegram_notifier.py`

```python
"""
Real-time trade alerts via Telegram
"""

import asyncio
import logging
from typing import Optional
from telegram import Bot
from telegram.error import TelegramError

logger = logging.getLogger("titan.telegram")

class TelegramNotifier:
    def __init__(self, bot_token: str, chat_id: str):
        """
        Setup:
        1. Message @BotFather on Telegram → /newbot
        2. Get bot token
        3. Start chat with your bot
        4. Get chat_id from https://api.telegram.org/bot<TOKEN>/getUpdates
        """
        self.bot = Bot(token=bot_token)
        self.chat_id = chat_id
        self.last_alert_id: Optional[str] = None
        
    async def send_scenario_alert(self, scenario: dict, state: dict):
        """
        Send formatted alert for new scenario
        """
        # Prevent duplicate alerts
        alert_id = f"{scenario['type']}_{scenario['conf']}_{state['spot']:.2f}"
        if alert_id == self.last_alert_id:
            return
        
        self.last_alert_id = alert_id
        
        # Format message
        urgency_emoji = {
            'NOW': '🔴',
            'READY': '🟡',
            'PREP': '🟢',
            'WAIT': '⏸️'
        }
        
        direction_emoji = '📈' if scenario['dir'] == 'LONG' else '📉'
        
        msg = f"""
{urgency_emoji.get(scenario['urgency'], '⚪')} **TITAN ALERT** {direction_emoji}

**Setup**: {scenario['type']}
**Confidence**: {scenario['conf']}%
**Direction**: {scenario['dir']}
**Urgency**: {scenario['urgency']}

**Entry**: {scenario['entry']['low']:.2f} - {scenario['entry']['high']:.2f}
**Stop**: {scenario['stop']:.2f}
**Target**: {scenario['target']:.2f}

**Position**: {scenario['pos']['contracts']} contracts
**Kelly**: {scenario['pos']['kelly']*100:.1f}%

**Current**: {state['spot']:.2f}
**Regime**: {state['regime']}
**GEX**: {state['net_gex']/1e9:.2f}B

⚠️ {', '.join(scenario.get('warnings', []))}
"""
        
        try:
            await self.bot.send_message(
                chat_id=self.chat_id,
                text=msg,
                parse_mode='Markdown'
            )
            logger.info(f"Sent Telegram alert: {scenario['type']}")
        except TelegramError as e:
            logger.error(f"Telegram send failed: {e}")
    
    async def send_exit_alert(self, position: dict, exit_signal: dict, pnl: float):
        """Alert when position closed"""
        msg = f"""
🔔 **POSITION CLOSED**

**Setup**: {position['scenario_type']}
**Direction**: {position['direction']}
**Exit Reason**: {exit_signal['reason']}

**Entry**: {position['entry_price']:.2f}
**Exit**: {exit_signal['exit_price']:.2f}
**P&L**: ${pnl:.2f} ({(pnl/position['entry_price']*100):.2f}%)

**Duration**: {exit_signal['duration_minutes']:.0f} minutes
"""
        
        try:
            await self.bot.send_message(
                chat_id=self.chat_id,
                text=msg,
                parse_mode='Markdown'
            )
        except TelegramError as e:
            logger.error(f"Telegram send failed: {e}")
```

### 4.3 Integrate into `titan_server.py`

```python
# Add to top of file
from telegram_notifier import TelegramNotifier

# Initialize (add to startup)
telegram = None
if os.getenv("TELEGRAM_BOT_TOKEN") and os.getenv("TELEGRAM_CHAT_ID"):
    telegram = TelegramNotifier(
        bot_token=os.getenv("TELEGRAM_BOT_TOKEN"),
        chat_id=os.getenv("TELEGRAM_CHAT_ID")
    )
    logger.info("Telegram notifications enabled")

# In scenario detection
async def _analyze_loop():
    # ... after detecting scenario ...
    
    if best_scenario and telegram:
        await telegram.send_scenario_alert(best_scenario, GLOBAL_STATE)
    
    # ... after position exit ...
    
    if exit_signal.action == 'CLOSE_NOW' and telegram:
        await telegram.send_exit_alert(position, exit_signal, pnl)
```

---

## Part 5: Environment Setup

### 5.1 Update `.env` file

Create `.env` in workspace root:

```bash
# Existing
POLYGON_API_KEY=your_polygon_key_here

# New additions
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
TRADING_ECONOMICS_API_KEY=your_te_key_here  # Optional

# Circuit breaker settings
MAX_DAILY_LOSS_PCT=0.02
MAX_CONSECUTIVE_LOSSES=3

# Account size
STARTING_BALANCE=50000
```

### 5.2 Update `requirements.txt`

```txt
streamlit
pandas
numpy
httpx
fastapi
uvicorn
python-telegram-bot==20.7
python-dotenv
```

---

## Testing Checklist

### Day 1: Circuit Breaker
- [ ] Daily loss limit triggers correctly
- [ ] Consecutive loss limit works
- [ ] Win rate threshold detection
- [ ] Cooldown timer functions
- [ ] UI shows circuit breaker status

### Day 2-3: Exit Logic
- [ ] Stop loss exits trigger
- [ ] Target exits trigger
- [ ] Trailing stops adjust correctly
- [ ] Break-even stops move up
- [ ] Regime flip exits work
- [ ] Time-based exits fire

### Day 4: Economic Calendar
- [ ] Fetches today's events
- [ ] Detects blackout windows
- [ ] Blocks scenarios during blackouts
- [ ] UI shows blackout reason

### Day 5: Telegram
- [ ] Bot sends scenario alerts
- [ ] No duplicate alerts
- [ ] Exit alerts include P&L
- [ ] Formatting looks clean on mobile

---

## Next Steps

After completing Phase 1, you'll have:
- ✅ Automated risk management
- ✅ Intelligent exit system
- ✅ Economic event protection
- ✅ Mobile notifications

**Ready for Phase 2**: Automated execution and backtesting

See `TITAN_TRADING_SYSTEM_ANALYSIS.md` for full roadmap.
