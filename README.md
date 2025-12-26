# SPX live move dashboard (15+ points)

A Streamlit dashboard that monitors the S&P 500 index (SPX / `^GSPC`) and highlights when the **live move is ≥ 15 index points** vs the prior close.

## Data sources

- **Default (no API key)**: Yahoo Finance via `yfinance` (`^GSPC`). Quotes are typically delayed.
- **Optional (API key)**: Polygon.io index snapshot (recommended for “real-time” if your plan includes it).

## Configure API key (optional)

Set an environment variable:

```bash
export POLYGON_API_KEY="YOUR_KEY_HERE"
```

Or use Streamlit secrets (recommended):

- Create `.streamlit/secrets.toml`
- Add:

```toml
POLYGON_API_KEY="YOUR_KEY_HERE"
```

## How to run locally

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```
