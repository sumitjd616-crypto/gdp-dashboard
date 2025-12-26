from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

import pandas as pd
import requests
import streamlit as st
import yfinance as yf

try:
    # Optional dependency (declared in requirements.txt)
    from streamlit_autorefresh import st_autorefresh
except Exception:  # pragma: no cover
    st_autorefresh = None


st.set_page_config(page_title="SPX live 15+ move dashboard", page_icon="📈", layout="wide")


@dataclass(frozen=True)
class Quote:
    symbol: str
    last: float
    prev_close: float
    asof: datetime
    source: str

    @property
    def move_points(self) -> float:
        return self.last - self.prev_close

    @property
    def move_pct(self) -> float:
        if self.prev_close == 0:
            return 0.0
        return (self.last / self.prev_close - 1.0) * 100.0


def _get_polygon_api_key() -> str | None:
    # Streamlit secrets first, then env var
    key = None
    try:
        key = st.secrets.get("POLYGON_API_KEY")  # type: ignore[attr-defined]
    except Exception:
        key = None
    return key or os.getenv("POLYGON_API_KEY")


@st.cache_data(ttl=10)
def fetch_spx_quote_polygon(api_key: str) -> Quote:
    """
    Polygon index snapshot for SPX (ticker usually I:SPX).

    Note: exact real-time entitlements depend on your Polygon plan.
    """
    # Best-effort endpoint usage; keep it robust and fail with a clear message.
    url = "https://api.polygon.io/v3/snapshot/indices"
    params = {"ticker.any_of": "I:SPX", "apiKey": api_key}
    r = requests.get(url, params=params, timeout=10)
    if r.status_code != 200:
        raise RuntimeError(f"Polygon error {r.status_code}: {r.text[:300]}")
    payload = r.json()
    results = payload.get("results") or []
    if not results:
        raise RuntimeError("Polygon returned no results for I:SPX (check ticker/plan).")

    snap = results[0]
    # Fields can vary across versions; try a few common shapes.
    last = (
        (snap.get("value") or {})
        .get("last")
        or (snap.get("session") or {}).get("close")
        or (snap.get("last") or {}).get("value")
    )
    prev = (snap.get("session") or {}).get("previous_close") or snap.get("prev_close")
    ts_ms = (snap.get("last") or {}).get("timestamp") or snap.get("updated")

    if last is None or prev is None:
        raise RuntimeError(f"Polygon response missing last/prev_close fields: {snap}")

    asof = datetime.now(timezone.utc)
    if isinstance(ts_ms, (int, float)) and ts_ms > 0:
        asof = datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc)

    return Quote(symbol="SPX", last=float(last), prev_close=float(prev), asof=asof, source="polygon")


@st.cache_data(ttl=20)
def fetch_spx_quote_yahoo() -> tuple[Quote, pd.DataFrame]:
    """
    Yahoo Finance via yfinance for ^GSPC.
    This is usually delayed and may be rate-limited.
    """
    ticker = yf.Ticker("^GSPC")
    # Pull a little history to compute prior close and show an intraday chart.
    hist_1m = ticker.history(period="5d", interval="1m", auto_adjust=False)
    if hist_1m is None or hist_1m.empty:
        # Fallback to daily if minute bars unavailable
        hist_1d = ticker.history(period="10d", interval="1d", auto_adjust=False)
        if hist_1d is None or hist_1d.empty:
            raise RuntimeError("Yahoo returned no history for ^GSPC.")
        last = float(hist_1d["Close"].iloc[-1])
        prev = float(hist_1d["Close"].iloc[-2]) if len(hist_1d) >= 2 else float("nan")
        asof = hist_1d.index[-1].to_pydatetime().replace(tzinfo=timezone.utc) if hist_1d.index.tz is None else hist_1d.index[-1].to_pydatetime()
        chart_df = hist_1d.reset_index().rename(columns={"Date": "Timestamp"})
        return Quote(symbol="^GSPC", last=last, prev_close=prev, asof=asof, source="yahoo"), chart_df

    # Minute data is timezone-aware; take latest bar.
    last = float(hist_1m["Close"].iloc[-1])
    # Prior close: last daily close from previous session (use daily history).
    hist_1d = ticker.history(period="10d", interval="1d", auto_adjust=False)
    if hist_1d is None or hist_1d.empty or len(hist_1d) < 2:
        raise RuntimeError("Yahoo daily history unavailable to compute previous close.")
    prev = float(hist_1d["Close"].iloc[-2])
    asof = hist_1m.index[-1].to_pydatetime()

    chart_df = hist_1m.reset_index().rename(columns={"Datetime": "Timestamp", "Date": "Timestamp"})
    return Quote(symbol="^GSPC", last=last, prev_close=prev, asof=asof, source="yahoo"), chart_df


