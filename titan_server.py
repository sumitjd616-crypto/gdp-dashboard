from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Deque, Dict, List, Optional, Tuple

import httpx
import numpy as np
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles


logger = logging.getLogger("titan")


# -----------------------------------------------------------------------------
# GLOBAL_STATE (single source of truth)

GLOBAL_STATE: Dict[str, Any] = {
    # Engine / session
    "engine_status": "BOOTING",  # OK | DEGRADED | OFFLINE | MARKET_CLOSED | BOOTING
    "engine_reason": None,
    "ws_ok": True,
    "loop_ms": None,
    "exposures_ms": None,
    "contracts_processed": None,
    "last_tick_ny": None,
    "latency_ms": None,
    "market_session": None,  # OPEN | CLOSED | PRE | POST | UNKNOWN
    # Data integrity
    "spot": None,
    "spot_valid": False,
    "spot_age_s": None,
    "last_close": None,
    "options_age_s": None,
    "data_integrity": "red",  # green | amber | red
    # Exposures
    "net_gex": None,
    "net_vex": None,
    "net_cex": None,  # N/A unless Polygon provides needed greek
    "net_delta": None,
    "d_gex": None,
    "d_delta": None,
    # Vol regime
    "vol_short": None,
    "vol_long": None,
    "vol_rising": None,
    # Alert state
    "regime": "NEUTRAL",  # PRE | FLUSH | CHARM | NEUTRAL
    "trigger_text": "NEUTRAL: Wait for structure.",
    "why": [],
    "scenario": None,
    "last_alert_id": None,
    # For UI charts
    "spot_series": [],  # list[{ts_ms, price}]
    "vol_series": [],  # list[{ts_ms, vol_short, vol_long}]
}


# -----------------------------------------------------------------------------
# Config


@dataclass(frozen=True)
class TitanConfig:
    polygon_api_key: str
    db_path: str
    static_dir: str
    spot_symbol: str = "SPY"  # SPX via SPY proxy (as requested)
    options_underlying: str = "SPY"
    marketstatus_url: str = "https://api.polygon.io/v1/marketstatus/now"
    last_trade_url: str = "https://api.polygon.io/v2/last/trade/{ticker}"
    aggs_url: str = "https://api.polygon.io/v2/aggs/ticker/{ticker}/range/1/minute/{from_}/{to_}"
    options_snapshot_url: str = (
        "https://api.polygon.io/v3/snapshot/options/{underlying}"
    )
    # Engine cadence
    poll_s: float = 2.0
    # "0.05%" stall threshold default from spec
    spot_stall_threshold_frac: float = 0.0005
    # Percentile for d_delta trigger
    d_delta_percentile: float = 90.0
    # Rolling windows
    deriv_window_minutes: int = 30
    spot_stall_lookback_s: int = 30
    # Integrity thresholds
    spot_max_age_s: int = 10
    options_max_age_s: int = 180
    # Alert cooldowns
    pre_cooldown_s: int = 60
    flush_cooldown_s: int = 120
    charm_cooldown_s: int = 120
    # Outcome evaluator
    evaluator_poll_s: float = 45.0


# -----------------------------------------------------------------------------
# SQLite (TitanArchive)


def _db_connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    return conn


