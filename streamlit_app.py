import os
import threading

import streamlit as st


st.set_page_config(
    page_title="TITAN OMEGA v17.5 | Quant Terminal",
    page_icon="📈",
    layout="wide",
)


@st.cache_resource
def _start_titan_backend() -> dict:
    """
    Starts the FastAPI TITAN backend in-process (single GLOBAL_STATE lives in titan_server.py).
    This avoids full Streamlit rerenders for live updates; the terminal UI runs in the browser.
    """
    port = int(os.getenv("TITAN_PORT", "8000"))
    host = os.getenv("TITAN_HOST", "0.0.0.0")
    started = False
    err = None

    try:
        # Import here so Streamlit UI can render even if POLYGON_API_KEY is missing.
        import uvicorn
        from titan_server import app  # requires POLYGON_API_KEY

        cfg = uvicorn.Config(app, host=host, port=port, log_level=os.getenv("TITAN_LOG_LEVEL", "info"))
        server = uvicorn.Server(cfg)

        def _run():
            try:
                server.run()
            except Exception:
                pass

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        started = True
    except Exception as e:
        err = f"{type(e).__name__}: {e}"

    return {"started": started, "host": host, "port": port, "error": err}


st.markdown("### TITAN OMEGA v17.5 — Quant Terminal V2")
st.caption("Polygon-only. Set `POLYGON_API_KEY` as an environment variable (no hardcoding).")

backend = _start_titan_backend()

if not backend["started"]:
    st.error("Backend not running.")
    st.code(
        "\n".join(
            [
                "export POLYGON_API_KEY='...'",
                "python -m uvicorn titan_server:app --host 0.0.0.0 --port 8000",
            ]
        )
    )
    if backend["error"]:
        st.caption(f"Startup error: {backend['error']}")
    st.stop()

port = backend["port"]

cols = st.columns([1, 1, 3])
with cols[0]:
    st.metric("Backend", "RUNNING")
with cols[1]:
    st.metric("Port", str(port))
with cols[2]:
    st.markdown(f"Open terminal UI directly: `http://localhost:{port}/`")

st.components.v1.iframe(f"http://localhost:{port}/", height=900, scrolling=True)