def format_points(x: float) -> str:
    return f"{x:,.2f}"


def format_pct(x: float) -> str:
    return f"{x:,.2f}%"


st.title("SPX live 15+ move dashboard")
st.caption("Flags when SPX moves ≥ 15 points vs prior close. For real-time, provide a Polygon key.")

with st.sidebar:
    st.header("Settings")
    threshold_points = st.number_input("Alert threshold (points)", min_value=1.0, value=15.0, step=1.0)
    data_source: Literal["auto", "polygon", "yahoo"] = st.selectbox(
        "Data source",
        ["auto", "polygon", "yahoo"],
        help="Auto uses Polygon if a key is set, otherwise Yahoo Finance (often delayed).",
    )
    refresh_seconds = st.number_input("Auto-refresh (seconds)", min_value=5, value=15, step=5)
    if st_autorefresh is None:
        st.info("Auto-refresh helper not available; use the Refresh button.")
    else:
        st_autorefresh(interval=int(refresh_seconds * 1000), key="spx_refresh")
    st.button("Refresh now", type="primary", on_click=st.rerun)

polygon_key = _get_polygon_api_key()
use_polygon = (data_source == "polygon") or (data_source == "auto" and bool(polygon_key))

quote: Quote
chart_df: pd.DataFrame | None = None

try:
    if use_polygon:
        if not polygon_key:
            raise RuntimeError("POLYGON_API_KEY is not set (use env var or Streamlit secrets).")
        quote = fetch_spx_quote_polygon(polygon_key)
    else:
        quote, chart_df = fetch_spx_quote_yahoo()
except Exception as e:
    st.error(f"Failed to load SPX quote: {e}")
    st.stop()

move_points = quote.move_points
move_pct = quote.move_pct
abs_move = abs(move_points)

alert = abs_move >= float(threshold_points)

top = st.container()
with top:
    c1, c2, c3, c4 = st.columns([1.2, 1.2, 1.2, 1.4])
    c1.metric("Last", format_points(quote.last))
    c2.metric("Prev close", format_points(quote.prev_close))
    c3.metric("Move (pts)", format_points(move_points))
    c4.metric("Move (%)", format_pct(move_pct))

    if alert:
        st.error(f"ALERT: SPX move is {format_points(abs_move)} points (threshold {format_points(threshold_points)}).", icon="🚨")
    else:
        st.success(f"OK: SPX move is {format_points(abs_move)} points (threshold {format_points(threshold_points)}).")

    st.caption(f"As of: {quote.asof.isoformat()} • Source: {quote.source}")

st.divider()

left, right = st.columns([2, 1])

with left:
    st.subheader("Intraday chart (if available)")
    if chart_df is None or chart_df.empty:
        st.info("No intraday bars available from this data source.")
    else:
        # Normalize columns for charting
        time_col = "Timestamp" if "Timestamp" in chart_df.columns else chart_df.columns[0]
        if "Close" in chart_df.columns:
            plot_df = chart_df[[time_col, "Close"]].dropna()
            plot_df = plot_df.rename(columns={time_col: "Time"})
            st.line_chart(plot_df, x="Time", y="Close")
        else:
            st.dataframe(chart_df.tail(200), use_container_width=True)

with right:
    st.subheader("Notes")
    st.write(
        "- **SPX** is the index; this app computes points vs prior close.\n"
        "- Yahoo Finance is typically **delayed**.\n"
        "- For “real-time”, set **`POLYGON_API_KEY`** (and ensure your plan includes real-time index data)."
    )