def migrate_sqlite(db_path: str) -> None:
    """
    Safe to run multiple times.
    """
    conn = _db_connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS alerts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL,
              regime TEXT NOT NULL,
              message TEXT NOT NULL,
              trigger_text TEXT,
              scenario TEXT,
              why_json TEXT,
              spot REAL,
              net_gex REAL,
              net_vex REAL,
              net_cex REAL,
              net_delta REAL,
              d_gex REAL,
              d_delta REAL,
              vol_short REAL,
              vol_long REAL,
              vol_rising INTEGER
            );
            """
        )
        # Safe column add for existing DBs (SQLite has no IF NOT EXISTS for columns).
        try:
            conn.execute("ALTER TABLE alerts ADD COLUMN scenario TEXT;")
        except Exception:
            pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS outcomes (
              alert_id INTEGER NOT NULL,
              horizon_minutes INTEGER NOT NULL,
              moved_15pt_equiv INTEGER NOT NULL,
              max_favor REAL,
              max_adverse REAL,
              evaluated_ts TEXT NOT NULL,
              PRIMARY KEY (alert_id, horizon_minutes),
              FOREIGN KEY (alert_id) REFERENCES alerts(id)
            );
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts);"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_alerts_regime ON alerts(regime);"
        )
        conn.commit()
    finally:
        conn.close()


# -----------------------------------------------------------------------------
# Polygon helpers (REAL data only)


async def polygon_get_json(
    client: httpx.AsyncClient,
    url: str,
    api_key: str,
    params: Optional[Dict[str, Any]] = None,
    timeout_s: float = 8.0,
) -> Dict[str, Any]:
    p = dict(params or {})
    p["apiKey"] = api_key
    r = await client.get(url, params=p, timeout=timeout_s)
    r.raise_for_status()
    return r.json()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _ts_ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


async def fetch_market_session(
    client: httpx.AsyncClient, cfg: TitanConfig
) -> Tuple[str, Optional[str]]:
    try:
        data = await polygon_get_json(client, cfg.marketstatus_url, cfg.polygon_api_key)
        # Polygon's response includes keys like: market, earlyHours, afterHours
        # We normalize to OPEN/CLOSED/UNKNOWN for UI.
        if isinstance(data, dict) and data.get("market") in ("open", "closed"):
            sess = "OPEN" if data["market"] == "open" else "CLOSED"
            return sess, None
        return "UNKNOWN", "Polygon marketstatus missing 'market' field"
    except Exception as e:  # defensive
        return "UNKNOWN", f"marketstatus error: {type(e).__name__}"


async def fetch_last_trade(
    client: httpx.AsyncClient, cfg: TitanConfig, ticker: str
) -> Tuple[Optional[float], Optional[int], Optional[str]]:
    """
    Returns (price, ts_ms, reason_if_missing).
    """
    try:
        url = cfg.last_trade_url.format(ticker=ticker)
        data = await polygon_get_json(client, url, cfg.polygon_api_key)
        last = (data or {}).get("last")
        if not last:
            return None, None, "Polygon last trade missing 'last'"
        price = last.get("price")
        ts = last.get("timestamp")
        if price is None or ts is None:
            return None, None, "Polygon last trade missing price/timestamp"
        return float(price), int(ts), None
    except Exception as e:
        return None, None, f"last trade error: {type(e).__name__}"


async def fetch_aggs_1m(
    client: httpx.AsyncClient,
    cfg: TitanConfig,
    ticker: str,
    start_utc: datetime,
    end_utc: datetime,
    limit: int = 50000,
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """
    Polygon v2 aggs range endpoint supports {from}/{to} as timestamps (ms) or dates.
    We use ms to avoid date-boundary ambiguity.
    """
    try:
        url = cfg.aggs_url.format(
            ticker=ticker,
            from_=str(_ts_ms(start_utc)),
            to_=str(_ts_ms(end_utc)),
        )
        params = {
            "adjusted": "true",
            "sort": "asc",
            "limit": str(limit),
        }
        data = await polygon_get_json(client, url, cfg.polygon_api_key, params=params)
        results = (data or {}).get("results") or []
        if not results:
            return [], None
        # Each result has: t,o,h,l,c,v,vw,n
        return results, None
    except Exception as e:
        return None, f"aggs error: {type(e).__name__}"


async def fetch_options_snapshot_page(
    client: httpx.AsyncClient,
    cfg: TitanConfig,
    underlying: str,
    next_url: Optional[str] = None,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    try:
        if next_url:
            data = await polygon_get_json(client, next_url, cfg.polygon_api_key)
        else:
            url = cfg.options_snapshot_url.format(underlying=underlying)
            # Keep payload manageable; we only need live-ish OI+greeks.
            params = {"limit": "250"}
            data = await polygon_get_json(client, url, cfg.polygon_api_key, params=params)
        return data, None
    except Exception as e:
        return None, f"options snapshot error: {type(e).__name__}"


# -----------------------------------------------------------------------------
# Computations (defensive, vectorized)


def _format_integrity(spot_valid: bool, spot_age_s: Optional[float], options_age_s: Optional[float], cfg: TitanConfig) -> str:
    if not spot_valid or spot_age_s is None:
        return "red"
    if spot_age_s <= cfg.spot_max_age_s and (options_age_s is not None and options_age_s <= cfg.options_max_age_s):
        return "green"
    if spot_age_s <= (cfg.spot_max_age_s * 3):
        return "amber"
    return "red"


def compute_realized_vol(closings: np.ndarray) -> Optional[float]:
    if closings.size < 3:
        return None
    rets = np.diff(closings) / closings[:-1]
    if rets.size < 2:
        return None
    return float(np.std(rets, ddof=1))


def compute_atr_proxy(ohlc: np.ndarray) -> Optional[float]:
    """
    ohlc shape: (N, 4) -> O,H,L,C
    """
    if ohlc.shape[0] < 3:
        return None
    high = ohlc[:, 1]
    low = ohlc[:, 2]
    close = ohlc[:, 3]
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))
    return float(np.mean(tr))


def compute_exposures_from_snapshot(
    snapshot_results: List[Dict[str, Any]],
    spot: float,
) -> Tuple[Dict[str, Optional[float]], int, Optional[str], Optional[float]]:
    """
    Returns:
      exposures dict: net_gex/net_vex/net_cex/net_delta (None if can't compute)
      contracts_processed
      reason_if_degraded
      options_age_s (None if can't compute)
    """
    if not snapshot_results:
        return {"net_gex": None, "net_vex": None, "net_cex": None, "net_delta": None}, 0, "options snapshot empty", None

    # Only use contracts that have OI and greeks.
    oi = []
    delta = []
    gamma = []
    vega = []
    last_updated_ms = []

    for row in snapshot_results:
        details = row.get("details") or {}
        greeks = row.get("greeks") or {}
        day = row.get("day") or {}

        # Polygon's snapshot typically provides open_interest at the top-level, but be defensive.
        open_interest = row.get("open_interest")
        if open_interest is None:
            open_interest = day.get("open_interest")
        if open_interest is None:
            continue

        d = greeks.get("delta")
        g = greeks.get("gamma")
        v = greeks.get("vega")

        if d is None and g is None and v is None:
            continue

        oi.append(float(open_interest))
        delta.append(np.nan if d is None else float(d))
        gamma.append(np.nan if g is None else float(g))
        vega.append(np.nan if v is None else float(v))

        lm = row.get("last_updated")
        if isinstance(lm, int):
            last_updated_ms.append(lm)

    if not oi:
        return {"net_gex": None, "net_vex": None, "net_cex": None, "net_delta": None}, 0, "no option contracts with OI+greeks", None

    oi_a = np.asarray(oi, dtype=np.float64)
    d_a = np.asarray(delta, dtype=np.float64)
    g_a = np.asarray(gamma, dtype=np.float64)
    v_a = np.asarray(vega, dtype=np.float64)

    # Contract multiplier is 100 shares for equity options.
    multiplier = 100.0

    # net_delta: shares-equivalent exposure (OI * 100 * delta)
    net_delta = float(np.nansum(oi_a * multiplier * d_a))

    # net_gex: dollar gamma per $1 move (OI*100*gamma*spot^2).
    # NOTE: This is a standard, conservative definition; it's not "per 1% move" scaled.
    net_gex = float(np.nansum(oi_a * multiplier * g_a * (spot ** 2)))

    # net_vex: dollar vega per 1 vol point (OI*100*vega).
    net_vex = float(np.nansum(oi_a * multiplier * v_a))

    # net_cex requires charm (dDelta/dt) which Polygon snapshots do not reliably provide.
    net_cex = None

    age_s = None
    if last_updated_ms:
        newest_ms = max(last_updated_ms)
        age_s = max(0.0, (time.time() * 1000.0 - newest_ms) / 1000.0)

    return (
        {"net_gex": net_gex, "net_vex": net_vex, "net_cex": net_cex, "net_delta": net_delta},
        int(len(oi)),
        None,
        age_s,
    )


# -----------------------------------------------------------------------------
# Alerts + Outcomes


def insert_alert(db_path: str, payload: Dict[str, Any]) -> int:
    conn = _db_connect(db_path)
    try:
        cur = conn.execute(
            """
            INSERT INTO alerts (
              ts, regime, message, trigger_text, scenario, why_json,
              spot, net_gex, net_vex, net_cex, net_delta,
              d_gex, d_delta, vol_short, vol_long, vol_rising
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                payload["ts"],
                payload["regime"],
                payload["message"],
                payload.get("trigger_text"),
                payload.get("scenario"),
                json.dumps(payload.get("why") or []),
                payload.get("spot"),
                payload.get("net_gex"),
                payload.get("net_vex"),
                payload.get("net_cex"),
                payload.get("net_delta"),
                payload.get("d_gex"),
                payload.get("d_delta"),
                payload.get("vol_short"),
                payload.get("vol_long"),
                None if payload.get("vol_rising") is None else (1 if payload.get("vol_rising") else 0),
            ),
        )
        conn.commit()
        return int(cur.lastrowid)
    finally:
        conn.close()


def fetch_alerts(db_path: str, limit: int) -> List[Dict[str, Any]]:
    conn = _db_connect(db_path)
    try:
        rows = conn.execute(
            """
            SELECT id, ts, regime, message, trigger_text, scenario, why_json, spot
            FROM alerts
            ORDER BY id DESC
            LIMIT ?
            """,
            (int(limit),),
        ).fetchall()
        out: List[Dict[str, Any]] = []
        for r in rows:
            out.append(
                {
                    "id": r["id"],
                    "ts": r["ts"],
                    "regime": r["regime"],
                    "message": r["message"],
                    "trigger_text": r["trigger_text"],
                    "scenario": r["scenario"],
                    "why": json.loads(r["why_json"] or "[]"),
                    "spot": r["spot"],
                }
            )
        return out
    finally:
        conn.close()


def compute_stats(db_path: str) -> Dict[str, Any]:
    conn = _db_connect(db_path)
    try:
        # Aggregate hit-rate by regime + horizon
        rows = conn.execute(
            """
            SELECT a.regime AS regime,
                   o.horizon_minutes AS horizon_minutes,
                   COUNT(*) AS n,
                   SUM(o.moved_15pt_equiv) AS hits
            FROM outcomes o
            JOIN alerts a ON a.id = o.alert_id
            WHERE a.regime IN ('PRE','FLUSH','CHARM')
              AND o.horizon_minutes IN (30,60)
            GROUP BY a.regime, o.horizon_minutes
            """
        ).fetchall()

        # Initialize structure
        stats: Dict[str, Any] = {
            "asof": _iso(_utc_now()),
            "by_regime": {
                "PRE": {"30m": {"hit_rate": None, "n": 0}, "60m": {"hit_rate": None, "n": 0}},
                "FLUSH": {"30m": {"hit_rate": None, "n": 0}, "60m": {"hit_rate": None, "n": 0}},
                "CHARM": {"30m": {"hit_rate": None, "n": 0}, "60m": {"hit_rate": None, "n": 0}},
            },
        }
        for r in rows:
            regime = r["regime"]
            horizon = int(r["horizon_minutes"])
            n = int(r["n"] or 0)
            hits = int(r["hits"] or 0)
            key = "30m" if horizon == 30 else "60m"
            stats["by_regime"][regime][key]["n"] = n
            stats["by_regime"][regime][key]["hit_rate"] = None if n == 0 else float(hits) / float(n)

        # Convenience fields matching the requested shape (still backed by the same DB rows).
        stats["summary"] = {}
        for regime in ("PRE", "FLUSH", "CHARM"):
            r30 = stats["by_regime"][regime]["30m"]
            r60 = stats["by_regime"][regime]["60m"]
            stats["summary"][regime] = {
                "hit_rate_30m": r30["hit_rate"],
                "hit_rate_60m": r60["hit_rate"],
                "n_30m": r30["n"],
                "n_60m": r60["n"],
            }
        return stats
    finally:
        conn.close()


def outcomes_missing_for_alert(conn: sqlite3.Connection, alert_id: int, horizon: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM outcomes WHERE alert_id=? AND horizon_minutes=?",
        (alert_id, horizon),
    ).fetchone()
    return row is None


async def evaluate_alert_outcomes(
    client: httpx.AsyncClient,
    cfg: TitanConfig,
    alert_row: sqlite3.Row,
) -> List[Tuple[int, int, int, Optional[float], Optional[float], str]]:
    """
    Returns list of rows to upsert into outcomes:
      (alert_id, horizon_minutes, moved_15pt_equiv, max_favor, max_adverse, evaluated_ts)
    """
    alert_id = int(alert_row["id"])
    ts = datetime.fromisoformat(alert_row["ts"]).astimezone(timezone.utc)
    spot_at_alert = alert_row["spot"]
    if spot_at_alert is None:
        # Without spot, we still try to evaluate using first bar close; if no bars -> N/A (skip insert).
        pass

    evaluated_ts = _iso(_utc_now())

    # Mapping rule (Polygon-only, no synthetic fallback):
    # We map 15 SPX points to SPY points via ratio SPY/SPX using Polygon last-trade for both.
    spy_price_now, _, _ = await fetch_last_trade(client, cfg, cfg.spot_symbol)
    spx_price, _, _ = await fetch_last_trade(client, cfg, "I:SPX")
    if spy_price_now is None or spx_price is None or not (float(spx_price) > 0):
        # Cannot evaluate without real mapping inputs; do not insert synthetic outcomes.
        return []
    spy_threshold = 15.0 * (float(spy_price_now) / float(spx_price))

    rows_to_insert: List[Tuple[int, int, int, Optional[float], Optional[float], str]] = []
    for horizon in (30, 60):
        end = ts + timedelta(minutes=horizon)
        aggs, err = await fetch_aggs_1m(client, cfg, cfg.spot_symbol, ts, end)
        if aggs is None:
            # Can't evaluate horizon; do not insert synthetic outcomes.
            continue
        if not aggs:
            continue

        closes = np.asarray([float(x["c"]) for x in aggs if x.get("c") is not None], dtype=np.float64)
        if closes.size < 2:
            continue

        base = float(spot_at_alert) if spot_at_alert is not None else float(closes[0])
        max_up = float(np.max(closes) - base)
        max_down = float(np.min(closes) - base)  # negative or 0
        moved = 1 if max(max_up, abs(max_down)) >= float(spy_threshold) else 0
        rows_to_insert.append((alert_id, horizon, moved, max_up, max_down, evaluated_ts))

    return rows_to_insert


# -----------------------------------------------------------------------------
# Engine


class TitanEngine:
    def __init__(self, cfg: TitanConfig):
        self.cfg = cfg
        self._spot_hist: Deque[Tuple[float, float]] = deque(maxlen=6000)  # (ts_s, price)
        self._exposure_hist: Deque[Tuple[float, float, float]] = deque(maxlen=6000)  # (ts_s, net_gex, net_delta)
        self._deriv_hist: Deque[Tuple[float, float, float]] = deque(maxlen=6000)  # (ts_s, d_gex, d_delta)
        self._last_log_s = 0.0
        self._last_pre_s = 0.0
        self._last_flush_s = 0.0
        self._last_charm_s = 0.0
        self._last_emit_id: Optional[int] = None
        self._last_aggs_fetch_s = 0.0
        self._last_options_fetch_s = 0.0
        self._cached_aggs: Optional[List[Dict[str, Any]]] = None
        self._cached_aggs_err: Optional[str] = None
        self._cached_options: Optional[List[Dict[str, Any]]] = None
        self._cached_options_err: Optional[str] = None

    def _update_series(self, now: datetime, spot: float, vol_short: Optional[float], vol_long: Optional[float]) -> None:
        # Keep small series for UI streaming.
        ms = _ts_ms(now)
        GLOBAL_STATE["spot_series"] = (GLOBAL_STATE.get("spot_series") or [])[-1200:]
        GLOBAL_STATE["spot_series"].append({"ts_ms": ms, "price": spot})
        if vol_short is not None or vol_long is not None:
            GLOBAL_STATE["vol_series"] = (GLOBAL_STATE.get("vol_series") or [])[-1200:]
            GLOBAL_STATE["vol_series"].append({"ts_ms": ms, "vol_short": vol_short, "vol_long": vol_long})

    def _compute_derivatives(self, now_s: float, net_gex: Optional[float], net_delta: Optional[float]) -> Tuple[Optional[float], Optional[float]]:
        if net_gex is None or net_delta is None:
            return None, None
        if not self._exposure_hist:
            self._exposure_hist.append((now_s, net_gex, net_delta))
            return None, None
        prev_t, prev_gex, prev_delta = self._exposure_hist[-1]
        dt = max(1e-6, now_s - prev_t)
        d_gex = (net_gex - prev_gex) / dt
        d_delta = (net_delta - prev_delta) / dt
        self._exposure_hist.append((now_s, net_gex, net_delta))
        self._deriv_hist.append((now_s, float(d_gex), float(d_delta)))
        return float(d_gex), float(d_delta)

    def _spot_stall(self, now_s: float, spot: float) -> Tuple[Optional[bool], Optional[float]]:
        if not self._spot_hist:
            return None, None
        lookback = self.cfg.spot_stall_lookback_s
        target_t = now_s - float(lookback)
        # Find the closest point <= target_t from the right.
        spot_then = None
        for t, p in reversed(self._spot_hist):
            if t <= target_t:
                spot_then = p
                break
        if spot_then is None:
            return None, None
        frac = abs(spot - spot_then) / max(1e-9, spot_then)
        return bool(frac < self.cfg.spot_stall_threshold_frac), float(frac)

    def _d_delta_threshold(self, now_s: float) -> Optional[float]:
        window_s = float(self.cfg.deriv_window_minutes) * 60.0
        cutoff = now_s - window_s
        if len(self._deriv_hist) < 5:
            return None
        recent = [abs(dd) for (t, _, dd) in self._deriv_hist if t >= cutoff and dd is not None]
        if len(recent) < 20:
            return None
        return float(np.percentile(np.asarray(recent, dtype=np.float64), self.cfg.d_delta_percentile))

    def _scenario_text(
        self,
        regime: str,
        net_gex: Optional[float],
        d_delta: Optional[float],
        vol_rising: Optional[bool],
        spot_stall: Optional[bool],
    ) -> Optional[str]:
        # Polygon-only computed heuristics; always presented as "likely", never as certainty.
        if regime == "PRE":
            if d_delta is None:
                return "Likely move risk building, but d_delta unavailable."
            if d_delta > 0:
                return "Likely UP risk: accelerating hedging demand while spot stalls."
            return "Likely DOWN risk: accelerating hedge selling pressure while spot stalls."
        if regime == "FLUSH":
            return "Likely downside continuation: vol expansion + destabilizing hedging flow."
        if regime == "CHARM":
            return "Likely mean-reversion: stabilizing flow with supportive gamma profile."
        # Neutral context
        if vol_rising is True:
            return "Neutral, but vol is rising: expect wider swings; wait for confirmation."
        if net_gex is not None and net_gex > 0:
            return "Neutral, slight mean-reversion bias (positive gamma profile)."
        if net_gex is not None and net_gex < 0:
            return "Neutral, higher trend risk (negative gamma profile)."
        return None

    def _should_emit(self, regime: str) -> bool:
        now_s = time.time()
        if regime == "PRE":
            return (now_s - self._last_pre_s) >= float(self.cfg.pre_cooldown_s)
        if regime == "FLUSH":
            return (now_s - self._last_flush_s) >= float(self.cfg.flush_cooldown_s)
        if regime == "CHARM":
            return (now_s - self._last_charm_s) >= float(self.cfg.charm_cooldown_s)
        return True

    def _mark_emit(self, regime: str) -> None:
        now_s = time.time()
        if regime == "PRE":
            self._last_pre_s = now_s
        elif regime == "FLUSH":
            self._last_flush_s = now_s
        elif regime == "CHARM":
            self._last_charm_s = now_s

    async def run_forever(self) -> None:
        cfg = self.cfg
        migrate_sqlite(cfg.db_path)

        async with httpx.AsyncClient() as client:
            while True:
                t0 = time.perf_counter()
                loop_reason: Optional[str] = None

                # Holiday-safe: rely on Polygon market status. Also handle Dec 25 explicitly.
                now = _utc_now()
                if now.month == 12 and now.day == 25:
                    GLOBAL_STATE["market_session"] = "CLOSED"
                    GLOBAL_STATE["engine_status"] = "MARKET_CLOSED"
                    GLOBAL_STATE["engine_reason"] = "Holiday (Dec 25)"
                    await asyncio.sleep(max(5.0, cfg.poll_s))
                    continue

                market_session, market_reason = await fetch_market_session(client, cfg)
                GLOBAL_STATE["market_session"] = market_session
                if market_session == "UNKNOWN" and market_reason:
                    loop_reason = market_reason

                if market_session == "CLOSED":
                    GLOBAL_STATE["engine_status"] = "MARKET_CLOSED"
                    GLOBAL_STATE["engine_reason"] = "Market closed"
                    # Do not compute; UI must show archive instead.
                    await asyncio.sleep(max(5.0, cfg.poll_s))
                    continue

                # Spot
                spot, spot_ts_ms, spot_err = await fetch_last_trade(client, cfg, cfg.spot_symbol)
                if spot is None or spot_ts_ms is None:
                    GLOBAL_STATE["spot"] = None
                    GLOBAL_STATE["spot_valid"] = False
                    GLOBAL_STATE["spot_age_s"] = None
                    GLOBAL_STATE["engine_status"] = "DEGRADED"
                    GLOBAL_STATE["engine_reason"] = spot_err or "spot missing"
                    await asyncio.sleep(cfg.poll_s)
                    continue

                now_ms = int(time.time() * 1000.0)
                spot_age_s = max(0.0, (now_ms - int(spot_ts_ms)) / 1000.0)
                GLOBAL_STATE["spot"] = float(spot)
                GLOBAL_STATE["spot_valid"] = bool(spot_age_s <= (cfg.spot_max_age_s * 6))
                GLOBAL_STATE["spot_age_s"] = float(spot_age_s)

                now_s = time.time()
                self._spot_hist.append((now_s, float(spot)))

                # Vol regime from 1m aggs (last 60 minutes), cached to stay smooth.
                if (now_s - self._last_aggs_fetch_s) >= 15.0 or self._cached_aggs is None:
                    self._last_aggs_fetch_s = now_s
                    self._cached_aggs, self._cached_aggs_err = await fetch_aggs_1m(
                        client,
                        cfg,
                        cfg.spot_symbol,
                        now - timedelta(minutes=65),
                        now,
                    )
                aggs, aggs_err = self._cached_aggs, self._cached_aggs_err
                vol_short = None
                vol_long = None
                vol_rising = None
                if aggs is not None and aggs:
                    closes = np.asarray([float(x["c"]) for x in aggs if x.get("c") is not None], dtype=np.float64)
                    if closes.size:
                        GLOBAL_STATE["last_close"] = float(closes[-1])
                    ohlc = np.asarray(
                        [[float(x["o"]), float(x["h"]), float(x["l"]), float(x["c"])] for x in aggs if x.get("c") is not None],
                        dtype=np.float64,
                    )
                    # Use last 5 and last 30 minutes
                    vol_short = compute_realized_vol(closes[-6:])  # ~5 returns
                    vol_long = compute_realized_vol(closes[-31:])
                    atr_short = compute_atr_proxy(ohlc[-6:])
                    atr_long = compute_atr_proxy(ohlc[-31:])
                    if vol_short is not None and vol_long is not None:
                        vol_rising = bool(vol_short > vol_long)
                    elif atr_short is not None and atr_long is not None:
                        vol_rising = bool(atr_short > atr_long)
                else:
                    loop_reason = aggs_err or "missing aggs"

                GLOBAL_STATE["vol_short"] = vol_short
                GLOBAL_STATE["vol_long"] = vol_long
                GLOBAL_STATE["vol_rising"] = vol_rising

                # Options snapshot -> exposures (cached to reduce API load; still Polygon realtime).
                snap_err = None
                snapshot_results: List[Dict[str, Any]] = []
                options_age_s = None
                if (now_s - self._last_options_fetch_s) >= 10.0 or self._cached_options is None:
                    self._last_options_fetch_s = now_s
                    snap_first, snap_err = await fetch_options_snapshot_page(client, cfg, cfg.options_underlying)
                    snapshot_results = []
                    next_url = None
                    if snap_first and isinstance(snap_first, dict):
                        snapshot_results.extend(snap_first.get("results") or [])
                        next_url = snap_first.get("next_url")
                    else:
                        snap_err = snap_err or "options snapshot missing"

                    # Pull up to 3 pages max to avoid heavy loops.
                    pages = 1
                    while next_url and pages < 3:
                        snap, _err = await fetch_options_snapshot_page(client, cfg, cfg.options_underlying, next_url=next_url)
                        if not snap or not isinstance(snap, dict):
                            break
                        snapshot_results.extend(snap.get("results") or [])
                        next_url = snap.get("next_url")
                        pages += 1

                    self._cached_options = snapshot_results
                    self._cached_options_err = snap_err
                else:
                    snapshot_results = self._cached_options or []
                    snap_err = self._cached_options_err

                exposures_t0 = time.perf_counter()
                exposures, n_contracts, exp_reason, options_age_s = compute_exposures_from_snapshot(
                    snapshot_results, float(spot)
                )
                GLOBAL_STATE["exposures_ms"] = float((time.perf_counter() - exposures_t0) * 1000.0)
                GLOBAL_STATE["contracts_processed"] = int(n_contracts)
                GLOBAL_STATE["options_age_s"] = options_age_s

                GLOBAL_STATE["net_gex"] = exposures.get("net_gex")
                GLOBAL_STATE["net_vex"] = exposures.get("net_vex")
                GLOBAL_STATE["net_cex"] = exposures.get("net_cex")
                GLOBAL_STATE["net_delta"] = exposures.get("net_delta")

                d_gex, d_delta = self._compute_derivatives(now_s, exposures.get("net_gex"), exposures.get("net_delta"))
                GLOBAL_STATE["d_gex"] = d_gex
                GLOBAL_STATE["d_delta"] = d_delta

                stall, stall_frac = self._spot_stall(now_s, float(spot))
                d_delta_thr = self._d_delta_threshold(now_s)

                # Determine engine health
                if not GLOBAL_STATE["spot_valid"]:
                    GLOBAL_STATE["engine_status"] = "DEGRADED"
                    GLOBAL_STATE["engine_reason"] = "spot stale"
                elif exp_reason is not None:
                    GLOBAL_STATE["engine_status"] = "DEGRADED"
                    GLOBAL_STATE["engine_reason"] = exp_reason
                elif snap_err is not None and not snapshot_results:
                    GLOBAL_STATE["engine_status"] = "DEGRADED"
                    GLOBAL_STATE["engine_reason"] = snap_err
                else:
                    GLOBAL_STATE["engine_status"] = "OK"
                    GLOBAL_STATE["engine_reason"] = loop_reason

                GLOBAL_STATE["data_integrity"] = _format_integrity(
                    GLOBAL_STATE["spot_valid"],
                    GLOBAL_STATE["spot_age_s"],
                    GLOBAL_STATE["options_age_s"],
                    cfg,
                )

                # Timestamp fields for UI (NY time formatting is done client-side)
                GLOBAL_STATE["last_tick_ny"] = spot_ts_ms
                GLOBAL_STATE["latency_ms"] = int(spot_age_s * 1000.0)

                self._update_series(now, float(spot), vol_short, vol_long)

                # Alert logic (defensive, no synthetic values)
                why: List[str] = []
                regime = "NEUTRAL"
                trigger_text = "NEUTRAL: Wait for structure."
                message = None
                scenario = None

                # PRE: d_delta acceleration above rolling percentile + spot stall
                if (
                    d_delta is not None
                    and stall is True
                    and d_delta_thr is not None
                    and abs(d_delta) > float(d_delta_thr)
                ):
                    regime = "PRE"
                    trigger_text = "STAY SHARP: Hedge pressure building."
                    message = "HEDGE PRESSURE BUILDING: Delta hedging accelerating while spot stalls."
                    why = [
                        f"abs(d_delta)={abs(d_delta):.2f} > p{cfg.d_delta_percentile:.0f}={d_delta_thr:.2f}",
                        f"spot_stall=True (30s move={stall_frac:.5f})",
                    ]
                    scenario = self._scenario_text(regime, exposures.get("net_gex"), d_delta, vol_rising, stall)

                # FLUSH: only if vol_rising true
                # Heuristic: negative net_gex + downside acceleration (d_delta negative) suggests forced dealer selling.
                if (
                    message is None
                    and vol_rising is True
                    and exposures.get("net_gex") is not None
                    and exposures.get("net_delta") is not None
                    and d_delta is not None
                    and exposures["net_gex"] < 0
                    and d_delta < 0
                    and abs(d_delta) > (d_delta_thr or 0.0)
                ):
                    regime = "FLUSH"
                    trigger_text = "FADE THE RIP: Forced Dealer Selling."
                    message = "FLUSH: Vol rising with negative gamma and accelerating delta-hedge selling."
                    why = [
                        "vol_rising=True (anti-chop filter)",
                        "net_gex<0 (short gamma)",
                        "d_delta<0 (hedge selling accelerating)",
                    ]
                    scenario = self._scenario_text(regime, exposures.get("net_gex"), d_delta, vol_rising, stall)

                # CHARM: only if vol_rising false OR mean-reverting (optional)
                # Heuristic: positive net_gex + non-rising vol + stabilizing d_delta -> time-decay support.
                if (
                    message is None
                    and (vol_rising is False or vol_rising is None)
                    and exposures.get("net_gex") is not None
                    and exposures["net_gex"] > 0
                    and d_delta is not None
                    and abs(d_delta) < (d_delta_thr or float("inf"))
                ):
                    regime = "CHARM"
                    trigger_text = "BUY THE DIP: Time-Decay Support."
                    message = "CHARM: Vol not rising with positive gamma and stabilizing hedging flow."
                    why = [
                        "vol_rising=False (chop/mean-reversion allowed)",
                        "net_gex>0 (long gamma support)",
                        "abs(d_delta) below acceleration threshold",
                    ]
                    scenario = self._scenario_text(regime, exposures.get("net_gex"), d_delta, vol_rising, stall)

                # Emit alert (with cooldown, and only if computed inputs exist)
                if message is not None and self._should_emit(regime):
                    self._mark_emit(regime)
                    alert_payload = {
                        "ts": _iso(now),
                        "regime": regime,
                        "message": message,
                        "trigger_text": trigger_text,
                        "scenario": scenario,
                        "why": why,
                        "spot": float(spot),
                        "net_gex": exposures.get("net_gex"),
                        "net_vex": exposures.get("net_vex"),
                        "net_cex": exposures.get("net_cex"),
                        "net_delta": exposures.get("net_delta"),
                        "d_gex": d_gex,
                        "d_delta": d_delta,
                        "vol_short": vol_short,
                        "vol_long": vol_long,
                        "vol_rising": vol_rising,
                    }
                    alert_id = insert_alert(cfg.db_path, alert_payload)
                    self._last_emit_id = alert_id
                    GLOBAL_STATE["last_alert_id"] = alert_id
                    GLOBAL_STATE["regime"] = regime
                    GLOBAL_STATE["trigger_text"] = trigger_text
                    GLOBAL_STATE["why"] = why
                    GLOBAL_STATE["scenario"] = scenario
                else:
                    GLOBAL_STATE["regime"] = regime
                    GLOBAL_STATE["trigger_text"] = trigger_text
                    GLOBAL_STATE["why"] = why
                    GLOBAL_STATE["scenario"] = self._scenario_text(regime, exposures.get("net_gex"), d_delta, vol_rising, stall)

                # Periodic log (max 1/min)
                now_log = time.time()
                if now_log - self._last_log_s >= 60.0:
                    self._last_log_s = now_log
                    logger.info(
                        "status=%s session=%s spot=%s spot_age=%.1fs opt_age=%s integrity=%s regime=%s last_alert=%s",
                        GLOBAL_STATE.get("engine_status"),
                        GLOBAL_STATE.get("market_session"),
                        GLOBAL_STATE.get("spot"),
                        GLOBAL_STATE.get("spot_age_s") or -1.0,
                        GLOBAL_STATE.get("options_age_s"),
                        GLOBAL_STATE.get("data_integrity"),
                        GLOBAL_STATE.get("regime"),
                        GLOBAL_STATE.get("last_alert_id"),
                    )

                GLOBAL_STATE["loop_ms"] = float((time.perf_counter() - t0) * 1000.0)
                await asyncio.sleep(cfg.poll_s)


async def outcomes_evaluator_forever(cfg: TitanConfig) -> None:
    migrate_sqlite(cfg.db_path)
    async with httpx.AsyncClient() as client:
        while True:
            try:
                conn = _db_connect(cfg.db_path)
                try:
                    # Find alerts older than 60m and missing at least one outcome row.
                    cutoff = _utc_now() - timedelta(minutes=65)
                    rows = conn.execute(
                        """
                        SELECT id, ts, spot
                        FROM alerts
                        WHERE ts <= ?
                          AND regime IN ('PRE','FLUSH','CHARM')
                        ORDER BY id DESC
                        LIMIT 50
                        """,
                        (_iso(cutoff),),
                    ).fetchall()

                    for r in rows:
                        alert_id = int(r["id"])
                        for horizon in (30, 60):
                            if outcomes_missing_for_alert(conn, alert_id, horizon):
                                to_insert = await evaluate_alert_outcomes(client, cfg, r)
                                if not to_insert:
                                    continue
                                for (aid, hm, moved, mf, ma, ets) in to_insert:
                                    conn.execute(
                                        """
                                        INSERT OR REPLACE INTO outcomes (
                                          alert_id, horizon_minutes, moved_15pt_equiv,
                                          max_favor, max_adverse, evaluated_ts
                                        ) VALUES (?,?,?,?,?,?)
                                        """,
                                        (aid, hm, moved, mf, ma, ets),
                                    )
                                conn.commit()
                finally:
                    conn.close()
            except Exception:
                logger.exception("outcomes evaluator error")

            await asyncio.sleep(cfg.evaluator_poll_s)


# -----------------------------------------------------------------------------
# FastAPI app


def build_app(cfg: TitanConfig) -> FastAPI:
    app = FastAPI(title="TITAN OMEGA v17.5", version="17.5")

    static_dir = cfg.static_dir
    if os.path.isdir(static_dir):
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.on_event("startup")
    async def _startup() -> None:
        logging.basicConfig(
            level=os.getenv("TITAN_LOG_LEVEL", "INFO").upper(),
            format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        )
        migrate_sqlite(cfg.db_path)
        asyncio.create_task(TitanEngine(cfg).run_forever())
        asyncio.create_task(outcomes_evaluator_forever(cfg))

    @app.get("/", response_class=HTMLResponse)
    async def index() -> str:
        # Serve the terminal UI
        html_path = os.path.join(cfg.static_dir, "titan_terminal.html")
        if not os.path.exists(html_path):
            return "<h2>TITAN terminal UI missing</h2>"
        with open(html_path, "r", encoding="utf-8") as f:
            return f.read()

    @app.get("/health")
    async def health() -> JSONResponse:
        # Extended fields
        return JSONResponse(
            {
                "engine_status": GLOBAL_STATE.get("engine_status"),
                "engine_reason": GLOBAL_STATE.get("engine_reason"),
                "market_session": GLOBAL_STATE.get("market_session"),
                "ws_ok": GLOBAL_STATE.get("ws_ok"),
                "spot_valid": GLOBAL_STATE.get("spot_valid"),
                "spot_age_s": GLOBAL_STATE.get("spot_age_s"),
                "last_close": GLOBAL_STATE.get("last_close"),
                "options_age_s": GLOBAL_STATE.get("options_age_s"),
                "contracts_processed": GLOBAL_STATE.get("contracts_processed"),
                "exposures_ms": GLOBAL_STATE.get("exposures_ms"),
                "loop_ms": GLOBAL_STATE.get("loop_ms"),
                "last_alert_id": GLOBAL_STATE.get("last_alert_id"),
            }
        )

    @app.get("/archive/alerts")
    async def archive_alerts(limit: int = Query(default=10, ge=1, le=100)) -> JSONResponse:
        return JSONResponse({"alerts": fetch_alerts(cfg.db_path, limit=int(limit))})

    @app.get("/candles")
    async def candles(minutes: int = Query(default=240, ge=5, le=1440)) -> JSONResponse:
        """
        Optional 1m candles for the terminal chart (Polygon aggs).
        Returns Lightweight Charts candlestick format: {time, open, high, low, close}.
        """
        async with httpx.AsyncClient() as client:
            end = _utc_now()
            start = end - timedelta(minutes=int(minutes))
            aggs, err = await fetch_aggs_1m(client, cfg, cfg.spot_symbol, start, end)
            if aggs is None:
                return JSONResponse({"candles": [], "reason": err or "aggs unavailable"})
            candles_out = []
            for x in aggs:
                try:
                    t_ms = int(x["t"])
                    candles_out.append(
                        {
                            "time": int(t_ms // 1000),
                            "open": float(x["o"]),
                            "high": float(x["h"]),
                            "low": float(x["l"]),
                            "close": float(x["c"]),
                        }
                    )
                except Exception:
                    continue
            return JSONResponse({"candles": candles_out, "reason": None})

    @app.get("/stats")
    async def stats() -> JSONResponse:
        return JSONResponse(compute_stats(cfg.db_path))

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        await ws.accept()
        try:
            while True:
                # Stream GLOBAL_STATE (include required new fields)
                payload = {
                    # exposures
                    "net_gex": GLOBAL_STATE.get("net_gex"),
                    "net_vex": GLOBAL_STATE.get("net_vex"),
                    "net_cex": GLOBAL_STATE.get("net_cex"),
                    "net_delta": GLOBAL_STATE.get("net_delta"),
                    "d_gex": GLOBAL_STATE.get("d_gex"),
                    "d_delta": GLOBAL_STATE.get("d_delta"),
                    # vol regime
                    "vol_short": GLOBAL_STATE.get("vol_short"),
                    "vol_long": GLOBAL_STATE.get("vol_long"),
                    "vol_rising": GLOBAL_STATE.get("vol_rising"),
                    # engine
                    "regime": GLOBAL_STATE.get("regime"),
                    "trigger_text": GLOBAL_STATE.get("trigger_text"),
                    "engine_status": GLOBAL_STATE.get("engine_status"),
                    "engine_reason": GLOBAL_STATE.get("engine_reason"),
                    "market_session": GLOBAL_STATE.get("market_session"),
                    "last_tick_ny": GLOBAL_STATE.get("last_tick_ny"),
                    "latency_ms": GLOBAL_STATE.get("latency_ms"),
                    "data_integrity": GLOBAL_STATE.get("data_integrity"),
                    "spot": GLOBAL_STATE.get("spot"),
                    "spot_valid": GLOBAL_STATE.get("spot_valid"),
                    "spot_age_s": GLOBAL_STATE.get("spot_age_s"),
                    "last_close": GLOBAL_STATE.get("last_close"),
                    "options_age_s": GLOBAL_STATE.get("options_age_s"),
                    "ws_ok": True,
                    "contracts_processed": GLOBAL_STATE.get("contracts_processed"),
                    "exposures_ms": GLOBAL_STATE.get("exposures_ms"),
                    "loop_ms": GLOBAL_STATE.get("loop_ms"),
                    "last_alert_id": GLOBAL_STATE.get("last_alert_id"),
                    "why": GLOBAL_STATE.get("why") or [],
                    "scenario": GLOBAL_STATE.get("scenario"),
                    # charts
                    "spot_series": GLOBAL_STATE.get("spot_series") or [],
                    "vol_series": GLOBAL_STATE.get("vol_series") or [],
                }
                await ws.send_text(json.dumps(payload))
                await asyncio.sleep(0.2)  # 5 Hz; UI will throttle to 10fps max
        except WebSocketDisconnect:
            return
        except Exception:
            logger.exception("ws error")
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    return app


def _load_cfg() -> TitanConfig:
    api_key = os.getenv("POLYGON_API_KEY")
    if not api_key:
        raise RuntimeError("POLYGON_API_KEY env var is required (no hardcoding).")
    db_path = os.getenv("TITAN_DB_PATH", os.path.join(os.path.dirname(__file__), "TitanArchive.sqlite"))
    static_dir = os.getenv("TITAN_STATIC_DIR", os.path.join(os.path.dirname(__file__), "static"))
    return TitanConfig(polygon_api_key=api_key, db_path=db_path, static_dir=static_dir)


app = build_app(_load_cfg())

