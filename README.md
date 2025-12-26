## TITAN OMEGA v17.5 — Quant Terminal V2

**Polygon-only live data.** Provide your API key via environment variable `POLYGON_API_KEY` (never hardcoded).

### Run

Install deps:

```
pip install -r requirements.txt
```

Option A (recommended): run the FastAPI terminal directly:

```
export POLYGON_API_KEY="..."
python -m uvicorn titan_server:app --host 0.0.0.0 --port 8000
```

Then open:
- Terminal UI: `http://localhost:8000/`
- Health: `http://localhost:8000/health`
- Alerts archive: `http://localhost:8000/archive/alerts?limit=10`
- Stats: `http://localhost:8000/stats`
- WS: `ws://localhost:8000/ws`

Option B: run via Streamlit wrapper (embeds the terminal UI):

```
export POLYGON_API_KEY="..."
streamlit run streamlit_app.py
```
